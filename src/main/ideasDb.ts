// 灵感库的存取（表在 db.ts 的 SCHEMA_IDEAS）
import { bibKeys } from '../shared/bib'
import { cleanTopics } from '../shared/ideas'
import type { Idea, IdeaEntry } from '../shared/types'
import { listPapers, tombstone, type DB } from './db'

interface IdeaRow {
  id: string
  paper_id: string
  mode: string
  text: string
  page: number | null
  rects: string | null
  block_id: string | null
  block_hash: string | null
  start: number | null
  end: number | null
  section: string
  use_note: string
  topics: string
  how: string
  paraphrase: string | null
  created_at: number
  updated_at: number
}

const rowToIdea = (r: IdeaRow): Idea => ({
  id: r.id,
  paperId: r.paper_id,
  mode: r.mode === 'pdf' ? 'pdf' : 'reflow',
  text: r.text,
  page: r.page,
  rects: r.rects ? JSON.parse(r.rects) : null,
  blockId: r.block_id,
  blockHash: r.block_hash,
  start: r.start,
  end: r.end,
  section: r.section,
  use: r.use_note,
  topics: JSON.parse(r.topics) as string[],
  how: r.how === 'paraphrase' ? 'paraphrase' : 'quote',
  paraphrase: r.paraphrase ? JSON.parse(r.paraphrase) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listIdeas(db: DB, paperId: string): Idea[] {
  return (db.prepare('SELECT * FROM ideas WHERE paper_id = ? ORDER BY created_at').all(paperId) as IdeaRow[]).map(rowToIdea)
}

export function getIdea(db: DB, id: string): Idea | null {
  const r = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id) as IdeaRow | undefined
  return r ? rowToIdea(r) : null
}

/** 新的一条或改用法、主题、写论文时怎么用、转述；位置（段、偏移、矩形）建好以后不变 */
export function saveIdea(db: DB, i: Idea): void {
  db.prepare(
    `INSERT INTO ideas (id, paper_id, mode, text, page, rects, block_id, block_hash, start, "end", section, use_note, topics, how, paraphrase, created_at, updated_at)
     VALUES (@id, @paperId, @mode, @text, @page, @rects, @blockId, @blockHash, @start, @end, @section, @use, @topics, @how, @paraphrase, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET use_note = excluded.use_note, topics = excluded.topics, how = excluded.how, paraphrase = excluded.paraphrase,
       page = COALESCE(excluded.page, page), section = excluded.section, updated_at = excluded.updated_at`
  ).run({
    ...i,
    use: i.use.trim(),
    topics: JSON.stringify(cleanTopics(i.topics)),
    rects: i.rects ? JSON.stringify(i.rects) : null,
    paraphrase: i.paraphrase && Object.values(i.paraphrase).some(Boolean) ? JSON.stringify(i.paraphrase) : null
  })
}

export function deleteIdea(db: DB, id: string, at = Date.now()): void {
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id)
  tombstone(db, 'idea', id, at)
}

/** 全库的灵感，连着论文；bibKey 和自动导出的 .bib 用同一套（整个文献库去重） */
export function allIdeas(db: DB): IdeaEntry[] {
  const papers = listPapers(db)
  const keys = bibKeys(papers)
  const byId = new Map(papers.map((p) => [p.id, p]))
  const rows = db.prepare('SELECT * FROM ideas ORDER BY created_at DESC').all() as IdeaRow[]
  const out: IdeaEntry[] = []
  for (const r of rows) {
    const p = byId.get(r.paper_id)
    if (!p) continue // 论文删了
    out.push({ ...rowToIdea(r), paperTitle: p.title, paperAuthors: p.authors, paperYear: p.year, bibKey: keys.get(p.id) ?? '' })
  }
  return out
}
