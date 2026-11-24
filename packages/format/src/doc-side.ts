/**
 * 文档里 AI 写的一块（`> [!ai]` 提示块：视频框一块问的讲解、AI 回答插进文档的、AI 命令写的）上开的旁支
 * （task-4edsc，用户选的方向 A「就地展开」）。旁支跟着主线存：写进这篇文档，挂在这块讲解下面，和读 PDF 笔记一个写法：
 *
 *   > [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧
 *   > 回答……
 *
 *   > [!side] 问题
 *   > > 那一句
 *   >
 *   > 回答原文
 *
 *   > [!side] 同一条旁支接着问的（不带那一句）
 *   >
 *   > 回答
 *
 * 带「> > 那一句」的一块开一条新旁支，不带的是上一条接着问的；接着问的写在那条旁支最后一块后面，所以一条旁支的几块总是挨着。
 * 那一句照原文存（去掉行首的「> 」、空白并成一个），找的时候也照原文比，记号（加粗、链接）不影响找得到。
 * 文档里这几行藏起来，只在那一句后面露一个小标（编辑器那一半在 apps/notes/src/renderer/side/doc-side.ts）。不依赖 Electron。
 */

export interface DocSideTurn {
  q: string
  a: string
}

export interface DocSide {
  /** 选中的那一句（原文，空白并成一个） */
  quote: string
  turns: DocSideTurn[]
  /** 这条旁支第一块的头一行（「> [!side]」那一行，从 0 数） */
  first: number
  /** 这条旁支最后一块的最后一行（从 0 数）：接着问的写在它后面 */
  last: number
}

export interface DocAiBlock {
  /** `> [!ai]` 那一行（从 0 数） */
  head: number
  /** 提示块最后一行 */
  end: number
  /** 正文的段：每段第一行、最后一行（空的「>」行隔开） */
  paras: { from: number; to: number }[]
  sides: DocSide[]
  /** 挂着的旁支占的行：提示块后面那个空行，到最后一块旁支的最后一行；没有旁支是 null */
  tail: { from: number; to: number } | null
}

