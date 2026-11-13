import { BookOpen, Check, Copy, CornerDownRight, ExternalLink, Maximize2, MessageCircleQuestion, Minimize2, Plus } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { alignPosition } from '@shared/chunk'
import { sensesKey } from '@shared/hash'
import { CITE_RE, expandCite, findReferences, plain } from '@shared/refs'
import { termOf, termRegex } from '@shared/terms'
import { LABEL_NAME } from '@shared/annLabels'
import { alignOffsets, counterpart, cut, needsMd, senseable, toMd, type SenseSentence, type Span } from '@shared/senses'
import type { Annotation, Block, MajorPoint, Paper, ReadPosition, ReflowDoc, SettingsView, Term } from '@shared/types'
import { api, errText, type ReflowProgress, type SearchHit } from '../api'
import { Markdown } from '../lib/Markdown'
import { offsetsIn, rangeAt, selectionText } from '../lib/selection'
import { useSenses } from '../lib/senses'
import type { TrState, useTranslations } from '../lib/translations'
import { authorsShort, fmtElapsed, Skeleton, useEvent, useNotePreview, useToast } from '../lib/ui'
import { MAJOR_NAME } from './LeftPane'
import { Lightbox } from './Lightbox'
import type { Jump } from './Reader'
import type { SelInfo } from './Selection'
import { t } from '@shared/i18n'

type Tr = ReturnType<typeof useTranslations>

