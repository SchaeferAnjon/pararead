/**
 * 回答里问过的那句（旁支，CN-90；2026-11-21 起读 PDF、AI 对话、网页框一块问的回答都用，task-4edsc）：划一道强调色虚线，
 * 后面一个带数字的小标（方向 A：一句一个小标，数字是这一句开了几条旁支；开着的那条整句亮）。主对话、笔记里一样。
 * 回答是 React 画的：这里只在那一句的两头把文本节点切开，同一段里挨着的字和行内公式包进一个 span，再插一个小标，
 * 清掉时一步一步原样退回去（React 记着的节点还是那几个、还在原来的地方，不用 normalize：它会把 React 分开画的相邻几段字并成一段）。
 * 找那一句时空白算一个（选区里的换行和页面上的不一样），KaTeX 给读屏的那一份（.katex-mathml）、小标自己、零宽空格都不算。
 */
import { t } from '@cn/ai-engines/shared'
import { uiNow } from '../context'

/** 不算字的：KaTeX 给读屏的那一份、小标、小框、回答里挂着的旁支那一块 */
const SKIP = '.katex-mathml, .badge, .askbar, .side-host'

/** root 里能找字的文本节点（按文档顺序） */
function textNodes(root: Element): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  })
  while (w.nextNode()) out.push(w.currentNode as Text)
  return out
}

/** 一段字空白并成一个、去掉零宽空格（选区的字、存下来的那一句、找的时候都这样比） */
export const foldText = (s: string) => s.replace(/​/g, '').replace(/\s+/g, ' ').trim()

/** 选区里的字：去掉 KaTeX 给读屏的那一份和小标，空白并成一个 */
export function rangeText(range: Range): string {
  const box = document.createElement('div')
  box.appendChild(range.cloneContents())
  for (const el of box.querySelectorAll(SKIP)) el.remove()
  return foldText(box.textContent ?? '')
}

/**
 * 句子后面紧跟着的收尾标点（。，、；：？！」』）这些）：亮的那句和小标挪到它后面，不然小标把「。」挤到下一行的行首。
 * 从 s 的第 i 个字起往后数，返回标点之后的位置；3.14 这种小数点不算
 */
const CLOSE = /[。，、；：？！」』）】》〉”’…,.;:!?)\]]/
export function closeRun(s: string, i: number): number {
  let j = i
  while (j < s.length && CLOSE.test(s[j]!) && !(s[j] === '.' && /\d/.test(s[j + 1] ?? ''))) j++
  return j
}

/** 那一句的尾巴挪到紧跟着的收尾标点后面（标点在同一段的下一个文本节点里也算，比如那句以加粗结尾） */
function withClose(nodes: Text[], to: [number, number]): [number, number] {
  let [k, i] = to
  const home = nodes[k]!.parentElement?.closest(BLOCK) ?? null
  for (;;) {
    const s = nodes[k]!.data
    const j = closeRun(s, i)
    if (j > i) to = [k, j]
    if (j < s.length) return to
    const next = nodes[k + 1]
    if (!next || (next.parentElement?.closest(BLOCK) ?? null) !== home) return to
    k++
    i = 0
  }
}

/** 在 root 的字里找 quote（空白算一个）：起止落在哪个文本节点的第几个字 */
function locate(nodes: Text[], quote: string): { from: [number, number]; to: [number, number] } | null {
  const want = foldText(quote)
  if (!want) return null
  let folded = ''
  const at: [number, number][] = []
  let space = false
  nodes.forEach((n, k) => {
    const s = n.data
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!
      if (ch === '​') continue
      if (/\s/.test(ch)) {
        if (!space && folded.length) {
          folded += ' '
          at.push([k, i])
        }
        space = true
        continue
      }
      space = false
      folded += ch
      at.push([k, i])
    }
  })
  const i = folded.indexOf(want)
  if (i < 0) return null
  const end = at[i + want.length - 1]!
  return { from: at[i]!, to: withClose(nodes, [end[0], end[1] + 1]) }
}

export interface Mark {
  /** 这一句的编号（这一句最早开的那条旁支的编号）：span 上的 data-side，小标上也是 */
  side: string
  quote: string
  /** 小标上的数字：这一句开了几条旁支 */
  n: number
  /** 小标悬停的说明「这句有 2 条旁支」 */
  title: string
  /** 开着的是这一句的旁支：小标是强调色底白字、整句亮 */
  cur?: boolean
}

/** 一段字空白并成一个比的那几句：同一句开的几条并成一组（按开的先后），小标一句一个（原型 A：数字是这一句有几条） */
export function sideGroups<S extends { id: string; quote: string; createdAt: number }>(sides: readonly S[]): { key: string; quote: string; sides: S[] }[] {
  const out = new Map<string, { key: string; quote: string; sides: S[] }>()
  for (const s of [...sides].sort((a, b) => a.createdAt - b.createdAt)) {
    const q = foldText(s.quote)
    const g = out.get(q)
    if (g) g.sides.push(s)
    else out.set(q, { key: s.id, quote: s.quote, sides: [s] })
  }
  return [...out.values()]
}

/** 一组画成的那一个记号 */
export const groupMark = (g: { key: string; quote: string; sides: { id: string }[] }, open: string | null): Mark => ({
  side: g.key,
  quote: g.quote,
  n: g.sides.length,
  title: t('这句有 {n} 条旁支', { n: g.sides.length }),
  cur: !!open && g.sides.some((s) => s.id === open),
})