const AI_HEAD = /^\s*>\s*\[!ai\][+-]?(?:[ \t]|$)/i
const SIDE_HEAD = /^\s*>\s*\[!side\][ \t]?(.*)$/i
const QUOTED = /^\s*>/
const EMPTY_QUOTE = /^\s*>\s*$/
const FENCE = /^\s*(```|~~~)/

/** 空白并成一个、去掉头尾（存那一句、找那一句都这样比） */
export const foldQuote = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 一行去掉行首的「> 」 */
const unquote = (l: string) => l.replace(/^\s*>\s?/, '')

/** 找出整篇里 AI 写的那几块和挂在下面的旁支（代码块里的不算） */
export function docAiBlocks(text: string): DocAiBlock[] {
  const lines = text.split('\n')
  const out: DocAiBlock[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (FENCE.test(l)) {
      fence = !fence
      continue
    }
    if (fence || !AI_HEAD.test(l) || (i > 0 && QUOTED.test(lines[i - 1]!))) continue
    let end = i
    while (end + 1 < lines.length && QUOTED.test(lines[end + 1]!)) end++
    const paras: DocAiBlock['paras'] = []
    let p: number | null = null
    for (let k = i + 1; k <= end; k++) {
      if (EMPTY_QUOTE.test(lines[k]!)) {
        if (p !== null) paras.push({ from: p, to: k - 1 })
        p = null
      } else if (p === null) p = k
    }
    if (p !== null) paras.push({ from: p, to: end })
    const sides: DocSide[] = []
    let k = end + 1
    let tailTo = -1
    // 隔一个空行的「> [!side]」一块接一块，都是挂在这块讲解下面的
    while (k + 1 < lines.length && lines[k]!.trim() === '' && SIDE_HEAD.test(lines[k + 1]!)) {
      let z = k + 1
      while (z + 1 < lines.length && QUOTED.test(lines[z + 1]!)) z++
      const q = [SIDE_HEAD.exec(lines[k + 1]!)![1]!.trim()]
      const quote: string[] = []
      const a: string[] = []
      let sep = false
      for (let b = k + 2; b <= z; b++) {
        const t = lines[b]!
        if (sep) a.push(unquote(t))
        else if (EMPTY_QUOTE.test(t)) sep = true
        else {
          const qq = /^\s*>\s?>\s?(.*)$/.exec(t)
          if (qq) quote.push(qq[1]!)
          else q.push(unquote(t).trim())
        }
      }
      const turn: DocSideTurn = { q: q.filter(Boolean).join('\n'), a: a.join('\n').trim() }
      const prev = sides[sides.length - 1]
      if (quote.length || !prev) sides.push({ quote: foldQuote(quote.join(' ')), turns: [turn], first: k + 1, last: z })
      else {
        prev.turns.push(turn)
        prev.last = z
      }
      tailTo = z
      k = z + 1
    }
    out.push({ head: i, end, paras, sides, tail: sides.length ? { from: end + 1, to: tailTo } : null })
    i = Math.max(end, tailTo)
  }
  return out
}

/** 一问写成的那一块：第一问（开一条新旁支）带「> > 那一句」，接着问的不带；回答原文每行前面「> 」 */
export function sideBlockMd(turn: DocSideTurn, quote?: string): string {
  const [first = '', ...rest] = turn.q.trim().split('\n')
  const lines = [`> [!side] ${first.trim()}`, ...rest.map((l) => `> ${l.trim()}`)]
  if (quote !== undefined) lines.push(`> > ${foldQuote(quote)}`)
  const a = turn.a.trim()
  if (a) lines.push('>', ...a.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')))
  return lines.join('\n')
}

/** 删掉一条旁支（它的几块连同前面那个空行）：要删的字符范围 */
export function sideRemove(text: string, side: DocSide): { from: number; to: number } {
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  // 从前面那个空行的上一行行尾删到最后一块的最后一行行尾：上下的空行只剩一个
  const from = starts[side.first - 2]! + lines[side.first - 2]!.length
  return { from, to: starts[side.last]! + lines[side.last]!.length }
}

/** 每一行的行首在全文里的字符位置 */
function lineStarts(lines: readonly string[]): number[] {
  const out: number[] = []
  let p = 0
  for (const l of lines) {
    out.push(p)
    p += l.length + 1
  }
  return out
}

/**
 * 新的一问写进文档：side 是这块讲解里第几条旁支（等于 sides.length 是新开的一条，写在这块讲解和已有旁支的最后面，带那一句）；
 * 接着问的写在那条旁支最后一块后面。返回插在哪个字符位置、插什么（前面空一行；后面紧跟着字的再空一行，不让后面那段并进来）
 */
export function sideInsert(text: string, block: DocAiBlock, side: number, turn: DocSideTurn, quote: string): { at: number; insert: string } {
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  const fresh = side >= block.sides.length
  const after = !fresh ? block.sides[side]!.last : block.tail ? block.tail.to : block.end
  const next = lines[after + 1]
  const pad = next !== undefined && next.trim() !== '' ? '\n' : ''
  return { at: starts[after]! + lines[after]!.length, insert: '\n\n' + sideBlockMd(turn, fresh ? quote : undefined) + pad }
}

/**
 * 在这块讲解的正文里找那一句：原文比（行首的「> 」不算，空白算一个），返回文档里的起止字符位置；改过找不到是 null
 */
export function locateQuote(text: string, block: DocAiBlock, quote: string): { from: number; to: number } | null {
  const want = foldQuote(quote)
  if (!want) return null
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  let folded = ''
  const at: number[] = []
  let space = false
  for (let n = block.head + 1; n <= block.end; n++) {
    const l = lines[n]!
    const cut = l.length - unquote(l).length
    for (let i = cut; i <= l.length; i++) {
      // 行尾算一个空白（并到下一行的字之间）
      const ch = i === l.length ? '\n' : l[i]!
      if (/\s/.test(ch)) {
        if (!space && folded.length) {
          folded += ' '
          at.push(starts[n]! + i)
        }
        space = true
        continue
      }
      space = false
      folded += ch
      at.push(starts[n]! + i)
    }
  }
  const i = folded.indexOf(want)
  if (i < 0) return null
  return { from: at[i]!, to: at[i + want.length - 1]! + 1 }
}

/** 选中的那几个字（字符位置）的原文：去掉每一行行首的「> 」，空白并成一个 */
export function quoteOfRange(text: string, from: number, to: number): string {
  const lines = text.slice(from, to).split('\n')
  // 第一行从哪个字开始选的：选区从行首开始（连「> 」一起选上）时也去掉
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  const head = from === lineStart ? unquote(lines[0]!) : lines[0]!
  return foldQuote([head, ...lines.slice(1).map(unquote)].join('\n'))
}

/** 字符位置 pos 落在哪一块讲解的正文里（头一行不算）：块的下标和那一段；不在正文里是 null */
export function aiBodyAt(text: string, blocks: readonly DocAiBlock[], pos: number): { block: number; para: number } | null {
  const line = text.slice(0, pos).split('\n').length - 1
  const b = blocks.findIndex((x) => line > x.head && line <= x.end)
  if (b < 0) return null
  const para = blocks[b]!.paras.findIndex((p) => line >= p.from && line <= p.to)
  return para < 0 ? null : { block: b, para }
}

/** 这块讲解的正文（去掉行首的「> 」）：旁支第一问没有会话可分叉，把它放在前面（同 Gemini、OpenCode 的做法） */
export function aiBodyOf(text: string, block: DocAiBlock): string {
  return text
    .split('\n')
    .slice(block.head + 1, block.end + 1)
    .map(unquote)
    .join('\n')
    .trim()
}

/**
 * 白板卡、问框里看到的是排好的字（task-p90ra）：选中的那句没有 md 记号，存进文件的那一句要照原文（找的时候照原文比）。
 * visible：一行 md 画出来看得到的字（行首的标题、列表记号，行内的 * _ ` ~、链接和双链的写法、图片、HTML 标签都不算），每个字在这一行的第几个
 */
function visible(s: string, lineStart: boolean): { ch: string; at: number }[] {
  const out: { ch: string; at: number }[] = []
  const word = /[\p{L}\p{N}]/u
  let i = 0
  if (lineStart) {
    const m = /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/.exec(s)
    if (m) i = m[0].length
  }
  while (i < s.length) {
    const c = s[i]!
    const rest = s.slice(i)
    if (c === '\\' && i + 1 < s.length) {
      out.push({ ch: s[i + 1]!, at: i + 1 })
      i += 2
      continue
    }
    const img = /^!\[[^\]]*\]\([^)]*\)/.exec(rest)
    if (img) {
      i += img[0].length
      continue
    }
    const wiki = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/.exec(rest)
    if (wiki) {
      const shown = wiki[2] !== undefined ? i + 2 + wiki[1]!.length + 1 : i + 2
      const len = (wiki[2] ?? wiki[1]!).length
      for (let k = 0; k < len; k++) out.push({ ch: s[shown + k]!, at: shown + k })
      i += wiki[0].length
      continue
    }
    const link = /^\[([^\]]*)\]\([^)]*\)/.exec(rest)
    if (link) {
      for (const v of visible(link[1]!, false)) out.push({ ch: v.ch, at: i + 1 + v.at })
      i += link[0].length
      continue
    }
    const tag = /^<\/?[A-Za-z][^>]*>/.exec(rest)
    if (tag) {
      i += tag[0].length
      continue
    }
    if (c === '*' || c === '`' || c === '~') {
      i++
      continue
    }
    if (c === '_' && !(word.test(s[i - 1] ?? '') && word.test(s[i + 1] ?? ''))) {
      i++
      continue
    }
    out.push({ ch: c, at: i })
    i++
  }
  return out
}

