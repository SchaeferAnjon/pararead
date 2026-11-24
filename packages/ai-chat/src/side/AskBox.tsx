/**
 * 回答里选中一句：离选中高亮的下沿 8、横着居中的小框（CN-90 照 Dispatch，2026-11-21 起读 PDF、AI 对话、网页框一块问的回答、文档里的 AI 讲解都用它，task-4edsc；
 * 2026-11-22 用户看图定「离选中高亮的下沿 8」，task-5yp97：以前离的是字的下沿，高亮比字高出半个行距，看着贴在字上）：
 * 上面一格先能打问题（占位「问这句…（空着 ↵ 就是打开旁支自己打）」），分隔线，下面「引用 ⌘↵」「问这句 ↵」。
 * 「引用」的叫法和键同网页、PDF、HTML 的选中小条（task-bppvn，DESIGN.md「选中后的小条」：⌘↵ 是「问这一页」那个键，选着时是引用；⇧⌘L 照旧也是引用，不写）。
 * 点外面、失焦收起，esc 收起并取消选区；小框开着、焦点不在输入的地方时回车就是「问这句」；小框开着时 ⌘↵ 是引用
 * （焦点在小框那一格里、打了问题时 ⌘↵ 同 ↵ 发这句：多行框里 ⌘↵ 是提交，命令表 submit）。
 * AskBox 挂在回答列表上（选区在 .am[data-msg] .txt 里，旁支那一块里的不算）；文档里的由编辑器那一半直接给位置（AskBoxView）。
 * 「问这句」下面列出自己的 AI 命令（用户 r106，命令.json 里 kind: ai 的，去掉勾的在 answerSel.off）：最多露 4 条，多的点「更多…」就地展开，
 * 最下面隔一道线「调整…」去设置 › 回答下面那排的「回答里选中一句」一节；点一条拿选中的那句填好那条命令的话，和「问这句」打了问题一样开旁支发出去。
 */
import { t as tNow } from '@cn/ai-engines/shared'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, uiNow, useChat, useUi } from '../context'
import { useDismiss } from '../use-dismiss'
import { rangeText } from './marks'

/**
 * 选中高亮的下沿（屏幕坐标）：浏览器把选区底色铺满那一行的行盒，比字的下沿（getClientRects 给的）低一截。
 * 量最后一行（下沿最低的那一截）：这一段的行盒从内容顶上按行高一行行往下叠，算出它是第几行、那一行的下沿；
 * 算不准时（行里有比行高还高的东西，比如行内公式）退回「字的下沿 + 半个行距」。行高是 normal 时底色和字一样高。
 * 白板整块缩放着（右栏开着时 0.8）：屏幕上的字高是缩过的，行高也按同一个比例缩（比例 = 那一段屏幕上的宽 / 排版的宽）
 */
export function highlightBottom(range: Range): number {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  if (!rects.length) return range.getBoundingClientRect().bottom
  const last = rects.reduce((a, r) => (r.bottom > a.bottom ? r : a))
  const n = range.endContainer
  const el = n instanceof Element ? n : n.parentElement
  if (!el) return last.bottom
  let blk: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement
  while (blk && getComputedStyle(blk).display === 'inline') blk = blk.parentElement
  const scale = blk && blk.offsetWidth ? blk.getBoundingClientRect().width / blk.offsetWidth : 1
  const lh = parseFloat(getComputedStyle(blk ?? el).lineHeight) * scale
  if (!Number.isFinite(lh) || lh <= last.height) return last.bottom
  const guess = last.bottom + (lh - last.height) / 2
  if (!blk) return guess
  const cs = getComputedStyle(blk)
  const top = blk.getBoundingClientRect().top + (parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)) * scale
  const row = Math.floor((last.top + last.height / 2 - top) / lh)
  const exact = top + (row + 1) * lh
  return row >= 0 && Math.abs(exact - guess) < lh / 4 ? exact : guess
}

/** 小框离高亮下沿 8，量到眼睛看得见的边：--shadow-up 第一层是贴着框的一圈 1px 外环，框本身再往下 1 */
const GAP = 8
const RING = 1

/** 选区在列表里某条 AI 回答的正文里（旁支那一块里的不算）：那句话、那条回答的 id 和来源 */
function answerSelection(list: HTMLElement | null): { text: string; answer: string; rect: DOMRect; bottom: number; msg: number; src: string; range: Range } | null {
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
  return { text, answer: a.textContent ?? '', rect: range.getBoundingClientRect(), bottom: highlightBottom(range), msg: Number(am.dataset.msg), src: am.dataset.src ?? tNow('AI的回答'), range: range.cloneRange() }
}

/**
 * 小框本身：at 是选区的横中点和选中高亮的下沿（屏幕坐标，highlightBottom），within 是要收在哪一格里（离两边 8）；
 * sel 是选中的那句（自己的命令拿它填 {选中的字}），answer 是整条回答（填 {这条回答}，没有的填空）
 */
