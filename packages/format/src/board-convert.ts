/**
 * 以前的白板写法（type: board，列和卡的排版写在 `<!-- column … -->`、`<!-- card … in=… -->` 注释里，board.ts）
 * 一次转成「## 列名」写法（2026-11-21 用户选方向 A「一份文字两种看法」，doc-board.ts）。纯函数，不碰文件，转的那一次由主进程提交。
 *
 * 转的规矩：
 * 1. frontmatter 原样（type: board、连线 links、颜色都留着）；开头的标题和没放进卡片的段落留在最前面（白板最左一组）。
 * 2. 空白处的卡（没有 in=）：前面一行位置 `<!-- card id=… x=… y=… -->`，编号不变，坐标换到新画布上（新画布左边让 92、
 *    顶上让 64 都算在白板坐标里，旧的是画布外的边距：x + 4、y + 64），摆在原处。一张卡里有好几块的，一块一张往下排。
 * 3. 每一列变成一节「## 列名」，列里的卡（按文件里的先后）紧跟在下面，卡前的注释行去掉；连线的一头、AI 总结的卡留一行只记编号的
 *    `<!-- card id=a2 ai=… -->`。AI 总结的卡整张写成一个 `> [!ai] AI 总结` 提示块（task-5yp97：能选一句开旁支；几段也还是一张卡）。列按从左到右排；白板上有空白处的卡、或者列不在一排时，列也留一行 `<!-- column id=… x=… y=… -->` 摆在原处。
 * 4. 卡里（和开头那几段里）的标题改成加粗的一行（开头的「# 名字」除外）：留着标题就会变成一列（白板上没有 ## 时连 #### 也会）。
 *    列留了位置时，开头那几段（和没认出来的卡）也各留一行位置，摆在所有东西的右边：不然最左一组从左上角排起，和摆在原处的列、卡叠在一起。
 * 5. 一个字都不丢：转完再按旧写法读，读不出东西；按新写法读，每张卡都在。
 */
import { attr, type Block, content, fmValue, hasOldLayout, parseBoard } from './board'
import { type DocUnit, linksOf, placeLine, splitDoc, tagLine } from './doc-board'
import { isMindmap } from './mindmap'
import { summaryCallout } from './summary-card'

/** 旧白板的坐标换到新白板上要加多少（旧画布外边距 96 / 64，新白板第一列离左边 92、白板坐标里顶上让 64） */
export const OLD_OFFSET = { x: 4, y: 64 }

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** 打开时要转：type: board、不是导图、还是旧写法 */
export function needsConvert(text: string): boolean {
  return fmValue(text, 'type') === 'board' && !isMindmap(text) && hasOldLayout(text)
}

/** 卡里的标题改成加粗的一行（代码块里的不动）；keepTitle：开头第一行的「# 名字」留着 */
function demote(md: string, keepTitle = false): string {
  let fence: string | null = null
  let first = keepTitle
  return md
    .split('\n')
    .map((line) => {
      const f = FENCE.exec(line)
      if (f) {
        if (!fence) fence = f[1]![0]!
        else if (line.trim().startsWith(fence)) fence = null
        first = false
        return line
      }
      if (fence) return line
      const h = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
      if (!h) {
        if (line.trim()) first = false
        return line
      }
      // 开头的「# 标题」是白板的名字
      if (first && h[1] === '#') {
        first = false
        return line
      }
      first = false
      const t = h[2]!.replace(/\*\*/g, '').trim()
      return t ? `**${t}**` : line
    })
    .join('\n')
}

/** 量不到（还没画出来）时按字数估一张卡多高：13px、行高 1.65、内边距 14，图 180，表格每行 24 */
function estimate(u: DocUnit): number {
  if (u.kind === 'image' || u.kind === 'images' || u.kind === 'embed' || u.kind === 'video') return 200
  if (u.kind === 'table') return 60 + u.text.split('\n').length * 24
  let lines = 0
  for (const line of u.text.split('\n')) {
    if (!line.trim()) continue
    let w = 0
    for (const ch of line) w += /[⺀-￿]/.test(ch) ? 13 : 7
    lines += Math.max(1, Math.ceil(w / 244))
  }
  return Math.round(28 + Math.max(1, lines) * 21.5)
}

