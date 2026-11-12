// EPUB 转 Markdown：读 container.xml 找 OPF，按 spine 顺序把每个 XHTML 转成 Markdown 块（标题、段落、列表、引用、表格、图片），
// 图片以 data: 内嵌，数学公式（MathML）原样保留（Chromium 能直接显示）。EPUB 只有对照和速览两种模式，没有原文模式。
import { unzipSync, strFromU8 } from 'fflate'
import { parse, type HTMLElement, type Node as HNode, NodeType } from 'node-html-parser'
import { posix } from 'node:path'
import { t } from '../shared/i18n'

export interface EpubBook {
  title: string
  authors: string[]
  year: number | null
  description: string | null
  md: string
  cover: { data: Uint8Array; type: string } | null
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

export function readEpub(buf: Uint8Array): EpubBook {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(buf)
  } catch (e) {
    throw new Error(t('EPUB 解压失败：{0}', (e as Error).message))
  }
  const text = (p: string): string => {
    const f = files[p] ?? files[decodeURIComponent(p)]
    if (!f) throw new Error(t('EPUB 里缺文件：{0}', p))
    return strFromU8(f)
  }
  const container = parse(text('META-INF/container.xml'))
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error(t('EPUB 没有 rootfile'))
  const opfDir = posix.dirname(opfPath)
  const opf = parse(text(opfPath))
  const meta = (tag: string): string[] => opf.querySelectorAll(tag).map((n) => n.text.trim()).filter(Boolean)
  const title = meta('dc\\:title')[0] ?? meta('title')[0] ?? '未命名'
  const authors = meta('dc\\:creator').length ? meta('dc\\:creator') : meta('creator')
  const date = meta('dc\\:date')[0] ?? ''
  const description = meta('dc\\:description')[0] ?? null

  const manifest = new Map<string, { href: string; type: string; props: string }>()
  for (const it of opf.querySelectorAll('manifest item'))
    manifest.set(it.getAttribute('id') ?? '', { href: posix.join(opfDir, it.getAttribute('href') ?? ''), type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' })

  const coverId = opf.querySelectorAll('meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
  const coverItem = [...manifest.values()].find((m) => m.props.includes('cover-image')) ?? (coverId ? manifest.get(coverId) : undefined)
  const cover = coverItem && files[coverItem.href] ? { data: files[coverItem.href], type: coverItem.type } : null

  const blocks: string[] = [`# ${title}`]
  for (const ref of opf.querySelectorAll('spine itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (!item || !/html|xml/.test(item.type)) continue
    let html: string
    try {
      html = text(item.href)
    } catch {
      continue
    }
    const root = parse(html, { blockTextElements: { script: false, style: false, pre: true } })
    const body = root.querySelector('body') ?? root
    const img = (src: string): string | null => {
      const p = posix.normalize(posix.join(posix.dirname(item.href), decodeURIComponent(src.split('#')[0])))
      const data = files[p]
      if (!data) return null
      const ext = p.split('.').pop()!.toLowerCase()
      return `data:${MIME[ext] ?? 'image/png'};base64,${Buffer.from(data).toString('base64')}`
    }
    toBlocks(body, blocks, img)
  }
  return { title, authors, year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null, description, md: blocks.join('\n\n') + '\n', cover }
}

const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'figure', 'figcaption', 'main', 'body', 'li', 'dd', 'dt', 'center'])

function toBlocks(el: HTMLElement, out: string[], img: (src: string) => string | null): void {
  for (const n of el.childNodes) {
    if (n.nodeType !== NodeType.ELEMENT_NODE) {
      const t_ = n.text.replace(/\s+/g, ' ').trim()
      if (t_) out.push(t_)
      continue
    }
    const e = n as HTMLElement
    const tag = e.tagName?.toLowerCase() ?? ''
    if (/^h[1-6]$/.test(tag)) {
      const t_ = inline(e, img).trim()
      // EPUB 的一级标题是章名，降一级，书名占 #
      if (t_) out.push(`${'#'.repeat(Math.min(6, Number(tag[1]) + 1))} ${t_.replace(/\n/g, ' ')}`)
    } else if (tag === 'img' || tag === 'image') {
      const src = img(e.getAttribute('src') ?? e.getAttribute('xlink:href') ?? e.getAttribute('href') ?? '')
      if (src) out.push(`![${e.getAttribute('alt') ?? ''}](${src})`)
    } else if (tag === 'table') out.push(e.outerHTML.replace(/\n\s*\n/g, '\n'))
    else if (tag === 'pre') out.push('```\n' + e.text.replace(/\n+$/, '') + '\n```')
    else if (tag === 'blockquote') {
      const inner: string[] = []
      toBlocks(e, inner, img)
      if (inner.length) out.push(inner.map((b) => b.split('\n').map((l) => `> ${l}`).join('\n')).join('\n>\n'))
    } else if (tag === 'ul' || tag === 'ol') {
      const items = e.childNodes.filter((c) => (c as HTMLElement).tagName?.toLowerCase() === 'li') as HTMLElement[]
      const lines = items.map((li, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li, img).trim().replace(/\n+/g, ' ')}`).filter((l) => l.length > 2)
      if (lines.length) out.push(lines.join('\n'))
    } else if (tag === 'math') out.push(e.outerHTML)
    else if (tag === 'hr' || tag === 'script' || tag === 'style') continue
    else if (BLOCK.has(tag) && hasBlockChild(e)) toBlocks(e, out, img)
    else {
      const t_ = inline(e, img).trim()
      if (t_) out.push(t_)
    }
  }
}

function hasBlockChild(e: HTMLElement): boolean {
  return e.childNodes.some((c) => {
    const t_ = (c as HTMLElement).tagName?.toLowerCase() ?? ''
    return BLOCK.has(t_) || /^h[1-6]$/.test(t_) || ['ul', 'ol', 'table', 'pre', 'blockquote', 'img', 'image', 'math', 'svg'].includes(t_)
  })
}

function inline(e: HNode, img: (src: string) => string | null): string {
  if (e.nodeType !== NodeType.ELEMENT_NODE) return e.text.replace(/\s+/g, ' ')
  const el = e as HTMLElement
  const tag = el.tagName?.toLowerCase() ?? ''
  const kids = (): string => el.childNodes.map((c) => inline(c, img)).join('')
  switch (tag) {
    case 'em':
    case 'i':
      return wrap(kids(), '*')
    case 'strong':
    case 'b':
      return wrap(kids(), '**')
    case 'code':
      return '`' + el.text + '`'
    case 'sup':
    case 'sub':
      return `<${tag}>${kids()}</${tag}>`
    case 'br':
      return '  \n'
    case 'math':
      return el.outerHTML
    case 'img':
    case 'image': {
      const src = img(el.getAttribute('src') ?? el.getAttribute('xlink:href') ?? '')
      return src ? `![${el.getAttribute('alt') ?? ''}](${src})` : ''
    }
    default:
      return kids()
  }
}

function wrap(s: string, m: string): string {
  const t_ = s.trim()
  return t_ ? `${m}${t_}${m}` : s
}
