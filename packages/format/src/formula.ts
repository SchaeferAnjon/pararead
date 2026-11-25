/**
 * 读 PDF 的 AI 看得到公式（2026-11-24，ParaRead 和画布笔记共用）。
 *
 * 为什么要它：PDF 的文字层里公式是拆散的（上下标、分式、求和号各占一行，α_ij 成了「αij」，括号是没有字的字形），
 * MinerU 快速解析（flash）又把公式裁成图片放进 Markdown，给 AI 的全文里只剩「[图]」。AI 只拿到字，就看不到原文的公式。
 *
 * 两条路：
 * - 解析结果里已经有公式图（ParaRead 的 flash.md）：`formulaImages` 认出哪些图是公式，交给看图模型转成 LaTeX（`FORMULA_LATEX_ASK`、
 *   `parseLatexReply`），按图的指纹缓存；给 AI 的全文里用 `withFormulas` 换成 LaTeX，还没转过的写成「[公式图 F3]」并把图带上。
 * - 只有文字层（画布笔记的 pdf.js 拼段、ParaRead 没跑 MinerU 时）：`formulaRegions` 在一页的文字项里找公式那几块（按版面框），
 *   界面照框截图带给 AI。
 *
 * 纯函数，不依赖 Electron 和 Node（手机版也要用）。
 */
import { bodySize, itemsToLines, type PdfLine, type PdfPageText } from './pdf-blocks'

// ---------------------------------------------------------------- 文字层里的公式

/**
 * 算数学符号的字：希腊字母、运算符和关系符、数学字母（U+1D400 起）、撇号，加上没有字的字形（控制字符、私用区：
 * 大括号、根号、分式的大括号在 TeX 字体里常是这样）。普通的 + - = ( ) 不算，正文里也多。
 */
const MATH_CHAR = /[Α-Ωα-ωϑϕϵ′″∀-⋿⨀-⫿⟨⟩‖∥±×÷∇∂∞\u0000-\u0008\u000E-\u001F-]|[\uD835][\uDC00-\uDFFF]/g

/** 公式编号：行尾的「(3)」「(12a)」 */
const TAG_AT_END = /\((\d{1,3})[a-z]?\)\s*$/

/** 一行里的数学符号个数 */
export function mathChars(text: string): number {
  return text.match(MATH_CHAR)?.length ?? 0
}

/** 一行里像正文的词（四个字母以上的小写词）有几个：多了就是带个希腊字母的正文，不是公式 */
function proseWords(text: string): number {
  return text.match(/\b[a-z]{4,}\b/g)?.length ?? 0
}

/** 文字层里公式那一块 */
export interface FormulaRegion {
  /** 页面上的框：左、上、宽、高，0–1 的比例（左上角量），截图照它裁 */
  rect: [number, number, number, number]
  /** 框里的公式编号（「(1)」→ 1），没有编号是空的 */
  tags: number[]
  /** 框里的几行字（文字层原样，给测试和日志看） */
  lines: string[]
}

/**
 * 一页上公式那几块（判断「这一页有公式」也用它：有一块就算）。规则：
 * 1. 文字项拼成行（同 pdf-blocks 的 itemsToLines）。一行算「公式行」：数学符号 ≥ 1 个、四字母以上的小写词 ≤ 3 个；
 *    或者行尾是公式编号「(n)」、小写词 ≤ 3 个。带一个 σ 的整句正文（小写词多）不算。
 * 2. 上下相邻（行距 ≤ 正文字号的 1.8 倍）、横向有重叠的公式行连成一块；同一基线上隔得不远的也连（≤ 页宽的 0.2，编号「(n)」那一行 ≤ 0.5；
 *    两栏的页不跨栏）；块上下 1.2 个字号以内、和块横向重叠的碎行
 *    （去掉空白不超过 8 个字的：上下标「ij」、求和上下限「k=1」、分式里的「K」）并进来。
 * 3. 一块要么有编号，要么数学符号合计 ≥ 3 个，才算公式（零散的 α 不算）。
 * 4. 框：上下各留 0.8 个字号（分式线、大括号是画的线，不在文字层里），左右撑到这一栏的宽度（两栏的页按半边算）。
 */
