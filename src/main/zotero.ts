// Zotero 一键导入：只读 Zotero 的本地库（先复制一份，Zotero 开着时原库是锁住的），列出文件夹和每篇的 PDF 附件。
// 不改、不挪、不删 Zotero 里的任何东西。文件夹层级照搬成我们的文件夹。
import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ZoteroCollection {
  id: number
  name: string
  parentId: number | null
  count: number // 这个文件夹里（不含子文件夹）有 PDF 的条目数
}

export interface ZoteroItem {
  itemId: number
  key: string
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  venue: string | null
  abstract: string | null
  url: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  publisher: string | null
  file: string | null // PDF 的绝对路径，null 是没有本地 PDF
  fileType: string | null
  collections: number[]
}

export interface ZoteroLibrary {
  dir: string
  collections: ZoteroCollection[]
  items: ZoteroItem[]
}

// Zotero 的数据目录：默认 ~/Zotero，用户改过的在 prefs.js 的 extensions.zotero.dataDir
export function findZoteroDir(home = homedir()): string | null {
  const profiles = join(home, 'Library/Application Support/Zotero/Profiles')
  if (existsSync(profiles))
    for (const p of readdirSync(profiles)) {
      const prefs = join(profiles, p, 'prefs.js')
      if (!existsSync(prefs)) continue
      const m = /user_pref\("extensions\.zotero\.dataDir",\s*"([^"]+)"\)/.exec(readFileSync(prefs, 'utf8'))
      const custom = /user_pref\("extensions\.zotero\.useDataDir",\s*true\)/.test(readFileSync(prefs, 'utf8'))
      if (m && custom && existsSync(join(m[1], 'zotero.sqlite'))) return m[1]
    }
  const def = join(home, 'Zotero')
  return existsSync(join(def, 'zotero.sqlite')) ? def : null
}

export function readZotero(dir: string): ZoteroLibrary {
  const tmp = mkdtempSync(join(tmpdir(), 'sr-zotero-'))
  const copy = join(tmp, 'zotero.sqlite')
  copyFileSync(join(dir, 'zotero.sqlite'), copy)
  const db = new Database(copy, { readonly: true, fileMustExist: true })
  try {
    const field = (name: string): number | null => (db.prepare('SELECT fieldID FROM fields WHERE fieldName = ?').get(name) as { fieldID: number } | undefined)?.fieldID ?? null
    const F = Object.fromEntries(
      ['title', 'date', 'DOI', 'publicationTitle', 'proceedingsTitle', 'conferenceName', 'abstractNote', 'url', 'volume', 'issue', 'pages', 'publisher'].map((n) => [n, field(n)])
    )
    const deleted = new Set(tableExists(db, 'deletedItems') ? (db.prepare('SELECT itemID FROM deletedItems').all() as { itemID: number }[]).map((r) => r.itemID) : [])

    // 父条目：不是附件、不是笔记
    const parents = db
      .prepare(
        `SELECT i.itemID, i.key FROM items i JOIN itemTypes t ON t.itemTypeID = i.itemTypeID
         WHERE t.typeName NOT IN ('attachment', 'note', 'annotation')`
      )
      .all() as { itemID: number; key: string }[]
    const value = db.prepare(
      `SELECT v.value FROM itemData d JOIN itemDataValues v ON v.valueID = d.valueID WHERE d.itemID = ? AND d.fieldID = ?`
    )
    const get = (id: number, f: number | null): string | null => (f ? ((value.get(id, f) as { value: string } | undefined)?.value ?? null) : null)
    const creators = db.prepare(
      `SELECT c.firstName, c.lastName FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID WHERE ic.itemID = ? ORDER BY ic.orderIndex`
    )
    const attachments = db.prepare(
      `SELECT a.itemID, i.key, a.path, a.contentType FROM itemAttachments a JOIN items i ON i.itemID = a.itemID WHERE a.parentItemID = ? ORDER BY a.itemID`
    )
    const inCols = db.prepare('SELECT collectionID FROM collectionItems WHERE itemID = ?')

    const items: ZoteroItem[] = []
    for (const p of parents) {
      if (deleted.has(p.itemID)) continue
      const atts = attachments.all(p.itemID) as { itemID: number; key: string; path: string | null; contentType: string | null }[]
      let file: string | null = null
      let fileType: string | null = null
      for (const a of atts) {
        if (deleted.has(a.itemID) || !a.path) continue
        const f = a.path.startsWith('storage:') ? join(dir, 'storage', a.key, a.path.slice(8)) : a.path
        const type = a.contentType ?? (/\.epub$/i.test(f) ? 'application/epub+zip' : /\.pdf$/i.test(f) ? 'application/pdf' : null)
        if (type !== 'application/pdf' && type !== 'application/epub+zip') continue
        file = f
        fileType = type
        if (type === 'application/pdf') break
      }
      const date = get(p.itemID, F.date)
      items.push({
        itemId: p.itemID,
        key: p.key,
        title: get(p.itemID, F.title) ?? '',
        authors: (creators.all(p.itemID) as { firstName: string | null; lastName: string | null }[]).map((c) => [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean),
        year: date && /\d{4}/.test(date) ? Number(/\d{4}/.exec(date)![0]) : null,
        doi: get(p.itemID, F.DOI),
        venue: get(p.itemID, F.publicationTitle) ?? get(p.itemID, F.proceedingsTitle) ?? get(p.itemID, F.conferenceName),
        abstract: get(p.itemID, F.abstractNote),
        url: get(p.itemID, F.url),
        volume: get(p.itemID, F.volume),
        issue: get(p.itemID, F.issue),
        pages: get(p.itemID, F.pages),
        publisher: get(p.itemID, F.publisher),
        file,
        fileType,
        collections: (inCols.all(p.itemID) as { collectionID: number }[]).map((r) => r.collectionID)
      })
    }
    const cols = db.prepare('SELECT collectionID, collectionName, parentCollectionID FROM collections').all() as {
      collectionID: number
      collectionName: string
      parentCollectionID: number | null
    }[]
    const deletedCols = new Set(tableExists(db, 'deletedCollections') ? (db.prepare('SELECT collectionID FROM deletedCollections').all() as { collectionID: number }[]).map((r) => r.collectionID) : [])
    const collections = cols
      .filter((c) => !deletedCols.has(c.collectionID))
      .map((c) => ({
        id: c.collectionID,
        name: c.collectionName,
        parentId: c.parentCollectionID,
        count: items.filter((i) => i.file && i.collections.includes(c.collectionID)).length
      }))
    return { dir, collections, items }
  } finally {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}
