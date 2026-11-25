/**
 * 白板装饰（设计页 145「卡片贴纸便签胶带」，2026-11-25 用户定「可以开工」）：贴纸、胶带写进这块白板的笔迹文件（ink.ts 的 笔迹.ink），
 * 一样一行；文档正文（md）一个字不多。便签和卡片样式是卡，写在 md 卡前那行注释里（setCardAttrs / setColumnAttrs / addNote）。
 * 消失笔哪里都不写。
 * 这一份是规格也是读写的代码；iPhone / iPad 那份 apps/apple/CanvasCore/Sources/CanvasCore/Ink/InkDecor.swift 一比一移植，
 * 改这里要两边一起改（apps/apple/test/ink-decor-fixtures.test.ts 导出的对照样例会红）。不依赖 Electron。
 *
 * 一、两种新行（ink.ts 里它们是「认不出的行」：原样留着、原样写回；这里认它们、改它们）：
 *    1. 胶带 `{"tape":"t8k2m9qa","on":"k4kwi8","at":"tl","pat":"mint","len":80,"rot":-40,"seed":2}`
 *       - tape：编号（8 个 [0-9a-z]，inkId）；pat：花样（TAPE_PATTERNS，认不出的按 mint 画）；len：长（白板点，宽固定 26）；
 *       - rot：角度（度，顺时针为正）；seed：定撕口的样子（两台设备画出来一样），整数；
 *       - on：挂在哪张卡（卡的编号，那一行带 ink=1，同笔迹的组）；at：吸在卡的哪个位置（TAPE_ANCHORS 八个之一），
 *         有 at 时胶带中心就在那张卡那个位置上（tapeAnchor），卡挪到哪跟到哪；
 *       - 没有 at：x、y 是胶带中心，有 on 时相对卡左上角，没有 on 是白板坐标（钉在白板上）。
 *    2. 贴纸 `{"sticker":"s2m8x0qa","k":"coffee","x":648,"y":50,"w":76,"rot":10}`
 *       - sticker：编号；k：自带贴纸的名字（STICKERS，第一次用时把那张 SVG 拷进库里的 `附件/贴纸/<k>.svg`）；
 *         src：拖进来的透明图（库里的路径）；k、src 有且只有一个；
 *       - x、y：贴纸中心，有 on 时相对那张卡左上角，没有 on 是白板坐标；w：宽（白板点，高按图的比例）；rot：角度（度）。
 *    两种都可以有 t：最后一次改这一行的时间（毫秒），合并时两边都改了取 t 大的（同笔画行）。
 *    键的顺序：程序写的时候照上面（胶带 tape、on、at、x、y、pat、len、rot、seed、t；贴纸 sticker、k、src、on、x、y、w、rot、t），
 *    认不出的键原样跟在后面。数最多两位小数（fmt2）。行的先后就是叠放的先后，「放到最上面」是把那一行挪到文末。
 *    缺键、类型不对的行：不画、原样留着。挂的卡找不到（删了）时不画、文件里照留（撤回删卡就回来）。
 *
 * 二、两台设备都改了（mergeInk）：装饰行按编号合（胶带 `d:tape:<编号>`、贴纸 `d:sticker:<编号>`），规矩和笔画行一样。
 *
 * 三、卡片样式、便签（写在 md 卡注释行上，文档看法里看不出来）：
 *    - 卡：`<!-- card id=k1gg3i style=header color=0 -->`，style 五选一（CARD_STYLES，没写是 paper），color 是主题六色
 *      （导图那六色 --mm-b0…5）的第几个，换主题跟着换；
 *    - 列：列名下面紧跟的一行 `<!-- column style=header color=2 -->`（整列的卡头和底），splitDoc 读进 DocColumn.attrs；
 *    - 便签：一张摆在空白处的卡多 `note=<纸色>`（NOTE_COLORS）和 `rot=<角度>`（歪的角度记下来，不每次重抽），可以有 `w=`、`h=`（默认 200）。
 */
