/**
 * 文档的「块」：md 的顶层块（段落、标题、每个列表项、引用、代码、表格、分隔线、图片、卡片注释和它的正文……）。
 * 文档模式里一块一块地挪、删、复制、转换，改的都是 md 原文；块之间的空白（gap）只动被挪的那几处。
 *
 * 规矩：
 * - 找块只读文字，不改；没动的地方一个字节都不变。
 * - 挪过去的块和邻居之间是一个空行；同一个列表里挪列表项，保持原来的松紧（紧凑列表不加空行）。
 * - 卡片注释（<!-- card ... -->）和它的正文是一块，范围和白板（parseBoard）认的一样。
 */

import { hasOldLayout, parseBoard } from './board'

export type MdBlockKind =
  | 'frontmatter'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'hr'
  | 'image'
  | 'html'
  | 'columns'
  | 'card'
  | 'column'

export interface MdBlock {
  kind: MdBlockKind
  /** 第一行行首 */
  from: number
  /** 最后一行行尾（不含换行） */
  to: number
  /** 标题级别 */
  level?: number
  /** 列表项的种类 */
  list?: 'bullet' | 'ordered' | 'task'
}

interface Line {
  from: number
  to: number
  text: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)|$)/
const TASK = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/
const QUOTE = /^ {0,3}>/
const COMMENT = /^ {0,3}<!--/
const COLUMNS_OPEN = /^ {0,3}<!--\s*columns\b[^\n]*-->[ \t]*$/
const COLUMNS_CLOSE = /^ {0,3}<!--\s*\/columns\s*-->[ \t]*$/
const HTML_TAG = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)/
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const IMAGE = /^ {0,3}!\[[^\]\n]*\]\([^)\n]*\)[ \t]*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const FM = /^---\n[\s\S]*?\n---(?:\n|$)/

const isBlank = (s: string) => /^[ \t]*$/.test(s)

function indentOf(s: string): number {
  let n = 0
  for (const c of s) {
    if (c === ' ') n++
    else if (c === '\t') n += 4 - (n % 4)
    else break
  }
  return n
}

function splitLines(text: string, start: number, end: number): Line[] {
  const out: Line[] = []
  let pos = start
  while (pos < end) {
    let nl = text.indexOf('\n', pos)
    if (nl === -1 || nl > end) nl = end
    out.push({ from: pos, to: nl, text: text.slice(pos, nl) })
    pos = nl + 1
  }
  return out
}

/** 这一行会打断上面的段落、自己开一块 */
function interrupts(s: string): boolean {
  if (HEADING.test(s) || FENCE.test(s) || QUOTE.test(s) || COMMENT.test(s) || HR.test(s)) return true
  const m = LIST.exec(s)
  if (m && m[3] !== undefined) {
    // 有序列表只有从 1 开始才能打断段落（CommonMark）
    return !/^\d/.test(m[2]!) || /^1[.)]$/.test(m[2]!)
  }
  return false
}

function listKind(s: string): 'bullet' | 'ordered' | 'task' {
  if (TASK.test(s)) return 'task'
  return /^ {0,3}\d/.test(s) ? 'ordered' : 'bullet'
}

/** 列表项内容的缩进（标记后面的文字从第几列开始） */
function contentIndent(s: string): number {
  const m = LIST.exec(s)!
  const spaces = m[3] === undefined ? 1 : indentOf(m[1]! + m[2]! + m[3]) - m[1]!.length - m[2]!.length
  return m[1]!.length + m[2]!.length + (spaces > 4 ? 1 : Math.max(1, spaces))
}

