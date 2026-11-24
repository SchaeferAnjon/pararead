/**
 * 普通 Markdown 表格的整行、整列改法（task-cle3x，照 Notion 的简单表格）：加删挪行、加删挪列、对齐、列宽、粘贴成表。
 * 都是纯函数：给整篇和表格块，还整篇新文字。只动该动的那几行、那几格，别的字和空格原样：
 * - 行：加、删、挪只动那一行（删表头时下面第一行升上去当表头，动两行）；
 * - 列：每一行在那一格的位置插进、拿掉、换位置，别的格子两条竖线之间的字和空格原样（不重排整张表的对齐空格）；
 * - 对齐、列宽：只改第二行（|---|---| 那一行）。
 * 列宽借 Pandoc 的写法：第二行每一列的「-」个数就是这一列占多宽的比例；每列一样多（|---|---|）就是平分。不另加记号，
 * 别的软件照样认成表格（Pandoc 也照这个比例排）。
 */
import { cellSpans, type MdBlock, tableCellText } from './blocks'

export type TableAlign = 'left' | 'center' | 'right' | null

interface Seg {
  /** 第一格前面（缩进、开头的「|」） */
  pre: string
  /** 每一格两条竖线之间的原文（带两边空格） */
  cells: string[]
  /** 最后一格后面（结尾的「|」和后面的空白；没有结尾「|」时是空的） */
  post: string
}

function segs(s: string): Seg {
  const sp = cellSpans(s)
  if (!sp.length) return { pre: s, cells: [], post: '' }
  return { pre: s.slice(0, sp[0]!.from), cells: sp.map((x) => s.slice(x.from, x.to)), post: s.slice(sp[sp.length - 1]!.to) }
}

function join(g: Seg): string {
  let post = g.post
  // 最后一格是空的又没有结尾「|」：解析时会被当成没有这一格，补一个「|」
  if (!post.startsWith('|') && g.cells.length && g.cells[g.cells.length - 1]!.trim() === '') post = '|' + post
  return g.pre + g.cells.join('|') + post
}

interface Lines {
  /** 表格每一行在整篇里的位置和字 */
  rows: { from: number; to: number; text: string }[]
}

function lines(text: string, b: MdBlock): Lines {
  const rows: Lines['rows'] = []
  let pos = b.from
  while (pos < b.to) {
    let nl = text.indexOf('\n', pos)
    if (nl === -1 || nl > b.to) nl = b.to
    rows.push({ from: pos, to: nl, text: text.slice(pos, nl) })
    pos = nl + 1
  }
  return { rows }
}

/** 整张表换成这些行（只替换表格那一段） */
const put = (text: string, b: MdBlock, rows: string[]) => text.slice(0, b.from) + rows.join('\n') + text.slice(b.to)

/** 第几行（-1 表头）在表格行里的下标：表头 0，第二行（|---|）1，下面的行从 2 起 */
const lineOf = (row: number) => (row < 0 ? 0 : row + 2)

/** 表头有几格 */
export function tableCols(text: string, b: MdBlock): number {
  return Math.max(1, cellSpans(lines(text, b).rows[0]!.text).length)
}

/** 一行空格子，格数同表头：「|  |  |  |」 */
function blankRow(n: number): string {
  return '|' + '  |'.repeat(n)
}

/** 在第 row 行上面（above）或下面插一行空的；row = -1 是表头（只能在下面插） */
export function insertTableRow(text: string, b: MdBlock, row: number, where: 'above' | 'below'): string {
  const L = lines(text, b).rows.map((r) => r.text)
  const n = tableCols(text, b)
  const at = row < 0 ? 2 : lineOf(row) + (where === 'below' ? 1 : 0)
  L.splice(at, 0, blankRow(n))
  return put(text, b, L)
}

