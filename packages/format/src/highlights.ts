/**
 * PDF 上划的线（ParaRead 联动，设计 20-pararead联动「划线颜色带含义」，2026-11-23 用户定）：颜色带含义，写进 PDF 旁边那篇配对笔记，
 * 画布笔记和 ParaRead 两边都读写这一份（谁划的都一样），Obsidian 打开也看得懂（高亮是黄的，后面写着含义名和能点的页码，行尾注释看不见）。
 *
 * 一页一段「## 第 N 页 · 划的线」，一条一行：
 *
 *   ## 第 2 页 · 划的线
 *   - ==we selected the AffectiveROAD dataset [14],== · 重点 · [第 2 页](x.pdf#page=2&rect=0.192,0.498,0.318,0.018) <!-- cn:hl=p2-h1 k=key -->
 *
 * 「看不懂」（键 confused）不进这一段，写成一段问题段，原文放在问题里（问 AI 以后回答接在下面）：
 *
 *   ## 第 2 页 · 看不懂：a Bi-LSTM is introduced…
 *   [第 2 页](x.pdf#page=2&rect=…) · 16:44 <!-- cn:thread=x-p2-5 -->
 *
 *   > [!question] 看不懂
 *   > ==a Bi-LSTM is introduced as a temporal refinement layer== <!-- cn:hl=p2-h6 k=confused -->
 *
 * 注释里 k= 是键（认颜色和含义靠它，名字改了不变），「· 重点 ·」是写给人看的名字；含义表（键、名字、颜色）存在库里
 * .canvas-notes/划线颜色.json，两个软件读同一份。位置按「页码 + 原文」找字画，链接里的框只做加速。
 * 纯函数，不碰 Electron、Node（ParaRead、iPad 版直接调）。
 */
import { linkFrom, linkTo, parseReadingNote, type AskQa, type AskSection } from './reading-note'
import { encodePath, formatPdfAnchor, parsePdfAnchor, type Rect } from './pdf-link'

/** 划线能用的颜色：前四种是 ParaRead 现有的四色（也是 Zotero 默认的前四色），后四种给「加一种」 */
export type HlColor = 'yellow' | 'green' | 'blue' | 'red' | 'orange' | 'purple' | 'pink' | 'gray'
export const HL_COLORS: HlColor[] = ['yellow', 'green', 'blue', 'red', 'orange', 'purple', 'pink', 'gray']

/**
 * 每种颜色的点（选色小条、右栏、首页组件）和 PDF 纸面上的底（纸是白的，深浅主题通用）。
 * 前四种的值照 ParaRead 的 --hl-*-dot、--hl-*（styles/tokens.css）
 */