// 对照模式：MinerU 的 Markdown 切块，每个文字段落下面紧跟译文。译文进入视口上下两屏才请求。
export function ReflowView(props: {
  paper: Paper
  doc: ReflowDoc | null
  prog: ReflowProgress | null
  anns: Annotation[]
  settings: SettingsView
  tr: Tr
  jump: Jump | null
  hoverAnn: string | null
  sections: Map<string, string>
  marks: MajorPoint[] | null
  terms: Term[] | null
  initial: ReadPosition
  onPosition: (p: { blockId: string; blockHash: string; textPrefix: string; heading: string; offset: number }, progress: number) => void
  onSelect: (s: SelInfo | null) => void
  onAsk: (quote: string, extra?: string) => void
  onAskImage: (image: string, context: string, prefill?: string) => void
  onOpenPaper: (id: string) => void
  onBlock: (blockId: string) => void
  onReadPdf: () => void
  onRetry: () => void
  onSimple: () => Promise<void>
}) {
  const { doc, tr, settings } = props
  const toast = useToast()
  const scroller = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  const [now, setNow] = useState(Date.now())
  // 点图放大：弹出大图盖住整个窗口（Lightbox），这里记着要放大的那张图的地址
  const [zoomed, setZoomed] = useState<string | null>(null)
  const imgSrc = (blockId: string): string | null => scroller.current?.querySelector<HTMLImageElement>(`[data-block="${CSS.escape(blockId)}"] img`)?.src ?? null
  const [simpleBusy, setSimpleBusy] = useState(false)
  const [cite, setCite] = useState<{ ns: string[]; n: string; range: Range } | null>(null)
  const [tags, setTags] = useState<{ top: number; left: number; label: string }[]>([])
  const lastTier = useRef<string | null>(null)
  const posRef = useRef<{ blockHash: string; textPrefix: string; heading: string; offset: number } | null>(null)

  useEffect(() => {
    if (doc) return
    const t_ = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t_)
  }, [doc])

  // 懒翻译：视口上下两屏内的块排队请求
  useEffect(() => {
    if (!doc || settings.display === 'src') return
    const el = scroller.current
    if (!el) return
    const byId = new Map(doc.blocks.map((b) => [b.id, b]))
    let pending: Block[] = []
    let t_: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const b = byId.get((e.target as HTMLElement).dataset.block!)
          if (b?.translatable) pending.push(b)
        }
        if (pending.length && !t_)
          t_ = setTimeout(() => {
            void tr.request(pending)
            pending = []
            t_ = null
          }, 60)
      },
      { root: el, rootMargin: '200% 0px 200% 0px' }
    )
    el.querySelectorAll('[data-block]').forEach((n) => io.observe(n))
    return () => {
      io.disconnect()
      if (t_) clearTimeout(t_)
    }
  }, [doc, settings.display, tr])

  // 意群显示：视口上下一屏内、译文已经到了的正文段去要意群（一段一个请求，主进程排队、缓存）
  const senseOn = settings.display === 'both' && settings.senseGroups
  const side = settings.display === 'both' && settings.trLayout === 'side'
  const senseWarned = useRef(false)
  const sn = useSenses(props.paper.id, (msg) => {
    if (senseWarned.current) return
    senseWarned.current = true
    toast(t('没拿到原文和译文的对应：{0}', msg))
  })
  useEffect(() => {
    if (!senseOn) return
    senseWarned.current = false
    sn.retryFailed()
    return () => void api.cancelSenses(props.paper.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senseOn, props.paper.id])
  useEffect(() => {
    const el = scroller.current
    if (!senseOn || !doc || !el) return
    const byId = new Map(doc.blocks.map((b) => [b.id, b]))
    let t_: ReturnType<typeof setTimeout> | null = null
    const scan = (): void => {
      t_ = null
      const box = el.getBoundingClientRect()
      const items: { en: string; zh: string; far: number }[] = []
      const mid = (box.top + box.bottom) / 2
      for (const n of el.querySelectorAll<HTMLElement>('.blk.paragraph')) {
        const r = n.getBoundingClientRect()
        if (r.bottom < box.top - box.height) continue
        if (r.top > box.bottom + box.height) break
        const b = byId.get(n.dataset.block!)
        const s = b && tr.map[tr.keyOf(b)]
        // 离窗口中间近的先要：眼前这几段先出来
        if (b && s && 'text' in s && senseable(b.md)) items.push({ en: b.md.trim(), zh: s.text.trim(), far: r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid)) })
      }
      if (items.length) void sn.request(items.sort((a, b) => a.far - b.far).map(({ en, zh }) => ({ en, zh })))
    }
    const later = (): void => void (t_ ??= setTimeout(scan, 150))
    later()
    el.addEventListener('scroll', later, { passive: true })
    return () => {
      el.removeEventListener('scroll', later)
      if (t_) clearTimeout(t_)
    }
  }, [senseOn, doc, tr, sn.request])
  const senseOf = (b: Block): SenseSentence[] | undefined => {
    if (!senseOn || b.type !== 'paragraph') return undefined
    const s = tr.map[tr.keyOf(b)]
    if (!s || !('text' in s)) return undefined
    const st = sn.map[sensesKey(b.md.trim(), s.text.trim())]
    return st && 'data' in st ? st.data : undefined
  }
  // 选中一边、另一边跟着亮：记下选区在哪一段、哪一边、画出来的字符偏移；对应关系用同一份意群对齐（没有就去要，一段一次）
  const [link, setLink] = useState<{ blockId: string; inTr: boolean; start: number; end: number } | null>(null)
  useEffect(() => {
    const on = (): void => {
      if (window.getSelection()?.isCollapsed) setLink(null)
    }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [])
  const linkBlock = link ? doc?.blocks.find((b) => b.id === link.blockId) : undefined
  const linkTr = linkBlock ? tr.map[tr.keyOf(linkBlock)] : undefined
  const linkPair = linkBlock && linkTr && 'text' in linkTr ? { en: linkBlock.md.trim(), zh: linkTr.text.trim() } : null
  const linkKey = linkPair ? sensesKey(linkPair.en, linkPair.zh) : ''
  useEffect(() => {
    if (linkPair) void sn.request([linkPair])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey, sn.request])
  const linkState = linkKey ? sn.map[linkKey] : undefined
  const linkData = linkState && 'data' in linkState ? linkState.data : null
  useEffect(() => {
    const blk = link && scroller.current?.querySelector(`[data-block="${CSS.escape(link.blockId)}"]`)
    const srcEl = blk?.querySelector('.src')
    const trEl = blk?.querySelector('.tr-text')
    if (!link || !linkPair || !linkData || !srcEl || !trEl) return
    const en = alignOffsets(linkPair.en, srcEl.textContent ?? '')
    const zh = alignOffsets(linkPair.zh, trEl.textContent ?? '')
    const [from, to, target] = link.inTr ? [zh, en, srcEl] : [en, zh, trEl]
    const ranges = counterpart(linkData, link.inTr ? 'zh' : 'en', toMd(from, link.start), toMd(from, link.end))
      .map(([a, b]) => rangeAt(target, to[a], to[b]))
      .filter((r): r is Range => !!r && !r.collapsed)
    if (!ranges.length) return
    CSS.highlights.set('sel-link', new Highlight(...ranges))
    return () => void CSS.highlights.delete('sel-link')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, linkKey, linkData, senseOn, side])

  // 鼠标停在一块上：原文和译文里对上的那几段一起亮
  const hot = useRef<{ key: string; nodes: Element[] }>({ key: '', nodes: [] })
  const onOver = (e: React.MouseEvent): void => {
    const sg = (e.target as Element).closest('.sg')
    const blk = sg?.closest('.blk')
    const key = sg && blk ? `${(blk as HTMLElement).dataset.block}:${sg.getAttribute('data-k')}` : ''
    if (key === hot.current.key) return
    for (const n of hot.current.nodes) n.classList.remove('hot')
    hot.current = { key, nodes: sg && blk ? [...blk.querySelectorAll(`.sg[data-k="${sg.getAttribute('data-k')}"]`)] : [] }
    hot.current.nodes.forEach((n) => n.classList.add('hot'))
  }
  // 鼠标移出正文（到标题栏、侧栏）：亮着的那一块熄掉
  const offHot = (): void => {
    for (const n of hot.current.nodes) n.classList.remove('hot')
    hot.current = { key: '', nodes: [] }
  }

  // 位置：顶部那块的哈希、文字前缀、所在标题
  const onScroll = (): void => {
    const el = scroller.current
    if (!el || !doc) return
    const top = el.getBoundingClientRect().top
    let found: HTMLElement | null = null
    for (const n of el.querySelectorAll<HTMLElement>('[data-block]')) {
      const r = n.getBoundingClientRect()
      if (r.bottom > top + 8) {
        found = n
        break
      }
    }
    if (!found) return
    const b = doc.blocks.find((x) => x.id === found!.dataset.block)
    if (!b) return
    const p = {
      blockHash: b.hash,
      textPrefix: b.md.slice(0, 120),
      heading: props.sections.get(b.id) ?? '',
      offset: Math.round(top - found.getBoundingClientRect().top)
    }
    posRef.current = p
    props.onPosition({ blockId: b.id, ...p }, Math.min(1, (el.scrollTop + el.clientHeight) / el.scrollHeight))
  }

  // 首次打开恢复位置；flash 换成 basic 时按标题和段落文字对齐，保持阅读位置
  useLayoutEffect(() => {
    if (!doc || !scroller.current) return
    const first = lastTier.current === null
    const changed = lastTier.current !== null && lastTier.current !== doc.tier
    lastTier.current = doc.tier
    if (!first && !changed) return
    const pos = first ? props.initial : posRef.current
    if (!pos) return
    const id = alignPosition(doc.blocks, pos)
    if (!id) return
    const n = scroller.current.querySelector<HTMLElement>(`[data-block="${CSS.escape(id)}"]`)
    if (n) scroller.current.scrollTop += n.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top + (pos.offset ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // 换排法（上下 / 左右）每段的高度都变了：让原来顶上那一段还在顶上
  const layoutKey = `${side}|${senseOn}`
  const lastSide = useRef(layoutKey)
  useLayoutEffect(() => {
    if (lastSide.current === layoutKey) return
    lastSide.current = layoutKey
    const pos = posRef.current
    const id = doc && pos ? alignPosition(doc.blocks, pos) : null
    const n = id ? scroller.current?.querySelector<HTMLElement>(`[data-block="${CSS.escape(id)}"]`) : null
    if (n && scroller.current) scroller.current.scrollTop += n.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top + Math.min(pos!.offset, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey])

  // 跳转
  useEffect(() => {
    const j = props.jump
    if (!j || j.kind !== 'block' || !scroller.current) return
    const n = scroller.current.querySelector<HTMLElement>(`[data-block="${CSS.escape(j.blockId)}"]`)
    if (!n) return
    n.scrollIntoView({ block: 'start' })
    scroller.current.scrollTop -= 24
    n.classList.remove('landing')
    void n.offsetWidth
    n.classList.add('landing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jump?.nonce, doc])

  // 高亮、引文号、AI 重点：都用 CSS 自定义高亮，不改 DOM（React 管的节点不被打乱）
  const [hlTick, setHlTick] = useState(0)
  useEffect(() => {
    const t_ = setTimeout(() => setHlTick((x) => x + 1), 60)
    return () => clearTimeout(t_)
  }, [doc, props.anns, settings.display, tr.map, props.marks, sn.map, senseOn, props.terms])
  useEffect(() => {
    const el = article.current
    if (!el) return
    const ro = new ResizeObserver(() => setHlTick((x) => x + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])
  const refs = useMemo(() => (doc ? findReferences(doc.blocks) : []), [doc])
  const annRanges = useRef(new Map<string, Range>())
  const citeRanges = useRef<{ range: Range; inner: string }[]>([])
  const termRanges = useRef<{ range: Range; term: Term }[]>([])
  useEffect(() => {
    const root = scroller.current
    if (!root || !doc) return
    const groups: Record<string, Range[]> = {}
    const ranges = new Map<string, Range>()
    for (const a of props.anns) {
      if (a.mode !== 'reflow' || !a.blockId || a.start === null || a.end === null) continue
      const isTr = a.blockId.endsWith(':tr')
      const base = a.blockId.replace(/:tr$/, '')
      let blockId = base
      if (!doc.blocks.some((b) => b.id === base) && a.blockHash) blockId = doc.blocks.find((b) => b.hash === a.blockHash)?.id ?? base
      const el = root.querySelector(`[data-block="${CSS.escape(blockId)}"] ${isTr ? '.tr-text' : '.src'}`)
      if (!el) continue
      const r = rangeAt(el, a.start, a.end)
      if (!r) continue
      ranges.set(a.id, r)
      // 打了「看不懂」「有质疑」的只画标签的波浪线，不铺底色、不画批注线
      if (!a.label) {
        ;(groups[`${a.style === 'underline' ? 'ul' : 'hl'}-${a.color}`] ??= []).push(r)
        if (a.note) (groups[`hl-note-${a.color}`] ??= []).push(r)
      }
      if (a.label) (groups[`lb-${a.label}`] ??= []).push(r)
      if (props.hoverAnn === a.id) (groups['hl-hover'] ??= []).push(r)
    }
    annRanges.current = ranges
    // 正文里的引用号 [12]、[3]–[5]
    const cites: { range: Range; inner: string }[] = []
    if (refs.length)
      for (const el of root.querySelectorAll('.blk.paragraph .src, .blk.caption .src')) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.katex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
        let n: Node | null
        while ((n = w.nextNode())) {
          const t_ = (n as Text).data
          for (const m of t_.matchAll(CITE_RE)) {
            const r = document.createRange()
            r.setStart(n, m.index!)
            r.setEnd(n, m.index! + m[0].length)
            cites.push({ range: r, inner: m[1] })
          }
        }
      }
    citeRanges.current = cites
    // 术语：正文（原文那一边）里的每一处画虚线，记下是哪个术语，悬停时出解释
    const termHits: { range: Range; term: Term }[] = []
    const tre = props.terms ? termRegex(props.terms) : null
    if (tre && props.terms)
      for (const el of root.querySelectorAll('.blk .src')) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.katex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
        for (let n = w.nextNode(); n; n = w.nextNode())
          for (const m of (n as Text).data.matchAll(tre)) {
            const x = termOf(props.terms, m[0])
            if (!x) continue
            const r = document.createRange()
            r.setStart(n, m.index!)
            r.setEnd(n, m.index! + m[0].length)
            termHits.push({ range: r, term: x })
          }
      }
    termRanges.current = termHits
    groups['term'] = termHits.map((h) => h.range)
    groups['cite'] = cites.map((c) => c.range)
    if (cite) groups['cite-on'] = [cite.range]
    // AI 重点句
    const tagList: { top: number; left: number; label: string }[] = []
    const wantAlign: { en: string; zh: string }[] = []
    const art = article.current?.getBoundingClientRect()
    for (const m of props.marks ?? []) {
      const el = root.querySelector(`[data-block="${CSS.escape(m.blockId)}"] .src`)
      const r = el && findText(el, m.text)
      if (!r) continue
      ;(groups['ai-mark'] ??= []).push(r)
      // 译文里对应的那一句也圈上：用意群的那份对齐；这一段还没有对齐就先只圈原文，同时去要，到了再圈
      const blk = doc.blocks.find((x) => x.id === m.blockId)
      const trState = blk && tr.map[tr.keyOf(blk)]
      const trEl = root.querySelector(`[data-block="${CSS.escape(m.blockId)}"] .tr-text`)
      if (blk && trState && 'text' in trState && trEl) {
        const pair = { en: blk.md.trim(), zh: trState.text.trim() }
        const st = sn.map[sensesKey(pair.en, pair.zh)]
        const off = st && 'data' in st ? offsetsIn(el, r) : null
        if (st && 'data' in st && off) {
          const en = alignOffsets(pair.en, el.textContent ?? '')
          const zh = alignOffsets(pair.zh, trEl.textContent ?? '')
          for (const [a, b] of counterpart(st.data, 'en', toMd(en, off.start), toMd(en, off.end))) {
            const q = rangeAt(trEl, zh[a], zh[b])
            if (q && !q.collapsed) groups['ai-mark'].push(q)
          }
        } else if (!st) wantAlign.push(pair)
      }
      const first = r.getClientRects()[0]
      if (first && art) tagList.push({ top: first.top - art.top, left: el.getBoundingClientRect().left - art.left, label: MAJOR_NAME[m.type] })
    }
    setTags(tagList)
    if (wantAlign.length) void sn.request(wantAlign)
    const names = ['yellow', 'green', 'blue', 'red'].flatMap((c) => [`hl-${c}`, `ul-${c}`, `hl-note-${c}`]).concat('hl-hover', 'cite', 'cite-on', 'ai-mark', 'term', 'lb-confused', 'lb-doubt')
    for (const nm of names) CSS.highlights.set(nm, new Highlight(...(groups[nm] ?? [])))
    return () => names.forEach((nm) => CSS.highlights.delete(nm))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlTick, props.hoverAnn, cite])

  const preview = useNotePreview(
    useCallback(
      (x: number, y: number) => {
        const pos = document.caretPositionFromPoint?.(x, y)
        if (!pos) return null
        for (const [id, r] of annRanges.current) {
          const a = props.anns.find((n) => n.id === id)
          if ((a?.note || a?.label) && r.isPointInRange(pos.offsetNode, pos.offset)) {
            const rects = [...r.getClientRects()]
            const rect = rects.find((q) => y >= q.top && y <= q.bottom) ?? r.getBoundingClientRect()
            return { note: [a.label ? `【${LABEL_NAME[a.label]}】` : '', a.note].filter(Boolean).join('\n'), rect }
          }
        }
        for (const h of termRanges.current)
          if (h.range.isPointInRange(pos.offsetNode, pos.offset)) {
            const rect = [...h.range.getClientRects()].find((q) => y >= q.top && y <= q.bottom) ?? h.range.getBoundingClientRect()
            const head = h.term.zh && h.term.zh !== h.term.term ? `${h.term.term}　${h.term.zh}` : h.term.term
            return { note: h.term.explain ? `${head}\n${h.term.explain}` : head, rect }
          }
        return null
      },
      [props.anns]
    )
  )

  const onMouseUp = (e: React.MouseEvent): void => {
    if ((e.target as Element).closest('.hoverbar, .citepop')) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY)
      if (pos) {
        // 点在引用号上：出引文弹层，按点到的那个编号
        for (const c of citeRanges.current) {
          if (c.range.isPointInRange(pos.offsetNode, pos.offset)) {
            const ns = expandCite(c.inner)
            const rel = pos.offset - c.range.startOffset - 1
            const before = c.inner.slice(0, Math.max(0, rel))
            const idx = before.split(/,/).length - 1
            const exact = c.inner.split(/\s*,\s*/)[idx]
            const n = exact && /^\d+$/.test(exact.trim()) ? exact.trim() : ns[0]
            props.onSelect(null)
            setCite({ ns, n, range: c.range })
            return
          }
        }
        // 点在已有高亮上：出同一条工具条
        for (const [id, r] of annRanges.current) {
          if (r.isPointInRange(pos.offsetNode, pos.offset)) {
            const a = props.anns.find((x) => x.id === id)
            if (a) {
              props.onSelect({ text: a.text, paragraph: '', getRect: () => r.getBoundingClientRect(), target: null, existing: a })
              return
            }
          }
        }
      }
      setCite(null)
      setLink(null)
      props.onSelect(null)
      return
    }
    setCite(null)
    const range = sel.getRangeAt(0)
    const text = selectionText(sel)
    if (text.length < 2) return props.onSelect(null)
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as Element
    const blockEl = startEl.closest('[data-block]') as HTMLElement | null
    if (!blockEl) return props.onSelect(null)
    const block = doc?.blocks.find((b) => b.id === blockEl.dataset.block)
    if (!block) return props.onSelect(null)
    const inTr = !!startEl.closest('.tr')
    const root = blockEl.querySelector(inTr ? '.tr-text' : '.src')
    const off = root ? offsetsIn(root, range) : null
    setLink(off && block.translatable ? { blockId: block.id, inTr, start: off.start, end: off.end } : null)
    const r = range.cloneRange()
    props.onSelect({
      text,
      paragraph: block.md.replace(/!\[[^\]]*\]\([^)]*\)/g, ''),
      getRect: () => r.getBoundingClientRect(),
      target: off
        ? { mode: 'reflow', blockId: inTr ? `${block.id}:tr` : block.id, blockHash: block.hash, start: off.start, end: off.end, section: props.sections.get(block.id) ?? '' }
        : null
    })
  }

  // 图、表、公式悬停的按钮
  const blockAct = useEvent(async (b: Block, act: 'ai' | 'copy' | 'zoom') => {
    const i = doc!.blocks.indexOf(b)
    const cap = [doc!.blocks[i + 1], doc!.blocks[i - 1]].find((x) => x?.type === 'caption')
    const capText = cap ? plain(cap.md) : ''
    if (b.type === 'image') {
      const src = /!\[[^\]]*\]\((data:image[^)]+)\)/.exec(b.md)?.[1]
      if (act === 'zoom') setZoomed(imgSrc(b.id))
      if (!src) return
      if (act === 'ai') props.onAskImage(src, capText, t('解释这张图'))
      if (act === 'copy') {
        try {
          const blob = await (await fetch(src)).blob()
          const png = blob.type === 'image/png' ? blob : await toPng(src)
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
          toast(t('已复制图片'))
        } catch (e) {
          toast(t('复制失败：{0}', errText(e)))
        }
      }
    } else if (b.type === 'equation') {
      const latex = b.md.replace(/^\$\$\s*|\s*\$\$$/g, '')
      if (act === 'ai') props.onAsk(`$$${latex}$$`, t('解释这个公式：每个符号是什么意思，它在说什么'))
      if (act === 'copy') {
        void navigator.clipboard.writeText(latex)
        toast(t('已复制 LaTeX'))
      }
    } else if (b.type === 'table') {
      if (act === 'ai') props.onAsk(`${capText ? capText + '\n' : ''}${plain(b.md).slice(0, 3000)}`, t('解释这张表：看什么、结论是什么'))
      if (act === 'copy') {
        const el = scroller.current?.querySelector(`[data-block="${CSS.escape(b.id)}"] table`) as HTMLTableElement | null
        const tsv = el ? [...el.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()).join('\t')).join('\n') : plain(b.md)
        void navigator.clipboard.writeText(tsv)
        toast(t('已复制表格，能直接粘贴进表格软件'))
      }
    }
  })

  if (!doc)
    return (
      <ReflowStatus
        {...props}
        now={now}
        simpleBusy={simpleBusy}
        onSimple={async () => {
          setSimpleBusy(true)
          await props.onSimple()
          setSimpleBusy(false)
        }}
      />
    )

  return (
    <div className="reflow-scroller" ref={scroller} onScroll={onScroll} onMouseUp={onMouseUp} onMouseMove={preview.onMove} onMouseLeave={() => (preview.onLeave(), offHot())} onMouseOver={onOver}>
      {preview.node}
      <article ref={article} className={`reflow display-${settings.display} tr-${settings.trStyle}${side ? ' lay-side' : ''}`}>
        <h1 className="doc-title">{props.paper.title}</h1>
        <div className="doc-authors">
          {[authorsShort(props.paper.authors), [props.paper.venue, props.paper.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
        </div>
        {(doc.tier === 'flash' || doc.tier === 'simple') && (
          <div className="doc-tier">
            {doc.tier === 'flash' ? t('快速重排，公式是图片') : t('简单重排，只有文字')}
            {props.prog?.tier === 'basic' && props.prog.status === 'running' && (
              <>
                {' '}{t('· 精细重排进行中')}{props.prog.percent !== null ? ` ${props.prog.percent}%` : ''}
                <span className="spin spin-10" />
              </>
            )}
          </div>
        )}
        {tags.map((t_, i) => (
          <span key={i} className="aitag" style={{ top: t_.top, left: t_.left }}>
            {t_.label}
          </span>
        ))}
        {doc.blocks.map((b, i) =>
          i === 0 && b.type === 'heading' && b.level === 1 ? null : (
            <BlockView
              key={b.id}
              b={b}
              tr={b.translatable ? tr.map[tr.keyOf(b)] : undefined}
              display={settings.display}
              sense={senseOf(b)}
              side={side}
              zoomed={false}
              onAct={blockAct}
              onZoom={() => setZoomed(imgSrc(b.id))}
              onRetry={() => tr.retry(b)}
            />
          )
        )}
      </article>
      {zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}
      {cite && (
        <CitePop
          key={cite.n}
          ns={cite.ns}
          n={cite.n}
          range={cite.range}
          refs={refs}
          onN={(n) => setCite({ ...cite, n })}
          onClose={() => setCite(null)}
          onOpenPaper={props.onOpenPaper}
          onBlock={props.onBlock}
        />
      )}
    </div>
  )
}

async function toPng(src: string): Promise<Blob> {
  const img = new Image()
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('转不成 PNG')))), 'image/png'))
}