import { type DocColumn, type DocUnit, appendPlaced, freshId, placeLine, tagLine } from './doc-board'
import { emptyInk, fmt2, inkId, inkQuote, inkUnquote, type InkDoc, type InkLine, scanInkObject } from './ink'

// ---------------------------------------------------------------- 目录（两端画法照设计稿 design/ink-decor/src/decor.js）

/** 卡片样式：纸面（现在的卡）、磨砂玻璃、描边、彩头、横线纸 */
export const CARD_STYLES = ['paper', 'glass', 'outline', 'header', 'lined'] as const
export type CardStyle = (typeof CARD_STYLES)[number]
/** 便签纸色：柠檬黄、薄荷绿、天蓝、樱粉、杏橙、丁香紫 */
export const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'lilac'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]
/** 便签纸色（设计稿 decor.js 的 PAPER）：每色浅、深两套，各三档（纸面从上到下的渐变 p0 / p1 / p2）。Mac 的 decor.css、iPad 的 DecorPaint 都照这一份（有测试守着） */
export const NOTE_PAPER: Record<NoteColor, { light: readonly [string, string, string]; dark: readonly [string, string, string] }> = {
  yellow: { light: ['#FFF0A0', '#FFE680', '#FFDD5E'], dark: ['#5E5526', '#57501F', '#4E4719'] },
  green: { light: ['#D7F3DF', '#C6ECD2', '#B2E3C1'], dark: ['#2F4E3D', '#2A4737', '#243F31'] },
  blue: { light: ['#DCEBFC', '#CBE1F9', '#B7D4F4'], dark: ['#2C4560', '#283F58', '#22384F'] },
  pink: { light: ['#FFE0E7', '#FFD0DB', '#FCBDCC'], dark: ['#5A3643', '#53313D', '#4A2B36'] },
  orange: { light: ['#FFE6C7', '#FFDAB0', '#FCCB94'], dark: ['#5E432A', '#573D26', '#4E3621'] },
  lilac: { light: ['#ECE3FC', '#E0D4FA', '#D2C2F5'], dark: ['#463D62', '#40375A', '#393151'] },
}
/** 便签默认大小 */
export const NOTE_SIZE = 200
/** 胶带花样：薄荷格纹、樱粉波点、柠檬斜纹、牛皮纸、方格纸、丁香碎花、夜空星星、跟主题色 */
export const TAPE_PATTERNS = ['mint', 'dots', 'stripe', 'kraft', 'grid', 'floral', 'stars', 'accent'] as const
/** 胶带宽（白板点） */
export const TAPE_WIDTH = 26
/** 拖到离吸附位这么近（白板点）就吸住 */
export const TAPE_SNAP = 36
/** 胶带吸附位：四角（斜 40°）和四边中点 */
export const TAPE_ANCHORS = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'] as const
export type TapeAnchor = (typeof TAPE_ANCHORS)[number]
/** 自带贴纸：三套各 12 张（学习、标签、心情），自己画的、CC0；标签那套是宽的（96 × 48） */
export const STICKER_PACKS = {
  study: ['star', 'bulb', 'check', 'ask', 'bang', 'book', 'pencil', 'cap', 'lens', 'clock', 'cup', 'fire'],
  label: ['zd', 'kd', 'dc', 'yd', 'gd', 'wls', 'lg', 'fx', 'cy', 'todo', 'done', 'bd'],
  mood: ['coffee', 'heart', 'smile', 'spark', 'sun', 'cloud', 'leaf', 'cat', 'rocket', 'moon', 'note', 'rainbow'],
} as const
export const STICKERS: readonly string[] = [...STICKER_PACKS.study, ...STICKER_PACKS.label, ...STICKER_PACKS.mood]
/** 自带贴纸第一次用时拷进库里的这里：附件/贴纸/<k>.svg */
export const stickerPathOf = (k: string) => `附件/贴纸/${k}.svg`
/** 贴纸默认宽：普通 76，字标签 96 */
export const stickerWidth = (k: string | null) => (k && (STICKER_PACKS.label as readonly string[]).includes(k) ? 96 : 76)

