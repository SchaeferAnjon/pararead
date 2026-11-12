import type { Annotation, Paper } from '../shared/types'

const COLOR_NAME: Record<string, string> = { yellow: '黄', green: '绿', blue: '蓝', red: '红' }

// 高亮和笔记导出成 Markdown：按小节分组，原文用引用块，笔记跟在下面。给 Obsidian 用。
// sectionOrder 是对照模式里的标题顺序；原文模式的高亮按页码排在没有小节名的组里。
export function exportMarkdown(paper: Paper, anns: Annotation[], sectionOrder: string[]): string {
  const lines: string[] = []
  lines.push(`# ${paper.title}`)
  lines.push('')
  const meta: string[] = []
  if (paper.authors.length) meta.push(`作者：${paper.authors.join(', ')}`)
  if (paper.year) meta.push(`年份：${paper.year}`)
  if (paper.doi) meta.push(`DOI：${paper.doi}`)
  if (meta.length) {
    lines.push(meta.join('  \n'))
    lines.push('')
  }
  lines.push(`共 ${anns.length} 条高亮和笔记，导出于 ${new Date().toISOString().slice(0, 10)}。`)
  lines.push('')

  const groups = new Map<string, Annotation[]>()
  for (const a of anns) {
    const key = a.section || (a.page ? `第 ${a.page} 页` : '未分节')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }
  const rank = (k: string): number => {
    const i = sectionOrder.indexOf(k)
    if (i >= 0) return i
    const p = /^第 (\d+) 页$/.exec(k)
    return p ? 10000 + Number(p[1]) : 20000
  }
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b))
  for (const k of keys) {
    lines.push(`## ${k}`)
    lines.push('')
    const list = groups.get(k)!.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.start ?? 0) - (b.start ?? 0) || a.createdAt - b.createdAt)
    for (const a of list) {
      const where = a.mode === 'pdf' && a.page ? `（原文 第 ${a.page} 页，${COLOR_NAME[a.color]}）` : `（${COLOR_NAME[a.color]}）`
      lines.push(...a.text.split('\n').map((l) => `> ${l}`))
      lines.push(`> ${where}`)
      lines.push('')
      if (a.note.trim()) {
        lines.push(a.note.trim())
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}

export function safeFileName(s: string): string {
  return s.replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '笔记'
}
