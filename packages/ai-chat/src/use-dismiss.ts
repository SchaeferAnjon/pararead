/**
 * 公共的「点外面就收起」（CN-88）。弹层开着时：
 * - 窗口上抓 pointerdown（捕获阶段）：点在 inside 里那几块（弹层和打开它的按钮）以外就收；
 *   打开它的按钮也算里面，所以它的 onClick 照旧是开 / 关切换，不会先收再开；
 * - Esc 收：只收最上面那个（最后打开的），拦住不往下传（不再关 AI 面板这些）；正在打中文（输入法在选字）时的 Esc 不算；
 * - 窗口失焦也收：点进网页、PDF 里嵌的页面时，窗口收不到 pointerdown。
 * 收的时候告诉是为什么（why）、点在哪（target）和那一下（event，看是不是右键）：PDF 框选浮条点进输入框只收浮条、点别处连框一起取消（CN-97），别的弹层不用管。
 * 引擎、模型、effort 菜单、看全文的小卡、旁支列表、框选浮条都用它；以后的弹层也用它。
 */
import { type RefObject, useEffect, useRef } from 'react'

export type DismissWhy = 'outside' | 'esc' | 'blur'

/** 开着的弹层，最后打开的在最后 */
const open: object[] = []

export function useDismiss(shown: boolean, inside: RefObject<HTMLElement | null>[], onClose: (why: DismissWhy, target: EventTarget | null, event: Event | null) => void) {
  const close = useRef(onClose)
  close.current = onClose
  const parts = useRef(inside)
  parts.current = inside
  useEffect(() => {
    if (!shown) return
    const me = {}
    open.push(me)
    const isInside = (t: EventTarget | null) => t instanceof Node && parts.current.some((r) => r.current?.contains(t))
    const down = (e: PointerEvent) => {
      if (!isInside(e.target)) close.current('outside', e.target, e)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || open[open.length - 1] !== me) return
      e.preventDefault()
      e.stopPropagation()
      close.current('esc', e.target, e)
    }
    const blur = () => close.current('blur', null, null)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
    return () => {
      open.splice(open.indexOf(me), 1)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
    }
  }, [shown])
}
