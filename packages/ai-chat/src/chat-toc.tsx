/**
 * AI 对话的目录条（task-3e53q 设计页「三、b」，照搬文档目录条 doc-toc.tsx / DESIGN.v3 CN-26 A）：
 * 对话右边贴边一列短横线，一问一条长横线，回答里的小标题是短横线，旁支是强调色的短横线；
 * 指着 0.2 秒展开 264 宽的浮层（一行一问：序号 + 问题前面几个字，下面一级是回答里的小标题和旁支），
 * 正在看的那一条亮着、底色加深；点一条滚过去（旁支：打开那条旁支）。问过一问就出（用户定的第 5 条，不设门槛）。
 * 右栏 AI 对话和读 PDF 的 AI 共用：条目从画好的对话里按先后找（[data-toc-q] 那一问、.am 里的 .md-h、问过那句后面的小标），
 * 旁支里面的字不算（旁支挂在它那一问下面一级，一行截短）。
 */
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, useUi } from './context'
import './chat-toc.css'

/** 旁支：小标（.badge[data-side]）上写的是这一句那一组的键，一组可以有好几条 */
export interface TocSide {
  id: string
  name: string
  /** 小标的键（marks.ts sideGroups 的 key） */
  group: string
}

interface Item {
  kind: 'q' | 'h' | 's'
  text: string
  /** 第几问（kind q） */
  no?: number
  el: HTMLElement
  /** 旁支的 id（kind s） */
  side?: string
}

/** 每条横线 2 高；排不下时横线之间从 9 收到 3，再不够就条上只画问和旁支（浮层里照样全列） */
const GAP_MAX = 9
const GAP_MIN = 3

function scan(list: HTMLElement, sides: readonly TocSide[]): Item[] {
  const out: Item[] = []
  let no = 0
  for (const el of list.querySelectorAll<HTMLElement>('[data-toc-q], .am .md-h, .am .badge[data-side]')) {
    if (el.closest('.side-inl')) continue
    if (el.hasAttribute('data-toc-q')) out.push({ kind: 'q', text: el.dataset.tocQ!.replace(/\s+/g, ' ').trim(), no: ++no, el })
    else if (!no) continue
    else if (el.classList.contains('badge')) {
      for (const s of sides) if (s.group === el.dataset.side) out.push({ kind: 's', text: s.name, el, side: s.id })
    } else {
      const text = el.textContent?.replace(/\s+/g, ' ').trim()
      if (text) out.push({ kind: 'h', text, el })
    }
  }
  return out
}

const same = (a: Item[], b: Item[]) => a.length === b.length && a.every((x, i) => x.el === b[i]!.el && x.text === b[i]!.text && x.kind === b[i]!.kind && x.side === b[i]!.side)

