/**
 * 我的疑惑：一个文件夹（一门课）里所有读 PDF 笔记问过的地方汇成一个清单，按讲分组。
 * 新格式的笔记一问一条（CN-93）：主对话里问的、旁支里问的，问题都是发出去的原话，下面是回答原文的开头一段；
 * 「还是不懂」「换个方式讲」不另算一条，并进上一问（回答用最后讲的那一版）。以前的笔记一处一条（AI 写的疑惑、讲通的讲法）。
 * 左栏的「疑惑 N」、送 Anki 的张数都按这个数。考前看这个，也从这里送进 Anki。
 * 清单另存成 `<文件夹>/我的疑惑.md`（随笔记一起更新、跟着 Git 走），是给人看的副本，数据以各篇笔记为准。
 */
import { answerLead, type AskSection, lectureOf, linkFrom } from './reading-note'
import { formatPdfAnchor } from './pdf-link'
import { confusedOf, plainQ } from './highlights'
import { setProp } from './props'

export interface DoubtItem {
  /** 这一条的身份：一处的第一问就是那一段的身份（以前送过 Anki 的记号对得上），后面几问是「身份#问题的指纹」 */
  id: string
  /** PDF 在库里的路径 */
  pdf: string
  /** 第几讲（没有就按文件名排） */
  lecture?: number
  /**
   * 这一条看到的那一段：新格式里 doubts 只有这一问的原话、good 是它回答的开头一段（页码、我框的图还是那一段的）
   */
  section: AskSection
  /** 旁支里问的：被问的那一句 */
  quote?: string
  /** 这一问 AI 回答的原文（「还是不懂」再讲过的是最后讲的那一版）：出卡时交给 AI 的材料；以前格式的段没有 */
  answer?: string
}

/** 「还是不懂」「换个方式讲」这种整句：是接着上一问再讲一遍，不是新的一问 */
const AGAIN = /^(还是不懂|没懂|不懂|看不懂|听不懂|没听懂|不明白|还是不明白|换个方式讲|换种方式讲|换个讲法|换个角度讲?|再讲一遍|没看懂)[。！!？?…~～\s]*$/
export const askedAgain = (q: string) => AGAIN.test(q.trim())

/** 问题的指纹（FNV-1a，36 进制） */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (const ch of s) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * 一段里的每一问是哪一条：主对话第 i 问是「q<i>」，第 i 问下面第 j 条旁支的第 k 问是「s<i>.<j>.<k>」；
 * 「还是不懂」并进上一问，它的位置也指到上一问那一条（笔记里标「已送」、问题条上「做成卡」都按它找）
 */
function walk(pdf: string, s: AskSection, lecture?: number): { items: DoubtItem[]; at: Map<string, number> } {
  const base = { pdf, ...(lecture !== undefined ? { lecture } : {}) }
  const at = new Map<string, number>()
  if (!s.qas) return { items: [{ id: s.id, ...base, section: s }], at }
  const out: DoubtItem[] = []
  const used = new Set<string>()
  const add = (q: string, a: string, quote?: string): number => {
    // 新写法（ai-note.ts）的一处和同一处旧写法那段身份一样：第一问也带上问题的 hash，不和旧那段的那一条撞
    let id = out.length || s.doc ? `${s.id}#${hash(`${quote ?? ''}\n${q}`)}` : s.id
    for (let k = 2; used.has(id); k++) id = `${s.id}#${hash(`${quote ?? ''}\n${q}`)}-${k}`
    used.add(id)
    out.push({ id, ...base, section: { ...s, doubts: [q], good: answerLead(a), points: [], failed: [] }, ...(quote !== undefined ? { quote } : {}), answer: a })
    return out.length - 1
  }
  /** 再讲一遍：那一条的回答换成这一版 */
  const again = (k: number, a: string) => {
    const it = out[k]!
    it.section = { ...it.section, good: answerLead(a) }
    it.answer = a
  }
  let main = -1
  s.qas.forEach((qa, i) => {
    // 划成「看不懂」还没问 AI 的那一问（ParaRead 联动）：没有回答，不算问过、不出卡
    if (confusedOf(qa.q) && !qa.a.trim() && !qa.sides.length) return
    if (main >= 0 && AGAIN.test(qa.q.trim())) again(main, qa.a)
    else if (qa.q.trim()) main = add(plainQ(qa.q), qa.a)
    if (main >= 0) at.set(`q${i}`, main)
    qa.sides.forEach((side, j) => {
      let prev = -1
      side.turns.forEach((t, k) => {
        if (prev >= 0 && AGAIN.test(t.q.trim())) again(prev, t.a)
        else prev = add(t.q, t.a, side.quote)
        at.set(`s${i}.${j}.${k}`, prev)
      })
    })
  })
  return { items: out, at }
}

