// 多设备同步（iCloud 云盘）：同一个 Apple ID 的几台 Mac 共用 iCloud 云盘里的「ParaRead 同步」文件夹。
// 每台电脑把自己文献库的状态写成一份快照 devices/<设备>.json（论文按文件哈希认、文件夹、高亮笔记、速览、删除记录），
// 读别的电脑的快照，每条记录按更新时间「谁晚听谁的」合并；PDF / EPUB 按哈希放在 papers/ 下，缺的从这里导入。
// 不把 SQLite 放进 iCloud（会被同步弄坏），也不需要登录。
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Annotation, Glance, ReadMode, ReadPosition } from '../shared/types'
import type { Ctx } from './ctx'
import { getGlance, listAnnotations, saveAnnotation, saveGlance, tombstone, type DB } from './db'
import { t } from '../shared/i18n'
import { IS_WIN } from './platform'

// iCloud 云盘在本机的位置：Mac 的 Mobile Documents，Windows 版 iCloud 的 iCloudDrive
export const ICLOUD = IS_WIN ? join(homedir(), 'iCloudDrive') : join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs')

interface SnapPaper {
  hash: string
  kind: string
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  venue: string | null
  abstract: string | null
  url: string | null
  publisher: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  published: string | null
  arxiv: string | null
  progress: number
  lastOpened: number | null
  lastMode: ReadMode | null
  lastPosition: ReadPosition | null
  createdAt: number
  updatedAt: number
  readAt: number // 阅读状态的改动时间
  deleted: boolean
  folders: string[]
  fileName: string
}

interface SnapFolder {
  id: string
  name: string
  parentId: string | null
  updatedAt: number
}

type SnapAnn = Omit<Annotation, 'paperId'> & { paperHash: string }

export interface Snapshot {
  version: 1
  device: string
  deviceName: string
  at: number
  papers: SnapPaper[]
  folders: SnapFolder[]
  anns: SnapAnn[]
  glances: { hash: string; content: Glance; at: number }[]
  tombstones: { kind: 'paper' | 'folder' | 'ann'; key: string; at: number }[]
}

export interface SyncStatus {
  enabled: boolean
  dir: string
  lastSync: number | null
  devices: { name: string; at: number }[]
  waiting: number // 还在等 iCloud 下载的文件
  error: string | null
}

export function makeSnapshot(db: DB, device: string, deviceName: string): Snapshot {
  const rows = db.prepare("SELECT * FROM papers WHERE file_hash NOT LIKE 'tmp:%'").all() as Record<string, unknown>[]
  const folderRows = db.prepare('SELECT id, name, parent_id, updated_at, created_at FROM folders').all() as { id: string; name: string; parent_id: string | null; updated_at: number; created_at: number }[]
  const hashOf = new Map(rows.map((r) => [r.id as string, r.file_hash as string]))
  const papers: SnapPaper[] = rows.map((r) => ({
    hash: r.file_hash as string,
    kind: r.kind as string,
    title: r.title as string,
    authors: JSON.parse(r.authors as string),
    year: r.year as number | null,
    doi: r.doi as string | null,
    venue: r.venue as string | null,
    abstract: r.abstract as string | null,
    url: r.url as string | null,
    publisher: r.publisher as string | null,
    volume: r.volume as string | null,
    issue: r.issue as string | null,
    pages: r.pages as string | null,
    published: r.published as string | null,
    arxiv: r.arxiv as string | null,
    progress: r.progress as number,
    lastOpened: r.last_opened as number | null,
    lastMode: r.last_mode as ReadMode | null,
    lastPosition: r.last_position ? JSON.parse(r.last_position as string) : null,
    createdAt: r.created_at as number,
    updatedAt: (r.updated_at as number) || (r.created_at as number) || 1,
    readAt: (r.read_updated_at as number) || 0,
    deleted: !!r.deleted,
    folders: (db.prepare('SELECT folder_id FROM paper_folders WHERE paper_id = ?').all(r.id) as { folder_id: string }[]).map((x) => x.folder_id),
    fileName: r.file_name as string
  }))
  const anns: SnapAnn[] = []
  for (const r of rows) for (const a of listAnnotations(db, r.id as string)) anns.push({ ...a, paperHash: hashOf.get(a.paperId)! })
  const glances = rows
    .map((r) => ({ hash: r.file_hash as string, g: getGlance(db, r.id as string), at: (db.prepare('SELECT created_at FROM glances WHERE paper_id = ?').get(r.id) as { created_at: number } | undefined)?.created_at ?? 0 }))
    .filter((x) => x.g)
    .map((x) => ({ hash: x.hash, content: x.g!, at: x.at }))
  const tombstones = db.prepare('SELECT kind, key, at FROM sync_tombstones').all() as Snapshot['tombstones']
  return {
    version: 1,
    device,
    deviceName,
    at: Date.now(),
    papers,
    // 0.2 之前建的文件夹没有更新时间，用创建时间
    folders: folderRows.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, updatedAt: f.updated_at || f.created_at || 1 })),
    anns: anns.map((a) => {
      const { paperId: _omit, ...rest } = a as Annotation & { paperHash: string }
      return rest
    }),
    glances,
    tombstones
  }
}

