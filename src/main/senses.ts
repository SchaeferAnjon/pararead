// 意群显示要的数据：一段原文加它的译文，问一次 AI 拿到每句、每块怎么对（shared/senses.ts 里定位），按内容缓存。
// 一段一个请求，并发跟翻译一样；后来的请求排在前面（刚滚到的那几段先出）。
import { sensesKey } from '../shared/hash'
import { maskMath, parseSenses, senseGaps, type SenseSentence } from '../shared/senses'
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

// 再问时提到的原文片段也用占位记号写（和发给模型的原文一致）
const unmaskNote = (note: string, en: string): string => {
  const found = [...en.matchAll(/\$[^$\n]+\$/g)].map((m) => m[0])
  return found.reduce((acc, f, i) => acc.split(f).join(`⟦M${i + 1}⟧`), note)
}

const better = (a: { missing: number; cover: number }, b: { missing: number; cover: number }): boolean => a.missing < b.missing || (a.missing === b.missing && a.cover > b.cover)

// 再问一次时说清上次哪里没对上：哪几块原文没给出译文里找得到的片段，译文里哪些字没分给任何一块
function retryNote(data: SenseSentence[], en: string, zh: string): string {
  const lost = data.flatMap((s) => s.chunks.filter((c) => !c.zh.length).map((c) => `「${en.slice(c.en[0], c.en[1])}」`))
  const used = data.flatMap((s) => s.chunks.flatMap((c) => c.zh))
  const left: string[] = []
  let run = ''
  for (let i = 0; i < zh.length; i++) {
    if (used.some(([a, b]) => i >= a && i < b)) {
      if (run.trim().replace(/[\s\p{P}]/gu, '')) left.push(`「${run.trim()}」`)
      run = ''
    } else run += zh[i]
  }
  if (run.trim().replace(/[\s\p{P}]/gu, '')) left.push(`「${run.trim()}」`)
  return [
    '上次的对齐不完整。',
    lost.length ? `这几块原文没有给出能在译文里原样找到的 zh：${lost.join('、')}。` : '',
    left.length ? `译文里这些字没有分给任何一块：${left.slice(0, 8).join('、')}。` : '',
    '每块的 zh 必须是译文里原样的连续片段（被隔开就给数组），各块互不重叠，所有块的 zh 合起来覆盖整句译文。重新输出完整的 JSON。'
  ]
    .filter(Boolean)
    .join('\n')
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
      // 行内公式换成占位记号给模型，回来的片段再换回原样（模型抄不回 MinerU 那种带空格的公式）
      const { masked, unmask } = maskMath(it.en)
      const back = (raw: unknown): unknown => {
        const list = (raw as { sentences?: unknown[] })?.sentences
        if (!Array.isArray(list)) return raw
        return { sentences: list.map((s) => (Array.isArray(s) ? s.map((x: { en?: unknown; zh?: unknown }) => (x && typeof x.en === 'string' ? { ...x, en: unmask(x.en) } : x)) : s)) }
      }
      const msgs = sensesMessages(masked, it.zh)
      const out = await this.o.call(msgs)
      if (this.stopped) return
      let data = parseSenses(back(parseJsonLoose(out)), it.en, it.zh)
      // 对得不全（有原文块没找到译文，或者译文有一成以上没落在任何一块里）：把问题告诉模型，再问一次，留对得全的那份
      const gaps = senseGaps(data, it.zh)
      if (!data.length || gaps.missing > 0 || gaps.cover < 0.9) {
        const retry = await this.o
          .call([...msgs, { role: 'assistant', content: out }, { role: 'user', content: maskMath(it.en).masked === it.en ? retryNote(data, it.en, it.zh) : unmaskNote(retryNote(data, it.en, it.zh), it.en) }])
          .then((o2) => parseSenses(back(parseJsonLoose(o2)), it.en, it.zh))
          .catch(() => [] as SenseSentence[])
        if (this.stopped) return
        if (retry.length && (!data.length || better(senseGaps(retry, it.zh), gaps))) data = retry
      }
      if (!data.length) throw new Error(t('模型给的意群在原文里对不上'))
      this.o.putCached(it.key, JSON.stringify(data))
      this.o.onResult({ paperId: it.paperId, key: it.key, data })
    } catch (e) {
      if (!this.stopped) this.o.onResult({ paperId: it.paperId, key: it.key, error: e instanceof Error ? e.message : String(e) })
    }
  }
}
