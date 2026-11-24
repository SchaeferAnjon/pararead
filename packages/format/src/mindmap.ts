/**
 * 导图白板：frontmatter 里 `白板样式: 导图` 的白板。导图本身就是正文里的一段嵌套列表，打开文档就是大纲：
 *
 *   - 线性映射 <!-- box=0.36,0.42,0.26,0.12 -->
 *     - 定义 <!-- fold -->
 *       - T(u+v)=T(u)+T(v)
 *     - 核与像 <!-- id=k1 frame=2 frame-title="都能写成矩阵" -->
 *       - 秩-零渡定理 <!-- box=0.6,0.8,0.2,0.06 unsure guesses="秩-零化度定理|秩-零化渡定理" -->
 *         dim V = dim ker T + dim im T。
 *     - 旋转 ![旋转](../../附件/导图/旋转.png) <!-- img-w=88 -->
 *   - 浮动主题 <!-- at=470,250 -->
 *
 * 行尾的 HTML 注释记这个主题的事：AI 认照片时记的照片上哪一块（box，x y w h 都是 0 到 1）、拿不准（unsure）、猜的几种写法（guesses）；
 * 收起（fold，第一批）；第二批的短编号（id，联系线两头认主题）、外框（frame=从它起框几个、frame-title）、概要（sum、sum-text）、
 * 图的宽（img-w）、浮动主题相对中心的位置（at）；费曼「补进导图」的讲错（wrong）、AI 写的正确说法（fix）、留给自己填的空框（blank）。
 * 别的软件看不见注释，内容不丢。
 * 主题下面缩进的续行是这个主题的备注（文档看法里就是这一项下面的正文）；主题字里的 ![…](…) 是挂在主题上的图。
 * 属性里紧跟「白板样式: 导图」依次是 导图布局（向右是默认不写）、导图配色、导图骨架（默认的不写）、导图联系线（一行一条 `k1 -> k2 "字"`）。
 * 规矩：读进来再写回去一个字节都不变；改一个节点只重写它自己那一行（只改了注释里的东西就只改注释），改备注只动那几行续行；
 * 换了层级的整枝只改缩进。
 */
import { fmValue } from './board'
import { prop } from './props'
import { wikiShown } from './wiki-label'

export type Box = [number, number, number, number]

/** 主题那一行行尾注释里记的（第二批加了短编号、外框、概要、图的宽、浮动主题的位置） */
export interface MapAttrs {
  box?: Box
  unsure?: boolean
  guesses?: string[]
  /** 收起来了：孩子不画，旁边写藏了几个（写在行尾注释里，关了再开还收着） */
  fold?: boolean
  /** 短编号（id=k1）：联系线两头认主题用，改字、挪位置都认得出 */
  id?: string
  /** 外框：从这个主题起框 n 个同级（连同下面的）；title 是左上角的名字，可以不写 */
  frame?: { n: number; title?: string }
  /** 概要：从这个主题起 n 个同级用一个括号收成一句话 */
  sum?: { n: number; text?: string }
  /** 挂着的图画多宽（img-w） */
  imgW?: number
  /** 浮动主题（大树后面、最外层的一项）：相对中心主题中点的位置 */
  at?: [number, number]
  /** 费曼「补进导图」：这个节点讲错了（字变红，下面挂一个 fix 的子节点写正确说法） */
  wrong?: boolean
  /** 费曼「补进导图」：AI 写的正确说法（挂在讲错的节点下面，画成带红框的 AI 块） */
  fix?: boolean
  /** 费曼「补进导图」：含糊、没讲到，后面挂一个虚线空框「自己补一句」，点开自己填（填了加一个子节点，blank 去掉） */
  blank?: boolean
}

export interface MapNode extends MapAttrs {
  text: string
  /** 备注：主题下面缩进的一段（续行，去掉缩进；多段之间空一行）；文档看法里就是这一项下面的正文 */
  note?: string
  /** 挂在主题上的图：主题字里的 ![alt](src)（text 里不再带它） */
  img?: { alt: string; src: string }
  children: MapNode[]
  /** 读进来时这一项的原文（主题那一行 + 备注的续行，不含后面的空行）；没改的部分原样写回 */
  raw?: string
  /** raw 里主题的字和挂的图的签名：变了才整行重写，只改了注释里的东西就只改注释 */
  sig?: string
  /** 读进来时的备注：变了才重写那几行续行 */
  rawNote?: string
  /** 读进来时在第几层（换了层级只改缩进） */
  rawDepth?: number
  /** 这一项后面跟着的空行（每行带换行） */
  tail?: string
}

export interface MapDoc {
  /** 列表前面的原文 */
  before: string
  roots: MapNode[]
  /** 列表后面的原文 */
  after: string
  /** 缩进一层用什么（读文件里的，没有就两个空格） */
  unit: string
  /** 原来就有列表（没有的话写的时候和前后隔开） */
  found: boolean
}

export const MAP_STYLE_KEY = '白板样式'
export const MAP_STYLE = '导图'

export const isMindmap = (text: string) => fmValue(text, MAP_STYLE_KEY) === MAP_STYLE

// ---------- 导图自己的属性：布局、配色、骨架、联系线（排法在 apps/notes/src/shared/mindmap-layout.ts 的分派表里，加新的布局两边各加一项） ----------

export type MapLayoutKind = 'right' | 'both' | 'down' | 'fish' | 'time'
export const MAP_LAYOUT_KEY = '导图布局'
/** 写进文件的说法（不翻：是文件格式） */
export const MAP_LAYOUT_VALUE: Readonly<Record<MapLayoutKind, string>> = { right: '向右', both: '左右', down: '向下', fish: '鱼骨', time: '时间线' }
export const MAP_LAYOUTS = Object.keys(MAP_LAYOUT_VALUE) as MapLayoutKind[]