/** 在一段普通 md 里找块 */
function scan(text: string, start: number, end: number): MdBlock[] {
  const L = splitLines(text, start, end)
  const out: MdBlock[] = []
  const n = L.length
  const push = (kind: MdBlockKind, i: number, j: number, extra: Partial<MdBlock> = {}) =>
    out.push({ kind, from: L[i]!.from, to: L[j]!.to, ...extra })
  /** 从 j 往前跳过空行 */
  const lastFilled = (j: number) => {
    while (j > 0 && isBlank(L[j]!.text)) j--
    return j
  }

  let i = 0
  while (i < n) {
    const s = L[i]!.text
    if (isBlank(s)) {
      i++
      continue
    }
    // 缩进 4 格的代码
    if (indentOf(s) >= 4) {
      let j = i + 1
      while (j < n && (isBlank(L[j]!.text) || indentOf(L[j]!.text) >= 4)) j++
      push('code', i, lastFilled(j - 1))
      i = j
      continue
    }
    const fence = FENCE.exec(s)
    if (fence) {
      const ch = fence[1]![0]!
      const len = fence[1]!.length
      const close = new RegExp(`^ {0,3}${ch === '`' ? '`' : '~'}{${len},}[ \\t]*$`)
      let j = i + 1
      while (j < n && !close.test(L[j]!.text)) j++
      const last = j < n ? j : lastFilled(n - 1)
      push('code', i, last)
      i = last + 1
      continue
    }
    const h = HEADING.exec(s)
    if (h) {
      push('heading', i, i, { level: h[1]!.length })
      i++
      continue
    }
    if (HR.test(s)) {
      push('hr', i, i)
      i++
      continue
    }
    if (COMMENT.test(s)) {
      if (COLUMNS_OPEN.test(s)) {
        let j = i + 1
        while (j < n && !COLUMNS_CLOSE.test(L[j]!.text)) j++
        if (j < n) {
          push('columns', i, j)
          i = j + 1
          continue
        }
      }
      let j = i
      while (j < n && !L[j]!.text.includes('-->')) j++
      if (j < n) {
        push('html', i, j)
        i = j + 1
        continue
      }
      // 没闭合的注释当普通段落
    }
    if (QUOTE.test(s)) {
      let j = i + 1
      while (j < n && !isBlank(L[j]!.text)) j++
      push('quote', i, j - 1)
      i = j
      continue
    }
    if (LIST.test(s)) {
      const ci = contentIndent(s)
      let last = i
      let j = i + 1
      while (j < n) {
        const t = L[j]!.text
        if (isBlank(t)) {
          let k = j + 1
          while (k < n && isBlank(L[k]!.text)) k++
          if (k < n && indentOf(L[k]!.text) >= ci) {
            last = k
            j = k + 1
            continue
          }
          break
        }
        const ind = indentOf(t)
        if (ind >= ci) {
          last = j
          j++
          continue
        }
        if (LIST.test(t) || interrupts(t)) break
        // 懒惰续行：上一行接着写的字
        last = j
        j++
      }
      push('list', i, last, { list: listKind(s) })
      i = last + 1
      continue
    }
    if (s.includes('|') && i + 1 < n && TABLE_DELIM.test(L[i + 1]!.text) && L[i + 1]!.text.includes('|')) {
      let j = i + 2
      while (j < n && !isBlank(L[j]!.text) && !interrupts(L[j]!.text)) j++
      push('table', i, j - 1)
      i = j
      continue
    }
    if (HTML_TAG.test(s)) {
      let j = i + 1
      while (j < n && !isBlank(L[j]!.text)) j++
      push('html', i, j - 1)
      i = j
      continue
    }
    // 段落：到空行，或者下一行自己开一块；下一行是 === / --- 时是 setext 标题
    let j = i + 1
    let kind: MdBlockKind = 'paragraph'
    let level: number | undefined
    while (j < n && !isBlank(L[j]!.text)) {
      const t = L[j]!.text
      const st = SETEXT.exec(t)
      if (st) {
        kind = 'heading'
        level = st[1]![0] === '=' ? 1 : 2
        j++
        break
      }
      if (interrupts(t)) break
      j++
    }
    if (kind === 'paragraph' && j === i + 1 && IMAGE.test(s)) kind = 'image'
    push(kind, i, j - 1, level ? { level } : {})
    i = j
  }
  return out
}

const LAYOUT_LINE = /^<!--\s*(?:card|column)\s[^\n]*-->[ \t]*$/

/** 新写法（2026-11-21 起）：排版注释（位置行、编号行、列的位置行）都是 html 块，整篇按 md 找块 */
function plainBlocks(text: string): MdBlock[] {
  const fm = FM.exec(text)?.[0] ?? ''
  const out: MdBlock[] = []
  if (fm) out.push({ kind: 'frontmatter', from: 0, to: fm.endsWith('\n') ? fm.length - 1 : fm.length })
  out.push(...scan(text, fm.length, text.length))
  return out
}

/**
 * 找出整篇的顶层块，按文件里的顺序。
 * 新写法里位置行、编号行、列的位置行只管后面那一块，和它算一块（挪、删、复制都带着它）；
 * 旧写法的白板（卡上写着 in= / w=）照以前：注释和它下面到下一条注释的字是一块（和 parseBoard 一样）
 */
