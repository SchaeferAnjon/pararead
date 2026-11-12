import Database from 'better-sqlite3'
import type { Annotation, ChatMessage, Folder, Glance, Paper, ReadMode, ReadPosition, ReflowState, Tier, JobStatus } from '../shared/types'
import { t } from '../shared/i18n'

export type DB = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]',
  year INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  last_opened INTEGER,
  created_at INTEGER NOT NULL,
  last_mode TEXT,
  last_position TEXT,
  doi TEXT,
  source TEXT NOT NULL DEFAULT 'import',
  scholaread_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS papers_hash ON papers(file_hash);
CREATE TABLE IF NOT EXISTS page_text (
  paper_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (paper_id, page)
);
CREATE TABLE IF NOT EXISTS reflow (
  paper_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  log TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  PRIMARY KEY (paper_id, tier)
);
CREATE TABLE IF NOT EXISTS translations (
  key TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  color TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  page INTEGER,
  rects TEXT,
  block_id TEXT,
  block_hash TEXT,
  start INTEGER,
  "end" INTEGER,
  section TEXT NOT NULL DEFAULT '',
  source_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS annotations_paper ON annotations(paper_id);
CREATE UNIQUE INDEX IF NOT EXISTS annotations_source ON annotations(source_id) WHERE source_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  quote TEXT,
  image TEXT,
  created_at INTEGER NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS chats_paper ON chats(paper_id);
CREATE TABLE IF NOT EXISTS glances (
  paper_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_cache (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`

// 0.2 加的表：文件夹（可嵌套，一篇可在多个文件夹）、阅读时长、库级 AI 会话、AI 重点、参考文献缓存
const SCHEMA_2 = `
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_folders (
  paper_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, folder_id)
);
CREATE TABLE IF NOT EXISTS reading_log (
  paper_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (paper_id, day)
);
CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  paper_ids TEXT NOT NULL DEFAULT '[]',
  state TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_messages_session ON ai_messages(session_id);
CREATE TABLE IF NOT EXISTS sync_tombstones (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE TABLE IF NOT EXISTS paper_cache (
  paper_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (paper_id, kind)
);
`

const PAPER_COLS: [string, string][] = [
  ['venue', 'TEXT'],
  ['abstract', 'TEXT'],
  ['url', 'TEXT'],
  ['publisher', 'TEXT'],
  ['volume', 'TEXT'],
  ['issue', 'TEXT'],
  ['pages', 'TEXT'],
  ['published', 'TEXT'],
  ['arxiv', 'TEXT'],
  ['kind', "TEXT NOT NULL DEFAULT 'pdf'"],
  ['scanned', 'INTEGER NOT NULL DEFAULT 0'],
  ['engine', 'TEXT'],
  ['read_ms', 'INTEGER NOT NULL DEFAULT 0'],
  ['updated_at', 'INTEGER NOT NULL DEFAULT 0'], // 文献信息、文件夹、删除的改动时间（同步按它合并）
  ['read_updated_at', 'INTEGER NOT NULL DEFAULT 0'] // 阅读进度、位置、模式的改动时间（和上面分开合并）
]

export function openDb(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  db.exec(SCHEMA_2)
  const have = new Set((db.prepare('PRAGMA table_info(papers)').all() as { name: string }[]).map((c) => c.name))
  for (const [c, def] of PAPER_COLS) if (!have.has(c)) db.exec(`ALTER TABLE papers ADD COLUMN ${c} ${def}`)
  const folderCols = new Set((db.prepare('PRAGMA table_info(folders)').all() as { name: string }[]).map((c) => c.name))
  if (!folderCols.has('updated_at')) db.exec('ALTER TABLE folders ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
  const chatCols = new Set((db.prepare('PRAGMA table_info(chats)').all() as { name: string }[]).map((c) => c.name))
  if (!chatCols.has('reasoning')) db.exec('ALTER TABLE chats ADD COLUMN reasoning TEXT')
  if (!chatCols.has('paper_ids')) db.exec('ALTER TABLE chats ADD COLUMN paper_ids TEXT')
  if (!chatCols.has('think_ms')) db.exec('ALTER TABLE chats ADD COLUMN think_ms INTEGER')
  migrateTagsToFolders(db)
  return db
}

// 0.1 的标签变成文件夹：每个标签一个顶层文件夹，论文放进去；只做一次（记在 user_version）
function migrateTagsToFolders(db: DB): void {
  if ((db.pragma('user_version', { simple: true }) as number) >= 2) return
  const rows = db.prepare("SELECT id, tags FROM papers WHERE tags != '[]'").all() as { id: string; tags: string }[]
  const byName = new Map<string, string>()
  const tx = db.transaction(() => {
    for (const r of rows)
      for (const t_ of JSON.parse(r.tags) as string[]) {
        let fid = byName.get(t_)
        if (!fid) {
          fid = `f${byName.size + 1}${Date.now().toString(36)}`
          byName.set(t_, fid)
          db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)').run(fid, t_, Date.now())
        }
        db.prepare('INSERT OR IGNORE INTO paper_folders (paper_id, folder_id) VALUES (?, ?)').run(r.id, fid)
      }
    db.pragma('user_version = 2')
  })
  tx()
}

interface PaperRow {
  id: string
  title: string
  authors: string
  year: number | null
  tags: string
  file_name: string
  page_count: number
  progress: number
  last_opened: number | null
  created_at: number
  last_mode: string | null
  last_position: string | null
  doi: string | null
  source: string
  venue: string | null
  abstract: string | null
  url: string | null
  publisher: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  published: string | null
  arxiv: string | null
  kind: string
  scanned: number
  engine: string | null
  read_ms: number
}

interface ReflowRow {
  tier: Tier
  status: JobStatus
  error: string | null
  log: string | null
  started_at: number | null
}

export function reflowState(db: DB, paperId: string): ReflowState {
  const rows = db.prepare('SELECT tier, status, error, log, started_at FROM reflow WHERE paper_id = ?').all(paperId) as ReflowRow[]
  const by = new Map(rows.map((r) => [r.tier, r]))
  const st = (t_: Tier): JobStatus => by.get(t_)?.status ?? 'none'
  const ready: Tier | null = st('basic') === 'done' ? 'basic' : st('flash') === 'done' ? 'flash' : st('simple') === 'done' ? 'simple' : null
  const running = rows.find((r) => r.status === 'running')
  const failed = rows.find((r) => r.status === 'failed')
  return {
    ready,
    flash: st('flash'),
    basic: st('basic'),
    running: running?.tier ?? null,
    startedAt: running?.started_at ?? null,
    percent: null,
    logLine: running?.log ?? '',
    error: failed?.error ?? null
  }
}

export function rowToPaper(db: DB, r: PaperRow): Paper {
  return {
    id: r.id,
    title: r.title,
    authors: JSON.parse(r.authors),
    year: r.year,
    tags: JSON.parse(r.tags),
    pageCount: r.page_count,
    progress: r.progress,
    lastOpened: r.last_opened,
    createdAt: r.created_at,
    lastMode: (r.last_mode as ReadMode | null) ?? null,
    lastPosition: r.last_position ? (JSON.parse(r.last_position) as ReadPosition) : null,
    fileName: r.file_name,
    doi: r.doi,
    source: (r.source as Paper['source']) ?? 'import',
    reflow: reflowState(db, r.id),
    folders: (db.prepare('SELECT folder_id FROM paper_folders WHERE paper_id = ?').all(r.id) as { folder_id: string }[]).map((x) => x.folder_id),
    venue: r.venue,
    abstract: r.abstract,
    url: r.url,
    publisher: r.publisher,
    volume: r.volume,
    issue: r.issue,
    pages: r.pages,
    published: r.published,
    arxiv: r.arxiv,
    kind: r.kind === 'epub' || r.kind === 'link' ? r.kind : 'pdf',
    scanned: !!r.scanned,
    engine: (r.engine as Paper['engine']) ?? null,
    readMs: r.read_ms
  }
}

export function listPapers(db: DB): Paper[] {
  const rows = db.prepare('SELECT * FROM papers WHERE deleted = 0 ORDER BY COALESCE(last_opened, created_at) DESC').all() as PaperRow[]
  return rows.map((r) => rowToPaper(db, r))
}

export function getPaper(db: DB, id: string): Paper | null {
  const r = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as PaperRow | undefined
  return r ? rowToPaper(db, r) : null
}

export interface PaperPatch {
  title?: string
  authors?: string[]
  year?: number | null
  tags?: string[]
  progress?: number
  lastOpened?: number
  lastMode?: ReadMode
  lastPosition?: ReadPosition
  doi?: string | null
  venue?: string | null
  abstract?: string | null
  url?: string | null
  publisher?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  published?: string | null
  arxiv?: string | null
  scanned?: boolean
  engine?: Paper['engine']
}

const TEXT_COLS = ['doi', 'venue', 'abstract', 'url', 'publisher', 'volume', 'issue', 'pages', 'published', 'arxiv'] as const

export function updatePaper(db: DB, id: string, p: PaperPatch): void {
  const cols: string[] = []
  const vals: unknown[] = []
  const set = (c: string, v: unknown): void => {
    cols.push(`${c} = ?`)
    vals.push(v)
  }
  if (p.title !== undefined) set('title', p.title)
  if (p.authors !== undefined) set('authors', JSON.stringify(p.authors))
  if (p.year !== undefined) set('year', p.year)
  if (p.tags !== undefined) set('tags', JSON.stringify(p.tags))
  if (p.progress !== undefined) set('progress', p.progress)
  if (p.lastOpened !== undefined) set('last_opened', p.lastOpened)
  if (p.lastMode !== undefined) set('last_mode', p.lastMode)
  if (p.lastPosition !== undefined) set('last_position', JSON.stringify(p.lastPosition))
  const reading = cols.length > 0
  for (const c of TEXT_COLS) if (p[c] !== undefined) set(c, p[c])
  if (p.scanned !== undefined) set('scanned', p.scanned ? 1 : 0)
  if (p.engine !== undefined) set('engine', p.engine)
  if (!cols.length) return
  const onlyReading = p.title === undefined && p.authors === undefined && p.year === undefined && p.tags === undefined && TEXT_COLS.every((c) => p[c] === undefined)
  if (reading && onlyReading) set('read_updated_at', Date.now())
  else if (!onlyReading) set('updated_at', Date.now())
  db.prepare(`UPDATE papers SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id)
}

export function setReflow(db: DB, paperId: string, tier: Tier, status: JobStatus, extra: { error?: string | null; log?: string } = {}): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO reflow (paper_id, tier, status, error, log, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(paper_id, tier) DO UPDATE SET status = excluded.status, error = excluded.error,
       log = COALESCE(excluded.log, reflow.log),
       started_at = CASE WHEN excluded.status = 'running' THEN excluded.started_at ELSE reflow.started_at END,
       finished_at = excluded.finished_at`
  ).run(
    paperId,
    tier,
    status,
    extra.error ?? null,
    extra.log ?? null,
    status === 'running' ? now : null,
    status === 'done' || status === 'failed' ? now : null
  )
}

interface AnnRow {
  id: string
  paper_id: string
  mode: string
  color: string
  text: string
  note: string
  page: number | null
  rects: string | null
  block_id: string | null
  block_hash: string | null
  start: number | null
  end: number | null
  section: string
  created_at: number
  updated_at: number
}

function rowToAnn(r: AnnRow): Annotation {
  return {
    id: r.id,
    paperId: r.paper_id,
    mode: r.mode === 'reflow' ? 'reflow' : 'pdf',
    color: r.color as Annotation['color'],
    text: r.text,
    note: r.note,
    page: r.page,
    rects: r.rects ? JSON.parse(r.rects) : null,
    blockId: r.block_id,
    blockHash: r.block_hash,
    start: r.start,
    end: r.end,
    section: r.section,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listAnnotations(db: DB, paperId: string): Annotation[] {
  const rows = db.prepare('SELECT * FROM annotations WHERE paper_id = ? ORDER BY created_at').all(paperId) as AnnRow[]
  return rows.map(rowToAnn)
}

export function saveAnnotation(db: DB, a: Annotation, sourceId: string | null = null): void {
  db.prepare(
    `INSERT INTO annotations (id, paper_id, mode, color, text, note, page, rects, block_id, block_hash, start, "end", section, source_id, created_at, updated_at)
     VALUES (@id, @paperId, @mode, @color, @text, @note, @page, @rects, @blockId, @blockHash, @start, @end, @section, @sourceId, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET color = excluded.color, note = excluded.note, section = excluded.section,
       rects = excluded.rects, updated_at = excluded.updated_at`
  ).run({ ...a, rects: a.rects ? JSON.stringify(a.rects) : null, sourceId })
}

export function deleteAnnotation(db: DB, id: string): void {
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id)
  tombstone(db, 'ann', id)
}

// 同步用的删除记录：别的电脑看到后也删（比删除时间早改过的才删）
export function tombstone(db: DB, kind: 'paper' | 'folder' | 'ann', key: string, at = Date.now()): void {
  db.prepare('INSERT INTO sync_tombstones (kind, key, at) VALUES (?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET at = MAX(at, excluded.at)').run(kind, key, at)
}

interface ChatRow {
  id: string
  paper_id: string
  role: string
  content: string
  quote: string | null
  image: string | null
  created_at: number
  reasoning: string | null
  paper_ids: string | null
  think_ms: number | null
}

export function listChats(db: DB, paperId: string): ChatMessage[] {
  const rows = db.prepare('SELECT * FROM chats WHERE paper_id = ? AND cleared = 0 ORDER BY created_at, rowid').all(paperId) as ChatRow[]
  return rows.map((r) => ({
    id: r.id,
    paperId: r.paper_id,
    role: r.role === 'user' ? 'user' : 'assistant',
    content: r.content,
    quote: r.quote,
    image: r.image,
    createdAt: r.created_at,
    reasoning: r.reasoning,
    paperIds: r.paper_ids ? (JSON.parse(r.paper_ids) as string[]) : [],
    thinkMs: r.think_ms
  }))
}

export function addChat(db: DB, m: ChatMessage): void {
  db.prepare('INSERT INTO chats (id, paper_id, role, content, quote, image, created_at, reasoning, paper_ids, think_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    m.id,
    m.paperId,
    m.role,
    m.content,
    m.quote,
    m.image,
    m.createdAt,
    m.reasoning ?? null,
    m.paperIds?.length ? JSON.stringify(m.paperIds) : null,
    m.thinkMs ?? null
  )
}

export function getGlance(db: DB, paperId: string): Glance | null {
  const r = db.prepare('SELECT content FROM glances WHERE paper_id = ?').get(paperId) as { content: string } | undefined
  return r ? (JSON.parse(r.content) as Glance) : null
}

export function saveGlance(db: DB, paperId: string, g: Glance): void {
  db.prepare('INSERT OR REPLACE INTO glances (paper_id, content, created_at) VALUES (?, ?, ?)').run(paperId, JSON.stringify(g), Date.now())
}

export function getCachedTranslation(db: DB, key: string): string | null {
  const r = db.prepare('SELECT text FROM translations WHERE key = ?').get(key) as { text: string } | undefined
  return r?.text ?? null
}

export function putTranslation(db: DB, key: string, lang: string, text: string, model: string): void {
  db.prepare('INSERT OR REPLACE INTO translations (key, lang, text, model, created_at) VALUES (?, ?, ?, ?, ?)').run(key, lang, text, model, Date.now())
}

export function getAiCache(db: DB, key: string): string | null {
  const r = db.prepare('SELECT text FROM ai_cache WHERE key = ?').get(key) as { text: string } | undefined
  return r?.text ?? null
}

export function putAiCache(db: DB, key: string, text: string): void {
  db.prepare('INSERT OR REPLACE INTO ai_cache (key, text, created_at) VALUES (?, ?, ?)').run(key, text, Date.now())
}

// 文件夹
export function listFolders(db: DB): Folder[] {
  const rows = db.prepare('SELECT id, name, parent_id, created_at FROM folders ORDER BY name COLLATE NOCASE').all() as {
    id: string
    name: string
    parent_id: string | null
    created_at: number
  }[]
  const counts = new Map(
    (
      db
        .prepare('SELECT folder_id, COUNT(*) n FROM paper_folders pf JOIN papers p ON p.id = pf.paper_id AND p.deleted = 0 GROUP BY folder_id')
        .all() as { folder_id: string; n: number }[]
    ).map((r) => [r.folder_id, r.n])
  )
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, count: counts.get(r.id) ?? 0 }))
}

export function createFolder(db: DB, id: string, name: string, parentId: string | null): void {
  db.prepare('INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, parentId, Date.now(), Date.now())
}

export function renameFolder(db: DB, id: string, name: string): void {
  db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
}

export function moveFolder(db: DB, id: string, parentId: string | null): void {
  // 不能挪进自己的子孙
  let p = parentId
  while (p) {
    if (p === id) throw new Error(t('不能把文件夹挪进它自己的子文件夹'))
    p = (db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(p) as { parent_id: string | null } | undefined)?.parent_id ?? null
  }
  db.prepare('UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, Date.now(), id)
}

// 删文件夹连同子文件夹，论文本身不删
export function deleteFolder(db: DB, id: string): string[] {
  const all: string[] = []
  const walk = (fid: string): void => {
    all.push(fid)
    for (const c of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(fid) as { id: string }[]) walk(c.id)
  }
  walk(id)
  const tx = db.transaction(() => {
    for (const f of all) {
      db.prepare('DELETE FROM paper_folders WHERE folder_id = ?').run(f)
      db.prepare('DELETE FROM folders WHERE id = ?').run(f)
      tombstone(db, 'folder', f)
    }
  })
  tx()
  return all
}

export function setPaperFolders(db: DB, paperId: string, add: string[], remove: string[]): void {
  const tx = db.transaction(() => {
    for (const f of add) db.prepare('INSERT OR IGNORE INTO paper_folders (paper_id, folder_id) VALUES (?, ?)').run(paperId, f)
    for (const f of remove) db.prepare('DELETE FROM paper_folders WHERE paper_id = ? AND folder_id = ?').run(paperId, f)
    db.prepare('UPDATE papers SET updated_at = ? WHERE id = ?').run(Date.now(), paperId)
  })
  tx()
}

// 阅读时长：按天累计
export function addReadTime(db: DB, paperId: string, ms: number): void {
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  db.prepare('INSERT INTO reading_log (paper_id, day, ms) VALUES (?, ?, ?) ON CONFLICT(paper_id, day) DO UPDATE SET ms = ms + excluded.ms').run(paperId, day, ms)
  db.prepare('UPDATE papers SET read_ms = read_ms + ? WHERE id = ?').run(ms, paperId)
}

// 每篇论文的 AI 结果缓存（重点句、参考文献、核心概念、图表清单等），kind 区分
export function getPaperCache<T>(db: DB, paperId: string, kind: string): T | null {
  const r = db.prepare('SELECT content FROM paper_cache WHERE paper_id = ? AND kind = ?').get(paperId, kind) as { content: string } | undefined
  return r ? (JSON.parse(r.content) as T) : null
}

export function putPaperCache(db: DB, paperId: string, kind: string, v: unknown): void {
  db.prepare('INSERT OR REPLACE INTO paper_cache (paper_id, kind, content, created_at) VALUES (?, ?, ?, ?)').run(paperId, kind, JSON.stringify(v), Date.now())
}

export function delPaperCache(db: DB, paperId: string, kind: string): void {
  db.prepare('DELETE FROM paper_cache WHERE paper_id = ? AND kind = ?').run(paperId, kind)
}
