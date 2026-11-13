// 综述对比表（学术 AI 的一种会话）：几篇论文一行一篇，列是问题、方法、结果、局限和你的批注；
// 另外两种看法是论文之间的「关系」和同一种数字的「指标」。这里是不碰 AI、不碰数据库的部分，能单测：
// 原文句子在哪一页、一篇论文在哪些句子里提到另一篇、关系图怎么排。

export const BASE_COLS = ['q', 'm', 'r', 'l'] as const
export const NOTE_COL = 'n'

export interface MatrixCol {
  id: string // q m r l 是固定的四列；用户加的列是 c1、c2…
  name: string
  ask?: string // 用户加的列：要 AI 填什么
}

/** 一格：AI 写的一句话，和原文里支撑它的那一句 */
export interface Cell {
  text: string
  quote: string // 原文原句（英文），找不到出处时是空的
  zh: string // 原句的译文
  page: number | null
  found: boolean // 原句在全文里一字不差地找到了
  inferred?: boolean // 原文没有直接说，AI 推断的
}

export interface Metric {
  name: string
  value: number
  unit: string
  what: string // 测的是什么
  cond: string // 条件：位宽、数据集、近似与否
  quote: string
  page: number | null
  found: boolean
}

export interface MatrixRow {
  paperId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
  cells: Record<string, Cell>
  metrics: Metric[]
}

export type RelKind = 'base' | 'cmp' | 'bad'

/** 一条关系：from（后一篇）怎么说 to（前一篇）。a 是 from 里提到 to 的原句，b 是 to 那边被说到的那一格 */
export interface Relation {
  id: string
  from: string
  to: string
  kind: RelKind
  label: string
  a: { quote: string; zh: string; page: number | null }
  b: { col: string; quote: string; zh: string; page: number | null }
}

export interface MetricGroup {
  name: string
  unit: string
  better: 'lower' | 'higher'
  rows: { paperId: string; value: number; ok: boolean; note: string; what: string; quote: string; page: number | null; found: boolean }[]
}

export type Org = 'evo' | 'method' | 'problem'
export interface OutlineItem {
  h: string
  cells: string[]
}
/** 段落里的一句：t 带句末标点，不带引用号；cites 是论文 id；src 是它用到的格子（或关系） */
export interface Sentence {
  t: string
  cites: string[]
  src: string[]
}
export interface SentenceCheck {
  ok: boolean
  why: string
}
export interface Draft {
  org: Org
  lang: 'zh' | 'en'
  outline: OutlineItem[]
  sentences: Sentence[] | null
  checks: SentenceCheck[] | null
}

export interface MatrixState {
  cols: MatrixCol[]
  rows: MatrixRow[]
  relations: Relation[] | null
  relStatus: 'none' | 'running' | 'done' | 'failed'
  relError?: string
  metrics: MetricGroup[] | null
  metStatus: 'none' | 'running' | 'done' | 'failed'
  metError?: string
  selected: string[]
  draft: Draft | null
}

/** 「你的批注」那一列：这篇论文里写了批注或打了标签的标注 */
export interface NoteItem {
  annId: string
  text: string
  note: string
  label: 'confused' | 'doubt' | null
  page: number | null
}

/** 格子的编号：论文 id 加列，比如 0XKDlhHO:m；关系是 rel:<id> */
export const cellId = (paperId: string, col: string): string => `${paperId}:${col}`
export const splitCell = (id: string): { paperId: string; col: string } => {
  const i = id.lastIndexOf(':')
  return { paperId: id.slice(0, i), col: id.slice(i + 1) }
}
export const relCellId = (relId: string): string => `rel:${relId}`
export const isRel = (id: string): boolean => id.startsWith('rel:')

// —— 原文定位 ——

