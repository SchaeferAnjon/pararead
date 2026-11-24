/**
 * AI 回答下面那一排（task-eavzx，款式页「62-回答按钮款式」第二版，用户 r108「可以 就这样吧」）：
 * - 左边功能按钮固定：拷贝 · 插进文档 · ⋯（无边框灰字，24 高）；挤了先收成只剩图标、悬停看名字；
 * - 右边快捷回复：描边胶囊，一律带字；按顺序往右排，放不下的进 ⋯ 中间那一段，拉宽就又排出来；
 * - ⋯ 里：上面固定的功能，中间放不下的（和收进 ⋯ 的）快捷回复，最下面「调整这一排…」。
 * 收不收改动那一套另是 ChangeBar：左边「看改动」（或跟 AI 说），右边「不要（无边框）· 收下」，「收下」在最右；收下后是「撤回」（UndoButton）。
 *
 * 画布笔记、以后的 ParaRead 共用（以前在 @cn/design，ParaRead 联动搬进 @cn/ai-chat）：动作、文案、标志都由宿主交进来，组件不碰 window.cn、不翻译；图标名由宿主的 icon() 画；
 * 样子只用两边同名的 CSS 变量（answer-bar.css）。悬停提示写在 data-tip 上（画布笔记的提示层认它），另带 aria-label。
 */
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUi } from './context'
import type { IconName } from './host'
import './answer-bar.css'

/** 图标：名字（宿主的 icon() 画；画布笔记是 Codicon 的名字），'logo' 画宿主交进来的那一家的标志，或者直接给一个节点 */
export type AbIcon = IconName | 'logo' | (string & {}) | ReactNode

/** 左边一颗功能按钮 */
export interface AbAct {
  id: string
  icon: AbIcon
  label: string
  /** 悬停提示（没给时只剩图标那会儿提示名字） */
  tip?: string
  /** 变淡（还能悬停看为什么） */
  disabled?: boolean
  /** 点了以后 1.5 秒换成这个样子（拷贝 → 已拷贝） */
  flash?: { icon: AbIcon; label: string }
  onClick(): void
}

/** ⋯ 里的一行 */
export interface AbMenuItem {
  id: string
  icon?: AbIcon
  label: string
  tip?: string
  disabled?: boolean
  onClick(): void
}

/** 右边一颗快捷回复 */
export interface AbReply {
  id: string
  label: string
  icon?: AbIcon
  tip?: string
  disabled?: boolean
  onClick(): void
}

export interface AnswerBarProps {
  acts: readonly AbAct[]
  /** ⋯ 最上面自成一组（分隔线上面，画布笔记放「记进《…》/ 从《…》拿掉」） */
  head?: readonly AbMenuItem[]
  /** ⋯ 上面那一段：固定的功能 */
  menu?: readonly AbMenuItem[]
  /** 排上的快捷回复（放不下的进 ⋯） */
  replies?: readonly AbReply[]
  /** 收进 ⋯ 的快捷回复 */
  moreReplies?: readonly AbReply[]
  /** ⋯ 「调整这一排…」那一行 */
  adjust?: AbMenuItem
  /** ⋯ 最下面那一组（分隔线下面，画布笔记放「存进收件箱」） */
  tail?: readonly AbMenuItem[]
  /** 'logo' 画的那一家的标志（快捷回复第一颗、再问一次） */
  logo?: ReactNode
  text: {
    /** ⋯ 的提示和菜单的名字 */
    more: string
    /** ⋯ 里快捷回复那一段的小标题 */
    moreReplies?: string
    /** ⋯ 的悬停提示（不给是 more） */
    moreTip?: string
  }
  /** 一直露着（最新那条）；不给时宿主自己用 CSS 管悬停才露 */
  on?: boolean
  /** 挤了先把快捷回复收进 ⋯、左边功能按钮照样带字（旁支、视频问框那种窄处，款式页「旁支约 310 宽：带字放得下」）；不给是先收成图标（读 PDF 那排） */
  keepLabels?: boolean
  className?: string
  testId?: string
}

const GAP = 4
const SEP = 1 + 8

function Icon({ icon, logo, size }: { icon: AbIcon | undefined; logo?: ReactNode; size: number }) {
  const ui = useUi()
  if (icon === undefined || icon === null) return null
  if (icon === 'logo') return <span className="cn-ab-logo">{logo}</span>
  if (typeof icon === 'string') return <>{ui.icon(icon, { size })}</>
  return <>{icon}</>
}

