/**
 * 回答里选中一句：浮在选中文字上方的横向小条（2026-11-24 用户 r129「选中这个文字的时候 我希望它变成一个小条 浮现在文字的上方」，偏好「回答里选中出横条」）。
 * 读 PDF、AI 对话、网页框一块问的回答、文档里的 AI 讲解、白板上的讲解卡、ParaRead 右栏都用它（task-4edsc 起同一个）。
 * 样子同 PDF、HTML 选中小条（composer.css 的 .capbar：34 高黑色胶囊），放法同网页、PDF 小条：在选中高亮上方 6，上面放不下才放到下面 6，
 * 横着对着选区居中，左右收进那一格（离两边 8），不盖住选中的那几行。
 * 一排：「问这句 ↵」（.main，同别处小条的「讲解一下」）·「引用 ⌘↵」｜ 自己的 AI 命令（命令.json 里 kind: ai 的，去掉勾的在 answerSel.off；露着的那几条条上放不下的、「更多」里的收进 ⋯）｜ ⋯（收进去的命令、「调整…」）；
 * 一条自己的命令都没有就不放 ⋯。
 * 「问这句」直接开旁支、光标在旁支的输入框里自己打（以前小框上面常驻的那格问题去掉了，和以前空着 ↵ 的做法一样）；点一条命令拿选中的那句填好那条命令的话，开旁支发出去。
 * 「引用」的叫法和键同网页、PDF、HTML 的选中小条（task-bppvn：⌘↵ 是「问这一页」那个键，选着时是引用；⇧⌘L 照旧也是引用，不写）。
 * 点外面、失焦收起，esc 收起并取消选区；小条开着、焦点不在输入的地方时回车就是「问这句」。
 * AskBox 挂在回答列表上（选区在 .am[data-msg] .txt 里，旁支那一块里的不算）；文档里的由编辑器那一半直接给位置（AskBoxView）。
 */
import { t as tNow } from '@cn/ai-engines/shared'
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, uiNow, useChat, useUi } from '../context'
import { useDismiss } from '../use-dismiss'
import { rangeText } from './marks'

/**
 * 选中高亮的上沿 / 下沿（屏幕坐标）：浏览器把选区底色铺满那一行的行盒，比字（getClientRects 给的）高出、低出一截。
 * 量第一行（上沿）或最后一行（下沿）：这一段的行盒从内容顶上按行高一行行往下叠，算出它是第几行、那一行的上沿 / 下沿；
 * 算不准时（行里有比行高还高的东西，比如行内公式）退回「字的边 ± 半个行距」。行高是 normal 时底色和字一样高。
 * 白板整块缩放着（右栏开着时 0.8）：屏幕上的字高是缩过的，行高也按同一个比例缩（比例 = 那一段屏幕上的宽 / 排版的宽）
 */
function highlightEdge(range: Range, edge: 'top' | 'bottom'): number {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  if (!rects.length) return range.getBoundingClientRect()[edge]
  const line = edge === 'bottom' ? rects.reduce((a, r) => (r.bottom > a.bottom ? r : a)) : rects.reduce((a, r) => (r.top < a.top ? r : a))
  const n = edge === 'bottom' ? range.endContainer : range.startContainer
  const el = n instanceof Element ? n : n.parentElement
  if (!el) return line[edge]
  let blk: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement
  while (blk && getComputedStyle(blk).display === 'inline') blk = blk.parentElement
  const scale = blk && blk.offsetWidth ? blk.getBoundingClientRect().width / blk.offsetWidth : 1
  const lh = parseFloat(getComputedStyle(blk ?? el).lineHeight) * scale
  if (!Number.isFinite(lh) || lh <= line.height) return line[edge]
  const half = (lh - line.height) / 2
  const guess = edge === 'bottom' ? line.bottom + half : line.top - half
  if (!blk) return guess
  const cs = getComputedStyle(blk)
  const top = blk.getBoundingClientRect().top + (parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)) * scale
  const row = Math.floor((line.top + line.height / 2 - top) / lh)
  const exact = top + (edge === 'bottom' ? row + 1 : row) * lh
  return row >= 0 && Math.abs(exact - guess) < lh / 4 ? exact : guess
}

export const highlightBottom = (range: Range) => highlightEdge(range, 'bottom')
export const highlightTop = (range: Range) => highlightEdge(range, 'top')

/** 小条离选中高亮 6（同网页、PDF 的选中小条，cap-place.ts）；左右离那一格的边 8 */
const GAP = 6
const EDGE = 8