// ---------------------------------------------------------------- 一行

export interface InkTape {
  kind: 'tape'
  id: string
  on: string | null
  at: TapeAnchor | null
  /** 没有 at 时：胶带中心（挂卡的相对卡左上角） */
  x: number
  y: number
  pat: string
  len: number
  rot: number
  seed: number
  t: number | null
}

export interface InkSticker {
  kind: 'sticker'
  id: string
  /** 自带贴纸的名字；拖进来的图是 null */
  k: string | null
  /** 拖进来的图在库里的路径；自带的是 null */
  src: string | null
  on: string | null
  /** 贴纸中心（挂卡的相对卡左上角） */
  x: number
  y: number
  w: number
  rot: number
  t: number | null
}

export type InkDecor = InkTape | InkSticker

/** 认不出的键：键名和原样的 JSON 值 */
type Extra = [string, string][]
export type ParsedDecor = InkDecor & { extra: Extra }

const NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const TAPE_KEYS = new Set(['tape', 'on', 'at', 'x', 'y', 'pat', 'len', 'rot', 'seed', 't'])
const STICKER_KEYS = new Set(['sticker', 'k', 'src', 'on', 'x', 'y', 'w', 'rot', 't'])

/** 读一行装饰；不是装饰（或缺键、类型不对）返回 null */
export function parseDecorLine(raw: string): ParsedDecor | null {
  const kv = scanInkObject(raw)
  if (!kv) return null
  const m = new Map<string, string>()
  for (const [k, v] of kv) if (!m.has(k)) m.set(k, v)
  if (m.size !== kv.length) return null
  if (m.has('id') || m.has('g') || m.has('ink')) return null
  const str = (k: string): string | null | undefined => {
    if (!m.has(k)) return undefined
    const v = m.get(k)!
    return v.startsWith('"') ? unq(v) : null
  }
  const num = (k: string, dflt: number): number | null => {
    if (!m.has(k)) return dflt
    const v = m.get(k)!
    return NUM.test(v) ? Number(v) : null
  }
  const int = (k: string): number | null | undefined => {
    if (!m.has(k)) return undefined
    const n = num(k, 0)
    return n !== null && Number.isSafeInteger(n) ? n : null
  }
  const extra = (known: Set<string>): Extra => kv.filter(([k]) => !known.has(k))
  const isTape = m.has('tape')
  if (isTape === m.has('sticker')) return null
  const id = str(isTape ? 'tape' : 'sticker')
  const on = str('on')
  const x = num('x', 0)
  const y = num('y', 0)
  const rot = num('rot', 0)
  const t = int('t')
  if (!id || on === null || on === '' || x === null || y === null || rot === null || t === null) return null
  if (isTape) {
    const at = str('at')
    const pat = str('pat')
    const len = num('len', NaN)
    const seed = int('seed')
    if (at === null || (at !== undefined && !(TAPE_ANCHORS as readonly string[]).includes(at)) || (at !== undefined && on === undefined)) return null
    if (!pat || len === null || !(len > 0) || seed === null) return null
    return { kind: 'tape', id, on: on ?? null, at: (at as TapeAnchor | undefined) ?? null, x, y, pat, len, rot, seed: seed ?? 0, t: t ?? null, extra: extra(TAPE_KEYS) }
  }
  const k = str('k')
  const src = str('src')
  const w = num('w', NaN)
  if (k === null || src === null || (k === undefined) === (src === undefined) || k === '' || src === '' || w === null || !(w > 0)) return null
  return { kind: 'sticker', id, k: k ?? null, src: src ?? null, on: on ?? null, x, y, w, rot, t: t ?? null, extra: extra(STICKER_KEYS) }
}

const unq = inkUnquote

const extraText = (e: Extra) => e.map(([k, v]) => `,${inkQuote(k)}:${v}`).join('')

