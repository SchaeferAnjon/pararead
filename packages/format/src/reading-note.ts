/**
 * 一份 PDF 一篇笔记（「第3讲 线性映射 笔记.md」，和 PDF 在同一个文件夹）：每框一块问一轮，问完在后台记一段。
 * 笔记是普通 md，用户能自己改；这里负责写一段、读回来（右栏「笔记」显示成一篇长文档）、按这一段的身份找到同一段替换。
 *
 * 现在写的一段（CN-93、94、95、96：问题照发出去的原话、回答照 AI 的原文、旁支挂在被问那一问的回答后面、末尾一句小结）：
 *
 *   ## 第 28 页 · LIF 神经元的三条公式
 *   [第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6) · 20:21 <!-- cn:thread=Lecture05-p28-1 -->
 *
 *   ![我框的|268](../../附件/Lecture05/p28-1.png)
 *
 *   > [!question] 给我讲解一下
 *
 *   （AI 回答原文；标题降到 ### 以下，不把这一段切开）
 *
 *   > [!side] 为什么减掉门槛，而不是清零？
 *   > > 水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量
 *   >
 *   > （旁支回答原文）
 *
 *   > [!side] 同一条旁支接着问的（不带引用句）
 *   >
 *   > （回答）
 *
 *   > [!question] 主对话里接着问的原话
 *
 *   （回答原文）
 *
 *   > [!recap] 一句小结
 *
 *   [^p28-1-1]: 「多段引用的那段字」 AI的回答 · 第28页
 *   [^p28-1-2]: ![粘贴的图|180](../../附件/Lecture05/p28-1-m2.png)
 *
 *   [可视化 · 标题](….html) · [[双链]]
 *
 * 身份是第二行行尾的注释（.canvas-notes/对话/ 下那一处的名字，和以前「完整对话」的路径同一个），不再写完整对话的链接；
 * 我框的图写宽度（框在 PDF 上 100% 时的宽，CN-111）；多段引用的 ①② 写成脚注，标签带这一处的页和序号，一篇笔记里不撞。
 *
 * 以前写的一段（照旧读得回来、照旧显示，不自动改写；同一处再问时整段换成上面的样子）：
 *
 *   ## 第 5 页 · 旋转矩阵每个数从哪来
 *   [第 5 页](第3讲%20线性映射.pdf#page=5&rect=0.05,0.29,0.52,0.36) · 10:20
 *
 *   ![我框的](../../附件/第3讲%20线性映射/p5-1.png)
 *
 *   ![第 5 页 · 单位圆上的 e₁、e₂](../../附件/第3讲%20线性映射/p5-1-fig.png)
 *
 *   > [!question] 我的疑惑
 *   > 整块没看懂：旋转矩阵的四个数是怎么来的
 *
 *   > [!ai] AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页
 *   > 换个看法，先别看公式……
 *   >
 *   > - 要点一
 *   > - 要点二
 *
 *   （讲通的讲法和要点是 AI 写的，放进一个 [!ai] 提示块，CN-76；以前写成 [!success] 讲通的讲法 + 块外的列表，照样读得回来）
 *
 *   <details><summary>没讲通 · 第 1 版：用公式推，没听懂</summary>
 *
 *   原来的讲法
 *
 *   </details>
 *
 *   [完整对话 · 2 轮](../../.canvas-notes/对话/第3讲%20线性映射-p5-1.md) · [[第4讲 特征值#旋转矩阵没有实特征值]]
 *
 * 读回来时路径都换回库里的路径（AskSection 里一律是库里的路径）。
 * 「完整对话」的路径就是这一段的身份：同一处接着问，就按它找到这一段整段换掉；用户自己写的别的段落原样留着。
 */
import { aiCallout, calloutWords, parseAiCalloutHead, splitAiBody } from './ai-callout'
import { encodePath, formatPdfAnchor, parsePdfAnchor, type Rect } from './pdf-link'
import { AI_KEY, setProp } from './props'
import { askSectionsOf } from './ai-note'

export interface Figure {
  path: string
  caption: string
}

export interface FailedTry {
  version: number
  /** 一行：用了什么讲法、为什么没讲通 */
  line: string
  /** 当时的原文 */
  text: string
}

/** 多段引用带的一块材料（这一段末尾的脚注）：引用的字和来源，或一张图（库里的路径） */
/** 带的材料：引用（href 给了是网页上引的，来源写成回到那一段的链接）、图 */
export type AskMat = { kind: 'quote'; text: string; src: string; href?: string } | { kind: 'image'; path: string; src: string }

/** 一问一答：问题是发出去的原话（带的材料在字里是 ①②），回答是 AI 的原文 */
export interface AskTurn {
  q: string
  a: string
  mats?: AskMat[]
  /** 新写法（ai-note.ts）记的一问：哪段对话的哪条回答（AI 块头上「回到 AI 对话」那个链接） */
  ref?: { key: string; msg: number }
}

/** 一条旁支：在回答里选中的那一句，和在旁支里问的几问 */
export interface AskSide {
  quote: string
  turns: AskTurn[]
}

/** 主对话里的一问：后面挂着在它的回答里开的旁支 */
export interface AskQa extends AskTurn {
  sides: AskSide[]
}

