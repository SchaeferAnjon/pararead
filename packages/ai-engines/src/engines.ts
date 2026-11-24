/**
 * 四家本机 AI 命令行，统一成一个样子：给一段话，边生成边吐字，能用我们的 MCP 工具，能接着上一轮聊。
 * - Claude Code：claude -p --output-format stream-json（一轮一个进程，--resume 接着聊）
 * - Codex：codex app-server（JSON-RPC，一行一条）
 * - Gemini CLI：gemini --acp；OpenCode：opencode acp（都是 ACP）
 * 两种模式（2026-11-19 用户要的，默认全能）：
 * - 全能模式开着（EngineRun.omni）：和用户在终端里用这家命令行一样能干：读写这台 Mac 上的文件、跑命令、上网、开子 Agent，不停下来问
 *   （软件里没法弹命令行自己的权限确认）。我们的 MCP 工具照样给；AI 自己改了库里的文件，这一轮结束由 agent/index.ts 一起提交。
 * - 关着：AI 自己不能写文件、跑命令、上网，改笔记只能走我们的工具（新建、改写、改名、挪、删都有），库里的文件能只读翻。
 *
 * 各家怎么接参照了 Claudian（github.com/yishentu/claudian，MIT，版权 (c) 2025 Yishen Tu）的
 * src/providers/claude、src/providers/codex、src/providers/acp，许可声明见仓库根目录 THIRD_PARTY_NOTICES.md。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineId } from './shared'
import { effortOption, ENGINE_LABEL, type ModelOption } from './shared'
import type { CliId } from './shared'
import { cliEnv, findCli, INSTALL_HINT } from './cli'
import { t } from './shared/i18n'
import { RpcProcess } from './jsonrpc'

export interface EngineRun {
  prompt: string
  system: string
  /**
   * system 附在命令行自己的系统提示后面，不整个换掉（CN-89，读 PDF 讲解）：Claude Code 用 --append-system-prompt，
   * 读用户自己的设置（~/.claude 里的 CLAUDE.md、讲解偏好）但关掉 hooks（不让每问一次都跑用户的开场钩子），MCP 仍只接我们给的。
   * 不给（AI 浮窗动手、/ 命令、梦游）：--system-prompt 整个换掉、一个设置都不读。Codex、ACP 本来就是附在后面
   */
  appendSystem?: boolean
  cwd: string
  /** 不给就是只聊天、不用工具（/总结、/翻译 这类命令） */
  mcp?: { url: string; token: string; tools: string[] }
  /** 上一轮的会话号，接着聊 */
  session?: string
  /**
   * 旁支（CN-90）：不接着 session 聊，从它整段分叉出一个新会话再问（返回的 session 是新的）。
   * Claude Code：--resume <session> --fork-session（命令行只能整段分叉，和 Dispatch 一样从最后一个回答分）；Codex：thread/fork；
   * Gemini、OpenCode 没有分叉：开新会话、history（调用方给的那一轮问答原文）放在第一问前面。分叉不了（会话没了）也是这样
   */
  fork?: boolean
  /**
   * 换模型：Claude Code 的 --model（翻译这类要快的活用便宜的）、Codex 的 turn/start model（CN-91）；
   * OpenCode 的 session/set_config_option、Gemini 的 session/set_model（task-m55m7，开会话以后、问之前换）
   */
  model?: string
  /** 想多久（CN-91）：Claude Code 的 --effort、Codex 的 turn/start effort、OpenCode 的 thought_level 那一项；不给用命令行自己的默认档；Gemini 没有 */
  effort?: string
  /** 会话接不上（软件重开过）时补在前面的最近几轮对话 */
  history?: string
  /** 跟着这段话一起给的图（读 PDF 时框的那块）：data 是 base64，path 是本机的绝对路径（Codex 只认文件） */
  images?: EngineImage[]
  /** 不给工具时也留着会话、能接着聊（读 PDF 的问答要追问；/ 命令那种问一次就完的不留） */
  keepSession?: boolean
  /** 只给只读的 Read、Glob、Grep 自己翻库里的文件（「让 Claude 帮我找」），不接我们的 MCP；只有 Claude Code 认 */
  readOnly?: boolean
  /** AI 每调一次工具报一声（「让 Claude 帮我找」把过程显示出来） */
  onTool?(name: string, input: Record<string, unknown>): void
  /**
   * 全能模式（2026-11-19，默认开）：开着：这家命令行自带的工具全给、不停下来问（bypassPermissions、danger-full-access、yolo）；
   * 关着：只给我们的工具和库里只读翻文件。不给 mcp 也照全能模式跑，只是不接 MCP（ParaRead 没有我们的工具，也要全能模式）；
   * 画布笔记开着全能模式时总给 mcp
   */
  omni?: boolean
  /** 这家命令行自己的工具（不是我们 MCP 的）开始、做完：对话里的步骤行（全能模式下跑命令、写文件、上网搜这些） */
  onStep?(s: EngineStep): void
  signal: AbortSignal
  onText(delta: string): void
}

/**
 * 命令行自己的一步。各家的叫法统一成 Claude Code 的：Bash（跑命令）、Read、Write、Edit、Glob、Grep、WebSearch、WebFetch、Task（子 Agent）……
 * input 也照 Claude Code 的字段（command、file_path、pattern、query、url、description）；id 是这家给的，开始和做完对得上
 */
export interface EngineStep {
  id: string
  tool: string
  input: Record<string, unknown>
  status: 'run' | 'ok' | 'err'
  /** 出错时的原因（第一行） */
  detail?: string
}

export interface EngineImage {
  mime: 'image/png' | 'image/jpeg'
  data: string
  path: string
}

export interface EngineOutcome {
  text: string
  session?: string
}

export interface Engine {
  id: EngineId
  label: string
  run(r: EngineRun): Promise<EngineOutcome>
  dispose?(): void
}

export const LABELS: Record<EngineId, string> = ENGINE_LABEL
export const MCP_NAME = 'canvas'

const APP = { name: 'canvas-notes', version: '0.0.1' }

function need(id: CliId): string {
  const p = findCli(id)
  if (!p) throw new Error(INSTALL_HINT[id])
  return p
}

