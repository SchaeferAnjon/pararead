// task-m55m7：模型从命令行拉、版本变了自查、新版本和更新。各家命令行都是假的（test/fixtures/fake-cli.mjs、fake-acp.mjs），不联网、不花钱
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { effortOption, modelsOf, pickLabel } from '../src/shared'
import { compareVersions, healthText, isNewer, parseVersion, problemText, pulledText, stateOf, whenText } from '../src/shared'
import { checkEngine, claudeParseError, withoutFlag } from '../src/engine-check'
import { acpModelOptions, claudeModelOptions, claudeModels, opencodeModels, parseOpencodeModels } from '../src/engine-models'
import { latestUrl, updatePlan } from '../src/engine-update'
import { acpEngine, acpModelState } from '../src/engines'

const base = mkdtempSync(join(tmpdir(), 'cn-engwatch-'))
const state = join(base, 'state')
mkdirSync(state)
process.env.FAKE_CLI_STATE = state
afterAll(() => rmSync(base, { recursive: true, force: true }))

const fixture = (name: string) => join(__dirname, 'fixtures', name)
/** 一个假命令行：sh 包一层 node fake-cli.mjs <家> */
function fakeCli(name: 'claude' | 'codex' | 'gemini' | 'opencode', st: object = {}) {
  const p = join(base, 'bin', name)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${fixture('fake-cli.mjs')}" ${name} "$@"\n`)
  chmodSync(p, 0o755)
  writeFileSync(join(state, `${name}.json`), JSON.stringify(st))
  return p
}

describe('版本和自查怎么说（shared/engine-health.ts）', () => {
  it('从 --version 的原话读版本号；比新旧（预发布比正式版旧）', () => {
    expect(parseVersion('2.1.330 (Claude Code)')).toBe('2.1.330')
    expect(parseVersion('codex-cli 0.163.0')).toBe('0.163.0')
    expect(parseVersion('0.71.0-preview.0')).toBe('0.71.0-preview.0')
    expect(parseVersion('没有版本')).toBeNull()
    expect(compareVersions('2.1.330', '2.1.323')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0)
    expect(isNewer('9.9.1', '9.9.0')).toBe(true)
    expect(isNewer('9.9.0', '9.9.0')).toBe(false)
    expect(isNewer(undefined, '9.9.0')).toBe(false)
  })

  it('问题说成一句：一个参数、几个参数、值、接口；只影响 AI 对话的说 AI 对话，都影响的说用到它的都可能出错；只是关不掉的不算不能用', () => {
    expect(problemText([{ kind: 'flag', what: '--mcp-config', scope: 'chat' }])).toBe('有一个参数不认了：--mcp-config，AI 对话可能出错')
    expect(problemText([{ kind: 'flag', what: '--a', scope: 'chat' }, { kind: 'flag', what: '--b', scope: 'quick' }])).toBe('有2个参数不认了：--a、--b，用到它的都可能出错')
    expect(problemText([{ kind: 'value', what: '--permission-mode bypassPermissions', scope: 'chat' }])).toBe('参数的值不认了：--permission-mode bypassPermissions，AI 对话可能出错')
    expect(problemText([{ kind: 'method', what: 'thread/start', scope: 'all' }])).toBe('接口变了：thread/start 没有了，用到它的都可能出错')
    expect(problemText([{ kind: 'feature', what: 'features.apps', scope: 'chat' }])).toBe('全能模式关着时关不掉：features.apps')
    expect(stateOf([{ kind: 'feature', what: 'x', scope: 'chat' }])).toBe('warn')
    expect(stateOf([])).toBe('ok')
    expect(healthText({ version: '2.1.330', state: 'ok', problems: [], at: 0 })).toBe('2.1.330 · 能用')
    expect(healthText({ version: '2.2.0', state: 'bad', problems: [{ kind: 'flag', what: '--xxx', scope: 'chat' }], at: 0 })).toBe('2.2.0 · 有一个参数不认了：--xxx，AI 对话可能出错')
    expect(healthText({ version: '2.2.0', state: 'unknown', problems: [], note: '空着输入试参数，20 秒没反应', at: 0 })).toBe('2.2.0 · 没查成：空着输入试参数，20 秒没反应')
  })

  it('模型什么时候拉的：这次打开以后拉的是「刚拉的」；以前的写「上次拉的 日期 时间」，这次没拉到说为什么；一次没拉到是自带的', () => {
    const now = new Date(2026, 10, 21, 16, 2).getTime()
    const since = now - 60_000
    expect(pulledText({ at: now - 1000, since, now })).toBe('刚拉的')
    expect(pulledText({ at: new Date(2026, 10, 20, 9, 14).getTime(), since, now })).toBe('上次拉的 11-20 09:14')
    expect(pulledText({ at: new Date(2026, 10, 21, 9, 14).getTime(), err: '没网', since, now })).toBe('上次拉的 今天 09:14，这次没拉到（没网）')
    expect(pulledText({ since, now })).toBe('自带的几个，还没拉')
    expect(pulledText({ err: 'Gemini 没登录', since, now })).toBe('没拉到（Gemini 没登录），用的是自带的几个')
    expect(whenText(new Date(2026, 0, 3, 7, 5).getTime(), now)).toBe('01-03 07:05')
  })
})