/** 配色（第二批 ⑩，用户定跟着软件主题走，只挑上色方式）：跟主题（默认，不写）、彩虹、墨线 */
export type MapPalette = 'theme' | 'rainbow' | 'ink'
export const MAP_PALETTE_KEY = '导图配色'
export const MAP_PALETTE_VALUE: Readonly<Record<MapPalette, string>> = { theme: '跟主题', rainbow: '彩虹', ink: '墨线' }
/** 骨架：卡片（默认，不写）、线条、方框 */
export type MapSkeleton = 'card' | 'line' | 'box'
export const MAP_SKELETON_KEY = '导图骨架'
export const MAP_SKELETON_VALUE: Readonly<Record<MapSkeleton, string>> = { card: '卡片', line: '线条', box: '方框' }
export const MAP_RELS_KEY = '导图联系线'

/** 导图的几个属性按这个顺序挨着写在「白板样式: 导图」后面 */
const MAP_KEYS = [MAP_STYLE_KEY, MAP_LAYOUT_KEY, MAP_PALETTE_KEY, MAP_SKELETON_KEY, MAP_RELS_KEY]

function pick<K extends string>(text: string, key: string, table: Readonly<Record<K, string>>, dflt: K): K {
  const v = fmValue(text, key)?.replace(/^["']|["']$/g, '')
  return (Object.keys(table) as K[]).find((k) => table[k] === v) ?? dflt
}

/** 这块导图怎么摆：没写、写了不认识的（以后加的排法在老版本里打开）都当向右 */
export const mapLayoutOf = (text: string): MapLayoutKind => pick(text, MAP_LAYOUT_KEY, MAP_LAYOUT_VALUE, 'right')
export const mapPaletteOf = (text: string): MapPalette => pick(text, MAP_PALETTE_KEY, MAP_PALETTE_VALUE, 'theme')
export const mapSkeletonOf = (text: string): MapSkeleton => pick(text, MAP_SKELETON_KEY, MAP_SKELETON_VALUE, 'card')

/** frontmatter 里一个属性占的几行（键那一行 + 下面缩进的几行）：[第几行, 几行] */
function keyBlock(lines: string[], key: string): [number, number] | null {
  const i = lines.findIndex((l) => l.startsWith(key + ':'))
  if (i === -1) return null
  let n = 1
  while (i + n < lines.length && /^[ \t]+\S/.test(lines[i + n]!)) n++
  return [i, n]
}

/**
 * 导图的一个属性写进 frontmatter（block 是写出来的那一行或几行，undefined 是去掉）：只动这一个属性那几行；
 * 新加的照 MAP_KEYS 的顺序插在前一个后面（布局紧跟「白板样式: 导图」，配色、骨架、联系线依次往后）
 */
function putMapProp(text: string, key: string, block: string | undefined): string {
  const fm = FM.exec(text)?.[0]
  if (!fm) return block === undefined ? text : `---\n${block}\n---\n${text}`
  const lines = fm.split('\n')
  const close = lines.indexOf('---', 1)
  const props = lines.slice(1, close)
  const cur = keyBlock(props, key)
  if (cur) {
    if (block === props.slice(cur[0], cur[0] + cur[1]).join('\n')) return text
    props.splice(cur[0], cur[1], ...(block === undefined ? [] : block.split('\n')))
  } else {
    if (block === undefined) return text
    let at = props.length
    for (let j = MAP_KEYS.indexOf(key) - 1; j >= 0; j--) {
      const b = keyBlock(props, MAP_KEYS[j]!)
      if (b) {
        at = b[0] + b[1]
        break
      }
    }
    props.splice(at, 0, ...block.split('\n'))
  }
  return [lines[0], ...props, ...lines.slice(close)].join('\n') + text.slice(fm.length)
}

function withMapScalar(text: string, key: string, value: string | undefined, same: boolean): string {
  if (same && (value !== undefined || prop(text, key) === undefined)) return text
  return putMapProp(text, key, value === undefined ? undefined : `${key}: ${value}`)
}

/** 换布局只动那一行：新加的紧跟在「白板样式: 导图」后面；向右是默认，去掉那一行 */
export const withMapLayout = (text: string, kind: MapLayoutKind): string =>
  withMapScalar(text, MAP_LAYOUT_KEY, kind === 'right' ? undefined : MAP_LAYOUT_VALUE[kind], mapLayoutOf(text) === kind)
/** 换配色只动那一行；跟主题是默认，不写 */
export const withMapPalette = (text: string, k: MapPalette): string =>
  withMapScalar(text, MAP_PALETTE_KEY, k === 'theme' ? undefined : MAP_PALETTE_VALUE[k], mapPaletteOf(text) === k)
/** 换骨架只动那一行；卡片是默认，不写 */
export const withMapSkeleton = (text: string, k: MapSkeleton): string =>
  withMapScalar(text, MAP_SKELETON_KEY, k === 'card' ? undefined : MAP_SKELETON_VALUE[k], mapSkeletonOf(text) === k)

/** 联系线（第二批 ⑨）：两头主题的短编号、线上的字、弯度（拖小圆点改的，0 不写） */
export interface MapRel {
  a: string
  b: string
  label?: string
  bend?: number
}

const REL = /^([\w-]+)[ \t]*->[ \t]*([\w-]+)(?:[ \t]+"([^"\n]*)")?(?:[ \t]+bend=(-?\d+(?:\.\d+)?))?[ \t]*$/

/** 属性「导图联系线」里一行一条的读出来；认不出的行 junk 里原样留着 */
function relBlock(text: string): { rels: MapRel[]; junk: string[] } {
  const fm = FM.exec(text)?.[0]
  const lines = fm ? fm.split('\n') : []
  const b = keyBlock(lines, MAP_RELS_KEY)
  const rels: MapRel[] = []
  const junk: string[] = []
  if (!b) return { rels, junk }
  for (const l of lines.slice(b[0] + 1, b[0] + b[1])) {
    let body = /^[ \t]+-[ \t]+(.+?)[ \t]*$/.exec(l)?.[1]
    if (body && /^'.*'$/.test(body)) body = body.slice(1, -1).replace(/''/g, "'")
    const r = body ? REL.exec(body) : null
    if (!r) junk.push(l)
    else rels.push({ a: r[1]!, b: r[2]!, ...(r[3] !== undefined ? { label: r[3] } : {}), ...(r[4] !== undefined && Number(r[4]) ? { bend: Number(r[4]) } : {}) })
  }
  return { rels, junk }
}

export const mapRelsOf = (text: string): MapRel[] => relBlock(text).rels

const relSig = (list: MapRel[]) => JSON.stringify(list.map((r) => [r.a, r.b, r.label ?? null, Math.round(r.bend ?? 0)]))

/** 联系线写回属性：没变不动；一条都不剩就去掉这个属性 */
export function withMapRels(text: string, rels: MapRel[]): string {
  const old = relBlock(text)
  if (relSig(old.rels) === relSig(rels)) return text
  const line = (r: MapRel) => {
    const label = r.label !== undefined ? ` "${r.label.replace(/"/g, '”').replace(/\s*\n\s*/g, ' ')}"` : ''
    const body = `${r.a} -> ${r.b}${label}${Math.round(r.bend ?? 0) ? ` bend=${Math.round(r.bend!)}` : ''}`
    // YAML 里「: 」「 #」会把这一行读坏：整条用单引号包起来
    return `  - ${/: |[ \t]#/.test(body) ? `'${body.replace(/'/g, "''")}'` : body}`
  }
  const all = [...rels.map(line), ...old.junk]
  return putMapProp(text, MAP_RELS_KEY, all.length ? [`${MAP_RELS_KEY}:`, ...all].join('\n') : undefined)
}

