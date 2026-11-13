// 意群显示要的数据：一段原文加它的译文，问一次 AI 拿到每句、每块怎么对（shared/senses.ts 里定位），按内容缓存。
// 一段一个请求，并发跟翻译一样；后来的请求排在前面（刚滚到的那几段先出）。
import { sensesKey } from '../shared/hash'
import { parseSenses, type SenseSentence } from '../shared/senses'
import { t } from '../shared/i18n'
import { parseJsonLoose, type ChatMsg } from './glm'
import { sensesMessages } from './prompts'

interface Item {
  paperId: string
  key: string
  en: string
  zh: string
}

export interface SenseQueueOptions {
  getCached: (key: string) => string | null
  putCached: (key: string, json: string) => void
  call: (messages: ChatMsg[]) => Promise<string>
  onResult: (r: { paperId: string; key: string; data?: SenseSentence[]; error?: string }) => void
  concurrency: () => number
}

export class SenseQueue {
  private queue: Item[] = []
  private inflight = new Set<string>()
  private running = 0
  private stopped = false

  constructor(private o: SenseQueueOptions) {}

  /** 返回已经缓存的；没有的进队列，结果通过 onResult 推回 */
  request(paperId: string, items: { en: string; zh: string }[]): Record<string, SenseSentence[]> {
    const cached: Record<string, SenseSentence[]> = {}
    const fresh: Item[] = []
    for (const it of items) {
      const key = sensesKey(it.en, it.zh)
      const hit = this.o.getCached(key)
      if (hit !== null) cached[key] = JSON.parse(hit) as SenseSentence[]
      else if (!this.inflight.has(key) && !this.queue.some((q) => q.key === key) && !fresh.some((q) => q.key === key)) fresh.push({ paperId, key, en: it.en, zh: it.zh })
    }
    this.queue.unshift(...fresh)
    this.pump()
    return cached
  }

  cancel(paperId: string): void {
    this.queue = this.queue.filter((q) => q.paperId !== paperId)
  }

  // 退出应用时：丢掉队列，在路上的结果不再写缓存（数据库马上要关）
  stop(): void {
    this.stopped = true
    this.queue = []
  }

  private pump(): void {
    while (this.running < this.o.concurrency() && this.queue.length) {
      const it = this.queue.shift()!
      this.running++
      this.inflight.add(it.key)
      void this.run(it).finally(() => {
        this.running--
        this.inflight.delete(it.key)
        this.pump()
      })
    }
  }

  private async run(it: Item): Promise<void> {
    try {
      const out = await this.o.call(sensesMessages(it.en, it.zh))
      if (this.stopped) return
      const data = parseSenses(parseJsonLoose(out), it.en, it.zh)
      if (!data.length) throw new Error(t('模型给的意群在原文里对不上'))
      this.o.putCached(it.key, JSON.stringify(data))
      this.o.onResult({ paperId: it.paperId, key: it.key, data })
    } catch (e) {
      if (!this.stopped) this.o.onResult({ paperId: it.paperId, key: it.key, error: e instanceof Error ? e.message : String(e) })
    }
  }
}
