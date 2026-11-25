/**
 * AI 对话写进笔记的新写法（2026-11-24，design/ai-note-switch 方向 A，偏好「不要PDF自动笔记样式」）：普通文档的样子，只往后加。
 *
 *   ## 第 28 页 · LIF Neuron                ← 一页一节（PDF）；网页是网页标题，视频是视频名，文档是那篇的名字
 *
 *   ### 给我讲解一下                         ← 一问：问的原话（几行的，第一行做标题，后面几行接在下面）
 *
 *   ![我框的|268](附件/Lecture05/p28-1.png)  ← 框的图（或下面引用那一句）
 *
 *   —— [第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6)
 *
 *   > [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=…&msg=12&th=Lecture05-p28-1)
 *   > 这一页讲 LIF……
 *
 *   #### 旁支：为什么减掉门槛，而不是清零？   ← 旁支：接在它那一问后面
 *
 *   > 把水位减掉一个门槛的量
 *   > —— 在「给我讲解一下」的回答里
 *
 *   > [!ai] 旁支回答 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=…&msg=14&th=Lecture05-p28-1)
 *   > 减掉门槛（soft reset）……
 *
 * - 认哪一问是哪一条：AI 块头上的「回到 AI 对话」链接（chatLink：对话的 key、那条回答的编号，读 PDF / 网页 / 视频时多一个 th，那一处的名字）。
 *   一个 ### / #### 标题下面、下一个 #### 以上的标题之前，有一块带这种链接的 [!ai]，才算 AI 记的一问；别的标题、段落都是用户自己的。
 * - 只往后加：每答完一问加一次，不重写；撤回只拿掉那一问的标题到 AI 块末尾那几行（用户在后面自己补的字留着）。
 * - 旧写法（cn:thread 注释、完整对话链接那种，reading-note.ts）不转；同一处再问时新问答用新写法接在旧那段后面（AskPlace.after）。
 * - 读回来：parseReadingNote 把这种一节按「那一处」（th，没有时按来源链接）收成 AskSection（doc: true），读的地方不用各改。
 * - 前置知识（2026-11-24，偏好「前置知识就地加标签」）：AI 答的是论文外的基础知识（大 O、自注意力的一般原理……）的那一问，
 *   小标题末尾一个标签 `### 这个 O 是怎么算的 #前置知识`（英文库 `#prerequisite`，两种都认）。由论文某处引出的照旧记在那一页那一问；
 *   不挂在任何一处的（没框没选、没认出页的）进笔记末尾「## 前置知识」一节（PREREQ）。标签是字，打开再保存一字不变，
 *   旧写法（reading-note.ts，ParaRead 写的那种）问题那一行末尾同一个标签，也认。
 */
import { chatLink, parseChatLink } from './ai-block'
import { aiCallout, calloutWords, EN_CALLOUT_WORDS, parseAiCalloutHead, ZH_CALLOUT_WORDS } from './ai-callout'
import { encodePath, formatPdfAnchor, parsePdfAnchor, type Rect } from './pdf-link'
import { type AskMat, type AskQa, type AskSection, cleanQuestion, linkFrom, linkTo, parseSection, threadId, withDerived } from './reading-note'

/** AI 记的一问 */
export interface NoteAsk {
  /** 哪段对话（地方的 key：读 PDF 的 read:<路径>、文档的 file:<路径>……） */
  key: string
  /** 那条回答的编号 */
  msg: number
  /** 读 PDF / 网页 / 视频时那一处的名字（threadName），同一处的几问在右栏、白板里归成一处 */
  th?: string
  /** 问的原话（带的材料在字里是 ①②） */
  q: string
  /** 回答原文 */
  a: string
  /** 「Claude Code · Opus 5.5」 */
  by?: string
  /** 旁支：在回答里选中的那一句、那一问的原话（来源行写「在「…」的回答里」）、那一问的回答编号（插在它后面） */
  side?: { quote: string; parent?: string; of?: number }
  /** 框的图（库里的路径）；w 是框在 PDF 上 100% 时的宽；caption 默认「我框的」 */
  crop?: { path: string; w?: number; caption?: string }
  /** 选中问的那一句（PDF 上选字、网页上选的那段） */
  quote?: string
  /** 来源：回到 PDF 那一页那一块、网页那一段、视频那一秒；href 照写进 md 的样子（pdfSrc、webSrc 给） */
  src?: { label: string; href: string }
  /** 引用进来的几段（①②） */
  mats?: AskMat[]
  /** 讲的是论文外的前置知识（小标题末尾的 #前置知识） */
  pre?: true
}