const FM = /^---\n[\s\S]*?\n---(?:\n|$)/
const ITEM = /^([ \t]*)[-*+][ \t]+(.*)$/
/** 行尾的注释：最后那一个（前面自己写的注释照旧是字） */
const NOTE = /[ \t]*<!--[ \t]*((?:(?!<!--).)*?)[ \t]*-->[ \t]*$/
const ATTR = /([A-Za-z][\w-]*)(?:=(?:"([^"]*)"|(\S+)))?/g
/** 主题字里挂的图（第一张） */
const IMG = /!\[([^\]\n]*)\]\(([^)\s]+)\)/

const width = (ws: string) => [...ws].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0)

const nums = (v: string, k: number): number[] | null => {
  const n = v.split(',').map(Number)
  return n.length === k && n.every(Number.isFinite) ? n : null
}

/** 行尾注释里认得的东西；有别的就不当我们的注释（整段算主题的字） */
function parseNote(s: string): MapAttrs | null {
  const out: MapAttrs = {}
  let left = s
  for (const m of s.matchAll(ATTR)) {
    const [all, key, q, bare] = m
    const v = q ?? bare
    if (key === 'unsure' || key === 'fold' || key === 'wrong' || key === 'fix' || key === 'blank') {
      if (v !== undefined) return null
      out[key] = true
    } else if (v === undefined) return null
    else if (key === 'box') {
      const n = nums(v, 4)
      if (!n) return null
      out.box = n as Box
    } else if (key === 'guesses') out.guesses = v.split('|').filter(Boolean)
    else if (key === 'id') {
      if (!/^[\w-]+$/.test(v)) return null
      out.id = v
    } else if (key === 'frame' || key === 'sum') {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1) return null
      if (key === 'frame') out.frame = { ...out.frame, n }
      else out.sum = { ...out.sum, n }
    } else if (key === 'frame-title') out.frame = { n: out.frame?.n ?? 0, title: v }
    else if (key === 'sum-text') out.sum = { n: out.sum?.n ?? 0, text: v }
    else if (key === 'img-w') {
      const n = Number(v)
      if (!(n > 0)) return null
      out.imgW = n
    } else if (key === 'at') {
      const n = nums(v, 2)
      if (!n) return null
      out.at = n as [number, number]
    } else return null
    left = left.replace(all!, '')
  }
  return left.trim() === '' ? out : null
}

/** 注释里每一样的值（比较有没有变用） */
function attrValue(a: MapAttrs, key: string, fold: boolean): unknown {
  switch (key) {
    case 'box':
      return a.box
    case 'unsure':
      return a.unsure || undefined
    case 'guesses':
      return a.guesses?.length ? a.guesses : undefined
    case 'fold':
      return fold || undefined
    case 'id':
      return a.id
    case 'frame':
      return a.frame?.n || undefined
    case 'frame-title':
      return a.frame?.title
    case 'sum':
      return a.sum?.n || undefined
    case 'sum-text':
      return a.sum?.text
    case 'img-w':
      return a.imgW
    case 'at':
      return a.at
    case 'wrong':
    case 'fix':
    case 'blank':
      return a[key] || undefined
  }
  return undefined
}
const ATTR_KEYS = ['box', 'unsure', 'guesses', 'fold', 'id', 'frame', 'frame-title', 'sum', 'sum-text', 'img-w', 'at', 'wrong', 'fix', 'blank']
const sameValue = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)

const quoted = (s: string) => `"${s.replace(/"/g, '”').replace(/-->/g, '->').replace(/\s*\n\s*/g, ' ')}"`

/** 注释里一样样怎么写（顺序固定） */
function tokensOf(a: MapAttrs, fold: boolean): [string, string][] {
  const t: [string, string][] = []
  if (a.box) t.push(['box', `box=${a.box.map((x) => +x.toFixed(3)).join(',')}`])
  if (a.unsure) t.push(['unsure', 'unsure'])
  if (a.guesses?.length) t.push(['guesses', `guesses="${a.guesses.map((g) => g.replace(/["|]/g, ' ')).join('|')}"`])
  if (fold) t.push(['fold', 'fold'])
  if (a.id) t.push(['id', `id=${a.id}`])
  if (a.frame?.n) t.push(['frame', `frame=${a.frame.n}`])
  if (a.frame?.title !== undefined) t.push(['frame-title', `frame-title=${quoted(a.frame.title)}`])
  if (a.sum?.n) t.push(['sum', `sum=${a.sum.n}`])
  if (a.sum?.text !== undefined) t.push(['sum-text', `sum-text=${quoted(a.sum.text)}`])
  if (a.imgW !== undefined) t.push(['img-w', `img-w=${Math.round(a.imgW)}`])
  if (a.at) t.push(['at', `at=${Math.round(a.at[0])},${Math.round(a.at[1])}`])
  if (a.wrong) t.push(['wrong', 'wrong'])
  if (a.fix) t.push(['fix', 'fix'])
  if (a.blank) t.push(['blank', 'blank'])
  return t
}

