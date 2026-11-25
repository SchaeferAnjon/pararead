/**
 * 白板笔迹层（方案 B「白板笔迹层」，2026-11-25 用户定：「OK 可以就先这么做」「可以就按照这个方向」）：iPad 上用 Pencil
 * 写在白板上的笔画不变成图片，一笔一行字存在白板旁边；Mac 照这份字画出来、能选中挪动改色删除（第一版不能写）。
 * 这一份是规格也是读写的代码；iPhone / iPad 那份 apps/apple/CanvasCore/Sources/CanvasCore/Ink/Ink.swift 一比一移植，
 * 改这里要两边一起改（apps/apple/test/ink-fixtures.test.ts 导出的对照样例会红）。不依赖 Electron。
 *
 * 一、在哪：`附件/<白板路径去掉 .md>/笔迹.ink`（inkPathOf），就是这篇白板自己的附件文件夹（attachments.ts）。
 *    为什么放这里：白板改名、挪文件夹时附件文件夹本来就跟着挪（不用再记一条链接、不用改 md）；写字只改这一个文件，
 *    白板那篇 md 一个字节不动（打开再保存不变、外部改动合并都不受影响）；「没人用的附件」认得它归这篇。
 *    一块白板一个文件，没写过字就没有这个文件。
 *
 * 二、写法：UTF-8（不带 BOM）、`\n` 换行、文末一个 `\n`；每一行一个 JSON 对象，键都是双引号，值是字符串或数。
 *    行的先后就是叠放的先后（后面的盖在前面的上面）。认不出的行（不是 JSON、缺键、键的类型不对）原样留着、不画。
 *    1. 头一行 `{"ink":1}`：版本。
 *    2. 组行 `{"g":"k2m9q4ta","x":1240,"y":380}`：一组是一次写下、挨在一起的几笔（iPad：1.5 秒内、离上一笔 120 以内）。
 *       x、y 是组的原点，白板坐标（白板 100% 时的点，和 md 位置行 `<!-- card … x= y= -->` 同一套），最多两位小数。
 *       挂在卡上的组多一个 `"on":"<卡的编号>"`：x、y 换成相对那张卡左上角，卡挪到哪（拖动、列里上面插了一段、列宽 400、
 *       推开 pushApart）笔迹跟到哪。卡的编号就是 md 里那张卡的位置行或编号行上的 id；挂了笔迹的卡那一行带 `ink=1`
 *       （inkCardId 加），这样「摆回原样」、拖回列里这些只留连线两头编号的地方也留着它。那张卡找不到（删了）时这一组不画、
 *       文件里照留（撤回删卡就回来）。组行一般紧挨在它的第一笔前面，读的时候不靠这个。
 *    3. 笔画行 `{"id":"r8f2k1zq","g":"k2m9q4ta","pen":"pen","c":"#1d2421","seed":3270201521,"p":"…"}`：
 *       - id：这一笔的编号，g：属于哪一组。编号（笔画和组各一套）是 8 个 [0-9a-z] 的随机字（inkId），两台设备各写各的不会撞；
 *       - pen：笔种 pen（钢笔）、marker（荧光笔）、pencil（铅笔）、monoline、fountain（书法钢笔）、watercolor、crayon，
 *         PencilKit 以后的新笔写它自己的名字（com.apple.ink.xxx），Mac 认不出的按钢笔画；
 *       - c：颜色 `#rrggbb` 或 `#rrggbbaa`，记浅色下的颜色（深色主题下照 PencilKit 的规矩反过来画，darkInk）；
 *       - seed：PencilKit 的随机种子（铅笔纹理），可以没有；
 *       - t：最后一次改这一行的时间（毫秒），新写的笔可以没有；两台设备改了同一笔时取 t 大的（见四）；组行也一样；
 *       - from：擦断出来的一段才有（见三），它是从哪一笔擦出来的：那一笔的编号，再跟那一笔自己的 from，空格隔开，
 *         最近的在前，最多 16 个（inkLineage）。合并时靠它认出「这几段就是那一笔」（见四）；
 *       - p：点列，一点一组用「,」隔开的整数，点和点用「;」隔开。第一点是相对组原点的值，后面每点记和前一点的差：
 *         x,y,w,f,t —— 坐标和宽 ×100（0.01 点）、力 ×1000、时间（这一笔开始后的毫秒）；
 *         可以再跟两个 az,al（方位角、高度角 ×100，弧度）；再跟两个 h,o（点的高 ×100、不透明度 ×1000）。
 *         一笔里每点个数一样（5、7 或 9）；没写的 az 是 0、al 是 π/2（手指）、h 和 w 一样、o 是 1。
 *         取整一律 floor(v × 倍数 + 0.5)（TS 和 Swift 一样）。精度是实测定的：0.01 时铅笔纹理和 PencilKit 只差 0.24% 的像素，钢笔一点不差。
 *       读 PDF 上写的（iPad 读 PDF 手写，设计页 159，2026-11-25 用户定）组行多一个 `"pg":<页号>`（从 1 数），x、y 换成这一页里的位置：
 *       PDF 点，页面 cropBox 的左上角起、按页面没旋转时算（PDF 自己带 /Rotate 时画的时候字和笔一起转）。文件在
 *       `附件/<PDF 名>/笔迹.ink`（pdfInkPathOf，和读 PDF 截图同一个文件夹），PDF 原文件一个字节不动。笔画行和白板一样。
 *       iPad 第一次打开时把旧的 `附件/手写/<PDF 名>/第 N 页.drawing` 迁进来，记一行
 *       `{"moved":"附件/手写/<PDF 名>/第 N 页.drawing","sha":"<内容指纹前 12 位>","pg":N}`（认不出的行，原样留着、合并按整行认）。
 *    键的顺序：程序写的时候照上面（组行 g、on、pg、x、y、t；笔画行 id、g、pen、c、seed、t、from、p），认不出的键原样跟在后面。
 *    只改了的那几行重写，别的行一个字节不动（打开再保存不变，和 md 同一条规矩）。
 *
 * 三、改的时候改哪几行：加一笔加一行（新的一组再加一行组行）；挪一整组只改组那一行（点相对组原点）；
 *    只挪一组里的几笔：这几笔换进一个新的组（原点挪过去），改这几笔的行加一行组行，点不动；改色改那几笔的行；
 *    删掉那几笔的行，组里没笔了组行也删。
 *    擦断（iPad 橡皮涂抹擦掉一笔中间一截，splitInk）：这一笔的行删掉，剩下的每一段是一笔新的，换在它原来那一行的位置：
 *    新编号、同一组、同样的笔种颜色种子（认不出的键也照抄），点是剩下那一截的点（相对同一个组原点），带 t 和 from。
 *    整笔擦光了就是删。一笔擦成两段就是删一行、加两行，别的行不动。
 *
 * 四、两台设备都改了（Git 同步，mergeInk，接在 para-merge.ts 的 mergeVaultText 里，不出「（iPad 上的一版）」副本）：
 *    按行的编号三方合并（组行按组的编号、笔画行按笔的编号、头一行算一个、认不出的行按整行字）：
 *    - 只有一边动了这一行：用动了的那边（加、改、删都是）；两边改得一样：就是它；
 *    - 一边删了、一边改了：留改过的（不丢）；
 *    - 两边都改了、改得不一样：取 t 大的那一行（后改的）；t 一样（或都没有）取 keep 那边；头一行取版本大的；
 *    - 留下的笔画它那一组被另一边删了：组行也留下（组行用还在的那一边的）；
 *    - 先后：照 keep 那边的顺序，另一边新加的行插在它在另一边里紧挨着的前一行后面（找不到就放最前面，头一行后面）。
 *    - 擦断（from 认）：base 里的一笔 X，一边擦断了（X 没了、多了 from 里有 X 的几段），
 *      · 另一边没动 X、或也删了 X：照上面，留擦剩的几段；
 *      · 另一边改了 X（改色、只挪这一笔进了新组）：X 不回来（不然擦掉的那截又出现、还和剩下的叠着），留擦剩的几段，
 *        另一边改的颜色、组、笔种换到这几段上（这几段重写，t 取两边大的）；另一边改的粗细（点列）不带过去；
 *      · 两边都擦断了 X（擦的地方不一样）：只留一边擦剩的几段，留后擦的那边（几段里 t 最大的大，一样取 keep 那边），
 *        另一边那几段不要（先擦的那一截会回来，不会两边的几段叠在一起）。这两种都算一处 clashes。
 *    合出来的每一行都是某一边原来的那一行（只有上面换了颜色、组的那几段重写）。两边都只在文末各加了几笔：两边的都留下，keep 那边的在前。
 *    贴纸、胶带两种装饰行（ink-decor.ts）在这里是认不出的行，合并时按它们的编号认（decorKey）、两边都改了比它们的 t。
 */