/** 一排宽度、每颗多宽，算出这一排怎么摆：左边带不带字、右边排得下几颗 */
export function fitBar(o: { width: number; acts: readonly number[]; actsIcon: readonly number[]; more: number; replies: readonly number[]; keepLabels?: boolean }): { icons: boolean; shown: number } {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
  const left = (icons: boolean) => sum(icons ? o.actsIcon : o.acts) + o.more + GAP * o.acts.length
  const right = (k: number) => (k ? SEP + sum(o.replies.slice(0, k)) + GAP * k : 0)
  const n = o.replies.length
  if (left(false) + right(n) <= o.width) return { icons: false, shown: n }
  if (o.keepLabels && left(false) <= o.width) {
    let k = n - 1
    while (k > 0 && left(false) + right(k) > o.width) k--
    return { icons: false, shown: k }
  }
  if (!n) return { icons: true, shown: 0 }
  if (left(true) + right(n) <= o.width) return { icons: true, shown: n }
  let k = n - 1
  while (k > 0 && left(true) + right(k) > o.width) k--
  return { icons: true, shown: k }
}

export function AnswerBar(p: AnswerBarProps) {
  const root = useRef<HTMLDivElement>(null)
  const meas = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [sizes, setSizes] = useState<{ acts: number[]; actsIcon: number[]; more: number; replies: number[] } | null>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const replies = p.replies ?? []
  const sig = [...p.acts.map((a) => a.id + a.label + (flash === a.id ? a.flash?.label : '')), '|', ...replies.map((r) => r.id + r.label)].join('\u0001')

  // 量每颗多宽：字变了量一次；藏着的时候（右栏切到别的格、display: none）量出来全是 0，不记，等露出来宽度变了再量
  const measure = useCallback(() => {
    const m = meas.current
    if (!m) return
    const w = (sel: string) => [...m.querySelectorAll<HTMLElement>(sel)].map((e) => e.getBoundingClientRect().width)
    const next = { acts: w('[data-m=act]'), actsIcon: w('[data-m=act-i]'), more: w('[data-m=more]')[0] ?? 24, replies: w('[data-m=reply]') }
    if (!next.acts.some((x) => x > 0)) return
    setSizes((s) => (s && JSON.stringify(s) === JSON.stringify(next) ? s : next))
  }, [])
  useLayoutEffect(measure, [sig, measure])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const set = () => {
      setWidth(el.clientWidth)
      measure()
    }
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1500)
    return () => clearTimeout(t)
  }, [flash])

  // 还没量出来时照全带字、全排上画（量好的下一帧就对了）
  const fit = sizes && width ? fitBar({ width, ...sizes, ...(p.keepLabels ? { keepLabels: true } : {}) }) : { icons: false, shown: replies.length }
  const shown = replies.slice(0, fit.shown)
  const spill = [...replies.slice(fit.shown), ...(p.moreReplies ?? [])]
  const close = useCallback(() => setMenu(null), [])

  const actBtn = (a: AbAct, icons: boolean, measure?: 'act' | 'act-i') => {
    const f = flash === a.id && a.flash ? a.flash : null
    const label = f ? f.label : a.label
    return (
      <button
        key={a.id + (measure ?? '')}
        type="button"
        className={'cn-ab-btn cn-ab-act' + (icons ? ' icon' : '')}
        data-act={measure ? undefined : a.id}
        data-m={measure}
        tabIndex={measure ? -1 : undefined}
        aria-label={icons ? label : undefined}
        aria-disabled={a.disabled || undefined}
        data-tip={measure ? undefined : (a.tip ?? (icons ? label : undefined))}
        data-side="above-start"
        data-tip-class={a.tip?.includes('\n') ? 'tip-para' : undefined}
        onClick={
          measure
            ? undefined
            : () => {
                if (a.disabled) return
                a.onClick()
                if (a.flash) setFlash(a.id)
              }
        }
      >
        <Icon icon={f ? f.icon : a.icon} logo={p.logo} size={14} />
        {!icons && <span>{label}</span>}
      </button>
    )
  }
  const replyBtn = (r: AbReply, measure?: boolean) => (
    <button
      key={r.id}
      type="button"
      className="cn-ab-btn cn-ab-reply"
      data-reply={measure ? undefined : r.id}
      data-m={measure ? 'reply' : undefined}
      tabIndex={measure ? -1 : undefined}
      aria-disabled={r.disabled || undefined}
      data-tip={measure ? undefined : r.tip}
      data-side="above-start"
      onClick={measure || r.disabled ? undefined : r.onClick}
    >
      <Icon icon={r.icon} logo={p.logo} size={12} />
      <span>{r.label}</span>
    </button>
  )
  const moreBtn = (measure?: boolean) => (
    <button
      type="button"
      className={'cn-ab-btn cn-ab-act icon cn-ab-more' + (menu && !measure ? ' open' : '')}
      data-m={measure ? 'more' : undefined}
      data-act={measure ? undefined : 'more'}
      tabIndex={measure ? -1 : undefined}
      aria-label={p.text.more}
      aria-haspopup="menu"
      aria-expanded={measure ? undefined : !!menu}
      data-tip={measure ? undefined : (p.text.moreTip ?? p.text.more)}
      data-side="above-start"
      onClick={measure ? undefined : (e) => setMenu(menu ? null : e.currentTarget)}
    >
      <Icon icon="ellipsis" size={14} />
    </button>
  )

  return (
    <div ref={root} className={'cn-ab' + (p.on || menu ? ' on' : '') + (p.className ? ' ' + p.className : '')} data-testid={p.testId} data-icons={fit.icons || undefined} data-spill={spill.length || undefined}>
      <div className="cn-ab-measure" ref={meas} aria-hidden="true">
        {p.acts.map((a) => actBtn(a, false, 'act'))}
        {p.acts.map((a) => actBtn(a, true, 'act-i'))}
        {moreBtn(true)}
        {replies.map((r) => replyBtn(r, true))}
      </div>
      {p.acts.map((a) => actBtn(a, fit.icons))}
      {moreBtn()}
      {shown.length > 0 && <span className="cn-ab-sep" />}
      {shown.map((r) => replyBtn(r))}
      {menu && (
        <AbMenu anchor={menu} label={p.text.more} onClose={close}>
          {(p.head ?? []).map((it) => (
            <MenuRow key={it.id} it={it} logo={p.logo} close={close} />
          ))}
          {(p.head ?? []).length > 0 && <div className="cn-ab-hr" />}
          {(p.menu ?? []).map((it) => (
            <MenuRow key={it.id} it={it} logo={p.logo} close={close} />
          ))}
          {spill.length > 0 && (
            <>
              {(p.menu ?? []).length > 0 && <div className="cn-ab-hr" />}
              {p.text.moreReplies && <div className="cn-ab-mh">{p.text.moreReplies}</div>}
              {spill.map((r) => (
                <MenuRow key={r.id} it={r} logo={p.logo} close={close} reply />
              ))}
            </>
          )}
          {p.adjust && (
            <>
              <div className="cn-ab-hr" />
              <MenuRow it={p.adjust} logo={p.logo} close={close} />
            </>
          )}
          {(p.tail ?? []).length > 0 && <div className="cn-ab-hr" />}
          {(p.tail ?? []).map((it) => (
            <MenuRow key={it.id} it={it} logo={p.logo} close={close} />
          ))}
        </AbMenu>
      )}
    </div>
  )
}