/** 删掉第 row 行；删表头时下面第一行升上去当表头（只剩表头时不删，返回原文） */
export function deleteTableRow(text: string, b: MdBlock, row: number): string {
  const L = lines(text, b).rows.map((r) => r.text)
  if (row < 0) {
    if (L.length < 3) return text
    const first = L.splice(2, 1)[0]!
    L[0] = first
    return put(text, b, L)
  }
  if (lineOf(row) >= L.length) return text
  L.splice(lineOf(row), 1)
  return put(text, b, L)
}

/** 把第 from 行挪到第 to 行的位置（都是表头下面的行，从 0 数；to 是挪完以后它在第几行） */
export function moveTableRow(text: string, b: MdBlock, from: number, to: number): string {
  const L = lines(text, b).rows.map((r) => r.text)
  const body = L.slice(2)
  if (from < 0 || from >= body.length || to < 0 || to >= body.length || from === to) return text
  const [r] = body.splice(from, 1)
  body.splice(to, 0, r!)
  return put(text, b, [L[0]!, L[1]!, ...body])
}

/** 每一行都补到至少 n 格（短的行后面补空格子） */
function padTo(g: Seg, n: number, delim: boolean) {
  while (g.cells.length < n) g.cells.push(delim ? '---' : '  ')
}

/** 第二行的一格（「 :---: 」）照着别的格子的写法：两边有没有空格 */
function delimCell(like: string | undefined, dashes = 3): string {
  const pad = like?.startsWith(' ') ? ' ' : ''
  return pad + '-'.repeat(dashes) + pad
}

/** 在第 col 列左边（left）或右边插一列空的。第二行新的一格：平分的表写「---」，拖过宽的表给它其余列的平均宽 */
export function insertTableCol(text: string, b: MdBlock, col: number, side: 'left' | 'right'): string {
  const L = lines(text, b).rows.map((r) => r.text)
  const n = tableCols(text, b)
  const at = Math.min(n, col + (side === 'right' ? 1 : 0))
  const w = colDashes(L[1]!)
  const custom = w.length > 1 && w.some((x) => x !== w[0])
  const dashes = custom ? Math.max(3, Math.round(w.reduce((a, x) => a + x, 0) / w.length)) : Math.max(3, w[0] ?? 3)
  const out = L.map((s, i) => {
    const g = segs(s)
    if (!g.cells.length) return s
    padTo(g, at, i === 1)
    g.cells.splice(at, 0, i === 1 ? delimCell(g.cells[0], dashes) : '  ')
    return join(g)
  })
  return put(text, b, out)
}

/** 删掉第 col 列（只剩一列时不删） */
export function deleteTableCol(text: string, b: MdBlock, col: number): string {
  const L = lines(text, b).rows.map((r) => r.text)
  if (tableCols(text, b) <= 1) return text
  const out = L.map((s) => {
    const g = segs(s)
    if (col >= g.cells.length) return s
    g.cells.splice(col, 1)
    return join(g)
  })
  return put(text, b, out)
}

/** 把第 from 列挪到第 to 列的位置 */
export function moveTableCol(text: string, b: MdBlock, from: number, to: number): string {
  const L = lines(text, b).rows.map((r) => r.text)
  const n = tableCols(text, b)
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return text
  const out = L.map((s, i) => {
    const g = segs(s)
    if (!g.cells.length) return s
    padTo(g, n, i === 1)
    const [c] = g.cells.splice(from, 1)
    g.cells.splice(to, 0, c!)
    return join(g)
  })
  return put(text, b, out)
}

/** 第二行每一列有几个「-」 */
function colDashes(delim: string): number[] {
  return segs(delim).cells.map((c) => (c.match(/-/g) ?? []).length)
}

/** 第 col 列靠左、居中、靠右（null：不写，照默认）；只改第二行那一格的冒号 */
export function setTableAlign(text: string, b: MdBlock, col: number, align: TableAlign): string {
  const L = lines(text, b).rows.map((r) => r.text)
  const g = segs(L[1]!)
  padTo(g, col + 1, true)
  const c = g.cells[col]!
  const m = /^(\s*):?(-+):?(\s*)$/.exec(c)
  const dashes = m ? m[2]! : '---'
  const core = (align === 'left' || align === 'center' ? ':' : '') + dashes + (align === 'right' || align === 'center' ? ':' : '')
  g.cells[col] = (m ? m[1]! : '') + core + (m ? m[3]! : '')
  L[1] = join(g)
  return put(text, b, L)
}

