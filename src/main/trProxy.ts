// BabelDOC 只会调 OpenAI 兼容的接口。ParaRead 在 127.0.0.1 的随机端口开一个，带一次性令牌，BabelDOC 的 --openai-base-url 指过来；
// 收到的请求按「设置 › 翻译 › 翻译用」转给 DeepSeek、会员服务器或本机 Claude Code（Ai.trOnce）。
// 这样密钥不交给 BabelDOC，会员用量照常记，「批量小请求默认走 DeepSeek / 会员」这条规矩只在 ParaRead 一处管。
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ChatMsg } from './glm'
import { trErrKind, type TrErrKind } from '../shared/layoutTr'
import { withTrRetry, type RetryOpts } from './trRetry'

export interface ProxyCall {
  messages: ChatMsg[]
  json: boolean
  maxTokens?: number
}

export class TrProxy {
  private server: Server | null = null
  private port = 0
  readonly token = randomBytes(24).toString('hex')
  /** 这一批的请求数、失败数和最后一个错（BabelDOC 碰到失败的请求不报错，只把那段留原文，这里记着给 babeldoc.ts 判断、写日志） */
  calls = 0
  failed = 0
  lastError = ''
  /** 最后一个错是哪一类（trErrKind；重试过了还失败的才算） */
  lastKind: TrErrKind | null = null
  resetStats(): void {
    this.calls = 0
    this.failed = 0
    this.lastError = ''
    this.lastKind = null
    this.retries = 0
  }
  /** 每个请求的起止、状态码和错（测试模式的量速度脚本 scripts/e2e/tr-bench.mjs 读，最多留 5000 条） */
  records: { at: number; ms: number; status: number; error?: string }[] = []

  constructor(
    private call: (c: ProxyCall, useId: string, signal: AbortSignal) => Promise<{ text: string; prompt: number; completion: number }>,
    private onFail: (msg: string) => void = () => {},
    /** 一次请求最多等多久（毫秒，超了算超时、按 trRetry 重试）和重试的等法；测试里缩短 */
    private opts: { attemptMs?: () => number; retry?: RetryOpts } = {}
  ) {}

  /** 正在等翻译服务回的请求数（量并发） */
  inFlight = 0
  /** 重试过的请求次数（这一批） */
  retries = 0

  /** 转一个请求给翻译服务：每次最多等 attemptMs，失败按错的种类重试（限流等久一点，Key 不对马上报），空译文也重试 */
  private forward(c: ProxyCall, useId: string): Promise<{ text: string; prompt: number; completion: number }> {
    return withTrRetry(async () => {
      const ctl = new AbortController()
      const ms = this.opts.attemptMs?.() ?? 90_000
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = Object.assign(new Error(`timeout after ${Math.round(ms / 1000)}s`), { kind: 'timeout' as TrErrKind })
      // 翻译服务不理 signal 时也照样按时放弃这一次（Promise.race）
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(late)
          ctl.abort(late)
        }, ms)
      })
      this.inFlight++
      try {
        const r = await Promise.race([this.call(c, useId, ctl.signal), timeout])
        if (!r.text.trim()) throw Object.assign(new Error('empty translation'), { kind: 'empty' as TrErrKind })
        return r
      } catch (e) {
        // 超时掐断时翻译服务那头报的是「已停止」之类：一律算超时
        throw ctl.signal.aborted ? late : e
      } finally {
        this.inFlight--
        clearTimeout(timer)
      }
    }, { ...this.opts.retry, onRetry: (n, kind, e) => (this.retries++, this.opts.retry?.onRetry?.(n, kind, e)) })
  }

  /** 起在 127.0.0.1 的随机端口，返回给 BabelDOC 的 base url */
  async start(): Promise<string> {
    if (!this.server) {
      this.server = createServer((req, res) => void this.handle(req, res))
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(0, '127.0.0.1', () => resolve())
      })
      this.port = (this.server.address() as AddressInfo).port
    }
    return `http://127.0.0.1:${this.port}/v1`
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** 用量号：同一篇论文的翻译共用一个（会员一篇算一次），换篇换号 */
  useId = 'layout-tr'

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const at = Date.now()
    const send = (code: number, body: unknown): void => {
      if (this.records.length < 5000) this.records.push({ at, ms: Date.now() - at, status: code, ...(code === 200 ? {} : { error: (body as { error?: { message?: string } }).error?.message?.slice(0, 300) }) })
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    // 失败一律回 5xx 并带 x-should-retry: false：重试已经在 ParaRead 这头按错的种类做过了（trRetry.ts），
    // BabelDOC 用的 openai 库再自己重试两遍只是白等；回 429 它会一直重试（最多 100 次），也不回
    const fail = (code: number, message: string, type = 'invalid_request_error', kind: TrErrKind = trErrKind(message, code)): void => {
      this.failed++
      this.lastError = message
      this.lastKind = kind
      this.onFail(message)
      res.setHeader('x-should-retry', 'false')
      send(code, { error: { message, type } })
    }
    this.calls++
    if (req.headers.authorization !== `Bearer ${this.token}`) return fail(401, 'bad token', 'auth')
    if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url ?? '')) return fail(404, `not found: ${req.method} ${req.url}`)
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 4_000_000) return fail(413, 'too large')
    }
    let body: { messages?: ChatMsg[]; response_format?: { type?: string }; max_tokens?: number; model?: string }
    try {
      body = JSON.parse(raw)
    } catch {
      return fail(400, 'bad json')
    }
    if (!Array.isArray(body.messages) || !body.messages.length) return fail(400, 'no messages')
    try {
      const r = await this.forward({ messages: body.messages, json: body.response_format?.type === 'json_object', maxTokens: body.max_tokens }, this.useId)
      // 空译文 BabelDOC 也当成功、把那段留原文：当失败回
      if (!r.text.trim()) return fail(502, 'empty translation', 'upstream_error', 'empty')
      send(200, {
        id: `pr-${randomBytes(6).toString('hex')}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'pararead',
        choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: r.prompt, completion_tokens: r.completion, total_tokens: r.prompt + r.completion }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const kind = (e as { kind?: TrErrKind }).kind ?? trErrKind(msg, (e as { status?: number }).status)
      fail(502, msg, 'upstream_error', kind)
    }
  }
}
