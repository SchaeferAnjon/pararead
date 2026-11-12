// 导出重排后的 PDF：双语对照 / 仅原文 / 仅译文，可带高亮，笔记作页边旁注。
// 先把全文译文补齐（缓存里没有的现翻），再开一个隐藏窗口加载界面的 #print 页，等它说排好了就 printToPDF（A4，浅色）。
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Ctx } from './ctx'
import { getCachedTranslation, getPaper } from './db'
import { safeFileName } from './exporter'
import { t } from '../shared/i18n'

export interface PdfExportOpts {
  layout: 'both' | 'src' | 'tr'
  highlights: boolean
  notes: boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))

export function registerExportPdf(c: Ctx, loadRenderer: (w: BrowserWindow, hash: string) => void): void {
  let busy = false
  ipcMain.handle('export:pdf', async (e, paperId: string, o: PdfExportOpts) => {
    if (busy) throw new Error(t('请等待前一个文档导出完成'))
    const paper = getPaper(c.db, paperId)
    if (!paper) throw new Error(t('论文不存在'))
    const doc = c.library.reflowDoc(paperId)
    if (!doc) throw new Error(t('重排好以后才能导出'))
    busy = true
    const report = (percent: number, stage: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('export:progress', { paperId, percent, stage })
    }
    try {
      // 1. 译文补齐
      if (o.layout !== 'src') {
        const texts = doc.blocks.filter((b) => b.translatable).map((b) => b.md)
        c.translator.request(paperId, texts.map((text) => ({ text })), true)
        const t0 = Date.now()
        for (;;) {
          const done = texts.filter((t_) => getCachedTranslation(c.db, c.translator.keyFor(t_)) !== null).length
          report(Math.round((done / Math.max(texts.length, 1)) * 80), t('翻译 {0}/{1}', done, texts.length))
          if (done === texts.length) break
          if (Date.now() - t0 > 15 * 60_000) throw new Error(t('翻译超时：还有 {0} 段没翻完', texts.length - done))
          if (c.translator.queued(paperId) === 0 && Date.now() - t0 > 5000) {
            // 队列空了还有缺的：失败的段，再请求一次
            c.translator.request(paperId, texts.filter((t_) => getCachedTranslation(c.db, c.translator.keyFor(t_)) === null).map((text) => ({ text })), true)
          }
          await new Promise((r) => setTimeout(r, 800))
        }
      }
      // 2. 隐藏窗口排版
      report(85, t('排版'))
      const win = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: false, contextIsolation: true }
      })
      try {
        const ready = new Promise<void>((resolve, reject) => {
          const t_ = setTimeout(() => reject(new Error(t('排版超时'))), 120_000)
          ipcMain.once(`print:ready:${win.webContents.id}`, () => {
            clearTimeout(t_)
            resolve()
          })
        })
        const q = new URLSearchParams({ id: paperId, layout: o.layout, hl: o.highlights ? '1' : '0', notes: o.notes ? '1' : '0', wc: String(win.webContents.id) })
        loadRenderer(win, `print?${q}`)
        await ready
        report(95, t('生成 PDF'))
        const pdf = await win.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: `<div style="font-size:8px;color:#888;width:100%;text-align:center;font-family:-apple-system"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`
        })
        const suffix = { both: t('双语'), src: t('原文'), tr: t('译文') }[o.layout]
        const name = `${safeFileName(paper.title)}（${suffix}）.pdf`
        let target: string
        if (process.env.PARAREAD_EXPORT_DIR) target = join(process.env.PARAREAD_EXPORT_DIR, name)
        else {
          const r = await dialog.showSaveDialog(c.mainWindow()!, { title: t('导出 PDF'), defaultPath: join(homedir(), 'Downloads', name), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
          if (r.canceled || !r.filePath) return null
          target = r.filePath
        }
        writeFileSync(target, pdf)
        report(100, t('完成'))
        if (!process.env.PARAREAD_EXPORT_DIR) void shell.openPath(target)
        return target
      } finally {
        win.destroy()
      }
    } finally {
      busy = false
    }
  })
  ipcMain.on('print:ready', (e) => ipcMain.emit(`print:ready:${e.sender.id}`))
}