export function findBlocks(text: string): MdBlock[] {
  if (!hasOldLayout(text)) {
    const raw = plainBlocks(text)
    const out: MdBlock[] = []
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i]!
      const next = raw[i + 1]
      if (b.kind === 'html' && next && next.kind !== 'frontmatter' && LAYOUT_LINE.test(text.slice(b.from, b.to))) {
        out.push({ ...next, from: b.from })
        i++
      } else out.push(b)
    }
    return out
  }
  const board = parseBoard(text)
  const out: MdBlock[] = []
  const fm = board.fm
  if (fm) out.push({ kind: 'frontmatter', from: 0, to: fm.endsWith('\n') ? fm.length - 1 : fm.length })
  const headEnd = fm.length + board.head.length
  out.push(...scan(text, fm.length, headEnd))
  let pos = headEnd
  for (const b of board.blocks) {
    const whole = b.comment + b.body
    const trimmed = whole.replace(/(?:\n[ \t]*)+$/, '')
    out.push({ kind: b.kind, from: pos, to: pos + trimmed.length })
    pos += whole.length
  }
  return out
}

/**
 * 画控件用的块：和 findBlocks 一样，只是卡片正文也按 md 拆开（卡片里的表格、图片也要画出来），
 * 卡片和列的注释那一行算 html 块。
 */
export function contentBlocks(text: string): MdBlock[] {
  if (!hasOldLayout(text)) return plainBlocks(text)
  const out: MdBlock[] = []
  for (const b of findBlocks(text)) {
    if (b.kind !== 'card' && b.kind !== 'column') {
      out.push(b)
      continue
    }
    const nl = text.indexOf('\n', b.from)
    const lineEnd = nl === -1 || nl > b.to ? b.to : nl
    out.push({ kind: 'html', from: b.from, to: lineEnd })
    if (lineEnd < b.to) out.push(...scan(text, lineEnd + 1, b.to))
  }
  return out
}

/** pos 落在第几块（块和块之间的空行不算任何一块），没有是 -1 */
export function blockIndexAt(blocks: MdBlock[], pos: number): number {
  return blocks.findIndex((b) => b.from <= pos && pos <= b.to)
}

/** 离 pos 最近的那一块（落在空行里时取下面一块，最后取上面一块） */
export function nearestBlock(blocks: MdBlock[], pos: number): number {
  const i = blockIndexAt(blocks, pos)
  if (i !== -1) return i
  const next = blocks.findIndex((b) => b.from > pos)
  return next === -1 ? blocks.length - 1 : next
}

/** 能挪、能删的块（frontmatter 固定在最前面） */
export const movable = (b: MdBlock) => b.kind !== 'frontmatter'

// ---------- 改块：拆成「块 + 块之间的空白」再拼回去 ----------

interface Piece {
  block: MdBlock
  text: string
}

interface Layout {
  prefix: string
  pieces: Piece[]
  /** gaps[k] 是第 k 块和第 k+1 块之间的原文 */
  gaps: string[]
  suffix: string
}

function layout(text: string, blocks: MdBlock[]): Layout {
  const pieces = blocks.map((b) => ({ block: b, text: text.slice(b.from, b.to) }))
  const gaps = blocks.slice(1).map((b, k) => text.slice(blocks[k]!.to, b.from))
  return {
    prefix: blocks.length ? text.slice(0, blocks[0]!.from) : text,
    pieces,
    gaps,
    suffix: blocks.length ? text.slice(blocks[blocks.length - 1]!.to) : '',
  }
}

const newlines = (g: string) => (g.match(/\n/g) ?? []).length
const bothList = (a: MdBlock, b: MdBlock) => a.kind === 'list' && b.kind === 'list'

/**
 * 新接缝用什么空白：两边都是列表项时跟着列表原来的松紧（inList 是插进去那处原来的空白），否则一个空行。
 * frontmatter 后面照原样。
 */
function seam(a: MdBlock, b: MdBlock, inList?: string): string {
  if (a.kind === 'frontmatter') return inList ?? '\n'
  if (bothList(a, b)) return inList ?? '\n'
  return '\n\n'
}

function join(l: Layout): string {
  let out = l.prefix
  l.pieces.forEach((p, k) => {
    if (k > 0) out += l.gaps[k - 1]
    out += p.text
  })
  return out + l.suffix
}

