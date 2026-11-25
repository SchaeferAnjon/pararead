/**
 * 栏和栏之间的分隔条（画布笔记的左栏、右边几栏、上下两组、中间分屏，画布今日的左栏、右栏、排一天的时间线都用这一个）：
 * 按住拖（@cn/design/drag-end 的 trackDrag：窗口外松手、失焦也收得了），拖着时自己加 .on、body 加 resizing（上下拖再加 resizing-row），
 * 双击交给 onReset。长什么样宿主自己给（类名 className）；没有自己样子的用 sash.css 的 .sash（悬停、拖着时中间一条 2px --line2）。
 */
import { type HTMLAttributes, type PointerEvent as ReactPointerEvent, useState } from 'react'
import { trackDrag } from './drag-end'

export interface SashProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onDoubleClick' | 'className' | 'role'> {
  className: string
  /** col：左右拖（竖的一条，默认）；row：上下拖 */
  dir?: 'col' | 'row'
  /** 按下（左键）：返回按着移动时怎么改；返回 null 不拖 */
  onStart(e: ReactPointerEvent<HTMLDivElement>): ((ev: PointerEvent) => void) | null
  /** 松手（或松手没送到页面）以后：记下宽度之类 */
  onEnd?(): void
  /** 双击 */
  onReset?(): void
  /** 拖着时 body 上另加的类 */
  bodyClass?: string
}

export function Sash({ className, dir = 'col', onStart, onEnd, onReset, bodyClass, ...rest }: SashProps) {
  const [on, setOn] = useState(false)
  return (
    <div
      {...rest}
      className={className + (on ? ' on' : '')}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const move = onStart(e)
        if (!move) return
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const body = ['resizing', ...(dir === 'row' ? ['resizing-row'] : []), ...(bodyClass ? [bodyClass] : [])]
        setOn(true)
        document.body.classList.add(...body)
        // 松手没送到页面（窗口外松手、失焦）：停在最后拖到的样子（task-0nz63）
        trackDrag<PointerEvent>(e, {
          move,
          end: (_how, ev) => {
            setOn(false)
            document.body.classList.remove(...body)
            if (ev && el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
            onEnd?.()
          },
        })
      }}
      onDoubleClick={onReset}
    />
  )
}
