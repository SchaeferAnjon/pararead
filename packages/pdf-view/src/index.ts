/**
 * 读 PDF 一页怎么画：画布笔记读 PDF（apps/notes PdfTab）和 ParaRead（PdfView，对照里原页、译页各一份）共用，
 * 2026-11-24 从画布笔记 PdfTab 的 PageView 搬来（ParaRead 缩放顺）。
 *
 * - 看得到才画（render 为真；看得到的范围由宿主算，两边都是视口上下各多一屏）；离开就把画布和文字层丢掉，回来重画。
 * - 换了比例：画好的那张不动，宿主改页面的 CSS 宽高，画布跟着拉（canvas 宽高 100%），文字层按 --total-scale-factor 跟着走；
 *   再按新比例在一张新画布上画，画好了才换上，中间不白一下。
 * - 捏合的过程中不每一下都重画：lastPinch（最近一下捏合的时间）离现在不到 SETTLE_MS 就等停手 SETTLE_MS 后画一次；
 *   ⌘+ / ⌘−、菜单点的马上画。
 * - 一张画布最多 MAX_CANVAS_PX 像素（同 pdf.js 的 maxCanvasPixels）：放得很大时不再按 2 倍屏画，免得一页占几百 MB。
 * - 文字层只建一次，换比例时 update 重新排（选着的字、找到的高亮都还在）。
 */
import { useEffect, useRef, type RefObject } from 'react'
import type { PDFDocumentProxy, TextLayer } from 'pdfjs-dist'

/** 一张画布最多这么多像素 */
export const MAX_CANVAS_PX = 2 ** 24
/** 捏合停下这么久后才按新比例重画 */
export const SETTLE_MS = 160

/** 按 scale 画一页时用的屏幕倍数：2 倍屏按 2 倍画，整张超过 MAX_CANVAS_PX 时降下来 */
export const canvasDpr = (w: number, h: number) => Math.min(globalThis.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PX / (w * h)))

export interface PdfPageOpts {
  doc: PDFDocumentProxy | null
  /** 在 doc 里是第几页 */
  n: number
  /** PDF 上 1 点画成几个 CSS 像素 */
  scale: number
  /** 看得到（或快看到了）：画；否则丢掉画布和文字层 */
  render: boolean
  /** 放画布的那一层（里面只放画布，换上新的时整个替换） */
  holder: RefObject<HTMLElement | null>
  /** 文字层（class textLayer），页面元素上要有 --total-scale-factor: scale */
  text: RefObject<HTMLElement | null>
  /** pdf.js 的 TextLayer（宿主传进来，用宿主那一份 pdf.js） */
  TextLayer: typeof TextLayer
  /** 最近一下捏合（按着 ctrl / ⌘ 的滚轮）的时间，Date.now() */
  lastPinch: RefObject<number>
  /** 文字层第一次画好（这一页的划线、灵感照字找位置） */
  onText?(n: number): void
}

export function usePdfPage(o: PdfPageOpts): void {
  const tl = useRef<{ layer: TextLayer; ready: Promise<unknown> } | null>(null)
  const onText = useRef(o.onText)
  onText.current = o.onText
  const { doc, n, scale, render, holder, text, lastPinch } = o
  const TL = o.TextLayer
  // 离开看得到的范围：画布和文字层都丢掉（回来重画）
  useEffect(() => {
    if (render) return
    holder.current?.replaceChildren()
    text.current?.replaceChildren()
    tl.current?.layer.cancel()
    tl.current = null
  }, [render, holder, text])
  // 换了一份 PDF（对照里译页翻好了换成译文那份）、关掉：文字层不要了
  useEffect(
    () => () => {
      tl.current?.layer.cancel()
      tl.current = null
    },
    [doc, n],
  )
  useEffect(() => {
    if (!render || !doc) return
    let cancelled = false
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
    const had = !!holder.current?.querySelector('canvas[data-ready]')
    const wait = had && Date.now() - (lastPinch.current ?? 0) < SETTLE_MS ? SETTLE_MS : 0
    const timer = setTimeout(() => {
      void (async () => {
        const page = await doc.getPage(n)
        if (cancelled) return
        const vp = page.getViewport({ scale })
        const dpr = canvasDpr(vp.width, vp.height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        task = page.render({ canvas, viewport: vp, ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {}) })
        try {
          await task.promise
        } catch {
          return
        }
        if (cancelled || !holder.current || !text.current) return
        canvas.dataset.ready = '1'
        canvas.dataset.scale = String(scale)
        holder.current.replaceChildren(canvas)
        if (!tl.current) {
          const layer = new TL({ textContentSource: page.streamTextContent(), container: text.current, viewport: vp })
          text.current.replaceChildren()
          const t = { layer, ready: layer.render().catch(() => undefined) }
          tl.current = t
          // 认的是这一层还在用（不是这一次 effect 没被取消）：刚打开时栏宽量好、比例马上又变一次，文字层照样画完，要告诉宿主
          void t.ready.then(() => tl.current === t && onText.current?.(n))
        } else {
          const t = tl.current
          await t.ready
          if (!cancelled && tl.current === t) t.layer.update({ viewport: vp })
        }
      })()
    }, wait)
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
    }
  }, [doc, n, scale, render, holder, text, lastPinch, TL])
}
