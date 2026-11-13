// 按标签讲解（「看不懂」「有质疑」，方向 B：攒着一起讲）：状态、讲解的分节格式、过一遍的顺序、问作者清单。
// 只管数据，主进程和界面共用。模型的输出是一节一个标签（<one>…</one>），节里一行一条、字段用 || 隔开；
// 流式到一半时只认已经闭合的节，界面按节出、没到的放骨架。
import { t } from './i18n'
import { cyrb53 } from './hash'
import { plain } from './refs'
import type { SenseSentence } from './senses'
import type { Annotation, ExplainRecord, ExplainVersion, LabelStatus } from './types'

export const STATUS_NAME: Record<LabelStatus, string> = {
  open: t('还没懂'),
  understood: t('懂了'),
  pending: t('待判断'),
  upheld: t('质疑成立'),
  dismissed: t('质疑不成立'),
  checking: t('还要查')
}
/** 状态的小圆点：ok 绿、bad 红、wait 黄、空是灰 */
export const STATUS_TONE: Record<LabelStatus, 'ok' | 'bad' | 'wait' | ''> = { open: 'wait', understood: 'ok', pending: 'wait', upheld: 'bad', dismissed: '', checking: 'wait' }

type Labeled = Pick<Annotation, 'label' | 'labelStatus'>

/** 这条标签现在的状态；没存过的：看不懂算还没懂，有质疑算待判断 */
export function statusOf(a: Labeled): LabelStatus | null {
  if (!a.label) return null
  if (a.labelStatus && (a.label === 'confused' ? ['open', 'understood'] : ['pending', 'upheld', 'dismissed', 'checking']).includes(a.labelStatus)) return a.labelStatus
  return a.label === 'confused' ? 'open' : 'pending'
}

/** 还要你处理的：还没懂、待判断、还要查（数字、过一遍、节末那一行都只数这些） */
export function isOpen(a: Labeled): boolean {
  const s = statusOf(a)
  return s === 'open' || s === 'pending' || s === 'checking'
}

/** 了结了的：懂了、质疑不成立（正文里的波浪线变淡） */
export function isSettled(a: Labeled): boolean {
  const s = statusOf(a)
  return s === 'understood' || s === 'dismissed'
}

export function latest(rec: ExplainRecord | null | undefined): ExplainVersion | null {
  return rec?.versions.length ? rec.versions[rec.versions.length - 1] : null
}

// ---------- 分节格式 ----------

/** 已经闭合的节（标签名 → 里面的字）；属性写在开标签里的（<lean v="…">）不用，格式里不出现 */
export function sections(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of raw.matchAll(/<([a-z]+)>([\s\S]*?)<\/\1>/g)) if (!out.has(m[1])) out.set(m[1], m[2].trim())
  return out
}

const lines = (s: string | undefined): string[] =>
  (s ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)、])\s+/, '').trim())
    .filter(Boolean)
const fields = (l: string): string[] => l.split('||').map((x) => x.trim())

// 「卡在哪」的几处：一行一处，模型把两处写在一行用 || 隔开的也拆开
const focusOf = (s: string | undefined): string[] => lines(s).flatMap(fields).filter(Boolean).slice(0, 3)

export interface Quiz {
  q: string
  options: { text: string; ok: boolean; why: string }[]
}

function quizOf(s: string | undefined): Quiz | null {
  if (!s) return null
  const ls = s.split('\n').map((l) => l.trim()).filter(Boolean)
  // 模型偶尔漏了题干：给一句通用的，选项照样能做
  const q = (ls.find((l) => !/^[+-]\s/.test(l)) ?? t('下面哪一个说得对？')).replace(/^(问题|题目|Q)\s*[:：]\s*/i, '')
  const options = ls
    .filter((l) => /^[+-]\s/.test(l))
    .map((l) => {
      const [text, why = ''] = fields(l.slice(1).trim())
      return { text, ok: l.startsWith('+'), why }
    })
    .filter((o) => o.text)
  if (options.length < 2 || options.filter((o) => o.ok).length !== 1) return null
  return { q, options }
}

