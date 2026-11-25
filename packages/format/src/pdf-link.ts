/**
 * 笔记里指回 PDF 某一页、某一块的链接：`第3讲%20线性映射.pdf#page=5&rect=0.05,0.29,0.52,0.36`。
 * rect 是这一页上的比例（左、上、宽、高，0 到 1），和页面大小、缩放无关。
 * 普通 md 链接，别的软件里点开也至少能打开这份 PDF。
 */
import { resolveLink } from './blocks'
import { prop } from './props'

export type Rect = [x: number, y: number, w: number, h: number]

export interface PdfAnchor {
  /** 库里的相对路径（或相对笔记所在文件夹的路径，看写的人怎么用） */
  file: string
  page: number
  rect?: Rect
  /** 引的那句原文的开头几个词（AI 回答里的页码链接带的，页码链接跳到段）：软件拿它找是这页的哪一段（pdf-quote.ts） */
  text?: string
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** 比例夹到 0..1，宽高至少 0.001 */
export function clampRect(r: Rect): Rect {
  const x = Math.min(Math.max(r[0], 0), 1)
  const y = Math.min(Math.max(r[1], 0), 1)
  const w = Math.min(Math.max(r[2], 0.001), 1 - x)
  const h = Math.min(Math.max(r[3], 0.001), 1 - y)
  return [round(x), round(y), round(w), round(h)]
}

/** 文件名里的空格等字符编码成 %20，中文原样留着（Obsidian、Typora 都认） */
export function encodePath(p: string): string {
  return p
    .split('/')
    .map((s) => s.replace(/[ \t%()[\]<>#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')))
    .join('/')
}

export function formatPdfAnchor(a: PdfAnchor): string {
  const page = Math.max(1, Math.round(a.page))
  const rect = a.rect ? `&rect=${clampRect(a.rect).join(',')}` : ''
  const text = a.text ? `&text=${encodeURIComponent(a.text)}` : ''
  return `${encodePath(a.file)}#page=${page}${rect}${text}`
}

/** 认不出（不是 .pdf、没有页码）返回 null；只有 #page=5 的也认（没有 rect） */
export function parsePdfAnchor(href: string): PdfAnchor | null {
  const hash = href.indexOf('#')
  const rawFile = hash === -1 ? href : href.slice(0, hash)
  let file: string
  try {
    file = decodeURIComponent(rawFile)
  } catch {
    file = rawFile
  }
  if (!/\.pdf$/i.test(file)) return null
  const params = new URLSearchParams(hash === -1 ? '' : href.slice(hash + 1))
  const page = Number(params.get('page') ?? '1')
  if (!Number.isInteger(page) || page < 1) return null
  const out: PdfAnchor = { file, page }
  const r = params.get('rect')?.split(',').map(Number)
  if (r && r.length === 4 && r.every((n) => Number.isFinite(n))) out.rect = clampRect(r as Rect)
  const text = params.get('text')?.trim()
  if (text) out.text = text
  return out
}

/** 笔记里的页码链接：file 是库里的路径；光写 #page=3 的（读 PDF 时 AI 回答里这样写，原样记进了笔记）file 是 null，PDF 按笔记找（notePdfCandidates） */
export interface PageLink {
  file: string | null
  page: number
  rect?: Rect
  /** 引的那句原文（见 PdfAnchor.text） */
  text?: string
}

/** 笔记 note 里的链接 href 是不是指 PDF 某一页（# 后面有 page=N）；网址、光一个 PDF、别的锚点返回 null */
export function pageLinkOf(note: string, href: string): PageLink | null {
  const hash = href.indexOf('#')
  if (hash === -1 || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) return null
  if (!/(^|&)page=\d+(&|$)/.test(href.slice(hash + 1))) return null
  const head = href.slice(0, hash)
  const a = parsePdfAnchor(`${head || 'x.pdf'}${href.slice(hash)}`)
  if (!a) return null
  const file = head ? resolveLink(note, head) : null
  if (head && !file) return null
  return { file, page: a.page, ...(a.rect ? { rect: a.rect } : {}), ...(a.text ? { text: a.text } : {}) }
}

/**
 * 光写 #page=N 的链接是哪份 PDF，按可能性排：属性「来源」写的 PDF（读 PDF 的笔记开头都写着）、
 * 「X 笔记.md」旁边的 X.pdf、这一处前面最近的页码链接的 PDF、后面的。都是库里的路径，不管在不在（用的人挑在的那个）
 */
export function notePdfCandidates(note: string, text: string, pos: number): string[] {
  const dir = note.includes('/') ? note.slice(0, note.lastIndexOf('/') + 1) : ''
  const out: string[] = []
  const src = /\[\[([^\]|#]+\.pdf)/i.exec(prop(text, '来源') ?? '')?.[1]?.trim()
  if (src) out.push(src.includes('/') ? src : dir + src)
  const m = /^(.*) 笔记\.md$/.exec(note.slice(dir.length))
  if (m) out.push(`${dir}${m[1]}.pdf`)
  const before: string[] = []
  const after: string[] = []
  for (const l of text.matchAll(/\]\(\s*<?([^)\s>]+\.pdf#[^)\s>]*)>?/gi)) {
    const f = pageLinkOf(note, l[1]!)?.file
    if (f) (l.index! < pos ? before : after).push(f)
  }
  out.push(...before.reverse(), ...after)
  return [...new Set(out)]
}