/** 整行重写时的行尾注释（没孩子的收着没意思，不写 fold） */
function noteOf(n: MapNode): string {
  const parts = tokensOf(n, !!n.fold && n.children.length > 0).map((x) => x[1])
  return parts.length ? ` <!-- ${parts.join(' ')} -->` : ''
}

/**
 * 主题那一行的注释改成跟节点一样：没变的那几样原样留着（行里别的字节不动），变了的换掉、不要的去掉、新加的接在后面；
 * 一样都不剩就整段注释去掉（没注释的行加过 <!-- fold -->，展开时回到原样）
 */
function patchNote(line: string, n: MapNode): string {
  const m = NOTE.exec(line)
  const had = m ? parseNote(m[1]!) : null
  const cur = had ?? {}
  const curFold = !!cur.fold
  // 收着的主题后来没孩子了：原来写着的 fold 留着（打开再保存不变）
  const fold = !!n.fold && (n.children.length > 0 || curFold)
  if (ATTR_KEYS.every((k) => sameValue(attrValue(cur, k, curFold), attrValue(n, k, fold)))) return line
  const fresh = new Map(tokensOf(n, fold))
  if (!m || !had) return fresh.size ? `${line} <!-- ${[...fresh.values()].join(' ')} -->` : line
  const content = m[1]!
  const kept: string[] = []
  for (const t of content.matchAll(ATTR)) {
    const k = t[1]!
    const want = fresh.get(k)
    if (want === undefined) continue
    kept.push(sameValue(attrValue(cur, k, curFold), attrValue(n, k, fold)) ? t[0] : want)
    fresh.delete(k)
  }
  kept.push(...fresh.values())
  if (!kept.length) {
    // 我们加上去的那一段（前面一个空格）原样拿掉，主题那一行后面原来的空格还在
    const ours = ` <!-- ${content} -->`
    return line.endsWith(ours) ? line.slice(0, -ours.length) : line.slice(0, m.index)
  }
  if (!content) return `${line.slice(0, m.index)} <!-- ${kept.join(' ')} -->`
  const at = line.lastIndexOf(content, line.lastIndexOf('-->'))
  return line.slice(0, at) + kept.join(' ') + line.slice(at + content.length)
}

/** 主题的字和挂的图（不含层级、收起、注释里的别的） */
const sigOf = (n: MapNode) => JSON.stringify([n.text, n.img?.alt ?? null, n.img?.src ?? null])

/** 节点的字：去掉换行，免得一个节点写成好几行 */
export const cleanText = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()

/** 整行重写时主题的字：字在前，图跟在后面 */
function headText(n: MapNode): string {
  const t = cleanText(n.text)
  return n.img ? `${t}${t ? ' ' : ''}![${n.img.alt.replace(/[\]\n]/g, ' ')}](${n.img.src})` : t
}

function itemContent(rest: string): Pick<MapNode, 'text' | 'img'> & MapAttrs {
  const m = NOTE.exec(rest)
  const note = m ? parseNote(m[1]!) : null
  let text = (m && note ? rest.slice(0, m.index) : rest).trim()
  const im = IMG.exec(text)
  const img = im ? { alt: im[1]!, src: im[2]! } : undefined
  if (im) text = (text.slice(0, im.index) + text.slice(im.index + im[0].length)).replace(/[ \t]{2,}/g, ' ').trim()
  return { text, ...(img ? { img } : {}), ...(m && note ? note : {}) }
}

/** 备注里像列表项的一行（「- 」「* 」「+ 」开头）写进文件时前面加一个 \，读回来不会变成子主题 */
const LISTY = /^([ \t]*)([-*+])(?=[ \t])/
const ESCAPED = /^([ \t]*)\\([-*+])(?=[ \t])/

/** 续行读成备注：去掉共同的缩进，空行留着隔段 */
function noteOfLines(lines: string[]): string | undefined {
  const full = lines.filter((l) => l.trim() !== '')
  if (!full.length) return undefined
  const cut = Math.min(...full.map((l) => /^[ \t]*/.exec(l)![0].length))
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(cut).replace(ESCAPED, '$1$2'))).join('\n')
}

/** 备注写成主题下面缩进的一段 */
function noteBlock(note: string | undefined, indent: string): string {
  if (!note) return ''
  return note
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : indent + l.replace(LISTY, '$1\\$2')))
    .join('\n')
}

/** 续行换一层缩进：保持比主题那一行多出来的那一截（至少缩进两格，读回来还是续行） */
function reindentBody(body: string, base: string, indent: string): string {
  return body
    .split('\n')
    .map((l) => {
      if (l.trim() === '') return l
      const rest = l.startsWith(base) ? l.slice(base.length) : l.replace(/^[ \t]+/, '')
      return indent + (/^[ \t]/.test(rest) ? rest : '  ' + rest)
    })
    .join('\n')
}

/**
 * 一项写回去：主题的字和图没变就用原来那一行（注释里只改变了的那几样，层级变了只改缩进），变了整行重写；
 * 备注没变就用原来那几行续行（层级变了只改缩进），变了才重写那几行
 */
