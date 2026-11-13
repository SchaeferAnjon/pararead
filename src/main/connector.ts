// 浏览器插件的接收口：只听本机（127.0.0.1），插件把论文页上认出来的信息和它带着登录状态下载到的 PDF 发过来，存进文献库。
// 网页自己不能往这里发：请求要带 X-ParaRead-Connector 这个头（浏览器会先发预检），预检只对浏览器扩展的来源放行；
// Host 也要是本机，防别的域名解析到 127.0.0.1。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { MetaPatch } from './meta'

export const CONNECTOR_PORT = 27485
const MAX_BODY = 120 * 1024 * 1024

export interface Capture {
  url: string // 论文页的地址
  meta: MetaPatch & { title: string }
  pdfUrl: string | null
  pdf: string | null // 插件下载到的 PDF（base64）；没下到是 null，应用再自己试一次
}
export interface CaptureResult {
  status: 'added' | 'duplicate' | 'link' | 'failed'
  title: string
  error?: string
}

const fromExtension = (origin: string | undefined): boolean => !!origin && /^(chrome|moz|safari-web)-extension:\/\//.test(origin)

export class Connector {
  private server: Server | null = null
  error = ''

  constructor(private o: { version: string; save: (c: Capture) => Promise<CaptureResult>; log: (m: string) => void }) {}

  get running(): boolean {
    return !!this.server?.listening
  }

  start(): void {
    const server = createServer((req, res) => void this.handle(req, res).catch((e: Error) => this.send(res, req, 500, { error: e.message })))
    server.on('error', (e: Error) => {
      this.error = e.message
      this.o.log(`浏览器插件的接收口没开起来：${e.message}`)
    })
    server.listen(CONNECTOR_PORT, '127.0.0.1')
    this.server = server
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private send(res: ServerResponse, req: IncomingMessage, code: number, body: unknown): void {
    const origin = req.headers.origin
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(fromExtension(origin) ? { 'Access-Control-Allow-Origin': origin!, 'Access-Control-Allow-Headers': 'Content-Type, X-ParaRead-Connector', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } : {})
    })
    res.end(JSON.stringify(body))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')) return this.send(res, req, 403, { error: 'host' })
    if (req.method === 'OPTIONS') return this.send(res, req, fromExtension(req.headers.origin) ? 204 : 403, {})
    if (req.headers['x-pararead-connector'] !== '1' || (req.headers.origin && !fromExtension(req.headers.origin))) return this.send(res, req, 403, { error: 'origin' })
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/ping') return this.send(res, req, 200, { app: 'ParaRead', version: this.o.version })
    if (req.method === 'POST' && path === '/save') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const c of req) {
        size += (c as Buffer).length
        if (size > MAX_BODY) return this.send(res, req, 413, { error: 'too large' })
        chunks.push(c as Buffer)
      }
      const cap = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Capture
      if (!cap || typeof cap.url !== 'string' || typeof cap.meta?.title !== 'string' || !cap.meta.title.trim()) return this.send(res, req, 400, { error: 'bad capture' })
      return this.send(res, req, 200, await this.o.save(cap))
    }
    this.send(res, req, 404, { error: 'not found' })
  }
}