import { INK_FILE } from './app-files'
import { attachmentDir } from './attachments'
import { type DocUnit, freshId, placeLine, tagLine, unitId } from './doc-board'
import { decorKey, decorTime } from './ink-decor'
import { attachDirFor } from './reading-note'

export const INK_VERSION = 1

/** 这块白板的笔迹文件：附件/<白板路径去掉 .md>/笔迹.ink */
export function inkPathOf(notePath: string): string {
  return `${attachmentDir(notePath)}/${INK_FILE}`
}

/** 这份 PDF 的笔迹文件：附件/<PDF 名>/笔迹.ink（attachDirFor，和读 PDF 截图同一个文件夹；组行带 pg） */
export function pdfInkPathOf(pdf: string): string {
  return `${attachDirFor(pdf)}/${INK_FILE}`
}

/** 笔画认的几种笔（文件里的名字 → PencilKit 的 PKInk.InkType.rawValue）；认不出的原样留着、Mac 按钢笔画 */
export const INK_PENS: Record<string, string> = {
  pen: 'com.apple.ink.pen',
  marker: 'com.apple.ink.marker',
  pencil: 'com.apple.ink.pencil',
  monoline: 'com.apple.ink.monoline',
  fountain: 'com.apple.ink.fountainpen',
  watercolor: 'com.apple.ink.watercolor',
  crayon: 'com.apple.ink.crayon',
}