export function ChatToc(props: {
  list: RefObject<HTMLElement | null>
  sides: readonly TocSide[]
  /** 开着的那条旁支（点它那一行：滚到它） */
  openSide: string | null
  /** 点旁支那一行：打开那条旁支 */
  onSide(id: string): void
}) {
  const { t } = useUi()
  const [items, setItems] = useState<Item[]>([])
  const [cur, setCur] = useState(0)
  const [open, setOpen] = useState(false)
  /** 浮层里键盘 ↑↓ 选着的那一行 */
  const [sel, setSel] = useState(-1)
  const [fit, setFit] = useState<{ gap: number; slim: boolean }>({ gap: GAP_MAX, slim: false })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const rows = useRef<HTMLDivElement>(null)
  const sidesNow = useRef(props.sides)
  sidesNow.current = props.sides
  const itemsNow = useRef(items)
  itemsNow.current = items

  // 对话画出来、出字、划上小标、开关旁支：重新找一遍；滚动、变高时算正在看哪一条、横线排不排得下
  useLayoutEffect(() => {
    const sc = props.list.current
    if (!sc) return
    let raf = 0
    const measure = () => {
      // 一直显示滚动条时它占的宽：CSS 从右内边距里扣掉（ai.css .msgs-box.toc）
      sc.style.setProperty('--sbw', `${sc.offsetWidth - sc.clientWidth}px`)
      const list = itemsNow.current
      const box = sc.getBoundingClientRect()
      const top = box.top + 60
      // 滚到底了：最后几条可能永远到不了上面那条线，取看得见的上半截里最后一条
      const end = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2
      const line = end ? box.top + sc.clientHeight / 2 : top
      let k = 0
      list.forEach((it, i) => {
        if (it.el.getBoundingClientRect().top <= line) k = i
      })
      setCur(k)
      const room = sc.clientHeight - 32
      const n = list.length
      const gap = n > 1 ? Math.floor((room - 16 - n * 2) / (n - 1)) : GAP_MAX
      if (gap >= GAP_MIN) setFit({ gap: Math.min(GAP_MAX, gap), slim: false })
      else {
        const m = list.filter((x) => x.kind !== 'h').length
        setFit({ gap: Math.max(GAP_MIN, Math.min(GAP_MAX, m > 1 ? Math.floor((room - 16 - m * 2) / (m - 1)) : GAP_MAX)), slim: true })
      }
    }
    const rescan = () => {
      raf = 0
      const next = scan(sc, sidesNow.current)
      if (!same(next, itemsNow.current)) {
        itemsNow.current = next
        setItems(next)
      }
      measure()
    }
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(rescan)
    }
    rescan()
    const mo = new MutationObserver(soon)
    mo.observe(sc, { childList: true, subtree: true, characterData: true })
    sc.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(soon)
    ro.observe(sc)
    return () => {
      sc.style.removeProperty('--sbw')
      cancelAnimationFrame(raf)
      mo.disconnect()
      ro.disconnect()
      sc.removeEventListener('scroll', measure)
    }
  }, [props.list])
  // 旁支改名、多开了一条：小标没变，名字要跟着换
  const sidesKey = props.sides.map((s) => `${s.id}:${s.group}:${s.name}`).join('|')
  useEffect(() => {
    const sc = props.list.current
    if (!sc) return
    const next = scan(sc, props.sides)
    if (!same(next, itemsNow.current)) setItems(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidesKey])

  useEffect(() => () => clearTimeout(timer.current), [])

  // 展开时：正在看的那一行滚进浮层里看得见的地方；↑↓ 选、↵ 跳过去
  useLayoutEffect(() => {
    if (!open) return
    setSel(-1)
    rows.current?.querySelector<HTMLElement>('.r.on')?.scrollIntoView({ block: 'nearest' })
  }, [open])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      const n = itemsNow.current.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSel((s) => {
          const from = s < 0 ? cur : s
          const to = (from + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
          requestAnimationFrame(() => rows.current?.querySelector<HTMLElement>(`.r[data-k="${to}"]`)?.scrollIntoView({ block: 'nearest' }))
          return to
        })
      } else if (e.key === 'Enter' && sel >= 0) {
        e.preventDefault()
        e.stopPropagation()
        go(itemsNow.current[sel]!)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sel, cur])

  const asks = items.filter((x) => x.kind === 'q').length
  if (!asks) return null

  function go(it: Item) {
    setOpen(false)
    const sc = props.list.current
    if (!sc) return
    if (it.kind === 's' && it.side !== props.openSide) {
      // 旁支：打开那一条（挂在那句所在的那一段下面，旁支自己把它滚进来）
      props.onSide(it.side!)
      return
    }
    const target = it.kind === 's' ? (sc.querySelector<HTMLElement>(`.side-inl[data-side="${CSS.escape(it.side!)}"]`) ?? it.el) : it.el
    const y = target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12
    sc.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    // 跳到的那一问：气泡外圈亮一下（原型 .um.hit）
    const um = it.kind === 'q' ? it.el.querySelector<HTMLElement>('.um') : null
    if (um) {
      um.classList.remove('toc-hit')
      void um.offsetWidth
      um.classList.add('toc-hit')
      setTimeout(() => um.classList.remove('toc-hit'), 1400)
    }
  }
  const enter = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 200)
  }
  const leave = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 160)
  }
  const mark = (it: Item) => (it.kind === 'q' ? 'd0' : it.kind === 's' ? 'ds' : 'd1')

  return (
    <div className="chat-toc-wrap" onMouseEnter={enter} onMouseLeave={leave}>
      <div className={'chat-toc' + (open ? ' gone' : '')} data-part="对话目录条" /* 不翻：data-part 是 e2e、设计复审认的 */ aria-hidden="true" style={{ gap: fit.gap }}>
        {items.map((it, i) => (fit.slim && it.kind === 'h' ? null : <i key={i} className={mark(it) + (i === cur ? ' on' : '')} />))}
      </div>
      {open && (
        <nav className="chat-tocpop" aria-label={t('这段对话的目录')} data-part="对话目录浮层" /* 不翻：data-part 是 e2e、设计复审认的 */>
          <div className="hd">
            <span>{t('这段对话 · {n} 问', { n: asks })}</span>
            <span>{t('↑↓ 选 · ↵ 跳过去')}</span>
          </div>
          <div className="rows" ref={rows}>
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                data-k={i}
                className={'r ' + it.kind + (i === cur ? ' on' : '') + (i === sel ? ' kb' : '')}
                title={it.text}
                onClick={() => go(it)}
              >
                {it.kind === 'q' && <span className="no">{it.no}</span>}
                {it.kind === 's' && <Icon name="comment-discussion" size={12} />}
                <span className="tx">{it.kind === 's' ? t('旁支 · {name}', { name: it.text }) : it.text}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
