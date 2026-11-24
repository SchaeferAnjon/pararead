/**
 * 旁支那一块挂在回答里的哪儿（task-4edsc 方向 A「就地展开」）：被问的那句所在的那一段后面。
 * 回答是 React 画的（md-render 的 Markdown），这里只在那一段后面插一个空的 div（.side-host），旁支用 portal 画进去；
 * 回答的字一变 .txt 整块换掉时（ReadingAi 的 key），下一次渲染完再插回去。marks.ts 找字时跳过它。
 */
import { type RefObject, useEffect, useLayoutEffect, useMemo } from 'react'

/** 那一句所在的那一段：表格、提示块、引用、折叠块整块算一段；列表里是那一项；别的是那个段落、标题、公式 */
export function blockOf(span: Element, root: Element): Element {
  const outer = span.closest('.md-table, .md-callout, .md-quote, .md-fold')
  if (outer && root.contains(outer) && outer !== root) return outer
  const inner = span.closest('li, p, .md-h, pre, .katex-display')
  if (inner && root.contains(inner) && inner !== root) return inner
  let e = span
  while (e.parentElement && e.parentElement !== root) e = e.parentElement
  return e
}

/**
 * 把 host 挂到 list 里那条回答（data-msg）被问那一句（.asked[data-side=key]）所在的那一段后面；
 * 找不到那一句（还没划上，或回答被改过）挂在这条回答末尾；找不到这条回答就先摘下来
 */
export function placeHost(list: HTMLElement | null, host: HTMLElement, at: { msg: number; key: string }) {
  const txt = list?.querySelector<HTMLElement>(`.am[data-msg="${at.msg}"] .txt`)
  if (!txt) {
    host.remove()
    return
  }
  const root = txt.querySelector(':scope > .md') ?? txt
  const spans = txt.querySelectorAll(`.asked[data-side="${CSS.escape(at.key)}"]`)
  const last = spans[spans.length - 1]
  const anchor = last ? blockOf(last, root) : ([...root.children].filter((e) => e !== host).pop() ?? null)
  if (!anchor) {
    if (host.parentElement !== root) root.appendChild(host)
    return
  }
  if (anchor.nextSibling !== host) anchor.after(host)
}

/**
 * 开着的那条旁支挂在哪：返回挂它的那个 div（开着时一直是同一个，React 往里画），关着是 null。
 * 每次渲染完都看一眼挂得对不对（回答整块换掉、虚线重画以后插回去）
 */
export function useSideHost(list: RefObject<HTMLElement | null>, at: { msg: number; key: string } | null): HTMLDivElement | null {
  const host = useMemo(() => {
    const d = document.createElement('div')
    d.className = 'side-host'
    return d
  }, [])
  useLayoutEffect(() => {
    if (at) placeHost(list.current, host, at)
    else host.remove()
  })
  useEffect(() => () => host.remove(), [host])
  return at ? host : null
}

/**
 * 开旁支、问了、出字以后：外面那一格（list）把这一块滚进来，但那句不滚出上面 48（照原型 showEnd）：
 * 块的下边在外面就往下滚到露出来（最多滚到那句离顶 48），那句在上面外面就滚回来
 */
export function showSide(list: HTMLElement | null, host: HTMLElement | null, key: string) {
  if (!list || !host?.isConnected) return
  const sent = list.querySelector<HTMLElement>(`.asked[data-side="${CSS.escape(key)}"]`) ?? host
  const L = list.getBoundingClientRect()
  const top = sent.getBoundingClientRect().top - L.top
  const bot = host.getBoundingClientRect().bottom - L.bottom
  if (bot > 0) list.scrollTop += Math.min(bot + 8, Math.max(0, top - 48))
  else if (top < 0) list.scrollTop += top - 48
}
