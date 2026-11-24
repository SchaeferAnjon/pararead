/**
 * 没装命令行时的 AI（task-587os 收口第 2 条，设计页 64-没装ClaudeCode时的AI 第 2、6 节）：
 * - API Key（Anthropic、OpenAI、DeepSeek、OpenRouter）：不用工具的活（/ 命令、梦游判断、出卡、小活、画布今日）软件直接问接口，
 *   只要两种协议：Anthropic Messages（POST /v1/messages）、OpenAI chat/completions（OpenAI、DeepSeek、OpenRouter、本机模型）；
 *   要动手的 AI 对话（给了 mcp）交给软件自带的 OpenCode（MIT，ACP 照 engines.ts 的 acpEngine 接），Key 用环境变量给它，
 *   配置里只开这一家（enabled_providers）：OpenCode 没 Key 时默认用的自家免费模型（opencode/big-pickle 等，几家写明免费期间的数据会拿去改进模型）
 *   一个都不出现，笔记不会送过去（opencode 1.19.3 在隔离的家目录里用 `opencode models` 核过：只列这一家的模型）。
 *   它的配置、会话放在软件设置目录自己的一份里（XDG_*），不读不写用户自己装的 OpenCode 的配置和登录。
 * - 本机模型（Ollama、LM Studio，OpenAI 兼容接口）：只聊天、做小活，给了 mcp 也不给工具（9B 到 12B 的模型调工具不稳）。
 * 不碰 Electron：Key 从哪来、自带的 OpenCode 在哪由调用方给（画布今日也用这一份，只问不动手）。
 * 测试：CN_API_BASE_<家>、CN_LOCAL_BASE_<家> 指到本机假的服务；单元测试 test/engine-api.test.ts。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineId } from './shared'
import { API_EFFORTS, type ModelOption } from './shared'
import { API_BASE, API_DEFAULT, type ApiId, isApi, KEY_ENV, LOCAL_BASE, type LocalId, preferModel, PROVIDER_NAME, SOURCE_LABEL } from './shared'
import { t } from './shared/i18n'
import { acpEngine, type Engine, type EngineImage, type EngineRun, opencodeConfig } from './engines'

// ---------------------------------------------------------------- 地址

const envKey = (id: string) => id.toUpperCase()

export function apiBase(id: ApiId, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`CN_API_BASE_${envKey(id)}`] || API_BASE[id]).replace(/\/+$/, '')
}
export function localBase(id: LocalId, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`CN_LOCAL_BASE_${envKey(id)}`] || LOCAL_BASE[id]).replace(/\/+$/, '')
}

/** Anthropic 的接口路径都在 /v1 下；OpenAI 兼容的地址本身带着 /v1（DeepSeek 不带也认） */
const anthropicUrl = (path: string, env?: NodeJS.ProcessEnv) => `${apiBase('anthropic', env)}/v1${path}`

// ---------------------------------------------------------------- 出错说成人话

/** 接口出的错：status 是 HTTP 状态（连不上没有），界面按它说一句人话，原话留在 raw */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly raw?: string,
  ) {
    super(message)
  }
}

function errorBody(body: string): string {
  try {
    const o = JSON.parse(body) as { error?: { message?: string; type?: string } | string; message?: string }
    if (typeof o.error === 'string') return o.error
    if (o.error?.message) return o.error.message
    if (o.message) return o.message
  } catch {
    // 不是 JSON：原样
  }
  return body.slice(0, 300)
}

/** HTTP 出错时说一句（不贴英文报错；原话放在后面一段，界面只画第一句） */
export function httpProblem(name: string, status: number, raw: string): ApiError {
  const said =
    status === 401 || status === 403
      ? t('这把Key {name}不认（{status}）：再拷一遍，注意前后的空格。', { name, status })
      : status === 402 || /credit|balance|余额|insufficient|billing/i.test(raw)
        ? t('{name}说这把Key的余额不够了（{status}）：去{name}充值后再试。', { name, status })
        : status === 429
          ? t('{name}说太快了或额度用完了（429）：等一会儿再试。', { name })
          : status === 404
            ? t('{name}没有这个模型（404）：在 设置 › AI换一个。', { name })
            : status >= 500
              ? t('{name}那边出错了（{status}）：等一会儿再试。', { name, status })
              : t('{name}回了{status}：{said}', { name, status, said: raw.slice(0, 200) })
  return new ApiError(said, status, raw)
}