export interface AskSection {
  /** 这一处的身份：.canvas-notes/对话/<名字>.md（以前是完整对话文件的路径，现在写成第二行行尾的注释） */
  id: string
  /** PDF 在库里的路径 */
  file: string
  page: number
  /** 框的位置（这一页上的比例）；整页问的没有 */
  rect?: Rect
  title: string
  /** 问的时间 HH:MM */
  time?: string
  /** 我框的那块截图 */
  crop?: string
  /** AI 觉得这页重要的图 */
  figures: Figure[]
  /** 我的疑惑：用户口吻，一行一条 */
  doubts: string[]
  /** 讲通的讲法 */
  good: string
  /** 换过讲法时是第几版 */
  goodVersion?: number
  /** 哪家哪个模型讲的（「Claude Code · Opus 5.5」，写在提示块头上） */
  by?: string
  points: string[]
  failed: FailedTry[]
  rounds: number
  /** 双链目标（不带方括号） */
  links: string[]
  /**
   * 这一处做的可视化（库里的 HTML 文件）。embed：写成单独一段的嵌入 `![可视化 · 标题](x.html)`，文档里画成能拖的图
   * （2026-11-22 起新做的都是，task-m552v）；没有的是以前写在脚上那一行里的链接 `[可视化 · 标题](x.html)`，原样留着，不自动改
   */
  viz?: { path: string; title: string; embed?: boolean }
  /**
   * 不是在 PDF 上问的：网页（url 是网址，label 是域名）或库里的 HTML（url 是库里的路径，label 是文件名）。
   * 这时链接那行写「[域名](网址)」，点了回网页；page 是问的时候 PDF 翻到的那页（没有 PDF 时是 0，标题不写页码）。
   * 视频问答块「接着问」的：label 是「▶ 00:06 · 视频名」，t 是那一问在视频第几秒（AI 那块写「看了 00:06 这一帧」）
   */
  web?: { url: string; label: string; t?: number }
  /**
   * 新格式（有它就是新格式）：主对话里问的每一问，旁支挂在被问的那一问下面。
   * 这时上面几个旧字段是从它算出来的（withDerived），给还没换的地方用：doubts 是每一问的原话（主问题 + 旁支问题），
   * good 是第一个回答的开头一段，rounds 是一共问了几问；points、failed 是空的
   */
  qas?: AskQa[]
  /** 这一轮的一句小结（每答完一次重写，CN-96） */
  recap?: string
  /** 我框的图在 PDF 上 100% 时的宽（CSS 像素），图按这个宽显示（CN-111） */
  cropW?: number
  /**
   * ParaRead 对照看法里框的（2026-11-23，设计页 51）：crop 截的是译文页时 cropSide 是 tr，图注写「我框的 · 译文」；
   * 选了「两边都带」时 crop 是原文那张、cropTr 是译文那张（原文在前）。页码和框照原 PDF，两边版面一样。画布笔记不做 PDF 双语，只照样显示
   */
  cropSide?: 'tr'
  cropTr?: string
  /** 选字问的那段原文（task-yp8l7）：写成图下面、第一问上面的一个引用块（选字问不截图） */
  quote?: string
  /**
   * AI 对话写进笔记的新写法（ai-note.ts，2026-11-24）：普通文档的一问一个小标题、一块 AI 回答，只往后加。
   * 这时 qas 是从文件里认出来的，每一问带 ref；不能 upsertSection 整段换（那是旧写法的），加问走 appendAsk
   */
  doc?: true
}

export const CONVO_DIR = '.canvas-notes/对话'
export const ATTACH_DIR = '附件'

const baseName = (p: string) => p.split('/').pop() ?? p
const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** PDF 旁边那篇笔记：「第3讲 线性映射.pdf」→「第3讲 线性映射 笔记.md」 */
export function notePathFor(pdf: string): string {
  const d = dirOf(pdf)
  return `${d ? d + '/' : ''}${stem(pdf)} 笔记.md`
}

/** 放截图的文件夹：附件/<PDF 名字>/ */
export function attachDirFor(pdf: string): string {
  return `${ATTACH_DIR}/${stem(pdf)}`
}

/** 课程/<课>/… 里的 PDF 属于哪门课 */
export function courseOf(pdf: string): string | undefined {
  const m = /^课程\/([^/]+)\//.exec(pdf)
  return m?.[1]
}

/** 文件名里的「第 3 讲」「Lecture 3」「L03」 */
export function lectureOf(pdf: string): number | undefined {
  const s = stem(pdf)
  const m = /第\s*(\d+)\s*讲/.exec(s) ?? /\blec(?:ture)?\s*[-_ ]?(\d+)/i.exec(s) ?? /^L(\d+)\b/.exec(s)
  return m ? Number(m[1]) : undefined
}

const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * 新笔记的开头：属性（和导图、课程首页同一套键：类型、课程、第几讲、来源、日期）+ 一级标题。
 * 课程、第几讲是软件按文件夹和文件名填的，记在「AI填的」里，用户改了就不算
 */
export function newReadingNote(pdf: string, now = new Date()): string {
  let t = setProp('', '类型', '笔记')
  const course = courseOf(pdf)
  const lec = lectureOf(pdf)
  if (course) t = setProp(t, '课程', course)
  if (lec !== undefined) t = setProp(t, '第几讲', String(lec))
  t = setProp(t, '来源', `[[${baseName(pdf)}]]`)
  t = setProp(t, '日期', dayOf(now))
  const ai = [...(course ? ['课程'] : []), ...(lec !== undefined ? ['第几讲'] : [])]
  if (ai.length) t = setProp(t, AI_KEY, ai.join(', '))
  return `${t}\n# ${stem(pdf)} 笔记\n`
}

/** 笔记 note 里指向库里 target 的相对链接（每一段编码，括号、空格不破坏 md 链接） */
export function linkFrom(note: string, target: string): string {
  const from = note.split('/').slice(0, -1)
  const to = target.split('/')
  let k = 0
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++
  return encodePath([...Array(from.length - k).fill('..'), ...to.slice(k)].join('/'))
}

