import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HlColor } from '../shared/types'

export const SCHOLAREAD_DIR = join(homedir(), 'Library/Application Support/scholaread')

export interface SrPaperRow {
  _id: number
  reading_id: string | null
  title: string | null
  name: string | null
  authors: string | null
  tags: string | null
  file_path: string | null
  cache_path: string | null
  doi: string | null
  read_at: string | null
  create_at: string | null
  read_mode: string | null
}

export interface SrNoteRow {
  _id: number
  note_id: string
  paper_row_id: number
  type: string
  text: string | null
  lines: string | null
  note_content: string | null
  create_at: string | number | null
  update_at: string | number | null
  mark_style: string | null
}

export interface MappedPaper {
  srId: number
  title: string
  authors: string[]
  tags: string[]
  file: string | null
  doi: string | null
  createdAt: number
  readAt: number | null
  readMode: 'reflow' | 'pdf'
}

export interface MappedNote {
  sourceId: string
  srPaperId: number
  kind: 'mark' | 'note'
  color: HlColor
  text: string
  note: string
  page: number | null
  createdAt: number
}

function toTime(v: string | number | null): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

// 文件优先用 file_path，不存在就找 Scholaread 自己的缓存 files/pdf/<cache_path>
export function mapPaper(r: SrPaperRow, baseDir: string, exists: (p: string) => boolean = existsSync): MappedPaper {
  let authors: string[] = []
  if (r.authors) {
    try {
      const arr = JSON.parse(r.authors) as { name?: string }[]
      authors = arr.map((a) => (a.name ?? '').trim()).filter(Boolean)
    } catch {
      authors = []
    }
  }
  let tags: string[] = []
  if (r.tags) {
    try {
      const arr = JSON.parse(r.tags) as (string | { name?: string })[]
      tags = arr.map((t) => (typeof t === 'string' ? t : (t.name ?? ''))).filter(Boolean)
    } catch {
      tags = []
    }
  }
  let file: string | null = null
  if (r.file_path && exists(r.file_path)) file = r.file_path
  else if (r.cache_path) {
    const cached = join(baseDir, 'files/pdf', r.cache_path)
    if (exists(cached)) file = cached
  }
  return {
    srId: r._id,
    title: (r.title || r.name || '未命名').trim(),
    authors,
    tags,
    file,
    doi: r.doi || null,
    createdAt: toTime(r.create_at) ?? Date.now(),
    readAt: toTime(r.read_at),
    readMode: r.read_mode && r.read_mode.includes('reflow') ? 'reflow' : 'pdf'
  }
}

// mark 是高亮，note 是带笔记的高亮。颜色为空（它默认的紫）和 yellow 都映射成黄。
// lines 里的 p 是页码（从 1 开始），取第一段的页。
export function mapNote(r: SrNoteRow): MappedNote {
  let color: HlColor = 'yellow'
  if (r.mark_style) {
    try {
      const s = JSON.parse(r.mark_style) as { color?: string }
      const c = (s.color ?? '').toLowerCase()
      if (c === 'green' || c === 'blue' || c === 'red') color = c
    } catch {
      color = 'yellow'
    }
  }
  let page: number | null = null
  if (r.lines) {
    try {
      const arr = JSON.parse(r.lines) as { p?: number }[]
      if (arr.length && typeof arr[0].p === 'number') page = arr[0].p
    } catch {
      page = null
    }
  }
  return {
    sourceId: `scholaread:${r.note_id}`,
    srPaperId: r.paper_row_id,
    kind: r.type === 'note' ? 'note' : 'mark',
    color,
    text: (r.text ?? '').trim(),
    note: (r.note_content ?? '').trim(),
    page,
    createdAt: toTime(r.create_at) ?? Date.now()
  }
}

// 只读打开 Scholaread 的库，读完立刻关；绝不写它
export function readScholaread(dbFile = join(SCHOLAREAD_DIR, 'scholaread.sqlite')): { papers: SrPaperRow[]; notes: SrNoteRow[] } {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true })
  try {
    const papers = db
      .prepare('SELECT _id, reading_id, title, name, authors, tags, file_path, cache_path, doi, read_at, create_at, read_mode FROM reading_list ORDER BY _id')
      .all() as SrPaperRow[]
    const notes = db
      .prepare('SELECT _id, note_id, paper_row_id, type, text, lines, note_content, create_at, update_at, mark_style FROM notes ORDER BY _id')
      .all() as SrNoteRow[]
    return { papers, notes }
  } finally {
    db.close()
  }
}
