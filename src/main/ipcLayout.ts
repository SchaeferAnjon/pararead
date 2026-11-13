import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ctx } from './ctx'
import { getPaper, setReflow, updatePaper } from './db'
import { fromMiddle, toMarkdown, type Layout, type Region } from './layout'
import { extractPdf, itemsToLines, type PdfExtract } from './pdftext'
import { t } from '../shared/i18n'
import { killTree } from './platform'

// 调整重排区域：取版面（第一次要跑 MinerU 的 middle_json，约和精细重排一样久）、保存后重新生成重排
export function registerLayout(c: Ctx): void {
  const dir = (id: string): string => join(c.dataDir, 'reflow', id)
  const running = new Map<string, Promise<Layout>>()

  const runMiddle = (id: string): Promise<Layout> => {
    const p = getPaper(c.db, id)
    if (!p || p.kind !== 'pdf') return Promise.reject(new Error(t('只有 PDF 能调整区域')))
    const out = join(dir(id), 'middle.json')
    mkdirSync(dir(id), { recursive: true })
    return new Promise((resolve, reject) => {
      const args = ['parse', c.library.pdfPath(id), '-o', out, '-f', 'middle_json', '--tier', 'basic', ...(p.scanned ? ['--ocr-mode', 'ocr'] : []), '-v']
      const child = spawn(c.settings.get().mineruPath, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
      let tail = ''
      const onData = (b: Buffer): void => {
        tail = (tail + b.toString()).slice(-2000)
        const line = tail.split(/[\r\n]/).filter(Boolean).pop() ?? ''
        c.broadcast('layout:progress', { paperId: id, line: line.slice(0, 200) })
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      const t_ = setTimeout(() => {
        killTree(child)
      }, 15 * 60_000)
      child.on('error', (e) => {
        clearTimeout(t_)
        reject(new Error(t('启动 MinerU 失败：{0}', e.message)))
      })
      child.on('close', (code) => {
        clearTimeout(t_)
        if (code !== 0 || !existsSync(out)) return reject(new Error(t('MinerU 退出码 {0}：{1}', code, tail.split('\n').filter(Boolean).pop() ?? '')))
        const layout = fromMiddle(JSON.parse(readFileSync(out, 'utf8')))
        writeFileSync(join(dir(id), 'layout.json'), JSON.stringify(layout))
        resolve(layout)
      })
    })
  }

  ipcMain.handle('layout:get', async (_e, id: string) => {
    for (const f of ['layout-edited.json', 'layout.json']) {
      const p = join(dir(id), f)
      if (existsSync(p)) return { layout: JSON.parse(readFileSync(p, 'utf8')) as Layout, edited: f === 'layout-edited.json' }
    }
    if (!running.has(id)) running.set(id, runMiddle(id).finally(() => running.delete(id)))
    return { layout: await running.get(id)!, edited: false }
  })

  const pdfCache = new Map<string, PdfExtract>()
  ipcMain.handle('layout:save', async (_e, id: string, layout: Layout, crops: Record<string, string>) => {
    let ext = pdfCache.get(id)
    if (!ext) {
      ext = await extractPdf(new Uint8Array(readFileSync(c.library.pdfPath(id))))
      pdfCache.clear()
      pdfCache.set(id, ext)
    }
    const textInBox = (page: number, b: Region['bbox']): string => {
      const pg = ext!.pages[page]
      if (!pg) return ''
      const [x0, y0, x1, y1] = [b[0] * pg.width, b[1] * pg.height, b[2] * pg.width, b[3] * pg.height]
      // 文字项的中心落在框里才算
      const items = pg.items.filter((it) => {
        const cx = it.x + it.w / 2
        const cy = it.y - it.h / 2
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
      })
      return itemsToLines(items)
        .map((l) => l.text)
        .join('\n')
        .replace(/-\n(?=[a-z])/g, '')
        .replace(/\n(?!\n)/g, ' ')
    }
    const md = toMarkdown(layout, textInBox, crops)
    writeFileSync(c.library.reflowPath(id, 'edited'), md)
    writeFileSync(join(dir(id), 'layout-edited.json'), JSON.stringify(layout))
    setReflow(c.db, id, 'edited', 'done')
    updatePaper(c.db, id, { engine: 'edited' })
    c.broadcast('reflow:done', { paperId: id, tier: 'edited' })
    c.broadcast('library:changed', null)
    return c.library.reflowDoc(id)
  })

  ipcMain.handle('layout:reset', (_e, id: string) => {
    rmSync(c.library.reflowPath(id, 'edited'), { force: true })
    rmSync(join(dir(id), 'layout-edited.json'), { force: true })
    c.db.prepare("DELETE FROM reflow WHERE paper_id = ? AND tier = 'edited'").run(id)
    updatePaper(c.db, id, { engine: null })
    c.broadcast('reflow:done', { paperId: id, tier: c.library.bestTier(id) })
    return c.library.reflowDoc(id)
  })
}