function netProblem(name: string, e: unknown): ApiError {
  const err = e as Error & { cause?: { code?: string } }
  const code = err.cause?.code ?? ''
  return new ApiError(t('连不上{name}：看看网络（{code}）。', { name, code: code || err.message }), undefined, err.message)
}

const aborted = () => Object.assign(new Error(t('停下了')), { name: 'AbortError' })

/** 多久一个字都没来算没回应 */
const IDLE_MS = 120_000

/** 发请求、读流：每来一块重新计时，空等 IDLE_MS 停下；用户按停下照常停 */
async function stream(url: string, init: RequestInit, name: string, signal: AbortSignal, onLine: (line: string) => void): Promise<void> {
  const ac = new AbortController()
  let idle: NodeJS.Timeout | undefined
  let timedOut = false
  const poke = () => {
    clearTimeout(idle)
    idle = setTimeout(() => ((timedOut = true), ac.abort()), IDLE_MS)
  }
  const stop = () => ac.abort()
  signal.addEventListener('abort', stop)
  poke()
  try {
    let res: Response
    try {
      res = await fetch(url, { ...init, signal: ac.signal })
    } catch (e) {
      if (signal.aborted) throw aborted()
      if (timedOut) throw new ApiError(t('{name} 等了 {s} 秒没回应', { name, s: IDLE_MS / 1000 }))
      throw netProblem(name, e)
    }
    if (!res.ok) throw httpProblem(name, res.status, errorBody(await res.text().catch(() => '')))
    if (!res.body) throw new ApiError(t('{name}没有回答', { name }))
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        poke()
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) onLine(line)
        }
      }
      if (buf.trim()) onLine(buf.trim())
    } catch (e) {
      if (e instanceof ApiError) throw e
      if (signal.aborted) throw aborted()
      if (timedOut) throw new ApiError(t('{name} 等了 {s} 秒没回应', { name, s: IDLE_MS / 1000 }))
      throw new ApiError(t('{name}中途断了：{error}', { name, error: (e as Error).message }))
    }
  } finally {
    clearTimeout(idle)
    signal.removeEventListener('abort', stop)
  }
}

/** 不流式的 GET（验 Key、列模型、找本机模型）：timeout 毫秒 */
async function getJson<T>(url: string, headers: Record<string, string>, name: string, timeout = 15_000): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) })
  } catch (e) {
    throw netProblem(name, e)
  }
  const body = await res.text()
  if (!res.ok) throw httpProblem(name, res.status, errorBody(body))
  try {
    return JSON.parse(body) as T
  } catch {
    throw new ApiError(t('{name}回的不是能读的内容', { name }), res.status, body.slice(0, 200))
  }
}

// ---------------------------------------------------------------- 一问一答（不给工具）

export interface HttpAsk {
  system: string
  prompt: string
  model: string
  effort?: string
  images?: EngineImage[]
  signal: AbortSignal
  onText(delta: string): void
}

const ANTHROPIC_VERSION = '2023-06-01'
const anthropicHeaders = (key: string) => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' })

/**
 * Anthropic Messages（流式）：文字在 content_block_delta 的 text_delta 里；effort 放 output_config（Sonnet 5.5、Haiku 5.5、Opus 5.5 都认五档）。
 * 想的过程（thinking 块）不显示、不要
 */