/** 一问记在哪一节 */
export interface AskPlace {
  /** 二级标题（不带 ##）：PDF「第 28 页 · LIF Neuron」，网页标题，视频名，文档那篇的名字 */
  heading: string
  /** PDF 第几页：同一页的接在同一节（认「## 第 N 页」开头、里面有 AI 记的问的那一节），新的一节按页码插 */
  page?: number
  /** 旧写法里同一处的那一段的身份（AskSection.id）：新问答接在它后面的一节 */
  after?: string
}

/** 文件里认出来的一问：位置（标题行开头到 AI 块末尾那一行的换行之后）、哪一级标题 */
export interface AskUnit {
  from: number
  /** AI 块头那一行的开头 */
  ai: number
  /** AI 块末尾（撤回拿掉到这里） */
  end: number
  /** 到下一个 #### 以上的标题（这一问的地盘，旁支插在这之后） */
  to: number
  level: number
  ask: NoteAsk
  /** 在哪一节（## 那一行的开头；没有 ## 时是 -1） */
  chunk: number
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()

/** 前置知识的标签（写的时候照库语言，读的时候两种都认） */
const PRE_TAGS = [ZH_CALLOUT_WORDS.preTag, EN_CALLOUT_WORDS.preTag]
const PRE_END = new RegExp(`\\s*(?:${PRE_TAGS.join('|')})\\s*$`)

/** 一行末尾的前置知识标签拿下来：剩下的字、有没有 */
export function splitPreTag(line: string): { text: string; pre: boolean } {
  const m = PRE_END.exec(line)
  return m ? { text: line.slice(0, m.index), pre: true } : { text: line, pre: false }
}

/** 一行末尾加上前置知识的标签 */
export const withPreTag = (line: string) => `${line} ${calloutWords().preTag}`
const alt = (s: string) => oneLine(s).replace(/[[\]]/g, '')
const quoteLines = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')

/** 我框的图的说法（读的时候中文、英文都认） */
const CROP_CAPS = ['我框的', '整页', '我框的 · 译文']
const SIDE_HEADS = [ZH_CALLOUT_WORDS.sideHead, EN_CALLOUT_WORDS.sideHead]
const DASH = '—— '
/** 材料的编号（同 apps/notes 的 shared/materials.ts） */
const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 回到 PDF 那一页那一块：「—— [第 28 页](Lecture05.pdf#page=28&rect=…)」 */
export function pdfSrc(note: string, pdf: string, page: number, rect?: Rect): { label: string; href: string } {
  const href = formatPdfAnchor({ file: pdf, page, ...(rect ? { rect } : {}) })
  return { label: `第 ${page} 页`, href: linkFrom(note, pdf) + href.slice(href.indexOf('#')) } // 不翻：写进文件的字（和旧写法一样）
}

/** 回到网页那一段、视频那一秒：网址里的括号、空格转掉，写在 md 链接 (…) 里不断；库里的 HTML 换成相对链接 */
export function webSrc(note: string, label: string, url: string): { label: string; href: string } {
  const href = /^https?:/i.test(url) ? url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) : linkFrom(note, url)
  return { label, href }
}

/** 一问写成的几行（结尾带换行） */
export function renderAsk(a: NoteAsk, note: string): string {
  const w = calloutWords()
  const [first = '', ...more] = cleanQuestion(a.q).split('\n')
  const head = oneLine(first) || (a.crop ? CROP_CAPS[0]! : '…')
  const title = a.pre ? withPreTag(head) : head
  const out = [a.side ? `#### ${w.sideHead}${title}` : `### ${title}`]
  if (more.length) out.push('', more.join('\n'))
  if (a.crop) out.push('', `![${alt(a.crop.caption ?? CROP_CAPS[0]!)}${a.crop.w ? `|${Math.round(a.crop.w)}` : ''}](${linkFrom(note, a.crop.path)})`)
  const src = a.src ? `${DASH}[${alt(a.src.label) || '↩'}](${a.src.href})` : ''
  if (a.side) {
    const lines = [`> ${oneLine(a.side.quote)}`]
    if (a.side.parent?.trim()) lines.push(`> ${DASH}${w.inAnswer(oneLine(a.side.parent))}`)
    if (a.side.quote.trim()) out.push('', lines.join('\n'))
  } else if (a.quote?.trim()) out.push('', quoteLines(a.quote) + (src ? `\n> ${src}` : ''))
  else if (src) out.push('', src)
  ;(a.mats ?? []).forEach((m, i) => {
    // 引用前面写上它在问话里的编号（①②），和小标题里的对得上；网页上引的来源是回到那一段的链接
    if (m.kind === 'quote') out.push('', quoteLines(`${MARKS[i] ?? ''} ${m.text.trim()}`.trim()) + (m.href ? `\n> ${DASH}[${alt(m.src) || '↩'}](${m.href})` : m.src.trim() ? `\n> ${DASH}${oneLine(m.src)}` : ''))
    else out.push('', `![${alt(m.src) || '图'}|180](${linkFrom(note, m.path)})`)
  })
  const link = `[${w.backToChat}](${chatLink(a.key, a.msg, a.th)})`
  out.push('', aiCallout({ label: a.side ? w.sideAnswer : w.answer, ...(a.by ? { by: a.by } : {}), seen: link, text: a.a.trim() || '…' }))
  return out.join('\n') + '\n'
}

// ---------------------------------------------------------------- 认出来

interface Line {
  text: string
  at: number
}

function linesOf(md: string): Line[] {
  const out: Line[] = []
  let at = 0
  for (const text of md.split('\n')) {
    out.push({ text, at })
    at += text.length + 1
  }
  return out
}

/** 头一行里「回到 AI 对话」的那个链接 */
function chatOf(head: string): { key: string; msg: number; th?: string } | null {
  for (const m of head.matchAll(/\]\((canvas-notes:\/\/chat\?[^)\s]+)\)/g)) {
    const c = parseChatLink(m[1]!)
    if (c) return c
  }
  return null
}

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const SRC_LINK = /^——\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/

