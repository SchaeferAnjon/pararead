/**
 * 对话跟着最新的往下滚（边答边出字、新问、格子变高变矮），人往上翻就停住：
 * 滚轮 / 触控板往上、拖滚动条、焦点在对话里按 PageUp ↑ Home，或者看得出是人往上挪了（不是内容变短被挤上去的），
 * 就不再跟，停在人看的地方；滚回离底 24 以内，或点底下「↓ 新回答」才接着跟。答完也不跳。
 * 以前只看「离底 < 48」：触控板一下只挪几像素，还没出 48 下一截字就把它拽回最底，答完以前翻不上去（2026-11-24 用户截图）。
 * 画布笔记的 AI 对话、读 PDF、旁支和 ParaRead 右栏共用；输入框变高时（composer.tsx）也照它决定滚不滚。
 */
import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react'
import { Icon, useUi } from './context'
import './follow.css'

/** 离底这么近算「在最底」：滚回来就接着跟 */
export const NEAR = 24
const gap = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight
const UP_KEYS = new Set(['PageUp', 'ArrowUp', 'Home'])
const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

const pins = new WeakMap<HTMLElement, MutableRefObject<boolean>>()
/** 这一格现在跟不跟着到底；没接 useFollow 的格子是 undefined */
export const following = (el: HTMLElement): boolean | undefined => pins.get(el)?.current

export type Follow = {
  /** 跟着到底；宿主自己也能关（跳到某一条、开着旁支） */
  pinned: MutableRefObject<boolean>
  /** 人翻上去以后底下又长了字：出「↓ 新回答」 */
  below: boolean
  /** 内容变了：跟着就滚到底，没跟着就记下底下有新的 */
  stick: () => void
  /** 回到最底、接着跟（点「↓ 新回答」、新问、换了地方） */
  follow: () => void
}

/** hold：宿主那边不让跟（开着旁支），这时也不出「↓ 新回答」 */
export function useFollow(list: RefObject<HTMLElement | null>, hold = false): Follow {
  const pinned = useRef(true)
  const [below, setBelow] = useState(false)
  const holdRef = useRef(hold)
  holdRef.current = hold
  /** 人翻上去那一刻的总高：之后比它高了才算底下有新的（跳到旧的一条、点目录不算） */
  const leftAt = useRef(Infinity)
  const api = useRef<Follow | null>(null)
  if (!api.current) {
    api.current = {
      pinned,
      below: false,
      stick: () => {
        const el = list.current
        if (!el || holdRef.current) return
        if (pinned.current) el.scrollTop = el.scrollHeight
        else if (el.scrollHeight > leftAt.current + 2 && gap(el) > NEAR) setBelow(true)
      },
      follow: () => {
        pinned.current = true
        leftAt.current = Infinity
        setBelow(false)
        const el = list.current
        if (el) el.scrollTop = el.scrollHeight
      },
    }
  }

  useEffect(() => {
    const el = list.current
    if (!el) return
    pins.set(el, pinned)
    const leave = () => {
      pinned.current = false
      if (leftAt.current === Infinity) leftAt.current = el.scrollHeight
    }
    const rejoin = () => {
      pinned.current = true
      leftAt.current = Infinity
      setBelow(false)
    }
    let top = el.scrollTop
    let h = el.scrollHeight
    let ch = el.clientHeight
    /** 上面还有滚出去的：格子上记 data-above（宿主照它在上沿画渐隐，最上面那一行不像被头部切了半截） */
    const mark = () => el.toggleAttribute('data-above', el.scrollTop > 1)
    mark()
    const onScroll = () => {
      mark()
      const t = el.scrollTop
      const nh = el.scrollHeight
      const nc = el.clientHeight
      // 往上挪了、又不是内容变短或格子变高挤的：人在往上翻
      const up = t < top - 1 && nh >= h && nc <= ch
      top = t
      h = nh
      ch = nc
      if (up) leave()
      else if (!holdRef.current && gap(el) <= NEAR) rejoin()
    }
    // 滚动事件要等下一帧才到，这中间来一截字会先把它拽回去：滚轮、按键、按住滚动条当下就停
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && el.scrollTop > 0) leave()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!UP_KEYS.has(e.key) || editable(e.target) || el.scrollTop <= 0) return
      const a = document.activeElement
      if ((a && a !== document.body && el.contains(a)) || ((!a || a === document.body) && el.matches(':hover'))) leave()
    }
    const onDown = (e: PointerEvent) => {
      // 滚动条（mac 叠在上面的那种也算）：点在格子本身、靠右边 16 以内
      if (e.target === el && e.clientX > el.getBoundingClientRect().right - 16) leave()
    }
    const onUp = () => {
      if (!pinned.current && !holdRef.current && gap(el) <= NEAR) rejoin()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerup', onUp)
    // 这一格变高变矮、里面的字排出来变长（公式、图）：跟着的照旧停在最底
    const ro = new ResizeObserver(() => api.current!.stick())
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    const mo = new MutationObserver(() => {
      for (const c of el.children) ro.observe(c)
    })
    mo.observe(el, { childList: true })
    return () => {
      pins.delete(el)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerup', onUp)
      ro.disconnect()
      mo.disconnect()
    }
  }, [list])

  return { ...api.current, below }
}

/** 贴着对话底边的「↓ 新回答」：人翻上去以后底下又出了字才有，点了回到最底接着跟。放在 .msgs-box 里（它是定位的那一层） */
export function NewBelow(p: { f: Follow }) {
  const { t } = useUi()
  if (!p.f.below) return null
  return (
    <button type="button" className="new-below" data-testid="ai-new-below" onClick={p.f.follow}>
      <Icon name="arrow-down" size={14} />
      {t('新回答')}
    </button>
  )
}