/** 块级的（段落、列表项、表格、单独一行的公式……）：一个 span 不能把它包进去，往里一层包 */
const BLOCK = 'p, li, ul, ol, div, table, thead, tbody, tr, td, th, pre, blockquote, h1, h2, h3, h4, h5, h6, .katex-display'

/** node 整个在 range 里 */
function inside(range: Range, node: Node): boolean {
  const r = document.createRange()
  r.selectNode(node)
  return range.compareBoundaryPoints(Range.START_TO_START, r) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, r) >= 0
}

/**
 * 把 range 里的东西用 span.asked 包起来：同一个段落里挨着的字和行内公式包成一个 span（虚线一整条、亮的时候一整块，
 * 公式下面也有线），跨段落时每段一个。返回包好的 span，退回去的步骤记进 undo
 */
function wrap(range: Range, side: string, undo: (() => void)[], cur = false): HTMLSpanElement[] {
  const spans: HTMLSpanElement[] = []
  const walk = (parent: Node) => {
    let run: Node[] = []
    const flush = () => {
      if (!run.length) return
      const span = document.createElement('span')
      span.className = 'asked' + (cur ? ' on' : '')
      span.dataset.side = side
      parent.insertBefore(span, run[0]!)
      for (const n of run) span.appendChild(n)
      const moved = run
      undo.push(() => {
        for (const n of moved) span.parentNode?.insertBefore(n, span)
        span.remove()
      })
      spans.push(span)
      run = []
    }
    for (const child of [...parent.childNodes]) {
      if (!range.intersectsNode(child)) flush()
      else if (!inside(range, child) || (child instanceof Element && child.matches(BLOCK))) {
        // 只有一部分在里面、或者是块级的：往里一层
        flush()
        walk(child)
      } else run.push(child)
    }
    flush()
  }
  walk(range.commonAncestorContainer)
  return spans
}

/** 那一句后面的小标（17 高、圆角 5，comment-discussion 11 + 数字）：回答里、文档的 AI 讲解里同一个 */
export function badgeEl(m: Mark): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = 'badge' + (m.cur ? ' cur' : '')
  badge.dataset.side = m.side
  badge.setAttribute('role', 'button')
  badge.tabIndex = 0
  badge.title = m.title
  badge.setAttribute('aria-label', t('{title}（小标 {n}）', { title: m.title, n: m.n }))
  badge.append(uiNow().iconEl('comment-discussion', 11), String(m.n))
  return badge
}

/**
 * 在 root 里把每一句划上虚线、后面插小标；返回清掉的函数（原样退回去）。找不到那一句的不划（回答被改过）
 */
export function applyMarks(root: Element, marks: Mark[]): () => void {
  const undo: (() => void)[] = []
  for (const m of marks) {
    const nodes = textNodes(root)
    const hit = locate(nodes, m.quote)
    if (!hit) continue
    // 起止那两个文本节点在那一句的边上切开（先切后面，同一个节点时前面的位置不变）
    const endNode = nodes[hit.to[0]]!
    if (hit.to[1] < endNode.data.length) {
      const tail = endNode.splitText(hit.to[1])
      undo.push(() => {
        endNode.appendData(tail.data)
        tail.remove()
      })
    }
    const startNode = nodes[hit.from[0]]!
    let first: Text = startNode
    if (hit.from[1] > 0) {
      const rest = startNode.splitText(hit.from[1])
      undo.push(() => {
        startNode.appendData(rest.data)
        rest.remove()
      })
      first = rest
    }
    const last: Text = startNode === endNode ? first : endNode
    // 那一句正好从一个行内元素（加粗、链接）的头开始、到它的尾结束：把整个元素算进来，包成一个 span
    const edge = (n: Node, side: 'firstChild' | 'lastChild') => {
      while (n.parentNode && n.parentNode !== root && !(n.parentNode instanceof Element && n.parentNode.matches(BLOCK)) && n.parentNode[side] === n) n = n.parentNode
      return n
    }
    const range = document.createRange()
    range.setStartBefore(edge(first, 'firstChild'))
    range.setEndAfter(edge(last, 'lastChild'))
    const spans = wrap(range, m.side, undo, !!m.cur)
    const tail = spans[spans.length - 1]
    if (!tail) continue
    const badge = badgeEl(m)
    tail.after(badge)
    undo.push(() => badge.remove())
  }
  return () => {
    for (let i = undo.length - 1; i >= 0; i--) undo[i]!()
  }
}

/** 刚收起的那一句：那句闪 1.4 秒、小标闪一圈 1.2 秒（原型 A 的 closeSide） */
export function flashMark(root: Element | null, key: string) {
  if (!root) return
  for (const s of root.querySelectorAll<HTMLElement>(`.asked[data-side="${CSS.escape(key)}"]`)) {
    s.classList.remove('flash')
    void s.offsetWidth
    s.classList.add('flash')
    setTimeout(() => s.classList.remove('flash'), 1400)
  }
  const b = root.querySelector<HTMLElement>(`.badge[data-side="${CSS.escape(key)}"]`)
  if (!b) return
  b.classList.remove('pulse')
  void b.offsetWidth
  b.classList.add('pulse')
  setTimeout(() => b.classList.remove('pulse'), 1200)
}
