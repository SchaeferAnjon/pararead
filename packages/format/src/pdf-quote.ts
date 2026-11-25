/**
 * AI 回答里的页码链接跳到那一段（页码链接跳到段）：AI 写「[第 2 页](#page=2&text=We%20additionally%20extract)」，
 * text 是它引的那句原文的开头几个词；软件拿它在那一页的段落块（pageBlocks）里找是哪一段，跳过去、那段闪一下。
 * 找不到（AI 引的是自己的译文、记错了页、字被 PDF 拆坏了）返回 null，用的地方退回只跳到页。
 * 纯计算，不依赖 pdf.js；画布笔记读 PDF 和 ParaRead 共用。
 */
import { type PdfBlock, type PdfPageText, pageBlocks } from './pdf-blocks'
import { clampRect, type Rect } from './pdf-link'

/** 比较用的字：大小写、全半角、连字符、空白、标点都不算（「spatio-temporal」和断行的「spatio- temporal」一样） */
export const quoteKey = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** 太短的不找（三五个字母到处都是，找到的多半是别处） */
const MIN = 6

/**
 * 引的那句在哪一块开头。先整句找；整句找不到（AI 改了几个词、句子跨到下一段）拿开头一截、再拿结尾一截找。
 * alt：这一块的译文（对照读时有；AI 引的是译文也认得出是哪一段）
 */
export function quoteBlock(blocks: readonly PdfBlock[], quote: string, alt?: (b: PdfBlock) => string | undefined): PdfBlock | null {
  const q = quoteKey(quote)
  if (q.length < MIN) return null
  const texts = blocks.filter((b) => b.kind !== 'image')
  const find = (textOf: (b: PdfBlock) => string | undefined): PdfBlock | null => {
    let hay = ''
    const starts: number[] = []
    for (const b of texts) {
      starts.push(hay.length)
      hay += quoteKey(textOf(b) ?? '')
    }
    const at = (i: number) => {
      let k = 0
      while (k + 1 < starts.length && starts[k + 1]! <= i) k++
      return texts[k]!
    }
    const i = hay.indexOf(q)
    if (i !== -1) return at(i)
    for (const n of [40, 24]) {
      if (q.length <= n) continue
      const head = hay.indexOf(q.slice(0, n))
      if (head !== -1) return at(head)
      const tail = hay.indexOf(q.slice(-n))
      // 结尾对上了：往前推回整句的长度，是句子开头那一块
      if (tail !== -1) return at(Math.max(0, tail - (q.length - n)))
    }
    return null
  }
  return find((b) => b.text) ?? (alt ? find(alt) : null)
}

/**
 * 引的那句所在那一段在页上的框（这一页上的比例）。引到的是小标题（「B. Static Feature Stream」）时连着它下面那一段一起框。
 * page：页码（只用来给块编号）；alt 同 quoteBlock
 */
export function quoteRect(p: PdfPageText, quote: string, page = 1, alt?: (b: PdfBlock) => string | undefined): Rect | null {
  if (!p.width || !p.height) return null
  const blocks = pageBlocks(p, page)
  const b = quoteBlock(blocks, quote, alt)
  if (!b) return null
  const next = blocks[blocks.indexOf(b) + 1]
  // 论文里的小标题常和正文一样大（「B. Static Feature Stream」斜体），认不成标题：一行短短的、句末没有句号的也当标题
  const head = b.kind === 'heading' || (b.text.length < 70 && !b.text.includes('\n') && !/[.。:：;；]$/.test(b.text))
  const parts = head && next?.kind === 'text' ? [b, next] : [b]
  const pad = 4
  const x = Math.min(...parts.map((r) => r.x)) - pad
  const y = Math.min(...parts.map((r) => r.y)) - pad
  const right = Math.max(...parts.map((r) => r.x + r.w)) + pad
  const bottom = Math.max(...parts.map((r) => r.y + r.h)) + pad
  return clampRect([x / p.width, y / p.height, (right - x) / p.width, (bottom - y) / p.height])
}
