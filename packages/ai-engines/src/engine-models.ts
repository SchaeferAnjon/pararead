/**
 * 从各家命令行拉模型列表（task-m55m7，用户 r20「再加上自动拉取模型」）。都不调模型、不花钱：
 * - Claude Code：stream-json 的控制请求 initialize（Agent SDK 的 supportedModels() 就是它；code.claude.com/docs/en/agent-sdk/typescript），
 *   回的 models 里有别名（opus、sonnet、haiku…）、它们实际是哪个型号、各自认哪几档 effort，不发用户消息就关掉
 * - Codex：app-server 的 model/list（engines.ts 的 codexModelList）
 * - OpenCode：`opencode models --verbose`（opencode.ai/docs/cli/#models），每个模型带名字和它那几档（variants）
 * - Gemini CLI：ACP 的 session/new 回的 models（availableModels，github.com/google-gemini/gemini-cli 的 acp 那一层）；要登录了才有
 */
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { effortOption, type ModelOption } from './shared'
import { cliEnv } from './cli'
import { geminiLoggedIn } from './engines'
import { RpcProcess } from './jsonrpc'
import { lastLine, runProc } from './engine-proc'
import { t } from './shared/i18n'

const APP = { name: 'canvas-notes', version: '0.0.1' }

/** 一档 effort 的名字是命令行认的小写字母 */
const effortsOf = (ids: unknown): ModelOption['efforts'] => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^[a-z]{1,20}$/.test(x)).map(effortOption) : [])

interface ClaudeModelInfo {
  value?: unknown
  resolvedModel?: unknown
  displayName?: unknown
  supportsEffort?: unknown
  supportedEffortLevels?: unknown
}

/** Claude Code 报的模型换成菜单里的：「default」（跟着账号走的推荐）不要，我们一直明着传 --model；具体型号（claude-…）归到「具体型号」那一组 */
export function claudeModelOptions(list: unknown): ModelOption[] {
  if (!Array.isArray(list)) return []
  return (list as ClaudeModelInfo[]).flatMap((m) => {
    if (typeof m?.value !== 'string' || !m.value || m.value === 'default') return []
    const label = typeof m.displayName === 'string' && m.displayName ? m.displayName : m.value
    return [
      {
        id: m.value,
        label,
        efforts: m.supportsEffort === false ? [] : effortsOf(m.supportedEffortLevels),
        ...(typeof m.resolvedModel === 'string' && m.resolvedModel !== m.value ? { resolved: m.resolvedModel } : {}),
        ...(m.value.startsWith('claude-') ? { group: t('具体型号') } : {}),
      },
    ]
  })
}

/**
 * 问本机 Claude Code 有哪些模型：起一个 `claude -p --input-format stream-json --output-format stream-json`（不读用户设置、不接 MCP、不给工具、不留会话），
 * 写一条控制请求 initialize，等它的 control_response，拿到就关。不发用户消息，不调模型
 */
export function claudeModels(exe: string, timeoutMs = 20_000): Promise<{ models: ModelOption[]; version?: string }> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources=', '--strict-mcp-config', '--tools', '', '--no-session-persistence']
    const child = spawn(exe, args, { cwd: homedir(), env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    const id = `cn-models-${Date.now()}`
    let buf = ''
    let stderr = ''
    let settled = false
    const done = (f: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin!.end()
      // 关了标准输入它自己会退；不退就杀掉
      setTimeout(() => child.kill('SIGTERM'), 500).unref()
      f()
    }
    const timer = setTimeout(() => done(() => reject(new Error(t('Claude Code {s} 秒没报模型', { s: Math.round(timeoutMs / 1000) })))), timeoutMs)
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{')) continue
        let m: { type?: string; response?: { subtype?: string; request_id?: string; error?: string; response?: { models?: unknown; claude_code_version?: unknown } } }
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m.type !== 'control_response' || m.response?.request_id !== id) continue
        const r = m.response
        if (r.subtype === 'error') return done(() => reject(new Error(r.error || t('Claude Code 没报模型'))))
        const models = claudeModelOptions(r.response?.models)
        const version = typeof r.response?.claude_code_version === 'string' ? r.response.claude_code_version : undefined
        if (!models.length) return done(() => reject(new Error(t('Claude Code 报的模型是空的'))))
        return done(() => resolve({ models, ...(version ? { version } : {}) }))
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
    child.on('error', (e) => done(() => reject(new Error(t('{name} 启动不了：{error}', { name: exe, error: e.message })))))
    child.on('close', (code) => done(() => reject(new Error(stderr.trim() ? t('Claude Code 没报模型就退出了（{code}）：{why}', { code, why: lastLine(stderr) }) : t('Claude Code 没报模型就退出了（{code}）', { code })))))
    child.stdin!.on('error', () => undefined)
    child.stdin!.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'initialize' } }) + '\n')
  })
}