/** 选区在列表里某条 AI 回答的正文里（旁支那一块里的不算）：那句话、那条回答的 id 和来源 */
function answerSelection(list: HTMLElement | null): { text: string; answer: string; rect: DOMRect; top: number; bottom: number; msg: number; src: string; range: Range } | null {
  const sel = window.getSelection()
  if (!list || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const el = (n: Node | null) => (n instanceof Element ? n : (n?.parentElement ?? null))
  if (el(sel.anchorNode)?.closest('.side-host') || el(sel.focusNode)?.closest('.side-host')) return null
  const at = (n: Node | null) => el(n)?.closest('.am .txt') ?? null
  const a = at(sel.anchorNode)
  if (!a || a !== at(sel.focusNode) || !list.contains(a)) return null
  const am = a.closest<HTMLElement>('.am[data-msg]')
  if (!am) return null
  const range = sel.getRangeAt(0)
  const text = rangeText(range)
  if (text.length < 2) return null
  return { text, answer: a.textContent ?? '', rect: range.getBoundingClientRect(), top: highlightTop(range), bottom: highlightBottom(range), msg: Number(am.dataset.msg), src: am.dataset.src ?? tNow('AI的回答'), range: range.cloneRange() }
}

/**
 * 小条本身：at 是选区的横中点和选中高亮的上沿、下沿（屏幕坐标，highlightTop / highlightBottom），within 是要收在哪一格里（离两边 8）；
 * sel 是选中的那句（自己的命令拿它填 {选中的字}），answer 是整条回答（填 {这条回答}，没有的填空）
 */
export function AskBoxView(p: { at: { cx: number; top: number; bottom: number }; within: DOMRect | null; sel: string; answer?: string; onQuote(): void; onAsk(question: string): void; onClose(why: 'esc' | 'outside' | 'blur'): void }) {
  const { t, keyLabel, icon } = useUi()
  const sc = useChat().selCmds
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // 宿主固定不变，这里按有没有 selCmds 调钩子是稳的
  const cmds = sc ? sc.use() : { shown: [], more: [] }
  /** 条上露几条自己的命令：先全露，一整条比那一格宽就从后往前收进 ⋯ */
  const [fit, setFit] = useState(cmds.shown.length)
  const [nokbd, setNokbd] = useState(false)
  const [more, setMore] = useState(false)
  const onBar = cmds.shown.slice(0, fit)
  const inMore = [...cmds.shown.slice(fit), ...cmds.more]
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, [ref], (why) => p.onClose(why))
  const ask = useRef(p.onAsk)
  ask.current = p.onAsk
  const quote = useRef(p.onQuote)
  quote.current = p.onQuote
  // 小条开着、焦点不在输入的地方：回车就是「问这句」
  useEffect(() => {
    const enter = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.metaKey) return
      const at = e.target as HTMLElement | null
      if (at?.closest('textarea, input, [contenteditable="true"]')) return
      e.preventDefault()
      ask.current('')
    }
    window.addEventListener('keydown', enter)
    return () => window.removeEventListener('keydown', enter)
  }, [])
  // ⌘↵（「问这一页」那个键）：引用。先于读 PDF 的「问这一页」、编辑器里的 ⌘↵ 接住（窗口上的捕获阶段）
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!uiNow().isKey(e, 'ask-page')) return
      e.preventDefault()
      e.stopPropagation()
      quote.current()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  // 量了宽再放：先藏键帽、再把自己的命令从后往前收进 ⋯，直到放得进那一格；放在高亮上方 6，上面放不下放到下面 6
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || pos) return
    const cell = p.within ?? document.body.getBoundingClientRect()
    const right = Math.min(cell.right, window.innerWidth)
    const room = right - cell.left - 2 * EDGE
    const w = el.offsetWidth
    if (w > room && !nokbd) return setNokbd(true)
    if (w > room && fit > 0) return setFit(fit - 1)
    const h = el.offsetHeight
    const lo = Math.max(8, cell.left + EDGE)
    const hi = Math.min(right, window.innerWidth - 8) - w - EDGE
    const left = hi < lo ? Math.max(8, hi) : Math.max(lo, Math.min(p.at.cx - w / 2, hi))
    const above = p.at.top - GAP - h
    const top = above >= Math.max(8, cell.top) ? above : Math.min(p.at.bottom + GAP, window.innerHeight - h - 8)
    setPos({ left, top })
  }, [pos, p.at, p.within, fit, nokbd])
  const btn = (k: string, onClick: () => void, body: ReactNode, cls = '', title?: string) => (
    <button key={k} className={cls} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {body}
    </button>
  )
  const run = (c: (typeof cmds.shown)[number]) => () => p.onAsk(sc!.say(c, { sel: p.sel, ...(p.answer ? { answer: p.answer } : {}) }))
  return createPortal(
    <div
      ref={ref}
      className={'capbar ai-cap askbar' + (nokbd ? ' nokbd' : '')}
      role="toolbar"
      aria-label={t('选中的这句')}
      data-composer-pop=""
      style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {btn(
        'ask',
        () => p.onAsk(''),
        <>
          {icon('ai', { size: 14 })}
          {t('问这句')}
          <kbd>↵</kbd>
        </>,
        'main',
      )}
      {btn(
        'quote',
        p.onQuote,
        <>
          <Icon name="comment" size={14} />
          {t('引用')}
          {keyLabel('ask-page') && <kbd>{keyLabel('ask-page')}</kbd>}
        </>,
      )}
      {onBar.length > 0 && <span className="sepv" />}
      {onBar.length > 0 && (
        <span className="mine" role="group" aria-label={t('我的命令')}>
          {onBar.map((c) =>
            btn(
              c.id,
              run(c),
              <>
                {icon('ai', { size: 14 })}
                <span className="nm">{c.name}</span>
              </>,
              '',
              c.say,
            ),
          )}
        </span>
      )}
      {/* 一条自己的命令都没有：不放 ⋯（里面只剩「调整…」），条上只有引用、问这句 */}
      {sc && inMore.length + onBar.length > 0 && (
        <>
          <span className="sepv" />
          <button className={'icon' + (more ? ' on' : '')} aria-label={t('更多')} aria-haspopup="menu" aria-expanded={more} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore(!more)}>
            <Icon name="ellipsis" size={14} />
          </button>
        </>
      )}
      {more && sc && (
        <div className="capmenu" role="menu" aria-label={t('这句还能做什么')}>
          {inMore.map((c) => (
            <button key={c.id} role="menuitem" title={c.say} onMouseDown={(e) => e.preventDefault()} onClick={run(c)}>
              {icon('ai', { size: 14 })}
              <span className="nm">{c.name}</span>
            </button>
          ))}
          {inMore.length > 0 && <div className="ms" />}
          <button
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // 和引用、问这句一样把选区去掉：不然回来再拖选，按在还选着的字上是拖那段字
              window.getSelection()?.removeAllRanges()
              p.onClose('outside')
              sc.openSettings()
            }}
          >
            <Icon name="settings" size={14} />
            {t('调整…')}
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * 回答列表上选中一句：小条。onQuote 把那句引用进主对话的输入框；onAsk 开一条旁支（question 空着是打开旁支自己打）。
 * ⇧⌘L 有选区就直接引用（小条开着、没开都行）；回答区滚了小条收起
 */