export function formulaRegions(p: PdfPageText): FormulaRegion[] {
  const lines = itemsToLines(p.items)
  if (!lines.length) return []
  const body = bodySize([p])
  const isMath = (l: PdfLine) => {
    const words = proseWords(l.text)
    return words <= 3 && (mathChars(l.text) >= 1 || TAG_AT_END.test(l.text))
  }
  const overlapX = (a: { x: number; w: number }, b: { x: number; w: number }) => a.x < b.x + b.w && b.x < a.x + a.w
  const top = (l: PdfLine) => l.y - l.h
  const bottom = (l: PdfLine) => l.y + l.h * 0.3
  const math = lines.filter(isMath)
  // 同一基线上紧挨着公式行、没有正文词的那一截（「= exp(LeakyReLU(a [W h || W h]))」里没有数学符号）也算公式行
  for (let grew = true; grew; ) {
    grew = false
    for (const l of lines) {
      if (math.includes(l) || proseWords(l.text) > 1) continue
      if (!math.some((m) => Math.abs(m.y - l.y) <= body * 0.6 && Math.max(m.x, l.x) - Math.min(m.x + m.w, l.x + l.w) < body * 2)) continue
      math.push(l)
      grew = true
    }
  }
  math.sort((a, b) => a.y - b.y)
  const used = new Set<PdfLine>(math)
  // 连成块（并查集）：上下相邻且横向重叠；或者同一基线上隔得不远（公式右边的编号「(1)」是单独一行）
  const side = (l: PdfLine) => (l.x + l.w <= p.width / 2 ? -1 : l.x >= p.width / 2 ? 1 : 0)
  // 只有一个编号「(1)」的那一行：单栏的页里它离公式很远（公式居中、编号靠右）
  const tagOnly = (l: PdfLine) => /^\(\d{1,3}[a-z]?\)$/.test(l.text)
  const near = (a: PdfLine, b: PdfLine) => {
    if (side(a) * side(b) === -1) return false
    if (Math.abs(a.y - b.y) <= body * 1.8 && overlapX(a, b)) return true
    const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)
    return Math.abs(a.y - b.y) <= body * 0.6 && gap < p.width * (tagOnly(a) || tagOnly(b) ? 0.5 : 0.2)
  }
  const root = math.map((_l, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)))
  for (let i = 0; i < math.length; i++) for (let j = i + 1; j < math.length; j++) if (near(math[i]!, math[j]!)) root[find(j)] = find(i)
  const byRoot = new Map<number, PdfLine[]>()
  math.forEach((l, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), l]))
  const groups = [...byRoot.values()]
  const out: FormulaRegion[] = []
  for (const g of groups) {
    let y0 = Math.min(...g.map(top))
    let y1 = Math.max(...g.map(bottom))
    const box = { x: Math.min(...g.map((l) => l.x)), w: 0 }
    box.w = Math.max(...g.map((l) => l.x + l.w)) - box.x
    // 碎行（上下标、求和上下限）：反复并，直到不再变（分式的分母下面还有一行下标）
    for (let changed = true; changed; ) {
      changed = false
      for (const l of lines) {
        if (used.has(l) || l.text.replace(/\s+/g, '').length > 8 || proseWords(l.text) > 0) continue
        if (top(l) > y1 + body * 1.2 || bottom(l) < y0 - body * 1.2 || !overlapX(box, l)) continue
        g.push(l)
        used.add(l)
        y0 = Math.min(y0, top(l))
        y1 = Math.max(y1, bottom(l))
        changed = true
      }
    }
    const tags = [...new Set(g.map((l) => TAG_AT_END.exec(l.text)?.[1]).filter((x): x is string => !!x).map(Number))]
    const sym = g.reduce((n, l) => n + mathChars(l.text), 0)
    if (!tags.length && sym < 3) continue
    // 只有一个编号、旁边没有公式（正文里列的「(1)」）
    if (g.every(tagOnly)) continue
    // 左右撑到这一栏：两栏的页（这块在半边里）按那半边的正文行算，单栏按全页的正文行
    const mid = p.width / 2
    const gx0 = Math.min(...g.map((l) => l.x))
    const gx1 = Math.max(...g.map((l) => l.x + l.w))
    const half = gx1 <= mid + body ? 'left' : gx0 >= mid - body ? 'right' : null
    const prose = lines.filter((l) => l.w > p.width * 0.25 && proseWords(l.text) >= 3 && (half === 'left' ? l.x + l.w <= mid + body * 2 : half === 'right' ? l.x >= mid - body * 2 : true))
    const x0 = Math.max(0, Math.min(gx0, ...prose.map((l) => l.x)) - body * 0.5)
    const x1 = Math.min(p.width, Math.max(gx1, ...prose.map((l) => l.x + l.w)) + body * 0.5)
    const t0 = Math.max(0, y0 - body * 0.8)
    const t1 = Math.min(p.height, y1 + body * 0.8)
    out.push({
      rect: [x0 / p.width, t0 / p.height, (x1 - x0) / p.width, (t1 - t0) / p.height],
      tags,
      lines: g.sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.text),
    })
  }
  return out.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])
}