function lineOf(n: MapNode, depth: number, unit: string): string {
  const indent = unit.repeat(depth)
  const join = (head: string, body: string) => (body ? `${head}\n${body}` : head)
  const fresh = () => `${indent}- ${headText(n)}${noteOf(n)}`
  if (n.raw === undefined) return join(fresh(), noteBlock(n.note, unit.repeat(depth + 1)))
  const nl = n.raw.indexOf('\n')
  const head0 = nl === -1 ? n.raw : n.raw.slice(0, nl)
  const body0 = nl === -1 ? '' : n.raw.slice(nl + 1)
  const base = /^[ \t]*/.exec(head0)![0]
  const moved = n.rawDepth !== undefined && n.rawDepth !== depth
  let head = fresh()
  if (n.sig === sigOf(n)) {
    head = patchNote(head0, n)
    if (moved) head = indent + head.slice(base.length)
  }
  const body = (n.note ?? '') !== (n.rawNote ?? '') ? noteBlock(n.note, unit.repeat(depth + 1)) : moved ? reindentBody(body0, base, indent) : body0
  return join(head, body)
}

/** 白板的排版块（卡片、列）从哪开始：导图只在它前面找 */
const BLOCK = /^<!--\s*(card|column)\b[^\n]*-->[ \t]*$/m

/**
 * 找正文里（白板卡片之前）第一段从行首开始的列表，读成一棵（或几棵）树。主题下面缩进的续行是这个主题的备注（第二批 ①）。
 * 没有列表时 roots 是空的：before 是列表该插进去的位置之前，after 是之后。
 */
export function parseMindmap(text: string): MapDoc {
  const fm = FM.exec(text)?.[0] ?? ''
  const blockAt = BLOCK.exec(text.slice(fm.length))
  const headEnd = fm.length + (blockAt ? blockAt.index : text.length - fm.length)
  const lines = text.slice(fm.length, headEnd).split('\n')
  const starts: number[] = []
  let pos = fm.length
  for (const l of lines) {
    starts.push(pos)
    pos += l.length + 1
  }
  const first = lines.findIndex((l) => /^[-*+][ \t]+\S/.test(l))
  if (first === -1) {
    // 插在卡片前面（没有卡片就是结尾）
    return { before: text.slice(0, headEnd), roots: [], after: text.slice(headEnd), unit: '  ', found: false }
  }

  // 列表到哪为止：列表项、缩进的续行；中间的空行只有后面还是列表时才算
  let last = first
  for (let i = first; i < lines.length; i++) {
    const l = lines[i]!
    if (ITEM.test(l) || /^[ \t]+\S/.test(l)) last = i
    else if (l.trim() !== '') break
  }

  type Open = { node: MapNode; indent: number }
  const roots: MapNode[] = []
  const stack: Open[] = []
  let unit = ''
  let cur: { node: MapNode; depth: number; rawLines: string[]; blanks: string[] } | null = null
  const flush = () => {
    if (!cur) return
    const n = cur.node
    n.raw = cur.rawLines.join('\n')
    n.tail = cur.blanks.map((b) => b + '\n').join('')
    const note = noteOfLines(cur.rawLines.slice(1))
    if (note !== undefined) n.note = note
    n.rawNote = note
    n.sig = sigOf(n)
    n.rawDepth = cur.depth
    cur = null
  }
  for (let i = first; i <= last; i++) {
    const l = lines[i]!
    const m = ITEM.exec(l)
    if (!m) {
      if (!cur) continue
      if (l.trim() === '') cur.blanks.push(l)
      else {
        // 续行：这个主题的备注（以前并进主题的字，导图上一个主题变成一长串）
        cur.rawLines.push(...cur.blanks, l)
        cur.blanks = []
      }
      continue
    }
    flush()
    const indent = width(m[1]!)
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    if (indent > 0 && !unit) unit = m[1]!
    const node: MapNode = { ...itemContent(m[2]!), children: [] }
    if (stack.length) stack[stack.length - 1]!.node.children.push(node)
    else roots.push(node)
    cur = { node, depth: stack.length, rawLines: [l], blanks: [] }
    stack.push({ node, indent })
  }
  flush()
  const listEnd = starts[last]! + lines[last]!.length
  return { before: text.slice(0, starts[first]!), roots, after: text.slice(listEnd), unit: unit || '  ', found: true }
}

export function serializeMindmap(doc: MapDoc): string {
  const parts: string[] = []
  const walk = (list: MapNode[], depth: number) => {
    for (const n of list) {
      parts.push(lineOf(n, depth, doc.unit))
      if (n.tail) parts.push(n.tail.slice(0, -1))
      walk(n.children, depth + 1)
    }
  }
  walk(doc.roots, 0)
  // 删到最后一项后面不能再留空行（空行原来是夹在两项中间的）
  while (parts.length && parts[parts.length - 1]!.trim() === '') parts.pop()
  if (!parts.length) return doc.before + doc.after.replace(/^\n/, '')
  const list = parts.join('\n')
  if (doc.found) return doc.before + list + doc.after
  // 原来没有列表、插进去的：和前后隔一个空行
  const before = doc.before === '' || doc.before.endsWith('\n\n') || /^---\n[\s\S]*?\n---\n$/.test(doc.before) ? doc.before : doc.before.replace(/\n?$/, '\n\n')
  const after = doc.after.startsWith('\n') ? doc.after : doc.after === '' ? '\n' : '\n\n' + doc.after
  return before + list + after
}

/** 换掉正文里的导图列表，别的原样；删掉的主题身上的联系线一起删（属性里那一行跟着去掉） */
export function withMindmap(text: string, roots: MapNode[]): string {
  const doc = parseMindmap(text)
  const out = serializeMindmap({ ...doc, roots })
  const rels = mapRelsOf(text)
  if (!rels.length) return out
  const before = idsOf(doc.roots)
  const after = idsOf(roots)
  const gone = (id: string) => before.has(id) && !after.has(id)
  const keep = rels.filter((r) => !gone(r.a) && !gone(r.b))
  return keep.length === rels.length ? out : withMapRels(out, keep)
}

function idsOf(roots: MapNode[]): Set<string> {
  const out = new Set<string>()
  const walk = (list: MapNode[]) =>
    list.forEach((n) => {
      if (n.id) out.add(n.id)
      walk(n.children)
    })
  walk(roots)
  return out
}

// ---------- 改树：路径是一串下标，[0] 是第一棵树的根，[0, 2] 是它的第三个孩子 ----------

export type MapPath = number[]