/** 反过来：笔记里的相对链接 → 库里的路径 */
export function linkTo(note: string, link: string): string {
  const parts = note.split('/').slice(0, -1)
  for (const p of decode(link).split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return parts.join('/')
}

/** 写进 md 时不能破坏结构的字：方括号会断开图片说明，换行会断开一行 */
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()
const alt = (s: string) => oneLine(s).replace(/[[\]]/g, '')

/** 嵌进笔记的可视化：单独一段 `![可视化 · 标题](x.html)`（task-m552v） */
const VIZ_EMBED = /^!\[可视化 · ([^\]]*)\]\(([^)\s]+\.html?)\)\s*$/i
const vizEmbedLine = (s: { viz?: AskSection['viz'] }, note: string) => (s.viz?.embed ? `![可视化 · ${alt(s.viz.title)}](${linkFrom(note, s.viz.path)})` : null)
const vizLink = (s: { viz?: AskSection['viz'] }, note: string) => (s.viz && !s.viz.embed ? [`[可视化 · ${alt(s.viz.title)}](${linkFrom(note, s.viz.path)})`] : [])
const quote = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')

/** 视频里第几秒：00:06、1:02:03（和视频块上的一样） */
function clipTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`
}

/** 「问这一页」附的整页截图的说明 */
const WHOLE_PAGE = '整页'

/** 附的截图叫什么：「问这一页」没有框，是「整页」；框的、网页上框的是「我框的」（笔记文件、右栏笔记面板、Anki 弹窗同一个说法）；框的是译文页的「我框的 · 译文」 */
export function cropCaption(s: { rect?: unknown; web?: unknown; cropSide?: 'tr' }): string {
  return !s.rect && !s.web ? WHOLE_PAGE : s.cropSide === 'tr' ? CROP_TR : '我框的'
}
/** ParaRead 对照看法里框的译文页那张 */
const CROP_TR = '我框的 · 译文'

/** note：这一段写进的那篇笔记在库里的路径（链接相对它） */
export function renderSection(s: AskSection, note: string): string {
  if (s.qas) return renderDoc(s, note)
  const out: string[] = []
  out.push(`## ${s.page > 0 ? `第 ${s.page} 页 · ` : ''}${oneLine(s.title) || '没起标题'}`)
  const back = s.web
    ? `[${alt(s.web.label) || '网页'}](${/^https?:/i.test(s.web.url) ? s.web.url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) : linkFrom(note, s.web.url)})`
    : `[第 ${s.page} 页](${anchorFrom(note, s.file, s.page, s.rect)})`
  out.push(`${back}${s.time ? ` · ${s.time}` : ''}`)
  const imgs: string[] = []
  // 「问这一页」附的是整页（没有框）：图的说明写「整页」，不写「我框的」
  if (s.crop) imgs.push(`![${cropCaption(s)}](${linkFrom(note, s.crop)})`)
  for (const f of s.figures) imgs.push(`![${alt(f.caption) || '图'}](${linkFrom(note, f.path)})`)
  // 一张图一段：文档视图里一段只有一张图才显示成图
  if (imgs.length) out.push('', imgs.join('\n\n'))
  if (s.doubts.length) out.push('', `> [!question] 我的疑惑\n${s.doubts.map((d) => `> ${oneLine(d)}`).join('\n')}`)
  // AI 讲通的讲法和要点：一个 [!ai] 提示块，和自己写的分得开
  if (s.good.trim() || s.points.length) {
    // 写进文件的「看了什么」跟库语言（task-zojmg）
    const w = calloutWords()
    const seen = s.web ? (s.web.t !== undefined ? w.seenFrame(clipTime(s.web.t)) : /^https?:/i.test(s.web.url) ? w.seenWeb : w.seenBox) : w.seenPage(s.page)
    out.push('', aiCallout({ text: s.good, points: s.points, seen, ...(s.by ? { by: s.by } : {}), ...(s.goodVersion ? { version: s.goodVersion } : {}) }))
  }
  for (const f of s.failed) {
    out.push('', `<details><summary>没讲通 · 第 ${f.version} 版：${oneLine(f.line).replace(/</g, '＜')}</summary>`, '', f.text.trim(), '', '</details>')
  }
  const foot = [`[完整对话 · ${s.rounds} 轮](${linkFrom(note, s.id)})`, ...vizLink(s, note), ...s.links.map((l) => `[[${oneLine(l)}]]`)]
  out.push('', foot.join(' · '))
  const embed = vizEmbedLine(s, note)
  if (embed) out.push('', embed)
  return out.join('\n') + '\n'
}

// ---------------------------------------------------------------- 读回来

/** 指回 PDF 某页某块的相对链接 */
function anchorFrom(note: string, pdf: string, page: number, rect?: Rect): string {
  const href = formatPdfAnchor({ file: pdf, page, rect })
  return linkFrom(note, pdf) + href.slice(href.indexOf('#'))
}