/** 问的话里点名的公式编号：「公式 (1)」「式(2)」「Eq. 3」「equation (4)」「(5) 式」「公式1和2」 */
export function askedEquations(question: string): number[] {
  const out = new Set<number>()
  const add = (s: string) => {
    for (const m of s.matchAll(/\d{1,3}/g)) out.add(Number(m[0]))
  }
  const list = '[(（]?\\s*\\d{1,3}\\s*[)）]?(?:\\s*(?:[、,，和与及]|and|&|-|–|到|至)\\s*[(（]?\\s*\\d{1,3}\\s*[)）]?)*'
  for (const m of question.matchAll(new RegExp(`(?:公式|方程|等式|式子|式|eqs?\\.?|equations?|formulas?)\\s*(?:第\\s*)?${list}`, 'gi'))) add(m[0].replace(/^\D+/, ''))
  for (const m of question.matchAll(/[(（]\s*(\d{1,3})\s*[)）]\s*(?:式|号公式|公式|这个式子)/g)) out.add(Number(m[1]))
  return [...out].filter((n) => n > 0)
}

/** 问的话是在问公式（编号、「公式」「推导」「这个式子」、LaTeX）：要不要附公式那几块看它 */
export function asksFormula(question: string): boolean {
  return askedEquations(question).length > 0 || /公式|式子|等式|方程|推导|符号|求和|分式|上标|下标|equation|formula|\beq\.|\$|\\[a-z]+/i.test(question)
}

// ---------------------------------------------------------------- 解析结果（Markdown）里的公式图

/** Markdown 里一张单独成段、像公式的图（data URL 内嵌的） */
export interface MdFormulaImage {
  /** 第几张公式图（从 1 数，给 AI 的「公式图 F3」） */
  n: number
  /** 图的指纹（转好的 LaTeX 按它缓存） */
  key: string
  /** 在 md 里的位置（整个 `![](data:…)`） */
  start: number
  end: number
  mime: 'image/png' | 'image/jpeg'
  /** base64 */
  data: string
  w: number
  h: number
  /** 上一张图以后、这张图前面的字（最后 200 个，「as shown in (1)」：找第几个公式用） */
  before: string
}

const MD_DATA_IMG = /!\[[^\]]*\]\(data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\s]+)\)/g

/** 图的宽高：只解开 base64 开头一截，读 PNG 的 IHDR 或 JPEG 的 SOF 段 */
export function imageSize(b64: string): { w: number; h: number } | null {
  let bin: string
  try {
    bin = atob(b64.replace(/\s+/g, '').slice(0, 65536))
  } catch {
    return null
  }
  const at = (i: number) => bin.charCodeAt(i)
  const u16 = (i: number) => (at(i) << 8) | at(i + 1)
  const u32 = (i: number) => ((at(i) << 24) >>> 0) + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3)
  if (bin.startsWith('\x89PNG')) return bin.length >= 24 ? { w: u32(16), h: u32(20) } : null
  if (at(0) !== 0xff || at(1) !== 0xd8) return null
  let i = 2
  while (i + 9 < bin.length) {
    if (at(i) !== 0xff) {
      i++
      continue
    }
    const m = at(i + 1)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2
      continue
    }
    i += 2 + u16(i + 2)
  }
  return null
}