/**
 * `opencode models --verbose` 的输出：一行「服务商/模型」，跟着一段 JSON（name、providerID、variants…）。
 * 名字用它的 name，按服务商分组，那几档是 variants 的键（default 不算一档：不选就是它）
 */
export function parseOpencodeModels(out: string): ModelOption[] {
  const lines = out.split('\n')
  const res: ModelOption[] = []
  const head = /^([\w.@-]+)\/(\S+)$/
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]!.trim())
    if (!m) continue
    const [, provider, name] = m as unknown as [string, string, string]
    let info: { name?: unknown; providerID?: unknown; variants?: unknown; status?: unknown } = {}
    if (lines[i + 1]?.trim() === '{') {
      const end = lines.indexOf('}', i + 1)
      if (end > i) {
        try {
          info = JSON.parse(lines.slice(i + 1, end + 1).join('\n'))
        } catch {
          info = {}
        }
        i = end
      }
    }
    if (info.status === 'deprecated') continue
    const variants = info.variants && typeof info.variants === 'object' ? Object.keys(info.variants).filter((k) => k !== 'default') : []
    res.push({ id: `${provider}/${name}`, label: typeof info.name === 'string' && info.name ? info.name : name, efforts: effortsOf(variants), group: typeof info.providerID === 'string' ? info.providerID : provider })
  }
  return res
}

export async function opencodeModels(exe: string): Promise<ModelOption[]> {
  const r = await runProc(exe, ['models', '--verbose'], { timeoutMs: 45_000 })
  if (r.timedOut) throw new Error(t('opencode models 45 秒没跑完'))
  const tail = lastLine(r.stderr || r.stdout)
  if (r.code !== 0) throw new Error(tail ? t('opencode models 出错（{code}）：{why}', { code: r.code ?? r.error, why: tail }) : t('opencode models 出错（{code}）', { code: r.code ?? r.error }))
  const list = parseOpencodeModels(r.stdout)
  if (!list.length) throw new Error(t('opencode models 一个模型都没列'))
  return list
}

/** ACP session/new 回的模型：新写法 configOptions（类别 model），旧写法 models.availableModels（Gemini CLI 还在用） */
export function acpModelOptions(r: { models?: unknown; configOptions?: unknown }): ModelOption[] {
  const skip = new Set(['', 'auto', 'default'])
  const conf = Array.isArray(r.configOptions) ? (r.configOptions as { category?: unknown; options?: unknown }[]).find((o) => o?.category === 'model') : undefined
  if (conf && Array.isArray(conf.options))
    return (conf.options as { value?: unknown; name?: unknown }[]).flatMap((o) => (typeof o?.value === 'string' && !skip.has(o.value) ? [{ id: o.value, label: typeof o.name === 'string' && o.name ? o.name : o.value, efforts: [] }] : []))
  const avail = (r.models as { availableModels?: unknown } | undefined)?.availableModels
  if (!Array.isArray(avail)) return []
  return (avail as { modelId?: unknown; name?: unknown }[]).flatMap((m) => (typeof m?.modelId === 'string' && !skip.has(m.modelId) ? [{ id: m.modelId, label: typeof m.name === 'string' && m.name ? m.name : m.modelId, efforts: [] }] : []))
}

/** 起一个 ACP 程序握手（initialize），给 session/new 就再开一个会话（不发话），拿到就关 */
export async function acpHandshake(exe: string, args: string[], o: { session?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ init: Record<string, unknown>; session?: Record<string, unknown> }> {
  const p = new RpcProcess(exe, args, { cwd: o.session ?? homedir(), env: cliEnv(o.env ?? {}) })
  try {
    const init = await p.request<Record<string, unknown>>('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: APP }, o.timeoutMs ?? 20_000)
    if (!o.session) return { init }
    const session = await p.request<Record<string, unknown>>('session/new', { cwd: o.session, mcpServers: [] }, o.timeoutMs ?? 60_000)
    return { init, session }
  } finally {
    p.close()
  }
}

/** Gemini CLI 的模型：登录了才开得了会话，没登录直接说 */
export async function geminiModels(exe: string): Promise<ModelOption[]> {
  if (!geminiLoggedIn()) throw new Error(t('Gemini 没登录'))
  const { session } = await acpHandshake(exe, ['--acp'], { session: homedir() })
  const list = acpModelOptions(session ?? {})
  if (!list.length) throw new Error(t('Gemini 开会话时没报模型'))
  return list
}