const withHistory = (r: EngineRun, fresh: boolean) => (fresh && r.history ? `${r.history}\n\n${r.prompt}` : r.prompt)

const aborted = () => Object.assign(new Error(t('停下了')), { name: 'AbortError' })

/**
 * 没答完（停下、出错、步数到上限）也带上会话号：已经做了的几步、读过的东西都在这个会话里，
 * 用户说「接着做」时接着它聊（以前没答完就不记会话号，下一问开新会话，只补几句「之前聊过的」）
 */
export const sessionOf = (e: unknown): string | undefined => {
  const s = (e as { session?: unknown } | null)?.session
  return typeof s === 'string' && s ? s : undefined
}
const tagSession = <E extends Error>(e: E, session: string | undefined): E => (session ? Object.assign(e, { session }) : e)

// ---------------------------------------------------------------- Claude Code

export const CLAUDE_MODEL = process.env.CN_AI_MODEL || 'claude-opus-5-5'

/** Claude Code 自带的工具只留这三样只读的；dontAsk 下它读不到库外面的文件（不在工作目录里的读会被拒） */
const CLAUDE_READ_TOOLS = ['Read', 'Glob', 'Grep']
/** 自带的写文件、跑命令、上网、开子 Agent 再明着禁一遍（--tools 已经不给了） */
const CLAUDE_DENIED = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']
/** 全能模式只拿掉问人的那个：软件里没有地方答它的选择题（要问就写在回答里） */
const CLAUDE_OMNI_DENIED = ['AskUserQuestion']
/** Claude Code 自己的、不是在动手的那几步（真跑见过 ToolSearch：用 MCP 工具前先把工具说明拿进来），不报成步骤行 */
const CLAUDE_QUIET = new Set(['ToolSearch'])

/**
 * claude -p 的参数（以 claude --help 为准，2.1.323 核过；2.1.330 照 --help 和空输入试参数再核过一遍，task-m55m7）。mcpConfig：写着我们 MCP 服务和令牌的 json 文件，只在给工具时有。
 *
 * 全能模式（omni；给了 mcp 时要有 mcpConfig，不给 mcp 就不接 MCP）：--permission-mode bypassPermissions（不停下来问，和 --dangerously-skip-permissions 一样），自带工具全给，
 * 只拿掉问人的 AskUserQuestion；不限轮数（和终端里一样，用户随时能停）；系统提示附在 Claude Code 自己的后面（它自己那份教它用好
 * Bash、Write 这些）。设置：AI 对话一个都不读（--setting-sources=）：用户的 CLAUDE.md 是写给终端里干活的 Agent 的（任务看板、
 * 派子 Agent、交付页），有了 Bash 它会真去建任务、派子 Agent；hooks 每问一次都会跑；用户的 MCP（邮件、日历、交易账户）在不问人的
 * 模式下会直接动手。读 PDF 照 CN-89 读用户设置（讲解偏好），hooks 照样关掉。两种都 --strict-mcp-config：MCP 只接我们的。
 */
export function claudeArgs(r: Pick<EngineRun, 'system' | 'appendSystem' | 'mcp' | 'model' | 'effort' | 'images' | 'keepSession' | 'readOnly' | 'fork' | 'omni'>, resume?: string, mcpConfig?: string): string[] {
  const omni = !!r.omni && (!r.mcp || !!mcpConfig)
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', r.model ?? CLAUDE_MODEL,
    ...(r.appendSystem
      ? // 读 PDF 讲解：留 Claude Code 自己的系统提示，读 PDF 那几条附在后面；读用户的设置（CLAUDE.md），hooks 关掉
        ['--append-system-prompt', r.system, '--setting-sources', 'user', '--settings', JSON.stringify({ disableAllHooks: true })]
      : omni
        ? // 全能模式的 AI 对话：留 Claude Code 自己的系统提示，我们的附在后面；一个用户设置都不读
          ['--append-system-prompt', r.system, '--setting-sources=']
        : // 不读用户的设置（hooks、权限、插件）
          ['--system-prompt', r.system, '--setting-sources=']),
    // MCP 只接我们给的
    '--strict-mcp-config',
    ...(omni
      ? // 全能模式：不停下来问；自带工具全给，只拿掉问人的那个
        ['--permission-mode', 'bypassPermissions', '--disallowedTools', CLAUDE_OMNI_DENIED.join(',')]
      : // 没明着放行的一律拒绝，不会停下来问
        ['--permission-mode', 'dontAsk', '--disallowedTools', CLAUDE_DENIED.join(',')]),
  ]
  if (omni) {
    // 全能模式不给 mcp（ParaRead）：自带工具照样全给，只是不接 MCP
    if (r.mcp) args.push('--mcp-config', mcpConfig!)
  } else if (r.mcp && mcpConfig) {
    const ours = r.mcp.tools.map((t) => `mcp__${MCP_NAME}__${t}`)
    args.push('--tools', CLAUDE_READ_TOOLS.join(','), '--mcp-config', mcpConfig, '--allowedTools', ours.join(','), '--max-turns', '40')
  } else if (r.readOnly) {
    // 只读翻文件：只给 Read、Glob、Grep，dontAsk 下读不到库外面；找完就完，不留会话
    args.push('--tools', CLAUDE_READ_TOOLS.join(','), '--allowedTools', CLAUDE_READ_TOOLS.join(','), '--max-turns', '30', '--no-session-persistence')
  } else {
    // 只聊天：一个工具都不给，答一次；/ 命令那种不留会话记录，读 PDF 的问答留着好追问
    args.push('--tools', '', '--max-turns', '1')
    if (!r.keepSession) args.push('--no-session-persistence')
  }
  if (r.effort) args.push('--effort', r.effort)
  // 带图：话改成 stream-json 的一条用户消息（图是 image 内容块），见 code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
  if (r.images?.length) args.push('--input-format', 'stream-json')
  if (resume) args.push('--resume', resume)
  // 旁支：从这个会话分叉，另起一个会话号（原来的会话不动）
  if (resume && r.fork) args.push('--fork-session')
  return args
}