/** 一篇里所有 AI 记的问（代码块里的不算） */
export function askUnits(md: string, note: string): AskUnit[] {
  const lines = linesOf(md.replace(/\r\n/g, '\n'))
  const heads: { i: number; level: number; text: string }[] = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l.text)) fence = !fence
    else if (!fence) {
      const h = /^(#{1,6})\s+(.*)$/.exec(l.text)
      if (h) heads.push({ i, level: h[1]!.length, text: h[2]!.trim() })
    }
  })
  const out: AskUnit[] = []
  let chunk = -1
  heads.forEach((h, k) => {
    if (h.level <= 2) chunk = h.level === 2 ? lines[h.i]!.at : -1
    if (h.level !== 3 && h.level !== 4) return
    const next = heads.slice(k + 1).find((x) => x.level <= 4)
    const stop = next ? next.i : lines.length
    // 这一问的 AI 块：标题下面第一块带「回到 AI 对话」链接的 [!ai]
    let ai = -1
    for (let i = h.i + 1; i < stop; i++) {
      if (/^>\s*\[!ai\]/i.test(lines[i]!.text)) {
        if (chatOf(lines[i]!.text)) ai = i
        break
      }
    }
    if (ai < 0) return
    let last = ai
    while (last + 1 < stop && /^>/.test(lines[last + 1]!.text)) last++
    const chat = chatOf(lines[ai]!.text)!
    const sideHead = h.level === 4 ? SIDE_HEADS.find((p) => h.text.startsWith(p)) : undefined
    const tag = splitPreTag(h.text)
    const ask: NoteAsk = { key: chat.key, msg: chat.msg, ...(chat.th ? { th: chat.th } : {}), q: sideHead ? tag.text.slice(sideHead.length).trim() : tag.text, a: '', ...(tag.pre ? { pre: true as const } : {}) }
    const head = lines[ai]!.text.replace(/^>\s*\[!ai\][+-]?\s*/i, '')
    const by = parseAiCalloutHead(head).by
    if (by) ask.by = by
    ask.a = lines
      .slice(ai + 1, last + 1)
      .map((l) => l.text.replace(/^>\s?/, ''))
      .join('\n')
      .trim()
    readPre(
      ask,
      lines.slice(h.i + 1, ai).map((l) => l.text),
      !!sideHead,
      note,
    )
    const end = last + 1 < lines.length ? lines[last + 1]!.at : md.length
    out.push({ from: lines[h.i]!.at, ai: lines[ai]!.at, end, to: next ? lines[next.i]!.at : md.length, level: h.level, ask, chunk })
  })
  return out
}