export interface ConfusedView {
  focus: string[]
  one: string | null
  chunks: { en: string; zh: string }[] | null
  pre: { term: string; text: string }[] | null
  example: string | null
  refs: { where: string; what: string; quote: string }[] | null
  quiz: Quiz | null
}

/** 看不懂的讲解：一句话、拆开看、先要知道、举个例子、这篇里、考你一下。没到（或没给）的节是 null */
export function parseConfused(raw: string): ConfusedView {
  const s = sections(raw)
  const has = (k: string): boolean => s.has(k)
  return {
    focus: focusOf(s.get('focus')),
    one: has('one') ? s.get('one')! : null,
    chunks: has('chunks')
      ? lines(s.get('chunks'))
          .map(fields)
          .filter((f) => f[0] && f[1])
          .map(([en, zh]) => ({ en, zh }))
      : null,
    pre: has('pre')
      ? lines(s.get('pre'))
          .map(fields)
          .filter((f) => f[0])
          .map(([term, text = '']) => ({ term, text }))
      : null,
    example: has('example') ? s.get('example')! : null,
    refs: has('refs')
      ? lines(s.get('refs'))
          .map(fields)
          .filter((f) => f[0] && f[1])
          .map(([where, what, quote = '']) => ({ where, what, quote }))
      : null,
    quiz: has('quiz') ? quizOf(s.get('quiz')) : null
  }
}

export type Strength = 'g' | 'y' | 'r'
export interface DoubtView {
  focus: string[]
  says: { tag: string; text: string } | null
  evidence: { level: Strength; tag: string; text: string; quote: string }[] | null
  assume: string[] | null
  lit: { n: number; rel: string; note: string }[] | null
  asks: string[] | null
  lean: { v: 'upheld' | 'dismissed' | 'checking'; why: string } | null
}

/** 有质疑的讲解：它在说、论文自己的依据、没说出来的前提、别的文献、可以问作者、AI 的看法 */
export function parseDoubt(raw: string): DoubtView {
  const s = sections(raw)
  const says = s.has('says') ? fields(s.get('says')!.split('\n').join(' ')) : null
  const lean = s.has('lean') ? fields(s.get('lean')!.split('\n').join(' ')) : null
  const leanV = lean?.[0].toLowerCase().match(/upheld|dismissed|checking/)?.[0] as 'upheld' | 'dismissed' | 'checking' | undefined
  return {
    focus: focusOf(s.get('focus')),
    says: says ? (says.length > 1 ? { tag: says[0], text: says.slice(1).join(' ') } : { tag: '', text: says[0] }) : null,
    evidence: s.has('evidence')
      ? lines(s.get('evidence'))
          .map(fields)
          .filter((f) => f.length >= 3)
          .map(([lv, tag, text, quote = '']) => ({ level: (/^[gyr]$/i.test(lv) ? lv.toLowerCase() : 'y') as Strength, tag, text, quote }))
      : null,
    assume: s.has('assume') ? lines(s.get('assume')) : null,
    lit: s.has('lit')
      ? lines(s.get('lit'))
          .map(fields)
          .map(([n, rel = '', note = '']) => ({ n: Number(n.replace(/^L/i, '')), rel, note }))
          .filter((x) => Number.isInteger(x.n) && x.n > 0)
      : null,
    asks: s.has('asks') ? lines(s.get('asks')).filter((l) => l !== '无') : null,
    lean: leanV ? { v: leanV, why: lean!.slice(1).join(' ') } : null
  }
}

export interface GroupView {
  root: string | null
  steps: string[] | null
  back: { n: number; text: string }[] | null
  quiz: Quiz | null
}