function MenuRow({ it, logo, close, reply }: { it: AbMenuItem | AbReply; logo?: ReactNode; close(): void; reply?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="cn-ab-mi"
      data-item={reply ? undefined : it.id}
      data-reply={reply ? it.id : undefined}
      aria-disabled={it.disabled || undefined}
      data-tip={it.tip}
      data-side="left"
      onClick={() => {
        if (it.disabled) return
        close()
        it.onClick()
      }}
    >
      <span className="cn-ab-mic">
        <Icon icon={it.icon} logo={logo} size={14} />
      </span>
      <span className="cn-ab-ml">{it.label}</span>
    </button>
  )
}

/** ⋯ 自己或它外面几层藏起来了（透明、visibility hidden、display none） */
function anchorHidden(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el, i = 0; n && i < 8; n = n.parentElement, i++) {
    const cs = getComputedStyle(n)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true
  }
  return false
}

/** ⋯ 弹出来的菜单：挂在 body 上，右边和 ⋯ 对齐不出窗口，下面放不下翻到上面；Esc、点别处关上；↑↓ 走行 */
export function AbMenu(p: { anchor: HTMLElement; label: string; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const r = p.anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      let top = r.bottom + 4
      if (top + h > innerHeight - 8) top = r.top - h - 4 >= 8 ? r.top - h - 4 : innerHeight - h - 8
      setPos({ left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), top: Math.max(8, top) })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    // 对话滚动、窗口变大小：跟着 ⋯ 走（以前弹出来就钉在原处，那排滚走了菜单还挂在输入框上面，task-eavzx r100）
    addEventListener('scroll', place, true)
    addEventListener('resize', place)
    return () => {
      ro.disconnect()
      removeEventListener('scroll', place, true)
      removeEventListener('resize', place)
    }
  }, [p.anchor])
  // 那排藏了（⋯ 看不见了、滚出了对话、整条没了），菜单一起关：菜单不单独挂着
  const onClose = p.onClose
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => {
      if (!e!.isIntersecting) onClose()
    })
    io.observe(p.anchor)
    const tick = setInterval(() => {
      if (!p.anchor.isConnected || anchorHidden(p.anchor)) onClose()
    }, 200)
    return () => {
      io.disconnect()
      clearInterval(tick)
    }
  }, [p.anchor, onClose])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !p.anchor.contains(e.target as Node)) p.onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        p.onClose()
        p.anchor.focus()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>('.cn-ab-mi:not([aria-disabled])') ?? [])]
      if (!rows.length) return
      e.preventDefault()
      const at = rows.indexOf(document.activeElement as HTMLElement)
      rows[(at + (e.key === 'ArrowDown' ? 1 : rows.length - 1) + (at < 0 && e.key === 'ArrowUp' ? 1 : 0)) % rows.length]!.focus()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [p])
  return createPortal(
    <div ref={ref} className={'cn-ab-menu' + (p.className ? ' ' + p.className : '')} role="menu" aria-label={p.label} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      {p.children}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- 收不收改动

export interface CbButton {
  label: string
  icon?: AbIcon
  tip?: string
  disabled?: boolean
  onClick(): void
}

/**
 * 收不收改动（梦游、AI整理、对比标签、日历、画布今日都用这一套）：左边「看改动」或别的（跟 AI 说），中间空着，右边「不要 · 收下」。
 * 「看改动」「不要」无边框；「收下」在最右、胶囊，这一屏只有它一颗时实心（solid，--solid），中间已有实心的那处给描边。28 高。
 */
export function ChangeBar(p: { view?: CbButton; lead?: readonly CbButton[]; reject: CbButton; accept: CbButton; solid?: boolean; logo?: ReactNode; className?: string; testId?: string }) {
  const lead = [...(p.view ? [{ ...p.view, icon: p.view.icon ?? 'git-compare' }] : []), ...(p.lead ?? [])]
  const b = (x: CbButton, cls: string, act: string, fallback?: IconName) => (
    <button key={act} type="button" className={'cn-cb-btn ' + cls} data-act={act} aria-disabled={x.disabled || undefined} data-tip={x.tip} data-side="above" onClick={x.disabled ? undefined : x.onClick}>
      <Icon icon={x.icon ?? fallback} logo={p.logo} size={14} />
      <span>{x.label}</span>
    </button>
  )
  return (
    <div className={'cn-cb' + (p.className ? ' ' + p.className : '')} data-testid={p.testId}>
      {/* 看改动无边框（款式页「收不收改动」那一行：虚线 = btn-ghost）；别的放左边的（跟 AI 说）描边 */}
      {lead.map((x, i) => (i === 0 && p.view ? b(x, 'ghost', 'view') : b(x, 'out', `lead${i}`)))}
      <span className="cn-cb-sp" />
      {b(p.reject, 'ghost', 'reject', 'close')}
      {b(p.accept, p.solid ? 'solid' : 'out', 'accept', 'check')}
    </div>
  )
}

/** 收下以后、AI 动手做完以后的「撤回」：无边框、discard 图标，各处一个样子 */
export function UndoButton(p: { label: string; tip?: string; disabled?: boolean; onClick(): void; className?: string }) {
  return (
    <button type="button" className={'cn-cb-btn ghost cn-undo' + (p.className ? ' ' + p.className : '')} data-act="undo" aria-disabled={p.disabled || undefined} data-tip={p.tip} data-side="above" onClick={p.disabled ? undefined : p.onClick}>
      <Icon icon="discard" size={14} />
      <span>{p.label}</span>
    </button>
  )
}
