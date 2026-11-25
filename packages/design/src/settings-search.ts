/**
 * 搜设置（画布笔记、画布今日侧栏顶上的搜索框共用，对标清单 U6）：每个词都要打中（名字、说明、别的叫法、组名、页名，几个词用空格隔开）；
 * 名字里有 3 分、别的叫法里有 2 分、组名里有 1 分，分高的在前，同分照表里的顺序。纯函数，不碰各软件的翻译：
 * fields 交回这一项要比的几段字（要两种语言都认就把两种拼在一起交）。
 */
export interface SearchFields {
  label: string
  desc?: string
  kw?: string
  grp: string
  page: string
}

export function searchItems<T>(items: readonly T[], query: string, fields: (it: T) => SearchFields): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const words = q.split(/\s+/)
  const hits: [number, T][] = []
  for (const it of items) {
    const f = fields(it)
    const label = f.label.toLowerCase()
    const grp = f.grp.toLowerCase()
    const kw = (f.kw ?? '').toLowerCase()
    const hay = [label, (f.desc ?? '').toLowerCase(), kw, grp, f.page.toLowerCase()].join(' ')
    if (!words.every((w) => hay.includes(w))) continue
    hits.push([(label.includes(q) ? 3 : 0) + (kw.includes(q) ? 2 : 0) + (grp.includes(q) ? 1 : 0), it])
  }
  return hits.sort((a, b) => b[0] - a[0]).map((h) => h[1])
}
