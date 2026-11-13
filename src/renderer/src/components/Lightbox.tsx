import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'

const MAX = 8
const clamp = (s: number): number => Math.min(MAX, Math.max(1, s))

// 弹出来的大图：盖住整个窗口，一开始刚好放下。点图在「刚好放下」和 2 倍之间换（放大到点的那个位置）；
// 触控板捏合缩放、双指滑动平移，放大后也能按住拖；点空白、按 Esc、点关闭回到正文。
export function Lightbox(props: { src: string; onClose: () => void }) {
  // s 是相对「刚好放下」的倍数，x / y 是图的中心离窗口中心多远
  const [v, setV] = useState({ s: 1, x: 0, y: 0 })
  const root = useRef<HTMLDivElement>(null)
  // 「刚好放下」的尺寸：按图的长宽比撑到窗口的 92% 宽、86% 高里最大（小图也撑大，不然弹出来还是那么小）
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = (): void => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const k = nat ? Math.min((win.w * 0.92) / nat.w, (win.h * 0.86) / nat.h) : 0
  const dragged = useRef(false)
  // 以 (cx, cy)（相对窗口中心）为不动点缩放
  const zoomAt = (f: (s: number) => number, cx = 0, cy = 0): void =>
    setV((p) => {
      const n = clamp(f(p.s))
      if (n === 1) return { s: 1, x: 0, y: 0 }
      const k = n / p.s
      return { s: n, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }
    })
  const fromCenter = (e: { clientX: number; clientY: number }): [number, number] => [e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2]

  useEffect(() => {
    const el = root.current!
    // 触控板捏合在浏览器里是带 ctrlKey 的滚轮事件；不带的是双指滑动
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey) zoomAt((s) => s * Math.exp(-e.deltaY * 0.01), ...fromCenter(e))
      else setV((p) => (p.s === 1 ? p : { ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') (e.stopPropagation(), props.onClose())
      else if (e.key === '+' || e.key === '=') zoomAt((s) => s * 1.5)
      else if (e.key === '-') zoomAt((s) => s / 1.5)
      else if (e.key === '0') zoomAt(() => 1)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', key, true)
    return () => {
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startDrag = (e: React.MouseEvent): void => {
    dragged.current = false
    if (v.s === 1) return
    e.preventDefault()
    const from = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) > 3) dragged.current = true
      setV((p) => ({ ...p, x: from.vx + ev.clientX - from.x, y: from.vy + ev.clientY - from.y }))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return createPortal(
    <div className="lightbox" ref={root} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <img
        src={props.src}
        alt=""
        draggable={false}
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={{ width: nat ? nat.w * k : undefined, height: nat ? nat.h * k : undefined, visibility: nat ? 'visible' : 'hidden', transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, cursor: v.s === 1 ? 'zoom-in' : 'grab' }}
        onMouseDown={startDrag}
        onClick={(e) => {
          if (dragged.current) return
          if (v.s === 1) zoomAt(() => 2, ...fromCenter(e))
          else zoomAt(() => 1)
        }}
      />
      <div className="lb-bar">
        <button className="icon-btn" title={t('缩小')} disabled={v.s <= 1} onClick={() => zoomAt((s) => s / 1.5)}>
          <Minus size={16} />
        </button>
        <span className="num lb-pct">{Math.round(v.s * 100)}%</span>
        <button className="icon-btn" title={t('放大')} disabled={v.s >= MAX} onClick={() => zoomAt((s) => s * 1.5)}>
          <Plus size={16} />
        </button>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body
  )
}