// 在渲染好的段落里找一句话（空白归一），返回它的 Range；整句找不到就按开头 60 个字找
function findText(el: Element, needle: string): Range | null {
  const map: [Text, number][] = []
  let s = ''
  let space = true
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.katex-mathml') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
  let n: Node | null
  while ((n = w.nextNode())) {
    const d = (n as Text).data
    for (let i = 0; i < d.length; i++) {
      if (/\s/.test(d[i])) {
        if (space) continue
        s += ' '
        space = true
      } else {
        s += d[i]
        space = false
      }
      map.push([n as Text, i])
    }
  }
  const want = needle.replace(/\s+/g, ' ').trim()
  let i = s.indexOf(want)
  let len = want.length
  if (i < 0) {
    const head = want.slice(0, 60)
    i = s.indexOf(head)
    if (i < 0) return null
    len = Math.min(want.length, s.length - i)
  }
  const a = map[i]
  const b = map[Math.min(i + len, map.length) - 1]
  const r = document.createRange()
  r.setStart(a[0], a[1])
  r.setEnd(b[0], b[1] + 1)
  return r
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// 点正文 [12] 出的弹层：参考文献条目、网上找到的这篇（摘要、DOI），已在文献库就能打开，不在能加进来
function CitePop(props: { ns: string[]; n: string; range: Range; refs: ReturnType<typeof findReferences>; onN: (n: string) => void; onClose: () => void; onOpenPaper: (id: string) => void; onBlock: (id: string) => void }) {
  const toast = useToast()
  const entry = props.refs.find((r) => r.n === props.n)
  const [hit, setHit] = useState<SearchHit | null | undefined>(undefined)
  const [mineId, setMineId] = useState<string | null>(null)
  const [adding, setAdding] = useState<'busy' | 'done' | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!entry) return setHit(null)
    void api
      .refsLookup(entry.text)
      .then(async (h) => {
        setHit(h)
        const mine = await api.listPapers()
        const want = norm(h?.title ?? entry.text)
        const p = mine.find((x) => (h?.doi && x.doi?.toLowerCase() === h.doi.toLowerCase()) || (norm(x.title).length > 12 && want.includes(norm(x.title).slice(0, 40))))
        setMineId(p?.id ?? null)
      })
      .catch(() => setHit(null))
  }, [entry])

  useLayoutEffect(() => {
    const r = props.range.getBoundingClientRect()
    const box = ref.current
    const host = box?.offsetParent?.getBoundingClientRect()
    if (!box || !host) return
    let left = r.left - host.left - 20
    left = Math.max(12, Math.min(left, host.width - box.offsetWidth - 12))
    let top = r.bottom - host.top + 8 + (box.offsetParent as HTMLElement).scrollTop
    if (r.bottom + box.offsetHeight + 16 > window.innerHeight) top = r.top - host.top - box.offsetHeight - 8 + (box.offsetParent as HTMLElement).scrollTop
    setPos((p) => (p && Math.abs(p.left - left) < 1 && Math.abs(p.top - top) < 1 ? p : { left, top }))
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const add = async (): Promise<void> => {
    if (!hit) return
    setAdding('busy')
    try {
      const r = await api.scholarAdd(hit)
      if (r.status === 'failed') throw new Error(r.error)
      setMineId(r.paper.id)
      setAdding('done')
      toast(r.linkOnly ? t('没有开放下载的 PDF，存成了仅链接') : t('已加入文献库'))
    } catch (e) {
      setAdding(null)
      toast(t('加入失败：{0}', errText(e)))
    }
  }

  return (
    <div ref={ref} className="citepop" style={pos ?? { left: -9999, top: -9999 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="cp-h">
        <span className="hint">{t('参考文献')}</span>
        {props.ns.length > 1 ? (
          <span className="cp-ns">
            {props.ns.slice(0, 12).map((n) => (
              <button key={n} className={'cp-n num' + (n === props.n ? ' on' : '')} onClick={() => props.onN(n)}>
                {n}
              </button>
            ))}
          </span>
        ) : (
          <span className="hint num">[{props.n}]</span>
        )}
      </div>
      {!entry ? (
        <div className="hint" style={{ marginTop: 6 }}>
          {t('参考文献表里没找到第 {0} 条。', props.n)}
        </div>
      ) : (
        <>
          <div className="cp-t">{hit?.title ?? entry.text}</div>
          {hit && <div className="hint">{[authorsShort(hit.authors), hit.venue, hit.year].filter(Boolean).join(' · ')}</div>}
          {hit === undefined && <Skeleton lines={[90, 60]} />}
          {hit && (hit.tldr || hit.abstract) && <div className="cp-abs">{hit.tldr || hit.abstract}</div>}
          {hit === null && <div className="hint" style={{ marginTop: 6 }}>{t('网上没找到这篇的信息，上面是参考文献原文。')}</div>}
          <div className="cp-ft">
            {mineId ? (
              <span className="tag ok">
                <Check size={12} />
                {t('已在文献库')}
              </span>
            ) : (
              hit && (
                <button className="btn sm" disabled={adding !== null} onClick={() => void add()}>
                  {adding === 'busy' ? <span className="spin spin-12" /> : <Plus size={14} />}
                  {t('加入文献库')}
                </button>
              )
            )}
            <span className="spacer" />
            <button className="btn sm ghost" title={t('跳到参考文献表里这一条')} onClick={() => (props.onBlock(entry.blockId), props.onClose())}>
              <CornerDownRight size={14} />
              {t('参考文献')}
            </button>
            {(hit?.doi || hit?.url) && (
              <a className="btn sm" href={hit.doi ? `https://doi.org/${hit.doi}` : hit.url!}>
                <ExternalLink size={14} />
                {hit.doi ? 'DOI' : t('网页')}
              </a>
            )}
            {mineId && (
              <button className="btn sm" onClick={() => props.onOpenPaper(mineId)}>
                <BookOpen size={14} />
                {t('打开')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ReflowStatus(p: Parameters<typeof ReflowView>[0] & { now: number; simpleBusy: boolean; onSimple: () => void }) {
  const r = p.paper.reflow
  const failed = (r.flash === 'failed' && r.basic !== 'running') || p.prog?.status === 'failed'
  const err = p.prog?.error ?? r.error ?? ''
  if (failed && !(p.prog?.status === 'running'))
    return (
      <div className="reflow-status">
        <div className="status-title">
          <span className="dot sm err" />
          {t('重排失败：')}{err || t('原因未知')}
        </div>
        <div className="status-actions">
          <button className="btn" onClick={p.onRetry}>
            {t('重试')}
          </button>
          <button className="btn" onClick={p.onSimple} disabled={p.simpleBusy}>
            {p.simpleBusy ? t('正在重排…') : t('用简单方式重排')}
          </button>
        </div>
      </div>
    )
  const running = p.prog?.status === 'running' ? p.prog : null
  const started = running?.startedAt ?? r.startedAt
  return (
    <div className="reflow-status">
      <div className="status-title">{running || r.flash === 'running' ? t('正在重排这篇论文') : t('排队等待重排')}</div>
      <div className="status-sub num">{started ? t('已用 {0}', fmtElapsed(p.now - started)) : t('前面还有论文在重排')}</div>
      {(running?.logLine || r.logLine) && <div className="status-log">{running?.logLine || r.logLine}</div>}
      {running?.percent !== null && running?.percent !== undefined && (
        <span className="bar" style={{ width: 240 }}>
          <i style={{ width: `${running.percent}%` }} />
        </span>
      )}
      <div className="status-actions">
        <button className="btn" onClick={p.onReadPdf}>
          {t('先读原文')}
        </button>
      </div>
    </div>
  )
}

function HoverBar(p: { b: Block; onAct: (b: Block, a: 'ai' | 'copy' | 'zoom') => void; zoomed?: boolean }) {
  const eq = p.b.type === 'equation'
  return (
    <div className="hoverbar" onMouseUp={(e) => e.stopPropagation()}>
      <button className="hb ai" onClick={() => p.onAct(p.b, 'ai')}>
        <MessageCircleQuestion size={14} />
        {t('AI 解释')}
      </button>
      <button className="hb" onClick={() => p.onAct(p.b, 'copy')}>
        <Copy size={14} />
        {eq ? t('复制 LaTeX') : t('复制')}
      </button>
      {p.b.type === 'image' && (
        <button className="hb" onClick={() => p.onAct(p.b, 'zoom')}>
          {p.zoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {p.zoomed ? t('还原') : t('放大')}
        </button>
      )}
    </div>
  )
}

const BlockView = memo(function BlockView(p: { b: Block; tr: TrState | undefined; display: string; sense?: SenseSentence[]; side?: boolean; zoomed: boolean; onAct: (b: Block, a: 'ai' | 'copy' | 'zoom') => void; onZoom: () => void; onRetry: () => void }) {
  const { b } = p
  const showSrc = !b.translatable || p.display !== 'tr'
  const showTr = b.translatable && p.display !== 'src'
  if (b.type === 'details') return null
  if (b.type === 'equation')
    return (
      <div className="blk eq" data-block={b.id}>
        <Markdown text={b.md} className="src" />
        <HoverBar b={b} onAct={p.onAct} />
      </div>
    )
  if (b.type === 'image')
    return (
      <div className={'blk img' + (p.zoomed ? ' zoomed' : '')} data-block={b.id}>
        <span className="plate" onClick={p.onZoom}>
          <Markdown text={b.md} className="src" raw={false} />
        </span>
        <HoverBar b={b} onAct={p.onAct} zoomed={p.zoomed} />
      </div>
    )
  if (b.type === 'table')
    return (
      <div className="blk table" data-block={b.id}>
        <div className="src">
          <Markdown text={b.md} />
        </div>
        <HoverBar b={b} onAct={p.onAct} />
      </div>
    )
  // 意群显示：一句原文配一句译文。.src 和 .tr-text 里的文字一个字不变（高亮按字符偏移存，开关意群不能错位），
  // 只是按句包成 .sen；这两个容器不占盒子（display: contents），各句按行号摆进同一个网格里交错排
  if (p.sense && p.tr && 'text' in p.tr) {
    const src = b.md.trim()
    const trText = p.tr.text.trim()
    return (
      <div className={`blk ${b.type} senses`} data-block={b.id}>
        <div className="src" lang="en">
          {p.sense.map((s, i) => (
            <span key={i} className="sen" style={{ gridRow: p.side ? i + 1 : 2 * i + 1, gridColumn: 1 }}>
              <Pieces text={src} range={s.en} marks={s.chunks.map((c, k) => ({ span: c.en, k: c.zh.length ? k : null }))} sen={i} />
            </span>
          ))}
        </div>
        <div className="tr" lang="zh-Hans">
          <div className="tr-text">
            {p.sense.map((s, i) => (
              <span key={i} className="sen" style={{ gridRow: p.side ? i + 1 : 2 * i + 2, gridColumn: p.side ? 2 : 1 }}>
                <Pieces text={trText} range={s.zh} marks={s.chunks.flatMap((c, k) => c.zh.map((z) => ({ span: z, k })))} sen={i} />
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }
  const Tag = b.type === 'heading' ? (`h${Math.min(4, (b.level ?? 2) + 1)}` as 'h2') : 'div'
  return (
    <div className={`blk ${b.type}${b.type === 'heading' ? ` lv${b.level}` : ''}`} data-block={b.id}>
      {showSrc && (
        <Tag className="src" lang="en">
          <Markdown text={b.md} inline={b.type === 'heading'} />
        </Tag>
      )}
      {showTr && <TrView tr={p.tr} onRetry={p.onRetry} heading={b.type === 'heading'} />}
    </div>
  )
})

// 一句里的各个片段：意群包一层带颜色号的 span，意群之间的字原样放
function Pieces(p: { text: string; range: Span; marks: { span: Span; k: number | null }[]; sen: number }) {
  return cut(p.text, p.range, p.marks).map((x, i) =>
    x.k === null ? (
      <Piece key={i} text={x.text} />
    ) : (
      <span key={i} className="sg" data-c={x.k % 4} data-k={`${p.sen}-${x.k}`}>
        <Piece text={x.text} />
      </span>
    )
  )
}
// 和整段一起画时一样的文字：前后的空白原样留着（Markdown 会吃掉），中间有公式、强调这些记号的才交给 Markdown
const softBreak = (s: string): string => s.replace(/[ \t]*\n[ \t]*/g, '\n')
function Piece(p: { text: string }) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p.text)!
  // 单独拿出来画时，开头的「1) 」「- 」会被当成列表：转义掉
  const core = m[2].replace(/^(\d+)([.)]\s)/, '$1\\$2').replace(/^([-+*>#])(\s)/, '\\$1$2')
  return (
    <>
      {softBreak(m[1])}
      {needsMd(m[2]) ? <Markdown text={core} inline /> : softBreak(m[2])}
      {softBreak(m[3])}
    </>
  )
}

function TrView(p: { tr: TrState | undefined; onRetry: () => void; heading: boolean }) {
  const s = p.tr
  if (!s || 'pending' in s)
    return (
      <div className="tr tr-skel">
        <Skeleton lines={p.heading ? [40] : [100, 70]} />
      </div>
    )
  if ('error' in s)
    return (
      <div className="tr tr-err">
        <span className="dot sm err" />
        <span>{t('翻译失败：')}{s.error}</span>
        <button className="text-btn" onClick={p.onRetry}>
          {t('重试')}
        </button>
      </div>
    )
  return (
    <div className="tr" lang="zh-Hans">
      <Markdown text={s.text} inline={p.heading} className="tr-text" />
    </div>
  )
}
