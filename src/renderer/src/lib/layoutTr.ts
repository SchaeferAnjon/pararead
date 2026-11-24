// 保版面翻译在界面这头：这一篇翻到哪了、组件装到哪了、翻好的译文 PDF（一批一个文件，用 pdf.js 打开）
import { useEffect, useRef, useState } from 'react'
import type * as PdfJs from 'pdfjs-dist'
import type { BabelInstallState, LayoutTrState } from '@shared/layoutTr'
import { api } from '../api'
import { openPdfData } from './pdf'

export function useBabelInstall(): BabelInstallState | null {
  const [s, setS] = useState<BabelInstallState | null>(null)
  useEffect(() => {
    void api.layoutTrInstallState().then(setS)
    return api.onLayoutTrInstall(setS)
  }, [])
  return s
}

export function useLayoutTr(paperId: string, total: number): { state: LayoutTrState | null; docs: Record<string, PdfJs.PDFDocumentProxy> } {
  const [state, setState] = useState<LayoutTrState | null>(null)
  const [docs, setDocs] = useState<Record<string, PdfJs.PDFDocumentProxy>>({})
  const loading = useRef(new Set<string>())
  const opened = useRef<PdfJs.PDFDocumentProxy[]>([])
  useEffect(() => {
    if (!total) return
    let alive = true
    void api.layoutTrState(paperId, total).then((s) => alive && setState(s))
    const off = api.onLayoutTr((s) => s.paperId === paperId && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [paperId, total])
  useEffect(() => {
    if (!state) return
    for (const f of new Set(Object.values(state.pages).map((v) => v.file))) {
      if (loading.current.has(f)) continue
      loading.current.add(f)
      void api
        .layoutTrFile(paperId, f)
        .then(openPdfData)
        .then((d) => {
          opened.current.push(d)
          setDocs((x) => ({ ...x, [f]: d }))
        })
        .catch(() => loading.current.delete(f))
    }
  }, [paperId, state])
  useEffect(
    () => () => {
      for (const d of opened.current) void d.loadingTask.destroy()
    },
    [paperId]
  )
  return { state, docs }
}

/** 框选在对照里：从某一页（原页或译页）的画布上截框里那一块 */
export function cropPage(page: number, side: 'src' | 'tr', frac: [number, number, number, number]): string | null {
  const el = document.querySelector<HTMLElement>(`.page[data-page="${page}"][data-side="${side}"]`)
  const canvas = el?.querySelector('canvas')
  if (!el || !canvas || el.classList.contains('pending') || !canvas.width) return null
  const sx = frac[0] * canvas.width
  const sy = frac[1] * canvas.height
  const sw = Math.max(1, frac[2] * canvas.width)
  const sh = Math.max(1, frac[3] * canvas.height)
  const out = document.createElement('canvas')
  out.width = Math.round(sw)
  out.height = Math.round(sh)
  out.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

/** 两边都带：原文那块在上、译文那块在下，中间留一道白，拼成一张图给 AI */
export function stackImages(top: string, bottom: string): Promise<string> {
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = src
    })
  return Promise.all([load(top), load(bottom)]).then(([a, b]) => {
    const gap = 16
    const c = document.createElement('canvas')
    c.width = Math.max(a.width, b.width)
    c.height = a.height + gap + b.height
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(a, 0, 0)
    g.drawImage(b, 0, a.height + gap)
    return c.toDataURL('image/png')
  })
}