/** 一张旧卡的正文切成新写法的几块（标题已降级）：卡、空隙都按文件里的先后 */
function unitsOf(body: string): DocUnit[] {
  const b = splitDoc(body)
  const all = [...b.columns.flatMap((c) => c.cards), ...b.placed]
  return all.sort((x, y) => x.from - y.from)
}

const extra = (b: Block): Record<string, string> | undefined => {
  const out = Object.fromEntries(b.attrs.filter(([k]) => !['id', 'x', 'y', 'w', 'in'].includes(k)))
  return Object.keys(out).length ? out : undefined
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0)

/**
 * 旧白板转成新写法。没什么要转的（不是旧写法）原样返回；columns、cards 是转完有几列、几张卡（提示条上说）
 */
export function convertBoard(text: string): { text: string; columns: number; cards: number } {
  if (!hasOldLayout(text)) {
    const b = splitDoc(text)
    return { text, columns: b.columns.filter((c) => c.head).length, cards: b.total }
  }
  const doc = parseBoard(text)
  const wired = new Set(linksOf(text).flatMap((l) => [l.from, l.to]))
  const ids = new Set(doc.blocks.map((b) => attr(b, 'id')).filter((x): x is string => !!x))
  const fresh = () => {
    let n = 1
    while (ids.has(`d${n}`)) n++
    ids.add(`d${n}`)
    return `d${n}`
  }
  const columns = doc.blocks.filter((b) => b.kind === 'column' && attr(b, 'id'))
  const colIds = new Set(columns.map((c) => attr(c, 'id')!))
  const inCol = (b: Block) => {
    const c = attr(b, 'in')
    return c && colIds.has(c) ? c : null
  }
  const cards = doc.blocks.filter((b) => b.kind === 'card')
  const free = cards.filter((b) => !inCol(b) && attr(b, 'id') && attr(b, 'x') !== undefined && attr(b, 'y') !== undefined)
  /** 列里的卡被拿走以后、没认出来的卡（没编号、指向的列不在了）：放进最左一组，不摆位置 */
  const loose = cards.filter((b) => !inCol(b) && !free.includes(b))

  // 列按从左到右（一样左时从上到下）排成节；白板上有空白处的卡、或者列不在一排时，列留在原处
  const order = [...columns].sort((a, b) => fin(Number(attr(a, 'x'))) - fin(Number(attr(b, 'x'))) || fin(Number(attr(a, 'y'))) - fin(Number(attr(b, 'y'))))
  const ys = order.map((c) => fin(Number(attr(c, 'y'))))
  const placeCols = free.length > 0 || (ys.length > 1 && Math.max(...ys) - Math.min(...ys) > 40)
  /** 列留在原处时，最左一组的东西从这里往下排：所有东西的右边再空 40 */
  const right = Math.max(0, ...[...free, ...columns].map((b) => fin(Number(attr(b, 'x'))) + fin(Number(attr(b, 'w') ?? (b.kind === 'column' ? 300 : 280)))))
  const aside = { x: Math.round(right + OLD_OFFSET.x + 40), y: OLD_OFFSET.y }
  /** 最左一组的一段字：列留在原处时每一块前面一行位置（第一块用 id，没有就新编一个），往下排 */
  const asideOf = (body: string, id?: string, more?: Record<string, string>) => {
    const units = unitsOf(body).filter((u) => u.kind !== 'gap')
    if (!units.length) return body.trim()
    let out = ''
    let cursor = 0
    units.forEach((u, i) => {
      out += body.slice(cursor, u.from)
      out += `${placeLine(i === 0 && id ? id : fresh(), aside.x, aside.y, i === 0 ? more : undefined)}\n${body.slice(u.from, u.to)}`
      cursor = u.to
      aside.y += estimate(u) + 12
    })
    return (out + body.slice(cursor)).trim()
  }

  const pieces: string[] = []
  const head = demote(doc.head.replace(/\s+$/, ''), true)
  if (head.trim() && !placeCols) pieces.push(head)
  else if (head.trim()) {
    // 开头的「# 名字」留在最前面，下面的几段摆到一边
    const t = /^\s*# [^\n]*(?:\n|$)/.exec(head)
    const title = t ? t[0].trim() : ''
    const rest = t ? head.slice(t[0].length) : head
    if (title) pieces.push(title)
    if (rest.trim()) pieces.push(asideOf(rest))
  }

  /** 卡的正文（标题降级、去掉结尾空行）；AI 总结的卡写成一个 AI 总结块（整张一块，不按段拆开） */
  const bodyOf = (b: Block) => {
    const body = demote(content(b))
    return attr(b, 'ai') !== undefined && body.trim() ? summaryCallout(body.trim()) : body
  }

  // 2. 空白处的卡：每一块前面一行位置（第一块用原来的编号），块和块之间原来的字（空行、别的注释）原样留着
  for (const b of free) {
    const body = bodyOf(b)
    const units = unitsOf(body).filter((u) => u.kind !== 'gap')
    if (!body.trim()) continue
    if (!units.length) {
      pieces.push(body.trim())
      continue
    }
    const x = fin(Number(attr(b, 'x'))) + OLD_OFFSET.x
    let y = fin(Number(attr(b, 'y'))) + OLD_OFFSET.y
    let out = ''
    let cursor = 0
    units.forEach((u, i) => {
      out += body.slice(cursor, u.from)
      out += `${placeLine(i === 0 ? attr(b, 'id')! : fresh(), x, y, i === 0 ? extra(b) : undefined)}\n${body.slice(u.from, u.to)}`
      cursor = u.to
      y += estimate(u) + 12
    })
    out += body.slice(cursor)
    pieces.push(out.trim())
  }
  for (const b of loose) {
    const body = bodyOf(b)
    if (!body.trim()) continue
    const id = attr(b, 'id')
    const keep = id && (wired.has(id) || extra(b))
    if (placeCols) pieces.push(asideOf(body, keep ? id : undefined, keep ? extra(b) : undefined))
    else pieces.push(keep ? `${tagLine(id, extra(b))}\n${body}` : body)
  }

  // 3. 列：每一列一节
  for (const c of order) {
    const id = attr(c, 'id')!
    const title = (attr(c, 'title') ?? '').replace(/\s+/g, ' ').trim() || '新的列'
    const line = placeCols ? `<!-- column id=${id} x=${Math.round(fin(Number(attr(c, 'x'))) + OLD_OFFSET.x)} y=${Math.round(fin(Number(attr(c, 'y'))) + OLD_OFFSET.y)} -->\n` : ''
    pieces.push(`${line}## ${title}`)
    // 列注释下面直接写的字（旧白板里算这一列的「正文」，白板上不画）：留在这一节开头
    const own = demote(content(c))
    if (own.trim()) pieces.push(own)
    for (const b of cards.filter((x) => inCol(x) === id)) {
      const body = bodyOf(b)
      if (!body.trim()) continue
      const cid = attr(b, 'id')
      const keep = cid && (wired.has(cid) || extra(b))
      pieces.push(keep ? `${tagLine(cid, extra(b))}\n${body}` : body)
    }
  }

  const out = doc.fm + pieces.join('\n\n') + '\n'
  const b = splitDoc(out)
  return { text: out, columns: b.columns.filter((x) => x.head).length, cards: b.total }
}

