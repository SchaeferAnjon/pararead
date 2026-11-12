import { ChevronDown, ChevronUp, Info, Merge, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as PdfJs from 'pdfjs-dist'
import type { ReflowDoc } from '@shared/types'
import { api, errText, REGION_TYPES, type Layout, type Region, type RegionType } from '../api'
import { showMenu } from '../lib/menu'
import { useToast } from '../lib/ui'
import { Modal, ModalHead } from './PaperInfo'
import { t } from '@shared/i18n'

const COLOR: Record<RegionType, string> = {
  title: 'var(--c-gray)',
  heading: 'var(--c-gray)',
  text: 'var(--c-blue)',
  list: 'var(--c-blue)',
  code: 'var(--c-purple)',
  image: 'var(--c-green)',
  table: 'var(--c-teal)',
  equation: 'var(--c-orange)',
  caption: 'var(--c-teal)',
  footnote: 'var(--c-pink)',
  reference: 'var(--c-pink)',
  discard: 'var(--c-red)'
}
const NAME = Object.fromEntries(REGION_TYPES.map((t_) => [t_.id, t_.name])) as Record<RegionType, string>
const VIEW_W = 620

type Drag = { kind: 'move' | 'size' | 'new'; id: string; x0: number; y0: number; b0: Region['bbox'] }

// 调整重排区域：MinerU 版面块画在 PDF 页上，拖动改位置大小，在空白处拖出新块，右边改类型和顺序；保存后按新版面重排整篇
export function RegionEditor(props: { paperId: string; pdf: PdfJs.PDFDocumentProxy; startPage: number; onClose: () => void; onSaved: (d: ReflowDoc | null) => void }) {
  const toast = useToast()
  const [layout, setLayout] = useState<Layout | null>(null)
  const [edited, setEdited] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [line, setLine] = useState('')
  const [page, setPage] = useState(Math.max(0, props.startPage - 1))
  const [sel, setSel] = useState<string | null>(null)
  const [changes, setChanges] = useState(0)
  const [saving, setSaving] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = api.onLayoutProgress((p) => p.paperId === props.paperId && setLine(p.line))
    api
      .layoutGet(props.paperId)
      .then((r) => {
        setLayout(r.layout)
        setEdited(r.edited)
      })
      .catch((e) => setErr(errText(e)))
    return off
  }, [props.paperId])

  const size = layout?.pages[page]
  const viewH = size ? Math.round((VIEW_W * size.height) / size.width) : 800

  // 当前页画在画布上
  useEffect(() => {
    if (!layout) return
    let task: PdfJs.RenderTask | null = null
    void props.pdf.getPage(page + 1).then((pg) => {
      const c = canvasRef.current
      if (!c) return
      const vp1 = pg.getViewport({ scale: 1 })
      const vp = pg.getViewport({ scale: (VIEW_W / vp1.width) * 2 })
      c.width = vp.width
      c.height = vp.height
      task = pg.render({ canvas: c, viewport: vp })
    })
    return () => task?.cancel()
  }, [layout, page, props.pdf])

  const regions = useMemo(() => (layout ? layout.regions.filter((r) => r.page === page).sort((a, b) => a.order - b.order) : []), [layout, page])
  const cur = regions.find((r) => r.id === sel) ?? null

  const update = (id: string, patch: Partial<Region>, count = true): void => {
    setLayout((l) => l && { ...l, regions: l.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
    if (count) setChanges((n) => n + 1)
  }
  const renumber = (list: Region[]): void => {
    const ids = new Map(list.map((r, i) => [r.id, i]))
    setLayout((l) => l && { ...l, regions: l.regions.map((r) => (ids.has(r.id) ? { ...r, order: ids.get(r.id)! } : r)) })
  }
  const move = (d: number): void => {
    if (!cur) return
    const i = regions.indexOf(cur)
    const j = i + d
    if (j < 0 || j >= regions.length) return
    const l = [...regions]
    ;[l[i], l[j]] = [l[j], l[i]]
    renumber(l)
    setChanges((n) => n + 1)
  }
  const remove = (): void => {
    if (!cur) return
    setLayout((l) => l && { ...l, regions: l.regions.filter((r) => r.id !== cur.id) })
    renumber(regions.filter((r) => r.id !== cur.id))
    setSel(null)
    setChanges((n) => n + 1)
  }
  const mergeUp = (): void => {
    if (!cur) return
    const prev = regions[regions.indexOf(cur) - 1]
    if (!prev) return
    const b: Region['bbox'] = [Math.min(prev.bbox[0], cur.bbox[0]), Math.min(prev.bbox[1], cur.bbox[1]), Math.max(prev.bbox[2], cur.bbox[2]), Math.max(prev.bbox[3], cur.bbox[3])]
    setLayout((l) => l && { ...l, regions: l.regions.filter((r) => r.id !== cur.id).map((r) => (r.id === prev.id ? { ...r, bbox: b, changed: true } : r)) })
    setSel(prev.id)
    setChanges((n) => n + 1)
  }

  // 拖动：框内拖是挪，右下角拖是改大小，空白处拖出新块
  const pt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stageRef.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent): void => {
      const [x, y] = pt(e)
      const [a, b, c, d] = drag.b0
      let nb: Region['bbox']
      if (drag.kind === 'move') {
        const dx = Math.min(1 - c, Math.max(-a, x - drag.x0))
        const dy = Math.min(1 - d, Math.max(-b, y - drag.y0))
        nb = [a + dx, b + dy, c + dx, d + dy]
      } else if (drag.kind === 'size') nb = [a, b, Math.max(a + 0.01, x), Math.max(b + 0.005, y)]
      else nb = [Math.min(drag.x0, x), Math.min(drag.y0, y), Math.max(drag.x0, x), Math.max(drag.y0, y)]
      update(drag.id, { bbox: nb, changed: true }, false)
    }
    const onUp = (): void => {
      if (drag.kind === 'new') {
        const r = layout?.regions.find((x) => x.id === drag.id)
        if (r && (r.bbox[2] - r.bbox[0] < 0.01 || r.bbox[3] - r.bbox[1] < 0.005)) {
          setLayout((l) => l && { ...l, regions: l.regions.filter((x) => x.id !== drag.id) })
          setSel(null)
          setDrag(null)
          return
        }
      }
      setChanges((n) => n + 1)
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])

  const onStageDown = (e: React.MouseEvent): void => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const [x, y] = pt(e)
    const id = 'n' + Date.now().toString(36)
    // 新块按位置插进阅读顺序：放在上边缘在它之上的最后一块后面
    const after = regions.filter((r) => r.bbox[1] <= y).length
    const r: Region = { id, page, type: 'text', bbox: [x, y, x, y], order: after - 0.5, content: null, changed: true }
    setLayout((l) => l && { ...l, regions: [...l.regions, r] })
    renumber([...regions.slice(0, after), r, ...regions.slice(after)])
    setSel(id)
    setDrag({ kind: 'new', id, x0: x, y0: y, b0: r.bbox })
  }

  const typeMenu = async (e: React.MouseEvent): Promise<void> => {
    if (!cur) return
    const act = await showMenu(
      REGION_TYPES.map((t_) => ({ id: t_.id, label: t_.name, checked: cur.type === t_.id, icon: <span className="rg-dot" style={{ background: COLOR[t_.id] }} /> })),
      { el: e.currentTarget }
    )
    if (act) update(cur.id, { type: act as RegionType, changed: true })
  }

  // 保存：图一律用截图；改过的表格和公式也截图（MinerU 的识别结果对不上新框了）
  const save = async (): Promise<void> => {
    if (!layout) return
    setSaving(true)
    try {
      const crops: Record<string, string> = {}
      const need = layout.regions.filter((r) => r.type === 'image' || ((r.type === 'table' || r.type === 'equation') && (r.changed || !r.content)))
      const pages = new Map<number, HTMLCanvasElement>()
      for (const r of need) {
        let c = pages.get(r.page)
        if (!c) {
          const pg = await props.pdf.getPage(r.page + 1)
          const vp = pg.getViewport({ scale: 2 })
          c = document.createElement('canvas')
          c.width = vp.width
          c.height = vp.height
          await pg.render({ canvas: c, viewport: vp }).promise
          pages.set(r.page, c)
        }
        const [x0, y0, x1, y1] = r.bbox
        const w = Math.max(1, Math.round((x1 - x0) * c.width))
        const h = Math.max(1, Math.round((y1 - y0) * c.height))
        const out = document.createElement('canvas')
        out.width = w
        out.height = h
        const g = out.getContext('2d')!
        g.fillStyle = '#fff'
        g.fillRect(0, 0, w, h)
        g.drawImage(c, x0 * c.width, y0 * c.height, w, h, 0, 0, w, h)
        crops[r.id] = out.toDataURL('image/png')
      }
      const d = await api.layoutSave(props.paperId, layout, crops)
      toast(t('已按调整后的区域重排'))
      props.onSaved(d)
    } catch (e) {
      toast(t('保存失败：{0}', errText(e)))
      setSaving(false)
    }
  }
  const reset = async (): Promise<void> => {
    const d = await api.layoutReset(props.paperId)
    toast(t('已恢复成 MinerU 原来的重排'))
    props.onSaved(d)
  }

  return (
    <Modal width={1160} height={820} label={t('调整重排区域')} onClose={() => !saving && props.onClose()}>
      <ModalHead title={t('调整重排区域{0}', layout ? t(' · 第 {0} 页', page + 1) : '')} sub={t('拖动框改位置，拖右下角改大小，在空白处拖出新块；点一个框改类型或顺序。保存后按新版面重排整篇。')} onClose={props.onClose} />
      {!layout ? (
        <div className="rg-wait">
          {err ? (
            <div className="callout warn">{err}</div>
          ) : (
            <>
              <span className="spin spin-12" />
              <div>{t('第一次调整要先让 MinerU 识别版面，跟精细重排差不多久')}</div>
              {line && <div className="hint mono ellipsis" style={{ maxWidth: 560 }}>{line}</div>}
            </>
          )}
        </div>
      ) : (
        <div className="rg-body">
          <div className="rg-pages">
            {layout.pages.map((_, i) => (
              <button key={i} className={'rg-pg num' + (i === page ? ' on' : '')} onClick={() => (setPage(i), setSel(null))}>
                {i + 1}
                {layout.regions.some((r) => r.page === i && r.changed) && <i className="dot sm accent" />}
              </button>
            ))}
          </div>
          <div className="rg-canvas">
            <div className="rg-stage" ref={stageRef} style={{ width: VIEW_W, height: viewH }} onMouseDown={onStageDown}>
              <canvas ref={canvasRef} style={{ width: VIEW_W, height: viewH }} />
              {regions.map((r, i) => (
                <div
                  key={r.id}
                  className={'rg-box' + (r.id === sel ? ' on' : '') + (r.type === 'discard' ? ' off' : '')}
                  style={{
                    left: `${r.bbox[0] * 100}%`,
                    top: `${r.bbox[1] * 100}%`,
                    width: `${(r.bbox[2] - r.bbox[0]) * 100}%`,
                    height: `${(r.bbox[3] - r.bbox[1]) * 100}%`,
                    ['--c' as string]: COLOR[r.type]
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setSel(r.id)
                    const [x, y] = pt(e)
                    setDrag({ kind: 'move', id: r.id, x0: x, y0: y, b0: r.bbox })
                  }}
                >
                  <span className="rg-label">
                    {i + 1} {NAME[r.type]}
                  </span>
                  {r.id === sel && (
                    <span
                      className="rg-handle"
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        const [x, y] = pt(e)
                        setDrag({ kind: 'size', id: r.id, x0: x, y0: y, b0: r.bbox })
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="rg-side">
            {cur ? (
              <>
                <div style={{ fontWeight: 500 }}>{t('块 {0}', regions.indexOf(cur) + 1)}</div>
                <div>
                  <span className="lbl">{t('类型')}</span>
                  <button className="btn" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={(e) => void typeMenu(e)}>
                    <span className="rg-dot" style={{ background: COLOR[cur.type] }} />
                    {NAME[cur.type]}
                    <span className="spacer" />
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div>
                  <span className="lbl">{t('阅读顺序')}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="num" style={{ width: 40 }}>
                      {t('第 {0}', regions.indexOf(cur) + 1)}
                    </span>
                    <button className="btn icon" title={t('往前')} disabled={regions.indexOf(cur) === 0} onClick={() => move(-1)}>
                      <ChevronUp size={16} />
                    </button>
                    <button className="btn icon" title={t('往后')} disabled={regions.indexOf(cur) === regions.length - 1} onClick={() => move(1)}>
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" disabled={regions.indexOf(cur) === 0} onClick={mergeUp}>
                    <Merge size={16} />
                    {t('合并到上一块')}
                  </button>
                  <button className="btn danger" onClick={remove}>
                    <Trash2 size={16} />
                    {t('删除')}
                  </button>
                </div>
                {cur.content && !cur.changed && cur.type !== 'image' && (
                  <div>
                    <span className="lbl">{t('识别出的内容')}</span>
                    <div className="rg-content">{cur.content.slice(0, 600)}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="hint">{t('点页面上的一个框来改；不想要的页眉页脚、水印，类型改成「不要」或删掉。')}</div>
            )}
            <div className="callout">
              <Info size={14} />
              <span>{t('识别成「文本」的公式会被翻译成乱码，改成「公式」后不翻译，按截图或 LaTeX 显示。')}</span>
            </div>
          </div>
        </div>
      )}
      <div className="m-ft line">
        <span className="hint">{changes ? t('改了 {0} 处', changes) : edited ? t('这篇调整过区域') : ''}</span>
        {edited && (
          <button className="btn ghost" onClick={() => void reset()}>
            <RotateCcw size={16} />
            {t('恢复原样')}
          </button>
        )}
        <span className="spacer" />
        <button className="btn" disabled={saving} onClick={props.onClose}>
          {t('取消')}
        </button>
        <button className="btn primary" disabled={!layout || !changes || saving} onClick={() => void save()}>
          {saving && <span className="spin spin-12" />}
          {t('保存并重排')}
        </button>
      </div>
    </Modal>
  )
}
