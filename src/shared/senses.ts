// 意群显示（照会议字幕的双语意群对照）：一段原文和它的译文按句子切开，一句原文配一句译文，
// 每句再按意群切块，原文的一块和译文里对应的那几段用同一个颜色。
// 这里只管数据：把模型给的片段在原文、译文里定位，算出一个不丢字、不重复的切分。
// 位置都是 Markdown 源文字里的下标（原文是这一段的 md，译文是译文的 md）；画的时候按位置切开，一个字都不改。

export type Span = [number, number]
export interface SenseChunk {
  en: Span
  zh: Span[] // 译文里对应的一段或几段（语序不同时会被隔开）；空的是没对上
}
export interface SenseSentence {
  en: Span
  zh: Span
  chunks: SenseChunk[]
}

const MAX_ZH_PIECES = 3
const EDGE_PUNCT = /^[\s,.;:!?，。；：！？、"'“”‘’「」()（）]+|[\s,.;:!?，。；：！？、"'“”‘’「」()（）]+$/g
const LEAD_PUNCT = /^[\s,.;:!?，。；：！？、"'“”‘’「」()（）]+/
const OPENERS = '（(“‘「《[【'
const solid = (s: string): number => s.replace(EDGE_PUNCT, '').length
const hits = (a: Span, used: Span[]): boolean => used.some((u) => a[0] < u[1] && u[0] < a[1])
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 原文里按顺序找：先原样找，找不到再不看空白找一遍（模型常把换行改成空格、把公式里的空格去掉） */
function locateEn(src: string, piece: string, from: number): Span | null {
  const p = piece.trim()
  if (!p) return null
  const i = src.indexOf(p, from)
  if (i >= 0) return [i, i + p.length]
  const re = new RegExp(p.split(/\s+/).map(escapeRe).join('\\s*'), 'g')
  re.lastIndex = from
  const m = re.exec(src)
  return m && m[0] ? [m.index, m.index + m[0].length] : null
}

/** 译文里找一段没被别的块占着的：先从前面那些句子用到的地方往后找（重复的词取靠后的那个），找不到再从头 */
function locateZh(tr: string, piece: string, used: Span[], floor: number): Span | null {
  for (const start of [floor, 0]) {
    for (let i = tr.indexOf(piece, start); i >= 0; i = tr.indexOf(piece, i + 1)) {
      const s: Span = [i, i + piece.length]
      if (!hits(s, used)) return s
    }
    if (!floor) break
  }
  return null
}

/**
 * 一块的 zh 整段在译文里找不到：多半是模型把译文里不相邻的几段拼成了一块（中文语序不同时常见）。
 * 从头贪心取译文里能找到的最长一段（至少 2 个字），接着找剩下的，最多 3 段；最后只剩一个字就不要了。
 */
function splitZh(tr: string, zh: string, used: Span[], floor: number): Span[] | null {
  const out: Span[] = []
  let rest = zh.replace(EDGE_PUNCT, '')
  while (rest) {
    if (solid(rest) < 2) return out.length ? out : null
    let hit: { pos: Span; len: number } | null = null
    for (let len = rest.length; len >= 2 && !hit; len--) {
      const piece = rest.slice(0, len)
      if (solid(piece) < 2) continue
      const pos = locateZh(tr, piece, [...used, ...out], floor)
      if (pos) hit = { pos, len }
    }
    if (!hit || out.length >= MAX_ZH_PIECES) return null
    out.push(hit.pos)
    rest = rest.slice(hit.len).replace(LEAD_PUNCT, '')
  }
  return out.length ? out : null
}

/** Markdown 片段能不能单独拿出来画：公式、加粗、行内代码、HTML 标签、链接都得是成对的 */
export function balanced(md: string): boolean {
  const bare = md.replace(/\\[\s\S]/g, '')
  if ((bare.match(/\$/g)?.length ?? 0) % 2) return false
  if ((bare.match(/\*\*/g)?.length ?? 0) % 2) return false
  if ((bare.match(/`/g)?.length ?? 0) % 2) return false
  const open = [...bare.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)].filter((m) => !m[2] && !/^(br|hr|img)$/i.test(m[1])).length
  const close = bare.match(/<\/[a-zA-Z][\w-]*>/g)?.length ?? 0
  if (open !== close || /<[a-zA-Z/][^>]*$/.test(bare)) return false
  const link = bare.indexOf('](')
  if (link >= 0 && (bare.lastIndexOf('[', link) < 0 || bare.indexOf(')', link) < 0)) return false
  return true
}

/** 这一段能不能做意群：只做一整段的普通文字（列表、多段、表格、引用块按原样显示） */
export function senseable(md: string): boolean {
  const s = md.trim()
  return s.length >= 30 && !/\n\s*\n/.test(s) && !/^\s*([-*+]|\d+[.)])\s/m.test(s) && !/^\s*[#>|]/m.test(s) && !s.includes('$$')
}

type Raw = { en?: unknown; zh?: unknown }

/**
 * 模型的回答（{ sentences: [[{ en, zh }]] }）→ 每句、每块的位置。
 * - 块：en 在原文里按顺序找得到才算；zh 在译文里找不到的，这一块留着但不上色。
 * - 句子在原文里的范围：从它第一块的开头到下一句第一块的开头（头一句从 0 起，末一句到结尾），块之间漏掉的字不丢。
 * - 句子在译文里的范围同理；两句用到的译文交叉了（译文把两句并成了一句、换了先后），就并成一句。
 * - 切开的地方落在公式、加粗这类成对的记号中间的，也并成一句。
 * 一块都没对上返回 []。
 */
export function parseSenses(raw: unknown, src: string, tr: string): SenseSentence[] {
  const list = (raw as { sentences?: unknown })?.sentences
  if (!Array.isArray(list)) return []
  interface Tmp {
    chunks: SenseChunk[]
    lo: number
    hi: number
  }
  const sens: Tmp[] = []
  const usedZh: Span[] = []
  let from = 0
  let floor = 0
  for (const s of list) {
    const items: Raw[] = Array.isArray(s) ? s : Array.isArray((s as { chunks?: unknown })?.chunks) ? (s as { chunks: Raw[] }).chunks : []
    const chunks: SenseChunk[] = []
    for (const x of items) {
      if (!x || typeof x.en !== 'string') continue
      const en = locateEn(src, x.en, from)
      if (!en) continue
      from = en[1]
      const zh: Span[] = []
      for (const z of (Array.isArray(x.zh) ? x.zh : [x.zh]).filter((v): v is string => typeof v === 'string' && !!v.trim())) {
        const one = locateZh(tr, z.trim(), [...usedZh, ...zh], floor)
        const got = one ? [one] : splitZh(tr, z.trim(), [...usedZh, ...zh], floor)
        if (!got) {
          zh.length = 0
          break
        }
        zh.push(...got)
      }
      if (zh.length > MAX_ZH_PIECES) zh.length = 0
      usedZh.push(...zh)
      chunks.push({ en, zh: zh.sort((a, b) => a[0] - b[0]) })
    }
    if (!chunks.length) continue
    const zs = chunks.flatMap((c) => c.zh)
    const t_: Tmp = { chunks, lo: zs.length ? Math.min(...zs.map((z) => z[0])) : -1, hi: zs.length ? Math.max(...zs.map((z) => z[1])) : -1 }
    if (t_.hi > floor) floor = t_.hi
    sens.push(t_)
  }
  if (!sens.some((s) => s.lo >= 0)) return []

  const merge = (a: Tmp, b: Tmp): void => {
    a.chunks.push(...b.chunks)
    a.lo = a.lo < 0 ? b.lo : b.lo < 0 ? a.lo : Math.min(a.lo, b.lo)
    a.hi = Math.max(a.hi, b.hi)
  }
  // 译文那头：后一句用到的译文要整个在前一句的后面
  const out: Tmp[] = []
  for (const s of sens) {
    const prev = out[out.length - 1]
    if (prev && (s.lo < 0 || prev.lo < 0 || s.lo < prev.hi)) merge(prev, s)
    else out.push(s)
    while (out.length >= 2 && out[out.length - 1].lo < out[out.length - 2].hi) merge(out[out.length - 2], out.pop()!)
  }
  // 译文里一句从哪儿开始：它最前面那块的开头，再往前让过开引号、开括号
  const zhStart = (s: Tmp): number => {
    let i = s.lo
    while (i > 0 && OPENERS.includes(tr[i - 1])) i--
    return i
  }
  const enStart = (s: Tmp): number => s.chunks[0].en[0]
  // 切开的地方要落在成对记号的外面
  const done: Tmp[] = []
  for (const s of out) {
    const prev = done[done.length - 1]
    if (prev) {
      const first = done.length === 1
      const enOk = balanced(src.slice(first ? 0 : enStart(prev), enStart(s)))
      const zhOk = balanced(tr.slice(first ? 0 : zhStart(prev), zhStart(s)))
      if (!enOk || !zhOk) {
        merge(prev, s)
        continue
      }
    }
    done.push(s)
  }
  return done.map((s, i) => ({
    en: [i === 0 ? 0 : enStart(s), i + 1 < done.length ? enStart(done[i + 1]) : src.length],
    zh: [i === 0 ? 0 : zhStart(s), i + 1 < done.length ? zhStart(done[i + 1]) : tr.length],
    chunks: s.chunks
  }))
}

export interface Piece {
  text: string
  k: number | null // 第几块（原文的一块和译文里对它的那几段是同一个 k）；null 是块之间的字，不上色
}

/** 把一句（text 里 range 这一截）按块切成要画的片段；一个片段里成对的记号不全的，和后面的并在一起、不上色 */
export function cut(text: string, range: Span, marks: { span: Span; k: number | null }[]): Piece[] {
  const raw: Piece[] = []
  let at = range[0]
  for (const m of [...marks].sort((a, b) => a.span[0] - b.span[0])) {
    const a = Math.max(m.span[0], at)
    const b = Math.min(m.span[1], range[1])
    if (b <= a) continue
    if (a > at) raw.push({ text: text.slice(at, a), k: null })
    raw.push({ text: text.slice(a, b), k: m.k })
    at = b
  }
  if (at < range[1]) raw.push({ text: text.slice(at, range[1]), k: null })
  const out: Piece[] = []
  for (let i = 0; i < raw.length; i++) {
    let p = raw[i]
    while (!balanced(p.text) && i + 1 < raw.length) p = { text: p.text + raw[++i].text, k: null }
    out.push(p)
  }
  return out
}

/** 这一小段要不要交给 Markdown 画（有公式、强调、HTML、转义、链接）；不用的直接当文字放 */
export const needsMd = (text: string): boolean => /[$*_`\\<>&~|]|\]\(|!\[|https?:|www\./.test(text)

// ---- 选中一边、另一边跟着亮：要在「Markdown 源文字的位置」和「画出来的文字的位置」之间换算 ----

const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\u00a0'
const same = (a: string, b: string): boolean => a === b || (isSpace(a) && isSpace(b))

/**
 * md 里每个位置对应到画出来的文字（元素的 textContent）里的哪个位置，返回长度 md.length + 1 的表，只增不减。
 * 两边大部分是一样的字，不一样的地方是 Markdown 记号（** $ \ 列表号，画出来没有）和公式（KaTeX 画出来的字
 * 比源文字多，里面带着一份 LaTeX 原文）。一个字一个字对；对不上时两边各往后看一小段，找最近的一处又连着 4 个字相同的地方接着对。
 */
export function alignOffsets(md: string, text: string): number[] {
  const map = new Array<number>(md.length + 1)
  const gram = (i: number, j: number): boolean => {
    if (i + 4 > md.length || j + 4 > text.length) return false
    let solid = 0
    for (let k = 0; k < 4; k++) {
      if (!same(md[i + k], text[j + k])) return false
      if (!isSpace(md[i + k])) solid++
    }
    return solid >= 3
  }
  let i = 0
  let j = 0
  while (i < md.length) {
    if (j < text.length && same(md[i], text[j])) {
      map[i++] = j++
      continue
    }
    // 重新对上：两边跳过的字加起来最少的那一处
    let hit: [number, number] | null = null
    for (let total = 1; total <= 700 && !hit; total++)
      for (let di = Math.min(total, 100); di >= 0; di--) {
        const dj = total - di
        if (dj > 600) break
        if (gram(i + di, j + dj)) {
          hit = [di, dj]
          break
        }
      }
    const di = hit ? hit[0] : Math.min(8, md.length - i)
    for (let k = 0; k < di; k++) map[i + k] = j
    i += di
    if (hit) j += hit[1]
  }
  // md 走完了：画出来的字要是还有剩（最后是公式，或者末尾的空白），都算到结尾
  map[md.length] = text.length
  return map
}

/** 画出来的位置 → md 里的位置（表里第一个不小于它的） */
export function toMd(map: number[], at: number): number {
  let lo = 0
  let hi = map.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (map[mid] < at) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 选中了一边的 [a, b)（md 里的位置），另一边对应的是哪几段：和选区重叠的那些块的对面。
 * 只沾到一两个字的块不算（拖选时容易多带一点）。side 是选区所在的那一边。
 */
export function counterpart(senses: SenseSentence[], side: 'en' | 'zh', a: number, b: number): Span[] {
  const out: Span[] = []
  const touches = (s: Span): boolean => Math.min(b, s[1]) - Math.max(a, s[0]) >= Math.min(2, s[1] - s[0])
  for (const s of senses)
    for (const c of s.chunks) {
      if (!c.zh.length) continue
      if (side === 'en' ? touches(c.en) : c.zh.some(touches)) out.push(...(side === 'en' ? c.zh : [c.en]))
    }
  // 挨着的并成一段，免得中间留缝
  out.sort((x, y) => x[0] - y[0])
  const merged: Span[] = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1])
    else merged.push([s[0], s[1]])
  }
  return merged
}