/** 字符串指纹（FNV-1a，去掉空白），图的 base64 用它当缓存的键 */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 32 || c === 10 || c === 13 || c === 9) continue
    h ^= c
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}

/**
 * md 里哪些图像公式：单独成段（前后是空行）、扁（高 ≤ 宽的 0.3）、不高（≤ 200 像素，MinerU 裁的公式图一行 30–110 像素），
 * 后面一段不是图注（Fig. / Figure / Table / 图 / 表 开头）。认错了不要紧：转 LaTeX 时看图模型说「不是公式」就照旧当图。
 */
export function formulaImages(md: string): MdFormulaImage[] {
  const out: MdFormulaImage[] = []
  let prevEnd = 0
  for (const m of md.matchAll(MD_DATA_IMG)) {
    const start = m.index!
    const end = start + m[0].length
    const since = prevEnd
    prevEnd = end
    const lead = md.slice(Math.max(0, start - 2), start)
    const tail = md.slice(end, end + 2)
    if (start > 0 && !/\n\s*$/.test(lead)) continue
    if (end < md.length && !/^\s*\n/.test(tail)) continue
    const data = m[2]!.replace(/\s+/g, '')
    const size = imageSize(data)
    if (!size || size.h > 200 || size.h > size.w * 0.3) continue
    const next = md.slice(end, end + 200).trimStart()
    if (/^(Fig\.?|Figure|FIGURE|Table|TABLE|图|表)\s*\d/.test(next)) continue
    // 上一张图以后的字（前文紧跟着的那句）
    const before = md.slice(Math.max(since, start - 4000), start).trim().slice(-200)
    out.push({ n: out.length + 1, key: fnv(data), start, end, mime: m[1] === 'image/png' ? 'image/png' : 'image/jpeg', data, w: size.w, h: size.h, before })
  }
  return out
}

/** 转好的 LaTeX：null 是看图模型说这张不是公式（照旧当图） */
export type FormulaLatex = Record<string, string | null>

/**
 * 给 AI 的 md 里公式图换成 LaTeX：转好的写成 `$$…$$`（后面注明「转写自公式图 F3」），还没转的写「[公式图 F3]」，
 * 不是公式的不动（交给后面的「[图]」）。pending：还没转的那几张（要带图给 AI 的）
 */
export function withFormulas(md: string, latex: FormulaLatex): { md: string; pending: MdFormulaImage[]; done: number } {
  const imgs = formulaImages(md)
  if (!imgs.length) return { md, pending: [], done: 0 }
  let out = ''
  let at = 0
  let done = 0
  const pending: MdFormulaImage[] = []
  for (const f of imgs) {
    out += md.slice(at, f.start)
    at = f.end
    const has = Object.prototype.hasOwnProperty.call(latex, f.key)
    const tex = latex[f.key]
    if (has && tex === null) out += md.slice(f.start, f.end)
    else if (tex) {
      out += `$$\n${tex}\n$$\n（转写自原文的公式图 F${f.n}）`
      done++
    } else {
      out += `[公式图 F${f.n}]`
      pending.push(f)
    }
  }
  return { md: out + md.slice(at), pending, done }
}

/** 一次交给看图模型转几张（公式图小，一张几十个 token） */
export const LATEX_BATCH = 8

/** 让看图模型把几张公式图转成 LaTeX 的话（图按顺序附在前面） */
export function formulaLatexAsk(n: number): string {
  return `这 ${n} 张图依次是一篇论文里裁下来的公式。逐张照图原样转成 LaTeX：上下标、粗体（\\mathbf）、括号层次、拼接号（\\parallel）、求和上下限都照图，不要改写成你熟悉的写法；图右边的编号「(n)」写成 \\tag{n}。
只输出一个 JSON 数组，每张一项：{"n": 第几张, "latex": "LaTeX，不带 $$"}；某一张不是公式（是图表、文字、Logo）或读不清，"latex" 写 null。不要别的字。`
}