/** 拿掉第 i 块，两边的空白合成一处 */
function cut(l: Layout, i: number): { layout: Layout; piece: Piece } {
  const pieces = [...l.pieces]
  const gaps = [...l.gaps]
  const [piece] = pieces.splice(i, 1)
  if (pieces.length === 0) return { layout: { ...l, pieces, gaps: [] }, piece: piece! }
  if (i === 0) gaps.splice(0, 1)
  else if (i === l.pieces.length - 1) gaps.splice(i - 1, 1)
  else {
    const a = l.pieces[i - 1]!.block
    const b = l.pieces[i + 1]!.block
    const g1 = l.gaps[i - 1]!
    const g2 = l.gaps[i]!
    const g = a.kind === 'frontmatter' || bothList(a, b) ? g1 : newlines(g2) > newlines(g1) ? g2 : g1
    gaps.splice(i - 1, 2, g)
  }
  return { layout: { ...l, pieces, gaps }, piece: piece! }
}

/** 把 piece 放到第 at 块前面（at = 块数时放最后），返回放好的样子 */
function putIn(l: Layout, at: number, piece: Piece): Layout {
  const pieces = [...l.pieces]
  const gaps = [...l.gaps]
  const x = piece.block
  if (pieces.length === 0) return { ...l, pieces: [piece], gaps: [] }
  if (at === 0) {
    const b = pieces[0]!.block
    pieces.unshift(piece)
    gaps.unshift(seam(x, b))
  } else if (at === pieces.length) {
    const a = pieces[at - 1]!.block
    pieces.push(piece)
    gaps.push(seam(a, x))
  } else {
    const a = pieces[at - 1]!.block
    const b = pieces[at]!.block
    const g = gaps[at - 1]!
    const inList = bothList(a, b) || a.kind === 'frontmatter' ? g : undefined
    pieces.splice(at, 0, piece)
    gaps.splice(at - 1, 1, seam(a, x, inList), seam(x, b, inList))
  }
  return { ...l, pieces, gaps }
}

/** 把 piece 放到第 at 块前面（at = 块数时放最后）；返回放好后 piece 在新文字里从哪开始 */
function put(l: Layout, at: number, piece: Piece): { text: string; at: number } {
  const out = putIn(l, at, piece)
  return { text: join(out), at: startOf(out, at) }
}

function startOf(l: Layout, k: number): number {
  let pos = l.prefix.length
  for (let i = 0; i < k; i++) pos += l.pieces[i]!.text.length + l.gaps[i]!.length
  return pos
}

export interface BlockEdit {
  text: string
  /** 改过的那一块在新文字里从哪开始（光标跟着它） */
  at: number
}

/**
 * 把第 i 块挪到第 to 块前面（to = 块数时挪到最后）。挪不了（原地、挪到 frontmatter 前面）返回 null。
 */
export function moveMdBlock(text: string, i: number, to: number, blocks = findBlocks(text)): BlockEdit | null {
  if (i < 0 || i >= blocks.length || !movable(blocks[i]!)) return null
  if (to < 0 || to > blocks.length || to === i || to === i + 1) return null
  if (to === 0 && blocks[0]!.kind === 'frontmatter') return null
  const { layout: rest, piece } = cut(layout(text, blocks), i)
  return put(rest, to > i ? to - 1 : to, piece)
}

/** 往上（-1）或往下（+1）挪一块 */
export function shiftMdBlock(text: string, i: number, dir: -1 | 1, blocks = findBlocks(text)): BlockEdit | null {
  return moveMdBlock(text, i, dir < 0 ? i - 1 : i + 2, blocks)
}

export function removeMdBlock(text: string, i: number, blocks = findBlocks(text)): BlockEdit | null {
  if (i < 0 || i >= blocks.length || !movable(blocks[i]!)) return null
  const { layout: rest } = cut(layout(text, blocks), i)
  const at = rest.pieces.length ? startOf(rest, Math.min(i, rest.pieces.length - 1)) : rest.prefix.length
  return { text: join(rest), at }
}

/** 在第 i 块后面放一块新的 md（复制、+ 号加一块都用它） */
export function insertMdBlockAfter(text: string, i: number, md: string, blocks = findBlocks(text)): BlockEdit {
  const l = layout(text, blocks)
  const kind = findBlocks(md)[0]?.kind ?? 'paragraph'
  const piece: Piece = { block: { kind, from: 0, to: md.length }, text: md }
  return put(l, i + 1, piece)
}

/** 复制一份放在它后面 */
export function duplicateMdBlock(text: string, i: number, blocks = findBlocks(text)): BlockEdit | null {
  if (i < 0 || i >= blocks.length || !movable(blocks[i]!)) return null
  const l = layout(text, blocks)
  return put(l, i + 1, { ...l.pieces[i]! })
}

// ---------- 转换 ----------

export type BlockTarget = 'paragraph' | 'h1' | 'h2' | 'h3' | 'todo' | 'quote' | 'code' | 'bullet' | 'ordered'

