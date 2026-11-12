// 调整重排区域（Scholaread 的「调整区域 / 改善重排」）：MinerU 的 middle_json 给出每页的版面块（类型、归一化坐标、阅读顺序、内容）。
// 用户在界面上改块的类型、位置大小、顺序，删块或画新块，保存后按新版面重新生成 Markdown，存成 edited 档。
// 没改过的块用 MinerU 识别好的内容（行内公式、表格 HTML、公式 LaTeX）；改过框的文字块按框里的 PDF 文字重取；图、表、公式块用界面从 PDF 页面截的图。

import { t as i18n } from '../shared/i18n'

export type RegionType = 'title' | 'heading' | 'text' | 'list' | 'code' | 'image' | 'table' | 'equation' | 'caption' | 'footnote' | 'reference' | 'discard'

export const REGION_TYPES: { id: RegionType; name: string }[] = [
  { id: 'text', name: i18n('文本') },
  { id: 'title', name: i18n('标题') },
  { id: 'heading', name: i18n('小节标题') },
  { id: 'list', name: i18n('项目符号') },
  { id: 'image', name: i18n('图表') },
  { id: 'table', name: i18n('表格') },
  { id: 'equation', name: i18n('公式') },
  { id: 'caption', name: i18n('图注') },
  { id: 'footnote', name: i18n('脚注') },
  { id: 'code', name: i18n('代码') },
  { id: 'reference', name: i18n('参考文献') },
  { id: 'discard', name: i18n('不要（页眉页脚等）') }
]

export interface Region {
  id: string
  page: number // 从 0 开始
  type: RegionType
  bbox: [number, number, number, number] // x0, y0, x1, y1，按页宽高归一化
  order: number // 本页内的阅读顺序
  content: string | null // MinerU 识别的内容：文字是 Markdown（行内公式 $...$），表格是 HTML，公式是 LaTeX
  level?: number
  changed?: boolean // 改过框或类型、新画的：内容要重取
}

export interface Layout {
  pages: { width: number; height: number }[]
  regions: Region[]
}

interface MjSpan {
  type: string
  content?: unknown
  bbox?: number[]
  index?: number
}

interface MjBlock {
  type: string
  index: number
  bbox: number[]
  level?: number
  content?: MjSpan[] | string
}

interface MiddleJson {
  extensions?: { docvortex_layout?: { pages?: { page_idx: number; width_pt: number; height_pt: number }[] } }
  pages: { page_idx: number; blocks: MjBlock[] }[]
}

const MAP: Record<string, RegionType> = {
  doc_title: 'title',
  paragraph_title: 'heading',
  text: 'text',
  list: 'list',
  code: 'code',
  equation: 'equation',
  interline_equation: 'equation',
  page_footnote: 'footnote',
  ref_text: 'reference',
  header: 'discard',
  footer: 'discard',
  page_number: 'discard',
  discarded: 'discard',
  image_body: 'image',
  chart_body: 'image',
  image_caption: 'caption',
  chart_caption: 'caption',
  image_footnote: 'caption',
  table_body: 'table',
  table_caption: 'caption',
  table_footnote: 'caption'
}

export function spansToMd(spans: MjSpan[] | string | undefined): string {
  if (typeof spans === 'string') return spans
  if (!spans) return ''
  return spans
    .map((s) => {
      const c = typeof s.content === 'string' ? s.content : Array.isArray(s.content) ? spansToMd(s.content as MjSpan[]) : ''
      if (s.type === 'equation_inline') return ` $${c.trim()}$ `
      return c
    })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function fromMiddle(j: MiddleJson): Layout {
  const sizes = j.extensions?.docvortex_layout?.pages ?? []
  const pages = j.pages.map((p) => {
    const sz = sizes.find((x) => x.page_idx === p.page_idx)
    return { width: sz?.width_pt ?? 612, height: sz?.height_pt ?? 792 }
  })
  const regions: Region[] = []
  for (const p of j.pages) {
    let order = 0
    for (const b of [...p.blocks].sort((x, y) => x.index - y.index)) {
      // 图、表、图表是复合块：身体和图注拆成单独的区域
      const parts: { type: string; bbox: number[]; content: MjSpan[] | string | undefined }[] =
        ['image', 'table', 'chart'].includes(b.type) && Array.isArray(b.content)
          ? (b.content as MjSpan[]).map((s) => ({ type: s.type, bbox: s.bbox ?? b.bbox, content: s.content as MjSpan[] | string | undefined }))
          : [{ type: b.type, bbox: b.bbox, content: b.content }]
      for (const part of parts) {
        const type = MAP[part.type] ?? 'text'
        regions.push({
          id: `p${p.page_idx}-${order}`,
          page: p.page_idx,
          type,
          bbox: part.bbox.slice(0, 4).map((v) => Math.round(v * 10000) / 10000) as Region['bbox'],
          order: order++,
          content: type === 'image' ? null : spansToMd(part.content) || null,
          level: b.level
        })
      }
    }
  }
  return { pages, regions }
}

// 按新版面生成 Markdown。textInBox：取某页某框里的 PDF 文字；crops：界面截好的图（区域 id → data URL）
export function toMarkdown(layout: Layout, textInBox: (page: number, bbox: Region['bbox']) => string, crops: Record<string, string>): string {
  const out: string[] = []
  const sorted = [...layout.regions].sort((a, b) => a.page - b.page || a.order - b.order)
  for (const r of sorted) {
    if (r.type === 'discard') continue
    const text = (): string => (r.changed || !r.content ? textInBox(r.page, r.bbox) : r.content).trim()
    switch (r.type) {
      case 'title': {
        const t = text()
        if (t) out.push(`# ${t.replace(/\n+/g, ' ')}`)
        break
      }
      case 'heading': {
        const t = text()
        if (t) out.push(`${(r.level ?? 2) > 2 ? '###' : '##'} ${t.replace(/\n+/g, ' ')}`)
        break
      }
      case 'image':
        if (crops[r.id]) out.push(`![](${crops[r.id]})`)
        break
      case 'table':
        if (!r.changed && r.content && /<table/i.test(r.content)) out.push(r.content)
        else if (crops[r.id]) out.push(`![](${crops[r.id]})`)
        break
      case 'equation':
        if (!r.changed && r.content) out.push(`$$\n${r.content.replace(/^\$+|\$+$/g, '').trim()}\n$$`)
        else if (crops[r.id]) out.push(`![](${crops[r.id]})`)
        break
      case 'code': {
        const t = text()
        if (t) out.push('```\n' + t + '\n```')
        break
      }
      case 'list': {
        const t = text()
        if (t) out.push(t.split(/\n+|(?=\s[•·▪●]\s)/).map((l) => `- ${l.replace(/^\s*[•·▪●-]\s*/, '').trim()}`).filter((l) => l.length > 2).join('\n'))
        break
      }
      default: {
        const t = text()
        if (t) out.push(t)
      }
    }
  }
  return out.join('\n\n') + '\n'
}
