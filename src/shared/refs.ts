import type { Block } from './types'

// 参考文献：在重排结果里找 References 小节，拆成一条条；正文里的 [12]、[3]–[5]、[1, 4] 认成引用号。
// 作者-年份体（Smith et al., 2020）的论文没有编号，按顺序编号，弹层里按作者和年份找。

export interface RefEntry {
  n: string // 编号（IEEE 体就是方括号里的数）或顺序号
  text: string
  blockId: string
}

const REF_HEAD = /^(?:[IVX]+\.?\s*|\d+\.?\s*)?(r\s*e\s*f\s*e\s*r\s*e\s*n\s*c\s*e\s*s|bibliography|works cited|literature cited|参考文献)\b/i

export function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\$([^$]*)\$/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findReferences(blocks: Block[]): RefEntry[] {
  const start = blocks.findIndex((b) => b.type === 'heading' && REF_HEAD.test(plain(b.md)))
  if (start < 0) return []
  const level = blocks[start].level ?? 1
  const out: RefEntry[] = []
  let seq = 0
  for (let i = start + 1; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'heading' && (b.level ?? 1) <= level && !/^\[\d+\]/.test(b.md)) break
    if (b.type !== 'paragraph' && b.type !== 'heading') continue
    const t = plain(b.md)
    // 一个块里可能有好几条：[1] ... [2] ...，或 1. ... 2. ...
    const parts = t.split(/\s(?=\[\d{1,4}\]\s)/)
    for (const part of parts) {
      const m = /^\[(\d{1,4})\]\s*(.+)$/.exec(part) ?? /^(\d{1,4})\.\s+(.+)$/.exec(part)
      if (m) out.push({ n: m[1], text: m[2].trim(), blockId: b.id })
      else if (part.length > 20) out.push({ n: String(++seq), text: part, blockId: b.id })
    }
  }
  return out
}

// 正文里的引用号：[12]、[3]–[5]、[3-5]、[1, 4, 7]。返回展开后的编号
export const CITE_RE = /\[(\d{1,4}(?:\s*[–—-]\s*\d{1,4})?(?:\s*,\s*\d{1,4}(?:\s*[–—-]\s*\d{1,4})?)*)\]/g

export function expandCite(inner: string): string[] {
  const out: string[] = []
  for (const part of inner.split(/\s*,\s*/)) {
    const r = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(part)
    if (r) {
      const [a, b] = [Number(r[1]), Number(r[2])]
      if (b >= a && b - a < 50) for (let k = a; k <= b; k++) out.push(String(k))
    } else if (/^\d+$/.test(part)) out.push(part)
  }
  return out
}

// 图、表、公式的引用：Fig. 3、Figure 3(a)、Table II、Eq. (2)
export const XREF_RE = /\b(Fig(?:ure)?s?\.?|Tables?|Eqs?\.?|Equations?)\s*\(?([IVX]+|\d+)\)?/g

export function xrefKind(word: string): 'figure' | 'table' | 'equation' {
  if (/^fig/i.test(word)) return 'figure'
  if (/^tab/i.test(word)) return 'table'
  return 'equation'
}

// 图表清单：图片块配上紧挨着的图注；表格配上前面的表注
export interface FigureItem {
  kind: 'figure' | 'table'
  label: string // Fig. 3、TABLE II
  num: string
  caption: string
  blockId: string // 图片或表格所在块
  captionId: string | null
}

export function listFigures(blocks: Block[]): FigureItem[] {
  const out: FigureItem[] = []
  const capRe = /^(Fig\.|Figure|FIG\.|TABLE|Table)\s*([IVX]+|\d+)[.:]?\s*/
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'image' && b.type !== 'table') continue
    const near = [blocks[i + 1], blocks[i - 1], blocks[i + 2]].find((x) => x && (x.type === 'caption' || capRe.test(plain(x.md))))
    const cap = near ? plain(near.md) : ''
    const m = capRe.exec(cap)
    const kind = b.type === 'table' || (m && /^tab/i.test(m[1])) ? 'table' : 'figure'
    out.push({
      kind,
      label: m ? `${/^tab/i.test(m[1]) ? 'Table' : 'Fig.'} ${m[2]}` : kind === 'table' ? '表' : '图',
      num: m?.[2] ?? '',
      caption: m ? cap.slice(m[0].length) : cap,
      blockId: b.id,
      captionId: near?.id ?? null
    })
  }
  return out
}

/**
 * 一段摘录在原文的第几页（从 1 起）：只看字母和数字，拿开头的 40 个去每页的文字里找，找不到再拿 20 个试一次。
 * 对照模式里的标注用它补页码；摘的是译文（没有英文字母）的找不到，返回 null。
 */
export function pageOfText(pages: string[], text: string): number | null {
  const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const all = squash(text)
  if (all.length < 8) return null
  const flat = pages.map(squash)
  for (const n of [40, 20]) {
    const needle = all.slice(0, n)
    const i = flat.findIndex((p) => p.includes(needle))
    if (i >= 0) return i + 1
  }
  return null
}
