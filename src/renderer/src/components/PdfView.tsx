import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LABEL_NAME } from '@shared/annLabels'
import { isSettled, STATUS_NAME, statusOf } from '@shared/explain'
import type * as PdfJs from 'pdfjs-dist'
import type { Annotation, Idea, Paper, ReadPosition, Ink} from '@shared/types'
import type { LayoutTrState } from '@shared/layoutTr'
import { IdeaGutter, useIdeaPeek, type Peek } from './IdeaMarks'
import { pdfjs } from '../lib/pdf'
import { findTextRange, normRects, selectionText } from '../lib/selection'
import { useNotePreview } from '../lib/ui'
import type { Jump } from './Reader'
import type { SelInfo } from './Selection'
import { t } from '@shared/i18n'
import { useJumpBack, type BackHandle } from './BackPill'

interface Size {
  w: number
  h: number
}

// 手写笔：当前选的是笔（带颜色）还是橡皮；笔画粗细（缩放 100% 时的像素）
export type InkTool = { kind: 'pen'; color: string } | { kind: 'eraser' }
export const INK_WIDTH = 2.5
export const INK_COLORS = ['#e5484d', '#2f6fde', '#1d1d1f']

/**
 * 对照、译文看法（保版面翻译）：一行一页，左原页右译页（side），窄时原页在上译页在下（stack），或者只有译页（mono）。
 * 译页是 BabelDOC 出的译文 PDF 里的一页（docs 按文件名），版面和原页一样，所以框、划线都用同一套页内比例坐标。
 * 还没翻到的页：放变灰的原页，上面一张小卡（pending 画）。
 */
export interface TrView {
  layout: 'side' | 'stack' | 'mono'
  state: LayoutTrState | null
  docs: Record<string, PdfJs.PDFDocumentProxy>
  pending: (n: number) => React.ReactNode
}
export type PageSide = 'src' | 'tr'
// 对照里页上面那一行「第 9 页 · 原文」的高
const LABEL = 24
// 左右两页之间、上下两页之间
const GAP_X = 16
const GAP_Y = 8

