import { translationKey } from '../shared/hash'
import { t as i18n } from '../shared/i18n'
import type { ChatMsg } from './glm'
import { buildTranslateBatch, parseTranslateBatch } from './prompts'

export interface TransItem {
  key: string
  text: string
  paperId: string
}

export interface TranslatorOptions {
  lang: () => string
  getCached: (key: string) => string | null
  putCached: (key: string, text: string) => void
  call: (messages: ChatMsg[]) => Promise<string>
  onResult: (r: { paperId: string; key: string; text?: string; error?: string }) => void
  concurrency?: () => number
  maxBatchChars?: number
  maxBatchItems?: number
  debounceMs?: number
}

// 把几段合并成一次请求（账号会把请求串行化，约 0.8 次每秒），并发不超过 3，结果按段落哈希缓存。
export function makeBatches(items: TransItem[], maxChars: number, maxItems: number): TransItem[][] {
  const batches: TransItem[][] = []
  let cur: TransItem[] = []
  let chars = 0
  for (const it of items) {
    if (cur.length && (chars + it.text.length > maxChars || cur.length >= maxItems)) {
      batches.push(cur)
      cur = []
      chars = 0
    }
    cur.push(it)
    chars += it.text.length
  }
  if (cur.length) batches.push(cur)
  return batches
}

export class Translator {
  private pending: TransItem[] = []
  private inflight = new Set<string>()
  private running = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private batches: TransItem[][] = []
  private stopped = false

  constructor(private o: TranslatorOptions) {}

  keyFor(text: string): string {
    return translationKey(text, this.o.lang())
  }

  // 返回已缓存的译文；没缓存的进队列，结果通过 onResult 推回
  request(paperId: string, texts: { text: string; key?: string }[], priority = false): Record<string, string> {
    const cached: Record<string, string> = {}
    const fresh: TransItem[] = []
    for (const t of texts) {
      const key = this.keyFor(t.text)
      const hit = this.o.getCached(key)
      if (hit !== null) cached[key] = hit
      else if (!this.inflight.has(key) && !this.pending.some((p) => p.key === key) && !this.batches.some((b) => b.some((p) => p.key === key)))
        fresh.push({ key, text: t.text, paperId })
    }
    if (priority) this.pending.unshift(...fresh)
    else this.pending.push(...fresh)
    if (fresh.length) this.schedule()
    return cached
  }

  // 退出应用时：丢掉队列，在路上的结果不再写缓存（数据库马上要关）
  stop(): void {
    this.stopped = true
    this.pending = []
    this.batches = []
  }

  cancel(paperId: string): void {
    this.pending = this.pending.filter((p) => p.paperId !== paperId)
    this.batches = this.batches.map((b) => b.filter((p) => p.paperId !== paperId)).filter((b) => b.length)
  }

  queued(paperId: string): number {
    return (
      this.pending.filter((p) => p.paperId === paperId).length +
      this.batches.reduce((n, b) => n + b.filter((p) => p.paperId === paperId).length, 0)
    )
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.batches.push(...makeBatches(this.pending.splice(0), this.o.maxBatchChars ?? 2800, this.o.maxBatchItems ?? 5))
      this.pump()
    }, this.o.debounceMs ?? 120)
  }

  private pump(): void {
    const max = this.o.concurrency?.() ?? 3
    while (this.running < max && this.batches.length) {
      const batch = this.batches.shift()!
      this.running++
      for (const it of batch) this.inflight.add(it.key)
      void this.runBatch(batch).finally(() => {
        this.running--
        for (const it of batch) this.inflight.delete(it.key)
        this.pump()
      })
    }
  }

  private async runBatch(batch: TransItem[]): Promise<void> {
    const ids = batch.map((_, i) => String(i + 1))
    try {
      const out = await this.o.call(buildTranslateBatch(batch.map((b, i) => ({ id: ids[i], text: b.text })), this.o.lang()))
      if (this.stopped) return
      const map = parseTranslateBatch(out)
      // 单段请求时模型偶尔不带 seg 标签，整段当译文
      if (batch.length === 1 && !map.size && out.trim()) map.set('1', out.trim())
      batch.forEach((b, i) => {
        const t = map.get(ids[i])
        if (t) {
          this.o.putCached(b.key, t)
          this.o.onResult({ paperId: b.paperId, key: b.key, text: t })
        } else this.o.onResult({ paperId: b.paperId, key: b.key, error: i18n('译文缺这一段') })
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      for (const b of batch) this.o.onResult({ paperId: b.paperId, key: b.key, error: msg })
    }
  }
}