describe('拉模型（engine-models.ts）', () => {
  it('Claude Code：控制请求 initialize 报的模型，default 不要，别名记着实际型号，具体型号归一组；回答头上用拉到的名字', async () => {
    const exe = fakeCli('claude')
    const { models, version } = await claudeModels(exe)
    expect(version).toBe('2.1.330')
    expect(models.map((m) => [m.id, m.label, m.resolved, m.efforts.map((e) => e.id).join(',')])).toEqual([
      ['opus', 'Opus 9', 'claude-opus-9', 'low,medium,high,xhigh,max'],
      ['sonnet', 'Sonnet 9', 'claude-sonnet-9', 'low,medium,high,xhigh,max'],
      ['haiku', 'Haiku 9', 'claude-haiku-9', 'low,medium,high'],
    ])
    const list = modelsOf('claude', models)
    expect(pickLabel({ engine: 'claude', model: 'sonnet', effort: 'low' }, list)).toBe('Claude Code · Sonnet 9 · Low')
    // 存着的是实际型号也认得出（设置里存的 claude-opus-9）
    expect(pickLabel({ engine: 'claude', model: 'claude-opus-9', effort: 'high' }, list)).toBe('Claude Code · Opus 9 · High')
    // 没拉到：自带的叫法
    expect(pickLabel({ engine: 'claude', model: 'sonnet', effort: 'low' })).toBe('Claude Code · Sonnet · Low')
    const raw = claudeModelOptions([{ value: 'default' }, { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', supportsEffort: false }, { value: 7 }])
    expect(raw).toEqual([{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [], group: '具体型号' }])
  })

  it('Claude Code 起不来、不回：说一句为什么', async () => {
    const bad = join(base, 'bin/broken-claude')
    writeFileSync(bad, '#!/bin/sh\necho "boom" >&2\nexit 3\n')
    chmodSync(bad, 0o755)
    await expect(claudeModels(bad)).rejects.toThrow('Claude Code 没报模型就退出了（3）：boom')
  })

  it('OpenCode：models --verbose 一行「服务商/模型」跟一段 JSON；名字用 name，按服务商分组，那几档是 variants（default 不算）', async () => {
    const out = [
      'zai/glm-5',
      JSON.stringify({ id: 'glm-5', providerID: 'zai', name: 'GLM-5', variants: { low: {}, high: {}, default: {} } }, null, 2),
      'opencode/big-pickle',
      JSON.stringify({ id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', variants: {} }, null, 2),
      'old/gone',
      JSON.stringify({ id: 'gone', providerID: 'old', name: 'Gone', status: 'deprecated' }, null, 2),
      'plain/model-only',
    ].join('\n')
    expect(parseOpencodeModels(out)).toEqual([
      { id: 'zai/glm-5', label: 'GLM-5', efforts: [effortOption('low'), effortOption('high')], group: 'zai' },
      { id: 'opencode/big-pickle', label: 'Big Pickle', efforts: [], group: 'opencode' },
      { id: 'plain/model-only', label: 'model-only', efforts: [], group: 'plain' },
    ])
    const exe = fakeCli('opencode', { models: [{ id: 'kimi-k3', providerID: 'kimi', name: 'Kimi K3', variants: { high: {} } }] })
    expect(await opencodeModels(exe)).toEqual([{ id: 'kimi/kimi-k3', label: 'Kimi K3', efforts: [effortOption('high')], group: 'kimi' }])
  })

  it('ACP 开会话回的模型：新写法 configOptions（OpenCode）、旧写法 models（Gemini），auto / default 不算一项', () => {
    expect(acpModelOptions({ configOptions: [{ id: 'model', category: 'model', options: [{ value: 'zai/glm-5', name: 'Z.AI/GLM-5' }, { value: 'default' }] }] })).toEqual([{ id: 'zai/glm-5', label: 'Z.AI/GLM-5', efforts: [] }])
    expect(acpModelOptions({ models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }, { modelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' }] } })).toEqual([{ id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro', efforts: [] }])
    expect(acpModelOptions({})).toEqual([])
  })
})

describe('ACP 引擎照选的换模型、effort（OpenCode 的 set_config_option、Gemini 的 set_model）', () => {
  const ask = (e: ReturnType<typeof acpEngine>, o: { model?: string; effort?: string; session?: string } = {}) =>
    e.run({ prompt: '你好', system: '系统', cwd: base, signal: new AbortController().signal, onText: () => undefined, ...o })

  it('OpenCode：开会话以后换成选的模型和那一档，同一个会话换回「默认模型」时换回开会话时的；这个模型没有那一档不传', async () => {
    process.env.FAKE_ACP_MODELS = 'config'
    const e = acpEngine({ id: 'opencode', command: process.execPath, args: () => [fixture('fake-acp.mjs')], loginHint: '去登录' })
    try {
      const a = await ask(e, { model: 'zai/glm-5', effort: 'high' })
      expect(a.text).toContain('；模型 zai/glm-5；effort high')
      const b = await ask(e, { model: 'opencode/big-pickle', effort: 'high', session: a.session! })
      expect(b.text).toContain('；模型 opencode/big-pickle；effort 没给')
      const c = await ask(e, { session: a.session! })
      expect(c.text).toContain('；模型 zai/glm-5；effort low')
      await expect(ask(e, { model: 'nope/x' })).rejects.toThrow('OpenCode 换不成模型 nope/x：Invalid params: model not found: nope/x')
    } finally {
      e.dispose?.()
      delete process.env.FAKE_ACP_MODELS
    }
  })

  it('Gemini：用 session/set_model 换', async () => {
    process.env.FAKE_ACP_MODELS = 'models'
    const e = acpEngine({ id: 'gemini', command: process.execPath, args: () => [fixture('fake-acp.mjs')], loginHint: '去登录' })
    try {
      expect((await ask(e, { model: 'gemini-3-flash-preview' })).text).toContain('；模型 gemini-3-flash-preview')
      expect((await ask(e)).text).toContain('；模型 auto')
    } finally {
      e.dispose?.()
      delete process.env.FAKE_ACP_MODELS
    }
  })

  it('会话怎么换模型从 session/new 回的认', () => {
    expect(acpModelState({ configOptions: [{ id: 'model', category: 'model', currentValue: 'a/b' }, { id: 'effort', category: 'thought_level', currentValue: 'low', options: [{ value: 'low' }, { value: 'high' }] }] })).toMatchObject({ via: 'config', modelOpt: 'model', effortOpt: 'effort', efforts: ['low', 'high'], first: { model: 'a/b', effort: 'low' } })
    expect(acpModelState({ models: { currentModelId: 'auto' } })).toMatchObject({ via: 'models', first: { model: 'auto' } })
    expect(acpModelState({})).toMatchObject({ via: null })
  })
})

describe('自查（engine-check.ts）', () => {
  it('commander 的原话认得出：不认的参数、值不在可选里；拿掉一个参数连着它的值', () => {
    expect(claudeParseError("error: unknown option '--mcp-config'")).toEqual({ flag: '--mcp-config' })
    expect(claudeParseError("error: option '--permission-mode <mode>' argument 'dontAsk' is invalid. Allowed choices are a, b.")).toEqual({ flag: '--permission-mode', value: 'dontAsk' })
    expect(claudeParseError('Error: Input must be provided either through stdin')).toBeNull()
    expect(withoutFlag(['-p', '--tools', '', '--setting-sources=', '--model', 'haiku', '--verbose'], '--tools')).toEqual(['-p', '--setting-sources=', '--model', 'haiku', '--verbose'])
    expect(withoutFlag(['--setting-sources=', '-p'], '--setting-sources')).toEqual(['-p'])
  })

  it('Claude Code 认我们用的参数：能用；不是核过的版本再真问一个字（假的），看 init、逐字、result 三样', async () => {
    const exe = fakeCli('claude', { version: '9.9.1' })
    expect(await checkEngine('claude', exe, { probe: false })).toEqual({ problems: [] })
    expect(await checkEngine('claude', exe, { probe: true })).toEqual({ problems: [], asked: true })
  })

  it('Claude Code 不认 --mcp-config（只在 AI 对话用）、--strict-mcp-config（哪都用）：都找出来，说清影响哪；值不认的也说', async () => {
    const exe = fakeCli('claude', { version: '9.9.0', unknown: ['--mcp-config', '--strict-mcp-config'] })
    const r = await checkEngine('claude', exe, { probe: true })
    expect(r.asked).toBeUndefined()
    // 一次只报第一个不认的（commander 照参数的顺序），拿掉再跑找下一个
    expect(r.problems).toEqual([
      { kind: 'flag', what: '--strict-mcp-config', scope: 'all' },
      { kind: 'flag', what: '--mcp-config', scope: 'chat' },
    ])
    expect(problemText(r.problems)).toBe('有2个参数不认了：--strict-mcp-config、--mcp-config，用到它的都可能出错')
  })

  it('Claude Code 真问一个字时只给整段、不逐字：说输出格式变了；问不成（没登录）不算不兼容', async () => {
    const exe = fakeCli('claude', { version: '9.9.2', noStream: true })
    expect((await checkEngine('claude', exe, { probe: true })).problems).toEqual([{ kind: 'format', what: '逐字输出（stream_event）', scope: 'all' }])
    const silent = fakeCli('claude', { version: '9.9.3', silent: true })
    const r = await checkEngine('claude', silent, { probe: true })
    expect(r.problems).toEqual([])
    expect(r.note).toMatch(/^真问一个字没问成/)
  })

  it('Codex：接口定义里少了 thread/fork、thread/start 的 sandbox，全能模式关着时要关的 apps 没了：分开说', async () => {
    const exe = fakeCli('codex', { missing: ['thread/fork', 'ThreadStartParams.sandbox', 'features.apps'] })
    const r = await checkEngine('codex', exe, { probe: false })
    expect(r.problems).toEqual([
      { kind: 'method', what: 'thread/fork', scope: 'chat' },
      { kind: 'method', what: 'thread/start.sandbox', scope: 'all' },
      { kind: 'feature', what: 'features.apps', scope: 'chat' },
    ])
    expect(await checkEngine('codex', fakeCli('codex'), { probe: false })).toEqual({ problems: [] })
  })

  it('Gemini：--help 里少了我们给的参数、ACP 握手协议版本变了', async () => {
    expect(await checkEngine('gemini', fakeCli('gemini'), { probe: false })).toEqual({ problems: [] })
    const exe = fakeCli('gemini', { unknown: ['--policy'] })
    process.env.FAKE_ACP_PROTOCOL = '2'
    try {
      expect((await checkEngine('gemini', exe, { probe: false })).problems).toEqual([
        { kind: 'flag', what: '--policy', scope: 'all' },
        { kind: 'format', what: 'ACP 协议版本 2', scope: 'all' },
      ])
    } finally {
      delete process.env.FAKE_ACP_PROTOCOL
    }
  })
})

describe('新版本和更新（engine-update.ts）', () => {
  it('去哪读新版本：Claude Code 原生安装读它的发布地址，别的读 npm', () => {
    const native = join(base, 'home/.local/share/claude/versions/2.1.330')
    mkdirSync(dirname(native), { recursive: true })
    writeFileSync(native, '')
    expect(latestUrl('claude', native).url).toMatch(/claude-code-releases\/latest$/)
    expect(latestUrl('codex', '/opt/homebrew/bin/codex').url).toMatch(/\/@openai\/codex\/latest$/)
    expect(latestUrl('opencode', '/x/opencode').url).toMatch(/\/opencode-ai\/latest$/)
  })

  it('怎么更新：claude update、codex update、opencode upgrade；App 包里带的跟着 App 更新；Gemini 照装法用 npm 或 brew', () => {
    expect(updatePlan('claude', '/u/.local/bin/claude')).toMatchObject({ args: ['update'], text: 'claude update' })
    expect(updatePlan('codex', '/opt/homebrew/bin/codex')).toMatchObject({ args: ['update'], text: 'codex update' })
    expect(updatePlan('codex', '/Applications/ChatGPT.app/Contents/Resources/codex')).toEqual({ none: '跟着 ChatGPT.app 一起更新' })
    expect(updatePlan('opencode', '/x/opencode')).toMatchObject({ args: ['upgrade'], text: 'opencode upgrade' })
    const npmGemini = join(base, 'prefix/lib/node_modules/@google/gemini-cli/bundle/gemini.js')
    mkdirSync(dirname(npmGemini), { recursive: true })
    writeFileSync(npmGemini, '')
    expect(updatePlan('gemini', npmGemini)).toMatchObject({ args: ['install', '-g', '@google/gemini-cli@latest'], text: 'npm install -g @google/gemini-cli@latest' })
    expect(updatePlan('gemini', '/somewhere/gemini')).toHaveProperty('none')
  })
})