/**
 * 笔盘的颜色（浅色下的值，文件里也记这个；深色主题照 darkInk 画）：墨水 5 色、荧光笔 3 色（设计页 134「每套主题配 5 色墨水 + 3 色荧光笔」，
 * 颜色取自 design/ipad-ink/README.md）。十套主题共用这一份：文件里记的是颜色本身，换主题、换设备不变；深色五套由 darkInk 校准
 */
export const INK_COLORS = ['#1d2421', '#1e4aa4', '#9f2323', '#12805a', '#e08a00'] as const

/**
 * 改过色值的墨水（2026-11-25 用户看了 143「可以」：深色主题下红、蓝在深色卡上太暗，照设计复审改成红 #9f2323、蓝 #1e4aa4，
 * 接受浅色下红偏砖红）：文件里记着旧值的笔（#d64545、#2459c6）文件一个字节不动，画的时候照新值画（inkColor）；改色时写新值
 */
export const INK_RENAMED: Readonly<Record<string, string>> = { '#d64545': '#9f2323', '#2459c6': '#1e4aa4' }

/** 画这一笔用的颜色（浅色下）：旧色值换成新的，带透明度的保留透明度；别的原样 */
export function inkColor(c: string): string {
  const n = INK_RENAMED[c.slice(0, 7).toLowerCase()]
  return n ? n + c.slice(7) : c
}
export const HIGHLIGHT_COLORS = ['#ffd84d', '#9be3b7', '#ffb3c7'] as const

export interface InkGroup {
  id: string
  /** 挂在哪张卡上（卡的编号）；null 是钉在白板上 */
  on: string | null
  /** 读 PDF 上写的：第几页（从 1 数）；白板上的没有这个键 */
  pg?: number
  /** 组的原点：白板坐标，挂卡的是相对卡左上角；读 PDF 的是这一页里的位置（cropBox 左上角起、没旋转、PDF 点） */
  x: number
  y: number
  /** 最后一次改这一行的时间（毫秒） */
  t: number | null
}

export interface InkStroke {
  id: string
  g: string
  pen: string
  c: string
  seed: number | null
  t: number | null
  /** 擦断出来的一段：从哪一笔擦出来的（编号，最近的在前，空格隔开）；不是擦出来的 null */
  from: string | null
  /** 点列原样（decodePoints 解开） */
  p: string
}

/** 认不出的键：键名和原样的 JSON 值 */
type Extra = [string, string][]

export type InkLine =
  | { kind: 'head'; raw: string | null; v: number; extra: Extra }
  | { kind: 'group'; raw: string | null; group: InkGroup; extra: Extra }
  | { kind: 'stroke'; raw: string | null; stroke: InkStroke; extra: Extra }
  | { kind: 'other'; raw: string }

/** 读进来的一份：每一行（raw 是原来的字，改过的行 raw 是 null、写的时候重写）和文末（'\n' 或 ''） */
export interface InkDoc {
  lines: InkLine[]
  end: string
}

// ---------------------------------------------------------------- 一行 JSON：自己扫，记下每个值原样的字（认不出的键原样写回）

const WS = new Set([' ', '\t', '\n', '\r'])

/** 扫一个 JSON 对象的最外层：[键, 值原样的字]；不是一个对象（或后面还有别的）返回 null */
function scanObject(s: string): [string, string][] | null {
  let i = 0
  const ws = () => {
    while (i < s.length && WS.has(s[i]!)) i++
  }
  /** 一个字符串的结尾（i 指着开头的引号），返回结尾引号后面的下标；不完整返回 -1 */
  const strEnd = (k: number): number => {
    for (let j = k + 1; j < s.length; j++) {
      const c = s[j]!
      if (c === '\\') j++
      else if (c === '"') return j + 1
      else if (c < ' ') return -1
    }
    return -1
  }
  /** 一个值的结尾 */
  const valueEnd = (k: number): number => {
    const c = s[k]
    if (c === '"') return strEnd(k)
    if (c === '{' || c === '[') {
      let depth = 0
      for (let j = k; j < s.length; j++) {
        const d = s[j]!
        if (d === '"') {
          const e = strEnd(j)
          if (e < 0) return -1
          j = e - 1
        } else if (d === '{' || d === '[') depth++
        else if (d === '}' || d === ']') {
          depth--
          if (depth === 0) return j + 1
        }
      }
      return -1
    }
    let j = k
    while (j < s.length && !WS.has(s[j]!) && s[j] !== ',' && s[j] !== '}') j++
    const word = s.slice(k, j)
    if (word === 'true' || word === 'false' || word === 'null' || NUM.test(word)) return j
    return -1
  }
  ws()
  if (s[i] !== '{') return null
  i++
  const out: [string, string][] = []
  ws()
  if (s[i] === '}') {
    i++
    ws()
    return i === s.length ? out : null
  }
  for (;;) {
    ws()
    if (s[i] !== '"') return null
    const ke = strEnd(i)
    if (ke < 0) return null
    const key = unquote(s.slice(i, ke))
    if (key === null) return null
    i = ke
    ws()
    if (s[i] !== ':') return null
    i++
    ws()
    const ve = valueEnd(i)
    if (ve < 0) return null
    out.push([key, s.slice(i, ve)])
    i = ve
    ws()
    if (s[i] === ',') {
      i++
      continue
    }
    if (s[i] === '}') {
      i++
      ws()
      return i === s.length ? out : null
    }
    return null
  }
}

const NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/** JSON 字符串（带两头的引号）解开；写法不对返回 null */
function unquote(q: string): string | null {
  let out = ''
  for (let j = 1; j < q.length - 1; j++) {
    const c = q[j]!
    if (c !== '\\') {
      out += c
      continue
    }
    const e = q[++j]
    if (e === '"' || e === '\\' || e === '/') out += e
    else if (e === 'b') out += '\b'
    else if (e === 'f') out += '\f'
    else if (e === 'n') out += '\n'
    else if (e === 'r') out += '\r'
    else if (e === 't') out += '\t'
    else if (e === 'u') {
      const h = q.slice(j + 1, j + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(h)) return null
      out += String.fromCharCode(parseInt(h, 16))
      j += 4
    } else return null
  }
  return out
}

/** 写字符串：只转义引号、反斜杠和控制字符，别的字原样 */
function quote(s: string): string {
  let out = '"'
  for (const c of s) {
    const n = c.charCodeAt(0)
    if (c === '"' || c === '\\') out += '\\' + c
    else if (n < 0x20) out += '\\u' + n.toString(16).padStart(4, '0')
    else out += c
  }
  return out + '"'
}

/** 取整到 0.01 的数照固定写法写：整数不带小数点，小数去掉末尾的 0（TS 和 Swift 一样，不靠各自的数转字） */
export function fmt2(v: number): string {
  const c = Math.floor(v * 100 + 0.5)
  const neg = c < 0
  const a = Math.abs(c)
  const int = Math.floor(a / 100)
  const frac = a % 100
  const body = frac === 0 ? `${int}` : frac % 10 === 0 ? `${int}.${frac / 10}` : `${int}.${frac < 10 ? '0' : ''}${frac}`
  return neg && a !== 0 ? '-' + body : body
}

/** 取整到 0.01 */
export const round2 = (v: number) => Math.floor(v * 100 + 0.5) / 100