/** 一段 md 里能认出的东西；认不出这一段身份（第二行行尾的注释，或以前的完整对话链接）的段（用户自己写的）返回 null */
export function parseSection(chunk: string, note: string): AskSection | null {
  const lines = chunk.replace(/\r\n/g, '\n').split('\n')
  const head = /^##\s+(?:第\s*(\d+)\s*页\s*·\s*)?(.*)$/.exec(lines[0] ?? '')
  if (!head) return null
  if (THREAD_NOTE.test(lines[1] ?? '')) return parseDoc(lines, head, note)
  const convo = /\[完整对话(?:\s*·\s*(\d+)\s*轮)?\]\(([^)]+)\)/.exec(chunk)
  if (!convo) return null
  const s: AskSection = {
    id: linkTo(note, convo[2]!),
    file: '',
    page: Number(head[1] ?? 1),
    title: head[2]!.trim(),
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: Number(convo[1] ?? 1),
    links: [],
  }
  const anchorLine = lines.find((l) => /^\[第\s*\d+\s*页\]\(/.test(l))
  if (anchorLine) {
    const m = /^\[[^\]]*\]\(([^)]+)\)(?:\s*·\s*(\d{1,2}:\d{2}))?/.exec(anchorLine)
    const a = m ? parsePdfAnchor(m[1]!) : null
    if (a) {
      s.file = linkTo(note, encodePath(a.file))
      s.page = a.page
      if (a.rect) s.rect = a.rect
    }
    if (m?.[2]) s.time = m[2]
  } else {
    // 网页、HTML 上问的：第二行是「[域名](网址) · 10:20」
    const w = /^\[([^\]]*)\]\(((?:https?:[^)\s]+)|[^)\s]*\.html?)\)(?:\s*·\s*(\d{1,2}:\d{2}))?\s*$/i.exec(lines[1] ?? '')
    if (w) {
      s.web = { label: w[1]!, url: /^https?:/i.test(w[2]!) ? w[2]!.replace(/%2[089]/gi, (c) => decodeURIComponent(c)) : linkTo(note, w[2]!) }
      // 视频「接着问」的：「▶ 00:06 · 视频名」
      const vt = /^▶ (?:(\d+):)?(\d+):(\d{2}) · /.exec(w[1]!)
      if (vt) s.web.t = Number(vt[1] ?? 0) * 3600 + Number(vt[2]) * 60 + Number(vt[3])
      if (!head[1]) s.page = 0
      if (w[3]) s.time = w[3]
    }
  }
  for (const m of chunk.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const path = linkTo(note, m[2]!)
    // 嵌进来的可视化不是配图（下面单认）
    if (VIZ_EMBED.test(m[0])) continue
    if ((m[1] === '我框的' || m[1] === WHOLE_PAGE) && !s.crop) s.crop = path
    else s.figures.push({ path, caption: m[1]! })
  }
  let i = 1
  while (i < lines.length) {
    const l = lines[i]!
    const callout = /^>\s*\[!(\w+)\]\s*(.*)$/.exec(l)
    if (callout) {
      const body: string[] = []
      i++
      while (i < lines.length && /^>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ''))
      if (callout[1] === 'question') s.doubts.push(...body.map((b) => b.trim()).filter(Boolean))
      else if (callout[1] === 'ai') {
        const h = parseAiCalloutHead(callout[2]!)
        const b = splitAiBody(body)
        s.good = b.text
        s.points.push(...b.points)
        if (h.version) s.goodVersion = h.version
        if (h.by) s.by = h.by
      } else if (callout[1] === 'success') {
        s.good = body.join('\n').trim()
        const v = /第\s*(\d+)\s*版/.exec(callout[2]!)
        if (v) s.goodVersion = Number(v[1])
      }
      continue
    }
    const det = /^<details><summary>没讲通\s*·\s*第\s*(\d+)\s*版[：:]\s*(.*?)<\/summary>\s*$/.exec(l)
    if (det) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^<\/details>\s*$/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      s.failed.push({ version: Number(det[1]), line: det[2]!.replace(/＜/g, '<'), text: body.join('\n').trim() })
      continue
    }
    const pt = /^[-*]\s+(.*)$/.exec(l)
    if (pt) s.points.push(pt[1]!.trim())
    i++
  }
  const footer = lines.find((l) => l.includes('[完整对话'))
  if (footer) {
    for (const m of footer.matchAll(/\[\[([^\]]+)\]\]/g)) s.links.push(m[1]!)
    const v = /\[可视化 · ([^\]]*)\]\(([^)]+)\)/.exec(footer)
    if (v) s.viz = { title: v[1]!, path: linkTo(note, v[2]!) }
  }
  const em = lines.map((l) => VIZ_EMBED.exec(l)).find(Boolean)
  if (em) s.viz = { title: em[1]!, path: linkTo(note, em[2]!), embed: true }
  return s
}

// ---------------------------------------------------------------- 新格式：一篇长文档里的一段（CN-93–96）

/** 第二行行尾那条注释：这一段的身份 */
const THREAD_NOTE = /\s*<!--\s*cn:thread=(.+?)\s*-->\s*$/

/** 身份 ↔ 注释里的名字：.canvas-notes/对话/Lecture05-p28-1.md ↔ Lecture05-p28-1 */
export const threadName = (id: string) => baseName(id).replace(/\.md$/i, '')
export const threadId = (name: string) => `${CONVO_DIR}/${name}.md`

/** 输入框里材料的编号（和 apps 的 shared/materials.ts 同一串，format 不依赖软件那边） */
const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 脚注标签的前半截：这一处的页和序号（p28-1），一篇笔记里各段不撞；没有页的（视频）用整个名字 */
const footTag = (id: string) => {
  const name = threadName(id)
  return /(?:^|-)(p\d+-\d+)$/.exec(name)?.[1] ?? name.replace(/[\s\]^[]+/g, '')
}

/** 问题的字：去掉头尾空白，几段并成一行一行（提示块的头一行放第一行，后面的接着 > 写） */
export const cleanQuestion = (q: string) => q.trim().split(/\s*\n\s*/).filter(Boolean).join('\n')