/** 一行装饰照固定写法写出来 */
export function decorLineText(d: InkDecor & { extra?: Extra }): string {
  const tail = (d.t !== null ? `,"t":${d.t}` : '') + extraText(d.extra ?? [])
  const on = d.on !== null ? `,"on":${inkQuote(d.on)}` : ''
  if (d.kind === 'tape') {
    const pos = d.at !== null ? `,"at":${inkQuote(d.at)}` : `,"x":${fmt2(d.x)},"y":${fmt2(d.y)}`
    return `{"tape":${inkQuote(d.id)}${on}${pos},"pat":${inkQuote(d.pat)},"len":${fmt2(d.len)},"rot":${fmt2(d.rot)},"seed":${d.seed}${tail}}`
  }
  const what = d.k !== null ? `,"k":${inkQuote(d.k)}` : `,"src":${inkQuote(d.src ?? '')}`
  return `{"sticker":${inkQuote(d.id)}${what}${on},"x":${fmt2(d.x)},"y":${fmt2(d.y)},"w":${fmt2(d.w)},"rot":${fmt2(d.rot)}${tail}}`
}

/** 合并时认这一行的键（ink.ts 的 keyOf 用）；不是装饰返回 null */
export function decorKey(raw: string): string | null {
  const d = parseDecorLine(raw)
  return d ? `d:${d.kind}:${d.id}` : null
}

/** 合并时两边都改了比的时间（ink.ts 的 timeOf 用） */
export function decorTime(raw: string): number {
  return parseDecorLine(raw)?.t ?? 0
}

// ---------------------------------------------------------------- 一份里的装饰、改

const lineOf = (d: InkDecor & { extra?: Extra }): InkLine => ({ kind: 'other', raw: decorLineText(d) })

/** 一份里的装饰，按叠放的先后（同一个编号写了两行时只算后面那行，摆在后面那行的位置） */
export function inkDecors(doc: InkDoc): ParsedDecor[] {
  const all: { at: number; d: ParsedDecor }[] = []
  const last = new Map<string, number>()
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'other') return
    const d = parseDecorLine(l.raw)
    if (!d) return
    all.push({ at: i, d })
    last.set(`${d.kind}:${d.id}`, i)
  })
  return all.filter(({ at, d }) => last.get(`${d.kind}:${d.id}`) === at).map(({ d }) => d)
}

/** 加一样装饰，加在最后（盖在最上面） */
export function addDecor(doc: InkDoc, d: InkDecor): InkDoc {
  const base = doc.lines.length ? doc : emptyInk()
  return { lines: [...base.lines, lineOf(d)], end: '\n' }
}

/** 改一样装饰（编号和种类不变，记上改的时间）；没有这一样原样返回 */
export function updateDecor(doc: InkDoc, kind: InkDecor['kind'], id: string, patch: Partial<Omit<InkTape, 'kind' | 'id'>> | Partial<Omit<InkSticker, 'kind' | 'id'>>, now: number): InkDoc {
  let changed = false
  const lines = doc.lines.map((l): InkLine => {
    if (l.kind !== 'other') return l
    const d = parseDecorLine(l.raw)
    if (!d || d.kind !== kind || d.id !== id) return l
    const next = { ...d, ...patch, kind: d.kind, id: d.id } as ParsedDecor
    // 改完和原来一样（不算 t）：不动这一行
    if (decorLineText({ ...next, t: null }) === decorLineText({ ...d, t: null })) return l
    changed = true
    return { kind: 'other', raw: decorLineText({ ...next, t: now }) }
  })
  return changed ? { lines, end: doc.end || '\n' } : doc
}

/** 删掉这几样装饰（ids 是「种类:编号」，比如 tape:t8k2m9qa） */
export function deleteDecors(doc: InkDoc, keys: Iterable<string>): InkDoc {
  const pick = new Set(keys)
  const lines = doc.lines.filter((l) => {
    if (l.kind !== 'other') return true
    const d = parseDecorLine(l.raw)
    return !d || !pick.has(`${d.kind}:${d.id}`)
  })
  return lines.length === doc.lines.length ? doc : { lines, end: doc.end }
}