export const pathKey = (p: MapPath) => p.join('.')
export const keyPath = (k: string): MapPath => (k === '' ? [] : k.split('.').map(Number))

export function nodeAt(roots: MapNode[], path: MapPath): MapNode | undefined {
  let list = roots
  let n: MapNode | undefined
  for (const i of path) {
    n = list[i]
    if (!n) return undefined
    list = n.children
  }
  return n
}

/** 改一个节点（不可变：路径上的节点复制一份，别的照旧共用） */
export function updateAt(roots: MapNode[], path: MapPath, f: (n: MapNode) => MapNode): MapNode[] {
  if (!path.length) return roots
  const [i, ...rest] = path
  return roots.map((n, j) => (j !== i ? n : rest.length ? { ...n, children: updateAt(n.children, rest, f) } : f(n)))
}

/** 在 parent 的孩子里第 index 个位置插一个（parent 是 [] 时插在最外层） */
export function insertAt(roots: MapNode[], parent: MapPath, index: number, node: MapNode): MapNode[] {
  const put = (list: MapNode[]): MapNode[] => {
    // 插在一组的最后：上一项后面原来隔着的空行（隔开下一组的）挪到新的这项后面
    const prev = index === list.length && index > 0 ? lastOf(list[index - 1]!) : null
    if (!prev?.node.tail) return [...list.slice(0, index), node, ...list.slice(index)]
    const tail = prev.node.tail
    const cleared = replaceLast(list[index - 1]!, prev.path, (n) => ({ ...n, tail: '' }))
    return [...list.slice(0, index - 1), cleared, { ...node, tail }]
  }
  if (!parent.length) return put(roots)
  return updateAt(roots, parent, (p) => ({ ...p, children: put(p.children) }))
}

/** 一枝最后（最深的最后一个）那个节点和它在这枝里的路径 */
function lastOf(n: MapNode, path: MapPath = []): { node: MapNode; path: MapPath } {
  return n.children.length ? lastOf(n.children[n.children.length - 1]!, [...path, n.children.length - 1]) : { node: n, path }
}

function replaceLast(n: MapNode, path: MapPath, f: (n: MapNode) => MapNode): MapNode {
  return path.length ? { ...n, children: updateAt(n.children, path, f) } : f(n)
}

export function removeAt(roots: MapNode[], path: MapPath): MapNode[] {
  const parent = path.slice(0, -1)
  const i = path[path.length - 1]!
  if (!parent.length) return roots.filter((_, j) => j !== i)
  return updateAt(roots, parent, (p) => ({ ...p, children: p.children.filter((_, j) => j !== i) }))
}

export const newNode = (text: string): MapNode => ({ text, children: [] })

/** 改字：改过的字就不再是「拿不准」 */
export function setText(roots: MapNode[], path: MapPath, text: string): MapNode[] {
  return updateAt(roots, path, (n) => ({ ...n, text: cleanText(text), unsure: undefined, guesses: undefined }))
}

/** 把 from 挪到 toParent 的孩子里（index 不给就放最后）；不能挪进自己下面 */
export function moveTo(roots: MapNode[], from: MapPath, toParent: MapPath, index?: number): { roots: MapNode[]; path: MapPath } | null {
  if (toParent.length >= from.length && from.every((x, i) => toParent[i] === x)) return null
  const node = nodeAt(roots, from)
  if (!node) return null
  // 先删再插：删掉后，toParent 里排在被删节点后面的下标要减一
  const fixed = [...toParent]
  const depth = from.length - 1
  if (fixed.length > depth && fixed.slice(0, depth).every((x, i) => x === from[i]) && fixed[depth]! > from[depth]!) fixed[depth]!--
  const removed = removeAt(roots, from)
  const siblings = fixed.length ? nodeAt(removed, fixed)?.children : removed
  if (!siblings) return null
  const at = Math.min(index ?? siblings.length, siblings.length)
  return { roots: insertAt(removed, fixed, at, node), path: [...fixed, at] }
}

// ---------- 第一批（task-wuv05，设计页 15-思维导图）：加父主题、同级里挪、只删一个、拖到两个同级中间、收起 ----------

/** 同一层里往上（-1）、往下（1）挪一个；到头了、最外层的中心不挪 */
export function moveAmong(roots: MapNode[], path: MapPath, delta: -1 | 1): { roots: MapNode[]; path: MapPath } | null {
  if (path.length < 2) return null
  const parent = path.slice(0, -1)
  const i = path[path.length - 1]!
  const n = nodeAt(roots, parent)?.children.length ?? 0
  if (i + delta < 0 || i + delta >= n) return null
  return moveTo(roots, path, parent, i + delta)
}

/** 拖到 target 前面（after 是后面）：同一层换位置，或者换到 target 的上级下面；不能拖到自己下面 */
export function moveBeside(roots: MapNode[], from: MapPath, target: MapPath, after: boolean): { roots: MapNode[]; path: MapPath } | null {
  if (target.length < 2 || (target.length >= from.length && from.every((x, i) => target[i] === x))) return null
  const parent = target.slice(0, -1)
  let index = target[target.length - 1]! + (after ? 1 : 0)
  // 同一列里从前面挪到后面：自己先拿走了，后面的都往前挪了一个
  if (from.length === target.length && from.slice(0, -1).every((x, i) => x === parent[i]) && from[from.length - 1]! < index) index--
  return moveTo(roots, from, parent, index)
}

/** 加父主题：在这一个外面套一个新的，它（连同下面的）往里一层；中心外面不套 */
export function addParent(roots: MapNode[], path: MapPath, text: string): { roots: MapNode[]; path: MapPath } | null {
  if (path.length < 2) return null
  const node = nodeAt(roots, path)
  if (!node) return null
  return { roots: updateAt(roots, path, () => ({ text: cleanText(text), children: [node] })), path }
}

