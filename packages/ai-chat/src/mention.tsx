/**
 * @ 点名的文档画成胶囊（@文档胶囊，2026-11-24 偏好「@文档要能选且像胶囊」）：
 * - 输入框里（MentionLayers）：textarea 还是那个 textarea，字里照旧是「@标题」；有胶囊时 textarea 的字透明，
 *   下面一层照同样的排法把字画出来、「@标题」画成胶囊（图标盖在 @ 的位置上，--fill2 底 + 细边），
 *   上面一层透明的只在胶囊那几块接鼠标：悬停看路径（data-tip）、点了打开那篇。光标、选区、输入法照旧是 textarea 自己的。
 * - 发出去的那条里（MentionText）：同一个胶囊，是一颗按钮。
 * - @ 候选（AtMenu）：第一条一出来就亮着，Tab、↵ 都选它；输入法还在组字时这两个键是输入法的，底下那行说先选好字。
 * 点了打开走宿主的 ChatHost.openMention。
 */
import { Fragment, type ReactNode, type RefObject, useLayoutEffect, useState } from 'react'
import { Icon, useChat, useUi } from './context'
import { type AtItem, MENTION_ICON, type Mention, mentionRanges } from './mentions'
import './mention.css'

/** 发出去的那条里的胶囊：图标 + 标题，悬停看路径，点了打开 */
export function MentionChip(p: { m: Mention }) {
  const chat = useChat()
  return (
    <button type="button" className="mchip" data-kind={p.m.kind} data-tip={p.m.path} data-side="above" data-testid="mention-chip" onClick={() => chat.openMention?.(p.m)}>
      <Icon name={MENTION_ICON[p.m.kind]} size={12} />
      <span className="mt">{p.m.title}</span>
    </button>
  )
}

/** 一段字里的「@标题」换成胶囊；别的字交给 plain（发出去那条里 ①② 换成小圆点数字） */
export function MentionText(p: { text: string; mentions?: readonly Mention[]; plain?: (s: string) => ReactNode }) {
  const plain = p.plain ?? ((s: string) => s)
  const rs = p.mentions?.length ? mentionRanges(p.text, p.mentions) : []
  if (!rs.length) return <>{plain(p.text)}</>
  const out: ReactNode[] = []
  let at = 0
  for (const r of rs) {
    if (r.from > at) out.push(<Fragment key={'t' + at}>{plain(p.text.slice(at, r.from))}</Fragment>)
    out.push(<MentionChip key={'m' + r.from} m={r.m} />)
    at = r.to
  }
  if (at < p.text.length) out.push(<Fragment key={'t' + at}>{plain(p.text.slice(at))}</Fragment>)
  return <>{out}</>
}

/**
 * 输入框里的两层（textarea 下面画字和胶囊、上面接胶囊上的鼠标）。和 textarea 同一个格子、同样的字和内边距，
 * 宽照 textarea 的 clientWidth（有滚动条时让出它），跟着 textarea 滚。ime：输入法正在组的那一段（下面画一道下划线，textarea 的字透明看不见它自己的）
 */
export function MentionLayers(p: { ta: RefObject<HTMLTextAreaElement | null>; text: string; mentions: readonly Mention[]; ime: { from: number; to: number } | null }) {
  const chat = useChat()
  const [box, setBox] = useState<{ w: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const ta = p.ta.current
    if (!ta) return
    const sync = () => {
      const w = ta.clientWidth
      const top = ta.scrollTop
      setBox((b) => (b && b.w === w && b.top === top ? b : { w, top }))
    }
    sync()
    ta.addEventListener('scroll', sync)
    const ro = new ResizeObserver(sync)
    ro.observe(ta)
    return () => (ta.removeEventListener('scroll', sync), ro.disconnect())
  }, [p.ta])
  const rs = mentionRanges(p.text, p.mentions)
  const draw = (mode: 'paint' | 'hit') => {
    const out: ReactNode[] = []
    let at = 0
    const text = (from: number, to: number) => {
      if (to <= from) return
      const ime = mode === 'paint' && p.ime && p.ime.to > from && p.ime.from < to ? p.ime : null
      if (!ime) return void out.push(p.text.slice(from, to))
      const a = Math.max(from, ime.from)
      const b = Math.min(to, ime.to)
      if (a > from) out.push(p.text.slice(from, a))
      out.push(
        <span key={'ime' + a} className="ime">
          {p.text.slice(a, b)}
        </span>,
      )
      if (to > b) out.push(p.text.slice(b, to))
    }
    for (const r of rs) {
      text(at, r.from)
      const title = p.text.slice(r.from + 1, r.to)
      out.push(
        mode === 'paint' ? (
          <span key={r.from} className="mchip-in" data-kind={r.m.kind}>
            <span className="at">@</span>
            {title}
            <span className="ic" aria-hidden="true">
              <Icon name={MENTION_ICON[r.m.kind]} size={12} />
            </span>
          </span>
        ) : (
          <span key={r.from} className="mhit" data-tip={r.m.path} data-side="above" data-testid="mention-in" data-path={r.m.path} onMouseDown={(e) => e.preventDefault()} onClick={() => chat.openMention?.(r.m)}>
            {'@' + title}
          </span>
        ),
      )
      at = r.to
    }
    text(at, p.text.length)
    // 最后是换行时 textarea 多一行：补一个字占住
    out.push('​')
    return out
  }
  const style = box ? { width: box.w, transform: `translateY(${-box.top}px)` } : undefined
  return (
    <>
      <div className="mlayer paint" aria-hidden="true">
        <div style={style}>
          {draw('paint')}
        </div>
      </div>
      <div className="mlayer hit">
        <div style={style}>
          {draw('hit')}
        </div>
      </div>
    </>
  )
}

/** @ 候选：图标、标题、下面一行小字；亮着的那条 Tab / ↵ 选上；组字时底下那行说先选好字 */
export function AtMenu(p: { items: readonly AtItem[]; on: number; composing: boolean; onPick(i: number): void; onHover(i: number): void }) {
  const { t } = useUi()
  return (
    <div className="aiin-at" role="listbox" aria-label={t('引用笔记')} data-testid="at-menu" onMouseDown={(e) => e.preventDefault()}>
      {p.items.map((n, i) => (
        <button key={n.path} type="button" role="option" aria-selected={i === p.on} className={i === p.on ? 'on' : ''} onMouseMove={() => i !== p.on && p.onHover(i)} onClick={() => p.onPick(i)}>
          <span className="ib">
            <Icon name={MENTION_ICON[n.kind]} size={14} />
          </span>
          <span className="tx">
            <b>{n.title}</b>
            <span>{n.sub}</span>
          </span>
        </button>
      ))}
      <div className="keys">{p.composing ? t('先选好字，再按 Tab 或 ↵ 选中') : t('↑↓ 选择 · Tab / ↵ 选中 · esc 关闭')}</div>
    </div>
  )
}