/** 带图时从标准输入给的那一行 */
export function claudeImageMessage(text: string, images: EngineImage[]): string {
  const content = [{ type: 'text', text }, ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }))]
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n'
}

/** 我们的 MCP 服务写进一个只有自己能读的临时文件（令牌不放在命令行上，ps 看不到） */
function mcpConfigFile(mcp: NonNullable<EngineRun['mcp']>): { path: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'cn-claude-'))
  const path = join(dir, 'mcp.json')
  const config = { mcpServers: { [MCP_NAME]: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } }
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/** stream-json 里用得到的几样 */
interface ClaudeLine {
  type?: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  event?: { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string } }
  /** 子 Agent 里面的那几步带着它所在的 Task 的 id（不报成步骤，只报 Task 本身） */
  parent_tool_use_id?: string | null
  message?: { content?: { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean; content?: unknown }[] }
}

/** tool_result 的 content（字符串或 [{type:'text',text}]）的第一行，出错时当原因 */
function firstLine(c: unknown): string {
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '')).join('\n') : ''
  return (text.trim().split('\n')[0] ?? '').slice(0, 300)
}

/** 跑一次 claude -p：话从标准输入给，一行一个 JSON 事件读回来 */
function runClaude(exe: string, args: string[], prompt: string, r: EngineRun): Promise<EngineOutcome> {
  if (r.signal.aborted) return Promise.reject(aborted())
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: r.cwd, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let text = ''
    let streamed = false
    let session: string | undefined
    let result: string | null = null
    let error: string | null = null
    let stderr = ''
    let buf = ''
    let settled = false
    /** 报了「在做」还没报「做完」的步骤 */
    const steps = new Map<string, { tool: string; input: Record<string, unknown> }>()
    const stop = () => child.kill('SIGTERM')
    r.signal.addEventListener('abort', stop)
    const finish = (f: () => void) => {
      if (settled) return
      settled = true
      r.signal.removeEventListener('abort', stop)
      f()
    }

    const onLine = (line: string) => {
      if (!line.trim()) return
      let m: ClaudeLine
      try {
        m = JSON.parse(line) as ClaudeLine
      } catch {
        return // 不是事件的行（比如升级提示）不管
      }
      if (typeof m.session_id === 'string') session = m.session_id
      if (m.type === 'stream_event' && m.event) {
        const ev = m.event
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && text) {
          // 调完工具接着说的话另起一段
          text += '\n\n'
          r.onText('\n\n')
        }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          streamed = true
          text += ev.delta.text
          r.onText(ev.delta.text)
        }
      } else if (m.type === 'assistant') {
        for (const c of m.message?.content ?? []) {
          if (c.type !== 'tool_use' || !c.name) continue
          r.onTool?.(c.name, c.input ?? {})
          // 步骤：我们 MCP 的由 MCP 服务自己报；子 Agent 里面的那几步不报（只报 Task 本身）；
          // 它自己找工具的那一步（ToolSearch，用到 MCP 工具前先把工具说明拿进来）不是在动手，不报
          if (!r.onStep || !c.id || m.parent_tool_use_id || c.name.startsWith(`mcp__${MCP_NAME}__`) || CLAUDE_QUIET.has(c.name)) continue
          steps.set(c.id, { tool: c.name, input: c.input ?? {} })
          r.onStep({ id: c.id, tool: c.name, input: c.input ?? {}, status: 'run' })
        }
      } else if (m.type === 'user' && r.onStep) {
        for (const c of m.message?.content ?? []) {
          const step = c.type === 'tool_result' && c.tool_use_id ? steps.get(c.tool_use_id) : undefined
          if (!step) continue
          steps.delete(c.tool_use_id!)
          // 跑命令出错的原话「Exit code 1」写成中文，和 Codex 那边一样
          r.onStep({ id: c.tool_use_id!, ...step, status: c.is_error ? 'err' : 'ok', ...(c.is_error ? { detail: firstLine(c.content).replace(/^Exit code (\d+)$/, (_m, n: string) => t('退出码 {n}', { n })) } : {}) })
        }
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && !m.is_error) result = m.result ?? ''
        else error = (m.subtype === 'success' ? m.result : m.subtype) || t('不知道为什么')
      }
    }

    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
    child.on('error', (e) => finish(() => reject(new Error(t('{name} 启动不了：{error}', { name: exe, error: e.message })))))
    child.on('close', (code) =>
      finish(() => {
        onLine(buf)
        if (r.signal.aborted) return reject(tagSession(aborted(), session))
        const why = stderr.trim().split('\n').slice(-3).join(' ')
        const reason = error === 'error_max_turns' ? t('步数到了上限') : error
        if (error) return reject(tagSession(new Error(why ? t('Claude Code 没答完：{reason}（{why}）', { reason, why }) : t('Claude Code 没答完：{reason}', { reason })), session))
        if (result === null && !text) {
          return reject(tagSession(new Error(code ? (why ? t('Claude Code 退出了（{code}）：{why}', { code, why }) : t('Claude Code 退出了（{code}）', { code })) : t('Claude Code 没有回答。确认这台 Mac 上的 Claude Code 已经登录（终端里运行 claude）。')), session))
        }
        if (!streamed && result) r.onText(result)
        resolve({ text: streamed ? text.trim() : (result ?? ''), session })
      }),
    )
    // 进程一启动就退出时写不进去（EPIPE）；为什么退出由上面的 close 报
    child.stdin!.on('error', () => undefined)
    child.stdin!.end(prompt)
  })
}

/** command、prefix 只在测试里给（假的 claude） */
export function claudeEngine(command?: string, prefix: string[] = []): Engine {
  return {
    id: 'claude',
    label: LABELS.claude,
    async run(r) {
      const exe = command ?? need('claude')
      const once = async (resume: string | undefined): Promise<EngineOutcome> => {
        const config = r.mcp ? mcpConfigFile(r.mcp) : null
        try {
          const text = withHistory(r, !resume)
          return await runClaude(exe, [...prefix, ...claudeArgs(r, resume, config?.path)], r.images?.length ? claudeImageMessage(text, r.images) : text, r)
        } finally {
          config?.remove()
        }
      }
      if (!r.session) return once(undefined)
      try {
        return await once(r.session)
      } catch (e) {
        // 会话找不到了（清过 ~/.claude）：从头开一个，补上最近几轮
        if (r.signal.aborted || !/No conversation found|session|conversation/i.test(String((e as Error).message))) throw e
        return once(undefined)
      }
    },
  }
}

