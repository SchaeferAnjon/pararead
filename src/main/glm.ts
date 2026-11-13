import { thinkParams } from '../shared/thinking'
import { t } from '../shared/i18n'
// OpenAI 兼容的 chat/completions 客户端，支持 SSE 流式。默认端点是智谱 Coding Plan（/api/coding/paas/v4）；
// 别家服务（DeepSeek、通义、OpenAI 等，见 shared/providers.ts）传 baseUrl。各家的特殊参数在 buildRequest 里按模型加。

export const GLM_BASE = 'https://open.bigmodel.cn/api/coding/paas/v4'

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  reasoning_content?: string
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatOptions {
  apiKey: string
  model: string
  messages: ChatMsg[]
  stream?: boolean
  temperature?: number
  jsonMode?: boolean
  timeoutMs?: number // 整个请求的上限
  idleMs?: number // 流式时两段数据之间的上限
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  retryDelays?: number[] // 429 限流时的等待间隔
  baseUrl?: string // 不给就是智谱 Coding Plan
  headers?: Record<string, string> // 会员通道的设备令牌、用量号
  thinking?: boolean // 深度思考：思考内容走 onReasoning
  maxTokens?: number
  serial?: boolean // 账号把请求串行化（智谱 Coding Plan）：发起间隔至少 1.1 秒
  onReasoning?: (text: string) => void
  tools?: ToolDef[]
}

export class GlmError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'GlmError'
  }
}