/** 只删这一个：它下面的往上提一层，排在它原来的位置 */
export function removeOne(roots: MapNode[], path: MapPath): MapNode[] {
  const node = nodeAt(roots, path)
  if (!node) return roots
  const parent = path.slice(0, -1)
  const i = path[path.length - 1]!
  const put = (list: MapNode[]) => [...list.slice(0, i), ...node.children, ...list.slice(i + 1)]
  if (!parent.length) return put(roots)
  return updateAt(roots, parent, (p) => ({ ...p, children: put(p.children) }))
}

/** 收起、展开一个（没有孩子的不收） */
export function setFold(roots: MapNode[], path: MapPath, fold: boolean): MapNode[] {
  return updateAt(roots, path, (n) => (fold && !n.children.length ? n : { ...n, fold }))
}

const mapFold = (list: MapNode[], f: (n: MapNode, depth: number) => boolean, depth = 0): MapNode[] =>
  list.map((n) => ({ ...n, fold: f(n, depth), children: mapFold(n.children, f, depth + 1) }))

/** 收起到第一层：第一层往下有孩子的都收起（中心不收） */
export const foldAll = (roots: MapNode[]): MapNode[] => mapFold(roots, (n, d) => (d >= 1 && n.children.length > 0 ? true : !!n.fold))

/** 全部展开 */
export const unfoldAll = (roots: MapNode[]): MapNode[] => mapFold(roots, () => false)

/** 还有没收起来的（第一层往下、有孩子的）：⇧⌘/ 按一下收起，都收着时再按是全部展开 */
export function anyUnfolded(roots: MapNode[]): boolean {
  const walk = (list: MapNode[], depth: number): boolean => list.some((n) => (depth >= 1 && n.children.length > 0 && !n.fold) || walk(n.children, depth + 1))
  return walk(roots, 0)
}

/** 一枝里一共几个（不算它自己）：收起来时旁边写的数 */
export const hiddenCount = (n: MapNode): number => n.children.reduce((s, k) => s + 1 + hiddenCount(k), 0)

/** 一层一层（中心 → 第一层 → 第二层）的顺序，长出来的动画按它 */
export function breadthFirst(roots: MapNode[]): MapPath[] {
  const out: MapPath[] = []
  let level: MapPath[] = roots.map((_, i) => [i])
  while (level.length) {
    out.push(...level)
    level = level.flatMap((p) => nodeAt(roots, p)!.children.map((_, i) => [...p, i]))
  }
  return out
}

export function countNodes(roots: MapNode[]): { all: number; unsure: number } {
  let all = 0
  let unsure = 0
  const walk = (l: MapNode[]) =>
    l.forEach((n) => {
      all++
      if (n.unsure) unsure++
      walk(n.children)
    })
  walk(roots)
  return { all, unsure }
}

/** 新建一份导图时的列表原文 */
export function mindmapList(roots: MapNode[], unit = '  '): string {
  return serializeMindmap({ before: '', roots: strip(roots), after: '', unit, found: false })
}

function strip(list: MapNode[]): MapNode[] {
  return list.map(({ raw: _r, sig: _s, tail: _t, rawDepth: _d, rawNote: _n, ...n }) => ({ ...n, children: strip(n.children) }))
}

// ---------- 第二批（task-wuv05，设计页 15-思维导图第二批）：备注、外框、概要、浮动主题、联系线、图、链接、OPML ----------

/** 改备注：去掉前后空行，多段之间最多空一行；空的就是没有备注（那几行续行一起去掉） */
export function setNote(roots: MapNode[], path: MapPath, note: string): MapNode[] {
  const v = note
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  return updateAt(roots, path, (n) => ({ ...n, note: v || undefined }))
}

/** 改行尾注释里记的几样（外框、概要、图、位置、短编号……）：给 undefined 就去掉 */
export function setAttrs(roots: MapNode[], path: MapPath, patch: Partial<Pick<MapNode, keyof MapAttrs | 'img'>>): MapNode[] {
  return updateAt(roots, path, (n) => ({ ...n, ...patch }))
}

/** 每一个主题和它的路径（先根后子） */
export function eachNode(roots: readonly MapNode[], f: (n: MapNode, path: MapPath) => void, base: MapPath = []) {
  roots.forEach((n, i) => {
    const p = [...base, i]
    f(n, p)
    eachNode(n.children, f, p)
  })
}

/** 没用过的最小短编号 k1、k2…… */
export function nextMapId(roots: MapNode[]): string {
  const used = idsOf(roots)
  let i = 1
  while (used.has(`k${i}`)) i++
  return `k${i}`
}

/** 这几个主题都编上短编号（已经有的不动）：联系线两头用 */
export function withIds(roots: MapNode[], paths: MapPath[]): { roots: MapNode[]; ids: string[] } {
  let out = roots
  const ids = paths.map((p) => {
    const n = nodeAt(out, p)
    if (!n) return ''
    if (n.id) return n.id
    const id = nextMapId(out)
    out = setAttrs(out, p, { id })
    return id
  })
  return { roots: out, ids }
}

/** 短编号 → 路径 */
export function pathOfId(roots: MapNode[], id: string): MapPath | null {
  let hit: MapPath | null = null
  eachNode(roots, (n, p) => {
    if (!hit && n.id === id) hit = p
  })
  return hit
}

/** 选中的几个按上级分段：同一个上级下面从最前到最后连成一段（各棵树的根不算） */
export function spansOf(paths: MapPath[]): { parent: MapPath; from: number; n: number }[] {
  const groups = new Map<string, number[]>()
  for (const p of paths) {
    if (p.length < 2) continue
    const k = pathKey(p.slice(0, -1))
    groups.set(k, [...(groups.get(k) ?? []), p[p.length - 1]!])
  }
  return [...groups].map(([k, is]) => ({ parent: keyPath(k), from: Math.min(...is), n: Math.max(...is) - Math.min(...is) + 1 }))
}

/** 外框、概要：同一级的几个共用一个，记在最前面那个上（从它起 n 个）；不同枝各一个；中心不框 */
export function addSpan(roots: MapNode[], paths: MapPath[], kind: 'frame' | 'sum', label?: string): MapNode[] {
  let out = roots
  for (const s of spansOf(paths)) {
    const at = [...s.parent, s.from]
    out = setAttrs(out, at, kind === 'frame' ? { frame: { n: s.n, ...(label ? { title: label } : {}) } } : { sum: { n: s.n, ...(label ? { text: label } : {}) } })
  }
  return out
}

