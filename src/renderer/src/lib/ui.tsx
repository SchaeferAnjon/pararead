import { uiLocale } from '@shared/i18n'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { kbd, ON_WIN } from '@shared/kbd'

// 通用小组件：分段控件、开关、toast、骨架、空状态

export function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: ReactNode; busy?: boolean; title?: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={'seg ' + (props.className ?? '')} role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === props.value}
          className={'seg-item' + (o.value === props.value ? ' on' : '')}
          title={o.title && kbd(o.title)}
          onClick={() => props.onChange(o.value)}
        >
          {typeof o.label === 'string' ? <span className="seg-t">{o.label}</span> : o.label}
          {o.busy && <span className="spin spin-12" aria-label={t('进行中')} />}
        </button>
      ))}
    </div>
  )
}

export function Switch(props: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={props.on} aria-label={props.label} className={'switch' + (props.on ? ' on' : '')} onClick={() => props.onChange(!props.on)}>
      <span className="switch-knob" />
    </button>
  )
}

export function Skeleton(props: { lines?: number[] }) {
  return (
    <div className="skel" aria-label={t('加载中')}>
      {(props.lines ?? [100, 70]).map((w, i) => (
        <div key={i} className="skel-line" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

export function Dots() {
  return (
    <div className="dots" aria-label={t('等待回答')}>
      <span />
      <span />
      <span />
    </div>
  )
}

export function Empty(props: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon}</div>
      <div className="empty-title">{props.title}</div>
      {props.text && <div className="empty-text">{props.text}</div>}
      {props.action}
    </div>
  )
}

export function Kbd(props: { children: ReactNode }) {
  // Windows 上 ⌘ 写成 Ctrl
  return <kbd className="kbd">{ON_WIN && props.children === '⌘' ? 'Ctrl' : props.children}</kbd>
}

interface ToastItem {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

const ToastCtx = createContext<(text: string, action?: ToastItem['action']) => void>(() => {})

export function ToastProvider(props: { children: ReactNode }) {
  const [t_, setT] = useState<ToastItem | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((text: string, action?: ToastItem['action']) => {
    if (timer.current) clearTimeout(timer.current)
    setT({ id: Date.now(), text, action })
    timer.current = setTimeout(() => setT(null), 4000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {props.children}
      {t_ && (
        <div className="toast" role="status" key={t_.id}>
          <span>{t_.text}</span>
          {t_.action && (
            <button
              className="text-btn"
              onClick={() => {
                t_.action!.run()
                setT(null)
              }}
            >
              {t_.action.label}
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): (text: string, action?: ToastItem['action']) => void {
  return useContext(ToastCtx)
}

export function useEvent<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...a: A) => ref.current(...a), [])
}

export function useDebounced<T extends unknown[]>(fn: (...a: T) => void, ms: number): (...a: T) => void {
  const f = useEvent(fn)
  const t_ = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (t_.current && clearTimeout(t_.current)), [])
  return useCallback(
    (...a: T) => {
      if (t_.current) clearTimeout(t_.current)
      t_.current = setTimeout(() => f(...a), ms)
    },
    [f, ms]
  )
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 今天写 14:20，本周写周一，更早写 9月30日，跨年加年份；按界面语言排
export function fmtOpened(ts: number | null, now = Date.now()): string {
  if (!ts) return ''
  const d = new Date(ts)
  const n = new Date(now)
  const fmt = (o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(uiLocale(), o).format(d)
  if (d.toDateString() === n.toDateString()) return fmt({ hour: 'numeric', minute: '2-digit', hour12: false })
  const days = (startOfDay(n) - startOfDay(d)) / 86400000
  if (days < 7 && days > 0) return fmt({ weekday: 'short' })
  if (d.getFullYear() === n.getFullYear()) return fmt({ month: 'short', day: 'numeric' })
  return fmt({ year: 'numeric', month: 'short', day: 'numeric' })
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function groupOf(ts: number | null, now = Date.now()): string {
  if (!ts) return t('更早')
  const n = new Date(now)
  const d = new Date(ts)
  const days = (startOfDay(n) - startOfDay(d)) / 86400000
  if (days <= 0) return t('今天')
  if (days < 7) return t('本周')
  if (d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()) return t('本月')
  return t('更早')
}

export function authorsShort(a: string[]): string {
  if (a.length <= 3) return a.join(', ')
  return t('{0} 等 {1} 人', a.slice(0, 3).join(', '), a.length)
}

// 带笔记的高亮：悬停 300ms 出笔记预览（最宽 240、三行）
export function useNotePreview(find: (x: number, y: number) => { note: string; rect: DOMRect } | null) {
  const [tip, setTip] = useState<{ note: string; left: number; top: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef('')
  const onMove = useCallback(
    (e: React.MouseEvent) => {
      if (e.buttons) return
      const hit = find(e.clientX, e.clientY)
      const key = hit ? hit.note : ''
      if (key === last.current) return
      last.current = key
      if (timer.current) clearTimeout(timer.current)
      setTip(null)
      if (hit) timer.current = setTimeout(() => setTip({ note: hit.note, left: hit.rect.left, top: hit.rect.bottom + 6 }), 300)
    },
    [find]
  )
  const onLeave = useCallback(() => {
    last.current = ''
    if (timer.current) clearTimeout(timer.current)
    setTip(null)
  }, [])
  const node = tip ? (
    <div className="pop note-tip" style={{ left: tip.left, top: tip.top }}>
      {tip.note}
    </div>
  ) : null
  return { onMove, onLeave, node }
}