/** 放到最上面：这一样的行挪到文末（行的字不变） */
export function raiseDecor(doc: InkDoc, kind: InkDecor['kind'], id: string): InkDoc {
  const at: number[] = []
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'other') return
    const d = parseDecorLine(l.raw)
    if (d && d.kind === kind && d.id === id) at.push(i)
  })
  if (!at.length || at[at.length - 1] === doc.lines.length - 1) return doc
  const keep = doc.lines.filter((_, i) => !at.includes(i))
  return { lines: [...keep, doc.lines[at[at.length - 1]!]!], end: doc.end || '\n' }
}

/** 新的装饰编号：8 个 [0-9a-z] 的随机字（同 inkId） */
export function decorId(rand: () => number = Math.random): string {
  return inkId(rand)
}

// ---------------------------------------------------------------- 胶带吸附

export interface DecorRect {
  /** 卡的编号（没有编号的卡也能吸：吸住时 inkCardId 给它加） */
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 卡上这个吸附位：胶带中心和默认角度（四角斜 40°，上下边横着，左右边竖着） */
export function tapeAnchor(r: { x: number; y: number; w: number; h: number }, at: TapeAnchor): { x: number; y: number; rot: number } {
  switch (at) {
    case 'tl':
      return { x: r.x, y: r.y, rot: -40 }
    case 'tr':
      return { x: r.x + r.w, y: r.y, rot: 40 }
    case 'bl':
      return { x: r.x, y: r.y + r.h, rot: 40 }
    case 'br':
      return { x: r.x + r.w, y: r.y + r.h, rot: -40 }
    case 't':
      return { x: r.x + r.w / 2, y: r.y, rot: 0 }
    case 'b':
      return { x: r.x + r.w / 2, y: r.y + r.h, rot: 0 }
    case 'l':
      return { x: r.x, y: r.y + r.h / 2, rot: 90 }
    case 'r':
      return { x: r.x + r.w, y: r.y + r.h / 2, rot: 90 }
  }
}

/** 拖着胶带到 (x, y)（白板坐标）：最近的吸附位（TAPE_SNAP 以内）；后面的卡盖在前面的上面，一样近时取后面的 */
export function snapTape(rects: readonly DecorRect[], x: number, y: number): { on: string; at: TapeAnchor; x: number; y: number; rot: number } | null {
  let best: { on: string; at: TapeAnchor; x: number; y: number; rot: number } | null = null
  let bd = TAPE_SNAP
  for (const r of rects) {
    for (const at of TAPE_ANCHORS) {
      const p = tapeAnchor(r, at)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d <= bd) {
        bd = d
        best = { on: r.id, at, ...p }
      }
    }
  }
  return best
}

/**
 * 一样装饰在白板上的中心和角度；挂的卡找不到返回 null（不画）。
 * 挂在歪着的卡上（便签带 rot）：x、y、at 都是这张卡没转时的框里的位置，画的时候绕卡的中心一起转 rot；装饰自己的 rot 是相对这张卡的
 */
export function decorPlace(d: InkDecor, cardRect: (id: string) => { x: number; y: number; w: number; h: number; rot?: number } | null): { x: number; y: number; rot: number } | null {
  if (d.on === null) return { x: d.x, y: d.y, rot: d.rot }
  const r = cardRect(d.on)
  if (!r) return null
  const p = d.kind === 'tape' && d.at !== null ? tapeAnchor(r, d.at) : { x: r.x + d.x, y: r.y + d.y }
  const turn = r.rot ?? 0
  if (!turn) return { x: p.x, y: p.y, rot: d.rot }
  const a = (turn * Math.PI) / 180
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a), rot: d.rot + turn }
}

