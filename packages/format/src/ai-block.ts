/**
 * AI 往文档里新加的内容一律包成 `[!ai]` 块（task-dtc34，用户：「AI写的东西…有一个框，上面有一个AI标志」）：
 *
 *   > [!ai] AI 写的 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=…&msg=12)
 *   > AI 写的那几段……
 *
 * - 头一行：「AI 写的」· 哪家 · 哪个模型 · 链回那段 AI 对话（有的时候）；用户自己补标的写「AI 写的 · 补标」，不编是哪家；
 *   用户在块里改过字，头上多一个「改过」（放在链接前面）。
 * - 包的规矩（wrapNewBlocks、wrapRange 共用 wrappable）：段落、列表、引用包进去；标题留在块外面（大纲、#标题 链接照常认），
 *   代码块、表格、公式块、图、HTML、注释、属性也留在外面（提示块里编辑器画不出它们）。连着几块包成一个。
 * - 比的是「块」（blocks.ts 的 findBlocks）：AI 改了原有的一段（和删掉的那段像）不包，那是「改」；只有纯新增的整块才包。
 * - AI 对话里一条回答「插进文档」（task-83vl3）也是这一块，头一个词是「AI 回答」（label）。
 * - 头一行、块的写法都走 ai-callout.ts 的 aiCalloutHead / aiCallout（AI 讲解、网页讲解、AI 总结共用的那一套），这里只多了链接和补标。
 * 纯函数，主进程（这一轮结束补包）、界面（插进文档、右键「标成 AI 写的」「变成我的字」）、单元测试共用。
 */
import { findBlocks, type MdBlock } from './blocks'
import { fmValue, hasOldLayout } from './board'
import { aiCallout, aiCalloutHead, calloutWords } from './ai-callout'
import { isMindmap } from './mindmap'

export interface AiWrote {
  /** 头一个词：默认「AI 写的」；AI 对话的回答插进文档是「AI 回答」（calloutWords().answer） */
  label?: string
  /** 「Claude Code · Opus 5.5」 */
  by?: string
  /** 链回那段 AI 对话（chatLink） */
  link?: string
  /** 用户自己补标的（「标成 AI 写的」） */
  marked?: boolean
}

const linkEnc = (s: string) => encodeURIComponent(s).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * 链回一段 AI 对话的那一条：哪段对话（地方的 key）、哪条回答；括号也转掉，写在 md 链接 (…) 里不断。
 * th：读 PDF / 网页 / 视频时那一处的名字（AI 对话写进笔记的新写法，ai-note.ts：同一处的几问归成一处）
 */
export const chatLink = (key: string, msg: number, th?: string) => `canvas-notes://chat?key=${linkEnc(key)}&msg=${msg}${th ? `&th=${linkEnc(th)}` : ''}`

/** 认链回对话的链接（文档里点了「回到 AI 对话」）；不是就是 null */
export function parseChatLink(url: string): { key: string; msg: number; th?: string } | null {
  const m = /^canvas-notes:\/\/chat\?key=([^&\s]+)&msg=(\d+)(?:&th=([^&\s]+))?$/.exec(url)
  if (!m) return null
  try {
    return { key: decodeURIComponent(m[1]!), msg: Number(m[2]), ...(m[3] ? { th: decodeURIComponent(m[3]) } : {}) }
  } catch {
    return null
  }
}

/** 头上的链接、补标：交给 aiCalloutHead 的那几截 */
function headParts(h: AiWrote) {
  const w = calloutWords()
  return { label: h.label ?? w.wrote, ...(h.marked ? { by: w.marked } : h.by ? { by: h.by } : {}), ...(h.link ? { seen: `[${w.backToChat}](${h.link})` } : {}) }
}

/** 头一行「> [!ai] 」后面那一截 */
export function aiWroteHead(h: AiWrote): string {
  return aiCalloutHead(headParts(h))
}

/** 一段 md 包成 [!ai] 块（不带结尾换行）；空行写成「>」，原来的引用多套一层 */
export function aiBlock(text: string, h: AiWrote): string {
  return aiCallout({ ...headParts(h), text: text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '') })
}