/** 白板缩略图里的一块（坐标是白板上的像素）；k：n 普通卡、c 素材卡、i 图片、l 列 */
export interface BoardThumbRect {
  x: number
  y: number
  w: number
  h: number
  k: 'n' | 'c' | 'i' | 'l'
}

/** 新写法白板的缩略图（首页、文件夹首页「最近的白板」）：一排的列、摆在自己位置的列、空白处的卡；cards 是一共几张卡 */
export function boardThumb(text: string): { cards: number; thumb: BoardThumbRect[] } {
  const b = splitDoc(text)
  const thumb: BoardThumbRect[] = []
  let i = 0
  for (const c of b.columns) {
    const n = c.cards.filter((u) => u.kind !== 'gap').length
    const h = (c.head ? 52 : 0) + n * 90
    if (c.place) thumb.push({ x: c.place.x, y: c.place.y, w: 276, h, k: 'l' })
    else {
      thumb.push({ x: i * 298, y: 64, w: 276, h, k: c.head ? 'l' : 'n' })
      i++
    }
  }
  for (const u of b.placed) {
    const k = u.kind === 'image' || u.kind === 'images' ? 'i' : u.kind === 'quote' ? 'c' : 'n'
    thumb.push({ x: u.place!.x, y: u.place!.y, w: 276, h: Math.min(320, estimate(u)), k })
  }
  return { cards: b.total, thumb }
}
