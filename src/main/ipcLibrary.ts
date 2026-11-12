import { ipcMain } from 'electron'
import { t } from '../shared/i18n'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ctx } from './ctx'
import { createFolder, deleteFolder, getPaper, listFolders, moveFolder, renameFolder, setPaperFolders } from './db'
import { newId } from './library'

export interface SearchMatch {
  id: string
  where: 'title' | 'author' | 'abstract' | 'venue' | 'text'
  snippet: string
}

// 文献库：文件夹、全文搜索、封面缩略图
export function registerLibrary(c: Ctx): void {
  const { db } = c
  const changed = (): void => c.broadcast('library:changed', null)

  ipcMain.handle('folders:list', () => listFolders(db))
  ipcMain.handle('folders:create', (_e, name: string, parentId: string | null) => {
    const id = newId()
    createFolder(db, id, name.trim() || t('新文件夹'), parentId)
    changed()
    return id
  })
  ipcMain.handle('folders:rename', (_e, id: string, name: string) => {
    if (!name.trim()) return
    renameFolder(db, id, name.trim())
    changed()
  })
  ipcMain.handle('folders:move', (_e, id: string, parentId: string | null) => {
    moveFolder(db, id, parentId)
    changed()
  })
  ipcMain.handle('folders:delete', (_e, id: string) => {
    const gone = deleteFolder(db, id)
    changed()
    return gone
  })
  ipcMain.handle('papers:setFolders', (_e, ids: string[], add: string[], remove: string[]) => {
    for (const id of ids) setPaperFolders(db, id, add, remove)
    changed()
  })

  // 搜索：标题、作者、期刊、摘要，再搜全文（每页文字）。每篇只返回最先命中的地方和一小段上下文
  ipcMain.handle('papers:search', (_e, q: string) => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    const out: SearchMatch[] = []
    const seen = new Set<string>()
    const rows = db.prepare('SELECT id, title, authors, venue, abstract FROM papers WHERE deleted = 0').all() as {
      id: string
      title: string
      authors: string
      venue: string | null
      abstract: string | null
    }[]
    for (const r of rows) {
      const fields: [SearchMatch['where'], string][] = [
        ['title', r.title],
        ['author', (JSON.parse(r.authors) as string[]).join(', ')],
        ['venue', r.venue ?? ''],
        ['abstract', r.abstract ?? '']
      ]
      for (const [where, text] of fields) {
        const i = text.toLowerCase().indexOf(needle)
        if (i >= 0) {
          out.push({ id: r.id, where, snippet: snippet(text, i, needle.length) })
          seen.add(r.id)
          break
        }
      }
    }
    const like = `%${needle.replace(/[%_]/g, (m) => '\\' + m)}%`
    const hits = db
      .prepare("SELECT pt.paper_id, pt.page, pt.text FROM page_text pt JOIN papers p ON p.id = pt.paper_id AND p.deleted = 0 WHERE lower(pt.text) LIKE ? ESCAPE '\\' ORDER BY pt.paper_id, pt.page")
      .all(like) as { paper_id: string; page: number; text: string }[]
    for (const h of hits) {
      if (seen.has(h.paper_id)) continue
      seen.add(h.paper_id)
      const i = h.text.toLowerCase().indexOf(needle)
      out.push({ id: h.paper_id, where: 'text', snippet: t('第 {0} 页：', h.page) + snippet(h.text, i, needle.length) })
    }
    return out
  })

  // 封面：界面用 pdf.js 画第一页，存成 JPEG
  const thumbDir = join(c.dataDir, 'thumbs')
  mkdirSync(thumbDir, { recursive: true })
  ipcMain.handle('papers:thumb', (_e, id: string) => {
    const f = join(thumbDir, `${id}.jpg`)
    return existsSync(f) ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : null
  })
  ipcMain.handle('papers:saveThumb', (_e, id: string, dataUrl: string) => {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl)
    if (!m || !getPaper(db, id)) return
    writeFileSync(join(thumbDir, `${id}.jpg`), Buffer.from(m[1], 'base64'))
  })

  ipcMain.handle('papers:enrich', async (_e, id: string) => {
    await c.library.enrich(id, true)
    changed()
    return getPaper(db, id)
  })
}

function snippet(text: string, i: number, len: number): string {
  const flat = (s: string): string => s.replace(/\s+/g, ' ')
  const a = Math.max(0, i - 40)
  return (a > 0 ? '…' : '') + flat(text.slice(a, i + len + 80)) + (i + len + 80 < text.length ? '…' : '')
}
