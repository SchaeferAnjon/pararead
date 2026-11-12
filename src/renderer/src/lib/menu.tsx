import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// 自绘菜单（设计第 15 条）：右键菜单和页面里的下拉一个样，带子菜单、勾、危险项、快捷键提示。
// showMenu 返回选中项的 id，关掉返回 null。正文里的右键（查询、拷贝）仍走系统菜单。

export interface MenuEntry {
  id?: string
  label?: ReactNode
  icon?: ReactNode
  hint?: ReactNode
  type?: 'separator' | 'section'
  enabled?: boolean
  checked?: boolean // 有 checked 字段的项留出勾的位置
  danger?: boolean
  submenu?: MenuEntry[]
}

type At = { x: number; y: number } | { el: Element; align?: 'left' | 'right' }

interface Open {
  items: MenuEntry[]
  at: At
  resolve: (id: string | null) => void
}

let setOpen: ((o: Open | null) => void) | null = null
let current: Open | null = null

export function showMenu(items: MenuEntry[], at: At | React.MouseEvent): Promise<string | null> {
  const pos: At = 'clientX' in at ? { x: at.clientX, y: at.clientY } : at
  if ('clientX' in at) at.preventDefault()
  current?.resolve(null)
  return new Promise((resolve) => {
    current = { items, at: pos, resolve }
    setOpen?.(current)
  })
}

export function MenuHost() {
  const [open, set] = useState<Open | null>(null)
  useEffect(() => {
    setOpen = set
    return () => {
      setOpen = null
    }
  }, [])
  if (!open) return null
  const close = (id: string | null): void => {
    open.resolve(id)
    current = null
    set(null)
  }
  return (
    <>
      <div className="click-catcher" style={{ zIndex: 80 }} onMouseDown={() => close(null)} onContextMenu={(e) => (e.preventDefault(), close(null))} />
      <MenuPanel items={open.items} at={open.at} onPick={close} root />
    </>
  )
}

function place(at: At, w: number, h: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left: number
  let top: number
  if ('el' in at) {
    const r = at.el.getBoundingClientRect()
    left = at.align === 'right' ? r.right - w : r.left
    top = r.bottom + 4
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 4)
  } else {
    left = at.x
    top = at.y
    if (top + h > vh - 8) top = Math.max(8, at.y - h)
  }
  if (left + w > vw - 8) left = Math.max(8, vw - w - 8)
  return { left: Math.max(8, left), top: Math.max(8, top) }
}

function MenuPanel(props: { items: MenuEntry[]; at: At; onPick: (id: string | null) => void; root?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [hot, setHot] = useState(-1)
  const [sub, setSub] = useState<{ i: number; el: Element } | null>(null)
  const items = props.items
  const usable = (i: number): boolean => !!items[i] && !items[i].type && items[i].enabled !== false
  const hasTicks = items.some((x) => x.checked !== undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(place(props.at, el.offsetWidth, el.offsetHeight))
  }, [props.at])

  useEffect(() => {
    if (sub) return
    const onKey = (e: KeyboardEvent): void => {
      const step = (d: number): void => {
        let i = hot
        for (let n = 0; n < items.length; n++) {
          i = (i + d + items.length) % items.length
          if (usable(i)) break
        }
        setHot(i)
      }
      if (e.key === 'ArrowDown') step(1)
      else if (e.key === 'ArrowUp') step(-1)
      else if (e.key === 'Escape') props.onPick(null)
      else if (e.key === 'ArrowLeft' && props.onBack) props.onBack()
      else if ((e.key === 'ArrowRight' || e.key === 'Enter') && usable(hot)) {
        const it = items[hot]
        const el = ref.current?.querySelectorAll('[data-mi]')[hot]
        if (it.submenu && el) setSub({ i: hot, el })
        else if (e.key === 'Enter' && it.id) props.onPick(it.id)
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <>
      <div
        ref={ref}
        className="pop menu"
        role="menu"
        style={{ zIndex: 81, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) => {
          if (it.type === 'separator') return <div key={i} className="menu-sep" />
          if (it.type === 'section') return <div key={i} className="menu-sec">{it.label}</div>
          const off = it.enabled === false
          return (
            <button
              key={i}
              data-mi
              role="menuitem"
              disabled={off}
              className={'menu-item' + (hot === i ? ' hot' : '') + (it.danger ? ' danger' : '')}
              onMouseEnter={(e) => {
                setHot(off ? -1 : i)
                setSub(it.submenu && !off ? { i, el: e.currentTarget } : null)
              }}
              onClick={(e) => {
                if (it.submenu) setSub({ i, el: e.currentTarget })
                else if (it.id) props.onPick(it.id)
              }}
            >
              {hasTicks && <span className="tick">{it.checked && <Check size={14} />}</span>}
              {it.icon}
              <span className="ellipsis">{it.label}</span>
              {it.submenu ? (
                <span className="h">
                  <ChevronRight size={14} />
                </span>
              ) : (
                it.hint !== undefined && <span className="h">{it.hint}</span>
              )}
            </button>
          )
        })}
      </div>
      {sub && items[sub.i]?.submenu && (
        <SubPanel
          items={items[sub.i].submenu!}
          anchor={sub.el}
          onPick={props.onPick}
          onBack={() => setSub(null)}
        />
      )}
    </>
  )
}

function SubPanel(props: { items: MenuEntry[]; anchor: Element; onPick: (id: string | null) => void; onBack: () => void }) {
  const at = useMemo(() => {
    const r = props.anchor.getBoundingClientRect()
    return { x: r.right + 220 < window.innerWidth ? r.right + 2 : r.left - 222, y: r.top - 4 }
  }, [props.anchor])
  return <MenuPanel items={props.items} at={at} onPick={props.onPick} onBack={props.onBack} />
}
