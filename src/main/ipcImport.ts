import { dialog, ipcMain } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Ctx } from './ctx'
import { createFolder, getPaper, listFolders, setPaperFolders } from './db'
import type { ImportResult } from './library'
import { newId } from './library'
import { searchWeb, type MetaPatch, type SearchHit } from './meta'
import { download, resolve } from './urlImport'
import { findZoteroDir, readZotero, type ZoteroLibrary } from './zotero'
import { t } from '../shared/i18n'

export type UrlImportResult = ImportResult | { status: 'noPdf'; meta: MetaPatch; landing: string | null; error?: string }

export type ZoteroState = 'waiting' | 'importing' | 'done' | 'duplicate' | 'failed' | 'paused' | 'skipped'

// 导入：网址、全网检索、仅链接的论文补 PDF、Zotero。返回给小书签（pararead://add?url=）用的网址导入
export function registerImport(c: Ctx): { fromInput: (input: string) => Promise<UrlImportResult> } {
  const tmp = join(c.dataDir, 'tmp')

  const importUrl = async (pdfUrl: string | null, meta: MetaPatch, landing: string | null, source: 'url' | 'search'): Promise<UrlImportResult> => {
    if (!pdfUrl) return { status: 'noPdf', meta, landing }
    let file: string
    try {
      file = await download(pdfUrl, tmp)
    } catch (e) {
      return { status: 'noPdf', meta, landing, error: (e as Error).message }
    }
    try {
      const name = (meta.title ?? 'paper').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120) + '.pdf'
      const r = await c.library.importFile(file, { title: meta.title, authors: meta.authors, source, fileName: name, meta })
      // 下载的不是 PDF（出版社的登录页之类）当作没有全文
      if (r.status === 'failed') return { status: 'noPdf', meta, landing, error: r.error }
      if (r.status === 'added') c.afterImport(r.paper.id)
      c.broadcast('library:changed', null)
      return r.status === 'added' ? { status: 'added', paper: getPaper(c.db, r.paper.id)! } : r
    } finally {
      rmSync(file, { force: true })
    }
  }

  const fromInput = async (input: string): Promise<UrlImportResult> => {
    const r = await resolve(input)
    return importUrl(r.pdfUrl, r.meta, r.landing, 'url')
  }
  ipcMain.handle('import:url', (_e, input: string) => fromInput(input))
  ipcMain.handle('import:link', (_e, meta: MetaPatch & { title: string }) => {
    const r = c.library.addLink(meta)
    c.broadcast('library:changed', null)
    return r
  })
  ipcMain.handle('scholar:search', (_e, q: string, opts?: { yearFrom?: number }) => searchWeb(q, 20, opts))
  ipcMain.handle('scholar:add', async (_e, hit: SearchHit) => {
    const meta: MetaPatch = { title: hit.title, authors: hit.authors, year: hit.year, venue: hit.venue, abstract: hit.abstract, doi: hit.doi, arxiv: hit.arxiv, url: hit.url }
    const r = await importUrl(hit.pdfUrl, meta, hit.url, 'search')
    if (r.status !== 'noPdf') return r
    // 没有开放获取的 PDF：存成仅链接，之后可以补 PDF
    const link = c.library.addLink({ ...meta, title: hit.title })
    c.broadcast('library:changed', null)
    return { ...link, linkOnly: true, error: r.error }
  })
  ipcMain.handle('papers:attach', async (_e, id: string, path?: string) => {
    let f = path
    if (!f) {
      const r = await dialog.showOpenDialog(c.mainWindow()!, { title: t('选择这篇论文的 PDF'), properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      f = r.filePaths[0]
    }
    await c.library.attachPdf(id, f)
    c.afterImport(id)
    c.broadcast('library:changed', null)
    return getPaper(c.db, id)
  })

  // Zotero
  let lib: ZoteroLibrary | null = null
  let job: { queue: number[]; paused: boolean; cancelled: boolean; running: boolean; folderOf: Map<number, string> } | null = null
  const progress = (itemId: number, state: ZoteroState, extra: { error?: string; paperId?: string } = {}): void =>
    c.broadcast('zotero:progress', { itemId, state, ...extra })

  ipcMain.handle('zotero:scan', async (_e, dir?: string) => {
    const d = dir ?? c.settings.get().zoteroDir ?? findZoteroDir()
    if (!d) return { found: false }
    lib = readZotero(d)
    const hashes = new Set((c.db.prepare('SELECT file_name FROM papers WHERE deleted = 0').all() as { file_name: string }[]).map((r) => r.file_name))
    return {
      found: true,
      dir: d,
      collections: lib.collections,
      items: lib.items.map((i) => ({ itemId: i.itemId, title: i.title, authors: i.authors, year: i.year, collections: i.collections, hasFile: !!i.file, fileType: i.fileType, inLibrary: !!i.file && hashes.has(i.file.split('/').pop()!) }))
    }
  })
  ipcMain.handle('zotero:chooseDir', async () => {
    const r = await dialog.showOpenDialog(c.mainWindow()!, { title: t('选择 Zotero 数据目录（里面有 zotero.sqlite）'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    c.settings.set({ zoteroDir: r.filePaths[0] })
    return r.filePaths[0]
  })
  ipcMain.handle('zotero:import', async (_e, itemIds: number[], mirrorFolders: boolean) => {
    if (!lib) throw new Error(t('先扫描 Zotero 库'))
    if (job?.running) throw new Error(t('上一次导入还没完'))
    // 文件夹照搬：同名同上级的复用
    const folderOf = new Map<number, string>()
    if (mirrorFolders) {
      const ours = listFolders(c.db)
      const ensure = (colId: number): string => {
        const hit = folderOf.get(colId)
        if (hit) return hit
        const col = lib!.collections.find((x) => x.id === colId)!
        const parent = col.parentId ? ensure(col.parentId) : null
        const f = ours.find((x) => x.name === col.name && x.parentId === parent)
        const id = f?.id ?? newId()
        if (!f) {
          createFolder(c.db, id, col.name, parent)
          ours.push({ id, name: col.name, parentId: parent, count: 0 })
        }
        folderOf.set(colId, id)
        return id
      }
      for (const i of lib.items) if (itemIds.includes(i.itemId)) i.collections.forEach(ensure)
    }
    job = { queue: [...itemIds], paused: false, cancelled: false, running: true, folderOf }
    for (const id of itemIds) progress(id, 'waiting')
    void runZotero()
    return itemIds.length
  })
  ipcMain.handle('zotero:control', (_e, action: 'pause' | 'resume' | 'cancel') => {
    if (!job) return
    if (action === 'pause') job.paused = true
    if (action === 'cancel') job.cancelled = true
    if (action === 'resume' && job.paused) {
      job.paused = false
      if (!job.running) {
        job.running = true
        void runZotero()
      }
    }
  })

  async function runZotero(): Promise<void> {
    const j = job!
    while (j.queue.length && !j.cancelled) {
      if (j.paused) {
        for (const id of j.queue) progress(id, 'paused')
        j.running = false
        return
      }
      const id = j.queue.shift()!
      const it = lib!.items.find((x) => x.itemId === id)
      if (!it?.file) {
        progress(id, 'skipped', { error: t('没有本地 PDF') })
        continue
      }
      progress(id, 'importing')
      const meta: MetaPatch = { title: it.title, authors: it.authors, year: it.year, doi: it.doi, venue: it.venue, abstract: it.abstract, url: it.url, volume: it.volume, issue: it.issue, pages: it.pages, publisher: it.publisher }
      const r = await c.library.importFile(it.file, { title: it.title || undefined, authors: it.authors, source: 'zotero', meta })
      if (r.status === 'failed') progress(id, 'failed', { error: /ENOENT/.test(r.error) ? t('文件不存在') : r.error })
      else {
        if (r.status === 'added') c.afterImport(r.paper.id)
        const fids = it.collections.map((x) => j.folderOf.get(x)).filter((x): x is string => !!x)
        if (fids.length) setPaperFolders(c.db, r.paper.id, fids, [])
        progress(id, r.status === 'added' ? 'done' : 'duplicate', { paperId: r.paper.id })
      }
      c.broadcast('library:changed', null)
    }
    if (j.cancelled) for (const id of j.queue) progress(id, 'skipped', { error: t('已中止') })
    j.running = false
    c.broadcast('zotero:finished', null)
  }

  return { fromInput }
}