/** 列宽（比例，加起来是 1）；第二行每列「-」一样多（没拖过）给 null：平分 */
export function tableWidths(text: string, b: MdBlock): number[] | null {
  const L = lines(text, b).rows
  const w = colDashes(L[1]!.text)
  const n = tableCols(text, b)
  if (w.length < 2 || w.every((x) => x === w[0])) return null
  while (w.length < n) w.push(Math.max(3, Math.round(w.reduce((a, x) => a + x, 0) / w.length)))
  const sum = w.slice(0, n).reduce((a, x) => a + x, 0)
  return w.slice(0, n).map((x) => x / sum)
}

/** 每列多少个「-」：总数约是列数 × 20（一个「-」约是表宽的百分之一，松手后宽度不跳），每列至少 3 个；比例都一样时写回平分（每列 3 个） */
export function widthDashes(ratios: number[]): number[] {
  const total = ratios.length * 20
  const d = ratios.map((r) => Math.max(3, Math.round(r * total)))
  return d.every((x) => x === d[0]) ? d.map(() => 3) : d
}

/** 写列宽：只改第二行每一格「-」的个数，冒号、空格原样 */
export function setTableWidths(text: string, b: MdBlock, ratios: number[]): string {
  const L = lines(text, b).rows.map((r) => r.text)
  const g = segs(L[1]!)
  const d = widthDashes(ratios)
  padTo(g, d.length, true)
  g.cells = g.cells.map((c, i) => (d[i] === undefined ? c : c.replace(/-+/, '-'.repeat(d[i]!))))
  L[1] = join(g)
  return put(text, b, L)
}

/**
 * 从第 row 行第 col 列起贴一块格子（从表格软件、网页复制来的几行几格）：一格一格写进去，只动这几格；
 * 下面行不够就加行，右边列不够就加列（和 Notion 一样）。
 */
export function pasteTableCells(text: string, b: MdBlock, row: number, col: number, grid: string[][]): string {
  if (!grid.length) return text
  let L = lines(text, b).rows.map((r) => r.text)
  const width = Math.max(...grid.map((r) => r.length))
  let n = tableCols(text, b)
  // 先补列（每一行在最后补空格子），再补行
  const need = col + width
  if (need > n) {
    L = L.map((s, i) => {
      const g = segs(s)
      if (!g.cells.length) return s
      padTo(g, need, i === 1)
      return join(g)
    })
    n = need
  }
  const lastRow = row + grid.length - 1
  while (L.length - 2 <= lastRow) L.push(blankRow(n))
  grid.forEach((r, i) => {
    const li = lineOf(row + i)
    const g = segs(L[li]!)
    padTo(g, col + r.length, false)
    r.forEach((v, k) => {
      const t = tableCellText(v)
      // 字一样的格子不动（连两边的空格也不动）
      if (g.cells[col + k]!.trim() !== t) g.cells[col + k] = t ? ` ${t} ` : '  '
    })
    L[li] = join(g)
  })
  return put(text, b, L)
}

/** 几行几格（第一行当表头）写成一张 md 表格：「| a | b |」，第二行「|---|---|」 */
export function gridToTable(grid: string[][]): string {
  const n = Math.max(1, ...grid.map((r) => r.length))
  const row = (r: string[]) => '|' + Array.from({ length: n }, (_, k) => (tableCellText(r[k] ?? '') ? ` ${tableCellText(r[k]!)} ` : '  ')).join('|') + '|'
  return [row(grid[0] ?? []), '|' + '---|'.repeat(n), ...grid.slice(1).map(row)].join('\n')
}
