/**
 * 白板 = 同一个 md 文件的另一种看法。排版信息写在 HTML 注释里，别的软件打开看不见，内容不丢：
 *
 *   ---
 *   type: board
 *   links:
 *     - a1 -> a2
 *   ---
 *   # 标题（和其他没放进卡片的段落一起，是「未整理」）
 *
 *   <!-- card id=a1 x=120 y=300 w=280 color=yellow -->
 *   卡片内容……
 *
 *   <!-- column id=c1 x=500 y=80 w=280 title="要订的" -->
 *   <!-- card id=a2 in=c1 -->
 *   列里的卡片，顺序就是文件里的顺序
 *
 * 规矩：parse 再 serialize 一个字节都不变；改一张卡只动它自己那一段，改连线只动 frontmatter 里 links 那几行。
 * 注释写坏了（不在一行里闭合、不认识的种类）就当普通文字，不报错不丢内容。
 */

export type BlockKind = 'card' | 'column'

export interface Block {
  kind: BlockKind
  /** 按原来的顺序 */
  attrs: [string, string][]
  /** 注释那一行，含换行；attrs 没变就原样写回 */
  comment: string
  /** 注释后面到下一块之前的原文 */
  body: string
}

export interface BoardDoc {
  /** frontmatter 原文，含两行 --- 和最后的换行；没有就是 '' */
  fm: string
  /** frontmatter 之后、第一块之前的原文（标题和还没放进卡片的段落） */
  head: string
  blocks: Block[]
}

export interface Link {
  from: string
  to: string
}

const FM = /^---\n[\s\S]*?\n---(?:\n|$)/
const BLOCK_LINE = /^<!--\s*(card|column)\b([^\n]*?)-->[ \t]*$/gm
const ATTR = /([A-Za-z][\w-]*)=(?:"([^"]*)"|(\S+))/g

export function parseBoard(text: string): BoardDoc {
  const fm = FM.exec(text)?.[0] ?? ''
  const rest = text.slice(fm.length)
  const starts: { index: number; kind: BlockKind; attrs: [string, string][]; lineEnd: number }[] = []
  for (const m of rest.matchAll(BLOCK_LINE)) {
    const attrs = parseAttrs(m[2]!)
    if (!attrs) continue
    const nl = rest.indexOf('\n', m.index!)
    starts.push({ index: m.index!, kind: m[1] as BlockKind, attrs, lineEnd: nl === -1 ? rest.length : nl + 1 })
  }
  const head = rest.slice(0, starts[0]?.index ?? rest.length)
  const blocks: Block[] = starts.map((s, i) => ({
    kind: s.kind,
    attrs: s.attrs,
    comment: rest.slice(s.index, s.lineEnd),
    body: rest.slice(s.lineEnd, starts[i + 1]?.index ?? rest.length),
  }))
  return { fm, head, blocks }
}

function parseAttrs(src: string): [string, string][] | null {
  const out: [string, string][] = []
  let leftover = src
  for (const m of src.matchAll(ATTR)) {
    out.push([m[1]!, m[2] ?? m[3]!])
    leftover = leftover.replace(m[0], '')
  }
  // 有认不出来的东西就不当排版注释
  if (leftover.trim() !== '') return null
  return out
}

export function serializeBoard(doc: BoardDoc): string {
  return doc.fm + doc.head + doc.blocks.map((b) => b.comment + b.body).join('')
}

export function attr(b: Block, key: string): string | undefined {
  return b.attrs.find(([k]) => k === key)?.[1]
}

export function num(b: Block, key: string, fallback: number): number {
  const v = Number(attr(b, key))
  return Number.isFinite(v) ? v : fallback
}

/** 改属性：undefined 是删掉。属性真变了才重写注释那一行 */
export function withAttrs(b: Block, changes: Record<string, string | number | undefined>): Block {
  const attrs = b.attrs.map(([k, v]) => [k, v] as [string, string])
  for (const [k, raw] of Object.entries(changes)) {
    const i = attrs.findIndex(([key]) => key === k)
    if (raw === undefined) {
      if (i !== -1) attrs.splice(i, 1)
    } else {
      const v = String(raw)
      if (i === -1) attrs.push([k, v])
      else attrs[i] = [k, v]
    }
  }
  const same = attrs.length === b.attrs.length && attrs.every(([k, v], i) => b.attrs[i]![0] === k && b.attrs[i]![1] === v)
  if (same) return b
  return { ...b, attrs, comment: commentLine(b.kind, attrs) }
}