/** 能转换的块 */
export const convertible = (b: MdBlock) => ['paragraph', 'heading', 'list', 'quote', 'code'].includes(b.kind)

/** 块里去掉 md 记号的文字 */
export function plainOf(text: string, b: MdBlock): string {
  const lines = text.slice(b.from, b.to).split('\n')
  switch (b.kind) {
    case 'heading':
      if (HEADING.test(lines[0]!)) return lines[0]!.replace(/^ {0,3}#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+$/, '')
      return lines.slice(0, -1).map((s) => s.trim()).join('\n')
    case 'list': {
      const ci = contentIndent(lines[0]!)
      const first = lines[0]!.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\](?=[ \t]|$))?[ \t]*/, '')
      return [first, ...lines.slice(1).map((s) => dedent(s, ci))].join('\n')
    }
    case 'quote':
      return lines.map((s) => s.replace(/^ {0,3}> ?/, '')).join('\n')
    case 'code': {
      if (FENCE.test(lines[0]!)) {
        const body = lines.slice(1)
        if (body.length && FENCE.test(body[body.length - 1]!)) body.pop()
        return body.join('\n')
      }
      return lines.map((s) => dedent(s, 4)).join('\n')
    }
    default:
      return lines.join('\n')
  }
}

function dedent(s: string, n: number): string {
  let i = 0
  let col = 0
  while (i < s.length && col < n && (s[i] === ' ' || s[i] === '\t')) {
    col += s[i] === '\t' ? 4 - (col % 4) : 1
    i++
  }
  return s.slice(i)
}