/** 字里的 ①② 换成脚注引用（编号接着这一段前面几问往后数）；字里没有的那几块，引用接在最后 */
function withRefs(q: string, count: number, base: number, tag: string): string {
  const seen = new Set<number>()
  let out = ''
  for (const ch of q) {
    const n = MARKS.indexOf(ch) + 1
    if (n && n <= count) {
      out += `[^${tag}-${base + n}]`
      seen.add(n)
    } else out += ch
  }
  for (let n = 1; n <= count; n++) if (!seen.has(n)) out += `[^${tag}-${base + n}]`
  return out
}

/**
 * 回答里的标题降到 ### 以下（这一段自己是 ##，回答里的 # 、## 会把这一段切开）；代码块里的不动。
 * 最浅的一级降到 ###，别的跟着降，最深 ######
 */
export function demoteHeadings(md: string): string {
  const lines = md.split('\n')
  let fence = false
  let min = 7
  const heads: number[] = []
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    else if (!fence) {
      const h = /^(#{1,6})\s/.exec(l)
      if (h) {
        heads.push(i)
        min = Math.min(min, h[1]!.length)
      }
    }
  })
  if (min >= 3) return md
  const by = 3 - min
  for (const i of heads) lines[i] = lines[i]!.replace(/^(#{1,6})/, (h) => '#'.repeat(Math.min(6, h.length + by)))
  return lines.join('\n')
}

/** 回答原文的开头一段（送 Anki 的背面、我的疑惑那一行）：跳过标题，取第一段（列表、公式块也算一段） */
export function answerLead(md: string): string {
  for (const block of md.trim().split(/\n\s*\n/)) {
    const rest = block
      .split('\n')
      .filter((l) => !/^#{1,6}\s/.test(l))
      .join('\n')
      .trim()
    if (rest) return rest
  }
  return ''
}

/** 新格式的一段：旧字段从一问一答算出来（给还没换的地方用：白板的问答卡、梦游、我的疑惑的旧数法） */
export function withDerived(s: AskSection): AskSection {
  if (!s.qas) return s
  const turns = s.qas.flatMap((qa) => [qa, ...qa.sides.flatMap((d) => d.turns)])
  return { ...s, doubts: turns.map((t) => t.q), good: answerLead(s.qas[0]?.a ?? ''), points: [], failed: [], rounds: turns.length }
}

/** 一问的提示块头：「> [!question] 第一行」，后面几行接着「> 」 */
function calloutHead(kind: 'question' | 'side', q: string): string[] {
  const [first = '', ...rest] = q.split('\n')
  return [`> [!${kind}] ${first}`, ...rest.map((l) => `> ${l}`)]
}

function renderDoc(s: AskSection, note: string): string {
  const out: string[] = []
  out.push(`## ${s.page > 0 ? `第 ${s.page} 页 · ` : ''}${oneLine(s.title) || '没起标题'}`)
  const back = s.web
    ? `[${alt(s.web.label) || '网页'}](${/^https?:/i.test(s.web.url) ? s.web.url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) : linkFrom(note, s.web.url)})`
    : `[第 ${s.page} 页](${anchorFrom(note, s.file, s.page, s.rect)})`
  out.push(`${back}${s.time ? ` · ${s.time}` : ''} <!-- cn:thread=${threadName(s.id)} -->`)
  const imgs: string[] = []
  if (s.crop) imgs.push(`![${cropCaption(s)}${s.cropW ? `|${Math.round(s.cropW)}` : ''}](${linkFrom(note, s.crop)})`)
  if (s.cropTr) imgs.push(`![${CROP_TR}${s.cropW ? `|${Math.round(s.cropW)}` : ''}](${linkFrom(note, s.cropTr)})`)
  for (const f of s.figures) imgs.push(`![${alt(f.caption) || '图'}](${linkFrom(note, f.path)})`)
  if (imgs.length) out.push('', imgs.join('\n\n'))
  if (s.quote?.trim()) out.push('', quote(s.quote))
  const tag = footTag(s.id)
  const defs: string[] = []
  /** 这一问的问题（字里的编号换成脚注引用），脚注的定义收到这一段末尾 */
  const ask = (t: AskTurn): string => {
    const mats = t.mats ?? []
    const q = withRefs(cleanQuestion(t.q), mats.length, defs.length, tag)
    for (const m of mats) {
      const label = `[^${tag}-${defs.length + 1}]: `
      defs.push(label + (m.kind === 'quote' ? `「${oneLine(m.text)}」 ${oneLine(m.src)}` : `![${alt(m.src) || '图'}|180](${linkFrom(note, m.path)})`))
    }
    return q
  }
  for (const qa of s.qas ?? []) {
    out.push('', calloutHead('question', ask(qa)).join('\n'))
    if (qa.a.trim()) out.push('', qa.a.trim())
    for (const side of qa.sides) {
      side.turns.forEach((t, i) => {
        const lines = calloutHead('side', ask(t))
        if (i === 0) lines.push(`> > ${oneLine(side.quote)}`)
        if (t.a.trim()) lines.push('>', quote(t.a))
        out.push('', lines.join('\n'))
      })
    }
  }
  if (s.recap?.trim()) out.push('', `> [!recap] ${oneLine(s.recap)}`)
  if (defs.length) out.push('', defs.join('\n'))
  const embed = vizEmbedLine(s, note)
  if (embed) out.push('', embed)
  const foot = [...vizLink(s, note), ...s.links.map((l) => `[[${oneLine(l)}]]`)]
  if (foot.length) out.push('', foot.join(' · '))
  return out.join('\n') + '\n'
}

const FOOT_DEF = /^\[\^([^\]\s]+)\]:\s?(.*)$/
const FOOT_LINE = /^(?:\[可视化 · [^\]]*\]\([^)]+\)|\[\[[^\]]+\]\])(?:\s*·\s*(?:\[可视化 · [^\]]*\]\([^)]+\)|\[\[[^\]]+\]\]))*\s*$/
const STRUCT = /^>\s*\[!(question|side|recap)\]\s?(.*)$/
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/