export const HL_DOT: Record<HlColor, string> = {
  yellow: '#FEAA02',
  green: '#75BB3F',
  blue: '#00A1D8',
  red: '#FF4015',
  orange: '#FF7A1A',
  purple: '#8B5CF6',
  pink: '#EC4899',
  gray: '#8E8E93',
}
export const hlPaper = (c: HlColor) => {
  const h = HL_DOT[c]
  return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, 0.3)`
}

/**
 * 「有质疑」：标记、不占颜色（不是含义表里的一种），画石墨灰波浪线（2026-11-23 用户定：「可以换个颜色.」，原来的紫和灵感的紫灯泡太像）。
 * 中性灰，和重点橙黄、定义绿、想引用蓝、看不懂红、灵感紫都分得开；浅色对白纸 6.0、对浅面板 5.5，深色对白纸 3.4、对深面板 4.5 以上（都过 3:1）。
 * 两个软件画它都用这一份（ParaRead 的 --lb-doubt 照它，tests/cnLink.test.ts 核对）；笔记里的写法不变（「> [!question] 有质疑」），只是显示的颜色
 */
export const DOUBT_MARK = { light: '#5C6470', dark: '#868C95' } as const

/** 一种含义：键（写进笔记，不变）、名字（能改）、颜色 */
export interface HlKind {
  key: string
  name: string
  color: HlColor
}

/** 「看不懂」的键：画红色波浪线、不铺底，写成问题段 */
export const CONFUSED = 'confused'

/** 默认四种，排的顺序就是键 1 到 4（黄绿蓝红，和 ParaRead 现在一样） */
export const DEFAULT_KINDS: HlKind[] = [
  { key: 'key', name: '重点', color: 'yellow' },
  { key: 'def', name: '定义', color: 'green' },
  { key: 'cite', name: '想引用', color: 'blue' },
  { key: CONFUSED, name: '看不懂', color: 'red' },
]

/** 含义表在库里的位置（两个软件读同一份，跟着 Git 走） */
export const KINDS_FILE = '.canvas-notes/划线颜色.json'

const KEY_RE = /^[a-z][a-z0-9-]{0,23}$/
/** 名字里不能有的字：「·」会把那一行切错 */
export const kindName = (s: string) => s.replace(/[·\n\r<>[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12)

/** 读含义表：坏了的、空的当默认；少了「看不懂」补上（问题段靠它） */
export function parseKinds(text: string | null): HlKind[] {
  if (!text?.trim()) return DEFAULT_KINDS.map((k) => ({ ...k }))
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return DEFAULT_KINDS.map((k) => ({ ...k }))
  }
  const list = (j && typeof j === 'object' && Array.isArray((j as { kinds?: unknown }).kinds) ? (j as { kinds: unknown[] }).kinds : []) as Partial<HlKind>[]
  const out: HlKind[] = []
  for (const k of list) {
    if (!k || typeof k.key !== 'string' || !KEY_RE.test(k.key) || out.some((x) => x.key === k.key)) continue
    const color = HL_COLORS.includes(k.color as HlColor) ? (k.color as HlColor) : 'gray'
    const name = typeof k.name === 'string' && kindName(k.name) ? kindName(k.name) : k.key
    out.push({ key: k.key, name, color })
  }
  if (!out.length) return DEFAULT_KINDS.map((k) => ({ ...k }))
  if (!out.some((k) => k.key === CONFUSED)) out.push({ ...DEFAULT_KINDS[3]! })
  return out
}

/** 写回含义表：两格缩进、末尾换行（两个软件写出来一个字不差） */
export function kindsJson(kinds: HlKind[]): string {
  return JSON.stringify({ kinds: kinds.map((k) => ({ key: k.key, name: k.name, color: k.color })) }, null, 2) + '\n'
}

/** 加一种：从还没用的颜色里挑第一个，键是 c<n> */
export function addKind(kinds: HlKind[], name: string): HlKind[] {
  const color = HL_COLORS.find((c) => !kinds.some((k) => k.color === c)) ?? 'gray'
  let n = 1
  while (kinds.some((k) => k.key === `c${n}`)) n++
  return [...kinds, { key: `c${n}`, name: kindName(name) || `c${n}`, color }]
}

/** 一条划线 */
export interface Highlight {
  /** p2-h1：第几页的第几条，一篇笔记里不撞 */
  id: string
  /** 含义的键 */
  key: string
  /** 划的原文 */
  text: string
  page: number
  /** 选区在这一页上的位置（比例）；找字画的时候只做加速 */
  rect?: Rect
  /** PDF 在库里的路径（读回来时从链接算；看不懂的从那一段的链接） */
  file: string
  /** 写着的名字（「· 重点 ·」那一节；看不懂的是提示块头上那个词） */
  name: string
  /** 看不懂的：那一段的身份（.canvas-notes/对话/…）、问过 AI 没有、写了「看懂了」没有 */
  thread?: string
  asked?: boolean
  understood?: boolean
}

/** 原文写进 ==…== 之间：一行、不带 ==（会断开高亮）、头尾不是空白和 = */
export function hlText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/={2,}/g, '=')
    .replace(/<!--|-->/g, ' ')
    .trim()
    .replace(/^=+|=+$/g, '')
    .trim()
}

const HL_NOTE = /<!--\s*cn:hl=(\S+?)\s+k=([a-z][a-z0-9-]*)\s*-->/
const LIST_LINE = /^- ==(.+?)==(?: · (.*?))?(?: · \[[^\]]*\]\(([^)]+)\))?\s*<!--\s*cn:hl=(\S+?)\s+k=([a-z][a-z0-9-]*)\s*-->\s*$/
const PAGE_HEAD = /^##\s+(?:以前的版本 · )?第\s*(\d+)\s*页\s*·\s*(.*)$/
const MARKED = /^##\s+第\s*(\d+)\s*页\s*·\s*划的线\s*$/

/** 「划的线」那一段的标题（写进文件的字，不跟界面语言） */
export const markedHead = (page: number) => `## 第 ${page} 页 · 划的线`