/** 转贴纸时靠近 0°、±15°、±90°（3° 以内）吸一下 */
export function snapRotation(rot: number): number {
  const r = ((((rot + 180) % 360) + 360) % 360) - 180
  for (const s of [0, 15, -15, 90, -90]) if (Math.abs(r - s) < 3) return s
  return Math.round(r * 10) / 10
}

// ---------------------------------------------------------------- 卡片样式、便签：md 卡注释行

/** 卡注释行上的属性改成 patch（值是 null 的去掉）；卡没有注释行就在卡前面加一行只记编号的 `<!-- card id=k1 … -->` */
export function setCardAttrs(text: string, unit: DocUnit, patch: Record<string, string | null>): string {
  const attrs: Record<string, string> = { ...(unit.attrs ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete attrs[k]
    else attrs[k] = v
  }
  const same = JSON.stringify(Object.entries(attrs)) === JSON.stringify(Object.entries(unit.attrs ?? {}))
  if (same && (unit.place || unit.tag || !Object.keys(attrs).length)) return text
  if (unit.place) return text.slice(0, unit.place.from) + placeLine(unit.place.id, unit.place.x, unit.place.y, attrs) + text.slice(unit.place.to)
  if (unit.tag) return text.slice(0, unit.tag.from) + tagLine(unit.tag.id, attrs) + text.slice(unit.tag.to)
  const fresh = freshId(text, 'k')
  return text.slice(0, unit.from) + tagLine(fresh, attrs) + '\n' + text.slice(unit.from)
}

/** 卡的样式（没写、认不出是 paper）和颜色（主题六色的第几个，没写是 null） */
export function cardStyleOf(attrs: Record<string, string> | undefined): { style: CardStyle; color: number | null } {
  const s = attrs?.style
  const style = (CARD_STYLES as readonly string[]).includes(s ?? '') ? (s as CardStyle) : 'paper'
  const c = Number(attrs?.color)
  return { style, color: attrs?.color !== undefined && Number.isInteger(c) && c >= 0 && c < 6 ? c : null }
}

/** 这张卡是不是便签：纸色（认不出的按 yellow）、角度、大小；不是返回 null */
export function noteOf(unit: DocUnit): { color: NoteColor; rot: number; w: number; h: number } | null {
  const a = unit.attrs
  if (!a?.note) return null
  const color = (NOTE_COLORS as readonly string[]).includes(a.note) ? (a.note as NoteColor) : 'yellow'
  const n = (v: string | undefined, d: number) => (v !== undefined && NUM.test(v) ? Number(v) : d)
  return { color, rot: n(a.rot, 0), w: Math.max(80, n(a.w, NOTE_SIZE)), h: Math.max(80, n(a.h, NOTE_SIZE)) }
}

/** 新便签：摆在空白处的一张卡（x、y 是左上角），行上带 note=纸色 rot=角度；body 不能是空的 */
export function addNote(text: string, body: string, x: number, y: number, color: NoteColor, rot: number): string {
  return appendPlaced(text, body, x, y, { note: color, rot: fmt2(rot) })
}

/** 列的样式行（列名下面紧跟的 `<!-- column style=… -->`）改成 patch；全去掉时整行删 */
export function setColumnAttrs(text: string, column: DocColumn, patch: Record<string, string | null>): string {
  if (!column.head) return text
  const attrs: Record<string, string> = { ...(column.attrs ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete attrs[k]
    else attrs[k] = v
  }
  const body = Object.entries(attrs)
    .map(([k, v]) => (/^[^\s"]+$/.test(v) ? ` ${k}=${v}` : ` ${k}="${v.replace(/"/g, "'")}"`))
    .join('')
  const line = `<!-- column${body} -->`
  if (column.styleLine) {
    if (!body) {
      let end = column.styleLine.to
      if (text[end] === '\n') end++
      return text.slice(0, column.styleLine.from) + text.slice(end)
    }
    return text.slice(0, column.styleLine.from) + line + text.slice(column.styleLine.to)
  }
  if (!body) return text
  return text.slice(0, column.head.to) + '\n' + line + text.slice(column.head.to)
}