const str = (raw: string | undefined): string | null => (raw !== undefined && raw.startsWith('"') ? unquote(raw) : null)
const numOf = (raw: string | undefined): number | null => (raw !== undefined && NUM.test(raw) ? Number(raw) : null)
const intOf = (raw: string | undefined): number | null => {
  const n = numOf(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

const GROUP_KEYS = new Set(['g', 'on', 'pg', 'x', 'y', 't'])
const STROKE_KEYS = new Set(['id', 'g', 'pen', 'c', 'seed', 't', 'from', 'p'])

/** 读一行 */
export function parseInkLine(raw: string): InkLine {
  const kv = scanObject(raw)
  if (!kv) return { kind: 'other', raw }
  const m = new Map<string, string>()
  for (const [k, v] of kv) if (!m.has(k)) m.set(k, v)
  const dup = m.size !== kv.length
  if (dup) return { kind: 'other', raw }
  const extraOf = (known: Set<string>): Extra => kv.filter(([k]) => !known.has(k))
  const optInt = (k: string): number | null | undefined => (m.has(k) ? (intOf(m.get(k)) ?? undefined) : null)
  if (m.has('id')) {
    const id = str(m.get('id'))
    const g = str(m.get('g'))
    const p = str(m.get('p'))
    const pen = m.has('pen') ? str(m.get('pen')) : 'pen'
    const c = m.has('c') ? str(m.get('c')) : '#000000'
    const seed = optInt('seed')
    const t = optInt('t')
    const from = m.has('from') ? str(m.get('from')) : null
    if (!id || g === null || p === null || pen === null || c === null || seed === undefined || t === undefined || (m.has('from') && !from)) return { kind: 'other', raw }
    return { kind: 'stroke', raw, stroke: { id, g, pen, c, seed, t, from, p }, extra: extraOf(STROKE_KEYS) }
  }
  if (m.has('g')) {
    const id = str(m.get('g'))
    const on = m.has('on') ? str(m.get('on')) : null
    const x = m.has('x') ? numOf(m.get('x')) : 0
    const y = m.has('y') ? numOf(m.get('y')) : 0
    const t = optInt('t')
    const pg = m.has('pg') ? intOf(m.get('pg')) : undefined
    if (!id || (m.has('on') && !on) || x === null || y === null || t === undefined || pg === null || (pg !== undefined && pg < 1)) return { kind: 'other', raw }
    const group: InkGroup = pg === undefined ? { id, on, x, y, t } : { id, on, pg, x, y, t }
    return { kind: 'group', raw, group, extra: extraOf(GROUP_KEYS) }
  }
  if (m.has('ink')) {
    const v = intOf(m.get('ink'))
    if (v === null) return { kind: 'other', raw }
    return { kind: 'head', raw, v, extra: kv.filter(([k]) => k !== 'ink') }
  }
  return { kind: 'other', raw }
}

const extraText = (e: Extra) => e.map(([k, v]) => `,${quote(k)}:${v}`).join('')

/** 一行照固定写法写出来（改过的行用） */
export function inkLineText(l: InkLine): string {
  if (l.kind === 'other') return l.raw
  if (l.kind === 'head') return `{"ink":${l.v}${extraText(l.extra)}}`
  if (l.kind === 'group') {
    const g = l.group
    return `{"g":${quote(g.id)}${g.on !== null ? `,"on":${quote(g.on)}` : ''}${g.pg !== undefined ? `,"pg":${g.pg}` : ''},"x":${fmt2(g.x)},"y":${fmt2(g.y)}${g.t !== null ? `,"t":${g.t}` : ''}${extraText(l.extra)}}`
  }
  const s = l.stroke
  return `{"id":${quote(s.id)},"g":${quote(s.g)},"pen":${quote(s.pen)},"c":${quote(s.c)}${s.seed !== null ? `,"seed":${s.seed}` : ''}${s.t !== null ? `,"t":${s.t}` : ''}${s.from !== null ? `,"from":${quote(s.from)}` : ''},"p":${quote(s.p)}${extraText(l.extra)}}`
}

/** 读整份；空字（没有这个文件）是一份空的 */
export function parseInk(text: string): InkDoc {
  if (text === '') return { lines: [], end: '' }
  const parts = text.split('\n')
  const end = parts[parts.length - 1] === '' ? '\n' : ''
  if (end) parts.pop()
  return { lines: parts.map(parseInkLine), end }
}

/** 写回：没改的行原样，改过的行照固定写法 */
export function printInk(doc: InkDoc): string {
  if (!doc.lines.length) return ''
  return doc.lines.map((l) => l.raw ?? inkLineText(l)).join('\n') + doc.end
}

/** 新文件（还没有笔）：只有头一行 */
export function emptyInk(): InkDoc {
  return { lines: [{ kind: 'head', raw: null, v: INK_VERSION, extra: [] }], end: '\n' }
}

/** 一份里的组（同一个编号写了两行时后面的算） */
export function inkGroups(doc: InkDoc): Map<string, InkGroup> {
  const m = new Map<string, InkGroup>()
  for (const l of doc.lines) if (l.kind === 'group') m.set(l.group.id, l.group)
  return m
}

/** 一份里的笔画，按叠放的先后（同一个编号写了两行时只算后面那行，摆在后面那行的位置） */
export function inkStrokes(doc: InkDoc): InkStroke[] {
  const last = new Map<string, number>()
  doc.lines.forEach((l, i) => l.kind === 'stroke' && last.set(l.stroke.id, i))
  const out: InkStroke[] = []
  doc.lines.forEach((l, i) => l.kind === 'stroke' && last.get(l.stroke.id) === i && out.push(l.stroke))
  return out
}

// ---------------------------------------------------------------- 点列

export interface InkPoint {
  /** 相对组原点 */
  x: number
  y: number
  /** 宽（PencilKit 的 PKStrokePoint.size.width） */
  w: number
  /** 力 */
  f: number
  /** 这一笔开始后的秒数 */
  t: number
  /** 方位角、高度角（弧度） */
  az: number
  al: number
  /** 高（size.height）、不透明度 */
  h: number
  o: number
}

const SCALE = [100, 100, 100, 1000, 1000, 100, 100, 100, 1000] as const
const q = (v: number, k: number) => Math.floor(v * k + 0.5)

/** 点列写成 p：点的坐标是相对组原点的；az、al、h、o 都是默认值的不写 */
export function encodePoints(pts: readonly InkPoint[]): string {
  const tilt = pts.some((p) => q(p.az, 100) !== 0 || q(p.al, 100) !== q(Math.PI / 2, 100))
  const shape = pts.some((p) => q(p.h, 100) !== q(p.w, 100) || q(p.o, 1000) !== 1000)
  const n = shape ? 9 : tilt ? 7 : 5
  const prev = new Array<number>(n).fill(0)
  const out: string[] = []
  for (const p of pts) {
    const vals = [p.x, p.y, p.w, p.f, p.t, p.az, p.al, p.h, p.o]
    const row: number[] = []
    for (let k = 0; k < n; k++) {
      const v = q(vals[k]!, SCALE[k]!)
      row.push(v - prev[k]!)
      prev[k] = v
    }
    out.push(row.join(','))
  }
  return out.join(';')
}

/** 解开 p；写法不对返回 null */
export function decodePoints(p: string): InkPoint[] | null {
  if (p === '') return []
  const out: InkPoint[] = []
  const acc = new Array<number>(9).fill(0)
  let n = -1
  for (const seg of p.split(';')) {
    const parts = seg.split(',')
    if (n === -1) n = parts.length
    if (parts.length !== n || (n !== 5 && n !== 7 && n !== 9)) return null
    for (let k = 0; k < n; k++) {
      const s = parts[k]!
      if (!/^-?\d+$/.test(s)) return null
      acc[k]! += Number(s)
    }
    const v = (k: number) => acc[k]! / SCALE[k]!
    out.push({ x: v(0), y: v(1), w: v(2), f: v(3), t: v(4), az: n >= 7 ? v(5) : 0, al: n >= 7 ? v(6) : Math.PI / 2, h: n >= 9 ? v(7) : v(2), o: n >= 9 ? v(8) : 1 })
  }
  return out
}

// ---------------------------------------------------------------- 编号

/** 新的编号：8 个 [0-9a-z] 的随机字；rand 给 [0,1) 的随机数（测试给固定的） */
export function inkId(rand: () => number = Math.random): string {
  const abc = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 8; i++) s += abc[Math.floor(rand() * 36) % 36]
  return s
}

// ---------------------------------------------------------------- 改（Mac 的选中、挪、改色、删；iPad 加笔）

export interface InkEditOpts {
  /** 改的时间（毫秒），记进改过的行的 t */
  now: number
  /** 新组的编号（只挪一组里的几笔时要） */
  newId?: () => string
}

/** 加一组（group 不给就加进已有的那组）和几笔，加在最后 */
export function addInk(doc: InkDoc, group: InkGroup | null, strokes: readonly InkStroke[]): InkDoc {
  const base = doc.lines.length ? doc : emptyInk()
  const add: InkLine[] = []
  if (group) add.push({ kind: 'group', raw: null, group, extra: [] })
  for (const s of strokes) add.push({ kind: 'stroke', raw: null, stroke: s, extra: [] })
  return { lines: [...base.lines, ...add], end: '\n' }
}

/**
 * 挪这几笔 dx、dy（白板坐标）：一组的笔全在里面就只改组行；只挪一组里的几笔，这几笔换进一个新组（原点挪过去，挂卡照旧），
 * 新组行插在这几笔里的第一笔前面
 */
export function moveInk(doc: InkDoc, ids: Iterable<string>, dx: number, dy: number, o: InkEditOpts): InkDoc {
  const pick = new Set(ids)
  if (!pick.size || (round2(dx) === 0 && round2(dy) === 0)) return doc
  const groups = inkGroups(doc)
  const strokes = inkStrokes(doc)
  const byGroup = new Map<string, InkStroke[]>()
  for (const s of strokes) byGroup.set(s.g, [...(byGroup.get(s.g) ?? []), s])
  /** 整组挪的组；拆出来的：原来的组 → 新组 */
  const whole = new Set<string>()
  const split = new Map<string, InkGroup>()
  for (const [g, ss] of byGroup) {
    const n = ss.filter((s) => pick.has(s.id)).length
    if (!n) continue
    const grp = groups.get(g)
    if (!grp) continue
    if (n === ss.length) whole.add(g)
    else split.set(g, { ...grp, id: (o.newId ?? inkId)(), x: round2(grp.x + dx), y: round2(grp.y + dy), t: o.now })
  }
  const out: InkLine[] = []
  const placed = new Set<string>()
  for (const l of doc.lines) {
    if (l.kind === 'group' && whole.has(l.group.id)) {
      out.push({ ...l, raw: null, group: { ...l.group, x: round2(l.group.x + dx), y: round2(l.group.y + dy), t: o.now } })
    } else if (l.kind === 'stroke' && pick.has(l.stroke.id) && split.has(l.stroke.g)) {
      const ng = split.get(l.stroke.g)!
      if (!placed.has(ng.id)) {
        placed.add(ng.id)
        out.push({ kind: 'group', raw: null, group: ng, extra: [] })
      }
      out.push({ ...l, raw: null, stroke: { ...l.stroke, g: ng.id, t: o.now } })
    } else out.push(l)
  }
  return { lines: out, end: doc.end || '\n' }
}

/** 这几笔改成颜色 c（已经是这个颜色的不动） */
export function recolorInk(doc: InkDoc, ids: Iterable<string>, c: string, o: InkEditOpts): InkDoc {
  const pick = new Set(ids)
  let changed = false
  const lines = doc.lines.map((l): InkLine => {
    if (l.kind !== 'stroke' || !pick.has(l.stroke.id) || l.stroke.c === c) return l
    changed = true
    return { ...l, raw: null, stroke: { ...l.stroke, c, t: o.now } }
  })
  return changed ? { lines, end: doc.end || '\n' } : doc
}

/** 删掉这几笔；它们那组里没笔了，组行也删 */
export function deleteInk(doc: InkDoc, ids: Iterable<string>): InkDoc {
  const pick = new Set(ids)
  const touched = new Set<string>()
  const left = new Set<string>()
  for (const l of doc.lines) {
    if (l.kind !== 'stroke') continue
    if (pick.has(l.stroke.id)) touched.add(l.stroke.g)
    else left.add(l.stroke.g)
  }
  if (!touched.size) return doc
  const lines = doc.lines.filter((l) => !(l.kind === 'stroke' && pick.has(l.stroke.id)) && !(l.kind === 'group' && touched.has(l.group.id) && !left.has(l.group.id)))
  return { lines, end: doc.end }
}

/** 擦断出来的几段记的 from：这一笔的编号，再跟它自己的 from（最近的在前，最多 16 个） */
export const INK_LINEAGE_MAX = 16
export function inkLineage(s: Pick<InkStroke, 'id' | 'from'>): string {
  return [s.id, ...(s.from ? s.from.split(' ') : [])].slice(0, INK_LINEAGE_MAX).join(' ')
}

/**
 * 擦断这一笔（第三条）：它的行换成剩下的几段 pieces（每段的点相对它那一组的原点），放在它原来那一行的位置；
 * 每段新编号（newId）、同一组、同样的笔种颜色种子和认不出的键，t 是 now，from 是 inkLineage。没剩下（pieces 全空）就是删
 */
export function splitInk(doc: InkDoc, id: string, pieces: readonly (readonly InkPoint[])[], o: InkEditOpts): InkDoc {
  const left = pieces.filter((p) => p.length > 0)
  if (!left.length) return deleteInk(doc, [id])
  let at = -1
  doc.lines.forEach((l, i) => l.kind === 'stroke' && l.stroke.id === id && (at = i))
  if (at < 0) return doc
  const l = doc.lines[at] as Extract<InkLine, { kind: 'stroke' }>
  const from = inkLineage(l.stroke)
  const made: InkLine[] = left.map((p) => ({ kind: 'stroke', raw: null, stroke: { ...l.stroke, id: (o.newId ?? inkId)(), t: o.now, from, p: encodePoints(p) }, extra: l.extra }))
  const lines: InkLine[] = []
  doc.lines.forEach((x, i) => {
    if (i === at) lines.push(...made)
    else if (!(x.kind === 'stroke' && x.stroke.id === id)) lines.push(x)
  })
  return { lines, end: doc.end || '\n' }
}

// ---------------------------------------------------------------- 挂卡：卡要有编号、那一行带 ink=1

/**
 * 笔迹要挂到这张卡上：卡的编号（没有就在卡前面加一行只记编号的 `<!-- card id=k1 ink=1 -->`），那一行带上 `ink=1`
 * （「摆回原样」、拖回列里时编号才留着）。已经带着的原样返回
 */
export function inkCardId(text: string, unit: DocUnit): { text: string; id: string } {
  const id = unitId(unit)
  const attrs = { ...(unit.attrs ?? {}) }
  if (id && attrs.ink === '1') return { text, id }
  attrs.ink = '1'
  if (unit.place) return { text: text.slice(0, unit.place.from) + placeLine(unit.place.id, unit.place.x, unit.place.y, attrs) + text.slice(unit.place.to), id: unit.place.id }
  if (unit.tag) return { text: text.slice(0, unit.tag.from) + tagLine(unit.tag.id, attrs) + text.slice(unit.tag.to), id: unit.tag.id }
  const fresh = freshId(text, 'k')
  return { text: text.slice(0, unit.from) + tagLine(fresh, { ink: '1' }) + '\n' + text.slice(unit.from), id: fresh }
}

// ---------------------------------------------------------------- 两边都改了：按编号三方合并

/** 一行在合并里认它的键 */
function keyOf(l: InkLine): string {
  if (l.kind === 'head') return 'h'
  if (l.kind === 'group') return 'g:' + l.group.id
  if (l.kind === 'stroke') return 's:' + l.stroke.id
  return decorKey(l.raw) ?? 'o:' + l.raw
}

const textOf = (l: InkLine) => l.raw ?? inkLineText(l)
const timeOf = (l: InkLine) => (l.kind === 'group' ? (l.group.t ?? 0) : l.kind === 'stroke' ? (l.stroke.t ?? 0) : l.kind === 'head' ? l.v : decorTime(l.raw))

/** 同一个键写了几行时后面的算 */
function byKey(doc: InkDoc): Map<string, InkLine> {
  const m = new Map<string, InkLine>()
  for (const l of doc.lines) m.set(keyOf(l), l)
  return m
}

export interface InkMergeResult {
  text: string
  /** 两边都改了同一行的有几处（取了后改的那一版） */
  clashes: number
}

/** 两台设备都改了这块白板的笔迹：按编号三方合并（规矩见文件开头第四条）；keep 是 t 一样时留哪边 */
export function mergeInk(base: string, local: string, remote: string, keep: 'local' | 'remote'): InkMergeResult {
  if (local === remote) return { text: local, clashes: 0 }
  if (local === base) return { text: remote, clashes: 0 }
  if (remote === base) return { text: local, clashes: 0 }
  const [aText, bText] = keep === 'local' ? [local, remote] : [remote, local]
  const O = byKey(parseInk(base))
  const Ad = parseInk(aText)
  const Bd = parseInk(bText)
  const A = byKey(Ad)
  const B = byKey(Bd)
  let clashes = 0
  /** 合好的每个键用哪一行（undefined 是删了） */
  const pick = new Map<string, InkLine | undefined>()
  for (const k of new Set([...O.keys(), ...A.keys(), ...B.keys()])) {
    const o = O.get(k)
    const a = A.get(k)
    const b = B.get(k)
    const [to, ta, tb] = [o && textOf(o), a && textOf(a), b && textOf(b)]
    if (ta === tb) pick.set(k, a)
    else if (ta === to) pick.set(k, b)
    else if (tb === to) pick.set(k, a)
    else if (!a || !b) pick.set(k, a ?? b)
    else {
      clashes++
      pick.set(k, timeOf(b) > timeOf(a) ? b : a)
    }
  }
  // 擦断（第四条 from 那几条）：base 里的一笔，一边擦断了
  const lineageOf = (l: InkLine | undefined) => (l?.kind === 'stroke' && l.stroke.from ? l.stroke.from.split(' ') : [])
  /** 这一边 base 以后新擦出来的几段：base 里那一笔的编号 → 这几段的键 */
  const piecesOf = (side: Map<string, InkLine>) => {
    const m = new Map<string, string[]>()
    for (const [k, l] of side) {
      if (O.has(k)) continue
      for (const x of lineageOf(l)) if (O.get('s:' + x)?.kind === 'stroke') m.set(x, [...(m.get(x) ?? []), k])
    }
    return m
  }
  const PA = piecesOf(A)
  const PB = piecesOf(B)
  for (const [k, o] of O) {
    if (o.kind !== 'stroke') continue
    const id = o.stroke.id
    const pa = A.has(k) ? undefined : PA.get(id)
    const pb = B.has(k) ? undefined : PB.get(id)
    if (!pa && !pb) continue
    if (pa && pb) {
      // 两边都擦断了：留后擦的那边（t 最大的大，一样取 keep 那边）
      clashes++
      const tmax = (ks: string[]) => Math.max(...ks.map((x) => timeOf(pick.get(x) ?? A.get(x) ?? B.get(x)!)))
      for (const x of tmax(pb) > tmax(pa) ? pa : pb) pick.set(x, undefined)
      continue
    }
    const [pieces, other] = pa ? [pa, B] : [pb!, A]
    const x = other.get(k)
    if (x?.kind !== 'stroke' || textOf(x) === textOf(o)) continue
    // 另一边改了这一笔：它不回来，改的颜色、组、笔种换到擦剩的几段上
    clashes++
    pick.set(k, undefined)
    for (const pk of pieces) {
      const l = pick.get(pk)
      if (l?.kind !== 'stroke') continue
      const s = { ...l.stroke }
      if (x.stroke.c !== o.stroke.c) s.c = x.stroke.c
      if (x.stroke.g !== o.stroke.g) s.g = x.stroke.g
      if (x.stroke.pen !== o.stroke.pen) s.pen = x.stroke.pen
      if (s.c === l.stroke.c && s.g === l.stroke.g && s.pen === l.stroke.pen) continue
      s.t = Math.max(l.stroke.t ?? 0, x.stroke.t ?? 0)
      pick.set(pk, { kind: 'stroke', raw: null, stroke: s, extra: l.extra })
    }
  }
  // 留下的笔画，它那一组被删了：组行也留下（用还在的那边的）
  for (const l of pick.values()) {
    if (l?.kind !== 'stroke') continue
    const gk = 'g:' + l.stroke.g
    if (pick.get(gk)) continue
    const back = A.get(gk) ?? B.get(gk) ?? O.get(gk)
    if (back) pick.set(gk, back)
  }
  // 先后：keep 那边的顺序；另一边（再是 base）里有、keep 那边没有的，插在它在那边紧挨着的前一行后面
  const order: string[] = []
  const seen = new Set<string>()
  for (const l of Ad.lines) {
    const k = keyOf(l)
    if (seen.has(k) || !pick.get(k)) continue
    if (A.get(k) !== l) continue
    seen.add(k)
    order.push(k)
  }
  const weave = (lines: readonly InkLine[]) => {
    const here = new Set(lines.map(keyOf))
    let prev: string | null = null
    for (const l of lines) {
      const k = keyOf(l)
      if (!seen.has(k) && pick.get(k)) {
        let at = prev === null ? (order[0] === 'h' ? 1 : 0) : order.indexOf(prev) + 1
        // 紧跟着的是这一边没有的行（keep 那边自己新加的）：排在它们后面，两边在同一处各加的 keep 那边在前
        while (at < order.length && !here.has(order[at]!)) at++
        order.splice(at, 0, k)
        seen.add(k)
      }
      if (seen.has(k)) prev = k
    }
  }
  weave(Bd.lines)
  weave(parseInk(base).lines)
  // 组行只在 base 里有（拿回来的）：weave 已经按 base 的先后放好
  const lines = order.map((k) => pick.get(k)!)
  const end = lines.length ? '\n' : ''
  return { text: lines.length ? lines.map(textOf).join('\n') + end : '', clashes }
}

// ---------------------------------------------------------------- 深色主题下的颜色

/**
 * 深色主题下怎么画一种颜色：照 PencilKit（iPad 深色模式、macOS darkAqua 下实测）的做法，HSL 的亮度反过来、色相饱和度不变，
 * 等于每个通道加上 255 − 最大 − 最小（#1d2421 → #dbe2df、#2459c6 → #396edb、#ffd84d → #b28b00）。透明度不变
 */
export function darkInk(c: string): string {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(c)
  if (!m) return c
  const v = parseInt(m[1]!, 16)
  const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  const shift = 255 - Math.max(...rgb) - Math.min(...rgb)
  return '#' + rgb.map((x) => (x + shift).toString(16).padStart(2, '0')).join('') + (m[2] ?? '')
}

/** 装饰行（ink-decor.ts）读写一行 JSON 用的同一套扫法 */
export { scanObject as scanInkObject, quote as inkQuote, unquote as inkUnquote }