/** 一段的头几行：第二行（去掉行尾的身份注释）是回到 PDF 的链接，或网页、HTML 的链接 */
function readBack(s: AskSection, line: string, pageInHead: boolean, note: string) {
  const a0 = /^\[第\s*\d+\s*页\]\(([^)]+)\)(?:\s*·\s*(\d{1,2}:\d{2}))?\s*$/.exec(line)
  if (a0) {
    const a = parsePdfAnchor(a0[1]!)
    if (a) {
      s.file = linkTo(note, encodePath(a.file))
      s.page = a.page
      if (a.rect) s.rect = a.rect
    }
    if (a0[2]) s.time = a0[2]
    return
  }
  const w = /^\[([^\]]*)\]\(((?:https?:[^)\s]+)|[^)\s]*\.html?)\)(?:\s*·\s*(\d{1,2}:\d{2}))?\s*$/i.exec(line)
  if (!w) return
  s.web = { label: w[1]!, url: /^https?:/i.test(w[2]!) ? w[2]!.replace(/%2[089]/gi, (c) => decodeURIComponent(c)) : linkTo(note, w[2]!) }
  const vt = /^▶ (?:(\d+):)?(\d+):(\d{2}) · /.exec(w[1]!)
  if (vt) s.web.t = Number(vt[1] ?? 0) * 3600 + Number(vt[2]) * 60 + Number(vt[3])
  if (!pageInHead) s.page = 0
  if (w[3]) s.time = w[3]
}

/** 一串行去掉头尾的空行 */
const trimLines = (ls: string[]) => ls.join('\n').replace(/^\s*\n/, '').trim()