/** 几处一起讲：共同卡点、先把这件事讲清楚、回到每一处、考你一下 */
export function parseGroup(raw: string): GroupView {
  const s = sections(raw)
  return {
    root: s.has('root') ? s.get('root')! : null,
    steps: s.has('steps') ? lines(s.get('steps')) : null,
    back: s.has('back')
      ? lines(s.get('back'))
          .map(fields)
          .map(([n, text = '']) => ({ n: Number(n.replace(/^#/, '')), text }))
          .filter((x) => Number.isInteger(x.n) && x.n > 0 && x.text)
      : null,
    quiz: s.has('quiz') ? quizOf(s.get('quiz')) : null
  }
}

/** 一句话讲解（笔记里、悬停提示、导出用）：看不懂取「一句话」，有质疑取 AI 的看法 */
export function summaryOf(a: Pick<Annotation, 'label' | 'explain'>): string {
  const v = latest(a.explain)
  if (!v || !a.label) return a.explain?.group ? (parseGroup(a.explain.group.raw).root ?? '') : ''
  if (a.label === 'confused') return parseConfused(v.raw).one ?? ''
  const d = parseDoubt(v.raw)
  return d.lean?.why || d.says?.text || ''
}

/** 可以问作者的问题：最近一版讲解里的 */
export function asksOf(a: Pick<Annotation, 'label' | 'explain'>): string[] {
  const v = latest(a.explain)
  return a.label === 'doubt' && v ? (parseDoubt(v.raw).asks ?? []) : []
}

// ---------- 过一遍、节末 ----------

/** 过一遍的顺序：按在文中的先后（对照模式按段的次序和位置，原文模式按页和高度），只要还要处理的 */
export function walkOrder<A extends Annotation>(anns: A[], blockOrder: Map<string, number>): A[] {
  const key = (a: A): [number, number] => {
    if (a.mode === 'reflow' && a.blockId) return [blockOrder.get(a.blockId.replace(/:tr$/, '')) ?? 1e6, a.start ?? 0]
    return [(a.page ?? 999) * 1000 + Math.round((a.rects?.[0]?.[1] ?? 0) * 999), 0]
  }
  return anns
    .filter((a) => a.label && isOpen(a))
    .sort((x, y) => {
      const [a1, a2] = key(x)
      const [b1, b2] = key(y)
      return a1 - b1 || a2 - b2 || x.createdAt - y.createdAt
    })
}

/** 一节里还要处理的几处：看不懂几处、有质疑几处 */
export function openCounts(anns: Labeled[]): { confused: number; doubt: number } {
  let confused = 0
  let doubt = 0
  for (const a of anns) if (a.label && isOpen(a)) a.label === 'confused' ? confused++ : doubt++
  return { confused, doubt }
}

/** 几处一起讲的那一段按这几处（不论先后）认 */
export function groupKey(ids: string[]): string {
  return cyrb53([...ids].sort().join(','))
}

// ---------- 学术检索、问作者清单 ----------

const STOP = new Set(
  'about above after again against among another because before being below between both could does doing during each either every first from further have having here into itself just least less many more most much must never only other over same several should since some such than that their them then there these they this those through thus under until upon very were what when where which while whose will with within would yields shown show shows paper propose proposed approach method results using used based also however therefore'.split(
    ' '
  )
)

/**
 * 查「别的文献」用的检索词：这句里出现的术语（长的先，最多 3 个），再补这句里几个实词，凑到 6 个词以内。
 * 学术检索（OpenAlex 等）按题名和摘要的相关度排，词太多反而查不到。
 */
export function litQuery(sentence: string, terms: string[], title: string): string {
  const text = plain(sentence)
  const low = text.toLowerCase()
  const picked: string[] = []
  for (const x of [...terms].sort((a, b) => b.length - a.length)) {
    const k = x.trim()
    if (k.length >= 3 && low.includes(k.toLowerCase()) && !picked.some((p) => p.toLowerCase().includes(k.toLowerCase())) && picked.length < 3) picked.push(k)
  }
  const words = picked.join(' ').split(/\s+/).filter(Boolean)
  const seen = new Set(words.map((w) => w.toLowerCase()))
  for (const w of text.match(/[A-Za-z][A-Za-z-]{4,}/g) ?? []) {
    if (words.length >= 6) break
    const k = w.toLowerCase()
    if (STOP.has(k) || seen.has(k)) continue
    seen.add(k)
    words.push(w)
  }
  if (words.length < 3) for (const w of plain(title).match(/[A-Za-z][A-Za-z-]{3,}/g) ?? []) if (words.length < 5 && !seen.has(w.toLowerCase()) && !STOP.has(w.toLowerCase())) (seen.add(w.toLowerCase()), words.push(w))
  return words.join(' ')
}

/** 段落里引用了参考文献表的哪几条：[16]、[3]–[5] 展开后的编号 */
export function citedIn(md: string): string[] {
  const out: string[] = []
  for (const m of plain(md).replace(/\]\s*[–—-]\s*\[/g, '–').matchAll(/\[(\d{1,4}(?:\s*[–—-]\s*\d{1,4})?(?:\s*,\s*\d{1,4}(?:\s*[–—-]\s*\d{1,4})?)*)\]/g))
    for (const part of m[1].split(/\s*,\s*/)) {
      const r = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(part)
      if (r) for (let k = Number(r[1]); k <= Number(r[2]) && k - Number(r[1]) < 20; k++) out.push(String(k))
      else out.push(part)
    }
  return [...new Set(out)]
}

export interface AskEntry {
  paperTitle: string
  status: LabelStatus
  asks: string[]
}

/** 问作者清单：判为「质疑成立」「还要查」的那些，按论文分组；「质疑不成立」和没判断的不放 */
export function askList<A extends Annotation & { paperTitle: string }>(anns: A[]): { paperTitle: string; items: { q: string; status: LabelStatus }[] }[] {
  const by = new Map<string, { q: string; status: LabelStatus }[]>()
  for (const a of anns) {
    const s = statusOf(a)
    if (a.label !== 'doubt' || (s !== 'upheld' && s !== 'checking')) continue
    const qs = asksOf(a)
    if (!qs.length) continue
    by.set(a.paperTitle, [...(by.get(a.paperTitle) ?? []), ...qs.map((q) => ({ q, status: s }))])
  }
  return [...by.entries()].map(([paperTitle, items]) => ({ paperTitle, items }))
}

/** 复制成 Markdown：每篇论文一个二级标题，下面编号列出问题，后面括号里是你的判断 */
export function askMarkdown(groups: { paperTitle: string; items: { q: string; status: LabelStatus }[] }[]): string {
  const out = [`# ${t('问作者清单')}`, '']
  for (const g of groups) {
    out.push(`## ${g.paperTitle}`, '')
    g.items.forEach((x, i) => out.push(`${i + 1}. ${x.q}（${STATUS_NAME[x.status]}）`))
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

/** 把一处标签换成别的状态以后的讲解记录：看不懂说「还不懂」时 misses 加一 */
export function withMiss(rec: ExplainRecord | null | undefined): ExplainRecord {
  return { versions: rec?.versions ?? [], misses: (rec?.misses ?? 0) + 1, group: rec?.group ?? null }
}

/**
 * 拆开看：从这段的意群对齐里取出和标的字沾边的那几句，按块给出原文一块、译文一块（Markdown 去掉记号）。
 * 标的字是界面上画出来的字，和 md 的写法不同（公式、上下标），所以都按只留字母数字比。
 */
export function senseChunks(sens: SenseSentence[], md: string, zh: string, text: string): { en: string; zh: string }[] {
  const sq = (s: string): string => plain(s).replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
  const want = sq(text)
  if (want.length < 6) return []
  const out: { en: string; zh: string }[] = []
  for (const s of sens) {
    const sen = sq(md.slice(s.en[0], s.en[1]))
    if (!sen || !(sen.includes(want.slice(0, 24)) || want.includes(sen.slice(0, 24)) || sen.includes(want.slice(-24)))) continue
    for (const c of s.chunks) {
      const en = plain(md.slice(c.en[0], c.en[1]))
      const z = c.zh.map(([a, b]) => plain(zh.slice(a, b))).join(' … ')
      if (en && z) out.push({ en, zh: z })
    }
  }
  return out.slice(0, 8)
}