// ---------------------------------------------------------------- Codex

/**
 * 全能模式关着时 Codex 自带的这几样关掉（app-server 进程的 -c；codex 0.163.0 的 `codex features list` 核过，不认识的键 Codex 只警告、照样起来）：
 * 跑命令（shell_tool）、上网搜（web_search）、ChatGPT 的 apps 连接器、浏览器和电脑操作、子 Agent。沙箱另外是只读的
 */
export const CODEX_LOCKED = [
  '-c', 'features.shell_tool=false',
  '-c', 'web_search="disabled"',
  '-c', 'features.apps=false',
  '-c', 'features.browser_use=false',
  '-c', 'features.in_app_browser=false',
  '-c', 'features.computer_use=false',
  '-c', 'features.multi_agent=false',
]

/**
 * app-server 的 thread/start、resume、fork 一起带的：全能模式 danger-full-access + 上网搜 live；关着只读沙箱、上网搜关掉
 * （线程上也写一遍：全能模式里开的线程换到关着时接着用，不带着 live）。都不问人（approval never）
 */
function codexThreadOpts(r: EngineRun) {
  return r.omni
    ? { cwd: r.cwd, sandbox: 'danger-full-access', approvalPolicy: 'never', config: { web_search: 'live' }, developerInstructions: r.system }
    : { cwd: r.cwd, sandbox: 'read-only', approvalPolicy: 'never', config: { web_search: 'disabled' }, developerInstructions: r.system }
}

/** app-server 的一条（item/started、item/completed 里的 item）换成一步；我们 MCP 的、不是动手的（说话、想）不算 */
export function codexStep(item: Record<string, unknown> | undefined, done: boolean): EngineStep | null {
  if (!item || typeof item.id !== 'string') return null
  const st = typeof item.status === 'string' ? item.status : done ? 'completed' : 'inProgress'
  const status = !done ? 'run' : st === 'failed' || st === 'declined' ? 'err' : 'ok'
  const base = { id: item.id, status } as const
  switch (item.type) {
    case 'commandExecution': {
      const command = Array.isArray(item.command) ? item.command.join(' ') : String(item.command ?? '')
      const code = typeof item.exitCode === 'number' ? item.exitCode : 0
      if (done && status === 'ok' && code !== 0) return { ...base, status: 'err', tool: 'Bash', input: { command }, detail: t('退出码 {n}', { n: code }) }
      return { ...base, tool: 'Bash', input: { command }, ...(status === 'err' ? { detail: st === 'declined' ? t('没放行') : t('没跑成') } : {}) }
    }
    case 'fileChange': {
      const changes = (Array.isArray(item.changes) ? item.changes : []) as { path?: string; kind?: { type?: string } }[]
      const first = changes[0]
      const tool = first?.kind?.type === 'add' ? 'Write' : first?.kind?.type === 'delete' ? 'Delete' : 'Edit'
      // 一次改好几个文件：步骤行写第一个，paths 是全部（这一轮结束时分清哪些是 AI 改的）
      const paths = changes.flatMap((c) => (typeof c.path === 'string' && c.path ? [c.path] : []))
      return { ...base, tool, input: { file_path: first?.path ?? '', ...(paths.length > 1 ? { paths } : {}) }, ...(status === 'err' ? { detail: st === 'declined' ? t('没放行') : t('没改成') } : {}) }
    }
    case 'webSearch':
      return { ...base, tool: 'WebSearch', input: { query: String(item.query ?? '') } }
    case 'mcpToolCall':
      if (item.server === MCP_NAME) return null
      return { ...base, tool: 'Mcp', input: { server: String(item.server ?? ''), tool: String(item.tool ?? '') } }
    case 'collabAgentToolCall':
      return { ...base, tool: 'Task', input: { description: String(item.prompt ?? '') } }
    case 'imageView':
      return { ...base, tool: 'Read', input: { file_path: String(item.path ?? '') } }
    default:
      return null
  }
}