/** 标题和 AI 块之间那几段：问题后面几行、框的图、引用那一句和来源、材料、旁支引用的那句 */
function readPre(a: NoteAsk, pre: string[], side: boolean, note: string) {
  const paras: string[][] = []
  let cur: string[] = []
  for (const l of pre) {
    if (l.trim()) cur.push(l)
    else if (cur.length) {
      paras.push(cur)
      cur = []
    }
  }
  if (cur.length) paras.push(cur)
  const mats: AskMat[] = []
  paras.forEach((p, k) => {
    const im = p.length === 1 ? IMAGE.exec(p[0]!.trim()) : null
    if (im) {
      const [, cap = '', w] = /^(.*?)(?:\|(\d+))?$/.exec(im[1]!)!
      const path = linkTo(note, im[2]!)
      if (!a.crop && !mats.length && CROP_CAPS.includes(cap)) a.crop = { path, ...(w ? { w: Number(w) } : {}), ...(cap !== CROP_CAPS[0] ? { caption: cap } : {}) }
      else mats.push({ kind: 'image', path, src: cap })
      return
    }
    const sl = p.length === 1 ? SRC_LINK.exec(p[0]!.trim()) : null
    if (sl) {
      a.src = { label: sl[1]!, href: sl[2]! }
      return
    }
    if (p.every((l) => /^>/.test(l))) {
      const body = p.map((l) => l.replace(/^>\s?/, ''))
      const tail = body[body.length - 1]!.trim()
      const link = SRC_LINK.exec(tail)
      const dash = tail.startsWith('——') ? tail.replace(/^——\s*/, '') : null
      const text = (dash !== null ? body.slice(0, -1) : body).join('\n').trim()
      if (side && !a.side) {
        const parent = dash !== null ? /^在「(.*)」的回答里$|^in the answer to “(.*)”$/.exec(dash) : null
        a.side = { quote: text, ...(parent ? { parent: parent[1] ?? parent[2]! } : {}) }
      } else if (MARKS.includes(text[0] ?? '')) {
        // 带编号的是材料（编号不算原文）
        const body = text.slice(1).trim()
        mats.push(link ? { kind: 'quote', text: body, src: link[1]!, href: link[2]! } : { kind: 'quote', text: body, src: dash ?? '' })
      } else if (link && !a.quote && !mats.length) {
        a.quote = text
        a.src = { label: link[1]!, href: link[2]! }
      } else mats.push({ kind: 'quote', text, src: dash ?? '' })
      return
    }
    // 标题下面紧跟的一段：问题的后面几行
    if (k === 0) a.q = [a.q, ...p].join('\n')
  })
  if (side && !a.side) a.side = { quote: '' }
  if (mats.length) a.mats = mats
}