export interface MergeResult {
  changed: number
  needFiles: { hash: string; kind: string; meta: SnapPaper }[]
}

// 把别的电脑的快照合进本机：每条记录更新时间晚的赢；本机缺论文文件的记下来，等文件到了再导入
export function mergeSnapshot(db: DB, s: Snapshot): MergeResult {
  let changed = 0
  const needFiles: MergeResult['needFiles'] = []
  const idByHash = new Map((db.prepare('SELECT id, file_hash FROM papers').all() as { id: string; file_hash: string }[]).map((r) => [r.file_hash, r.id]))
  const tombAt = (kind: string, key: string): number => (db.prepare('SELECT at FROM sync_tombstones WHERE kind = ? AND key = ?').get(kind, key) as { at: number } | undefined)?.at ?? 0
  const tx = db.transaction(() => {
    // 删除记录
    for (const t_ of s.tombstones) {
      if (t_.kind === 'paper') {
        const id = idByHash.get(t_.key)
        const p = id ? (db.prepare('SELECT updated_at, deleted FROM papers WHERE id = ?').get(id) as { updated_at: number; deleted: number }) : null
        if (p && !p.deleted && p.updated_at < t_.at) {
          db.prepare('UPDATE papers SET deleted = 1, updated_at = ? WHERE id = ?').run(t_.at, id)
          changed++
        }
      } else if (t_.kind === 'folder') {
        const f = db.prepare('SELECT updated_at FROM folders WHERE id = ?').get(t_.key) as { updated_at: number } | undefined
        if (f && f.updated_at < t_.at) {
          db.prepare('DELETE FROM paper_folders WHERE folder_id = ?').run(t_.key)
          db.prepare('DELETE FROM folders WHERE id = ?').run(t_.key)
          changed++
        }
      } else {
        const a = db.prepare('SELECT updated_at FROM annotations WHERE id = ?').get(t_.key) as { updated_at: number } | undefined
        if (a && a.updated_at < t_.at) {
          db.prepare('DELETE FROM annotations WHERE id = ?').run(t_.key)
          changed++
        }
      }
      if (tombAt(t_.kind, t_.key) < t_.at) tombstone(db, t_.kind, t_.key, t_.at)
    }
    // 文件夹
    for (const f of s.folders) {
      if (tombAt('folder', f.id) >= f.updatedAt) continue
      const cur = db.prepare('SELECT updated_at FROM folders WHERE id = ?').get(f.id) as { updated_at: number } | undefined
      if (!cur) {
        db.prepare('INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(f.id, f.name, f.parentId, f.updatedAt, f.updatedAt)
        changed++
      } else if (cur.updated_at < f.updatedAt) {
        db.prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?').run(f.name, f.parentId, f.updatedAt, f.id)
        changed++
      }
    }
    // 论文
    for (const p of s.papers) {
      if (tombAt('paper', p.hash) >= p.updatedAt) continue
      const id = idByHash.get(p.hash)
      if (!id) {
        if (!p.deleted) needFiles.push({ hash: p.hash, kind: p.kind, meta: p })
        continue
      }
      const cur = db.prepare('SELECT updated_at, read_updated_at FROM papers WHERE id = ?').get(id) as { updated_at: number; read_updated_at: number }
      if (cur.updated_at < p.updatedAt) {
        applyLibrary(db, id, p)
        changed++
      }
      if (cur.read_updated_at < p.readAt) {
        applyReading(db, id, p)
        changed++
      }
    }
    // 高亮和笔记
    const fresh = new Map((db.prepare('SELECT id, file_hash FROM papers').all() as { id: string; file_hash: string }[]).map((r) => [r.file_hash, r.id]))
    for (const a of s.anns) {
      const pid = fresh.get(a.paperHash)
      if (!pid || tombAt('ann', a.id) >= a.updatedAt) continue
      const cur = db.prepare('SELECT updated_at FROM annotations WHERE id = ?').get(a.id) as { updated_at: number } | undefined
      if (cur && cur.updated_at >= a.updatedAt) continue
      const { paperHash: _h, ...rest } = a
      if (cur) db.prepare('DELETE FROM annotations WHERE id = ?').run(a.id)
      saveAnnotation(db, { ...rest, paperId: pid })
      changed++
    }
    for (const g of s.glances) {
      const pid = fresh.get(g.hash)
      if (pid && !getGlance(db, pid)) {
        saveGlance(db, pid, g.content)
        changed++
      }
    }
  })
  tx()
  return { changed, needFiles }
}

export function applyPaper(db: DB, id: string, p: SnapPaper): void {
  applyLibrary(db, id, p)
  applyReading(db, id, p)
}

function applyReading(db: DB, id: string, p: SnapPaper): void {
  db.prepare('UPDATE papers SET progress = ?, last_opened = ?, last_mode = ?, last_position = ?, read_updated_at = ? WHERE id = ?').run(
    p.progress,
    p.lastOpened,
    p.lastMode,
    p.lastPosition ? JSON.stringify(p.lastPosition) : null,
    p.readAt,
    id
  )
}

function applyLibrary(db: DB, id: string, p: SnapPaper): void {
  db.prepare(
    `UPDATE papers SET title = ?, authors = ?, year = ?, doi = ?, venue = ?, abstract = ?, url = ?, publisher = ?, volume = ?, issue = ?, pages = ?,
     published = ?, arxiv = ?, deleted = ?, updated_at = ? WHERE id = ?`
  ).run(
    p.title,
    JSON.stringify(p.authors),
    p.year,
    p.doi,
    p.venue,
    p.abstract,
    p.url,
    p.publisher,
    p.volume,
    p.issue,
    p.pages,
    p.published,
    p.arxiv,
    p.deleted ? 1 : 0,
    p.updatedAt,
    id
  )
  const have = (db.prepare('SELECT folder_id FROM paper_folders WHERE paper_id = ?').all(id) as { folder_id: string }[]).map((x) => x.folder_id)
  for (const f of have) if (!p.folders.includes(f)) db.prepare('DELETE FROM paper_folders WHERE paper_id = ? AND folder_id = ?').run(id, f)
  for (const f of p.folders) if (db.prepare('SELECT 1 FROM folders WHERE id = ?').get(f)) db.prepare('INSERT OR IGNORE INTO paper_folders (paper_id, folder_id) VALUES (?, ?)').run(id, f)
}

export class Sync {
  private timer: ReturnType<typeof setInterval> | null = null
  private dirty: ReturnType<typeof setTimeout> | null = null
  private running: Promise<SyncStatus> | null = null
  status: SyncStatus

  constructor(private c: Ctx, private device: string) {
    this.status = { enabled: false, dir: '', lastSync: null, devices: [], waiting: 0, error: null }
  }

  dir(): string {
    return this.c.settings.get().syncDir || join(ICLOUD, 'ParaRead 同步')
  }

  start(): void {
    this.stop()
    const s = this.c.settings.get()
    this.status = { ...this.status, enabled: s.syncEnabled, dir: this.dir() }
    if (!s.syncEnabled) return
    void this.run()
    this.timer = setInterval(() => void this.run(), 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // 本机有改动：5 秒后同步一次（连续改动只同步一次）
  touch(): void {
    if (!this.c.settings.get().syncEnabled) return
    if (this.dirty) clearTimeout(this.dirty)
    this.dirty = setTimeout(() => void this.run(), 5000)
  }

  // 正在同步时再叫一次：等这一轮做完，返回它的结果
  run(): Promise<SyncStatus> {
    if (!this.c.settings.get().syncEnabled) return Promise.resolve(this.status)
    this.running ??= this.once().finally(() => (this.running = null))
    return this.running
  }

  private async once(): Promise<SyncStatus> {
    try {
      const dir = this.dir()
      if (dir.startsWith(ICLOUD) && !existsSync(ICLOUD)) throw new Error(t('这台 Mac 没有开 iCloud 云盘'))
      mkdirSync(join(dir, 'devices'), { recursive: true })
      mkdirSync(join(dir, 'papers'), { recursive: true })
      const { db, library } = this.c
      // 1. 本机的论文文件放上去（按哈希，已有就不放）
      for (const r of db.prepare("SELECT id, file_hash, kind FROM papers WHERE deleted = 0 AND kind IN ('pdf', 'epub')").all() as { id: string; file_hash: string; kind: string }[]) {
        const dest = join(dir, 'papers', `${r.file_hash}.${r.kind}`)
        if (existsSync(dest) || existsSync(placeholder(dest))) continue
        const src = r.kind === 'epub' ? library.epubPath(r.id) : library.pdfPath(r.id)
        if (existsSync(src)) copyFileSync(src, dest)
      }
      // 2. 本机快照
      const snap = makeSnapshot(db, this.device, hostname().replace(/\.local$/, ''))
      const mine = join(dir, 'devices', `${this.device}.json`)
      writeFileSync(mine + '.tmp', JSON.stringify(snap))
      renameSync(mine + '.tmp', mine)
      // 3. 读别的电脑的快照，合并
      let changed = 0
      let waiting = 0
      const devices: SyncStatus['devices'] = []
      for (const name of readdirSync(join(dir, 'devices'))) {
        const f = join(dir, 'devices', name)
        if (name.endsWith('.icloud')) {
          download(join(dir, 'devices', name.replace(/^\./, '').replace(/\.icloud$/, '')))
          continue
        }
        if (!name.endsWith('.json') || name === `${this.device}.json`) continue
        let s: Snapshot
        try {
          s = JSON.parse(readFileSync(f, 'utf8')) as Snapshot
        } catch {
          continue // 正在写或下载了一半，下次再读
        }
        devices.push({ name: s.deviceName, at: s.at })
        const r = mergeSnapshot(db, s)
        changed += r.changed
        for (const need of r.needFiles) {
          const file = join(dir, 'papers', `${need.hash}.${need.kind}`)
          if (!existsSync(file) || statSync(file).size === 0) {
            if (existsSync(placeholder(file))) download(file)
            if (need.kind !== 'link') {
              waiting++
              continue
            }
          }
          const m = need.meta
          const res =
            need.kind === 'link'
              ? library.addLink({ ...m, title: m.title }, 'sync')
              : await library.importFile(file, { title: m.title, authors: m.authors, source: 'sync', fileName: m.fileName, createdAt: m.createdAt, lastOpened: m.lastOpened, meta: m })
          if (res.status === 'added') {
            applyPaper(db, res.paper.id, m)
            this.c.afterImport(res.paper.id)
            changed++
          }
        }
        // 文件进来以后再合一次笔记
        if (r.needFiles.length) changed += mergeSnapshot(db, s).changed
      }
      this.status = { enabled: true, dir, lastSync: Date.now(), devices, waiting, error: null }
      if (changed) this.c.broadcast('library:changed', null)
    } catch (e) {
      this.status = { ...this.status, error: (e as Error).message }
      this.c.log(`同步失败：${(e as Error).message}`)
    } finally {
      this.c.broadcast('sync:status', this.status)
    }
    return this.status
  }
}

// Mac 上 iCloud 还没下载到本机的文件是 .名字.icloud 的占位；Windows 版 iCloud 读的时候自己下载，没有占位
function placeholder(f: string): string {
  return join(dirname(f), `.${basename(f)}.icloud`)
}

function download(f: string): void {
  if (!IS_WIN) execFile('/usr/bin/brctl', ['download', f], { timeout: 10_000 }, () => {})
}

