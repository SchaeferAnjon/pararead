/**
 * 网页阅读视图双语对照读的纯计算：哪些块要翻、哪些块（公式、图）不翻，以及「存成双语笔记」写出来的 md。
 * 不依赖 Electron。做法照 ParaRead（https://github.com/SchaeferAnjon/pararead ，同一个作者）：公式块和图不翻译；译文按段落指纹缓存。
 */
import { linkFrom } from './reading-note'
import { setProp } from './props'
import { dayOf } from './reading-note'
import type { PdfBlock } from './pdf-blocks'

/** 数学符号：等号、运算、希腊字母、集合、箭头、上下标数字 */
const MATH = /[=+−\-×·÷∑∏∫∂√≤≥≈≠∞∈∉⊂⊆∪∩∀∃→←↦⇒⇔∘⊗⊕^_|‖⟨⟩α-ωΑ-Ω₀-₉⁰-⁹′]/g
/** 一个「词」：4 个以上的拉丁字母，或 2 个以上的汉字 */
const WORD = /[A-Za-z]{4,}|[一-鿿]{2,}/g
/** 公式里常见、但不算「词」的函数名 */
const FUNC = /^(sin|cos|tan|cot|sec|csc|log|exp|lim|sup|inf|max|min|det|rank|span|dim|ker|trace)$/i

/**
 * 这一块是不是公式（不翻译，照原页裁下来）：有数学符号，而且几乎没有成句的词。
 * 「R(θ) = cos θ −sin θ …」是公式；「Check: column 1 of R(θ) is the rotated e₁ …」是正文。
 */
export function isFormula(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const math = t.match(MATH)?.length ?? 0
  if (!math) return false
  const words = (t.match(WORD) ?? []).filter((w) => !FUNC.test(w))
  if (words.length === 0) return true
  // 很长的块算正文（公式不会写成几行字）
  if (t.length > 160) return false
  return words.length <= 1 && math >= 2
}

/** 一块怎么出现在对照里：要翻的字（标题、正文）、不翻的公式 / 图 */
export type BiKind = 'heading' | 'text' | 'formula' | 'figure'

export function biKind(b: Pick<PdfBlock, 'kind' | 'text' | 'stack'>): BiKind {
  if (b.kind === 'image') return 'figure'
  if (b.kind === 'heading') return 'heading'
  // 一格一格的标签（「Computation Stack」那种彩色表，pdf-blocks 把它的行用换行连着）：拍扁成一行字看不懂，整块照原页裁
  if (b.stack) return 'figure'
  return isFormula(b.text) ? 'formula' : 'text'
}

/** 要送去翻的块（公式和图不送）；页码、页眉这类只有数字的短行也不送 */
export function translatable<T extends Pick<PdfBlock, 'kind' | 'text'>>(blocks: T[]): T[] {
  return blocks.filter((b) => {
    const k = biKind(b)
    if (k === 'formula' || k === 'figure') return false
    return /[A-Za-zÀ-ɏЀ-ӿ぀-ヿ一-鿿가-힯]{2,}/.test(b.text)
  })
}

// ---------------------------------------------------------------- 存成双语笔记

/** 双语笔记里的一块：字（原文 + 译文，译文没有时只写原文）或一张图（网页上的原图） */
export type BiNoteBlock = { kind: 'heading' | 'text'; text: string; tr: string | null } | { kind: 'formula' | 'figure'; path: string; caption?: string }

export interface BiNotePage {
  blocks: BiNoteBlock[]
}

export interface BiNoteInput {
  /** 笔记自己在库里的路径（链接相对它） */
  note: string
  /** 网页的网址和标题 */
  source: { url: string; title: string }
  pages: BiNotePage[]
  /** 「英文 → 中文」 */
  langs?: string
  now?: Date
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()
const quote = (s: string) => `> ${oneLine(s)}`

/** 网页的双语笔记：收件箱里「<标题> 双语.md」（文件名里不能有的字换掉） */
export function webBiNotePath(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '网页'
  return `收件箱/${safe} 双语.md`
}

/**
 * 双语笔记：属性（类型 双语、来源网址、日期）+ 一级标题 + 回到网页的链接。
 * 每段原文写成引用、紧跟译文；标题写译文、下一行引用原文；公式和图是网页上的原图。
 */
export function bilingualNote(input: BiNoteInput): string {
  const { note, source } = input
  const now = input.now ?? new Date()
  let t = setProp('', '类型', '双语')
  t = setProp(t, '来源', source.url)
  t = setProp(t, '日期', dayOf(now))
  const out: string[] = [`${t}\n# ${oneLine(source.title) || '网页'} 双语`]
  if (input.langs) out.push('', `${input.langs} · 原文是引用，下面跟着译文；公式和图不翻译，照原页裁下来。`)
  for (const pg of input.pages) {
    out.push('', `[回到网页](${source.url})`)
    for (const b of pg.blocks) {
      out.push('')
      if ('path' in b) {
        out.push(`![${(b.caption ?? (b.kind === 'formula' ? '公式' : '图')).replace(/[[\]]/g, '')}](${/^https?:/i.test(b.path) ? b.path : linkFrom(note, b.path)})`)
      } else if (b.kind === 'heading') {
        out.push(`### ${oneLine(b.tr ?? b.text)}`)
        if (b.tr) out.push('', quote(b.text))
      } else {
        out.push(quote(b.text))
        if (b.tr) out.push('', oneLine(b.tr))
      }
    }
  }
  return out.join('\n') + '\n'
}