export function buildRequest(o: ChatOptions): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    stream: !!o.stream
  }
  // 深度思考按各家自己的参数开关（shared/thinking.ts）
  Object.assign(body, thinkParams(o.model, o.baseUrl ?? GLM_BASE, !!o.thinking))
  if (o.stream) body.stream_options = { include_usage: true }
  if (o.temperature !== undefined) body.temperature = o.temperature
  if (o.maxTokens) body.max_tokens = o.maxTokens
  if (o.jsonMode) body.response_format = { type: 'json_object' }
  if (o.tools?.length) body.tools = o.tools
  return {
    url: `${(o.baseUrl ?? GLM_BASE).replace(/\/+$/, '')}/chat/completions`,
    body,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${o.apiKey}`,
        Accept: o.stream ? 'text/event-stream' : 'application/json',
        ...o.headers
      },
      body: JSON.stringify(body)
    }
  }
}

// SSE 增量解析：喂入任意切开的文本块，吐出完整的 data 事件。
export class SseParser {
  private buf = ''
  feed(chunk: string): string[] {
    this.buf += chunk
    const out: string[] = []
    let idx: number
    while ((idx = this.buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = this.buf.slice(0, idx)
      const m = /\r?\n\r?\n/.exec(this.buf.slice(idx))
      this.buf = this.buf.slice(idx + (m ? m[0].length : 2))
      const data = raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data) out.push(data)
    }
    return out
  }
  flush(): string[] {
    const rest = this.buf.trim()
    this.buf = ''
    if (!rest) return []
    const data = rest
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n')
    return data ? [data] : []
  }
}

// 从一条 SSE data 里取出正文增量。返回 null 表示 [DONE]。思考内容 reasoning_content 不算正文。
export function deltaOf(data: string): string | null {
  const p = partsOf(data)
  return p === null ? null : p.content
}

export function partsOf(data: string): { content: string; reasoning: string } | null {
  if (data.trim() === '[DONE]') return null
  const j = JSON.parse(data) as {
    choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[]
    error?: { code?: string; message?: string }
  }
  if (j.error) throw new GlmError(t('AI 错误 {0}：{1}', j.error.code ?? '', j.error.message ?? data))
  const d = j.choices?.[0]?.delta
  return { content: d?.content ?? '', reasoning: d?.reasoning_content ?? '' }
}

// HTTP 错误把状态码和返回原文一起透出，例如「GLM 429：{"error":{"code":"1302",...}}」
async function errorFromResponse(res: Response): Promise<GlmError> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    text = res.statusText
  }
  let msg = text
  try {
    const j = JSON.parse(text) as { error?: { code?: string; message?: string } }
    if (j.error) msg = `${j.error.code ?? ''} ${j.error.message ?? ''}`.trim()
  } catch {
    // 返回体不是 JSON 就原样显示
  }
  return new GlmError(t('AI 服务 {0}：{1}', res.status, msg.slice(0, 300)), res.status)
}

function linkSignals(outer: AbortSignal | undefined, inner: AbortController): void {
  if (!outer) return
  if (outer.aborted) inner.abort(outer.reason)
  else outer.addEventListener('abort', () => inner.abort(outer.reason), { once: true })
}

async function chatStreamOnce(o: ChatOptions, onDelta: (text: string) => void): Promise<string> {
  if (!o.apiKey) throw new GlmError(t('没有 API Key：在设置里填写'))
  const f = o.fetchImpl ?? fetch
  const { url, init } = buildRequest({ ...o, stream: true })
  const ctl = new AbortController()
  linkSignals(o.signal, ctl)
  const total = setTimeout(() => ctl.abort(new GlmError(t('请求超时（总时长）'))), o.timeoutMs ?? 180_000)
  let idle: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => ctl.abort(new GlmError(t('请求超时：超过 60 秒没有新内容'))), o.idleMs ?? 60_000)
  }
  try {
    armIdle()
    const res = await f(url, { ...init, signal: ctl.signal })
    if (!res.ok || !res.body) throw await errorFromResponse(res)
    const reader = res.body.getReader()
    ctl.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true })
    const dec = new TextDecoder()
    const parser = new SseParser()
    let full = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (ctl.signal.aborted) throw ctl.signal.reason
      if (done) break
      armIdle()
      for (const data of parser.feed(dec.decode(value, { stream: true }))) {
        const d = partsOf(data)
        if (d === null) return full
        if (d.reasoning) o.onReasoning?.(d.reasoning)
        if (d.content) {
          full += d.content
          onDelta(d.content)
        }
      }
    }
    for (const data of parser.flush()) {
      const d = partsOf(data)
      if (d?.reasoning) o.onReasoning?.(d.reasoning)
      if (d?.content) {
        full += d.content
        onDelta(d.content)
      }
    }
    return full
  } catch (e) {
    throw normalizeError(e, ctl.signal)
  } finally {
    clearTimeout(total)
    if (idle) clearTimeout(idle)
  }
}

async function chatOnceRaw(o: ChatOptions): Promise<string> {
  if (!o.apiKey) throw new GlmError(t('没有 API Key：在设置里填写'))
  const f = o.fetchImpl ?? fetch
  const { url, init } = buildRequest({ ...o, stream: false })
  const ctl = new AbortController()
  linkSignals(o.signal, ctl)
  const total = setTimeout(() => ctl.abort(new GlmError(t('请求超时'))), o.timeoutMs ?? 120_000)
  try {
    const res = await f(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw await errorFromResponse(res)
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { code?: string; message?: string } }
    if (j.error) throw new GlmError(t('AI 错误 {0}：{1}', j.error.code ?? '', j.error.message ?? ''))
    const text = j.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new GlmError(t('AI 返回里没有内容：') + JSON.stringify(j).slice(0, 200))
    return text
  } catch (e) {
    throw normalizeError(e, ctl.signal)
  } finally {
    clearTimeout(total)
  }
}

function normalizeError(e: unknown, signal: AbortSignal): Error {
  if (signal.aborted) {
    const r = signal.reason
    if (r instanceof Error) return r
    return new GlmError(t('已停止'))
  }
  if (e instanceof GlmError) return e
  if (e instanceof Error) return new GlmError(t('网络错误：{0}{1}', e.message, e.cause instanceof Error ? '（' + e.cause.message + '）' : ''))
  return new GlmError(String(e))
}

export async function listModels(apiKey: string, baseUrl = GLM_BASE, fetchImpl: typeof fetch = fetch, headers: Record<string, string> = {}): Promise<string[]> {
  const ctl = new AbortController()
  const t_ = setTimeout(() => ctl.abort(), 15_000)
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}`, ...headers }, signal: ctl.signal })
    if (!res.ok) throw await errorFromResponse(res)
    const j = (await res.json()) as { data?: { id: string }[] }
    return (j.data ?? []).map((m) => m.id)
  } catch (e) {
    throw normalizeError(e, ctl.signal)
  } finally {
    clearTimeout(t_)
  }
}