/** 一条写进笔记的那一行 */
export function hlLine(h: Pick<Highlight, 'id' | 'key' | 'text' | 'page' | 'rect' | 'file'>, note: string, name: string): string {
  const a = formatPdfAnchor({ file: h.file, page: h.page, ...(h.rect ? { rect: h.rect } : {}) })
  const href = linkFrom(note, h.file) + a.slice(a.indexOf('#'))
  return `- ==${hlText(h.text)}== · ${kindName(name) || h.key} · [第 ${h.page} 页](${href}) <!-- cn:hl=${h.id} k=${h.key} -->`
}

/** 一行「划的线」读回来；不是这种行返回 null */
export function parseHlLine(line: string, note: string): Highlight | null {
  const m = LIST_LINE.exec(line)
  if (!m) return null
  const a = m[3] ? parsePdfAnchor(m[3]) : null
  const page = a?.page ?? Number(/^p(\d+)-/.exec(m[4]!)?.[1] ?? 0)
  return {
    id: m[4]!,
    key: m[5]!,
    text: m[1]!,
    page,
    ...(a?.rect ? { rect: a.rect } : {}),
    file: a ? linkTo(note, encodePath(a.file)) : '',
    name: (m[2] ?? '').trim(),
  }
}

/** 看不懂那一问的问题（「> [!question] 看不懂」后面一行是原文和身份注释） */
export function confusedQ(h: Pick<Highlight, 'id' | 'text'>, name = '看不懂'): string {
  return `${kindName(name) || '看不懂'}\n==${hlText(h.text)}== <!-- cn:hl=${h.id} k=${CONFUSED} -->`
}

/** 问题里有看不懂的身份注释：原文和身份；不是返回 null */
export function confusedOf(q: string): { id: string; text: string; name: string } | null {
  const lines = q.split('\n')
  const i = lines.findIndex((l) => HL_NOTE.test(l))
  if (i < 0) return null
  const m = HL_NOTE.exec(lines[i]!)!
  if (m[2] !== CONFUSED) return null
  const text = /==(.+?)==/.exec(lines[i]!)?.[1] ?? lines[i]!.replace(HL_NOTE, '').trim()
  return { id: m[1]!, text, name: i > 0 ? lines[0]!.trim() : '' }
}

/** 「问 AI」发出去的那一句（答完写进笔记时换回看不懂那一问，keepConfused） */
export const confusedAsk = (text: string) => `这句看不懂：「${hlText(text)}」` // 不翻：发给 AI、对上笔记的原话

/** 问题给人看的样子：看不懂的写「看不懂：原文」，注释、== 去掉 */
export function plainQ(q: string): string {
  const c = confusedOf(q)
  if (c) return `${c.name || '看不懂'}：${c.text}`
  return q.replace(/\s*<!--[\s\S]*?-->/g, '')
}

/** 看不懂那一段的标题（写进文件的字） */
export const confusedTitle = (text: string, name = '看不懂') => {
  const t = hlText(text)
  return `${kindName(name) || '看不懂'}：${[...t].length > 28 ? [...t].slice(0, 28).join('') + '…' : t}`
}