export function AskBox(p: {
  list: RefObject<HTMLElement | null>
  active: boolean
  onQuote(text: string, src: string): void
  onAsk(at: { msg: number; quote: string }, question: string, range: Range): void
}) {
  const [box, setBox] = useState<{ text: string; answer: string; msg: number; src: string; cx: number; top: number; bottom: number; range: Range; seq: number } | null>(null)
  const cb = useRef(p)
  cb.current = p
  useEffect(() => {
    const list = p.list.current
    if (!list || !p.active) return
    let seq = 0
    const up = () =>
      setTimeout(() => {
        const s = answerSelection(list)
        if (!s) return
        setBox({ text: s.text, answer: s.answer, msg: s.msg, src: s.src, cx: s.rect.left + s.rect.width / 2, top: s.top, bottom: s.bottom, range: s.range, seq: ++seq })
      }, 0)
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || !uiNow().isKey(e, 'quote')) return
      const s = answerSelection(list)
      if (!s) return
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      setBox(null)
      cb.current.onQuote(s.text, s.src)
    }
    // 回答区滚了：小条不跟着跑，收起
    const scroll = () => setBox(null)
    list.addEventListener('mouseup', up)
    list.addEventListener('scroll', scroll)
    window.addEventListener('keydown', key, true)
    return () => {
      list.removeEventListener('mouseup', up)
      list.removeEventListener('scroll', scroll)
      window.removeEventListener('keydown', key, true)
    }
  }, [p.list, p.active])
  if (!box) return null
  return (
    <AskBoxView
      key={box.seq}
      at={box}
      sel={box.text}
      answer={box.answer}
      within={p.list.current?.closest('aside')?.getBoundingClientRect() ?? null}
      onClose={(why) => {
        if (why === 'esc') window.getSelection()?.removeAllRanges()
        setBox(null)
      }}
      onQuote={() => {
        window.getSelection()?.removeAllRanges()
        setBox(null)
        cb.current.onQuote(box.text, box.src)
      }}
      onAsk={(question) => {
        window.getSelection()?.removeAllRanges()
        setBox(null)
        cb.current.onAsk({ msg: box.msg, quote: box.text }, question.trim(), box.range)
      }}
    />
  )
}
