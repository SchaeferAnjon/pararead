/**
 * 笔记配图的框（CN-60 下一步）：问 AI 时本来就附了这一页（或框的那块）的截图，让 AI 在回答最后顺带写一行
 *
 *   〔配图 0.12,0.30,0.55,0.42 · 九层结构图〕
 *
 * 是这张截图上最值得配进笔记的图（示意图、结构图、表格）的框（左、上、宽、高，0 到 1 的比例）。
 * 软件把它换算成整页上的比例，从按 PDF 重新画的页面里裁下来——矢量画的图（没有图片块）也裁得对。
 * 框太小、几乎整页、出界的不算，退回按图片块挑的老办法。不依赖 Electron，也不依赖 pdf.js。
 */
import type { Rect } from './pdf-link'

export interface FigureBox {
  /** 整页上的比例：左、上、宽、高 */
  rect: Rect
  caption: string
}

const MARK = /\n*〔配图\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*[,，]\s*([\d.]+)\s*(?:·\s*([^〕\n]*))?〕[ \t]*/

/** 回答里认出那一行（在截图上的比例）；没有就 null */
export function parseFigureMark(text: string): FigureBox | null {
  const m = MARK.exec(text)
  if (!m) return null
  const rect = [m[1], m[2], m[3], m[4]].map(Number) as Rect
  if (rect.some((n) => !Number.isFinite(n))) return null
  return { rect, caption: (m[5] ?? '').trim() || '这页的图' }
}

/** 显示和记笔记时去掉那一行 */
export const stripFigureMark = (text: string) => text.replace(new RegExp(MARK.source, 'g'), '').replace(/\n*〔配[^〕\n]*$/, '')

/** 截图上的比例换成整页上的比例：截图是框的那块（crop 给了）还是整页 */
export function toPageRect(r: Rect, crop?: Rect): Rect {
  if (!crop) return r
  return [crop[0] + r[0] * crop[2], crop[1] + r[1] * crop[3], r[2] * crop[2], r[3] * crop[3]]
}

/**
 * AI 配的图八成以上落在我框的那块里：笔记里已经有「我框的」截图，这张算重了，不再画第二遍
 * （2026-11-20 真 AI 验收：框了公式那块，AI 配的图是同一块，笔记里同一块字出现两遍）
 */
export function insideCrop(fig: Rect, crop: Rect): boolean {
  const w = Math.min(fig[0] + fig[2], crop[0] + crop[2]) - Math.max(fig[0], crop[0])
  const h = Math.min(fig[1] + fig[3], crop[1] + crop[3]) - Math.max(fig[1], crop[1])
  return w > 0 && h > 0 && (w * h) / (fig[2] * fig[3]) >= 0.8
}

/** 框合不合理：在页面里、不太小（面积 2% 以上、宽高都 8% 以上）、不是几乎整页（面积 85% 以下） */
export function saneFigure(r: Rect): boolean {
  const [x, y, w, h] = r
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return false
  if (x < -0.01 || y < -0.01 || w <= 0 || h <= 0 || x + w > 1.01 || y + h > 1.01) return false
  const area = w * h
  return area >= 0.02 && w >= 0.08 && h >= 0.08 && area <= 0.85
}

/**
 * 取框这一层：按顺序问每一种办法，第一个给出合理框的算数。
 * 现在只有一种：AI 回答里的那一行。
 */
export interface FigureSource {
  name: string
  locate(): Promise<FigureBox | null> | FigureBox | null
}

export async function locateFigure(sources: FigureSource[]): Promise<(FigureBox & { by: string }) | null> {
  for (const s of sources) {
    const f = await s.locate()
    if (f && saneFigure(f.rect)) return { ...f, by: s.name }
  }
  return null
}