/**
 * 问过 AI 以后重写那一段时，第一问还是看不懂那一问：发出去的是 confusedAsk，写回笔记时换回原来的问题（原文和身份注释在里面）；
 * 第一问不是它（在那一段里直接接着问的）就把看不懂那一问留在最前面
 */
export function keepConfused(old: AskSection | null | undefined, qas: AskQa[]): AskQa[] {
  const first = old?.qas?.[0]
  const c = first ? confusedOf(first.q) : null
  if (!first || !c) return qas
  if (qas[0] && qas[0].q.trim() === confusedAsk(c.text)) return [{ ...qas[0], q: first.q }, ...qas.slice(1)]
  if (qas.some((x) => confusedOf(x.q)?.id === c.id)) return qas
  return [{ ...first }, ...qas]
}

/** 按「## 」切开（代码块里的不算） */
function heads(md: string): { from: number; to: number }[] {
  const starts: number[] = []
  let fence = false
  let pos = 0
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && /^##\s/.test(line)) starts.push(pos)
    pos += line.length + 1
  }
  return starts.map((from, k) => ({ from, to: starts[k + 1] ?? md.length }))
}

/** 笔记里所有划线：「划的线」那几段的每一行，加上看不懂的问题段（页码、框照那一段的链接） */
export function highlightsOf(md: string, note: string): Highlight[] {
  const out: Highlight[] = []
  for (const c of heads(md)) {
    const chunk = md.slice(c.from, c.to)
    const lines = chunk.split('\n')
    if (MARKED.test(lines[0]!)) {
      for (const l of lines) {
        const h = parseHlLine(l, note)
        if (h) out.push(h)
      }
      continue
    }
    if (!HL_NOTE.test(chunk)) continue
    const head = PAGE_HEAD.exec(lines[0]!)
    const back = /^\[第\s*(\d+)\s*页\]\(([^)]+)\)/.exec(lines[1] ?? '')
    const a = back ? parsePdfAnchor(back[2]!) : null
    const thread = /<!--\s*cn:thread=(.+?)\s*-->/.exec(lines[1] ?? '')?.[1]
    // 第一问的问题（看不懂那一问）后面有没有回答：问题提示块结束以后第一个不是空行、不是下一问的字
    let i = lines.findIndex((l) => /^>\s*\[!question\]/.test(l))
    if (i < 0) continue
    const qLines: string[] = []
    qLines.push(lines[i]!.replace(/^>\s*\[!question\]\s?/, ''))
    i++
    while (i < lines.length && /^>/.test(lines[i]!)) qLines.push(lines[i++]!.replace(/^>\s?/, ''))
    const c0 = confusedOf(qLines.join('\n'))
    if (!c0) continue
    const rest = lines.slice(i)
    const asked = rest.some((l) => l.trim() && !/^>\s*\[!(question|side|recap)\]/.test(l) && !/^\[\^/.test(l))
    out.push({
      id: c0.id,
      key: CONFUSED,
      text: c0.text,
      page: a?.page ?? Number(head?.[1] ?? 0),
      ...(a?.rect ? { rect: a.rect } : {}),
      file: a ? linkTo(note, encodePath(a.file)) : '',
      name: c0.name,
      ...(thread ? { thread: `.canvas-notes/对话/${thread}.md` } : {}),
      asked,
      understood: /看懂了/.test(chunk),
    })
  }
  return out
}

/** 还算「看不懂」的几处：没问过 AI、没写「看懂了」（课程首页、ParaRead 组件「还有几处看不懂」数它） */
export const openConfused = (hs: Highlight[]) => hs.filter((h) => h.key === CONFUSED && !h.asked && !h.understood)

/** 这一页下一条的身份：p<页>-h<n>，n 接着这篇里最大的往后数 */
export function nextHlId(md: string, page: number): string {
  let max = 0
  const re = new RegExp(`cn:hl=p${page}-h(\\d+)\\b`, 'g')
  for (const m of md.matchAll(re)) max = Math.max(max, Number(m[1]))
  return `p${page}-h${max + 1}`
}