export async function askAnthropic(key: string, a: HttpAsk, env?: NodeJS.ProcessEnv): Promise<string> {
  const name = PROVIDER_NAME.anthropic
  const content = [...(a.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text: a.prompt }]
  let text = ''
  let refused = false
  let failed: string | null = null
  await stream(
    anthropicUrl('/messages', env),
    {
      method: 'POST',
      headers: { ...anthropicHeaders(key), accept: 'text/event-stream' },
      body: JSON.stringify({
        model: a.model,
        max_tokens: 32_000,
        stream: true,
        ...(a.system ? { system: a.system } : {}),
        messages: [{ role: 'user', content }],
        ...(a.effort ? { output_config: { effort: a.effort } } : {}),
      }),
    },
    name,
    a.signal,
    (line) => {
      if (!line.startsWith('data:')) return
      let ev: { type?: string; delta?: { type?: string; text?: string; stop_reason?: string }; error?: { message?: string } }
      try {
        ev = JSON.parse(line.slice(5).trim())
      } catch {
        return
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text
        a.onText(ev.delta.text)
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') refused = true
      else if (ev.type === 'error') failed = ev.error?.message ?? 'error'
    },
  )
  if (failed) throw new ApiError(t('{name}中途出错：{error}', { name, error: failed }))
  if (refused && !text.trim()) throw new ApiError(t('{name} 拒绝回答', { name }))
  return text
}

/** OpenAI 兼容的 chat/completions（流式）：OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio 都是这一种 */
export async function askOpenAiLike(base: string, key: string | null, name: string, a: HttpAsk): Promise<string> {
  const user = a.images?.length ? [{ type: 'text', text: a.prompt }, ...a.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : a.prompt
  let text = ''
  let failed: string | null = null
  await stream(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: a.model,
        stream: true,
        messages: [...(a.system ? [{ role: 'system', content: a.system }] : []), { role: 'user', content: user }],
      }),
    },
    name,
    a.signal,
    (line) => {
      if (!line.startsWith('data:')) return
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      let chunk: { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } | string }
      try {
        chunk = JSON.parse(data)
      } catch {
        return
      }
      if (chunk.error) failed = typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'error')
      const d = chunk.choices?.[0]?.delta?.content
      if (d) {
        text += d
        a.onText(d)
      }
    },
  )
  if (failed) throw new ApiError(t('{name}中途出错：{error}', { name, error: failed }))
  return text
}

// ---------------------------------------------------------------- 验 Key、列模型

/** 「claude-sonnet-5-5」→「Sonnet 5.5」（接口给的 display_name 是「Claude Sonnet 5.5」，去掉前面的 Claude） */
const claudeName = (display: string) => display.replace(/^Claude\s+/i, '')

/** OpenAI 的模型列表里还有语音、画图、向量这些，聊天用不了的不列 */
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/
const OPENAI_NOT_CHAT = /(audio|realtime|tts|transcribe|image|embedding|search|instruct|moderation|codex|dall-e|whisper)/

/** 列表按推荐排：推荐的那个排第一（没选模型时用第一个） */
function withPreferred(list: ModelOption[], want: readonly string[]): ModelOption[] {
  const first = preferModel(
    list.map((m) => m.id),
    want,
  )
  const i = list.findIndex((m) => m.id === first)
  return i > 0 ? [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)] : list
}

/**
 * 验 Key 并拉这把 Key 能用的模型：Anthropic、OpenAI、DeepSeek 用 GET /models（不花钱）；
 * OpenRouter 的 /models 不看 Key，先问 GET /key（不认的回 401）再列模型。不认抛 ApiError（一句人话）
 */
export async function verifyKey(id: ApiId, key: string, env?: NodeJS.ProcessEnv): Promise<ModelOption[]> {
  const name = PROVIDER_NAME[id]
  if (id === 'anthropic') {
    const r = await getJson<{ data?: { id?: string; display_name?: string }[] }>(anthropicUrl('/models?limit=100', env), anthropicHeaders(key), name)
    const list = (r.data ?? []).filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string' && /^claude-/.test(m.id))
    return withPreferred(
      list.map((m) => ({ id: m.id, label: claudeName(m.display_name || m.id), efforts: API_EFFORTS, defaultEffort: /haiku|opus/.test(m.id) ? 'medium' : 'high' })),
      API_DEFAULT.anthropic.chat,
    )
  }
  const base = apiBase(id, env)
  const auth = { authorization: `Bearer ${key}` }
  if (id === 'openrouter') await getJson(`${base}/key`, auth, name)
  const r = await getJson<{ data?: { id?: string; name?: string }[] }>(`${base}/models`, auth, name)
  let ids = (r.data ?? []).flatMap((m) => (typeof m.id === 'string' && m.id ? [{ id: m.id, name: m.name }] : []))
  if (id === 'openai') ids = ids.filter((m) => OPENAI_CHAT.test(m.id) && !OPENAI_NOT_CHAT.test(m.id)).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
  const list = ids.map((m) => ({ id: m.id, label: id === 'openrouter' && m.name ? m.name : m.id, efforts: [], ...(id === 'openrouter' ? { group: m.id.split('/')[0] } : {}) }))
  return withPreferred(list, API_DEFAULT[id].chat)
}

