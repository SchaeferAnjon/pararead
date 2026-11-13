// 文献库自动导出 .bib：用户选一个文件夹，写 <文件夹>/ParaRead.bib；之后文献库每次变（加论文、改文献信息、删论文）就重写。
// LaTeX 和 Overleaf 都走这个文件（Overleaf 把它拖进项目一次，或放进和 Overleaf 用 Git 同步的文件夹）。
import { dialog, ipcMain, shell } from 'electron'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bibFile } from '../shared/bib'
import { t } from '../shared/i18n'
import type { Ctx } from './ctx'
import { listPapers } from './db'

export const BIB_NAME = 'ParaRead.bib'

export interface BibStatus {
  dir: string // 空是还没开
  file: string
  count: number
  at: number | null // 上次写的时间
  error: string
}

export class BibExport {
  private timer: NodeJS.Timeout | null = null
  private at: number | null = null
  private count = 0
  private error = ''

  constructor(private c: Ctx) {}

  status(): BibStatus {
    const dir = this.c.settings.get().bibDir
    return { dir, file: dir ? join(dir, BIB_NAME) : '', count: this.count, at: this.at, error: this.error }
  }

  /** 文献库变了：攒 1 秒再写，一次导入几十篇只写一回 */
  schedule(): void {
    if (!this.c.settings.get().bibDir) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.write()
    }, 1000)
  }

  write(): BibStatus {
    const dir = this.c.settings.get().bibDir
    if (!dir) return this.status()
    const papers = listPapers(this.c.db)
    try {
      if (!existsSync(dir)) throw new Error(t('文件夹不在了：{0}', dir))
      // 先写临时文件再换名：Overleaf 的 Git 同步、LaTeX 编辑器不会读到写了一半的文件
      const file = join(dir, BIB_NAME)
      writeFileSync(file + '.tmp', bibFile(papers))
      renameSync(file + '.tmp', file)
      this.at = Date.now()
      this.count = papers.length
      this.error = ''
    } catch (e) {
      this.error = (e as Error).message
      this.c.log(`导出 .bib 失败：${this.error}`)
    }
    return this.status()
  }

  register(): void {
    ipcMain.handle('bib:status', () => this.status())
    // 选文件夹并立刻写一次；测试时 PARAREAD_EXPORT_DIR 代替对话框
    ipcMain.handle('bib:choose', async () => {
      let dir = process.env.PARAREAD_EXPORT_DIR ?? ''
      if (!dir) {
        const win = this.c.mainWindow()
        const opts = { title: t('.bib 放在哪个文件夹'), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        if (r.canceled || !r.filePaths[0]) return this.status()
        dir = r.filePaths[0]
      }
      this.c.settings.set({ bibDir: dir })
      this.c.broadcast('settings:changed', this.c.settings.view())
      return this.write()
    })
    ipcMain.handle('bib:write', () => this.write())
    ipcMain.handle('bib:stop', () => {
      this.c.settings.set({ bibDir: '' })
      this.c.broadcast('settings:changed', this.c.settings.view())
      this.error = ''
      return this.status()
    })
    ipcMain.handle('bib:reveal', () => {
      const s = this.status()
      if (s.file && existsSync(s.file)) shell.showItemInFolder(s.file)
    })
  }
}
