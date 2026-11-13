import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'
import { api } from '../api'

// 对照模式的截图翻译：盖在正文栏上的一层，按住拖出一个框，松手把框里的画面截下来（主进程 capturePage），
// 连同框里的文字交给划词卡片去翻译或解释。Esc 或点一下（没拖）取消。
export function ShotLayer(props: { host: React.RefObject<HTMLElement | null>; onShot: (img: string, text: string, paragraph: string, rect: DOMRect) => void; onCancel: () => void }) {
  const [area, setArea] = useState<DOMRect | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef(box)
  boxRef.current = box
  useEffect(() => {
    const fit = (): void => setArea(props.host.current?.getBoundingClientRect() ?? null)
    fit()
    window.addEventListener('resize', fit)
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') (e.stopPropagation(), props.onCancel())
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', key, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!area) return null
  const clampX = (x: number): number => Math.min(Math.max(x, area.left), area.right)
  const clampY = (y: number): number => Math.min(Math.max(y, area.top), area.bottom)

  const finish = async (): Promise<void> => {
    const b = boxRef.current
    setBox(null)
    if (!b) return
    const r = new DOMRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
    if (r.width < 8 || r.height < 8) return props.onCancel()
    // 框里的文字：正文和译文里和框相交的词；所在的整段当上下文
    const words: string[] = []
    const paras = new Set<string>()
    const hit = (q: DOMRect): boolean => q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom
    for (const el of props.host.current?.querySelectorAll<HTMLElement>('.blk .src, .blk .tr-text') ?? []) {
      if (!hit(el.getBoundingClientRect())) continue
      paras.add((el.textContent ?? '').trim())
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.katex-mathml') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
      for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null)
        for (const m of n.data.matchAll(/\S+/g)) {
          const q = document.createRange()
          q.setStart(n, m.index!)
          q.setEnd(n, m.index! + m[0].length)
          const c = q.getBoundingClientRect()
          if (c.width && hit(c)) words.push(m[0])
        }
    }
    // 等框线消失再截，免得框线也截进去
    setBusy(true)
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
    try {
      const img = await api.capture({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
      props.onShot(img, words.join(' '), [...paras].join('\n\n').slice(0, 4000), r)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className={'shot-layer' + (busy ? ' busy' : '')}
      style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        setBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
        const move = (ev: MouseEvent): void => setBox((p) => p && { ...p, x1: clampX(ev.clientX), y1: clampY(ev.clientY) })
        const up = (): void => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          void finish()
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    >
      {!box && !busy && <div className="shot-hint">{t('拖出一个框，翻译或解释框里的内容；Esc 取消')}</div>}
      {box && <div className="shot-box" style={{ left: Math.min(box.x0, box.x1) - area.left, top: Math.min(box.y0, box.y1) - area.top, width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
    </div>,
    document.body
  )
}