/** 本机模型找到的样子：开着没有、有哪些模型（Ollama 带大小） */
export interface LocalFound {
  on: boolean
  models: { id: string; size?: number }[]
  error?: string
}

/** 看 Ollama / LM Studio 开没开、有哪些模型（GET /api/tags、GET /v1/models，2 秒不回算没开） */
export async function probeLocal(id: LocalId, env?: NodeJS.ProcessEnv): Promise<LocalFound> {
  const base = localBase(id, env)
  try {
    if (id === 'ollama') {
      const r = await getJson<{ models?: { name?: string; model?: string; size?: number }[] }>(`${base}/api/tags`, {}, SOURCE_LABEL.ollama, 2000)
      return { on: true, models: (r.models ?? []).flatMap((m) => (m.name || m.model ? [{ id: (m.name || m.model)!, ...(typeof m.size === 'number' ? { size: m.size } : {}) }] : [])) }
    }
    const r = await getJson<{ data?: { id?: string }[] }>(`${base}/v1/models`, {}, SOURCE_LABEL.lmstudio, 2000)
    // LM Studio 的列表里也有向量模型（text-embedding-…），聊天用不了
    return { on: true, models: (r.data ?? []).flatMap((m) => (typeof m.id === 'string' && !/embed/i.test(m.id) ? [{ id: m.id }] : [])) }
  } catch (e) {
    return { on: false, models: [], error: (e as Error).message }
  }
}

export const localModels = (f: LocalFound): ModelOption[] => f.models.map((m) => ({ id: m.id, label: m.id, efforts: [] }))

// ---------------------------------------------------------------- 软件自带的 OpenCode

/**
 * 交给自带 OpenCode 的配置（OPENCODE_CONFIG_CONTENT）：
 * - enabled_providers 只开用户给了 Key 的这一家：它自家的免费模型（opencode/…）和别家都不出现；
 * - 权限照全能模式开关（engines.ts 的 opencodeConfig）；不自动升级、不分享会话（share 关掉，会话不上传）；
 * - 小活（起标题）也用这一家便宜的那个，不让它挑别家的
 */
export function bundledConfig(provider: ApiId, omni: boolean, model?: string): string {
  return JSON.stringify({
    ...(JSON.parse(opencodeConfig(omni)) as object),
    enabled_providers: [provider],
    ...(model ? { model: `${provider}/${model}` } : {}),
    small_model: `${provider}/${API_DEFAULT[provider].quick[0]}`,
    autoupdate: false,
    share: 'disabled',
  })
}

/** 自带 OpenCode 自己的配置、会话、缓存放哪（软件设置目录里一份，不碰用户自己装的 OpenCode） */
export function bundledHome(dataDir: string): Record<string, string> {
  const dirs = { XDG_CONFIG_HOME: join(dataDir, 'config'), XDG_DATA_HOME: join(dataDir, 'data'), XDG_CACHE_HOME: join(dataDir, 'cache'), XDG_STATE_HOME: join(dataDir, 'state') }
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
  return dirs
}

// ---------------------------------------------------------------- 引擎

export interface ApiDeps {
  /** 这一家的 Key（主进程从钥匙串解出来；画布今日用借来的那份）；没有是 undefined */
  key(id: ApiId): string | undefined
  /** 自带 OpenCode 的路径和它的设置目录（画布今日不给：只问不动手） */
  opencode?(): { path: string; dataDir: string } | null
  env?: NodeJS.ProcessEnv
}

const withHistory = (r: EngineRun) => (r.history ? `${r.history}\n\n${r.prompt}` : r.prompt)

