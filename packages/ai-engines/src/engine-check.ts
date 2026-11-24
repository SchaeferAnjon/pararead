/**
 * 命令行换了版本以后的自查（task-m55m7，用户 r20：「Claude Code 更新了…我们是否还兼容」）：
 * 我们用到的参数、接口、输出还认不认。能离线查的都离线查，不花钱：
 * - Claude Code：拿 engines.ts 的 claudeArgs 拼出我们真用的那几组参数（AI 对话全能开关两种、读 PDF、/ 命令、只读翻文件），
 *   空着标准输入跑 `claude -p …`：参数都认它会说「Input must be provided…」就退出，不认的它在调模型之前就报
 *   「unknown option '--x'」「argument 'y' is invalid」（commander 的原话）；--effort 的几档看它报的 Valid values。
 *   不是核过的版本、离线查都过了，再用最便宜的 Haiku 真问一个字，看 stream-json 的 init、逐字、result 三样还在不在（只在版本变了时问一次）
 * - Codex：`codex app-server generate-json-schema` 写出它的接口定义，看我们用的方法、字段、取值还在不在；`codex features list` 看全能模式关着时要关的那几样
 * - Gemini CLI、OpenCode：--help 里我们给的参数还在不在，ACP 握手（initialize）协议版本还是 1、还能接 http 的 MCP；
 *   OpenCode 再用 `opencode debug agent build` 看全能模式关着时那几样权限真的拒了
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliId as EngineId } from './shared'
import { t } from './shared/i18n'
import { CLAUDE_EFFORTS } from './shared'
import type { EngineProblem } from './shared'
import { cliEnv } from './cli'
import { acpHandshake } from './engine-models'
import { lastLine, runProc } from './engine-proc'
import { claudeArgs, CODEX_LOCKED, geminiArgs, opencodeConfig } from './engines'

export interface CheckResult {
  problems: EngineProblem[]
  /** 没查成的那一部分（「接口定义没导出来：…」「真问一个字没问成：没登录」） */
  note?: string
  /** 离线那几样有没查成的（跑不起来、超时、导不出接口定义、ACP 握手没成）：没查出问题时结论是「没查成」，不是「能用」 */
  partial?: boolean
  /** 真问了一个字（Claude Code） */
  asked?: boolean
}

type Scope = EngineProblem['scope']

function add(list: EngineProblem[], p: EngineProblem) {
  const same = list.find((x) => x.kind === p.kind && x.what === p.what)
  if (!same) list.push(p)
  else if (same.scope !== p.scope) same.scope = 'all'
}

/** 拿掉一个参数，连着它后面跟的值（--tools ''、--model haiku）；--x=y 这种是一个 */
export function withoutFlag(args: string[], flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith(flag + '=')) continue
    if (a === flag) {
      if (i + 1 < args.length && !args[i + 1]!.startsWith('-')) i++
      continue
    }
    out.push(a)
  }
  return out
}