/** 这一条回答已经记进去了 */
export function hasAsk(md: string, key: string, msg: number): boolean {
  return askUnits(md, '').some((u) => u.ask.key === key && u.ask.msg === msg)
}

// ---------------------------------------------------------------- 加、拿掉

interface Sec {
  from: number
  to: number
  heading: string
  page?: number
  /** 旧写法那一段的身份 */
  old?: string
  asks: number
}

/** 按「## 」切成节，带上旧写法那一段的身份 */
function secsOf(md: string, units: AskUnit[], note: string): Sec[] {
  const starts: number[] = []
  let fence = false
  let pos = 0
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && /^##\s/.test(line)) starts.push(pos)
    pos += line.length + 1
  }
  return starts.map((from, k) => {
    const to = starts[k + 1] ?? md.length
    const line = md.slice(from, md.indexOf('\n', from) < 0 ? md.length : md.indexOf('\n', from))
    const heading = line.replace(/^##\s+/, '').trim()
    const page = /^第\s*(\d+)\s*页/.exec(heading)
    const old = parseSection(md.slice(from, to), note)?.id
    return { from, to, heading, ...(page ? { page: Number(page[1]) } : {}), ...(old ? { old } : {}), asks: units.filter((u) => u.chunk === from).length }
  })
}

/** 在 pos 处插一块（前面的空行并成一个，后面还有字时再空一行）；pos 前后原有的字一个不动 */
function insertAt(md: string, pos: number, text: string): string {
  const before = md.slice(0, pos).replace(/\n+$/, '')
  const after = md.slice(pos)
  return (before ? before + '\n\n' : '') + text + (after ? '\n' + after : '')
}

/** 配对笔记里没认出是哪一页的那几问放的一节（读 PDF 贴截图问的，0.5.9）：按页的新一节排在它前面 */
export const UNPLACED = '没定位的问答'
/** 不挂在论文任何一处的前置知识（纯背景问题）放的一节：一直在笔记最后（排在「没定位的问答」后面） */
export const PREREQ = '前置知识'

/**
 * 加一问（只往后加）：已经记过这一条回答的原样返回。
 * 主对话的一问接在这一节末尾；旁支接在它那一问（side.of）和那一问已有的旁支后面，找不到那一问时接在这一节末尾。
 * 没有这一节时新起一节：PDF 按页码插（排在页码更大的第一段 AI 记的之前），别的接在文末；after 给了时接在旧写法那一段后面
 */
export function appendAsk(md: string, note: string, a: NoteAsk, place: AskPlace): string {
  const units = askUnits(md, note)
  if (units.some((u) => u.ask.key === a.key && u.ask.msg === a.msg)) return md
  const text = renderAsk(a, note)
  const secs = secsOf(md, units, note)
  const same = (s: Sec) => s.asks > 0 && (place.page !== undefined ? s.page === place.page : s.heading === oneLine(place.heading))
  let sec: Sec | undefined
  if (place.after) {
    const k = secs.findIndex((s) => s.old === place.after)
    if (k >= 0) {
      const next = secs[k + 1]
      if (next && same(next)) sec = next
      else return insertAt(md, secs[k]!.to, `## ${oneLine(place.heading)}\n\n${text}`)
    }
  }
  sec ??= [...secs].reverse().find(same)
  if (!sec) {
    const heading = oneLine(place.heading)
    const fresh = `## ${heading}\n\n${text}`
    // 按页的一节排在页码更大的那节前面；没有更大的就排在「没定位的问答」「前置知识」那两节前面（它们一直在最后，前置知识最后）
    const tail = (s: Sec, names: string[]) => s.asks > 0 && names.includes(s.heading)
    const later =
      place.page !== undefined
        ? secs.find((s) => ((s.asks > 0 || s.old) && s.page !== undefined && s.page > place.page!) || tail(s, [UNPLACED, PREREQ]))
        : heading !== PREREQ
          ? secs.find((s) => tail(s, [PREREQ]))
          : undefined
    return insertAt(md, later ? later.from : md.length, fresh)
  }
  const mine = units.filter((u) => u.chunk === sec!.from)
  if (a.side && a.side.of !== undefined) {
    const k = mine.findIndex((u) => !u.ask.side && u.ask.msg === a.side!.of)
    if (k >= 0) {
      let j = k
      while (j + 1 < mine.length && mine[j + 1]!.ask.side) j++
      const after = mine[j + 1]
      return insertAt(md, after ? after.from : sec.to, text)
    }
  }
  return insertAt(md, sec.to, text)
}

