/**
 * 出卡（task-tz7y3，方向 B「AI 先改成卡，一张张过」）：读 PDF 时问过的一问改成一张 Anki 卡的字。
 * 卡的四样字和 ChatCards的 CardDraft 一样：问题 q、答案 a、补充 more（一行一条）、原文摘句 quote。
 * 判重、核规矩都是纯函数，主进程送 Anki、测试真 AI 出的卡都用这里。
 */

export interface CardText {
  q: string
  a: string
  /** 补充：一行一条，最多 3 条；没有是空串 */
  more: string
  /** 原文摘句：材料里原样的一句（旁支那一问是被问的那一句） */
  quote: string
}

/**
 * 两个问题是不是同一个：忽略大小写、空白和标点（和 anki-learn CardMaker.key 同一个判断：Swift 的 isWhitespace、isPunctuation）。
 * 同一批里问题一样的只送第一张；牌组里已经有的由 Anki 自己按第一个字段判（duplicateScope: deck）
 */
export const cardKey = (q: string): string => q.toLowerCase().replace(/[\s\p{P}]/gu, '')

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.trim().slice(0, max) : null)

/** 一张卡的字从外面来（AI 的回答、界面交来的）：四样都是字、问题答案不空，过长的截掉；不对是 null */
export function cardText(x: unknown): CardText | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const q = str(o.q, 400)
  const a = str(o.a, 2000)
  if (!q || !a) return null
  // AI 偶尔把补充写成数组
  const more = Array.isArray(o.more) ? o.more.filter((m): m is string => typeof m === 'string').join('\n') : (str(o.more, 1200) ?? '')
  return { q, a, more: more.trim().slice(0, 1200), quote: str(o.quote, 400) ?? '' }
}

/**
 * AI 一行回一张（「{"id":"3","q":…}」）：读出编号和卡；代码块的围栏、空行、说的别的话跳过。
 * 也认 ChatCards 那种整个 {"cards":[…]} 一次给的（每张带 id）
 */
export function parseCardLines(text: string): { id: string; card: CardText }[] {
  const out: { id: string; card: CardText }[] = []
  const take = (o: unknown) => {
    const id = (o as { id?: unknown })?.id
    const card = cardText(o)
    if ((typeof id === 'string' || typeof id === 'number') && card) out.push({ id: String(id), card })
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^```\w*$/, '').replace(/,$/, '')
    if (!line.startsWith('{')) continue
    try {
      const j = JSON.parse(line) as unknown
      if (j && typeof j === 'object' && Array.isArray((j as { cards?: unknown }).cards)) (j as { cards: unknown[] }).cards.forEach(take)
      else take(j)
    } catch {
      // 半行（还在生成）或者不是 JSON：等下一次整行再读
    }
  }
  return out
}

/**
 * 数答案有几个字（「答案最好不超过 40 个字」）：照念出来数，汉字、标点一个算一个，英文单词、数字一串算一个（spike、FLOP、640），
 * 公式里的 \beta 算一个，记号（$ ` ** { } ^ _）和空格不算
 */
export const plainLength = (s: string): number =>
  (
    s
      .replace(/\\[a-zA-Z]+/g, 'x')
      .replace(/[$`{}^_]|\*\*/g, '')
      .match(/[A-Za-z0-9]+|\S/gu) ?? []
  ).length

/** 离开那一页就看不懂的指代：这三条、这张图、上面那个、这里、这个公式…… */
const DEICTIC = /(这|那)(几|三|两|一)?(条|张|个|段|页|里|些|幅|块|句|步)|上面|下面|前面那|刚才|图中|如图|本页|这一页|本讲/

/**
 * 一张卡守不守 ChatCards 的出卡规矩（真 AI 出卡的测试用来核）：问题离开那一页也看得懂、答案尽量不超过 40 个字、
 * 带一句原文摘句并且真是材料里原样的一句。返回违反的那几条（空的就是都守了）
 */
export function cardProblems(card: CardText, material: string): string[] {
  const out: string[] = []
  if (DEICTIC.test(card.q)) out.push(`问题里有离开那一页看不懂的指代：${card.q}`)
  if (plainLength(card.a) > 40) out.push(`答案 ${plainLength(card.a)} 个字，超过 40：${card.a}`)
  const more = card.more.split('\n').filter((l) => l.trim())
  if (more.length > 3) out.push(`补充 ${more.length} 条，超过 3 条`)
  if (!card.quote) out.push('没有原文摘句')
  else if (!squash(material).includes(squash(card.quote))) out.push(`原文摘句不是材料里原样的一句：${card.quote}`)
  return out
}

/** 比原文摘句时不管空白和公式记号（AI 摘的时候常把 $ 和换行去掉） */
const squash = (s: string) => s.replace(/[\s$`*]/g, '')