function parseDoc(lines: string[], head: RegExpExecArray, note: string): AskSection {
  const id = THREAD_NOTE.exec(lines[1]!)!
  const s: AskSection = { id: threadId(id[1]!), file: '', page: Number(head[1] ?? 1), title: head[2]!.trim(), figures: [], doubts: [], good: '', points: [], failed: [], rounds: 0, links: [], qas: [], recap: '' }
  readBack(s, lines[1]!.replace(THREAD_NOTE, ''), !!head[1], note)
  const qas = s.qas!
  const defs = new Map<string, AskMat>()
  let recap: string | null = null
  const tail: string[] = []
  let cur: AskQa | null = null
  let ans: string[] | null = null
  let fence = false
  /** 第一问之前的引用块：选字问的原文 */
  const said: string[] = []
  const flush = () => {
    if (cur && ans) cur.a = trimLines(ans)
    ans = null
  }
  let i = 2
  while (i < lines.length) {
    const l = lines[i]!
    if (recap !== null) {
      tail.push(l)
      i++
      continue
    }
    if (ans && /^\s*(```|~~~)/.test(l)) fence = !fence
    const c = fence ? null : STRUCT.exec(l)
    if (!c) {
      if (ans) ans.push(l)
      else if (!cur && /^>/.test(l)) said.push(l.replace(/^>\s?/, ''))
      else if (!cur) {
        // 第一问之前：我框的图（写着宽度）、配的图
        const im = IMAGE_LINE.exec(l)
        if (im) {
          const [, cap = '', w] = /^(.*?)(?:\|(\d+))?$/.exec(im[1]!)!
          const path = linkTo(note, im[2]!)
          if ((cap === '我框的' || cap === WHOLE_PAGE) && !s.crop) {
            s.crop = path
            if (w) s.cropW = Number(w)
          } else if (cap === CROP_TR && !s.crop) {
            s.crop = path
            s.cropSide = 'tr'
            if (w) s.cropW = Number(w)
          } else if (cap === CROP_TR && !s.cropTr && !s.cropSide) s.cropTr = path
          else s.figures.push({ path, caption: im[1]! })
        }
      }
      i++
      continue
    }
    flush()
    const body: string[] = []
    i++
    while (i < lines.length && /^>/.test(lines[i]!)) body.push(lines[i++]!)
    if (c[1] === 'question') {
      cur = { q: [c[2]!.trim(), ...body.map((b) => b.replace(/^>\s?/, '').trim())].filter(Boolean).join('\n'), a: '', sides: [] }
      qas.push(cur)
      ans = []
    } else if (c[1] === 'side') {
      const q = [c[2]!.trim()]
      const quoteLines: string[] = []
      const a: string[] = []
      let sep = false
      for (const b of body) {
        if (sep) a.push(b.replace(/^>\s?/, ''))
        else if (/^>\s*$/.test(b)) sep = true
        else {
          const qq = /^>\s?>\s?(.*)$/.exec(b)
          if (qq) quoteLines.push(qq[1]!)
          else q.push(b.replace(/^>\s?/, '').trim())
        }
      }
      const turn: AskTurn = { q: q.filter(Boolean).join('\n'), a: trimLines(a) }
      if (!cur) {
        cur = { q: '', a: '', sides: [] }
        qas.push(cur)
      }
      const last = cur.sides[cur.sides.length - 1]
      if (quoteLines.length || !last) cur.sides.push({ quote: quoteLines.join(' ').trim(), turns: [turn] })
      else last.turns.push(turn)
    } else recap = [c[2]!, ...body.map((b) => b.replace(/^>\s?/, ''))].join(' ').trim()
  }
  flush()
  if (said.join('').trim()) s.quote = said.join('\n').trim()
  // 小结后面：脚注的定义、最后一行可视化和双链（没有小结时从最后一个回答的末尾剥下来）
  let rest = tail
  if (recap === null && cur) {
    const own = (cur as AskQa).a.split('\n')
    let k = own.length
    while (k > 0 && (!own[k - 1]!.trim() || FOOT_DEF.test(own[k - 1]!) || FOOT_LINE.test(own[k - 1]!) || VIZ_EMBED.test(own[k - 1]!))) k--
    rest = own.slice(k)
    ;(cur as AskQa).a = trimLines(own.slice(0, k))
  }
  for (const l of rest) {
    const d = FOOT_DEF.exec(l)
    if (d) {
      const body = d[2]!.trim()
      const im = /^!\[([^\]]*?)(?:\|\d+)?\]\(([^)]+)\)$/.exec(body)
      const qt = /^「(.*)」\s(.*)$/.exec(body)
      if (im) defs.set(d[1]!, { kind: 'image', path: linkTo(note, im[2]!), src: im[1]! })
      else if (qt) defs.set(d[1]!, { kind: 'quote', text: qt[1]!, src: qt[2]!.trim() })
      continue
    }
    const em = VIZ_EMBED.exec(l)
    if (em) s.viz = { title: em[1]!, path: linkTo(note, em[2]!), embed: true }
    else if (FOOT_LINE.test(l)) {
      for (const m of l.matchAll(/\[\[([^\]]+)\]\]/g)) s.links.push(m[1]!)
      const v = /\[可视化 · ([^\]]*)\]\(([^)]+)\)/.exec(l)
      if (v) s.viz = { title: v[1]!, path: linkTo(note, v[2]!) }
    }
  }
  // 问题里的脚注引用换回 ①②，那几块材料按编号排回这一问
  const unref = (t: AskTurn) => {
    const labels = [...new Set([...t.q.matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => m[1]!).filter((l) => defs.has(l)))]
    if (!labels.length) return
    const num = (l: string) => Number(/-(\d+)$/.exec(l)?.[1] ?? 0)
    labels.sort((a, b) => num(a) - num(b))
    t.q = t.q.replace(/\[\^([^\]\s]+)\]/g, (m, l: string) => (labels.includes(l) ? MARKS[labels.indexOf(l)]! : m))
    t.mats = labels.map((l) => defs.get(l)!)
  }
  for (const qa of qas) {
    unref(qa)
    for (const d of qa.sides) d.turns.forEach(unref)
  }
  s.recap = recap ?? ''
  return withDerived(s)
}

function decode(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

interface Chunk {
  from: number
  to: number
  /** 旧写法的一段（cn:thread、完整对话链接那种） */
  section: AskSection | null
  /** 新写法（ai-note.ts）的一节里 AI 记的问，按那一处收成的几段 */
  asks: AskSection[]
}

/** 按「## 」切成块（代码块里的不算）；第一块之前是开头（属性、一级标题） */
function chunks(md: string, note: string): { head: string; list: Chunk[] } {
  const starts: number[] = []
  let fence = false
  let pos = 0
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && /^##\s/.test(line)) starts.push(pos)
    pos += line.length + 1
  }
  const list = starts.map((from, k) => {
    const to = starts[k + 1] ?? md.length
    const section = parseSection(md.slice(from, to), note)
    return { from, to, section, asks: section ? [] : askSectionsOf(md.slice(from, to), note) }
  })
  return { head: md.slice(0, starts[0] ?? md.length), list }
}

/** 笔记里 AI 记的每一处：旧写法一段一处；新写法（ai-note.ts）一节里按那一处收（同一处的几问在别的节里也有时各算各的） */
export function parseReadingNote(md: string, note: string): AskSection[] {
  return chunks(md, note).list.flatMap((c) => (c.section ? [c.section] : c.asks))
}

/**
 * 写进一段：同一个完整对话的那段整段换掉；新的一段按页码插（排在页码更大的第一段前面），
 * 用户自己写的段落、开头的属性原样不动。
 */
export function upsertSection(md: string, s: AskSection, note: string): string {
  // 新写法（ai-note.ts）只往后加、撤回拿掉一问，不整段重写（用户在笔记里改的字不被冲掉）
  if (s.doc) throw new Error('新写法的一处不能整段换：加问用 appendAsk')
  const text = renderSection(s, note)
  const { list } = chunks(md, note)
  const same = list.find((c) => c.section?.id === s.id)
  if (same) return md.slice(0, same.from) + text + sep(md.slice(same.to)) + md.slice(same.to)
  const after = list.find((c) => c.section && c.section.page > s.page)
  if (after) return md.slice(0, after.from) + text + '\n' + md.slice(after.from)
  const body = md.replace(/\n*$/, '\n')
  return body + '\n' + text
}

/** 笔记里一段没有「我框的」图（task-yp8l7 补截图）：PDF、页、框的位置（有的话）、是不是以前的格式 */
export interface CropGap {
  id: string
  file: string
  page: number
  rect?: Rect
  /** 以前的格式（完整对话链接那种）：图不写宽度 */
  old: boolean
}

/** 笔记里哪几段在 PDF 上问过、却没有「我框的」「整页」那张图（网页、视频上问的不算；写着选字问原文的是选字问，本来就不截图） */
export function cropGaps(md: string, note: string): CropGap[] {
  return chunks(md, note).list.flatMap(({ section: s }) =>
    s && !s.crop && !s.quote && !s.web && s.file && s.page > 0 ? [{ id: s.id, file: s.file, page: s.page, ...(s.rect ? { rect: s.rect } : {}), old: !s.qas }] : [],
  )
}

/**
 * 给一段补上「我框的」图（task-yp8l7）：只在这一段第二行（回到 PDF 的那一行）后面插一行图，别的字一个不动。
 * w：框在 PDF 上 100% 时的宽（新格式写进说明，以前的格式不写）。找不到这一段、这一段已经有图时原样返回
 */
export function insertCrop(md: string, note: string, id: string, crop: string, w?: number): string {
  const c = chunks(md, note).list.find((x) => x.section?.id === id)
  if (!c || c.section!.crop) return md
  const first = md.indexOf('\n', c.from)
  if (first < 0 || first >= c.to) return md
  let end = md.indexOf('\n', first + 1)
  if (end < 0 || end > c.to) end = c.to
  const width = w && c.section!.qas ? `|${Math.round(w)}` : ''
  // 下一行紧跟着字（不是空行）时图后面再空一行，图自成一段
  const gap = md[end] === '\n' && end + 1 < c.to && md[end + 1] !== '\n' ? '\n' : ''
  return md.slice(0, end) + `\n\n![我框的${width}](${linkFrom(note, crop)})${gap}` + md.slice(end)
}

/** 换掉的段后面紧跟下一段时补一个空行 */
const sep = (rest: string) => (rest && !rest.startsWith('\n') ? '\n' : '')

/** 「以前的版本」：同一处的另一版放在这一段后面（标题换掉、身份去掉，读回来是用户自己的段落，不会被当成第二段） */
function oldVersion(chunk: string, s: AskSection): string {
  const lines = chunk.replace(/\n+$/, '').split('\n').slice(1)
  const body = lines.map((l) => l.replace(THREAD_NOTE, '').replace(/\[完整对话[^\]]*\]\([^)]*\)(\s*·\s*)?/, ''))
  return [`## 以前的版本 · ${s.page > 0 ? `第 ${s.page} 页 · ` : ''}${oneLine(s.title) || '没起标题'}`, ...body].join('\n') + '\n'
}

/**
 * 同一份 PDF 的两篇笔记合成一篇（老库整理，2026-11-20「一个 PDF 一篇笔记」）：other 的每一段按身份合进 primary、按页排；
 * 同一处两边都有时留问得多的那段（一样多留 primary 的），另一版收进这一段后面的「以前的版本」；
 * other 里自己写的段落（开头那几段、自己起的 ## 小节）原样搬到最后「从《other 的名字》并进来的」下面（小节降一级）。
 * 两篇在同一个文件夹，相对链接不用改
 */
export function mergeReadingNotes(primary: string, other: string, note: string, otherNote: string): string {
  const { head, list } = chunks(other, otherNote)
  const user: string[] = []
  // 开头：属性和「# … 笔记」那一行以外是自己写的
  const own = head
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split('\n')
    .filter((l) => !/^#\s/.test(l))
    .join('\n')
    .trim()
  if (own) user.push(own)
  let md = primary
  for (const c of list) {
    const raw = other.slice(c.from, c.to).replace(/\n+$/, '\n')
    if (!c.section) {
      user.push(raw.replace(/^##\s/, '### ').trim())
      continue
    }
    const mine = chunks(md, note).list
    const same = mine.find((m) => m.section?.id === c.section!.id)
    if (!same) {
      const after = mine.find((m) => m.section && m.section.page > c.section!.page)
      md = after ? md.slice(0, after.from) + raw + '\n' + md.slice(after.from) : md.replace(/\n*$/, '\n') + '\n' + raw
      continue
    }
    const cur = md.slice(same.from, same.to).replace(/\n+$/, '\n')
    if (cur.trim() === raw.trim()) continue
    const theirs = c.section.rounds > same.section!.rounds
    const keep = theirs ? raw : cur
    const older = oldVersion(theirs ? cur : raw, theirs ? same.section! : c.section)
    const rest = md.slice(same.to)
    md = md.slice(0, same.from) + keep + '\n' + older + sep(rest) + rest
  }
  if (user.length) md = md.replace(/\n*$/, '\n') + `\n## 从《${stem(otherNote)}》并进来的\n\n` + user.join('\n\n') + '\n'
  return md
}

// ---------------------------------------------------------------- 完整对话

export interface ConvoTurn {
  role: 'user' | 'ai'
  text: string
  time?: string
  image?: string
}

/** 完整对话存成 md（convo = .canvas-notes/对话/… 它自己的路径），从笔记里点得开 */
export function conversationMd(convo: string, pdf: string, page: number, rect: Rect | undefined, turns: ConvoTurn[]): string {
  const out = [`# ${stem(pdf)} · 第 ${page} 页 · 完整对话`, '', `[回到第 ${page} 页](${anchorFrom(convo, pdf, page, rect)})`]
  for (const t of turns) {
    out.push('', `### ${t.role === 'user' ? '我' : 'AI'}${t.time ? ` · ${t.time}` : ''}`, '')
    if (t.image) out.push(`![${rect ? '我框的' : WHOLE_PAGE}](${linkFrom(convo, t.image)})`, '')
    out.push(t.text.trim())
  }
  return out.join('\n') + '\n'
}