/**
 * 旁支接在它那一问后面（写进那篇本身的那种：网页剪藏那篇、看着的文档，没有按页的节）：接在那一问和它已有的旁支的 AI 块后面，
 * 用户在后面自己打的字不动。已经记过原样返回；找不到那一问是 null（调用的照主对话那样插在光标处或末尾）
 */
export function insertSide(md: string, note: string, a: NoteAsk): string | null {
  const units = askUnits(md, note)
  if (units.some((u) => u.ask.key === a.key && u.ask.msg === a.msg)) return md
  if (!a.side || a.side.of === undefined) return null
  const k = units.findIndex((u) => !u.ask.side && u.ask.key === a.key && u.ask.msg === a.side!.of)
  if (k < 0) return null
  let j = k
  while (j + 1 < units.length && units[j + 1]!.ask.side && units[j + 1]!.ask.key === a.key) j++
  let at = units[j]!.end
  while (md[at] === '\n') at++
  return insertAt(md, at, renderAsk(a, note))
}

/**
 * 光标落在一问里面或刚好在它末尾（刚记进去一问，光标停在 AI 块末尾）时，往下插的东西挪到这一问和挂在它下面的旁支后面：
 * 不插进 AI 块中间，也不把旁支（`#### 旁支` 那种、问框文档里的 `> [!side]` 块）和它那一问隔开。返回那一行的行尾；不在一问里原样返回
 */
export function pastAsk(md: string, pos: number): number {
  const units = askUnits(md, '')
  const k = units.findIndex((u) => u.from <= pos && pos <= u.end)
  if (k < 0) return pos
  let j = k
  while (j + 1 < units.length && units[j + 1]!.ask.side && units[j + 1]!.ask.key === units[k]!.ask.key) j++
  let end = units[j]!.end
  // 后面紧跟的 `> [!side]` 块（空行隔开）也算这一问的
  for (;;) {
    let at = end
    while (md[at] === '\n') at++
    if (!/^>\s*\[!side\]/i.test(md.slice(at, at + 40))) break
    end = at
    while (end < md.length && md[end] === '>') {
      const nl = md.indexOf('\n', end)
      end = nl < 0 ? md.length : nl + 1
    }
  }
  return end > 0 && md[end - 1] === '\n' ? end - 1 : end
}

/**
 * 拿掉一问（撤回、⋯「从《…》拿掉」）：标题行到 AI 块末尾那几行；主对话的一问连着它后面的旁支一起拿掉。
 * 后面用户自己补的字留着；这一节拿空了（只剩 ## 那一行）连那一行一起拿掉。找不到原样返回
 */