/** commander 在调模型前就报的：不认的参数、值不在可选范围里 */
export function claudeParseError(out: string): { flag: string; value?: string } | null {
  const unknown = /unknown option '(--?[\w-]+)'/.exec(out)
  if (unknown) return { flag: unknown[1]! }
  const invalid = /option '(--[\w-]+)[^']*' argument '([^']*)' is invalid/.exec(out)
  if (invalid) return { flag: invalid[1]!, value: invalid[2]! }
  return null
}

const UUID = '00000000-0000-4000-8000-000000000000'

/** 我们真用的那几组 claude 参数（和 engines.ts 的 claudeArgs 同一份，以后加了参数这里自动跟着查） */
function claudeSets(cfg: string): { args: string[]; scope: Scope }[] {
  const mcp = { url: 'http://127.0.0.1:9/mcp', token: 'x', tools: ['notes_list'] }
  const img = [{ mime: 'image/png' as const, data: '', path: '' }]
  return [
    { args: claudeArgs({ system: 'x', mcp, model: 'haiku', effort: 'low' }, undefined, cfg), scope: 'chat' },
    { args: claudeArgs({ system: 'x', mcp, model: 'haiku', effort: 'low', omni: true }, undefined, cfg), scope: 'chat' },
    { args: claudeArgs({ system: 'x', appendSystem: true, mcp, model: 'haiku', effort: 'low', images: img, fork: true, omni: true }, UUID, cfg), scope: 'chat' },
    { args: claudeArgs({ system: 'x', model: 'haiku', keepSession: true }), scope: 'quick' },
    { args: claudeArgs({ system: 'x', model: 'haiku' }), scope: 'quick' },
    { args: claudeArgs({ system: 'x', readOnly: true }), scope: 'quick' },
  ]
}

/** 一组参数里有没有这个参数（和值） */
const hasArg = (args: string[], flag: string, value?: string) => args.some((a, i) => (a === flag || a.startsWith(flag + '=')) && (value === undefined || args[i + 1] === value || a === `${flag}=${value}`))

async function checkClaude(exe: string, probe: boolean): Promise<CheckResult> {
  const dir = mkdtempSync(join(tmpdir(), 'cn-check-'))
  const problems: EngineProblem[] = []
  const bad: { flag: string; value?: string }[] = []
  try {
    const cfg = join(dir, 'mcp.json')
    writeFileSync(cfg, JSON.stringify({ mcpServers: {} }), { mode: 0o600 })
    const sets = claudeSets(cfg)
    for (const set of sets) {
      let args = set.args
      for (const b of bad) args = withoutFlag(args, b.flag)
      // 一次只报第一个不认的：拿掉它再跑，最多找 8 个
      for (let round = 0; round < 8; round++) {
        const r = await runProc(exe, args, { input: '', timeoutMs: 20_000, cwd: dir })
        if (r.error) return { problems, note: t('跑不起来：{error}', { error: r.error }), partial: true }
        if (r.timedOut) return { problems, note: t('空着输入试参数，20 秒没反应'), partial: true }
        const e = claudeParseError(`${r.stderr}\n${r.stdout}`)
        if (!e) break
        bad.push(e)
        args = withoutFlag(args, e.flag)
      }
    }
    // 影响哪：哪几组参数里有它
    for (const b of bad) {
      const scopes = new Set(sets.filter((s) => hasArg(s.args, b.flag, b.value)).map((s) => s.scope))
      const scope: Scope = scopes.has('chat') && scopes.has('quick') ? 'all' : scopes.has('chat') ? 'chat' : 'quick'
      add(problems, b.value === undefined ? { kind: 'flag', what: b.flag, scope } : { kind: 'value', what: `${b.flag} ${b.value}`, scope })
    }
    // --effort 那几档：给一个不存在的档，它会列出认的（Valid values: low, medium, …）
    if (!bad.some((b) => b.flag === '--effort')) {
      const r = await runProc(exe, ['-p', '--effort', 'cn-probe', '--setting-sources=', '--tools', ''], { input: '', timeoutMs: 20_000, cwd: dir })
      const valid = /Valid values:\s*([\w ,-]+)/.exec(r.stderr + r.stdout)?.[1]?.split(/[,\s]+/).filter(Boolean)
      if (valid) for (const e of CLAUDE_EFFORTS) if (!valid.includes(e.id)) add(problems, { kind: 'value', what: `--effort ${e.id}`, scope: 'all' })
    }
    if (!probe || problems.length) return { problems }
    return { problems, ...(await claudeProbe(exe, dir, problems)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 真问一个字（Haiku、Low、不给工具、不留会话），看我们读的三样输出还在不在 */
async function claudeProbe(exe: string, cwd: string, problems: EngineProblem[]): Promise<{ asked?: boolean; note?: string }> {
  // 不翻：给 AI 的话
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', 'haiku', '--effort', 'low', '--system-prompt', '只回一个字。', '--setting-sources=', '--strict-mcp-config', '--tools', '', '--max-turns', '1', '--no-session-persistence']
  const r = await runProc(exe, args, { input: '回一个字：好', timeoutMs: 90_000, cwd }) // 不翻：给 AI 的话
  let init = false
  let delta = false
  let result: { ok: boolean; text: string } | null = null
  for (const line of r.stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let m: { type?: string; subtype?: string; session_id?: unknown; is_error?: boolean; result?: unknown; event?: { type?: string; delta?: { type?: string } } }
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') init = true
    if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') delta = true
    if (m.type === 'result') result = { ok: m.subtype === 'success' && !m.is_error, text: typeof m.result === 'string' ? m.result : String(m.subtype ?? '') }
  }
  // 没问成（没登录、没网、额度用完）：说不清输出变没变，不算不兼容
  if (!result?.ok) return { note: t('真问一个字没问成：{why}', { why: result?.text || lastLine(r.stderr) || (r.timedOut ? t('90 秒没回') : t('退出码 {n}', { n: r.code })) }) }
  if (!init) add(problems, { kind: 'format', what: t('开头的 init（会话号）'), scope: 'all' })
  if (!delta) add(problems, { kind: 'format', what: t('逐字输出（stream_event）'), scope: 'all' })
  return { asked: true }
}

/** JSON Schema 里出现过的 method 名（"method": {"enum": ["thread/start"]}） */
function methodsIn(file: string): Set<string> {
  const out = new Set<string>()
  const walk = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(walk)
    if (!o || typeof o !== 'object') return
    const m = (o as { properties?: { method?: { enum?: unknown } } }).properties?.method?.enum
    if (Array.isArray(m)) for (const x of m) if (typeof x === 'string') out.add(x)
    Object.values(o).forEach(walk)
  }
  walk(JSON.parse(readFileSync(file, 'utf8')))
  return out
}

/** 一个目录下所有 .json 的字（查取值还在不在） */
function allText(dir: string): string {
  let s = ''
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) s += allText(p)
    else if (name.endsWith('.json')) s += readFileSync(p, 'utf8')
  }
  return s
}

/** Codex 里我们用到的方法：哪一个文件里、影响哪（旁支、接着聊、步骤、批准只在 AI 对话里） */
const CODEX_METHODS: [string, string, Scope][] = [
  ['ClientRequest', 'initialize', 'all'],
  ['ClientRequest', 'thread/start', 'all'],
  ['ClientRequest', 'turn/start', 'all'],
  ['ClientRequest', 'turn/interrupt', 'all'],
  ['ClientRequest', 'thread/resume', 'chat'],
  ['ClientRequest', 'thread/fork', 'chat'],
  ['ClientNotification', 'initialized', 'all'],
  ['ServerNotification', 'item/agentMessage/delta', 'all'],
  ['ServerNotification', 'turn/completed', 'all'],
  ['ServerNotification', 'error', 'all'],
  ['ServerNotification', 'item/started', 'chat'],
  ['ServerNotification', 'item/completed', 'chat'],
  ['ServerRequest', 'item/commandExecution/requestApproval', 'chat'],
  ['ServerRequest', 'item/fileChange/requestApproval', 'chat'],
  ['ServerRequest', 'mcpServer/elicitation/request', 'chat'],
]
/** 我们给的字段 */
const CODEX_PARAMS: [string, string, string[], Scope][] = [
  ['ThreadStartParams', 'thread/start', ['cwd', 'sandbox', 'approvalPolicy', 'config', 'developerInstructions'], 'all'],
  ['TurnStartParams', 'turn/start', ['threadId', 'input', 'model', 'effort'], 'all'],
  ['ThreadResumeParams', 'thread/resume', ['threadId'], 'chat'],
  ['ThreadForkParams', 'thread/fork', ['threadId'], 'chat'],
]

async function checkCodex(exe: string): Promise<CheckResult> {
  const problems: EngineProblem[] = []
  const help = await runProc(exe, ['--help'], { timeoutMs: 20_000 })
  if (help.error) return { problems, note: t('跑不起来：{error}', { error: help.error }), partial: true }
  if (!/\bapp-server\b/.test(help.stdout + help.stderr)) add(problems, { kind: 'method', what: 'codex app-server', scope: 'all' })
  const ash = await runProc(exe, ['app-server', '--help'], { timeoutMs: 20_000 })
  if (!/--config\b/.test(ash.stdout + ash.stderr)) add(problems, { kind: 'flag', what: '-c/--config', scope: 'all' })
  const dir = mkdtempSync(join(tmpdir(), 'cn-codex-schema-'))
  let note: string | undefined
  let partial = false
  try {
    const gen = await runProc(exe, ['app-server', 'generate-json-schema', '--experimental', '--out', dir], { timeoutMs: 30_000 })
    if (gen.code !== 0) {
      note = t('接口定义没导出来：{why}', { why: lastLine(gen.stderr || gen.stdout) || t('退出码 {n}', { n: gen.code }) })
      partial = true
    }
    else {
      const seen = new Map<string, Set<string>>()
      for (const [file, method, scope] of CODEX_METHODS) {
        if (!seen.has(file)) seen.set(file, (() => { try { return methodsIn(join(dir, `${file}.json`)) } catch { return new Set<string>() } })())
        if (!seen.get(file)!.has(method)) add(problems, { kind: 'method', what: method, scope })
      }
      for (const [file, method, fields, scope] of CODEX_PARAMS) {
        let props: Record<string, unknown> = {}
        try {
          props = (JSON.parse(readFileSync(join(dir, 'v2', `${file}.json`), 'utf8')) as { properties?: Record<string, unknown> }).properties ?? {}
        } catch {
          props = {}
        }
        for (const f of fields) if (!(f in props)) add(problems, { kind: 'method', what: `${method}.${f}`, scope })
      }
      const text = allText(dir)
      for (const [value, what] of [['danger-full-access', 'sandbox danger-full-access'], ['read-only', 'sandbox read-only'], ['never', 'approvalPolicy never']] as const)
        if (!text.includes(`"${value}"`)) add(problems, { kind: 'value', what, scope: 'all' })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // 全能模式关着时要关的几样：这一版里还有这个开关
  const feats = await runProc(exe, ['features', 'list'], { timeoutMs: 20_000 })
  if (feats.code === 0) {
    const listed = new Map(feats.stdout.split('\n').map((l) => l.trim().split(/\s{2,}|\t/)).filter((c) => c[0]).map((c) => [c[0]!, c[1] ?? '']))
    for (const arg of CODEX_LOCKED) {
      const name = /^features\.([\w-]+)=/.exec(arg)?.[1]
      if (name && (!listed.has(name) || listed.get(name) === 'removed')) add(problems, { kind: 'feature', what: `features.${name}`, scope: 'chat' })
    }
  }
  return { problems, ...(note ? { note } : {}), ...(partial ? { partial } : {}) }
}

/** ACP 握手：协议版本还是 1，能接 http 的 MCP（我们的工具走它） */
async function checkAcp(exe: string, args: string[], problems: EngineProblem[]): Promise<string | undefined> {
  try {
    const { init } = await acpHandshake(exe, args, { timeoutMs: 30_000 })
    if (init.protocolVersion !== 1) add(problems, { kind: 'format', what: t('ACP 协议版本 {v}', { v: String(init.protocolVersion) }), scope: 'all' })
    const http = (init.agentCapabilities as { mcpCapabilities?: { http?: unknown } } | undefined)?.mcpCapabilities?.http
    if (http !== true) add(problems, { kind: 'format', what: t('接 http 的 MCP'), scope: 'chat' })
    return undefined
  } catch (e) {
    return t('ACP 握手没成：{error}', { error: (e as Error).message })
  }
}

/** --help 里有没有这个参数（前后是空白或标点，--policy 不算 --policy-x） */
const inHelp = (help: string, flag: string) => new RegExp(`(^|[\\s,])${flag.replace(/[-]/g, '\\-')}(?![\\w-])`, 'm').test(help)

async function checkGemini(exe: string): Promise<CheckResult> {
  const problems: EngineProblem[] = []
  const help = await runProc(exe, ['--help'], { timeoutMs: 30_000 })
  if (help.error) return { problems, note: t('跑不起来：{error}', { error: help.error }), partial: true }
  const text = help.stdout + help.stderr
  const flags = new Set([...geminiArgs(true, 'p'), ...geminiArgs(false, 'p')].filter((a) => a.startsWith('--')))
  for (const f of flags) if (!inHelp(text, f)) add(problems, { kind: 'flag', what: f, scope: 'all' })
  const modeLine = text.split('\n').find((l) => inHelp(l, '--approval-mode')) ?? ''
  if (inHelp(text, '--approval-mode')) for (const v of ['yolo', 'default']) if (!modeLine.includes(`"${v}"`) && !modeLine.includes(` ${v} `) && !modeLine.includes(`${v} (`)) add(problems, { kind: 'value', what: `--approval-mode ${v}`, scope: 'all' })
  const note = await checkAcp(exe, ['--acp'], problems)
  return { problems, ...(note ? { note, partial: true } : {}) }
}

async function checkOpencode(exe: string): Promise<CheckResult> {
  const problems: EngineProblem[] = []
  const help = await runProc(exe, ['--help'], { timeoutMs: 30_000 })
  if (help.error) return { problems, note: t('跑不起来：{error}', { error: help.error }), partial: true }
  if (!/\bacp\b/.test(help.stdout + help.stderr)) add(problems, { kind: 'method', what: 'opencode acp', scope: 'all' })
  const acpHelp = await runProc(exe, ['acp', '--help'], { timeoutMs: 30_000 })
  if (!inHelp(acpHelp.stdout + acpHelp.stderr, '--cwd')) add(problems, { kind: 'flag', what: '--cwd', scope: 'all' })
  const shake = await checkAcp(exe, ['acp', '--cwd', tmpdir()], problems)
  let note = shake
  // 全能模式关着时给的权限：它算出来的 build 这个 agent 里，这几样真的是拒
  const locked = JSON.parse(opencodeConfig(false)) as { permission: Record<string, string> }
  const built = await runProc(exe, ['debug', 'agent', 'build'], { timeoutMs: 30_000, env: cliEnv({ OPENCODE_CONFIG_CONTENT: opencodeConfig(false) }) })
  try {
    const rules = (JSON.parse(built.stdout) as { permission?: { permission?: string; action?: string }[] }).permission ?? []
    for (const key of Object.keys(locked.permission)) if (!rules.some((r) => r.permission === key && r.action === 'deny')) add(problems, { kind: 'feature', what: key, scope: 'chat' })
  } catch {
    note ??= t('全能模式关着时的权限没查成')
  }
  return { problems, ...(note ? { note } : {}), ...(shake ? { partial: true } : {}) }
}

/** 查一家。probe：不是核过的版本，离线查都过了再真问一个字（只有 Claude Code 要问） */
export function checkEngine(id: EngineId, exe: string, o: { probe: boolean }): Promise<CheckResult> {
  if (id === 'claude') return checkClaude(exe, o.probe)
  if (id === 'codex') return checkCodex(exe)
  if (id === 'gemini') return checkGemini(exe)
  return checkOpencode(exe)
}