/** command 只在测试里给（假的 app-server） */
export function codexEngine(command?: string, prefix: string[] = []): Engine {
  let proc: RpcProcess | null = null
  let starting: Promise<RpcProcess> | null = null
  let mcpKey = ''
  const live = new Set<string>()

  async function ensure(cwd: string, mcp: EngineRun['mcp'], omni: boolean): Promise<RpcProcess> {
    // 全能模式开关换了：进程按新参数重起（关掉的功能是进程级的）；线程在磁盘上，接着 thread/resume
    const key = `${mcp ? `${mcp.url} ${mcp.token}` : ''}|${omni ? 'omni' : 'locked'}`
    const sameMode = mcpKey.endsWith(`|${omni ? 'omni' : 'locked'}`)
    // 只聊天（不给 MCP）时，同一种模式下已经开着的进程直接用
    if (proc && !proc.closed && (key === mcpKey || (!mcp && sameMode))) return proc
    if (starting && key === mcpKey && !proc?.closed) return starting
    proc?.close()
    proc = null
    live.clear()
    mcpKey = key
    starting = (async () => {
      // 只接我们的 MCP（不带用户自己配的那些）；我们的工具不用再批（approvalPolicy=never 时要批的会被直接拒掉）
      const servers = mcp
        ? `mcp_servers={${MCP_NAME}={url="${mcp.url}",bearer_token_env_var="CN_MCP_TOKEN",default_tools_approval_mode="approve"}}`
        : 'mcp_servers={}'
      const args = [...prefix, 'app-server', '-c', servers, ...(omni ? [] : CODEX_LOCKED)]
      if (process.env.CN_CODEX_MODEL) args.push('-c', `model="${process.env.CN_CODEX_MODEL}"`)
      const p = new RpcProcess(command ?? need('codex'), args, { cwd, env: cliEnv(mcp ? { CN_MCP_TOKEN: mcp.token } : {}) }, false)
      p.onRequest(async (method, params) => {
        // 我们的工具不用再问；Codex 自己要写文件、跑命令：全能模式放行，关着一律不许
        if (method === 'mcpServer/elicitation/request') return params.serverName === MCP_NAME || omni ? { action: 'accept', content: {}, _meta: null } : { action: 'decline', content: null, _meta: null }
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: omni ? 'accept' : 'decline' }
        if (method === 'execCommandApproval' || method === 'applyPatchApproval') return { decision: omni ? 'approved' : 'denied' }
        throw new Error(`不支持 ${method}`) // 不翻：回给 AI 进程的协议错误
      })
      await p.request('initialize', { clientInfo: { name: APP.name, title: APP.name, version: APP.version }, capabilities: null })
      p.notify('initialized', undefined)
      proc = p
      void p.exited.then(() => (starting = null))
      return p
    })().catch((e) => {
      starting = null
      throw e
    })
    return starting
  }

  return {
    id: 'codex',
    label: LABELS.codex,
    dispose: () => proc?.close(),
    async run(r) {
      const p = await ensure(r.cwd, r.mcp, !!r.omni)
      const opts = codexThreadOpts(r)
      let threadId: string | undefined
      let fresh = false
      if (r.fork && r.session) {
        // 旁支：从主对话的线程整段分叉出一个新线程（找不到那个线程就开新的，补上那一轮）
        threadId = await p
          .request<{ thread: { id: string } }>('thread/fork', { threadId: r.session, ...opts })
          .then((x) => x.thread.id)
          .catch(() => undefined)
      } else {
        threadId = r.session && live.has(r.session) ? r.session : undefined
        if (!threadId && r.session) {
          threadId = await p
            .request<{ thread: { id: string } }>('thread/resume', { threadId: r.session, ...opts })
            .then((x) => x.thread.id)
            .catch(() => undefined)
        }
      }
      if (!threadId) {
        const t = await p.request<{ thread: { id: string } }>('thread/start', opts)
        threadId = t.thread.id
        fresh = true
      }
      live.add(threadId)
      let text = ''
      let turnId: string | null = null
      const done = new Promise<void>((resolve, reject) => {
        const off = p.onNotification((method, params) => {
          if (params.threadId !== threadId) return
          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
            text += params.delta
            r.onText(params.delta)
          } else if (method === 'item/started' && (params.item as { type?: string })?.type === 'agentMessage' && text && !text.endsWith('\n\n')) {
            text += '\n\n'
            r.onText('\n\n')
          } else if ((method === 'item/started' || method === 'item/completed') && r.onStep) {
            const step = codexStep(params.item as Record<string, unknown> | undefined, method === 'item/completed')
            if (step) r.onStep(step)
          } else if (method === 'error' && !params.willRetry) {
            off()
            reject(new Error(t('Codex 出错了：{error}', { error: (params.error as { message?: string })?.message ?? t('不知道为什么') })))
          } else if (method === 'turn/completed') {
            off()
            const turn = params.turn as { status?: string; error?: { message?: string } | null }
            if (turn.status === 'failed') reject(new Error(t('Codex 没答完：{error}', { error: turn.error?.message ?? '' })))
            else resolve()
          }
        })
        void p.exited.then(() => {
          off()
          reject(new Error(t('Codex 退出了：{error}', { error: p.lastError.split('\n').slice(-2).join(' ') })))
        })
      })
      const stop = () => turnId && void p.request('turn/interrupt', { threadId, turnId }).catch(() => undefined)
      r.signal.addEventListener('abort', stop)
      try {
        const input: unknown[] = [{ type: 'text', text: withHistory(r, fresh), text_elements: [] }, ...(r.images ?? []).map((i) => ({ type: 'localImage', path: i.path }))]
        // 模型、effort 只管这一问（turn/start 的覆盖也管这个线程后面几问，所以每问都带上选的）
        const t = await p.request<{ turn: { id: string } }>('turn/start', { threadId, input, ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}) })
        turnId = t.turn.id
        if (r.signal.aborted) stop()
        await done
      } catch (e) {
        throw tagSession(e as Error, threadId)
      } finally {
        r.signal.removeEventListener('abort', stop)
      }
      if (r.signal.aborted) throw tagSession(aborted(), threadId)
      return { text: text.trim(), session: threadId }
    },
  }
}

/** model/list 里用得到的几样（codex 0.163.0 的 `codex app-server generate-ts` 核过） */
interface CodexModel {
  model?: unknown
  displayName?: unknown
  hidden?: unknown
  isDefault?: unknown
  defaultReasoningEffort?: unknown
  supportedReasoningEfforts?: { reasoningEffort?: unknown }[]
}

/**
 * Codex 有哪些模型（CN-91）：另起一个 app-server 问 model/list（翻页取全，藏起来的不要），每个模型带它认的几档 effort 和默认档，默认的那个排第一。
 * 问不到就报错，调用的地方退回只有「Codex 默认模型」一项。command、prefix 只在测试里给（假的 app-server）
 */
export async function codexModelList(command?: string, prefix: string[] = []): Promise<ModelOption[]> {
  const p = new RpcProcess(command ?? need('codex'), [...prefix, 'app-server', '-c', 'mcp_servers={}'], { cwd: homedir(), env: cliEnv() }, false)
  try {
    await p.request('initialize', { clientInfo: { name: APP.name, title: APP.name, version: APP.version }, capabilities: null }, 15_000)
    p.notify('initialized', undefined)
    const all: CodexModel[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const r: { data?: unknown; nextCursor?: unknown } = await p.request('model/list', { includeHidden: false, ...(cursor ? { cursor } : {}) }, 15_000)
      if (Array.isArray(r.data)) all.push(...(r.data as CodexModel[]))
      cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null
      if (!cursor) break
    }
    return all
      .filter((m) => typeof m.model === 'string' && m.model && m.hidden !== true)
      .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true))
      .map((m) => ({
        id: m.model as string,
        label: typeof m.displayName === 'string' && m.displayName ? m.displayName : (m.model as string),
        efforts: (m.supportedReasoningEfforts ?? []).flatMap((e) => (typeof e?.reasoningEffort === 'string' ? [effortOption(e.reasoningEffort)] : [])),
        ...(typeof m.defaultReasoningEffort === 'string' ? { defaultEffort: m.defaultReasoningEffort } : {}),
      }))
  } finally {
    p.close()
  }
}