/** 一句 md 原文画出来是什么字（空白并成一个）：白板卡、问框里划那一句时按它找 */
export function mdPlain(raw: string): string {
  return foldQuote(
    raw
      .split('\n')
      .map((l) => visible(l, true)
        .map((v) => v.ch)
        .join(''))
      .join('\n'),
  )
}

/**
 * 排好的字里选中的一句（plain，空白并成一个）在这块讲解正文里的原文（带记号，去掉行首的「> 」）；找不到是 null。
 * 存进 `> > 那一句` 的是它，文档里、白板上、问框里都按它找得回来
 */
export function rawQuoteOf(text: string, block: DocAiBlock, plain: string): string | null {
  const want = foldQuote(plain.replace(/​/g, ''))
  if (!want) return null
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  let folded = ''
  const at: number[] = []
  let space = false
  const put = (ch: string, pos: number) => {
    if (/\s/.test(ch)) {
      if (!space && folded.length) {
        folded += ' '
        at.push(pos)
      }
      space = true
      return
    }
    space = false
    folded += ch
    at.push(pos)
  }
  for (let n = block.head + 1; n <= block.end; n++) {
    const l = lines[n]!
    const cut = l.length - unquote(l).length
    for (const v of visible(l.slice(cut), true)) put(v.ch, starts[n]! + cut + v.at)
    put('\n', starts[n]! + l.length)
  }
  const i = folded.indexOf(want)
  if (i < 0) return null
  return quoteOfRange(text, at[i]!, at[i + want.length - 1]! + 1)
}
