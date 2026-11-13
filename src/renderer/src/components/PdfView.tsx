import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LABEL_NAME } from '@shared/annLabels'
import type * as PdfJs from 'pdfjs-dist'
import type { Annotation, Paper, ReadPosition, Ink} from '@shared/types'
import { pdfjs } from '../lib/pdf'
import { findTextRange, normRects, selectionText } from '../lib/selection'
import { useNotePreview } from '../lib/ui'
import type { Jump } from './Reader'
import type { SelInfo } from './Selection'
import { t } from '@shared/i18n'

interface Size {
  w: number
  h: number
}

// 手写笔：当前选的是笔（带颜色）还是橡皮；笔画粗细（缩放 100% 时的像素）
export type InkTool = { kind: 'pen'; color: string } | { kind: 'eraser' }
export const INK_WIDTH = 2.5
export const INK_COLORS = ['#e5484d', '#2f6fde', '#1d1d1f']

// 原文模式：pdf.js 连续滚动。页面进入视口附近才渲染画布和文字层；高亮是盖在文字层上的矩形。
export function PdfView(props: {
  pdf: PdfJs.PDFDocumentProxy
  paper: Paper
  anns: Annotation[]
  zoom: number
  invert: boolean
  boxMode: boolean
  shot: { page: number; frac: [number, number, number, number] } | null
  jump: Jump | null
  hoverAnn: string | null
  initial: ReadPosition
  onPosition: (page: number, frac: number, progress: number) => void
  onSelect: (s: SelInfo | null) => void
  onBox: (dataUrl: string, page: number, frac: [number, number, number, number], text: string) => void
  onRectsFound: (a: Annotation, rects: number[][]) => void
  inkTool: InkTool | null
  inks: Ink[]
  onInkAdd: (k: { page: number; points: [number, number][] }) => void
  onInkErase: (id: string) => void
}) {
  const { pdf } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]))
  const [page, setPage] = useState(1)
  const [chip, setChip] = useState(false)
  const [chipEdit, setChipEdit] = useState(false)
  const [found, setFound] = useState<Record<string, number[][]>>({})
  const [flashAnn, setFlashAnn] = useState<string | null>(null)
  const [box, setBox] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null)
  // 手写：正在画的这一笔（页内归一化坐标），橡皮按住时一路擦
  const [drawing, setDrawing] = useState<{ page: number; points: [number, number][] } | null>(null)
  const erasing = useRef(false)
  const restored = useRef(false)
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const out: Size[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i)
        const vp = p.getViewport({ scale: 1 })
        out.push({ w: vp.width, h: vp.height })
      }
      if (alive) setSizes(out)
    })()
    return () => {
      alive = false
    }
  }, [pdf])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const maxW = sizes ? Math.max(...sizes.map((s) => s.w)) : 600
  const fit = width ? (width - 32 - 32) / maxW : 1
  const scale = Math.max(0.3, fit * props.zoom)

  // 缩放前记住页码和页内位置，布局完滚回去
  const anchor = useRef<{ page: number; frac: number } | null>(null)
  const pageTop = useCallback(
    (n: number) => {
      if (!sizes) return 0
      let y = 16
      for (let i = 0; i < n - 1; i++) y += sizes[i].h * scale + 16
      return y
    },
    [sizes, scale]
  )
  const prevScale = useRef(scale)
  if (prevScale.current !== scale && scroller.current && sizes) {
    const st = scroller.current.scrollTop
    let y = 16
    let n = 1
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i].h * prevScale.current
      if (y + h + 16 > st) {
        n = i + 1
        break
      }
      y += h + 16
    }
    anchor.current = { page: n, frac: (st - y) / (sizes[n - 1].h * prevScale.current) }
    prevScale.current = scale
  }
  useLayoutEffect(() => {
    if (!anchor.current || !scroller.current || !sizes) return
    const a = anchor.current
    scroller.current.scrollTop = pageTop(a.page) + a.frac * sizes[a.page - 1].h * scale
    anchor.current = null
  }, [scale, sizes, pageTop])

  // 恢复上次位置
  useLayoutEffect(() => {
    if (restored.current || !sizes || !width || !scroller.current) return
    restored.current = true
    const p = props.initial.page
    if (p && p <= sizes.length) scroller.current.scrollTop = pageTop(p) + (props.initial.pageFrac ?? 0) * sizes[p - 1].h * scale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, width])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el || !sizes) return
    const st = el.scrollTop
    const mid = st + el.clientHeight / 3
    let y = 16
    let n = 1
    let frac = 0
    const vis = new Set<number>()
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i].h * scale
      if (y <= mid) {
        n = i + 1
        frac = Math.max(0, (st - y) / h)
      }
      if (y + h > st - el.clientHeight && y < st + el.clientHeight * 2) vis.add(i + 1)
      y += h + 16
    }
    setVisible((old) => (sameSet(old, vis) ? old : vis))
    setPage(n)
    const progress = Math.min(1, (st + el.clientHeight) / el.scrollHeight)
    props.onPosition(n, Math.min(1, frac), progress)
    setChip(true)
    if (chipTimer.current) clearTimeout(chipTimer.current)
    chipTimer.current = setTimeout(() => !chipEdit && setChip(false), 1500)
  }
  useEffect(() => {
    if (sizes && width) onScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, width, scale])

  // 跳转
  useEffect(() => {
    const j = props.jump
    if (!j || j.kind !== 'page' || !sizes || !scroller.current) return
    const p = Math.min(Math.max(1, j.page), sizes.length)
    const frac = j.frac ?? 0
    scroller.current.scrollTop = pageTop(p) + Math.max(0, frac * sizes[p - 1].h * scale - 80)
    if (j.annId) {
      setFlashAnn(j.annId)
      setTimeout(() => setFlashAnn(null), 1400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jump?.nonce, sizes])

  // 选区：松开鼠标时看选中了什么
  const onMouseUp = (e: React.MouseEvent): void => {
    erasing.current = false
    if (drawing) {
      if (drawing.points.length >= 2) props.onInkAdd(drawing)
      setDrawing(null)
      return
    }
    if (props.inkTool) return
    if (box) return finishBox()
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      // 点在已有高亮上
      const hit = hitAnn(e.clientX, e.clientY)
      if (hit) {
        const el = document.querySelector(`[data-ann="${hit.id}"]`)
        props.onSelect({
          text: hit.text,
          paragraph: '',
          getRect: () => el?.getBoundingClientRect() ?? null,
          target: null,
          existing: hit
        })
      } else props.onSelect(null)
      return
    }
    const range = sel.getRangeAt(0)
    const text = selectionText(sel)
    if (text.length < 2) return props.onSelect(null)
    const pageEl = (range.startContainer.parentElement ?? (range.startContainer as Element)).closest('.page') as HTMLElement | null
    if (!pageEl) return props.onSelect(null)
    const n = Number(pageEl.dataset.page)
    const rects = normRects(range, pageEl)
    const r = range.cloneRange()
    props.onSelect({
      text,
      paragraph: paragraphAround(pageEl, range),
      getRect: () => r.getBoundingClientRect(),
      target: { mode: 'pdf', page: n, rects }
    })
  }

  const hitAnn = (x: number, y: number): Annotation | null => {
    for (const el of document.querySelectorAll<HTMLElement>('.pdf-hl')) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return props.anns.find((a) => a.id === el.dataset.ann) ?? null
    }
    return null
  }

  // 框选：标题栏「框选」或按住 ⌥ 拖
  // 鼠标在哪一页的哪个位置（页内 0 到 1）
  const pagePoint = (e: { clientX: number; clientY: number }, page?: number): { page: number; x: number; y: number; w: number; h: number } | null => {
    const el = (page ? document.querySelector(`.page[data-page="${page}"]`) : document.elementFromPoint(e.clientX, e.clientY)?.closest('.page')) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { page: Number(el.dataset.page), x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), w: r.width, h: r.height }
  }
  // 橡皮：碰到的笔画（离任何一段不到 8 像素）整笔擦掉
  const eraseAt = (e: { clientX: number; clientY: number }): void => {
    const q = pagePoint(e)
    if (!q) return
    const near = (k: Ink): boolean =>
      k.points.some((a, i) => {
        const b = k.points[i + 1] ?? a
        const [ax, ay, bx, by, px, py] = [a[0] * q.w, a[1] * q.h, b[0] * q.w, b[1] * q.h, q.x * q.w, q.y * q.h]
        const dx = bx - ax
        const dy = by - ay
        const t_ = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
        return Math.hypot(px - (ax + t_ * dx), py - (ay + t_ * dy)) < 8
      })
    for (const k of props.inks) if (k.page === q.page && near(k)) props.onInkErase(k.id)
  }

  const onMouseDown = (e: React.MouseEvent): void => {
    if (props.inkTool && e.button === 0) {
      const q = pagePoint(e)
      if (!q) return
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      if (props.inkTool.kind === 'pen') setDrawing({ page: q.page, points: [[q.x, q.y]] })
      else ((erasing.current = true), eraseAt(e))
      return
    }
    if (!(props.boxMode || e.altKey) || e.button !== 0) return
    const pageEl = (e.target as Element).closest('.page') as HTMLElement | null
    if (!pageEl) return
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    const r = pageEl.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    setBox({ page: Number(pageEl.dataset.page), x0: x, y0: y, x1: x, y1: y })
  }
  const preview = useNotePreview(
    useCallback(
      (x: number, y: number) => {
        for (const el of document.querySelectorAll<HTMLElement>('.pdf-hl.noted')) {
          const r = el.getBoundingClientRect()
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const a = props.anns.find((n) => n.id === el.dataset.ann)
            if (a?.note || a?.label) return { note: [a.label ? `【${LABEL_NAME[a.label]}】` : '', a.note].filter(Boolean).join('\n'), rect: r }
          }
        }
        return null
      },
      [props.anns]
    )
  )

  const onMouseMove = (e: React.MouseEvent): void => {
    if (drawing) {
      const q = pagePoint(e, drawing.page)
      const last = drawing.points[drawing.points.length - 1]
      if (q && Math.hypot((q.x - last[0]) * q.w, (q.y - last[1]) * q.h) >= 1.5) setDrawing({ ...drawing, points: [...drawing.points, [Math.round(q.x * 1e4) / 1e4, Math.round(q.y * 1e4) / 1e4]] })
      return
    }
    if (erasing.current) return eraseAt(e)
    preview.onMove(e)
    if (!box) return
    const pageEl = document.querySelector(`.page[data-page="${box.page}"]`)
    if (!pageEl) return
    const r = pageEl.getBoundingClientRect()
    setBox({ ...box, x1: Math.min(Math.max(0, e.clientX - r.left), r.width), y1: Math.min(Math.max(0, e.clientY - r.top), r.height) })
  }
  const finishBox = (): void => {
    const b = box!
    setBox(null)
    const w = Math.abs(b.x1 - b.x0)
    const h = Math.abs(b.y1 - b.y0)
    if (w < 8 || h < 8) return
    const canvas = document.querySelector<HTMLCanvasElement>(`.page[data-page="${b.page}"] canvas`)
    const pageEl = document.querySelector<HTMLElement>(`.page[data-page="${b.page}"]`)
    if (!canvas || !pageEl) return
    const k = canvas.width / pageEl.clientWidth
    const out = document.createElement('canvas')
    out.width = Math.round(w * k)
    out.height = Math.round(h * k)
    const x = Math.min(b.x0, b.x1)
    const y = Math.min(b.y0, b.y1)
    out.getContext('2d')!.drawImage(canvas, x * k, y * k, w * k, h * k, 0, 0, out.width, out.height)
    // 框里的文字：文字层里和框相交的字
    const pr = pageEl.getBoundingClientRect()
    const area = new DOMRect(pr.left + x, pr.top + y, w, h)
    const words: string[] = []
    for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span')) {
      const r = span.getBoundingClientRect()
      if (r.right > area.left && r.left < area.right && r.bottom > area.top && r.top < area.bottom && span.textContent) words.push(span.textContent)
    }
    const W = pageEl.clientWidth
    const H = pageEl.clientHeight
    props.onBox(out.toDataURL('image/png'), b.page, [x / W, y / H, w / W, h / H], words.join(' ').replace(/\s+/g, ' ').trim())
  }

  const jumpTo = (n: number): void => {
    if (!sizes || !scroller.current) return
    scroller.current.scrollTop = pageTop(Math.min(Math.max(1, n), sizes.length))
  }

  return (
    <div className={'pdf-wrap' + (props.invert ? ' invert' : '')}>
      <div
        className={'pdf-scroller' + (props.boxMode ? ' box-mode' : '') + (props.inkTool ? ` ink-mode ink-${props.inkTool.kind}` : '')}
        ref={scroller}
        onScroll={onScroll}
        onMouseUp={onMouseUp}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={preview.onLeave}
      >
        {preview.node}
        {sizes?.map((s, i) => (
          <PageView
            key={i}
            pdf={pdf}
            n={i + 1}
            w={s.w * scale}
            h={s.h * scale}
            scale={scale}
            render={visible.has(i + 1)}
            anns={props.anns.filter((a) => a.mode === 'pdf' && a.page === i + 1)}
            found={found}
            hoverAnn={props.hoverAnn}
            flashAnn={flashAnn}
            onFound={(a, rects) => {
              setFound((f) => ({ ...f, [a.id]: rects }))
              props.onRectsFound(a, rects)
            }}
            box={box && box.page === i + 1 ? box : null}
            shot={props.shot && props.shot.page === i + 1 ? props.shot.frac : null}
            inks={props.inks.filter((k) => k.page === i + 1)}
            drawing={drawing && drawing.page === i + 1 && props.inkTool?.kind === 'pen' ? { points: drawing.points, color: props.inkTool.color } : null}
          />
        ))}
      </div>
      {sizes && (chip || chipEdit) && (
        <div className="page-chip num" onMouseEnter={() => setChip(true)}>
          {chipEdit ? (
            <input
              autoFocus
              className="chip-input num"
              defaultValue={page}
              onBlur={() => setChipEdit(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  jumpTo(Number((e.target as HTMLInputElement).value))
                  setChipEdit(false)
                }
                if (e.key === 'Escape') setChipEdit(false)
              }}
            />
          ) : (
            <button className="chip-btn" onClick={() => setChipEdit(true)} title={t('跳到页')}>
              {page} / {sizes.length}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function paragraphAround(pageEl: Element, range: Range): string {
  const layer = pageEl.querySelector('.textLayer')
  if (!layer) return ''
  const all = layer.textContent ?? ''
  const pre = document.createRange()
  pre.selectNodeContents(layer)
  try {
    pre.setEnd(range.startContainer, range.startOffset)
  } catch {
    return ''
  }
  const at = pre.toString().length
  return all.slice(Math.max(0, at - 600), at + 600).replace(/\s+/g, ' ')
}

const HL_BG: Record<string, string> = { yellow: 'var(--hl-yellow)', green: 'var(--hl-green)', blue: 'var(--hl-blue)', red: 'var(--hl-red)' }

const PageView = memo(function PageView(p: {
  pdf: PdfJs.PDFDocumentProxy
  n: number
  w: number
  h: number
  scale: number
  render: boolean
  anns: Annotation[]
  found: Record<string, number[][]>
  hoverAnn: string | null
  flashAnn: string | null
  onFound: (a: Annotation, rects: number[][]) => void
  box: { x0: number; y0: number; x1: number; y1: number } | null
  shot: [number, number, number, number] | null
  inks: Ink[]
  drawing: { points: [number, number][]; color: string } | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [textReady, setTextReady] = useState(0)

  useEffect(() => {
    if (!p.render) return
    let cancelled = false
    let task: PdfJs.RenderTask | null = null
    let tl: PdfJs.TextLayer | null = null
    void (async () => {
      const page = await p.pdf.getPage(p.n)
      if (cancelled) return
      const vp = page.getViewport({ scale: p.scale })
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current!
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      task = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled || !textRef.current) return
      textRef.current.replaceChildren()
      tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport: vp })
      await tl.render().catch(() => {})
      if (!cancelled) setTextReady((x) => x + 1)
    })()
    return () => {
      cancelled = true
      task?.cancel()
      tl?.cancel()
    }
  }, [p.pdf, p.n, p.scale, p.render])

  // 没有矩形的高亮（从 Scholaread 导入的）在文字层里按原文找位置
  useEffect(() => {
    if (!textReady || !textRef.current) return
    const pageEl = textRef.current.parentElement!
    for (const a of p.anns) {
      if (a.rects?.length || p.found[a.id]) continue
      const r = findTextRange(textRef.current, a.text)
      if (r) {
        const rects = normRects(r, pageEl)
        if (rects.length) p.onFound(a, rects)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textReady, p.anns])

  return (
    <div className="page" data-page={p.n} style={{ width: p.w, height: p.h, ['--total-scale-factor' as string]: p.scale, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}>
      <canvas ref={canvasRef} style={{ width: p.w, height: p.h }} />
      <div className="hl-layer">
        {p.anns.map((a) =>
          (a.rects?.length ? a.rects : (p.found[a.id] ?? [])).map((r, i) => (
            <div
              key={a.id + i}
              className={'pdf-hl' + (a.style === 'underline' ? ' ul' : '') + (a.note || a.label ? ' noted' : '') + (a.label ? ` lb-${a.label}` : '') + (p.hoverAnn === a.id ? ' hover' : '') + (p.flashAnn === a.id ? ' flash' : '')}
              data-ann={a.id}
              data-color={a.color}
              style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%`, background: a.label ? 'none' : HL_BG[a.color] }}
            />
          ))
        )}
      </div>
      <div className="textLayer" ref={textRef} />
      {(p.inks.length > 0 || p.drawing) && (
        <svg className="ink-layer" viewBox="0 0 1 1" preserveAspectRatio="none">
          {p.inks.map((k) => (
            <polyline key={k.id} data-ink={k.id} points={k.points.map((q) => q.join(',')).join(' ')} stroke={k.color} strokeWidth={k.width * p.scale} />
          ))}
          {p.drawing && <polyline points={p.drawing.points.map((q) => q.join(',')).join(' ')} stroke={p.drawing.color} strokeWidth={INK_WIDTH * p.scale} />}
        </svg>
      )}
      {p.shot && <div className="box-rect shot" style={{ left: `${p.shot[0] * 100}%`, top: `${p.shot[1] * 100}%`, width: `${p.shot[2] * 100}%`, height: `${p.shot[3] * 100}%` }} />}
      {p.box && (
        <div
          className="box-rect"
          style={{ left: Math.min(p.box.x0, p.box.x1), top: Math.min(p.box.y0, p.box.y1), width: Math.abs(p.box.x1 - p.box.x0), height: Math.abs(p.box.y1 - p.box.y0) }}
        />
      )}
    </div>
  )
})