// 从模型输出里拿 JSON：容忍 ```json 代码块包裹
export function parseJsonLoose<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.search(/[[{]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new GlmError(t('模型没有返回 JSON：') + text.slice(0, 120))
  const json = body.slice(start, end + 1)
  try {
    return JSON.parse(json) as T
  } catch {
    // 模型有时在字符串里直接换行、放制表符（JSON 不许），转义后再解析一次
    return JSON.parse(escapeControls(json)) as T
  }
}

/** 把 JSON 字符串值里没转义的控制字符（换行、制表符等）转义掉，字符串外面的不动 */
export function escapeControls(json: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (inStr && c === '\\') {
      out += c + (json[i + 1] ?? '')
      i++
      continue
    }
    if (c === '"') inStr = !inStr
    const code = c.charCodeAt(0)
    if (inStr && code < 0x20) out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`
    else out += c
  }
  return out
}

// 限流（HTTP 429，1302 之类）等一会儿重试；1113 是余额或端点问题，重试没用
export function isRateLimited(e: unknown): boolean {
  return e instanceof GlmError && e.status === 429 && !/\b1113\b/.test(e.message)
}

// 账号会把请求串行化（约 0.8 次每秒）：所有请求的发起间隔至少 minGapMs，减少 1302 限流
let nextSlot = 0
export const gateConfig = { minGapMs: 1100 }
async function gate(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + gateConfig.minGapMs
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

async function withRetry<T>(o: ChatOptions, fn: () => Promise<T>, canRetry: () => boolean): Promise<T> {
  const delays = o.retryDelays ?? [2000, 4000, 8000, 15000, 30000]
  for (let i = 0; ; i++) {
    try {
      if (!o.fetchImpl && o.serial !== false && (o.serial || !o.baseUrl)) await gate()
      return await fn()
    } catch (e) {
      if (i >= delays.length || !isRateLimited(e) || o.signal?.aborted || !canRetry()) throw e
      await new Promise((r) => setTimeout(r, delays[i] * (0.8 + Math.random() * 0.4)))
    }
  }
}

export function chatStream(o: ChatOptions, onDelta: (text: string) => void): Promise<string> {
  let got = false
  return withRetry(
    o,
    () =>
      chatStreamOnce(o, (d) => {
        got = true
        onDelta(d)
      }),
    () => !got
  )
}

// 带工具调用的一步（不流式）：返回正文和要调用的工具
async function chatToolsRaw(o: ChatOptions): Promise<{ content: string; toolCalls: ToolCall[]; reasoning: string }> {
  if (!o.apiKey) throw new GlmError(t('没有 API Key：在设置里填写'))
  const f = o.fetchImpl ?? fetch
  const { url, init } = buildRequest({ ...o, stream: false })
  const ctl = new AbortController()
  linkSignals(o.signal, ctl)
  const total = setTimeout(() => ctl.abort(new GlmError(t('请求超时'))), o.timeoutMs ?? 180_000)
  try {
    const res = await f(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw await errorFromResponse(res)
    const j = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[]; reasoning_content?: string } }[]
      error?: { code?: string; message?: string }
    }
    if (j.error) throw new GlmError(t('AI 错误 {0}：{1}', j.error.code ?? '', j.error.message ?? ''))
    const m = j.choices?.[0]?.message
    if (!m) throw new GlmError(t('AI 返回里没有内容：') + JSON.stringify(j).slice(0, 200))
    return { content: m.content ?? '', toolCalls: m.tool_calls ?? [], reasoning: m.reasoning_content ?? '' }
  } catch (e) {
    throw normalizeError(e, ctl.signal)
  } finally {
    clearTimeout(total)
  }
}

export function chatTools(o: ChatOptions): Promise<{ content: string; toolCalls: ToolCall[]; reasoning: string }> {
  return withRetry(o, () => chatToolsRaw(o), () => true)
}

export function chatOnce(o: ChatOptions): Promise<string> {
  return withRetry(o, () => chatOnceRaw(o), () => true)
}
