import { bibKey, formatCitation } from './cite'
import type { Paper } from './types'

// 整个文献库的 BibTeX：每篇一个 key，撞车的按加进库的先后，第一篇不变，后面的加 a、b、c（Better BibTeX 的做法）。
// 先进库的论文 key 永远不变，后加的论文不会把已经写进 .tex 里的 \cite 改掉。

type P = Pick<Paper, 'id' | 'createdAt' | 'title' | 'authors' | 'year' | 'venue' | 'volume' | 'issue' | 'pages' | 'doi' | 'url' | 'publisher' | 'arxiv'>

const suffix = (n: number): string => {
  // 1 → a … 26 → z，27 → aa
  let s = ''
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s
  return s
}

export function bibKeys(papers: P[]): Map<string, string> {
  const order = [...papers].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const p of order) {
    const base = bibKey(p)
    let key = base
    for (let n = 1; used.has(key); n++) key = base + suffix(n)
    used.add(key)
    out.set(p.id, key)
  }
  return out
}

/** 一篇的 BibTeX 条目，key 换成去重后的 */
export function bibEntry(p: P, key: string): string {
  return formatCitation(p, 'bibtex').replace(/^(@\w+\{)[^,]*,/, `$1${key},`)
}

/** 整个 .bib 文件：按 key 排，文件头一行注释说明是谁写的、别手改 */
export function bibFile(papers: P[]): string {
  const keys = bibKeys(papers)
  const rows = papers.map((p) => ({ key: keys.get(p.id)!, p })).sort((a, b) => a.key.localeCompare(b.key))
  return `% Exported by ParaRead: ${rows.length} entries. Rewritten whenever the library changes; do not edit by hand.\n\n${rows.map((r) => bibEntry(r.p, r.key)).join('\n\n')}\n`
}
