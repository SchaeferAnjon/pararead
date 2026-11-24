/**
 * 子进程的标准输入输出上跑 JSON-RPC，一行一条（Codex app-server 和 ACP 都是这样）。
 * 思路参照 Claudian 的 src/core/rpc/JSONRPCTransport.ts（MIT，见 THIRD_PARTY_NOTICES.md）。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { t } from './shared/i18n'

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer?: NodeJS.Timeout }

export class RpcProcess {
  private child: ChildProcess
  private seq = 0
  private pending = new Map<number, Pending>()
  private buf = ''
  private stderr = ''
  private notifyHandlers = new Set<(method: string, params: Record<string, unknown>) => void>()
  private requestHandler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null = null
  closed = false
  readonly exited: Promise<number | null>

  constructor(
    command: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
    /** Codex app-server 的消息不带 "jsonrpc": "2.0" */
    private withHeader = true,
  ) {
    this.child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout!.setEncoding('utf8')
    this.child.stdout!.on('data', (d: string) => this.onData(d))
    this.child.stderr!.setEncoding('utf8')
    this.child.stderr!.on('data', (d: string) => (this.stderr = (this.stderr + d).slice(-4000)))
    this.exited = new Promise((resolve) => {
      this.child.on('error', (e) => {
        this.fail(new Error(t('{name} 启动不了：{error}', { name: command, error: e.message })))
        resolve(null)
      })
      this.child.on('exit', (code) => {
        this.fail(new Error(this.stderr ? t('{name} 退出了（{code}）：{why}', { name: command, code, why: this.stderr.trim().split('\n').slice(-3).join(' ') }) : t('{name} 退出了（{code}）', { name: command, code })))
        resolve(code)
      })
    })
  }

  get lastError(): string {
    return this.stderr.trim()
  }

  private fail(e: Error) {
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(e)
    }
    this.pending.clear()
  }

  private onData(d: string) {
    this.buf += d
    let nl: number
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line.startsWith('{')) continue
      let msg: { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string; code?: number } }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.method && msg.id !== undefined) void this.answer(msg.id, msg.method, msg.params ?? {})
      else if (msg.method) for (const h of this.notifyHandlers) h(msg.method, msg.params ?? {})
      else if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(msg.error.message ?? t('出错了（{code}）', { code: msg.error.code })))
        else p.resolve(msg.result)
      }
    }
  }

  private async answer(id: number | string, method: string, params: Record<string, unknown>) {
    try {
      if (!this.requestHandler) throw new Error(`不支持 ${method}`) // 不翻：回给 AI 进程的协议错误
      this.write({ id, result: await this.requestHandler(method, params) })
    } catch (e) {
      this.write({ id, error: { code: -32603, message: String((e as Error).message ?? e) } })
    }
  }

  private write(msg: Record<string, unknown>) {
    if (this.closed) return
    this.child.stdin!.write(JSON.stringify(this.withHeader ? { jsonrpc: '2.0', ...msg } : msg) + '\n')
  }

  /** timeoutMs 为 0 时不限时（一轮对话可能要很久） */
  request<T = Record<string, unknown>>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error(t('AI 进程已经退出了')))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve: resolve as (v: unknown) => void, reject }
      if (timeoutMs) {
        p.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(t('{name} 等了 {s} 秒没回应', { name: method, s: Math.round(timeoutMs / 1000) })))
        }, timeoutMs)
      }
      this.pending.set(id, p)
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    this.write({ method, params })
  }

  onNotification(h: (method: string, params: Record<string, unknown>) => void): () => void {
    this.notifyHandlers.add(h)
    return () => this.notifyHandlers.delete(h)
  }

  onRequest(h: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
    this.requestHandler = h
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.child.stdin?.end()
    this.child.kill('SIGTERM')
  }
}
