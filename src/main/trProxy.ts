// BabelDOC 只会调 OpenAI 兼容的接口。ParaRead 在 127.0.0.1 的随机端口开一个，带一次性令牌，BabelDOC 的 --openai-base-url 指过来；
// 收到的请求按「设置 › 翻译 › 翻译用」转给 DeepSeek、会员服务器或本机 Claude Code（Ai.trOnce）。
// 这样密钥不交给 BabelDOC，会员用量照常记，「批量小请求默认走 DeepSeek / 会员」这条规矩只在 ParaRead 一处管。
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ChatMsg } from './glm'

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
  resetStats(): void {
    this.calls = 0
    this.failed = 0
    this.lastError = ''
  }

  constructor(
    private call: (c: ProxyCall, useId: string) => Promise<{ text: string; prompt: number; completion: number }>,
    private onFail: (msg: string) => void = () => {}
  ) {}

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
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const fail = (code: number, message: string, type = 'invalid_request_error'): void => {
      // 限流 BabelDOC 会等一会再试，不算失败
      if (code !== 429) {
        this.failed++
        this.lastError = message
        this.onFail(message)
      }
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
      const r = await this.call({ messages: body.messages, json: body.response_format?.type === 'json_object', maxTokens: body.max_tokens }, this.useId)
      // 空译文 BabelDOC 也当成功、把那段留原文：当失败回
      if (!r.text.trim()) return fail(502, 'empty translation', 'upstream_error')
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
      // 限流原样回 429：BabelDOC 碰到 429 会自己等一会再试，别的错它会跳过这一段（这段留原文）
      const status = (e as { status?: number }).status === 429 || /429|rate/i.test(msg) ? 429 : 502
      fail(status, msg, status === 429 ? 'rate_limit_exceeded' : 'upstream_error')
    }
  }
}