/** 一把 Key 这一家：不给工具直接问接口；给了工具（AI 对话、读 PDF 动手）或开着全能模式（有自带 OpenCode 时）交给自带的 OpenCode */
export function apiEngine(id: ApiId, deps: ApiDeps): Engine {
  const name = SOURCE_LABEL[id]
  /** 现在开着的 OpenCode（Key 换了重起） */
  let acp: { engine: Engine; key: string; path: string } | null = null

  function agent(key: string): Engine {
    const oc = deps.opencode?.()
    if (!oc) throw new ApiError(t('软件自带的OpenCode不在，{name}只能聊天、不能动手：重新装一遍画布笔记。', { name }))
    if (acp && acp.key === key && acp.path === oc.path) return acp.engine
    acp?.engine.dispose?.()
    const home = bundledHome(oc.dataDir)
    const engine = acpEngine({
      id: 'opencode',
      label: name,
      command: oc.path,
      args: (cwd) => ['acp', '--cwd', cwd],
      env: (omni) => ({ ...home, [KEY_ENV[id]]: key, OPENCODE_CONFIG_CONTENT: bundledConfig(id, omni) }),
      loginHint: t('{name}的Key用不了：在 设置 › AI换一把', { name }),
    })
    acp = { engine, key, path: oc.path }
    return engine
  }

  return {
    id,
    label: name,
    dispose: () => {
      acp?.engine.dispose?.()
      acp = null
    },
    async run(r) {
      const key = deps.key(id)
      if (!key) throw new ApiError(t('还没填{name}的Key：在AI栏或 设置 › AI填一把', { name: PROVIDER_NAME[id] }))
      // 全能模式不给 mcp（ParaRead）：有自带 OpenCode 就交给它动手，没有照旧直接问接口
      if (r.mcp || (r.omni && deps.opencode?.())) {
        // 动手：OpenCode 认「服务商/模型」
        const model = r.model ? `${id}/${r.model}` : undefined
        return agent(key).run({ ...r, ...(model ? { model } : {}) })
      }
      const ask: HttpAsk = { system: r.system, prompt: withHistory(r), model: r.model || API_DEFAULT[id].chat[0]!, ...(r.effort && id === 'anthropic' ? { effort: r.effort } : {}), ...(r.images?.length ? { images: r.images } : {}), signal: r.signal, onText: r.onText }
      const text = id === 'anthropic' ? await askAnthropic(key, ask, deps.env) : await askOpenAiLike(apiBase(id, deps.env), key, PROVIDER_NAME[id], ask)
      if (r.signal.aborted) throw aborted()
      return { text: text.trim() }
    },
  }
}

/**
 * 本机模型：只聊天、做小活。给了工具（AI 对话）也只是聊天：不动手，话里补一句「本机模型不动手」，
 * 没有会话（每问把最近几轮放在前面）
 */
export function localEngine(id: LocalId, env?: NodeJS.ProcessEnv): Engine {
  const name = SOURCE_LABEL[id]
  return {
    id,
    label: name,
    async run(r) {
      if (!r.model) throw new ApiError(t('{name}里还没有模型：先下载一个，再在 设置 › AI选它', { name }))
      const system = r.mcp ? `${r.system}\n\n${LOCAL_NO_TOOLS}` : r.system
      const text = await askOpenAiLike(`${localBase(id, env)}/v1`, null, name, { system, prompt: withHistory(r), model: r.model, ...(r.images?.length ? { images: r.images } : {}), signal: r.signal, onText: r.onText })
      if (r.signal.aborted) throw aborted()
      return { text: text.trim() }
    },
  }
}

// 不翻：给 AI 的话
const LOCAL_NO_TOOLS = '现在用的是这台 Mac 上的本机模型：你没有任何工具，不能新建、改写、挪动笔记，也不能上网、跑命令。用户要你动手时，直接说本机模型只能聊天，要动手请在 设置 › AI 接一把 API Key 或装 Claude Code。'

/** 这一家是不是一把 Key（不是本机模型、命令行） */
export const keyEngine = (id: EngineId): id is ApiId => isApi(id)