// 原文模式：pdf.js 连续滚动。页面进入视口附近才渲染画布和文字层；高亮是盖在文字层上的矩形。
export function PdfView(props: {
  /** 对照、译文看法；原文看法没有 */
  tr?: TrView
  pdf: PdfJs.PDFDocumentProxy
  paper: Paper
  anns: Annotation[]
  ideas: Idea[]
  focusIdea: string | null
  onIdeaLibrary: (i: Idea) => void
  onIdeaRemove: (i: Idea) => void
  zoom: number
  invert: boolean
  boxMode: boolean
  shot: { page: number; frac: [number, number, number, number]; side?: PageSide } | null
  jump: Jump | null
  hoverAnn: string | null
  initial: ReadPosition
  onPosition: (page: number, frac: number, progress: number) => void
  onSelect: (s: SelInfo | null) => void
  onBox: (dataUrl: string, page: number, frac: [number, number, number, number], text: string, side: PageSide) => void
  onRectsFound: (a: Annotation, rects: number[][]) => void
  inkTool: InkTool | null
  inks: Ink[]
  onInkAdd: (k: { page: number; points: [number, number][] }) => void
  onInkErase: (id: string) => void
  backHandle?: BackHandle
}) {
  const ideaPeek = useIdeaPeek()
  const { pdf } = props
  const scroller = useRef<HTMLDivElement>(null)
  const back = useJumpBack(scroller, props.backHandle)
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]))
  const [page, setPage] = useState(1)
  const [chip, setChip] = useState(false)
  const [chipEdit, setChipEdit] = useState(false)
  const [found, setFound] = useState<Record<string, number[][]>>({})
  const [flashAnn, setFlashAnn] = useState<string | null>(null)
  const [box, setBox] = useState<{ page: number; side: PageSide; x0: number; y0: number; x1: number; y1: number } | null>(null)
  const tr = props.tr
  const layout = tr?.layout
  // 这一页在页面上的那个元素：对照里一页有原页、译页两个
  const pageEl = (n: number, side: PageSide = layout === 'mono' ? 'tr' : 'src'): HTMLElement | null => scroller.current?.querySelector<HTMLElement>(`.page[data-page="${n}"][data-side="${side}"]`) ?? null
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
  const fit = width ? (layout === 'side' ? (width - 64 - GAP_X) / 2 : width - 64) / maxW : 1
  const scale = Math.max(0.3, fit * props.zoom)
  // 一行多高：原文看法一行就是一页；对照里多一行页名，上下排时一行是原页加译页
  const label = tr ? LABEL : 0
  const rowH = (h: number): number => (layout === 'stack' ? 2 * (label + h) + GAP_Y : label + h)

  // 缩放前记住页码和页内位置，布局完滚回去
  const anchor = useRef<{ page: number; frac: number } | null>(null)
  const pageTop = useCallback(
    (n: number) => {
      if (!sizes) return 0
      let y = 16
      for (let i = 0; i < n - 1; i++) y += rowH(sizes[i].h * scale) + 16
      return y + label
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sizes, scale, layout]
  )
  const prevScale = useRef(scale)
  if (prevScale.current !== scale && scroller.current && sizes) {
    const st = scroller.current.scrollTop
    let y = 16
    let n = 1
    for (let i = 0; i < sizes.length; i++) {
      const h = rowH(sizes[i].h * prevScale.current)
      if (y + h + 16 > st) {
        n = i + 1
        break
      }
      y += h + 16
    }
    anchor.current = { page: n, frac: (st - y - label) / (sizes[n - 1].h * prevScale.current) }
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
    if (p && p <= sizes.length) scroller.current.scrollTop = pageTop(p) + (props.initial.pageFrac ?? 0) * sizes[p - 1].h * scale - (props.initial.pageFrac ? 0 : label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, width])

  const onScroll = (): void => {
    back.onScroll()
    const el = scroller.current
    if (!el || !sizes) return
    const st = el.scrollTop
    const mid = st + el.clientHeight / 3
    let y = 16
    let n = 1
    let frac = 0
    const vis = new Set<number>()
    for (let i = 0; i < sizes.length; i++) {
      const h = rowH(sizes[i].h * scale)
      if (y <= mid) {
        n = i + 1
        frac = Math.max(0, (st - y - label) / (sizes[i].h * scale))
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
    scroller.current.scrollTop = pageTop(p) + Math.max(0, frac * sizes[p - 1].h * scale - 80) - (frac ? 0 : label)
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
    if ((e.target as Element).closest('.idea-gut, .idea-peek')) return
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
    const pg = (range.startContainer.parentElement ?? (range.startContainer as Element)).closest('.page') as HTMLElement | null
    if (!pg || pg.classList.contains('pending')) return props.onSelect(null)
    const n = Number(pg.dataset.page)
    const rects = normRects(range, pg)
    const r = range.cloneRange()
    props.onSelect({
      text,
      paragraph: paragraphAround(pg, range),
      getRect: () => r.getBoundingClientRect(),
      target: { mode: 'pdf', page: n, rects, ...(pg.dataset.side === 'tr' ? { side: 'tr' as const } : {}) }
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
    const el = (page ? pageEl(page) : document.elementFromPoint(e.clientX, e.clientY)?.closest('.page[data-side="src"]')) as HTMLElement | null
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
    const pg = (e.target as Element).closest('.page') as HTMLElement | null
    if (!pg || pg.classList.contains('pending')) return
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    const r = pg.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    setBox({ page: Number(pg.dataset.page), side: (pg.dataset.side as PageSide) ?? 'src', x0: x, y0: y, x1: x, y1: y })
  }
  const preview = useNotePreview(
    useCallback(
      (x: number, y: number) => {
        for (const el of document.querySelectorAll<HTMLElement>('.pdf-hl.noted')) {
          const r = el.getBoundingClientRect()
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const a = props.anns.find((n) => n.id === el.dataset.ann)
            if (a?.note || a?.label) return { note: [a.label ? `【${LABEL_NAME[a.label]} · ${STATUS_NAME[statusOf(a)!]}】` : '', a.note].filter(Boolean).join('\n'), rect: r }
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
    const pg = pageEl(box.page, box.side)
    if (!pg) return
    const r = pg.getBoundingClientRect()
    setBox({ ...box, x1: Math.min(Math.max(0, e.clientX - r.left), r.width), y1: Math.min(Math.max(0, e.clientY - r.top), r.height) })
  }
  const finishBox = (): void => {
    const b = box!
    setBox(null)
    const w = Math.abs(b.x1 - b.x0)
    const h = Math.abs(b.y1 - b.y0)
    if (w < 8 || h < 8) return
    const pg = pageEl(b.page, b.side)
    const canvas = pg?.querySelector<HTMLCanvasElement>('canvas')
    if (!canvas || !pg) return
    const k = canvas.width / pg.clientWidth
    const out = document.createElement('canvas')
    out.width = Math.round(w * k)
    out.height = Math.round(h * k)
    const x = Math.min(b.x0, b.x1)
    const y = Math.min(b.y0, b.y1)
    out.getContext('2d')!.drawImage(canvas, x * k, y * k, w * k, h * k, 0, 0, out.width, out.height)
    // 框里的文字：文字层里和框相交的字
    const pr = pg.getBoundingClientRect()
    const area = new DOMRect(pr.left + x, pr.top + y, w, h)
    const words: string[] = []
    for (const span of pg.querySelectorAll<HTMLElement>('.textLayer span')) {
      const r = span.getBoundingClientRect()
      if (r.right > area.left && r.left < area.right && r.bottom > area.top && r.top < area.bottom && span.textContent) words.push(span.textContent)
    }
    const W = pg.clientWidth
    const H = pg.clientHeight
    props.onBox(out.toDataURL('image/png'), b.page, [x / W, y / H, w / W, h / H], words.join(' ').replace(/\s+/g, ' ').trim(), b.side)
  }

  const jumpTo = (n: number): void => {
    if (!sizes || !scroller.current) return
    back.remember(t('回到第 {0} 页', page))
    scroller.current.scrollTop = pageTop(Math.min(Math.max(1, n), sizes.length)) - label
  }

  // PDF 自己的内部链接（引用角标、图表编号）：跳到它指的那一页那一处，跳之前记下位置
  const followLink = async (dest: unknown, from: number): Promise<void> => {
    if (!sizes || !scroller.current) return
    const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(d) || d[0] == null) return
    const index = typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0] as never).catch(() => -1)
    if (index < 0 || index >= sizes.length) return
    const n = index + 1
    const kind = (d[1] as { name?: string } | undefined)?.name
    const y = kind === 'XYZ' ? d[3] : kind === 'FitH' || kind === 'FitBH' ? d[2] : null
    let frac = 0
    if (typeof y === 'number') {
      const vp = (await pdf.getPage(n)).getViewport({ scale: 1 })
      frac = Math.min(1, Math.max(0, vp.convertToViewportPoint(0, y)[1] / vp.height))
    }
    back.remember(t('回到第 {0} 页', from))
    scroller.current.scrollTop = pageTop(n) + Math.max(0, frac * sizes[index].h * scale - 40)
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
        {sizes?.map((s, i) => {
          const n = i + 1
          const w = s.w * scale
          const h = s.h * scale
          const src = (
            <PageView
              key={tr ? 'src' : i}
              pdf={pdf}
              n={n}
              side="src"
              w={w}
              h={h}
              scale={scale}
              render={visible.has(n)}
              anns={props.anns.filter((a) => a.mode === 'pdf' && a.page === n && a.side !== 'tr')}
              across={tr ? props.anns.filter((a) => a.mode === 'pdf' && a.page === n && a.side === 'tr') : []}
              ideas={props.ideas.filter((x) => x.page === n)}
              focusIdea={props.focusIdea}
              peek={ideaPeek}
              onIdeaLibrary={props.onIdeaLibrary}
              onIdeaRemove={props.onIdeaRemove}
              found={found}
              hoverAnn={props.hoverAnn}
              flashAnn={flashAnn}
              onFound={(a, rects) => {
                setFound((f) => ({ ...f, [a.id]: rects }))
                props.onRectsFound(a, rects)
              }}
              box={box && box.page === n && box.side === 'src' ? box : null}
              mirror={tr && box && box.page === n && box.side === 'tr' ? box : null}
              shot={props.shot && props.shot.page === n ? props.shot.frac : null}
              shotMirror={!!tr && props.shot?.side === 'tr'}
              inks={props.inks.filter((k) => k.page === n)}
              drawing={drawing && drawing.page === n && props.inkTool?.kind === 'pen' ? { points: drawing.points, color: props.inkTool.color } : null}
              onLink={(dest) => void followLink(dest, n)}
            />
          )
          if (!tr) return src
          const at = tr.state?.pages[n]
          const doc = at ? tr.docs[at.file] : undefined
          const trPage = doc ? (
            <PageView
              key="tr"
              pdf={doc}
              n={at!.at}
              page={n}
              side="tr"
              w={w}
              h={h}
              scale={scale}
              render={visible.has(n)}
              anns={props.anns.filter((a) => a.mode === 'pdf' && a.page === n && a.side === 'tr')}
              across={layout === 'mono' ? [] : props.anns.filter((a) => a.mode === 'pdf' && a.page === n && a.side !== 'tr')}
              ideas={[]}
              focusIdea={null}
              peek={ideaPeek}
              onIdeaLibrary={props.onIdeaLibrary}
              onIdeaRemove={props.onIdeaRemove}
              found={found}
              hoverAnn={props.hoverAnn}
              flashAnn={flashAnn}
              onFound={() => {}}
              box={box && box.page === n && box.side === 'tr' ? box : null}
              mirror={layout !== 'mono' && box && box.page === n && box.side === 'src' ? box : null}
              shot={props.shot && props.shot.page === n ? props.shot.frac : null}
              shotMirror={props.shot?.side !== 'tr'}
              inks={[]}
              drawing={null}
              onLink={() => {}}
            />
          ) : (
            // 还没翻到：变灰的原页，上面一张小卡说翻到哪了
            <PageView key="pending" pdf={pdf} n={n} side="tr" pending={<>{tr.pending(n)}</>} w={w} h={h} scale={scale} render={visible.has(n)} anns={[]} across={[]} ideas={[]} focusIdea={null} peek={ideaPeek} onIdeaLibrary={props.onIdeaLibrary} onIdeaRemove={props.onIdeaRemove} found={found} hoverAnn={null} flashAnn={null} onFound={() => {}} box={null} mirror={null} shot={null} shotMirror={false} inks={[]} drawing={null} onLink={() => {}} />
          )
          // 页名：第一行写全「第 9 页 · 原文 / 译文」，往下只在左边写页码
          const first = i === 0 || n === page
          const srcName = first || layout === 'stack' ? t('第 {0} 页 · 原文', n) : t('第 {0} 页', n)
          const trName = layout === 'mono' ? t('第 {0} 页', n) : first || layout === 'stack' ? t('第 {0} 页 · 译文', n) : ''
          return (
            <div key={i} className={`tr-row lay-${layout}`} style={{ height: rowH(h) }}>
              {layout !== 'mono' && (
                <div className="tr-cell">
                  <div className="tr-label num">{srcName}</div>
                  {src}
                </div>
              )}
              <div className="tr-cell">
                <div className="tr-label num">{trName}</div>
                {trPage}
              </div>
            </div>
          )
        })}
        {back.node && <div className="back-dock">{back.node}</div>}
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
  /** 在 pdf 里是第几页（译页是译文文件里的第几页） */
  n: number
  /** 原 PDF 的第几页（data-page），不给就是 n */
  page?: number
  side: PageSide
  /** 还没翻到的译页：画变灰的原页，盖上这张卡 */
  pending?: React.ReactNode
  /** 对面那一页上的标注：这边只在左边距画一道同色的竖线，表示「对面这块划过」 */
  across: Annotation[]
  /** 对面正在框的那一块：这边同一位置画虚线框 */
  mirror: { x0: number; y0: number; x1: number; y1: number } | null
  shotMirror: boolean
  w: number
  h: number
  scale: number
  render: boolean
  anns: Annotation[]
  ideas: Idea[]
  focusIdea: string | null
  peek: Peek
  onIdeaLibrary: (i: Idea) => void
  onIdeaRemove: (i: Idea) => void
  found: Record<string, number[][]>
  hoverAnn: string | null
  flashAnn: string | null
  onFound: (a: Annotation, rects: number[][]) => void
  box: { x0: number; y0: number; x1: number; y1: number } | null
  shot: [number, number, number, number] | null
  inks: Ink[]
  drawing: { points: [number, number][]; color: string } | null
  onLink: (dest: unknown) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [textReady, setTextReady] = useState(0)
  // 这一页上的链接：页内比例坐标；dest 是 PDF 内部的目标，url 是外部网址
  const [links, setLinks] = useState<{ r: [number, number, number, number]; dest?: unknown; url?: string }[]>([])

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
      const vp1 = page.getViewport({ scale: 1 })
      const annots = (await page.getAnnotations({ intent: 'display' }).catch(() => [])) as { subtype?: string; rect?: number[]; dest?: unknown; url?: string }[]
      if (cancelled) return
      setLinks(
        annots
          .filter((a) => a.subtype === 'Link' && a.rect && (a.dest || a.url))
          .map((a) => {
            const [x1, y1] = vp1.convertToViewportPoint(a.rect![0], a.rect![1]) as number[]
            const [x2, y2] = vp1.convertToViewportPoint(a.rect![2], a.rect![3]) as number[]
            return { r: [Math.min(x1, x2) / vp1.width, Math.min(y1, y2) / vp1.height, Math.abs(x2 - x1) / vp1.width, Math.abs(y2 - y1) / vp1.height] as [number, number, number, number], dest: a.dest, url: a.url }
          })
      )
    })()
    return () => {
      cancelled = true
      task?.cancel()
      tl?.cancel()
    }
  }, [p.pdf, p.n, p.scale, p.render])

  // 灵感：原文模式收的有矩形；对照模式收的按原句在这一页的文字层里找
  const [ideaFound, setIdeaFound] = useState<Record<string, number[][]>>({})
  useEffect(() => {
    if (!textReady || !textRef.current) return
    const pageEl = textRef.current.parentElement!
    const next: Record<string, number[][]> = {}
    for (const i of p.ideas) {
      if (i.rects?.length) continue
      const r = findTextRange(textRef.current, i.text)
      if (r) next[i.id] = normRects(r, pageEl)
    }
    setIdeaFound(next)
  }, [textReady, p.ideas])
  const ideaRects = (i: Idea): number[][] => (i.rects?.length ? i.rects : (ideaFound[i.id] ?? []))
  // 灯泡在页边，和句子第一行齐：句子（几行合起来）在左半页放这一栏左边，在右半页放这一栏右边；
  // 句子从行中间开始时第一行的矩形在栏中间，所以栏的边按所有行里最左、最右的算
  const ideaMarks = p.ideas
    .map((i) => ({ i, rs: ideaRects(i) }))
    .filter((x) => x.rs.length)
    .map(({ i, rs }) => {
      const l = Math.min(...rs.map((r) => r[0]))
      const rr = Math.max(...rs.map((r) => r[0] + r[2]))
      const f = rs[0]
      return { id: i.id, top: f[1] * p.h + (f[3] * p.h - 22) / 2, left: (l + rr) / 2 < 0.5 ? Math.max(2, l * p.w - 30) : Math.min(p.w - 24, rr * p.w + 8) }
    })

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
    <div className={'page' + (p.side === 'tr' ? ' tr-page' : '') + (p.pending ? ' pending' : '')} data-page={p.page ?? p.n} data-side={p.side} style={{ width: p.w, height: p.h, ['--total-scale-factor' as string]: p.scale, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}>
      <canvas ref={canvasRef} style={{ width: p.w, height: p.h }} />
      <div className="hl-layer">
        {p.anns.map((a) =>
          (a.rects?.length ? a.rects : (p.found[a.id] ?? [])).map((r, i) => (
            <div
              key={a.id + i}
              className={'pdf-hl' + (a.style === 'underline' ? ' ul' : '') + (a.note || a.label ? ' noted' : '') + (a.label ? ` lb-${a.label}${isSettled(a) ? ' done' : ''}` : '') + (p.hoverAnn === a.id ? ' hover' : '') + (p.flashAnn === a.id ? ' flash' : '')}
              data-ann={a.id}
              data-color={a.color}
              style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%`, ...(a.label ? {} : { background: HL_BG[a.color] }) }}
            />
          ))
        )}
      </div>
      <div className="hl-layer">
        {p.ideas
          .filter((i) => p.peek.id === i.id || p.focusIdea === i.id)
          .flatMap((i) => ideaRects(i).map((r, k) => <div key={i.id + k} className="pdf-idea-line" style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }} />))}
      </div>
      {p.across.length > 0 && (
        <div className="hl-layer">
          {p.across.map((a) => {
            const rs = a.rects ?? []
            if (!rs.length) return null
            const top = Math.min(...rs.map((r) => r[1]))
            const bottom = Math.max(...rs.map((r) => r[1] + r[3]))
            const left = Math.min(...rs.map((r) => r[0]))
            return <div key={a.id} className="pdf-across" data-color={a.color} title={t('对面那页这一块划过')} style={{ left: `max(6px, calc(${left * 100}% - 12px))`, top: `${top * 100}%`, height: `${(bottom - top) * 100}%` }} />
          })}
        </div>
      )}
      <div className="textLayer" ref={textRef} />
      {p.pending && <div className="tr-pending">{p.pending}</div>}
      <div className="idea-layer">
        <IdeaGutter marks={ideaMarks} ideas={p.ideas} focus={p.focusIdea} peek={p.peek} onLibrary={p.onIdeaLibrary} onRemove={p.onIdeaRemove} />
      </div>
      {links.length > 0 && (
        <div className="link-layer">
          {links.map((l, i) => (
            <a
              key={i}
              className="pdf-link"
              href={l.url}
              target={l.url ? '_blank' : undefined}
              rel="noreferrer"
              title={l.url ?? undefined}
              style={{ left: `${l.r[0] * 100}%`, top: `${l.r[1] * 100}%`, width: `${l.r[2] * 100}%`, height: `${l.r[3] * 100}%` }}
              onClick={(e) => {
                if (l.url) return
                e.preventDefault()
                p.onLink(l.dest)
              }}
            />
          ))}
        </div>
      )}
      {(p.inks.length > 0 || p.drawing) && (
        <svg className="ink-layer" viewBox="0 0 1 1" preserveAspectRatio="none">
          {p.inks.map((k) => (
            <polyline key={k.id} data-ink={k.id} points={k.points.map((q) => q.join(',')).join(' ')} stroke={k.color} strokeWidth={k.width * p.scale} />
          ))}
          {p.drawing && <polyline points={p.drawing.points.map((q) => q.join(',')).join(' ')} stroke={p.drawing.color} strokeWidth={INK_WIDTH * p.scale} />}
        </svg>
      )}
      {p.shot && <div className={'box-rect shot' + (p.shotMirror ? ' mirror' : '')} style={{ left: `${p.shot[0] * 100}%`, top: `${p.shot[1] * 100}%`, width: `${p.shot[2] * 100}%`, height: `${p.shot[3] * 100}%` }} />}
      {p.mirror && (
        <div className="box-rect mirror" style={{ left: Math.min(p.mirror.x0, p.mirror.x1), top: Math.min(p.mirror.y0, p.mirror.y1), width: Math.abs(p.mirror.x1 - p.mirror.x0), height: Math.abs(p.mirror.y1 - p.mirror.y0) }} />
      )}
      {p.box && (
        <div
          className="box-rect"
          style={{ left: Math.min(p.box.x0, p.box.x1), top: Math.min(p.box.y0, p.box.y1), width: Math.abs(p.box.x1 - p.box.x0), height: Math.abs(p.box.y1 - p.box.y0) }}
        />
      )}
    </div>
  )
})