export function AskBoxView(p: { at: { cx: number; bottom: number }; within: DOMRect | null; sel: string; answer?: string; onQuote(): void; onAsk(question: string): void; onClose(why: 'esc' | 'outside' | 'blur'): void }) {
  const { t, keyLabel, icon } = useUi()
  const sc = useChat().selCmds
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  // 宿主固定不变，这里按有没有 selCmds 调钩子是稳的
  const cmds = sc ? sc.use() : { shown: [], more: [] }
  const list = all ? [...cmds.shown, ...cmds.more] : cmds.shown
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, [ref], (why) => p.onClose(why))
  const ask = useRef(p.onAsk)
  ask.current = p.onAsk
  const quote = useRef(p.onQuote)
  quote.current = p.onQuote
  // 小框开着、焦点不在输入的地方：回车就是「问这句」
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
      const own = (e.target as HTMLElement | null)?.closest('.askbox textarea') as HTMLTextAreaElement | null
      if (own?.value.trim()) ask.current(own.value)
      else quote.current()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  // 量了高再放：离选中高亮的下沿 8、横着居中；左右收进那一格（离两边 8），格子比小框还窄时贴着格子右边；下面放不下贴着窗口底
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || pos) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const cell = p.within ?? document.body.getBoundingClientRect()
    const lo = cell.left + 8
    const hi = Math.min(cell.right, window.innerWidth) - w - 8
    const left = hi < lo ? Math.max(8, hi) : Math.max(lo, Math.min(p.at.cx - w / 2, hi))
    setPos({ left, top: Math.max(8, Math.min(p.at.bottom + GAP + RING, window.innerHeight - h - 12)) })
  }, [pos, p.at, p.within])
  // 「更多…」展开以后高了：重新量、重新放（下面放不下往上挪）
  useLayoutEffect(() => {
    if (all) setPos(null)
  }, [all])
  return createPortal(
    <div ref={ref} className="menu askbox" role="dialog" aria-label={t('选中的这句')} data-composer-pop="" style={pos ?? { left: p.at.cx, top: p.at.bottom + GAP + RING, visibility: 'hidden' }}>
      <textarea
        rows={1}
        value={q}
        aria-label={t('问这句')}
        placeholder={t('问这句…（空着 ↵ 就是打开旁支自己打）')}
        title={t('空着 ↵ 就是打开旁支自己打')}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.stopPropagation()
            p.onAsk(q)
          }
        }}
      />
      <div className="sep" />
      <button className="it" onMouseDown={(e) => e.preventDefault()} onClick={p.onQuote}>
        <span className="ck">
          <Icon name="comment" size={14} />
        </span>
        {t('引用')}
        {keyLabel('ask-page') && <span className="r">{keyLabel('ask-page')}</span>}
      </button>
      <button className="it" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onAsk(q)}>
        <span className="ck">
          <Icon name="ai" size={14} />
        </span>
        {t('问这句')}
        <span className="r">↵</span>
      </button>
      {list.length > 0 && (
        <>
          <div className="sep" />
          <div className="mine" role="group" aria-label={t('我的命令')}>
            {list.map((c) => (
              <button key={c.id} className="it" title={c.say} onMouseDown={(e) => e.preventDefault()} onClick={() => p.onAsk(sc!.say(c, { sel: p.sel, ...(p.answer ? { answer: p.answer } : {}) }))}>
                <span className="ck">
                  {icon('ai', { size: 14 })}
                </span>
                <span className="nm">{c.name}</span>
              </button>
            ))}
            {!all && cmds.more.length > 0 && (
              <button className="it" onMouseDown={(e) => e.preventDefault()} onClick={() => setAll(true)}>
                <span className="ck">
                  <Icon name="ellipsis" size={14} />
                </span>
                {t('更多…')}
                <span className="r">{cmds.more.length}</span>
              </button>
            )}
          </div>
          <div className="sep" />
          <button
            className="it sub"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // 和引用、问这句一样把选区去掉：不然回来再拖选，按在还选着的字上是拖那段字
              window.getSelection()?.removeAllRanges()
              p.onClose('outside')
              sc!.openSettings()
            }}
          >
            <span className="ck">
              <Icon name="settings" size={14} />
            </span>
            {t('调整…')}
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

/**
 * 回答列表上选中一句：小框。onQuote 把那句引用进主对话的输入框；onAsk 开一条旁支（question 空着是打开旁支自己打）。
 * ⇧⌘L 有选区就直接引用（小框开着、没开都行）；回答区滚了小框收起
 */
export function AskBox(p: {
  list: RefObject<HTMLElement | null>
  active: boolean
  onQuote(text: string, src: string): void
  onAsk(at: { msg: number; quote: string }, question: string, range: Range): void
}) {
  const [box, setBox] = useState<{ text: string; answer: string; msg: number; src: string; cx: number; bottom: number; range: Range; seq: number } | null>(null)
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
        setBox({ text: s.text, answer: s.answer, msg: s.msg, src: s.src, cx: s.rect.left + s.rect.width / 2, bottom: s.bottom, range: s.range, seq: ++seq })
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
    // 回答区滚了：小框不跟着跑，收起
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