/** 比对用：统一连字、去掉一切非字母数字（换行、断字的连字符、空格都不算） */
export function squash(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** 原句在第几页（从 1 起）：整句找，找不到再用开头和结尾各 60 个字符找；hint 那一页先找 */
export function findQuote(pages: string[], quote: string, hint: number | null = null): number | null {
  const q = squash(quote)
  if (q.length < 12) return null
  const sq = pages.map(squash)
  const order = [...(hint && hint >= 1 && hint <= pages.length ? [hint - 1] : []), ...sq.map((_, i) => i)]
  for (const i of order) if (sq[i].includes(q)) return i + 1
  // 跨页的句子、模型改了中间几个字：开头和结尾都对得上才算
  if (q.length >= 80) {
    const head = q.slice(0, 60)
    const tail = q.slice(-60)
    for (const i of order) {
      const here = sq[i] + (sq[i + 1] ?? '')
      if (here.includes(head) && here.includes(tail)) return i + 1
    }
  }
  return null
}

/** 粗分句：句号、问号、叹号后面跟空白和大写字母或方括号 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z[(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20)
}

/** 句子里的数字引用 [3]、[1, 4]、[5]–[7]、[2-4] 展开成编号 */
export function citeNums(s: string): number[] {
  const out = new Set<number>()
  const re = /\[(\d+(?:\s*[-–,]\s*\d+)*)\](?:\s*[-–]\s*\[(\d+)\])?/g
  for (let m = re.exec(s); m; m = re.exec(s)) {
    for (const part of m[1].split(',')) {
      const [a, b] = part.split(/[-–]/).map((x) => Number(x.trim()))
      if (b && b >= a && b - a < 50) for (let k = a; k <= b; k++) out.add(k)
      else out.add(a)
    }
    if (m[2]) {
      const last = Number(m[1].split(/[-–,]/).pop())
      for (let k = last; k <= Number(m[2]) && k - last < 50; k++) out.add(k)
    }
  }
  return [...out]
}

/** 参考文献表从哪里开始（整篇拼起来的下标）：最后一个 References 标题 */
function refsStart(full: string): number {
  let at = -1
  const re = /\b(?:REFERENCES|References|Bibliography|BIBLIOGRAPHY)\b/g
  for (let m = re.exec(full); m; m = re.exec(full)) at = m.index
  return at > full.length * 0.4 ? at : -1
}

/** 在 A 的参考文献表里找 B（按题目），返回 B 在 A 里的编号 */
export function refNumber(pages: string[], title: string): number | null {
  const full = pages.join('\n')
  const start = refsStart(full)
  if (start < 0) return null
  const refs = full.slice(start)
  // 参考文献表里逐字找题目：在压缩后的文字里找，再换回原文位置前面最近的 [n]
  const want = squash(title).slice(0, 32)
  if (want.length < 12) return null
  let sq = ''
  const pos: number[] = []
  for (let i = 0; i < refs.length; i++) {
    const c = squash(refs[i])
    if (c) {
      sq += c
      for (let k = 0; k < c.length; k++) pos.push(i)
    }
  }
  const at = sq.indexOf(want)
  if (at < 0) return null
  const before = refs.slice(Math.max(0, pos[at] - 400), pos[at])
  const nums = [...before.matchAll(/\[(\d{1,3})\]/g)]
  return nums.length ? Number(nums[nums.length - 1][1]) : null
}

/** 题目里能认出这篇的词：全大写的缩写（MAGIC、SIMPLER）、冒号前的名字（MultPIM） */
export function titleMarks(title: string): string[] {
  const marks = new Set<string>()
  for (const w of title.match(/\b[A-Z][A-Za-z]*[A-Z][A-Za-z]*\b/g) ?? []) if (w.length >= 4 && /[A-Z].*[A-Z]/.test(w) && !/^(IEEE|ACM|DNA|CMOS|DRAM|SRAM)$/.test(w)) marks.add(w)
  const head = /^([^:—–]{3,30})[:—–]/.exec(title)?.[1].trim()
  if (head && !/\s/.test(head)) marks.add(head)
  return [...marks]
}

/** A 的正文里提到 B 的句子：按 B 在 A 参考文献表里的编号，或者 B 的第一作者姓加 et al.，或者题目里的缩写 */
export function mentions(pages: string[], b: { title: string; authors: string[] }, limit = 6): { page: number; text: string }[] {
  const full = pages.join('\n')
  const start = refsStart(full)
  const n = refNumber(pages, b.title)
  const last = b.authors[0] ? b.authors[0].trim().split(/[\s,]+/).filter(Boolean) : []
  const surname = (b.authors[0]?.includes(',') ? last[0] : last[last.length - 1]) ?? ''
  const marks = titleMarks(b.title)
  const hits: { page: number; text: string; score: number; at: number }[] = []
  const seen = new Set<string>()
  const nameRe = surname.replace(/[^A-Za-z-]/g, '').length >= 3 ? new RegExp(`\\b${surname.replace(/[^A-Za-z-]/g, '')}\\s+et\\s+al`, 'i') : null
  let offset = 0
  for (let i = 0; i < pages.length; i++) {
    if (start >= 0 && offset >= start) break
    const body = start >= 0 && offset + pages[i].length > start ? pages[i].slice(0, start - offset) : pages[i]
    offset += pages[i].length + 1
    for (const s of splitSentences(body)) {
      // 编号命中最可靠，其次第一作者姓，题目缩写最弱（别的论文也可能用同一个词）；缩写要都对上才算
      const score = (n !== null && citeNums(s).includes(n) ? 4 : 0) + (nameRe?.test(s) ? 2 : 0) + (marks.length && marks.every((m) => new RegExp(`\\b${m}\\b`).test(s)) ? 1 : 0)
      const k = squash(s)
      if (score && !seen.has(k)) {
        seen.add(k)
        hits.push({ page: i + 1, text: s.length > 400 ? s.slice(0, 400) + '…' : s, score, at: hits.length })
      }
    }
  }
  return hits
    .sort((x, y) => y.score - x.score || x.at - y.at)
    .slice(0, limit)
    .sort((x, y) => x.at - y.at)
    .map(({ page, text }) => ({ page, text }))
}

// —— 关系图怎么排 ——

/** 按年份分栏，从左到右；同一年的上下排开。返回每篇的左上角和整张图的大小 */
export function layoutGraph(nodes: { id: string; year: number | null }[], o = { w: 190, h: 58, gapX: 110, gapY: 64 }): { pos: Record<string, [number, number]>; width: number; height: number; years: { year: number | null; x: number }[] } {
  const years = [...new Set(nodes.map((n) => n.year))].sort((a, b) => (a ?? 9999) - (b ?? 9999))
  const cols = years.map((y) => nodes.filter((n) => n.year === y))
  const tallest = Math.max(1, ...cols.map((c) => c.length))
  const height = tallest * o.h + (tallest - 1) * o.gapY
  const pos: Record<string, [number, number]> = {}
  cols.forEach((col, ci) => {
    const x = ci * (o.w + o.gapX)
    const top = (height - (col.length * o.h + (col.length - 1) * o.gapY)) / 2
    col.forEach((n, ri) => (pos[n.id] = [x, top + ri * (o.h + o.gapY)]))
  })
  return { pos, width: years.length * o.w + (years.length - 1) * o.gapX, height, years: years.map((year, i) => ({ year, x: i * (o.w + o.gapX) })) }
}

/** 从 a 的框边到 b 的框边的一条线（两个框中心连线和框边的交点） */
export function edgeLine(a: [number, number], b: [number, number], w: number, h: number): [number, number, number, number] {
  const ca = [a[0] + w / 2, a[1] + h / 2]
  const cb = [b[0] + w / 2, b[1] + h / 2]
  const clip = (c: number[], d: number[]): [number, number] => {
    const dx = d[0] - c[0]
    const dy = d[1] - c[1]
    const k = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity)
    return [c[0] + dx * k, c[1] + dy * k]
  }
  const p = clip(ca, cb)
  const q = clip(cb, ca)
  return [p[0], p[1], q[0], q[1]]
}
