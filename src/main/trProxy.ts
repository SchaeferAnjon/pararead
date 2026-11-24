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
  /** 这一次的用量（进度和花费给界面看） */
  calls = 0

  constructor(private call: (c: ProxyCall, useId: string) => Promise<{ text: string; prompt: number; completion: number }>) {}

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
    if (req.headers.authorization !== `Bearer ${this.token}`) return send(401, { error: { message: 'bad token', type: 'auth' } })
    if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url ?? '')) return send(404, { error: { message: 'not found' } })
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 4_000_000) return send(413, { error: { message: 'too large' } })
    }
    let body: { messages?: ChatMsg[]; response_format?: { type?: string }; max_tokens?: number; model?: string }
    try {
      body = JSON.parse(raw)
    } catch {
      return send(400, { error: { message: 'bad json' } })
    }
    if (!Array.isArray(body.messages) || !body.messages.length) return send(400, { error: { message: 'no messages' } })
    try {
      this.calls++
      const r = await this.call({ messages: body.messages, json: body.response_format?.type === 'json_object', maxTokens: body.max_tokens }, this.useId)
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
      send(status, { error: { message: msg, type: status === 429 ? 'rate_limit_exceeded' : 'upstream_error' } })
    }
  }
}