// ---------------------------------------------------------------- ACP（Gemini、OpenCode）

interface AcpOptions {
  id: 'gemini' | 'opencode'
  /** 出错时说的名字（软件自带的 OpenCode 替一把 Key 跑时写「Claude API」，task-587os）；不给是这家命令行的名字 */
  label?: string
  /** 开进程前先看看登录了没有；没登录返回 false，免得等它超时 */
  loggedIn?(): boolean
  /** 只在测试里给（假的 ACP 程序） */
  command?: string
  /** omni：全能模式开着（批准方式、权限设置是进程级的，开关换了进程重起） */
  args(cwd: string, omni: boolean): string[]
  env?(omni: boolean): Record<string, string>
  /** 进程退出以后收拾（删掉给它的策略文件） */
  cleanup?(): void
  /** 会话开不了时的说法（多半是没登录） */
  loginHint: string
}

/** 我们 MCP 工具的名字（ACP 的权限请求、步骤里认出是我们的） */
const OURS = /canvas|board_|web_|doc_|note_|notes_list|folder_/

/** ACP 的 tool_call 换成一步（kind 照 ACP 规范：read、edit、delete、move、search、execute、think、fetch、other）；我们 MCP 的、想的那几步不算 */
export function acpStep(u: { toolCallId?: string; title?: string; kind?: string; rawInput?: unknown; locations?: { path?: string }[] }): Omit<EngineStep, 'status'> | null {
  if (!u.toolCallId || u.kind === 'think' || OURS.test(u.title ?? '')) return null
  const raw = (u.rawInput && typeof u.rawInput === 'object' ? u.rawInput : {}) as Record<string, unknown>
  const str = (...v: unknown[]) => String(v.find((x) => typeof x === 'string' && x) ?? '')
  const path = str(u.locations?.[0]?.path, raw.file_path, raw.filePath, raw.path, raw.absolute_path)
  const all = (u.locations ?? []).flatMap((l) => (typeof l.path === 'string' && l.path ? [l.path] : []))
  const paths = all.length > 1 ? { paths: all } : {}
  const id = u.toolCallId
  switch (u.kind) {
    case 'execute':
      return { id, tool: 'Bash', input: { command: str(raw.command, u.title) } }
    case 'read':
      return { id, tool: 'Read', input: { file_path: path || str(u.title) } }
    case 'edit':
      return { id, tool: 'Edit', input: { file_path: path || str(u.title), ...paths } }
    case 'delete':
      return { id, tool: 'Delete', input: { file_path: path || str(u.title), ...paths } }
    case 'move':
      // 挪到哪没写在这里：说不清碰了哪些文件，结束时当成跑过命令
      return { id, tool: 'Move', input: { file_path: path || str(u.title), ...paths } }
    case 'search':
      return raw.query && !raw.pattern ? { id, tool: 'WebSearch', input: { query: str(raw.query) } } : { id, tool: 'Grep', input: { pattern: str(raw.pattern, raw.query, u.title) } }
    case 'fetch':
      return { id, tool: 'WebFetch', input: { url: str(raw.url, raw.prompt, u.title) } }
    default:
      return { id, tool: str(u.title) || 'other', input: {} }
  }
}

/**
 * 一个 ACP 会话怎么换模型、effort（task-m55m7）：会话开的时候 session/new 回的。
 * 新写法 configOptions（ACP 的 Session Config Options，agentclientprotocol.com/protocol/v1/session-config-options；OpenCode）：
 * 类别 model、thought_level 的那两项，用 session/set_config_option 换；旧写法 models（Gemini CLI 还在用）用 session/set_model 换。
 * 都没有的换不了。first 是开的时候的（选回「默认模型」时换回它），now 是现在的
 */
interface AcpModelState {
  via: 'config' | 'models' | null
  modelOpt?: string
  effortOpt?: string
  efforts: string[]
  first: { model?: string; effort?: string }
  now: { model?: string; effort?: string }
}

type ConfigOption = { id?: unknown; category?: unknown; currentValue?: unknown; options?: unknown }

/** session/new、set_config_option 回的 configOptions 读成模型、effort 那两项 */
function readConfig(list: unknown): { modelOpt?: string; model?: string; effortOpt?: string; effort?: string; efforts: string[] } {
  const opts = Array.isArray(list) ? (list as ConfigOption[]) : []
  const m = opts.find((x) => x?.category === 'model')
  const e = opts.find((x) => x?.category === 'thought_level')
  const values = (x: ConfigOption | undefined) => (Array.isArray(x?.options) ? (x.options as { value?: unknown }[]).flatMap((v) => (typeof v?.value === 'string' ? [v.value] : [])) : [])
  return {
    ...(typeof m?.id === 'string' ? { modelOpt: m.id } : {}),
    ...(typeof m?.currentValue === 'string' ? { model: m.currentValue } : {}),
    ...(typeof e?.id === 'string' ? { effortOpt: e.id } : {}),
    ...(typeof e?.currentValue === 'string' ? { effort: e.currentValue } : {}),
    efforts: values(e),
  }
}

export function acpModelState(r: { configOptions?: unknown; models?: unknown }): AcpModelState {
  if (Array.isArray(r.configOptions)) {
    const c = readConfig(r.configOptions)
    const at = { ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) }
    return { via: c.modelOpt ? 'config' : null, ...(c.modelOpt ? { modelOpt: c.modelOpt } : {}), ...(c.effortOpt ? { effortOpt: c.effortOpt } : {}), efforts: c.efforts, first: at, now: { ...at } }
  }
  const cur = (r.models as { currentModelId?: unknown } | undefined)?.currentModelId
  const at = typeof cur === 'string' ? { model: cur } : {}
  return { via: r.models ? 'models' : null, efforts: [], first: at, now: { ...at } }
}