/** 看图模型的回答 → 每张的 LaTeX（读不出来的那张是 undefined：下次再转；明说不是公式的是 null） */
export function parseLatexReply(reply: string, n: number): (string | null | undefined)[] {
  const out: (string | null | undefined)[] = Array.from({ length: n }, () => undefined)
  const s = reply.replace(/^[\s\S]*?(\[[\s\S]*\])[\s\S]*$/, '$1')
  let arr: unknown
  try {
    arr = JSON.parse(s)
  } catch {
    return out
  }
  if (!Array.isArray(arr)) return out
  arr.forEach((x, i) => {
    if (!x || typeof x !== 'object') return
    const o = x as { n?: unknown; latex?: unknown }
    const k = typeof o.n === 'number' && o.n >= 1 && o.n <= n ? o.n - 1 : i
    if (k >= n) return
    if (o.latex === null) out[k] = null
    else if (typeof o.latex === 'string' && o.latex.trim()) out[k] = o.latex.trim().replace(/^\$+|\$+$/g, '').trim()
  })
  return out
}

/**
 * 还没转成 LaTeX 的公式图里挑几张直接带给 AI（看图模型没配好、转失败时）：不超过 max 张；问的话点了编号、图多于 max 时，
 * 先挑前文提到那个编号的（「as shown in (1)」后面紧跟的那张）
 */
export function pickFormulaImages(pending: MdFormulaImage[], question: string, max = 8): MdFormulaImage[] {
  if (pending.length <= max) return pending
  const nums = askedEquations(question)
  const hit = nums.length ? pending.filter((f) => nums.some((n) => new RegExp(`\\(${n}\\)`).test(f.before.slice(-120)))) : []
  return [...hit, ...pending.filter((f) => !hit.includes(f))].slice(0, max).sort((a, b) => a.n - b.n)
}

/**
 * 转好的公式列一遍（会话接着问、全文早给过了、那时公式还是图时补上）：问的话点了编号且对得上 \tag 的只列那几个，否则全列（最多 max 个）
 */
export function formulaList(md: string, latex: FormulaLatex, question: string, max = 20): string {
  const all = formulaImages(md)
    .map((f) => ({ f, tex: latex[f.key] }))
    .filter((x): x is { f: MdFormulaImage; tex: string } => typeof x.tex === 'string')
  if (!all.length) return ''
  const nums = askedEquations(question)
  const hit = nums.length ? all.filter((x) => nums.includes(latexTag(x.tex) ?? -1)) : []
  const list = (hit.length ? hit : all).slice(0, max)
  return `论文里的公式（从原文公式图转写的 LaTeX）：\n${list.map((x) => `公式图 F${x.f.n}：$$${x.tex}$$`).join('\n')}`
}

/** LaTeX 里的编号（\tag{3} → 3） */
export function latexTag(tex: string): number | null {
  const m = /\\tag\*?\{\s*(\d{1,3})[a-z]?\s*\}/.exec(tex)
  return m ? Number(m[1]) : null
}

/**
 * 给 AI 的话里说明公式那几张附图（两个软件同一句）。first：附图里排第几张开始（前面是框的那块、贴的图）；
 * what：每张是什么（「第 3 页公式 (1) 那块」「公式图 F2」）
 */
export function formulaImagesNote(first: number, what: string[]): string {
  if (!what.length) return ''
  const range = what.length === 1 ? `附图第 ${first} 张` : `附图第 ${first}–${first + what.length - 1} 张`
  return `${range}依次是原文公式的截图：${what.join('；')}。文字层里公式是拆散的（上下标、分式、括号各成一行），讲公式一律以这几张图为准，照图原样写成 LaTeX，不要换成你熟悉的通常写法。`
}
