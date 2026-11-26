// 保版面翻译的一个请求失败了怎么办（2026-11-25「翻译不稳定、老出错」）：按错的种类等一会再试，Key、余额这类试了也没用的马上报。
// BabelDOC 碰到失败的请求不报错，只把那一段留原文，所以重试要在 ParaRead 这头做（trProxy 的请求经这里转给 Ai.trOnce）。
import { trErrKind, type TrErrKind } from '../shared/layoutTr'

/** 每种错重试前等多久（毫秒，实际再乘 0.8～1.2 的随机数，免得几路同时重来又一起撞上限流）；空的是不重试 */
export const RETRY_DELAYS: Record<TrErrKind, number[]> = {
  rate: [2000, 5000, 10_000, 20_000, 30_000],
  timeout: [1000, 3000],
  server: [1000, 3000, 8000],
  network: [1000, 3000, 8000],
  empty: [500, 2000],
  auth: [],
  balance: [],
  layout: [],
  scanned: [],
  same: [],
  other: [1000]
}

export interface RetryOpts {
  delays?: Partial<Record<TrErrKind, number[]>>
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
  /** 要重试了（第几次、什么错） */
  onRetry?: (attempt: number, kind: TrErrKind, e: Error) => void
  /** 不加随机（测试用） */
  noJitter?: boolean
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 跑 fn，失败按 trErrKind 分类重试；最后一次的错原样抛出，带上 kind 和试了几次 */
export async function withTrRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts = {}): Promise<T> {
  const sleep = o.sleep ?? realSleep
  const used: Partial<Record<TrErrKind, number>> = {}
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      const kind = (e as { kind?: TrErrKind }).kind ?? trErrKind(e.message, (e as { status?: number }).status)
      const list = o.delays?.[kind] ?? RETRY_DELAYS[kind]
      const n = used[kind] ?? 0
      if (o.signal?.aborted || n >= list.length) {
        Object.assign(e, { kind, attempts: attempt })
        throw e
      }
      used[kind] = n + 1
      o.onRetry?.(attempt, kind, e)
      await sleep(list[n] * (o.noJitter ? 1 : 0.8 + Math.random() * 0.4))
    }
  }
}