export function acpEngine(o: AcpOptions): Engine {
  const label = o.label ?? LABELS[o.id]
  let proc: RpcProcess | null = null
  let ready: Promise<RpcProcess> | null = null
  /** 现在这个进程是哪种模式起的 */
  let procOmni = false
  const live = new Set<string>()
  /** 每个会话的模型、effort 现在是什么、怎么换 */
  const modelStates = new Map<string, AcpModelState>()

  /** 这一问要的模型、effort 和会话现在的不一样就换（没选的换回开会话时的）；换不了的说清楚 */
  async function applyModel(p: RpcProcess, sessionId: string, r: EngineRun) {
    const st = modelStates.get(sessionId)
    if (!st?.via) return
    const want = r.model || st.first.model
    if (want && want !== st.now.model) {
      try {
        if (st.via === 'config') {
          const res = await p.request<{ configOptions?: unknown }>('session/set_config_option', { sessionId, configId: st.modelOpt, value: want })
          const c = readConfig(res?.configOptions)
          st.effortOpt = c.effortOpt
          st.efforts = c.efforts
          st.now = { model: c.model ?? want, ...(c.effort ? { effort: c.effort } : {}) }
          // 换了模型，它这个模型开的时候的那一档就是「默认档」
          st.first = { ...st.first, ...(c.effort ? { effort: c.effort } : {}) }
        } else {
          await p.request('session/set_model', { sessionId, modelId: want })
          st.now = { model: want }
        }
      } catch (e) {
        throw new Error(t('{name} 换不成模型 {model}：{error}', { name: label, model: want, error: (e as Error).message }))
      }
    }
    if (st.via !== 'config' || !st.effortOpt) return
    const effort = r.effort && st.efforts.includes(r.effort) ? r.effort : st.first.effort
    if (!effort || effort === st.now.effort) return
    await p.request('session/set_config_option', { sessionId, configId: st.effortOpt, value: effort }).catch((e) => {
      throw new Error(t('{name} 换不成这一档 {effort}：{error}', { name: label, effort, error: (e as Error).message }))
    })
    st.now = { ...st.now, effort }
  }
  /** 每个会话现在这一轮把字交给谁 */
  const sinks = new Map<string, (delta: string) => void>()
  /** 每个会话现在这一轮的步骤交给谁 */
  const stepSinks = new Map<string, (u: Record<string, unknown>) => void>()

  async function ensure(cwd: string, omni: boolean): Promise<RpcProcess> {
    if (proc && !proc.closed && procOmni === omni) return proc
    if (ready && !proc?.closed && procOmni === omni) return ready
    // 全能模式开关换了：按新参数重起（会话跟着进程没了，下一问开新会话、补上最近几轮）
    proc?.close()
    proc = null
    live.clear()
    modelStates.clear()
    procOmni = omni
    ready = (async () => {
      const p = new RpcProcess(o.command ?? need(o.id), o.args(cwd, omni), { cwd, env: cliEnv(o.env?.(omni) ?? {}) })
      void p.exited.then(() => o.cleanup?.())
      p.onNotification((method, params) => {
        if (method !== 'session/update') return
        const u = params.update as { sessionUpdate?: string; content?: { type?: string; text?: string } }
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && u.content.text) sinks.get(String(params.sessionId))?.(u.content.text)
        else if (u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update') stepSinks.get(String(params.sessionId))?.(u as Record<string, unknown>)
      })
      p.onRequest(async (method, params) => {
        if (method !== 'session/request_permission') throw new Error(`不支持 ${method}`) // 不翻：回给 AI 进程的协议错误
        const call = params.toolCall as { title?: string; kind?: string; rawInput?: unknown } | undefined
        const options = (params.options ?? []) as { optionId: string; kind: string }[]
        // 我们的工具放行；AI 自己改文件、跑命令：全能模式放行，关着一律拒绝
        const allow = omni || OURS.test(`${call?.title ?? ''}`)
        const pick = options.find((x) => x.kind === (allow ? 'allow_once' : 'reject_once')) ?? options.find((x) => x.kind.startsWith(allow ? 'allow' : 'reject'))
        return pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } }
      })
      await p.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: APP.name, version: APP.version },
      })
      proc = p
      void p.exited.then(() => (ready = null))
      return p
    })().catch((e) => {
      ready = null
      throw e
    })
    return ready
  }

  return {
    id: o.id,
    label,
    dispose: () => proc?.close(),
    async run(r) {
      if (o.loggedIn && !o.loggedIn()) throw new Error(o.loginHint)
      const p = await ensure(r.cwd, !!r.omni)
      // 旁支：ACP 没有分叉，开新会话（history 是那一轮的问答，放在第一问前面）
      let sessionId = r.session && live.has(r.session) && !r.fork ? r.session : undefined
      const fresh = !sessionId
      if (!sessionId) {
        const mcpServers = r.mcp ? [{ type: 'http', name: MCP_NAME, url: r.mcp.url, headers: [{ name: 'Authorization', value: `Bearer ${r.mcp.token}` }] }] : []
        try {
          const res = await p.request<{ sessionId: string; configOptions?: unknown; models?: unknown }>('session/new', { cwd: r.cwd, mcpServers }, 120_000)
          sessionId = res.sessionId
          modelStates.set(sessionId, acpModelState(res))
        } catch (e) {
          const msg = String((e as Error).message)
          throw new Error(/auth|key|login|credential|登录/i.test(msg) ? `${o.loginHint}（${msg}）` : msg)
        }
        live.add(sessionId)
      }
      // 这一问选的模型、effort（task-m55m7）：和会话现在的不一样就先换
      await applyModel(p, sessionId, r).catch((e) => {
        throw tagSession(e as Error, sessionId)
      })
      let text = ''
      sinks.set(sessionId, (d) => {
        text += d
        r.onText(d)
      })
      // 步骤：tool_call 是开始（我们 MCP 的、想的那几步不报），tool_call_update 报做完、出错
      const steps = new Map<string, Omit<EngineStep, 'status'>>()
      const onStep = r.onStep
      if (onStep)
        stepSinks.set(sessionId, (u) => {
          const id = String(u.toolCallId ?? '')
          const status = String(u.status ?? '')
          if (u.sessionUpdate === 'tool_call') {
            const step = acpStep(u as Parameters<typeof acpStep>[0])
            if (!step) return
            steps.set(id, step)
            onStep({ ...step, status: 'run' })
          }
          const step = steps.get(id)
          if (!step || (status !== 'completed' && status !== 'failed')) return
          steps.delete(id)
          const said = Array.isArray(u.content) ? (u.content as { content?: { text?: unknown } }[]).map((c) => (typeof c.content?.text === 'string' ? c.content.text : '')).join('\n') : ''
          onStep({ ...step, status: status === 'failed' ? 'err' : 'ok', ...(status === 'failed' ? { detail: firstLine(said) || t('没做成') } : {}) })
        })
      const stop = () => p.notify('session/cancel', { sessionId })
      r.signal.addEventListener('abort', stop)
      try {
        // ACP 没有单独的系统提示，开新会话时放在第一段话前面
        const prompt = fresh ? `${r.system}\n\n---\n\n${withHistory(r, true)}` : r.prompt
        const images = (r.images ?? []).map((i) => ({ type: 'image', mimeType: i.mime, data: i.data }))
        const res = await p.request<{ stopReason?: string }>('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }, ...images] }, 0)
        if (res.stopReason === 'refusal') throw new Error(t('{name} 拒绝回答', { name: label }))
      } catch (e) {
        throw tagSession(e as Error, sessionId)
      } finally {
        r.signal.removeEventListener('abort', stop)
        sinks.delete(sessionId)
        stepSinks.delete(sessionId)
      }
      if (r.signal.aborted) throw tagSession(aborted(), sessionId)
      return { text: text.trim(), session: sessionId }
    },
  }
}