/** 浮动主题：最外层、大树后面记着位置的那几项 */
export const isFloating = (roots: readonly MapNode[], path: MapPath) => path.length === 1 && path[0]! > 0 && !!roots[path[0]!]?.at

/** 双击空白处加一个浮动主题：写在大树后面、最外层，记着相对中心的位置 */
export function addFloating(roots: MapNode[], text: string, at: [number, number]): { roots: MapNode[]; path: MapPath } {
  return { roots: insertAt(roots, [], roots.length, { text: cleanText(text), at: [Math.round(at[0]), Math.round(at[1])], children: [] }), path: [roots.length] }
}

/** 拆成浮动主题：连同下面的从树上拿下来，放到最外层 at 那里 */
export function detachTopic(roots: MapNode[], path: MapPath, at: [number, number]): { roots: MapNode[]; path: MapPath } | null {
  if (path.length < 2) return null
  const node = nodeAt(roots, path)
  if (!node) return null
  const left = removeAt(roots, path)
  return { roots: insertAt(left, [], left.length, { ...node, at: [Math.round(at[0]), Math.round(at[1])] }), path: [left.length] }
}

/** 挪进树里了（浮动主题挂到一个主题下面、排到两个主题中间）：不再记位置 */
export function settle(r: { roots: MapNode[]; path: MapPath } | null): { roots: MapNode[]; path: MapPath } | null {
  if (!r || r.path.length < 2 || !nodeAt(r.roots, r.path)?.at) return r
  return { roots: setAttrs(r.roots, r.path, { at: undefined }), path: r.path }
}

/** 主题字里的链接：[[双链]] 只露名字（同文档、白板卡的认法），[字](网址) 只露字；前面带 ! 的是图，不算 */
const LINKS = /\[\[([^\]\n]+)\]\]|(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/g

export interface MapSeg {
  text: string
  /** [[双链]] 指向的笔记 */
  wiki?: string
  /** [字](网址) 的网址 */
  url?: string
  /** 在主题的字里从哪到哪（整段链接的原文） */
  from: number
  to: number
}

/** 主题的字拆成几段：普通的字、双链、网址链接 */
export function mapSegments(text: string): MapSeg[] {
  const out: MapSeg[] = []
  let i = 0
  for (const m of text.matchAll(LINKS)) {
    const at = m.index!
    if (at > i) out.push({ text: text.slice(i, at), from: i, to: at })
    const end = at + m[0].length
    if (m[1] !== undefined) {
      const s = wikiShown(m[1])
      out.push({ text: m[1].slice(s.from, s.to), wiki: m[1].split('|')[0]!.split('#')[0]!.split('^')[0]!.trim(), from: at, to: end })
    } else out.push({ text: m[2]!, url: m[3]!, from: at, to: end })
    i = end
  }
  if (i < text.length || !out.length) out.push({ text: text.slice(i), from: i, to: text.length })
  return out
}

/** 主题画出来的字（链接只露名字） */
export const mapShown = (text: string): string =>
  mapSegments(text)
    .map((s) => s.text)
    .join('')

/** 导出 OPML 大纲（第二批 ⑫）：每个主题一行，链接只留字，备注写进 _note */
export function mindmapOpml(title: string, roots: readonly MapNode[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;')
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', `  <head><title>${esc(title)}</title></head>`, '  <body>']
  const walk = (list: readonly MapNode[], depth: number) =>
    list.forEach((n) => {
      const pad = '  '.repeat(depth + 2)
      const attrs = `text="${esc(mapShown(n.text))}"${n.note ? ` _note="${esc(n.note)}"` : ''}`
      if (!n.children.length) return void out.push(`${pad}<outline ${attrs}/>`)
      out.push(`${pad}<outline ${attrs}>`)
      walk(n.children, depth + 1)
      out.push(`${pad}</outline>`)
    })
  walk(roots, 0)
  out.push('  </body>', '</opml>', '')
  return out.join('\n')
}

/** 路径前后（先根后子的顺序） */
const before = (a: MapPath, b: MapPath) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}
const inside = (p: MapPath, anc: MapPath) => p.length > anc.length && anc.every((x, i) => p[i] === x)

/**
 * 选了几个一起拖（第二批 ⑤）：几个一起挪到 target 里面（排在最后）、前面或后面，按原来的先后排在一起；
 * 选中的里面套着的（一个在另一个下面）跟着上面那个走；拖到自己下面不行。浮动主题挪进树里不再记位置。
 */
export function moveMany(roots: MapNode[], from: MapPath[], target: MapPath, how: 'into' | 'before' | 'after'): { roots: MapNode[]; paths: MapPath[] } | null {
  const top = from.filter((p) => !from.some((q) => inside(p, q))).sort(before)
  if (!top.length || top.some((p) => pathKey(p) === pathKey(target) || inside(target, p))) return null
  if (how !== 'into' && target.length < 2) return null
  const nodes = top.map((p) => nodeAt(roots, p)!)
  if (nodes.some((n) => !n)) return null
  // 从后往前拿走，前面的路径不变
  let out = roots
  for (const p of [...top].reverse()) out = removeAt(out, p)
  // 拿走的排在 target 某一层前面的：那一层的下标往前挪
  const t = target.map((x, level) => x - top.filter((q) => q.length === level + 1 && q.slice(0, level).every((y, i) => y === target[i]) && q[level]! < x).length)
  const parent = how === 'into' ? t : t.slice(0, -1)
  let at = how === 'into' ? (nodeAt(out, parent)?.children.length ?? 0) : t[t.length - 1]! + (how === 'after' ? 1 : 0)
  const paths: MapPath[] = []
  for (const n of nodes) {
    out = insertAt(out, parent, at, parent.length ? { ...n, at: undefined } : n)
    paths.push([...parent, at])
    at++
  }
  return { roots: out, paths }
}