export function removeAsk(md: string, key: string, msg: number): string {
  const units = askUnits(md, '')
  const k = units.findIndex((u) => u.ask.key === key && u.ask.msg === msg)
  if (k < 0) return md
  const gone = [units[k]!]
  if (!units[k]!.ask.side) for (let j = k + 1; j < units.length && units[j]!.ask.side && units[j]!.chunk === units[k]!.chunk; j++) gone.push(units[j]!)
  let out = md
  for (const u of [...gone].reverse()) {
    // 拿掉后面跟着的空行，前后各剩一个空行
    let end = u.end
    while (out[end] === '\n') end++
    out = out.slice(0, u.from) + out.slice(end)
  }
  // 这一节空了：## 那一行也拿掉
  const c = units[k]!.chunk
  if (c >= 0) {
    const rest = out.slice(c)
    const m = /^##[^\n]*\n(?:[ \t]*\n)*/.exec(rest)
    if (m && (rest.length === m[0].length || /^#{1,2}\s/.test(rest.slice(m[0].length)))) out = out.slice(0, c) + rest.slice(m[0].length)
  }
  return out.replace(/\n+$/, '\n')
}

/**
 * 在那一处（th）最后一问（主对话那一问，不算旁支）的 AI 块后面插一行（可视化做好挂进笔记：`![可视化 · 标题](x.html)`）。
 * 那一行已经紧跟在那里了、这一篇里没有这一处的问：原样返回
 */
export function insertAfterAsk(md: string, note: string, th: string, line: string): string {
  const last = askUnits(md, note)
    .filter((u) => u.ask.th === th && !u.ask.side)
    .pop()
  if (!last) return md
  let at = last.end
  while (md[at] === '\n') at++
  if (md.slice(at).split('\n')[0] === line) return md
  return insertAt(md, at, line + '\n')
}

// ---------------------------------------------------------------- 收成 AskSection（读的地方用）

/** 一节（## 那一行开头到下一个 ## 之前）里 AI 记的问，按那一处收成几段 */
export function askSectionsOf(chunk: string, note: string): AskSection[] {
  const head = /^##\s+(?:第\s*(\d+)\s*页\s*(?:·\s*)?)?(.*)$/.exec(chunk.split('\n')[0] ?? '')
  const units = askUnits(chunk, note).filter((u) => u.chunk === 0)
  const out: AskSection[] = []
  const by = new Map<string, AskSection>()
  let last: AskQa | null = null
  for (const u of units) {
    const a = u.ask
    if (a.side) {
      if (!last) {
        const s = sectionOf(a, head, note)
        out.push(s)
        last = { q: '', a: '', sides: [] }
        s.qas!.push(last)
      }
      const turn = { q: a.q, a: a.a, ref: { key: a.key, msg: a.msg }, ...(a.pre ? { pre: true as const } : {}) }
      const prev = last.sides[last.sides.length - 1]
      if (a.side.quote || !prev) last.sides.push({ quote: a.side.quote, turns: [turn] })
      else prev.turns.push(turn)
      continue
    }
    const k = a.th ? `th:${a.th}` : a.src ? `src:${a.src.href}` : `msg:${a.key}#${a.msg}`
    let s = by.get(k)
    if (!s) {
      s = sectionOf(a, head, note)
      by.set(k, s)
      out.push(s)
    }
    if (!s.crop && a.crop) {
      s.crop = a.crop.path
      if (a.crop.w) s.cropW = a.crop.w
    }
    if (!s.quote && a.quote) s.quote = a.quote
    if (!s.by && a.by) s.by = a.by
    last = { q: a.q, a: a.a, sides: [], ...(a.mats ? { mats: a.mats } : {}), ref: { key: a.key, msg: a.msg }, ...(a.pre ? { pre: true as const } : {}) }
    s.qas!.push(last)
  }
  return out.map(withDerived)
}

function sectionOf(a: NoteAsk, head: RegExpExecArray | null, note: string): AskSection {
  const s: AskSection = {
    id: a.th ? threadId(a.th) : `chat:${a.key}#${a.msg}`,
    file: '',
    page: head?.[1] ? Number(head[1]) : 0,
    title: oneLine(a.q).slice(0, 80) || (head?.[2] ?? '').trim(),
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: [],
    recap: '',
    doc: true,
    ...(a.by ? { by: a.by } : {}),
  }
  const href = a.src?.href
  const pdf = href ? parsePdfAnchor(href) : null
  if (pdf && !/^https?:/i.test(href!)) {
    s.file = linkTo(note, encodePath(pdf.file))
    s.page = pdf.page
    if (pdf.rect) s.rect = pdf.rect
  } else if (href && a.src) {
    s.web = { label: a.src.label, url: /^https?:/i.test(href) ? href.replace(/%2[089]/gi, (c) => decodeURIComponent(c)) : linkTo(note, href) }
    const vt = /^▶ (?:(\d+):)?(\d+):(\d{2}) · /.exec(a.src.label)
    if (vt) s.web.t = Number(vt[1] ?? 0) * 3600 + Number(vt[2]) * 60 + Number(vt[3])
  }
  return s
}

// ---------------------------------------------------------------- 白板看法：一问一列

/** 白板上一问那一列里的一张卡：top 是标题下面框的图、引用那一句、来源；qa 是 AI 回答那一块；more 是用户补在回答后面的字；side 是一条旁支 */
export interface AskCard {
  part: 'top' | 'qa' | 'more' | 'side'
  from: number
  to: number
}

/** 一问一列：列头是问的那句（标题那一行），页码从这一节的「## 第 N 页」来 */
export interface AskColumn {
  /** 问的那句（标题去掉 ### 和「旁支：」） */
  title: string
  page?: number
  /** 标题那一行 */
  head: { from: number; to: number }
  /** 这一列在文档里的末尾 */
  end: number
  cards: AskCard[]
  ask: NoteAsk
  /** 这一问讲的是前置知识（列头带小标签） */
  pre?: true
}

/**
 * 新写法的一节（## 那一行开头 from 到 to）在白板上：一问一列，一页的几问并排（2026-11-24 调度定：和配对笔记白板分列同一套，
 * 用户原话「每个问话作为一列 旁支的话可以作为主对话 放在对话那一列」）。旁支排在它那一问那一列里；节里第一问前面用户自己的字是 lead。
 * 只读：范围都是原文里的
 */
export function askColumns(md: string, from: number, to: number, note = ''): { lead: { from: number; to: number } | null; columns: AskColumn[] } {
  const units = askUnits(md, note).filter((u) => u.from >= from && u.from < to)
  const columns: AskColumn[] = []
  const lineEnd = (at: number) => {
    const n = md.indexOf('\n', at)
    return n < 0 ? md.length : n
  }
  /** 一截里去掉头尾空行后的范围；空的是 null */
  const span = (a: number, b: number): { from: number; to: number } | null => {
    const s = md.slice(a, b)
    const lead = s.length - s.trimStart().length
    const body = s.trim()
    return body ? { from: a + lead, to: a + lead + body.length } : null
  }
  const headEnd = lineEnd(from)
  const page = /^##\s+第\s*(\d+)\s*页/.exec(md.slice(from, headEnd))?.[1]
  const lead = units.length ? span(headEnd, units[0]!.from) : null
  for (const u of units) {
    const hEnd = lineEnd(u.from)
    const cards: AskCard[] = []
    const add = (part: AskCard['part'], a: number, b: number) => {
      const r = span(a, b)
      if (r) cards.push({ part, ...r })
    }
    if (u.ask.side && columns.length) {
      const col = columns[columns.length - 1]!
      col.cards.push({ part: 'side', from: u.from, to: span(u.from, u.end)!.to })
      const more = span(u.end, u.to)
      if (more) col.cards.push({ part: 'more', ...more })
      col.end = u.to
      continue
    }
    add('top', hEnd, u.ai)
    add('qa', u.ai, u.end)
    add('more', u.end, u.to)
    columns.push({ title: u.ask.q.split('\n')[0]!, ...(page ? { page: Number(page) } : {}), head: { from: u.from, to: hEnd }, end: u.to, cards, ask: u.ask, ...(u.ask.pre ? { pre: true as const } : {}) })
  }
  return { lead, columns }
}