/**
 * 全能模式关着时给 Gemini 的策略文件（gemini --policy，0.64.0 核过，写法见 geminicli.com 的 Policy engine）：跑命令、写文件、改文件、
 * 上网、子 Agent 一律拒绝，被拒的工具不进它的工具单（读、搜库里的文件照样能用，Gemini 的文件工具只认工作目录，也就是库）
 */
// 不翻：交给 Gemini 的规则（给 AI 的话）
export const GEMINI_POLICY = `[[rule]]
toolName = ["run_shell_command", "write_file", "replace", "web_fetch", "google_web_search", "invoke_agent"]
decision = "deny"
priority = 900
denyMessage = "全能模式关着：只能用 canvas 这组工具在库里动手。要更多请用户在 AI 输入框下面打开「全能模式」"
`

/**
 * gemini --acp 的参数（gemini --help，0.64.0 核过）：MCP 只接我们的。全能模式 --approval-mode yolo（所有工具不问就用，同 --yolo）；
 * 关着 default（要批的来问我们、我们拒绝）再加上面的策略文件
 */
export function geminiArgs(omni: boolean, policy: string): string[] {
  return ['--acp', '--approval-mode', omni ? 'yolo' : 'default', '--allowed-mcp-server-names', MCP_NAME, ...(omni ? [] : ['--policy', policy])]
}

/**
 * OpenCode 的权限（OPENCODE_CONFIG_CONTENT，opencode 1.19.3 的 `opencode debug agent build` 核过）：全能模式「*」都放行；
 * 关着改文件、跑命令、上网、碰库外、开子 Agent 都拒（用户自己配的 webfetch、external_directory 放行排在前面，后写的赢）
 */
export function opencodeConfig(omni: boolean): string {
  return JSON.stringify(omni ? { permission: { '*': 'allow' } } : { permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny', external_directory: 'deny', task: 'deny' } })
}

/** 关着时给 Gemini 的策略文件：起进程时写进临时文件夹，进程退出就删 */
let geminiPolicyDir: string | null = null
function geminiPolicyFile(): string {
  geminiPolicyDir ??= mkdtempSync(join(tmpdir(), 'cn-gemini-'))
  const path = join(geminiPolicyDir, 'policy.toml')
  writeFileSync(path, GEMINI_POLICY)
  return path
}

export const geminiEngine = () =>
  acpEngine({
    id: 'gemini',
    // 只接我们的 MCP；全能模式不问就用；关着 AI 想改文件、跑命令会来问，我们拒绝（策略文件先把它们拿掉）
    args: (_cwd, omni) => geminiArgs(omni, omni ? '' : geminiPolicyFile()),
    cleanup: () => {
      if (geminiPolicyDir) rmSync(geminiPolicyDir, { recursive: true, force: true })
      geminiPolicyDir = null
    },
    // 用到时才取（跟界面语言）
    get loginHint() {
      return t('Gemini 还没登录：在终端里运行一次 gemini，选「Log in with Google」，或者设好 GEMINI_API_KEY')
    },
    // 没登录时 gemini --acp 要等一分钟才报错，先看有没有登录凭据
    loggedIn: () => geminiLoggedIn(),
  })

/** Gemini 有没有登录凭据（只看有没有，不读内容）：没登录时 gemini --acp 开会话要等一分钟才报错，拉模型、问之前先看这个 */
export function geminiLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_USE_VERTEXAI || env.GOOGLE_CLOUD_PROJECT) return true
  const dir = join(env.HOME || homedir(), '.gemini')
  if (existsSync(join(dir, 'oauth_creds.json'))) return true
  try {
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { security?: { auth?: { selectedType?: string } }; selectedAuthType?: string }
    return !!(settings.security?.auth?.selectedType || settings.selectedAuthType)
  } catch {
    return false
  }
}

export const opencodeEngine = () =>
  acpEngine({
    id: 'opencode',
    args: (cwd) => ['acp', '--cwd', cwd],
    // 全能模式都放行；关着 OpenCode 自己改文件、跑命令、上网一律不许，改笔记走我们的工具
    env: (omni) => ({ OPENCODE_CONFIG_CONTENT: opencodeConfig(omni) }),
    get loginHint() {
      return t('OpenCode 还没登录：在终端里运行 opencode auth login')
    },
  })