/** 笔记里的一段 → 我的疑惑里的几条（新格式一问一条，旧格式一处一条） */
export function doubtItems(pdf: string, s: AskSection, lecture?: number): DoubtItem[] {
  return walk(pdf, s, lecture).items
}

/** 这一段里每一问（主对话「q<i>」、旁支「s<i>.<j>.<k>」）是哪一条的身份；以前格式的段只有一条，没有位置 */
export function turnIds(pdf: string, s: AskSection): Map<string, string> {
  const { items, at } = walk(pdf, s)
  return new Map([...at].map(([k, i]) => [k, items[i]!.id]))
}

export interface DoubtGroup {
  /** PDF 路径 */
  key: string
  /** 「第 3 讲 · 第3讲 线性映射」或 PDF 名 */
  title: string
  lecture?: number
  items: DoubtItem[]
}

export const DOUBTS_NAME = '我的疑惑.md'

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')

/** 这一条的问题：新格式是发出去的原话，旧格式是我的疑惑第一行；没有就是小标题 */
export const questionOf = (s: AskSection) => s.doubts[0] ?? s.title

/** 按讲（再按 PDF 名）分组，组里按页、再按问的时间排 */
export function groupDoubts(items: DoubtItem[]): DoubtGroup[] {
  const groups = new Map<string, DoubtGroup>()
  for (const it of items) {
    let g = groups.get(it.pdf)
    if (!g) {
      const lec = it.lecture ?? lectureOf(it.pdf)
      g = { key: it.pdf, title: lec !== undefined && !/第\s*\d+\s*讲/.test(stem(it.pdf)) ? `第 ${lec} 讲 · ${stem(it.pdf)}` : stem(it.pdf), ...(lec !== undefined ? { lecture: lec } : {}), items: [] }
      groups.set(it.pdf, g)
    }
    g.items.push(it)
  }
  const list = [...groups.values()]
  for (const g of list) g.items.sort((a, b) => a.section.page - b.section.page || (a.section.time ?? '').localeCompare(b.section.time ?? ''))
  return list.sort((a, b) => (a.lecture ?? 1e9) - (b.lecture ?? 1e9) || a.title.localeCompare(b.title, 'zh'))
}

/** 我的疑惑.md 的全文；sent 是已经送进 Anki 的那几条 */
export function doubtsNote(folder: string, course: string, items: DoubtItem[], sent: ReadonlySet<string>): string {
  const note = `${folder ? folder + '/' : ''}${DOUBTS_NAME}`
  let head = setProp('', '类型', '我的疑惑')
  if (course) head = setProp(head, '课程', course)
  // 软件汇总的，不是人写的：梦游找重复时跳过（CN-56）
  head = setProp(head, '生成', '软件')
  const out = [`${head}\n# 我的疑惑`, '', `${course || '这个文件夹'} · ${items.length} 条。软件按这里各篇读 PDF 的笔记自动汇总，要改就改笔记里那一段。`]
  for (const g of groupDoubts(items)) {
    out.push('', `## ${g.title}`, '')
    for (const it of g.items) {
      const s = it.section
      const page = `[第 ${s.page} 页](${linkFrom(note, it.pdf)}${formatPdfAnchor({ file: it.pdf, page: s.page, rect: s.rect }).replace(/^[^#]*/, '')})`
      out.push(`- **${questionOf(s).replace(/\s+/g, ' ')}** ${page}${sent.has(it.id) ? ' · 已送 Anki' : ''}`)
      const good = s.good.replace(/\s+/g, ' ').trim()
      if (good) out.push(`  ${good}`)
    }
  }
  return out.join('\n') + '\n'
}
