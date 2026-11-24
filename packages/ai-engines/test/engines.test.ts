import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// ACP（Gemini、OpenCode）和 Codex 的引擎；Claude Code 的接着画布笔记的 MCP 服务测，在 apps/notes/test/engines-claude.test.ts
import { acpEngine, claudeArgs, CODEX_LOCKED, codexEngine, codexModelList, type Engine, type EngineStep, GEMINI_POLICY, geminiArgs, opencodeConfig } from '../src/engines'

const cwd = mkdtempSync(join(tmpdir(), 'cn-engine-'))
const opened: Engine[] = []
afterAll(() => {
  for (const e of opened) e.dispose?.()
  rmSync(cwd, { recursive: true, force: true })
})

const fixture = (name: string) => join(__dirname, 'fixtures', name)
const mcp = { url: 'http://127.0.0.1:1/mcp', token: 'tok', tools: ['board_add_card'] }

async function turn(e: Engine, session?: string) {
  const deltas: string[] = []
  const r = await e.run({ prompt: '用户说：\n你好', system: '系统提示：做个好助手', cwd, mcp, session, signal: new AbortController().signal, onText: (d) => deltas.push(d) })
  return { ...r, deltas }
}

describe('ACP 引擎（Gemini、OpenCode 的接法）', () => {
  it('开会话带上我们的 MCP 和令牌，字边生成边给；我们的工具放行，它自己写文件拒绝；第二轮接着同一个会话', async () => {
    const e = acpEngine({ id: 'gemini', command: process.execPath, args: () => [fixture('fake-acp.mjs')], loginHint: '去登录' })
    opened.push(e)
    const r = await turn(e)
    expect(r.deltas.length).toBe(4)
    expect(r.text).toBe('会话 s1；MCP http:canvas:有令牌；我们的工具 a1；它自己写文件 r1；开头是系统提示 是')
    expect(r.session).toBe('s1')
    const again = await turn(e, r.session)
    expect(again.text).toContain('会话 s1；')
    expect(again.text).toContain('开头是系统提示 否')
  })

  it('带图：图作为 image 内容块跟在话后面', async () => {
    const e = acpEngine({ id: 'opencode', command: process.execPath, args: () => [fixture('fake-acp.mjs')], loginHint: '去登录' })
    opened.push(e)
    const r = await e.run({ prompt: '讲一下', system: '系统', cwd, images: [{ mime: 'image/png', data: 'QUJD', path: '/x.png' }], signal: new AbortController().signal, onText: () => undefined })
    expect(r.text).toContain('；图 image/png:QUJD')
  })

  it('旁支（fork）：ACP 没有分叉，开一个新会话，调用方给的那一轮问答放在第一问前面（系统提示还在最前）', async () => {
    const saved = process.env.FAKE_ACP_ECHO
    process.env.FAKE_ACP_ECHO = '1'
    try {
      const e = acpEngine({ id: 'gemini', command: process.execPath, args: () => [fixture('fake-acp.mjs')], loginHint: '去登录' })
      opened.push(e)
      const main = await turn(e)
      const side = await e.run({ prompt: '为什么不清零', system: '系统', cwd, session: main.session, fork: true, history: '【那一轮】问：讲解一下；答：减掉门槛', signal: new AbortController().signal, onText: () => undefined })
      expect(side.session).not.toBe(main.session)
      expect(side.text).toContain('开头是系统提示 是')
      expect(side.text).toContain('；话 系统//---//【那一轮】问：讲解一下；答：减掉门槛//为什么不清零')
    } finally {
      if (saved === undefined) delete process.env.FAKE_ACP_ECHO
    }
  })

  /** 起一个 ACP 引擎跑一问；env 在起进程前设好（进程从 process.env 拿） */
  async function acpRun(o: { id: 'gemini' | 'opencode'; omni: boolean; env?: Record<string, string>; onStep?(s: EngineStep): void; engine?: Engine; noMcp?: boolean }) {
    const saved = { ...process.env }
    Object.assign(process.env, o.env ?? {})
    try {
      const e =
        o.engine ??
        acpEngine({
          id: o.id,
          command: process.execPath,
          args: (_cwd, omni) => [fixture('fake-acp.mjs'), ...(o.id === 'gemini' ? geminiArgs(omni, '/tmp/p.toml') : ['acp', '--cwd', cwd])],
          env: (omni): Record<string, string> => (o.id === 'opencode' ? { OPENCODE_CONFIG_CONTENT: opencodeConfig(omni) } : {}),
          loginHint: '去登录',
        })
      opened.push(e)
      const r = await e.run({ prompt: '用户说：\n你好', system: '系统提示', cwd, ...(o.noMcp ? {} : { mcp }), omni: o.omni, onStep: o.onStep, signal: new AbortController().signal, onText: () => undefined })
      return { ...r, engine: e }
    } finally {
      for (const k of Object.keys(o.env ?? {})) if (saved[k] === undefined) delete process.env[k]
    }
  }

  it('全能模式：Gemini --approval-mode yolo；它自己要写文件、跑命令也放行；关着时 default + 策略文件拒掉跑命令、写文件、上网、子 Agent，只放行我们的工具', async () => {
    const on = await acpRun({ id: 'gemini', omni: true, env: { FAKE_ACP_ARGS: '1' } })
    expect(on.text).toContain('我们的工具 a1；它自己写文件 a1；')
    expect(on.text).toContain('参数 --acp --approval-mode yolo --allowed-mcp-server-names canvas；')
    const off = await acpRun({ id: 'gemini', omni: false, env: { FAKE_ACP_ARGS: '1' } })
    expect(off.text).toContain('我们的工具 a1；它自己写文件 r1；')
    expect(off.text).toContain('参数 --acp --approval-mode default --allowed-mcp-server-names canvas --policy /tmp/p.toml；')
    for (const t of ['run_shell_command', 'write_file', 'replace', 'web_fetch', 'google_web_search', 'invoke_agent']) expect(GEMINI_POLICY).toContain(`"${t}"`)
    expect(GEMINI_POLICY).toContain('decision = "deny"')
  })

  it('全能模式：OpenCode 的权限全放开（「*」: allow）；关着时改文件、跑命令、上网、库外、子 Agent 都拒', async () => {
    expect(JSON.parse(opencodeConfig(true))).toEqual({ permission: { '*': 'allow' } })
    expect(JSON.parse(opencodeConfig(false))).toEqual({ permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny', external_directory: 'deny', task: 'deny' } })
    const on = await acpRun({ id: 'opencode', omni: true, env: { FAKE_ACP_ARGS: '1' } })
    expect(on.text).toContain('它自己写文件 a1；')
    expect(on.text).toContain(`设置 ${opencodeConfig(true)}`)
  })

  it('全能模式不给 mcp（ParaRead）：Gemini 照样 yolo、它自己写文件放行，只是不接 MCP；OpenCode 权限全放开', async () => {
    const g = await acpRun({ id: 'gemini', omni: true, noMcp: true, env: { FAKE_ACP_ARGS: '1' } })
    expect(g.text).toContain('MCP ；')
    expect(g.text).toContain('它自己写文件 a1；')
    expect(g.text).toContain('参数 --acp --approval-mode yolo')
    const oc = await acpRun({ id: 'opencode', omni: true, noMcp: true, env: { FAKE_ACP_ARGS: '1' } })
    expect(oc.text).toContain('MCP ；')
    expect(oc.text).toContain('它自己写文件 a1；')
    expect(oc.text).toContain(`设置 ${opencodeConfig(true)}`)
    // 全能关着、不给 mcp：照旧拒掉它自己写文件
    const off = await acpRun({ id: 'gemini', omni: false, noMcp: true, env: { FAKE_ACP_ARGS: '1' } })
    expect(off.text).toContain('它自己写文件 r1；')
    expect(off.text).toContain('--approval-mode default')
  })

  it('换了模式：ACP 进程按新参数重起（会话换新的，最近几轮补在前面）', async () => {
    const first = await acpRun({ id: 'gemini', omni: true, env: { FAKE_ACP_ARGS: '1' } })
    expect(first.text).toContain('--approval-mode yolo')
    const again = await acpRun({ id: 'gemini', omni: false, env: { FAKE_ACP_ARGS: '1' }, engine: first.engine })
    expect(again.text).toContain('--approval-mode default')
    expect(again.text).toContain('开头是系统提示 是')
  })

  it('步骤：tool_call / tool_call_update 报给 onStep（跑命令、读文件，失败的带原因）；我们 MCP 的不报', async () => {
    const got: EngineStep[] = []
    await acpRun({ id: 'gemini', omni: true, env: { FAKE_ACP_STEPS: '1' }, onStep: (s) => got.push(s) })
    expect(got.map((s) => `${s.tool}:${s.status}`)).toEqual(['Bash:run', 'Bash:ok', 'Read:run', 'Read:err'])
    expect(got[0]!.input).toEqual({ command: 'ls -1 /Users' })
    expect(got[2]!.input).toEqual({ file_path: '/etc/hosts' })
    expect(got[3]!.detail).toBe('读不了')
  })

  it('没登录时说清楚怎么登录', async () => {
    const e = acpEngine({ id: 'gemini', command: process.execPath, args: () => [fixture('fake-acp.mjs')], env: () => ({ FAKE_ACP_NO_LOGIN: '1' }), loginHint: 'Gemini 还没登录：在终端里运行一次 gemini' })
    opened.push(e)
    await expect(turn(e)).rejects.toThrow('Gemini 还没登录：在终端里运行一次 gemini（Gemini API key is missing or not configured.）')
  })
})

describe('Codex 引擎（app-server）', () => {
  it('只接我们的 MCP（令牌放环境变量），只读沙箱；我们的工具放行、它自己改文件拒绝；别的线程的字不混进来', async () => {
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const r = await turn(e)
    expect(r.text).toBe(
      `线程 th1；配置 mcp_servers={canvas={url="http://127.0.0.1:1/mcp",bearer_token_env_var="CN_MCP_TOKEN",default_tools_approval_mode="approve"}}；令牌 在环境变量里；我们的工具 accept；它自己改文件 decline；它自己跑命令 decline；沙箱 read-only；批准 never；上网搜 disabled；关掉的 ${CODEX_LOCKED.filter((a) => a !== '-c').join(',')}；系统提示 系统提示：做个好助手`,
    )
    expect(r.deltas).not.toContain('串了')
    expect(r.session).toBe('th1')
    expect((await turn(e, 'th1')).session).toBe('th1')
  })

  it('CN-91：这一问的模型和 effort 放在 turn/start 上；没选就都不传（Codex 用它自己的默认）', async () => {
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const r = await e.run({ prompt: '讲一下', system: '系统', cwd, model: 'gpt-6-luna', effort: 'low', signal: new AbortController().signal, onText: () => undefined })
    expect(r.text).toContain('；模型 gpt-6-luna；effort low')
    const plain = await e.run({ prompt: '讲一下', system: '系统', cwd, signal: new AbortController().signal, onText: () => undefined })
    expect(plain.text).not.toContain('；模型')
  })

  it('CN-91：模型列表问 app-server 的 model/list（翻页取全、藏起来的不要、默认的排第一），每个模型带自己那几档 effort', async () => {
    const list = await codexModelList(process.execPath, [fixture('fake-codex.mjs')])
    expect(list.map((m) => [m.id, m.label, m.efforts.map((x) => x.label).join(','), m.defaultEffort])).toEqual([
      ['gpt-6.1-terra', 'GPT-6.1 Terra', 'Low,High,Extra high,Ultra', 'low'],
      ['gpt-6-luna', 'GPT-6-Luna', 'Low,Medium,High', 'medium'],
    ])
    await expect(codexModelList('/nonexistent/codex')).rejects.toThrow()
  })

  it('旁支（fork）：thread/fork 从主对话的线程整段分叉，在新线程上问、不再补那一轮；分叉不了（线程没了）就开新线程、把那一轮放在第一问前面', async () => {
    const saved = process.env.FAKE_CODEX_ECHO
    process.env.FAKE_CODEX_ECHO = '1'
    try {
      const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
      opened.push(e)
      const run = (session: string) => e.run({ prompt: '为什么不清零', system: '旁支的系统提示', cwd, session, fork: true, history: '【那一轮】', signal: new AbortController().signal, onText: () => undefined })
      const side = await run('th7')
      expect(side.session).toBe('th7-fork')
      expect(side.text).toContain('线程 th7-fork；')
      expect(side.text).toContain('系统提示 旁支的系统提示')
      expect(side.text).toContain('；话 为什么不清零')
      expect(side.text).not.toContain('【那一轮】')
      const gone = await run('gone')
      expect(gone.session).toMatch(/^th\d+$/)
      expect(gone.text).toContain('；话 【那一轮】//为什么不清零')
    } finally {
      if (saved === undefined) delete process.env.FAKE_CODEX_ECHO
    }
  })

  it('全能模式：danger-full-access、approval never、上网搜 live，什么功能都不关；它自己改文件、跑命令的批准一律放行', async () => {
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const r = await e.run({ prompt: '你好', system: '系统', cwd, mcp, omni: true, signal: new AbortController().signal, onText: () => undefined })
    expect(r.text).toContain('我们的工具 accept；它自己改文件 accept；它自己跑命令 accept；沙箱 danger-full-access；批准 never；上网搜 live；关掉的 没有；')
  })

  it('全能关着：只读沙箱，跑命令、上网搜、apps、浏览器和电脑操作、子 Agent 都关掉；换回全能时进程按新参数重起，线程接着用（thread/resume）', async () => {
    expect(CODEX_LOCKED).toEqual(expect.arrayContaining(['features.shell_tool=false', 'web_search="disabled"', 'features.apps=false', 'features.multi_agent=false']))
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const off = await e.run({ prompt: '你好', system: '系统', cwd, mcp, omni: false, signal: new AbortController().signal, onText: () => undefined })
    expect(off.text).toContain('沙箱 read-only；批准 never；上网搜 disabled；')
    expect(off.text).toContain('features.shell_tool=false')
    const on = await e.run({ prompt: '再来', system: '系统', cwd, mcp, omni: true, session: off.session, signal: new AbortController().signal, onText: () => undefined })
    expect(on.session).toBe(off.session)
    expect(on.text).toContain('沙箱 danger-full-access；批准 never；上网搜 live；关掉的 没有；')
  })

  it('全能模式不给 mcp（ParaRead）：照样 danger-full-access、批准一律放行，不接 MCP（mcp_servers 是空的）；关着时照旧只读', async () => {
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const on = await e.run({ prompt: '你好', system: '系统', cwd, omni: true, signal: new AbortController().signal, onText: () => undefined })
    expect(on.text).toContain('配置 mcp_servers={}；')
    expect(on.text).toContain('它自己改文件 accept；它自己跑命令 accept；沙箱 danger-full-access；批准 never；上网搜 live；关掉的 没有；')
    const off = await e.run({ prompt: '再来', system: '系统', cwd, omni: false, signal: new AbortController().signal, onText: () => undefined })
    expect(off.text).toContain('它自己改文件 decline；它自己跑命令 decline；沙箱 read-only；')
  })

  it('步骤：commandExecution、fileChange、webSearch 开始、做完报给 onStep（统一成 Bash、Write、WebSearch）；我们 MCP 的不报', async () => {
    const saved = process.env.FAKE_CODEX_STEPS
    process.env.FAKE_CODEX_STEPS = '1'
    try {
      const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
      opened.push(e)
      const got: EngineStep[] = []
      await e.run({ prompt: '你好', system: '系统', cwd, mcp, omni: true, onStep: (s) => got.push(s), signal: new AbortController().signal, onText: () => undefined })
      expect(got.map((s) => `${s.tool}:${s.status}`)).toEqual(['Bash:run', 'Bash:ok', 'Write:run', 'Write:err', 'WebSearch:run', 'WebSearch:ok'])
      expect(got[0]!.input).toEqual({ command: 'ls -1 /Users' })
      expect(got[2]!.input).toEqual({ file_path: '/tmp/x.md' })
      expect(got[4]!.input).toEqual({ query: '天气' })
    } finally {
      if (saved === undefined) delete process.env.FAKE_CODEX_STEPS
    }
  })

  it('带图：Codex 只认本机文件，给 localImage 和路径', async () => {
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const r = await e.run({ prompt: '讲一下', system: '系统', cwd, images: [{ mime: 'image/png', data: 'QUJD', path: '/tmp/p5-1.png' }], signal: new AbortController().signal, onText: () => undefined })
    expect(r.text).toContain('；图 /tmp/p5-1.png')
  })
})

describe('Claude Code 全能模式不给 mcp（ParaRead）', () => {
  const at = (a: string[], f: string) => a[a.indexOf(f) + 1]

  it('bypassPermissions、自带工具全给只拿掉 AskUserQuestion、系统提示附在后面、一个用户设置都不读、--strict-mcp-config 不给 --mcp-config、留会话', () => {
    const a = claudeArgs({ system: '全能的', omni: true })
    expect(at(a, '--permission-mode')).toBe('bypassPermissions')
    expect(at(a, '--disallowedTools')).toBe('AskUserQuestion')
    expect(at(a, '--append-system-prompt')).toBe('全能的')
    expect(a).not.toContain('--system-prompt')
    expect(a).toContain('--setting-sources=')
    expect(a).toContain('--strict-mcp-config')
    for (const f of ['--mcp-config', '--tools', '--allowedTools', '--max-turns', '--no-session-persistence']) expect(a).not.toContain(f)
  })

  it('接着聊、换模型和 effort 照旧带上', () => {
    const a = claudeArgs({ system: '全能的', omni: true, model: 'sonnet', effort: 'low' }, 'c-1')
    expect(at(a, '--model')).toBe('sonnet')
    expect(at(a, '--effort')).toBe('low')
    expect(at(a, '--resume')).toBe('c-1')
  })

  it('全能关着、不给 mcp：照旧只聊天（一个工具都不给，答一次）', () => {
    const a = claudeArgs({ system: '聊天的', omni: false })
    expect(at(a, '--permission-mode')).toBe('dontAsk')
    expect(at(a, '--tools')).toBe('')
    expect(at(a, '--max-turns')).toBe('1')
    expect(a).toContain('--no-session-persistence')
  })

  it('给了 mcp 却没写出配置文件：不当全能（照旧）', () => {
    const a = claudeArgs({ system: 'x', omni: true, mcp: { url: 'http://x/mcp', token: 't', tools: [] } })
    expect(at(a, '--permission-mode')).toBe('dontAsk')
  })
})