export function commentLine(kind: BlockKind, attrs: [string, string][]): string {
  const parts = attrs.map(([k, v]) => (/^[^\s"]+$/.test(v) ? `${k}=${v}` : `${k}="${v.replace(/"/g, "'")}"`))
  return `<!-- ${kind} ${parts.join(' ')} -->\n`
}

/** 卡片正文，不含结尾的空行 */
export function content(b: Block): string {
  return b.body.replace(/\n+$/, '')
}

/** 换卡片正文；结尾的空行保留原样（至少一个空行，和下一块隔开） */
export function withContent(b: Block, text: string): Block {
  const tail = /\n*$/.exec(b.body)![0]
  const body = text.replace(/\n+$/, '') + (tail.length >= 2 ? tail : '\n\n')
  return body === b.body ? b : { ...b, body }
}

export function newBlock(kind: BlockKind, attrs: Record<string, string | number>, text = ''): Block {
  const list = Object.entries(attrs).map(([k, v]) => [k, String(v)] as [string, string])
  return { kind, attrs: list, comment: commentLine(kind, list), body: text.replace(/\n+$/, '') + '\n\n' }
}

/** 加在最后：前一块（或 head）要以空行结尾，不然新注释会粘在上一段后面 */
export function appendBlock(doc: BoardDoc, b: Block): BoardDoc {
  const blocks = [...doc.blocks]
  let head = doc.head
  const last = blocks[blocks.length - 1]
  if (last) blocks[blocks.length - 1] = { ...last, body: endWithBlank(last.body) }
  else head = head === '' && doc.fm === '' ? '' : endWithBlank(head)
  return { ...doc, head, blocks: [...blocks, b] }
}

function endWithBlank(s: string): string {
  if (s === '') return s
  if (s.endsWith('\n\n')) return s
  return s.endsWith('\n') ? s + '\n' : s + '\n\n'
}

export function newId(doc: BoardDoc): string {
  const used = new Set(doc.blocks.map((b) => attr(b, 'id')))
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8)
    if (!used.has(id)) return id
  }
}

// ---------- 连线：frontmatter 里的 links ----------

const LINK_LINE = /^\s+-\s*(\S+)\s*->\s*(\S+)\s*$/

export function parseLinks(doc: BoardDoc): Link[] {
  const lines = doc.fm.split('\n')
  const i = lines.findIndex((l) => /^links:\s*$/.test(l))
  if (i === -1) return []
  const out: Link[] = []
  for (let j = i + 1; j < lines.length; j++) {
    const m = LINK_LINE.exec(lines[j]!)
    if (!m) break
    out.push({ from: m[1]!, to: m[2]! })
  }
  return out
}

export function withLinks(doc: BoardDoc, links: Link[]): BoardDoc {
  const block = links.length ? ['links:', ...links.map((l) => `  - ${l.from} -> ${l.to}`)] : []
  if (!doc.fm) {
    if (!links.length) return doc
    return { ...doc, fm: `---\n${block.join('\n')}\n---\n` }
  }
  const lines = doc.fm.split('\n')
  const i = lines.findIndex((l) => /^links:\s*$/.test(l))
  if (i !== -1) {
    let j = i + 1
    while (j < lines.length && LINK_LINE.test(lines[j]!)) j++
    lines.splice(i, j - i, ...block)
  } else {
    // 加在结尾的 --- 前面
    const close = lines.lastIndexOf('---')
    lines.splice(close, 0, ...block)
  }
  const fm = lines.join('\n')
  return fm === doc.fm ? doc : { ...doc, fm }
}

/** frontmatter 里的简单一行键值（type: board、color: #xxx） */
export function fmValue(fmOrText: string, key: string): string | undefined {
  const fm = FM.exec(fmOrText)?.[0] ?? ''
  const m = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(fm)
  return m?.[1]
}

// ---------- 未整理：head 里没放进卡片的段落 ----------

export interface Loose {
  /** 在 head 里的范围 */
  from: number
  to: number
  text: string
}

/** head 按空行切成段；开头的一级标题是白板的名字，不算 */
export function looseParagraphs(doc: BoardDoc): Loose[] {
  const out: Loose[] = []
  const head = doc.head
  let start = -1
  let end = 0
  let pos = 0
  const flush = () => {
    if (start === -1) return
    const text = head.slice(start, end)
    const isTitle = out.length === 0 && head.slice(0, start).trim() === '' && /^# [^\n]*$/.test(text)
    if (!isTitle) out.push({ from: start, to: end, text })
    start = -1
  }
  for (const line of head.split('\n')) {
    const lineEnd = pos + line.length
    if (line.trim() === '') flush()
    else {
      if (start === -1) start = pos
      end = lineEnd
    }
    pos = lineEnd + 1
  }
  flush()
  return out
}

/** 把 head 里的一段拿出来放成一张卡 */
export function placeLoose(doc: BoardDoc, loose: Loose, attrs: Record<string, string | number>): BoardDoc {
  let head = doc.head.slice(0, loose.from) + doc.head.slice(loose.to)
  head = head.replace(/\n{3,}/g, '\n\n')
  if (head.trim() === '') head = ''
  return appendBlock({ ...doc, head }, newBlock('card', attrs, loose.text))
}

/** 移动块：把第 from 块挪到第 to 块的位置 */
export function moveBlock(doc: BoardDoc, from: number, to: number): BoardDoc {
  if (from === to) return doc
  const blocks = doc.blocks.map((b) => ({ ...b, body: endWithBlank(b.body) }))
  const [b] = blocks.splice(from, 1)
  blocks.splice(to > from ? to - 1 : to, 0, b!)
  return { ...doc, blocks }
}

// ---------- 新旧写法：2026-11-21 起白板改成「## 列名」写法（board-convert.ts） ----------

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/
const LAYOUT = /^<!--\s*(card|column)\s+(.*?)\s*-->\s*$/

/** 每一行（代码块里的不算）：是排版注释的交给 f */
function eachLayoutLine(text: string, f: (kind: 'card' | 'column', attrs: string) => boolean): boolean {
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const m = FENCE_LINE.exec(line)
    if (m) {
      if (!fence) fence = m[1]![0]!
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence) continue
    const l = LAYOUT.exec(line)
    if (l && f(l[1] as 'card' | 'column', l[2]!)) return true
  }
  return false
}

/** 文字里有旧写法的排版注释：卡上写着 in= 或 w=、列上写着 title= 或 w= */
export function hasOldLayout(text: string): boolean {
  return eachLayoutLine(text, (kind, a) => (kind === 'card' ? /(?:^|\s)(in|w)=/.test(a) : /(?:^|\s)(title|w)=/.test(a)))
}