/** 把一段纯文字写成某种块的 md */
export function markdownAs(target: BlockTarget, plain: string): string {
  const lines = plain.split('\n')
  switch (target) {
    case 'paragraph':
      return plain
    case 'h1':
    case 'h2':
    case 'h3': {
      const one = lines.map((s) => s.trim()).filter(Boolean).join(' ')
      return '#'.repeat(Number(target[1])) + ' ' + one
    }
    case 'todo':
      return lines.map((s, k) => (k === 0 ? '- [ ] ' + s : s.trim() === '' ? '' : '  ' + s)).join('\n')
    case 'bullet':
      return lines.map((s, k) => (k === 0 ? '- ' + s : s.trim() === '' ? '' : '  ' + s)).join('\n')
    case 'ordered':
      return lines.map((s, k) => (k === 0 ? '1. ' + s : s.trim() === '' ? '' : '   ' + s)).join('\n')
    case 'quote':
      return lines.map((s) => (s === '' ? '>' : '> ' + s)).join('\n')
    case 'code': {
      const longest = Math.max(2, ...Array.from(plain.matchAll(/`+/g), (m) => m[0].length))
      const fence = '`'.repeat(longest + 1)
      return `${fence}\n${plain}\n${fence}`
    }
  }
}

/** 第 i 块转换成另一种块；和邻居之间的空白不够（会粘成一块）时补成一个空行 */
export function convertMdBlock(text: string, i: number, target: BlockTarget, blocks = findBlocks(text)): BlockEdit | null {
  const b = blocks[i]
  if (!b || !convertible(b)) return null
  const md = markdownAs(target, plainOf(text, b))
  const nb = convertedBlock(b, target)
  const l = layout(text, blocks)
  const pieces = [...l.pieces]
  pieces[i] = { block: nb, text: md }
  const gaps = [...l.gaps]
  const widen = (k: number, a: MdBlock, c: MdBlock) => {
    if (a.kind === 'frontmatter' || bothList(a, c)) return
    if (newlines(gaps[k]!) < 2) gaps[k] = '\n\n'
  }
  if (i > 0) widen(i - 1, pieces[i - 1]!.block, nb)
  if (i < pieces.length - 1) widen(i, nb, pieces[i + 1]!.block)
  const out = { ...l, pieces, gaps }
  return { text: join(out), at: startOf(out, i) }
}

/** 转成 target 以后这一块是哪种块（接缝用它定松紧） */
function convertedBlock(b: MdBlock, target: BlockTarget): MdBlock {
  if (target === 'todo' || target === 'bullet' || target === 'ordered') return { ...b, kind: 'list', list: target === 'todo' ? 'task' : target }
  const kind: MdBlockKind = target === 'quote' ? 'quote' : target === 'code' ? 'code' : target === 'paragraph' ? 'paragraph' : 'heading'
  return { ...b, kind }
}

// ---------- 选中好几块一起改（task-5ryf9，文档拖选多块以后那一条操作条） ----------

/** 选中的几块：去重、按先后、只留能挪的（frontmatter 不算） */
function picked(indices: readonly number[], blocks: MdBlock[]): number[] {
  return [...new Set(indices)].filter((i) => i >= 0 && i < blocks.length && movable(blocks[i]!)).sort((a, b) => a - b)
}

/** 拿掉选中的几块（从后往前拿，前面的下标不变），拿出来的按原来的先后 */
function cutMany(l: Layout, sel: readonly number[]): { layout: Layout; pieces: Piece[] } {
  let rest = l
  const pieces: Piece[] = []
  for (const i of [...sel].reverse()) {
    const r = cut(rest, i)
    rest = r.layout
    pieces.unshift(r.piece)
  }
  return { layout: rest, pieces }
}

/**
 * 几块挨着放到第 at 块前面；原来就挨着的两块中间照原来的空白（紧凑列表还是紧凑的），不挨着的按接缝规矩（一个空行）。
 * gapsOf：原来那几块之间的空白（sel 下标对应的）
 */
function putMany(l: Layout, at: number, pieces: readonly Piece[], sel: readonly number[], orig: Layout): Layout {
  let out = l
  pieces.forEach((p, k) => {
    out = putIn(out, at + k, p)
    if (k > 0 && sel[k] === sel[k - 1]! + 1) {
      const gaps = [...out.gaps]
      gaps[at + k - 1] = orig.gaps[sel[k - 1]!]!
      out = { ...out, gaps }
    }
  })
  return out
}

/** 几块一起挪到第 to 块前面（to = 块数时挪到最后，下标是挪之前的）；挪完和原来一样（落在选中的几块中间）返回 null */
export function moveMdBlocks(text: string, indices: readonly number[], to: number, blocks = findBlocks(text)): BlockEdit | null {
  const sel = picked(indices, blocks)
  if (!sel.length || to < 0 || to > blocks.length) return null
  if (to === 0 && blocks[0]!.kind === 'frontmatter') return null
  const orig = layout(text, blocks)
  const { layout: rest, pieces } = cutMany(orig, sel)
  const at = to - sel.filter((i) => i < to).length
  const out = putMany(rest, at, pieces, sel, orig)
  const next = join(out)
  return next === text ? null : { text: next, at: startOf(out, at) }
}

/** 删掉几块：两边留一个空行，光标落在删掉的第一块那里 */
export function removeMdBlocks(text: string, indices: readonly number[], blocks = findBlocks(text)): BlockEdit | null {
  const sel = picked(indices, blocks)
  if (!sel.length) return null
  const { layout: rest } = cutMany(layout(text, blocks), sel)
  const at = rest.pieces.length ? startOf(rest, Math.min(sel[0]!, rest.pieces.length - 1)) : rest.prefix.length
  return { text: join(rest), at }
}

/** 复制一份：选中的最后一块下面多一样的几块（按原来的先后） */
export function duplicateMdBlocks(text: string, indices: readonly number[], blocks = findBlocks(text)): BlockEdit | null {
  const sel = picked(indices, blocks)
  if (!sel.length) return null
  const l = layout(text, blocks)
  const at = sel[sel.length - 1]! + 1
  const out = putMany(l, at, sel.map((i) => ({ ...l.pieces[i]! })), sel, l)
  return { text: join(out), at: startOf(out, at) }
}

/** 选中的几块的 md 原文（复制、剪切、交给 AI）：原来挨着的照原来的空白，不挨着的隔一个空行 */
export function selectedMarkdown(text: string, indices: readonly number[], blocks = findBlocks(text)): string {
  const sel = picked(indices, blocks)
  return sel.map((i, k) => (k === 0 ? '' : sel[k - 1] === i - 1 ? text.slice(blocks[i - 1]!.to, blocks[i]!.from) : '\n\n') + text.slice(blocks[i]!.from, blocks[i]!.to)).join('')
}

/**
 * 几块一起转成（文档操作条「转成」）：只改每块开头的记号，字不变；不能转的（表格、分隔线、卡片……）跳过。
 * callout：连着的几块包进一个「> [!note]」（块里原来的写法照留），不连着的各包一个
 */
export function convertMdBlocks(text: string, indices: readonly number[], target: BlockTarget | 'callout', blocks = findBlocks(text)): BlockEdit | null {
  const sel = picked(indices, blocks)
  if (!sel.length) return null
  const l = layout(text, blocks)
  const pieces = [...l.pieces]
  const gaps = [...l.gaps]
  const widen = (k: number) => {
    if (k < 0 || k >= gaps.length) return
    const a = pieces[k]!.block
    const c = pieces[k + 1]!.block
    if (a.kind === 'frontmatter' || bothList(a, c)) return
    if (newlines(gaps[k]!) < 2) gaps[k] = '\n\n'
  }
  if (target === 'callout') {
    // 一段一段地包：从后往前，前面的下标不变
    const runs: [number, number][] = []
    for (const i of sel) {
      const last = runs[runs.length - 1]
      if (last && last[1] === i - 1) last[1] = i
      else runs.push([i, i])
    }
    for (const [a, z] of runs.reverse()) {
      const raw = text.slice(blocks[a]!.from, blocks[z]!.to)
      const md = '> [!note]\n' + raw.split('\n').map((s) => (s.trim() === '' ? '>' : '> ' + s)).join('\n')
      pieces.splice(a, z - a + 1, { block: { kind: 'quote', from: blocks[a]!.from, to: blocks[z]!.to }, text: md })
      gaps.splice(a, z - a)
      widen(a - 1)
      widen(a)
    }
  } else {
    let any = false
    for (const i of sel) {
      const b = blocks[i]!
      if (!convertible(b)) continue
      any = true
      pieces[i] = { block: convertedBlock(b, target), text: markdownAs(target, plainOf(text, b)) }
    }
    if (!any) return null
    for (const i of sel) (widen(i - 1), widen(i))
  }
  const out = { ...l, pieces, gaps }
  const next = join(out)
  return next === text ? null : { text: next, at: startOf(out, sel[0]!) }
}

/**
 * 缩进（Tab）、减少缩进（⇧Tab）：只有列表、待办能缩，每行多两个空格、少两个空格（少不了的那行不动）；
 * 正文、标题不动（md 里缩进的正文会变成代码块），skipped 数出没动的几块
 */
export function indentMdBlocks(text: string, indices: readonly number[], dir: 1 | -1, blocks = findBlocks(text)): { edit: BlockEdit | null; changed: number; skipped: number } {
  const sel = picked(indices, blocks)
  const l = layout(text, blocks)
  const pieces = [...l.pieces]
  let changed = 0
  let skipped = 0
  for (const i of sel) {
    const b = blocks[i]!
    if (b.kind !== 'list') {
      skipped++
      continue
    }
    const before = pieces[i]!.text
    const after = before
      .split('\n')
      .map((s) => (dir > 0 ? (s.trim() === '' ? s : '  ' + s) : s.replace(/^ {1,2}/, '')))
      .join('\n')
    if (after === before) continue
    pieces[i] = { block: b, text: after }
    changed++
  }
  if (!changed) return { edit: null, changed, skipped }
  const out = { ...l, pieces }
  return { edit: { text: join(out), at: startOf(out, sel[0]!) }, changed, skipped }
}

/** 选中的几块换成一段新的 md（AI 整理这几段）：删掉它们，在第一块那里放进去 */
export function replaceMdBlocks(text: string, indices: readonly number[], md: string, blocks = findBlocks(text)): BlockEdit | null {
  const sel = picked(indices, blocks)
  const body = md.trim()
  if (!sel.length || !body) return null
  const { layout: rest } = cutMany(layout(text, blocks), sel)
  const kind = findBlocks(body)[0]?.kind ?? 'paragraph'
  const at = Math.min(sel[0]!, rest.pieces.length)
  const out = putIn(rest, at, { block: { kind, from: 0, to: body.length }, text: body })
  return { text: join(out), at: startOf(out, at) }
}

// ---------- 待办、表格、路径 ----------

/** 待办这一行的 [ ] 在行里的位置（[ 的下标），不是待办返回 -1 */
export function taskBoxAt(line: string): number {
  const m = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ xX]\](?:[ \t]|$)/.exec(line)
  return m ? m[1]!.length : -1
}

/** 勾上 / 取消：只改 [ ] 里那一个字 */
export function toggleTask(line: string): string {
  const at = taskBoxAt(line)
  if (at === -1) return line
  const on = line[at + 1] !== ' '
  return line.slice(0, at + 1) + (on ? ' ' : 'x') + line.slice(at + 2)
}

/** 一个空表格：cols 列，第一行是表头，下面 rows - 1 行 */
export function tableMarkdown(cols: number, rows: number): string {
  const row = (cells: string[]) => '| ' + cells.join(' | ') + ' |'
  const head = row(Array.from({ length: cols }, (_, k) => `列 ${k + 1}`))
  const delim = row(Array.from({ length: cols }, () => '---'))
  const body = Array.from({ length: Math.max(0, rows - 1) }, () => row(Array.from({ length: cols }, () => '  ')))
  return [head, delim, ...body].join('\n')
}

export interface TableCell {
  text: string
  /** 单元格文字在整篇里的位置 */
  from: number
  to: number
}

export interface ParsedTable {
  head: TableCell[]
  align: ('left' | 'center' | 'right' | null)[]
  rows: TableCell[][]
}

/** 表格块拆成单元格（位置是整篇里的），给文档模式画成表格 */
export function parseTable(text: string, b: MdBlock): ParsedTable {
  const lines = splitLines(text, b.from, b.to)
  const cells = (l: Line): TableCell[] => {
    const out: TableCell[] = []
    const s = l.text
    let i = 0
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++
    if (s[i] === '|') i++
    let start = i
    for (; i <= s.length; i++) {
      if (i < s.length && s[i] === '\\') {
        i++
        continue
      }
      if (i === s.length || s[i] === '|') {
        const raw = s.slice(start, i)
        // 最后一个 | 后面只有空白：不算一格
        if (i === s.length && raw.trim() === '' && out.length > 0) break
        const lead = raw.length - raw.trimStart().length
        const t = raw.trim()
        out.push({ text: t, from: l.from + start + lead, to: l.from + start + lead + t.length })
        start = i + 1
      }
    }
    return out
  }
  const align = cells(lines[1]!).map((c) => {
    const l = c.text.startsWith(':')
    const r = c.text.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  return { head: cells(lines[0]!), align, rows: lines.slice(2).map(cells) }
}

/** 表格一行里每一格两条竖线之间的原文范围（相对这一行；最后一个 | 后面的空白不算一格） */
export function cellSpans(s: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let i = 0
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++
  if (s[i] === '|') i++
  let start = i
  for (; i <= s.length; i++) {
    if (i < s.length && s[i] === '\\') {
      i++
      continue
    }
    if (i === s.length || s[i] === '|') {
      if (i === s.length && s.slice(start, i).trim() === '' && out.length > 0) break
      out.push({ from: start, to: i })
      start = i + 1
    }
  }
  return out
}

/** 一格里写的字：竖线转义、换行换成空格 */
export const tableCellText = (v: string) => v.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim()

/**
 * 改表格的一格（row = -1 是表头，0 起是下面的行）：只换这一格两条竖线之间的字，写成「 字 」，这一行别的地方原样。
 * 这一行格子不够（col 超出）就在后面补空格子。
 */
export function setTableCell(text: string, b: MdBlock, row: number, col: number, value: string): string {
  const lines = splitLines(text, b.from, b.to)
  const line = lines[row < 0 ? 0 : row + 2]
  if (!line) return text
  let s = line.text
  let spans = cellSpans(s)
  while (spans.length <= col) {
    s = s.replace(/\s*$/, '')
    if (!s.endsWith('|')) s += ' |'
    s += '  |'
    spans = cellSpans(s)
  }
  const sp = spans[col]!
  const v = tableCellText(value)
  const next = s.slice(0, sp.from) + (v ? ` ${v} ` : '  ') + s.slice(sp.to)
  return text.slice(0, line.from) + next + text.slice(line.to)
}

/** 表格最后加一行空格子（格数同表头）；返回新文字 */
export function addTableRow(text: string, b: MdBlock): string {
  const lines = splitLines(text, b.from, b.to)
  const n = Math.max(1, cellSpans(lines[0]!.text).length)
  const row = '| ' + Array.from({ length: n }, () => '').join(' | ') + ' |'
  return text.slice(0, b.to) + '\n' + row + text.slice(b.to)
}

/** 从笔记 notePath 指向库里 target 的相对链接（都是相对库根目录、用 / 分隔），空格写成 %20 */
export function relativeLink(notePath: string, target: string): string {
  const from = notePath.split('/').slice(0, -1)
  const to = target.split('/')
  let k = 0
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++
  const rel = [...Array(from.length - k).fill('..'), ...to.slice(k)].join('/')
  return rel.replace(/ /g, '%20')
}

/** 反过来：笔记里的相对链接 → 库里的路径；跑出库外或是网址返回 null */
export function resolveLink(notePath: string, link: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('/')) return null
  let decoded: string
  try {
    decoded = decodeURI(link)
  } catch {
    decoded = link
  }
  const parts = notePath.split('/').slice(0, -1)
  for (const p of decoded.split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(p)
  }
  return parts.join('/') || null
}
