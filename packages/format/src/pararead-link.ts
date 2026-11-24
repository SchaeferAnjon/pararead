/**
 * 画布笔记和 ParaRead 之间的两件小事（ParaRead 联动，两边都调这一份）：
 * - 深链 pararead://open：画布笔记的「继续读」「在 ParaRead 里读」用它叫 ParaRead 打开库里一份 PDF、翻到那一页；
 *   back 是从哪个文件夹首页来的（ParaRead 的「在画布笔记里继续」带回去：canvas-notes://open?file=<文件夹>）。
 * - 放进画布笔记库（ParaRead 右键「放到画布笔记…」）：PDF 和配对笔记放进去叫什么，同名时怎么让开。
 * 纯函数，不碰 Electron、Node。
 */
import { notePathFor } from './reading-note'

export interface ParaReadOpen {
  /** PDF 的绝对路径（ParaRead 不一定连着这个库） */
  file: string
  page?: number
  /** 库的根目录（绝对路径）：ParaRead 按它认出这一篇在哪个画布笔记库里，笔记写进同一篇 */
  vault?: string
  /** 回去时到哪个文件夹首页（库里的相对路径） */
  back?: string
  /** 用哪种看法打开：保版面双语对照（bilingual，默认）或原文（original） */
  view?: 'bilingual' | 'original'
}

export function parareadOpenUrl(o: ParaReadOpen): string {
  const q = new URLSearchParams()
  q.set('file', o.file)
  if (o.page && o.page > 1) q.set('page', String(Math.floor(o.page)))
  if (o.vault) q.set('vault', o.vault)
  if (o.back !== undefined) q.set('back', o.back)
  if (o.view) q.set('view', o.view)
  return `pararead://open?${q.toString()}`
}

/** 认不出（不是 pararead://open、没有 file）返回 null */
export function parseParaReadOpen(url: string): ParaReadOpen | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'pararead:' || u.hostname !== 'open') return null
  const file = u.searchParams.get('file')
  if (!file) return null
  const page = Number(u.searchParams.get('page'))
  const vault = u.searchParams.get('vault')
  const back = u.searchParams.get('back')
  const view = u.searchParams.get('view')
  return { file, ...(Number.isInteger(page) && page > 1 ? { page } : {}), ...(vault ? { vault } : {}), ...(back !== null ? { back } : {}), ...(view === 'bilingual' || view === 'original' ? { view } : {}) }
}

/** ParaRead 回画布笔记：打开库里一份（PDF 翻到那页、笔记、文件夹首页） */
export function canvasNotesOpenUrl(file: string, page?: number): string {
  const q = new URLSearchParams()
  q.set('file', file)
  if (page && page > 0) q.set('page', String(Math.floor(page)))
  return `canvas-notes://open?${q.toString()}`
}

/**
 * 放进库里的一个文件夹时，PDF 和配对笔记叫什么：同名的 PDF 已经在了——内容一样（same 说一样）就不放，直接用那份；
 * 不一样就叫「名字 (2).pdf」「名字 (2) 笔记.md」，往后数到不撞为止。exists：库里这个路径有没有东西
 */
export function placeNames(folder: string, pdfName: string, exists: (path: string) => boolean, same?: (path: string) => boolean): { pdf: string; note: string; renamed: boolean; reuse: boolean } {
  const dir = folder.replace(/\/+$/, '')
  const at = (name: string) => (dir ? `${dir}/${name}` : name)
  const ext = /\.pdf$/i.exec(pdfName)?.[0] ?? '.pdf'
  const stem = pdfName.replace(/\.pdf$/i, '')
  const first = at(`${stem}${ext}`)
  if (!exists(first)) return { pdf: first, note: notePathFor(first), renamed: false, reuse: false }
  if (same?.(first)) return { pdf: first, note: notePathFor(first), renamed: false, reuse: true }
  for (let n = 2; ; n++) {
    const pdf = at(`${stem} (${n})${ext}`)
    if (!exists(pdf) && !exists(notePathFor(pdf))) return { pdf, note: notePathFor(pdf), renamed: true, reuse: false }
  }
}