/**
 * 写进一条（不是看不懂的）：同一个身份的那一行整行换掉；新的一条接在这一页「划的线」那一段最后，
 * 没有那一段就新起一段，放在这一页（和后面几页）的第一段前面。别的字一个不动
 */
export function upsertHighlight(md: string, h: Pick<Highlight, 'id' | 'key' | 'text' | 'page' | 'rect' | 'file'>, note: string, name: string): string {
  const line = hlLine(h, note, name)
  const lines = md.split('\n')
  const same = lines.findIndex((l) => parseHlLine(l, note)?.id === h.id)
  if (same >= 0) {
    lines[same] = line
    return lines.join('\n')
  }
  const cs = heads(md)
  const sec = cs.find((c) => Number(MARKED.exec(md.slice(c.from, md.indexOf('\n', c.from) < 0 ? c.to : md.indexOf('\n', c.from)))?.[1]) === h.page)
  if (sec) {
    // 接在这一段最后一条后面
    const body = md.slice(sec.from, sec.to)
    const bl = body.split('\n')
    let last = 0
    bl.forEach((l, i) => {
      if (parseHlLine(l, note) || /^- /.test(l)) last = i
    })
    bl.splice(last + 1, 0, line)
    return md.slice(0, sec.from) + bl.join('\n') + md.slice(sec.to)
  }
  const text = `${markedHead(h.page)}\n${line}\n`
  const after = cs.find((c) => {
    const m = PAGE_HEAD.exec(md.slice(c.from, md.indexOf('\n', c.from) < 0 ? c.to : md.indexOf('\n', c.from)))
    return m && Number(m[1]) >= h.page
  })
  if (after) return md.slice(0, after.from) + text + '\n' + md.slice(after.from)
  return md.replace(/\n*$/, '\n') + '\n' + text
}

/** 删掉一条（不是看不懂的）：只删那一行；那一段删空了连标题一起删（连着后面那个空行） */
export function removeHighlight(md: string, id: string, note: string): string {
  const lines = md.split('\n')
  const i = lines.findIndex((l) => parseHlLine(l, note)?.id === id)
  if (i < 0) return md
  lines.splice(i, 1)
  let out = lines.join('\n')
  for (const c of heads(out)) {
    const chunk = out.slice(c.from, c.to)
    const ls = chunk.split('\n')
    if (MARKED.test(ls[0]!) && ls.slice(1).every((l) => !l.trim())) {
      out = out.slice(0, c.from) + out.slice(c.to)
      // 前面一段末尾留一个空行就够
      out = out.replace(/\n{3,}$/, '\n\n')
      if (c.from === 0 || c.to === md.length) out = out.replace(/\n+$/, '\n')
      break
    }
  }
  return out
}

/** 「划的线」里这个键的几条换个名字（改名时问一次「把已写的 N 处一起改」）：只换那几行「· 名字 ·」那一节，别的字节不动 */
export function renameKindIn(md: string, key: string, name: string, note: string): { text: string; n: number } {
  let n = 0
  const nm = kindName(name)
  const text = md
    .split('\n')
    .map((l) => {
      const h = parseHlLine(l, note)
      if (!h || h.key !== key || h.name === nm) return l
      n++
      return l.replace(/^(- ==.+?==) · .*? · \[/, `$1 · ${nm} · [`)
    })
    .join('\n')
  return { text, n }
}

/** 这篇里这个键写了几条（看不懂的问题段也算） */
export const countKindIn = (md: string, key: string, note: string) => highlightsOf(md, note).filter((h) => h.key === key).length

/** 整段删掉一处（看不懂还没问过时删那一处；ParaRead 删一处标注）：连着后面的空行；找不到这一段原样返回 */
export function removeSection(md: string, id: string, note: string): string {
  for (const c of heads(md)) {
    const s = parseReadingNote(md.slice(c.from, c.to), note)[0]
    if (s?.id !== id || s.doc) continue
    const out = md.slice(0, c.from) + md.slice(c.to)
    return c.to === md.length ? out.replace(/\n+$/, '\n') : out
  }
  return md
}
