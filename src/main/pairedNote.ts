// 把一篇论文的「看不懂」「有质疑」和 AI 问答写进画布笔记库里那篇配对笔记（写法在 src/shared/pairedNote.ts，全靠 @cn/format）。
// 这一步只有接口（pairedNote:write），界面上还没有入口：认库、选文件夹、写了以后提交进库的 Git 是「ParaRead 接库」那一步的事。
import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { notePathFor } from '@cn/format'
import { annotationSection, boxCropPaths, chatSections, writeSections } from '../shared/pairedNote'
import { pageOfText } from '../shared/refs'
import type { Ctx } from './ctx'
import { listAnnotations, listChats } from './db'

export interface PairedWrite {
  /** 笔记在库里的路径 */
  note: string
  /** 写了几段（问题段 + 问答段） */
  sections: number
  /** 文件变了没有（同样的内容再写一次不动文件） */
  changed: boolean
}

/** 库里的相对路径：不许绝对路径、..、反斜杠，要是 PDF */
function vaultPdf(p: unknown): string {
  if (typeof p !== 'string' || !/\.pdf$/i.test(p) || isAbsolute(p) || p.includes('\\') || p.split('/').some((s) => s === '..' || s === '')) throw new Error(`不是库里的 PDF 路径：${String(p)}`)
  return p
}

export function writePairedNote(c: Ctx, paperId: string, vaultRoot: string, pdf: string): PairedWrite {
  const note = notePathFor(pdf)
  const file = join(vaultRoot, note)
  const pages = c.library.pageTexts(paperId)
  const chats = listChats(c.db, paperId)
  const sections = [
    ...listAnnotations(c.db, paperId)
      .map((a) => annotationSection(pdf, a))
      .filter((s) => s !== null),
    ...chatSections(pdf, chats, (q) => pageOfText(pages, q)),
  ]
  // 对照、译文看法里框了一块问的：截图写进库里的附件文件夹（原文那张不加后缀，译文那张 .zh）
  for (const m of chats) {
    if (!m.box) continue
    const p = boxCropPaths(pdf, m)
    for (const [path, data] of [[p.src, m.box.src], [p.tr, m.box.tr]] as const) {
      if (!path || !data) continue
      const f = join(vaultRoot, path)
      const png = Buffer.from(data.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      if (existsSync(f) && readFileSync(f).equals(png)) continue
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, png)
    }
  }
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const next = writeSections(before, pdf, note, sections)
  if (next === before) return { note, sections: sections.length, changed: false }
  if (!existsSync(dirname(file))) throw new Error(`库里没有这个文件夹：${dirname(note) || '（根目录）'}`)
  // 先写临时文件再换名：画布笔记盯着这篇，不让它读到写了一半的
  const tmp = `${file}.pararead-${process.pid}.tmp`
  writeFileSync(tmp, next)
  renameSync(tmp, file)
  return { note, sections: sections.length, changed: true }
}

export function registerPairedNote(c: Ctx): void {
  ipcMain.handle('pairedNote:write', (_e, paperId: unknown, vaultRoot: unknown, pdf: unknown) => {
    if (typeof paperId !== 'string' || !paperId) throw new Error('没给论文')
    if (typeof vaultRoot !== 'string' || !isAbsolute(vaultRoot) || !existsSync(vaultRoot) || !statSync(vaultRoot).isDirectory()) throw new Error(`库的文件夹不对：${String(vaultRoot)}`)
    return writePairedNote(c, paperId, vaultRoot, vaultPdf(pdf))
  })
}