const AI_HEAD = /^ {0,3}>[ \t]*\[!ai\][+-]?/i
/** 这一行是 [!ai] 块的头 */
export const isAiHead = (line: string) => AI_HEAD.test(line)

/** 头上加「改过」（已经有了不加）：放在「回到对话」链接前面 */
export function markEdited(head: string): string {
  const m = /^( {0,3}>[ \t]*\[!ai\][+-]?[ \t]*)(.*)$/i.exec(head)
  if (!m) return head
  if (isEdited(m[2]!)) return head
  const parts = m[2]!.split(' · ')
  const w = calloutWords()
  const link = parts.findIndex((p, i) => i > 0 && /^\[[^\]]*\]\([^)]*\)$/.test(p.trim()))
  if (link > 0) parts.splice(link, 0, w.edited)
  else parts.push(w.edited)
  return m[1]! + parts.filter((p) => p.trim()).join(' · ')
}

/** 头上写着「改过」 */
export const isEdited = (head: string) => head.split(' · ').some((p) => /^(改过|edited)$/.test(p.trim()))

/** [!ai] 块（头一行 + 正文几行）去掉框：正文每行去掉一层「> 」，变回普通的字 */
export function unwrapAiBlock(block: string): string {
  const lines = block.split('\n')
  if (!isAiHead(lines[0] ?? '')) return block
  return lines
    .slice(1)
    .map((l) => l.replace(/^ {0,3}> ?/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * 全文里 pos 所在的那一块 [!ai]（头一行到最后一行「>」，不含后面的换行）；不在 [!ai] 块里是 null。
 * 认法同编辑器：顶层的引用块（findBlocks 的 quote），头一行是 `> [!ai]`
 */
export function aiBlockAt(text: string, pos: number): { from: number; to: number } | null {
  for (const b of findBlocks(text)) {
    if (b.from > pos) break
    if (b.kind === 'quote' && pos <= b.to && isAiHead(text.slice(b.from, lineEnd(text, b.from)))) return { from: b.from, to: b.to }
  }
  return null
}

const lineEnd = (t: string, at: number) => {
  const n = t.indexOf('\n', at)
  return n < 0 ? t.length : n
}

/** 这一块能包进 [!ai] 块：段落、列表、引用（已经是提示块的不算） */
function wrappable(text: string, b: MdBlock): boolean {
  if (b.kind === 'paragraph' || b.kind === 'list') {
    const s = text.slice(b.from, b.to)
    // 单独成行的公式块（$$ … $$）、只有一张嵌入的图（![[…]]）留在外面
    return !/^\s*(\$\$|\\\[)/.test(s) && !/^\s*!\[\[[^\]]*\]\]\s*$/.test(s)
  }
  if (b.kind === 'quote') return !/^ {0,3}>[ \t]*\[![A-Za-z]/.test(text.slice(b.from, lineEnd(text, b.from)))
  return false
}

/**
 * 把 picked 里的块（下标，按顺序）包成 [!ai] 块：连着的（中间只隔空行）包成一个，标题、代码这些不能包的断开。
 * 白板（type: board）上空行隔开的每一段是一张卡：一段一个块（连着几段包成一个就并成了一张卡），只有同一串列表的几项还在一起
 */
function wrapPicked(text: string, blocks: MdBlock[], picked: Set<number>, h: AiWrote, board = isBoardDoc(text)): { text: string; wrapped: number } {
  const runs: [number, number][] = []
  for (let i = 0; i < blocks.length; i++) {
    if (!picked.has(i) || !wrappable(text, blocks[i]!)) continue
    const last = runs[runs.length - 1]
    const joins = !board || (blocks[i - 1]?.kind === 'list' && blocks[i]!.kind === 'list')
    if (last && last[1] === i - 1 && joins) last[1] = i
    else runs.push([i, i])
  }
  let out = text
  for (const [a, b] of runs.reverse()) {
    let from = blocks[a]!.from
    const to = blocks[b]!.to
    // 打头的位置行留在框外面（白板看法认它管后面那一块）
    while (from < to && LAYOUT.test(out.slice(from, lineEnd(out, from)))) from = lineEnd(out, from) + 1
    out = out.slice(0, from) + aiBlock(out.slice(from, to), h) + out.slice(to)
  }
  return { text: out, wrapped: runs.length }
}

/** 白板看法的位置行、编号行（`<!-- card id=… x=… -->`、`<!-- column … -->`）：和后面那块算一块，包的时候留在框外面 */
const LAYOUT = /^ {0,3}<!--\s*(?:card|column)\s[^\n]*-->[ \t]*$/

/** 比块用的：行尾空白去掉，位置行不算（白板上挪了位置、排整齐的不算改了字） */
const keyOf = (text: string, b: MdBlock) =>
  text
    .slice(b.from, b.to)
    .split('\n')
    .filter((l) => !LAYOUT.test(l))
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')

/** 这一组块的文字（一行或几行能是自己算出来的 key）：给调用的人算「这一轮里用户自己打的」那几块 */
export function blockKeys(text: string): Set<string> {
  return new Set(findBlocks(text).map((b) => keyOf(text, b)))
}

/** 两块像不像（0–1）：去掉记号、空白后两个字一组比（Dice）；一块整个含在另一块里算像 */
function alike(a: string, b: string): number {
  const norm = (s: string) => s.replace(/[\s>#*_`\-|[\]()!~]+/g, '')
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return x === y ? 1 : 0
  if (x.includes(y) || y.includes(x)) return 1
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const gx = grams(x)
  const gy = grams(y)
  let both = 0
  for (const [g, n] of gx) both += Math.min(n, gy.get(g) ?? 0)
  const total = Math.max(1, x.length - 1 + (y.length - 1))
  return (2 * both) / total
}

/** 删掉的和加的块数不一样时：改过的那一段和删掉的那段至少这么像，才算「改」不算「加」（短句改几个字也有 0.4 上下） */
const ALIKE = 0.25
/** 两边块数乘起来超过这么多就不逐块对齐了，只看新的块在不在原来的里面 */
const LCS_MAX = 4_000_000

/** after 里哪些块是 before 没有的（对齐以后没对上的）；和删掉的那几块像的算改过，不算新加的 */
function addedBlocks(before: string, after: string, A: MdBlock[], B: MdBlock[], skip?: (key: string) => boolean): Set<number> {
  const ka = A.map((b) => keyOf(before, b))
  const kb = B.map((b) => keyOf(after, b))
  const matched = new Array<number>(B.length).fill(-1)
  let p = 0
  while (p < ka.length && p < kb.length && ka[p] === kb[p]) (matched[p] = p), p++
  let sa = ka.length
  let sb = kb.length
  while (sa > p && sb > p && ka[sa - 1] === kb[sb - 1]) (matched[sb - 1] = sa - 1), sa--, sb--
  const n = sa - p
  const m = sb - p
  if (n * m > LCS_MAX) {
    const have = new Map<string, number>()
    for (let i = p; i < sa; i++) have.set(ka[i]!, (have.get(ka[i]!) ?? 0) + 1)
    for (let j = p; j < sb; j++) {
      const c = have.get(kb[j]!) ?? 0
      if (c > 0) (have.set(kb[j]!, c - 1), (matched[j] = -2))
    }
  } else if (n && m) {
    // 中间那一截逐块对齐（最长公共子序列）
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i]![j] = ka[p + i] === kb[p + j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ka[p + i] === kb[p + j]) (matched[p + j] = p + i), i++, j++
      else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
      else j++
    }
  }
  // 没对上的按「空隙」分组：同一个空隙里删掉的块和加的块配对，像的是改过的
  const usedA = new Set<number>(matched.filter((x) => x >= 0))
  /** 没对上的删掉的块：一字不差的又出现在别处是挪了位置（白板上挪卡、文档里挪块），不算新加的 */
  const goneKeys = new Map<string, number>()
  for (let i = 0; i < ka.length; i++) if (!usedA.has(i)) goneKeys.set(ka[i]!, (goneKeys.get(ka[i]!) ?? 0) + 1)
  const out = new Set<number>()
  let j = 0
  let prevA = -1
  while (j < B.length) {
    if (matched[j] !== -1) {
      if (matched[j]! >= 0) prevA = matched[j]!
      j++
      continue
    }
    let k = j
    while (k < B.length && matched[k] === -1) k++
    const nextA = k < B.length && matched[k]! >= 0 ? matched[k]! : ka.length
    const gone = []
    for (let i = prevA + 1; i < nextA; i++) if (!usedA.has(i)) gone.push(i)
    const fresh: number[] = []
    for (let x = j; x < k; x++) {
      const moved = goneKeys.get(kb[x]!) ?? 0
      if (moved > 0) goneKeys.set(kb[x]!, moved - 1)
      else if (!skip?.(kb[x]!)) fresh.push(x)
    }
    // 删掉的一块配一块改过的：一样多时一对一（原地改了几段）；不一样多时按像不像，最像的先配，太不像的不配
    const changed = new Set<number>()
    if (gone.length === fresh.length) for (const x of fresh) changed.add(x)
    else {
      const pairs = gone.flatMap((i) => fresh.map((x) => ({ i, x, s: alike(ka[i]!, kb[x]!) }))).filter((p) => p.s >= ALIKE)
      pairs.sort((a, b) => b.s - a.s || a.x - b.x)
      const used = new Set<number>()
      for (const p of pairs) if (!used.has(p.i) && !changed.has(p.x)) (used.add(p.i), changed.add(p.x))
    }
    for (const x of fresh) if (!changed.has(x)) out.add(x)
    j = k
  }
  return out
}

/**
 * AI 这一轮改完的一篇（before 是这一轮开始时的样子）：纯新增、没包进 [!ai] 块的整块包上；改了原有字的、标题、代码这些不包。
 * 新建的整篇（before 是空的）、旧写法的白板、导图不包；白板（type: board）上一段一张卡，一段一个块，不并成一张（wrapPicked）；挪了位置的块不包；skip(key)：这一块是用户自己这一轮里打的（blockKeys 算的 key），不包。
 * 没有要包的原样返回（同一个字符串）
 */
export function wrapNewBlocks(before: string, after: string, h: AiWrote, skip?: (key: string) => boolean): { text: string; wrapped: number } {
  if (!before.trim() || before === after || hasOldLayout(after) || isMindmap(after)) return { text: after, wrapped: 0 }
  const B = findBlocks(after)
  const added = addedBlocks(before, after, findBlocks(before), B, skip)
  if (!added.size) return { text: after, wrapped: 0 }
  return wrapPicked(after, B, added, h)
}

/** 默认用白板看法打开的那种（`type: board`）：一块一张卡 */
export const isBoardDoc = (text: string) => fmValue(text, 'type') === 'board'

/** 一段要插进文档的 md（AI 写的一段）：能包的都包上（标题、代码这些留在外面），已经是 [!ai] 块的不动；board：插进白板（一段一张卡，一段一个块） */
export function wrapInsert(md: string, h: AiWrote, board = false): string {
  const B = findBlocks(md)
  return wrapPicked(md, B, new Set(B.map((_, i) => i)), h, board).text
}

/**
 * 「标成 AI 写的」：from–to 碰到的几块包成一个「AI 写的 · 补标」块（标题、代码这些留在外面，已经是提示块的不动）。
 * 一块都没包上时 text 原样
 */
export function wrapRange(text: string, from: number, to: number, h: AiWrote = { marked: true }): { text: string; wrapped: number } {
  const B = findBlocks(text)
  const picked = new Set<number>()
  B.forEach((b, i) => {
    if (b.to >= from && (b.from < to || (from === to && b.from <= to))) picked.add(i)
  })
  return wrapPicked(text, B, picked, h)
}
