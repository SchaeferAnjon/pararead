import { ALargeSmall, BookMarked, Check, Undo2, ChevronDown, Columns2, Rows2, ChevronLeft, ChevronUp, Cloud, FileOutput, GripVertical, Highlighter, Info, Languages, Minimize2, PanelLeft, PanelRight, PictureInPicture2, RefreshCw, ScanText, Search, SquarePen, X, Zap, Eraser, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as PdfJs from 'pdfjs-dist'
import { sectionsOf, squash } from '@shared/chunk'
import type { Annotation, Block, ChatBox, HlColor, Idea, MajorPoint, Paper, ReadMode, ReadPosition, ReflowDoc, SettingsView, Tier, Term, Ink, AnnLabel } from '@shared/types'
import { recentTopics } from '@shared/ideas'
import { pageOfText } from '@shared/refs'
import { kindOfColor } from '@shared/cnLink'
import type { IdeaDraft } from './IdeaCard'
import { api, errText, type CnLinkOf, type HlKind, type OpenAt, type ReflowProgress } from '../api'
import { DEFAULT_KINDS } from '@cn/format'
import { showMenu } from '../lib/menu'
import { loadPdf } from '../lib/pdf'
import { useTranslations } from '../lib/translations'
import { Segmented, Switch, useDebounced, useEvent, useToast } from '../lib/ui'
import type { TrStyle } from '@shared/trStyles'
import { TrStyleTiles } from './TrStyles'
import { ChatPanel, type Attach } from './ChatPanel'
import { QBadge, QuestionsPane, type WalkRequest } from './QuestionsPane'
import { ExportDialog } from './ExportDialog'
import { GlanceView } from './GlanceView'
import { LeftPane, type LeftTab } from './LeftPane'
import { PaperInfo } from './PaperInfo'
import { INK_COLORS, INK_WIDTH, PdfView, type InkTool, type PageSide } from './PdfView'
import { costLine, PendingCard, TrBanner } from './LayoutTrCards'
import { cropPage, useBabelInstall, useLayoutTr } from '../lib/layoutTr'
import { doneCount } from '@shared/layoutTr'
import { ReflowView } from './ReflowView'
import { RegionEditor } from './RegionEditor'
import { SelectionLayer, type SelInfo } from './Selection'
import { ShotLayer } from './ShotLayer'
import { t } from '@shared/i18n'
import { BgParse } from './BgParse'
import type { BackHandle } from './BackPill'

export type Jump = { nonce: number; kind: 'block'; blockId: string; annId?: string } | { nonce: number; kind: 'page'; page: number; annId?: string; frac?: number }
export type Density = 'less' | 'default' | 'more'

let jumpSeq = 1
/** 原文、对照、译文三种看法都是 PDF 页（pdf.js），跳页、框选、缩放一样 */
const pdfLike = (m: ReadMode | null): boolean => m === 'pdf' || m === 'dual' || m === 'mono'
// 对照里一页至少这么宽，窄了自动换成上下排
const DUAL_MIN_PAGE = 480
const TIER_NAME: Record<Tier, string> = { flash: t('快速'), basic: t('精细'), simple: t('简单'), edited: t('调整过') }
// 正文那一列最少这么宽：窗口放不下时收侧栏，不压正文
const MID_MIN = 480
// 正文列比这个窄，标题栏的文字按钮只留图标
const COMPACT_BAR = 700

export function Reader(props: {
  paperId: string
  initialMode?: ReadMode
  initialAnn?: string
  initialAt?: OpenAt
  initialIdea?: string
  /** 从画布笔记哪个文件夹首页来的（深链 back=）：标题栏多一颗「回画布笔记」 */
  back?: { root: string; folder: string } | null
  settings: SettingsView
  onBack: () => void
  onOpenPaper: (id: string) => void
  onOpenIdeas: (ideaId: string) => void
}) {
  const { paperId, settings } = props
  const toast = useToast()
  const [paper, setPaper] = useState<Paper | null>(null)
  const [mode, setMode] = useState<ReadMode | null>(null)
  const [doc, setDoc] = useState<ReflowDoc | null>(null)
  const [prog, setProg] = useState<ReflowProgress | null>(null)
  const [anns, setAnns] = useState<Annotation[]>([])
  // 划线的含义（和画布笔记同一份，库里 .canvas-notes/划线颜色.json）；这篇在画布笔记库里时笔记在哪
  const [kinds, setKinds] = useState<HlKind[]>(DEFAULT_KINDS)
  const [cnLink, setCnLink] = useState<CnLinkOf | null>(null)
  // 灵感库里这篇的句子（正文左边的小灯泡）；收灵感的小卡里列的主题是全库最近用过的
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [ideaTopics, setIdeaTopics] = useState<string[]>([])
  const [focusIdea, setFocusIdea] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PdfJs.PDFDocumentProxy | null>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)
  const [pageTexts, setPageTexts] = useState<string[]>([])
  const [leftTab, setLeftTab] = useState<LeftTab>('toc')
  const [leftCollapsed, setLeftCollapsed] = useState(settings.leftCollapsed)
  const [rightCollapsed, setRightCollapsed] = useState(settings.rightCollapsed)
  const [leftW, setLeftW] = useState(settings.leftW)
  const [rightW, setRightW] = useState(settings.rightW)
  const [jump, setJump] = useState<Jump | null>(null)
  const backHandle: BackHandle = useRef(null)
  const [sel, setSel] = useState<SelInfo | null>(null)
  const [attach, setAttach] = useState<Attach | null>(null)
  const [focusChat, setFocusChat] = useState(0)
  const [boxMode, setBoxMode] = useState(false)
  // 原文模式的手写：拿着的是笔（哪个颜色）还是橡皮，没拿是 null；这篇的笔画；这次画的（⌘Z 撤销用）
  const [inkTool, setInkTool] = useState<InkTool | null>(null)
  const [inks, setInks] = useState<Ink[]>([])
  const myInks = useRef<string[]>([])
  const lastInk = useRef(INK_COLORS[0])
  useEffect(() => {
    if (!inkTool) return
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setInkTool(null)
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && myInks.current.length) {
        e.preventDefault()
        const id = myInks.current.pop()!
        setInks((l) => l.filter((k) => k.id !== id))
        void api.inkDelete(id)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [inkTool])
  const [shot, setShot] = useState<{ page: number; frac: [number, number, number, number]; side?: PageSide } | null>(null)
  // 对照看法里左栏默认收起，把宽度让给两页（左上角按钮能开，不记进设置）
  const [leftInDual, setLeftInDual] = useState(false)
  // 「翻成对照」那张卡点了「以后再说」
  const [trLater, setTrLater] = useState(false)
  // 打开一篇没换过看法的：「论文看重排、课件看对照」要等 PDF 打开看页面横竖再定
  const pendingOpen = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [aaOpen, setAaOpen] = useState(false)
  const [trPreview, setTrPreview] = useState<TrStyle | null>(null)
  const [trAll, setTrAll] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [clearSignal, setClearSignal] = useState(0)
  const [regenSignal, setRegenSignal] = useState(0)
  const [curBlock, setCurBlock] = useState<string | null>(null)
  const [curPage, setCurPage] = useState(1)
  const [hoverAnn, setHoverAnn] = useState<string | null>(null)
  // 右栏：AI 问答 / 疑问（打了标签的地方，过一遍时正文跟着走、那一处加深）
  const [rightTab, setRightTab] = useState<'ai' | 'q'>('ai')
  const [walkReq, setWalkReq] = useState<WalkRequest | null>(null)
  const [walkFocus, setWalkFocus] = useState<string | null>(null)
  const [keysOn, setKeysOn] = useState(false)
  const [keys, setKeys] = useState<MajorPoint[] | null>(null)
  // 从左栏「重点」点进来的那一条：正文里用它的类别色标出来（「AI 重点高亮」没开时也标这一条）
  const [focusKey, setFocusKey] = useState<MajorPoint | null>(null)
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [termsBusy, setTermsBusy] = useState(false)
  const termHop = useRef<{ key: string; i: number }>({ key: '', i: -1 })
  const [keysBusy, setKeysBusy] = useState(false)
  const [density, setDensity] = useState<Density>('default')
  const [dialog, setDialog] = useState<'info' | 'export' | 'region' | null>(null)
  const [floatPos, setFloatPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 24 })
  const posRef = useRef<ReadPosition>({})
  const midRef = useRef<HTMLDivElement>(null)
  const tr = useTranslations(paperId, settings.targetLang)
  const babel = useBabelInstall()
  const lt = useLayoutTr(paperId, pdf?.numPages ?? 0)
  const floating = settings.chatFloat

  // 载入
  useEffect(() => {
    let alive = true
    void (async () => {
      const p = await api.getPaper(paperId)
      if (!p || !alive) return
      setPaper(p)
      posRef.current = { ...(p.lastPosition ?? {}) }
      setZoom(p.lastPosition?.zoom ?? 1)
      const d = await api.getReflow(paperId)
      if (!alive) return
      setDoc(d)
      // 没换过看法的一篇：照「设置 › 翻译 › 打开 PDF 时」（默认对照）；扫描件看原文（保版面翻译对扫描件不准）；换过的记住上次的
      // 画布笔记库里的一篇：先和配对笔记对一遍（那边划的、删的），读到哪那边更晚（最后是画布笔记记的）就翻到那里
      const link = p.cn ? await api.cnLink(paperId) : null
      if (!alive) return
      setCnLink(link)
      setKinds(await api.cnKinds(paperId))
      if (link) {
        await api.cnWatch(paperId).catch((e) => toast(t('读画布笔记里的笔记没成：{0}', errText(e))))
        const r = props.initialAt ? null : await api.cnReadAt(paperId)
        if (r && r.by !== 'pararead') cameAt.current = { page: r.page, blockId: r.blockId }
      }
      if (!alive) return
      const want = props.initialMode ?? p.lastMode ?? (p.scanned || settings.openView === 'pdf' ? 'pdf' : settings.openView === 'dual' ? 'dual' : null)
      if (want) setMode(want)
      else pendingOpen.current = true
      setAnns(await api.annList(paperId))
      setIdeas(await api.ideaList(paperId))
      setInks(await api.inkList(paperId))
      setProg(await api.reflowProgress(paperId))
      void api.updatePaper(paperId, { lastOpened: Date.now() })
      api.pageTexts(paperId).then((t_) => alive && setPageTexts(t_))
    })()
    loadPdf(paperId)
      .then((d) => alive && setPdf(d))
      .catch((e) => alive && setPdfErr(errText(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])
  // 后台解析：开着的这篇排最前、它的快速解析不因为你在滚动而停
  useEffect(() => {
    void api.bgOpen(paperId)
    return () => void api.bgOpen(null)
  }, [paperId])
  // 画布笔记那边改了这篇的笔记（划了、换了含义、删了）：重读；关这篇时笔记属性「读到」「读了」跟上
  useEffect(() => {
    const off = api.onCnAnnChanged((id) => {
      if (id === paperId) void api.annList(paperId).then(setAnns)
    })
    return () => {
      off()
      void api.cnClosed(paperId)
    }
  }, [paperId])

  useEffect(() => () => void pdf?.loadingTask.destroy(), [pdf])

  // 「论文看重排、课件看对照」：第一页横版是课件
  useEffect(() => {
    if (!pendingOpen.current || !paper) return
    if (pdfErr) {
      pendingOpen.current = false
      setMode(doc ? 'reflow' : 'pdf')
      return
    }
    if (!pdf) return
    void pdf.getPage(1).then((pg) => {
      if (!pendingOpen.current) return
      pendingOpen.current = false
      const vp = pg.getViewport({ scale: 1 })
      setMode(vp.width > vp.height ? 'dual' : doc ? 'reflow' : 'pdf')
    })
  }, [pdf, pdfErr, paper, doc])

  // 阅读时长：窗口在前台、这篇开着，每分钟记一次
  useEffect(() => {
    let last = Date.now()
    const flush = (): void => {
      const now = Date.now()
      if (document.visibilityState === 'visible' && document.hasFocus()) void api.readTime(paperId, now - last)
      last = now
    }
    const t_ = setInterval(flush, 60_000)
    return () => {
      clearInterval(t_)
      flush()
    }
  }, [paperId])

  // 重排进度和完成
  const reloadDoc = useEvent(async (tier: string) => {
    const d = await api.getReflow(paperId)
    setDoc(d)
    setPaper(await api.getPaper(paperId))
    if (mode === 'pdf' && tier === 'flash') toast(t('重排好了'), { label: t('切到重排'), run: () => switchMode('reflow') })
    if (mode === null && !pendingOpen.current) setMode('reflow')
  })
  useEffect(() => {
    const offs = [
      api.onReflowProgress((p) => p.paperId === paperId && setProg(p)),
      api.onReflowDone((p) => p.paperId === paperId && void reloadDoc(p.tier)),
      api.onReflowFailed((p) => {
        if (p.paperId !== paperId) return
        void api.getPaper(paperId).then((x) => {
          setPaper(x)
          // 手动选的那一档没排成：说清楚，还在用的是哪一档，能重试
          if (x?.engine === p.tier) toast(t('「{0}」重排没成：{1}。现在还是「{2}」', TIER_NAME[p.tier as Tier], p.error ?? '', TIER_NAME[(doc?.tier ?? 'flash') as Tier]), { label: t('重试'), run: () => void api.setEngine(paperId, p.tier as Tier) })
        })
      })
    ]
    return () => offs.forEach((f) => f())
  }, [paperId, reloadDoc])

  const savePos = useDebounced(() => {
    void api.updatePaper(paperId, { lastPosition: posRef.current })
  }, 800)
  const saveProgress = useDebounced((v: number) => {
    setPaper((p) => {
      if (!p) return p
      const next = Math.max(p.progress >= 1 ? 1 : 0, Math.min(1, v))
      if (Math.abs(next - p.progress) > 0.01) void api.updatePaper(paperId, { progress: next >= 0.98 ? 1 : next })
      return { ...p, progress: next }
    })
  }, 1000)
  const onPosition = useCallback(
    (p: Partial<ReadPosition>, progress?: number) => {
      posRef.current = { ...posRef.current, ...p }
      savePos()
      if (progress !== undefined) saveProgress(progress)
    },
    [savePos, saveProgress]
  )

  const switchMode = useEvent((m: ReadMode) => {
    setSel(null)
    setShot(null)
    setMode(m)
    setBoxMode(false)
    setInkTool(null)
    void api.updatePaper(paperId, { lastMode: m })
  })

  // 重排里的上下 / 左右对照（2026-11-23 起并进「重排」一格，旁边两格换排法）：点了就是要看双语
  const pickReflowLayout = useEvent((v: 'stack' | 'side') => {
    if (settings.trLayout !== v || settings.display !== 'both') void api.setSettings({ trLayout: v, display: 'both' })
    if (mode !== 'reflow') switchMode('reflow')
  })
  // ⌘4 进重排（按上次的排法），已经在重排里再按一次在上下和左右之间换
  const reflowCmd = useEvent(() => (mode === 'reflow' ? pickReflowLayout(settings.trLayout === 'side' ? 'stack' : 'side') : switchMode('reflow')))

  // 对照、译文看法：告诉主进程在看第几页（先翻这几页，后面边看边翻）；离开这篇不再往后翻
  const trFocus = useDebounced((page: number) => {
    if (pdf && (mode === 'dual' || mode === 'mono')) void api.layoutTrFocus(paperId, page, pdf.numPages)
  }, 400)
  useEffect(() => {
    if (pdf && (mode === 'dual' || mode === 'mono')) void api.layoutTrFocus(paperId, posRef.current.page ?? curPage, pdf.numPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pdf, paperId, babel?.phase])
  useEffect(() => () => void api.layoutTrBlur(paperId), [paperId])

  const sections = useMemo(() => (doc ? sectionsOf(doc.blocks) : new Map<string, string>()), [doc])
  const headings = useMemo(() => (doc ? doc.blocks.filter((b) => b.type === 'heading') : []), [doc])

  // 目录里的译名：标题一次全翻，不等滚到
  useEffect(() => {
    if (settings.display !== 'src' && headings.length) void tr.request(headings.filter((h) => h.translatable))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headings, settings.display])

  // 标题所在页：在每页文字里找标题，给原文模式的目录跳转和笔记分组用
  const headingPages = useMemo(() => {
    const sq = (s: string): string => s.replace(/<[^>]+>|\$[^$]*\$/g, '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
    const pages = pageTexts.map(sq)
    const out = new Map<string, number>()
    let from = 0
    for (const h of headings) {
      const n = sq(h.md).slice(0, 30)
      if (n.length < 3) continue
      for (let i = from; i < pages.length; i++)
        if (pages[i].includes(n)) {
          out.set(h.id, i + 1)
          from = i
          break
        }
    }
    return out
  }, [pageTexts, headings])

  const sectionForPage = useCallback(
    (page: number | null): string => {
      if (!page) return ''
      let cur = ''
      for (const h of headings) {
        const hp = headingPages.get(h.id)
        if (hp && hp <= page) cur = h.md
      }
      return cur
    },
    [headings, headingPages]
  )

  // 高亮
  const createAnn = useEvent(async (info: SelInfo, color: HlColor, note: string = '', style: Annotation['style'] = 'highlight', label: AnnLabel | null = null, kind?: string): Promise<Annotation | null> => {
    const t_ = info.target
    if (!t_) return null
    const now = Date.now()
    const a: Annotation = {
      id: crypto.randomUUID().slice(0, 12),
      paperId,
      mode: t_.mode,
      color,
      style,
      label,
      kind: kind ?? kindOfColor(kinds, color),
      text: info.text,
      note,
      page: t_.mode === 'pdf' ? t_.page : null,
      rects: t_.mode === 'pdf' ? t_.rects : null,
      ...(t_.mode === 'pdf' && t_.side === 'tr' ? { side: 'tr' as const } : {}),
      blockId: t_.mode === 'reflow' ? t_.blockId : null,
      blockHash: t_.mode === 'reflow' ? t_.blockHash : null,
      start: t_.mode === 'reflow' ? t_.start : null,
      end: t_.mode === 'reflow' ? t_.end : null,
      section: t_.mode === 'reflow' ? t_.section : sectionForPage(t_.page),
      createdAt: now,
      updatedAt: now
    }
    // 对照模式里做的标注，主进程会按这几个字去原文里找它在第几页，带着页码回来；画布笔记库里的一篇写进笔记，写不进去报错
    try {
      a.page = (await api.annSave(a)) ?? a.page
    } catch (e) {
      toast(errText(e))
      return null
    }
    setAnns((l) => [...l, a])
    if (cnLink) void api.annList(paperId).then(setAnns)
    void api.setSettings({ lastColor: color })
    window.getSelection()?.removeAllRanges()
    return a
  })
  const updateAnn = useEvent(async (a: Annotation) => {
    const n = { ...a, updatedAt: Date.now() }
    try {
      await api.annSave(n)
    } catch (e) {
      toast(errText(e))
      return
    }
    setAnns((l) => l.map((x) => (x.id === a.id ? n : x)))
    if (cnLink) void api.annList(paperId).then(setAnns)
  })
  // 对照模式里给公式、图、表整块标记（用颜色框住）：没标过就新建，换颜色就改，color 为 null 是去掉
  const markBlock = useEvent(async (b: Block, text: string, color: HlColor | null) => {
    const cur = anns.find((a) => a.style === 'box' && a.blockId === b.id)
    if (cur && !color) return void deleteAnn(cur)
    if (cur && color) return void updateAnn({ ...cur, color, updatedAt: Date.now() })
    if (!color) return
    await createAnn({ text, paragraph: text, getRect: () => null, target: { mode: 'reflow', blockId: b.id, blockHash: b.hash, start: null as unknown as number, end: null as unknown as number, section: sections.get(b.id) ?? '' } }, color, '', 'box')
  })
  const deleteAnn = useEvent(async (a: Annotation) => {
    try {
      await api.annDelete(a.id)
    } catch (e) {
      toast(errText(e))
      return
    }
    setAnns((l) => l.filter((x) => x.id !== a.id))
    toast(a.style === 'box' ? t('已去掉标记') : t('已删除高亮'), {
      label: t('撤销'),
      run: () => {
        void api.annSave({ ...a, hl: null }).then(() => (cnLink ? void api.annList(paperId).then(setAnns) : setAnns((l) => [...l, a])))
      }
    })
  })

  // 灵感：别的地方（灵感库页、另一台电脑同步来）改了就重读；主题列表跟着全库走
  useEffect(() => {
    const load = (): void => {
      void api.ideaList(paperId).then(setIdeas)
      void api.ideaAll().then((l) => setIdeaTopics(recentTopics(l, 12)))
    }
    load()
    return api.onIdeasChanged(load)
  }, [paperId])
  const createIdea = useEvent(async (info: SelInfo, d: IdeaDraft) => {
    const t_ = info.target
    const ex = info.existing
    const now = Date.now()
    // 点在已有标注上收的：位置照那条标注
    const loc = t_
      ? t_.mode === 'pdf'
        ? { mode: 'pdf' as const, page: t_.page, rects: t_.rects, blockId: null, blockHash: null, start: null, end: null, section: sectionForPage(t_.page) }
        : { mode: 'reflow' as const, page: null, rects: null, blockId: t_.blockId, blockHash: t_.blockHash, start: t_.start, end: t_.end, section: t_.section }
      : ex
        ? { mode: ex.mode, page: ex.page, rects: ex.rects, blockId: ex.blockId, blockHash: ex.blockHash, start: ex.start, end: ex.end, section: ex.section }
        : null
    if (!loc) return
    const i: Idea = { id: crypto.randomUUID().slice(0, 12), paperId, text: info.text, ...loc, use: d.use, topics: d.topics, how: d.how, paraphrase: null, createdAt: now, updatedAt: now }
    const saved = await api.ideaSave(i)
    setIdeas((l) => [...l.filter((x) => x.id !== saved.id), saved])
    if (d.how !== settings.ideaHow) void api.setSettings({ ideaHow: d.how })
    window.getSelection()?.removeAllRanges()
    toast(d.topics.length ? t('收进灵感库 · {0}', d.topics.join('、')) : t('收进灵感库'), { label: t('打开灵感库'), run: () => props.onOpenIdeas(saved.id) })
  })
  const removeIdea = useEvent(async (i: Idea) => {
    await api.ideaDelete(i.id)
    setIdeas((l) => l.filter((x) => x.id !== i.id))
    toast(t('已从灵感库拿掉'), { label: t('撤销'), run: () => void api.ideaSave(i).then((x) => setIdeas((l) => [...l, x])) })
  })
  const goIdea = useEvent((i: Idea) => {
    if (i.mode === 'reflow' && i.blockId) {
      if (mode !== 'reflow') switchMode('reflow')
      setTimeout(() => setJump({ nonce: jumpSeq++, kind: 'block', blockId: i.blockId! }), mode === 'reflow' ? 0 : 60)
    } else if (i.page) {
      if (!pdfLike(mode)) switchMode('pdf')
      setTimeout(() => setJump({ nonce: jumpSeq++, kind: 'page', page: i.page!, frac: i.rects?.[0]?.[1] }), pdfLike(mode) ? 0 : 60)
    }
    setFocusIdea(i.id)
    setTimeout(() => setFocusIdea((x) => (x === i.id ? null : x)), 2600)
  })
  // 从灵感库点「回到原处」进来的：灵感读到了以后跳过去，左边那个灯泡和那一句亮一下
  const cameIdea = useRef(props.initialIdea)
  useEffect(() => {
    const i = cameIdea.current && paper && mode ? ideas.find((x) => x.id === cameIdea.current) : undefined
    if (!i) return
    cameIdea.current = undefined
    const t_ = setTimeout(() => goIdea(i), 400)
    return () => clearTimeout(t_)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas, paper, mode])

  // 讲解、状态在主进程存好了推过来：换掉手里那条
  useEffect(
    () =>
      api.onExplainSaved((a) => {
        if (a.paperId === paperId) setAnns((l) => l.map((x) => (x.id === a.id ? a : x)))
      }),
    [paperId]
  )
  const openQuestions = useEvent((req: Omit<WalkRequest, 'nonce'> | null) => {
    setRightTab('q')
    if (rightCollapsed) {
      setRightCollapsed(false)
      void api.setSettings({ rightCollapsed: false })
    }
    if (req) setWalkReq({ ...req, nonce: jumpSeq++ })
  })
  // 讲解里「这篇里」「看原文」：按摘的那一小段找到正文里的段落跳过去
  const goQuote = useEvent((quote: string) => {
    const n = squash(quote).slice(0, 40)
    const b = n.length >= 8 ? doc?.blocks.find((x) => x.type !== 'heading' && squash(x.md).includes(n)) : undefined
    if (b) goBlock(b.id)
    else toast(t('没在正文里找到这一处'))
  })
  // 过一遍时正文换了档位（快速换精细）：重新滚到正在讲的那一处
  useEffect(() => {
    const a = walkFocus ? anns.find((x) => x.id === walkFocus) : null
    if (a) goTo(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])
  const blockOrder = useMemo(() => new Map((doc?.blocks ?? []).map((b, i) => [b.id, i])), [doc])

  const showChat = useEvent(() => {
    setRightCollapsed(false)
    setFocusChat((n) => n + 1)
  })
  const askAi = useEvent((quote: string, extra?: string) => {
    setAttach({ quote, image: null, prefill: extra })
    showChat()
  })
  const askImage = useEvent((image: string, context: string, prefill?: string, box?: ChatBox) => {
    setAttach({ quote: null, image, context, prefill, ...(box ? { box } : {}) })
    showChat()
  })

  const goTo = useEvent((a: Annotation) => {
    if (a.mode === 'reflow') {
      if (mode !== 'reflow') switchMode('reflow')
      if (a.blockId) setJump({ nonce: jumpSeq++, kind: 'block', blockId: a.blockId.replace(/:tr$/, ''), annId: a.id })
    } else {
      // 划在译页上的：原文看法里不画它，换到对照
      if (a.side === 'tr' && mode !== 'dual' && mode !== 'mono') switchMode('dual')
      else if (!pdfLike(mode)) switchMode('pdf')
      if (a.page) setJump({ nonce: jumpSeq++, kind: 'page', page: a.page, annId: a.id, frac: a.rects?.[0]?.[1] })
    }
  })
  // 从笔记页点进来的：论文和标注都读到了以后，跳到那一条
  const cameFor = useRef(props.initialAnn)
  useEffect(() => {
    const a = cameFor.current && paper && mode ? anns.find((x) => x.id === cameFor.current) : undefined
    if (!a) return
    cameFor.current = undefined
    // 从笔记页点进来的是打了标签的：右栏换到「疑问」，摆好这一条（讲过的直接看，没讲过的点一下再讲）
    if (a.label) openQuestions({ ids: [a.id], start: a.id, auto: false })
    const t_ = setTimeout(() => goTo(a), 400)
    return () => clearTimeout(t_)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anns, paper, mode])
  // 从对比表点「打开原文这一处」进来的：对照模式跳到那一段，原文模式（或没找到那一段）跳到那一页
  const cameAt = useRef(props.initialAt)
  useEffect(() => {
    const at = cameAt.current
    if (!at || !paper || !mode) return
    cameAt.current = undefined
    const t_ = setTimeout(() => {
      if (mode === 'reflow' && at.blockId) setJump({ nonce: jumpSeq++, kind: 'block', blockId: at.blockId })
      else if (at.page) {
        if (!pdfLike(mode)) switchMode('pdf')
        setTimeout(() => setJump({ nonce: jumpSeq++, kind: 'page', page: at.page! }), pdfLike(mode) ? 0 : 60)
      }
    }, 400)
    return () => clearTimeout(t_)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, mode])
  const goBlock = useEvent((blockId: string) => {
    if (mode !== 'reflow') switchMode('reflow')
    setTimeout(() => setJump({ nonce: jumpSeq++, kind: 'block', blockId }), mode === 'reflow' ? 0 : 60)
  })
  const goHeading = useEvent((blockId: string) => {
    if (pdfLike(mode)) {
      const p = headingPages.get(blockId)
      if (p) setJump({ nonce: jumpSeq++, kind: 'page', page: p })
      return
    }
    goBlock(blockId)
  })
  const goHeadingByName = useEvent((name: string, sec?: string) => {
    const sq = (s: string): string => s.replace(/[^A-Za-z0-9一-鿿]+/g, '').toLowerCase()
    // 先按编号找（III-B：第 III 节下面的 B 小节），再按标题文字找
    let h: (typeof headings)[number] | undefined
    const m = /^([IVX]+)(?:[-.\s]+([A-Z]))?$/.exec((sec ?? '').trim())
    if (m) {
      const top = headings.findIndex((x) => x.md.startsWith(`${m[1]}. `))
      if (top >= 0) {
        h = headings[top]
        if (m[2]) {
          const next = headings.findIndex((x, i) => i > top && /^[IVX]+\.\s/.test(x.md))
          h = headings.slice(top + 1, next < 0 ? undefined : next).find((x) => x.md.startsWith(`${m[2]}.`)) ?? h
        }
      }
    }
    if (!h && name) h = headings.find((x) => sq(x.md) === sq(name)) ?? headings.find((x) => sq(x.md).includes(sq(name)) || sq(name).includes(sq(x.md)))
    if (h) goBlock(h.id)
    else toast(t('没找到小节「{0}」', name || sec))
  })

  const exportNotes = useEvent(async () => {
    try {
      const f = await api.annExport(paperId)
      if (f) toast(t('已导出到 {0}', f.replace(/^.*\//, '')))
    } catch (e) {
      toast(t('导出失败：{0}', errText(e)))
    }
  })

  // AI 重点：先看缓存（主进程按档位和多少缓存），没有才问 AI
  const loadKeys = useEvent(async (d?: Density, force?: boolean) => {
    setKeysBusy(true)
    try {
      setKeys(await api.majorPoints(paperId, d ?? density, !!force))
      setFocusKey(null)
    } catch (e) {
      toast(t('标重点失败：{0}', errText(e)))
    } finally {
      setKeysBusy(false)
    }
  })
  const loadTerms = useEvent(async (force?: boolean) => {
    setTermsBusy(true)
    try {
      setTerms(await api.terms(paperId, !!force))
    } catch (e) {
      toast(t('列术语失败：{0}', errText(e)))
    } finally {
      setTermsBusy(false)
    }
  })
  // 第一次点开「术语」这一栏就去要（之前要过的直接从缓存出来）
  useEffect(() => {
    if (leftTab === 'terms' && doc && !terms && !termsBusy) void loadTerms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftTab, doc])
  // 点一条术语：跳到它下一次出现的那段，点一次往后一处，到头了回第一处
  const onTerm = useEvent((blocks: string[]) => {
    const key = blocks.join(',')
    const h = termHop.current
    h.i = h.key === key ? (h.i + 1) % blocks.length : 0
    h.key = key
    goBlock(blocks[h.i])
  })
  // 手动选了一档但还没排好（排队、重排中、没排成）：标签写选的那档
  const wantTier: 'flash' | 'basic' | null = paper && doc && (paper.engine === 'flash' || paper.engine === 'basic') && doc.tier !== paper.engine && paper.reflow[paper.engine] !== 'done' ? paper.engine : null
  const wantFailed = !!wantTier && paper!.reflow[wantTier] === 'failed'
  const toggleKeys = useEvent(() => {
    if (!doc) return toast(t('重排好以后才能标重点'))
    const on = !keysOn
    setKeysOn(on)
    if (on && !keys) void loadKeys()
  })

  // 菜单命令
  useEffect(
    () =>
      api.onCommand((cmd) => {
        if (dialog) return
        // ⌘[：刚跳走过（点引用、链接、跳页）先回到刚才读的地方，否则回文献库
        if (cmd === 'back') {
          if (!backHandle.current?.()) props.onBack()
        }
        if (cmd === 'mode-pdf') switchMode('pdf')
        if (cmd === 'mode-dual') switchMode('dual')
        if (cmd === 'mode-mono') switchMode('mono')
        if (cmd === 'mode-reflow') reflowCmd()
        if (cmd === 'mode-glance') switchMode('glance')
        if (cmd === 'toggle-left') toggleLeft()
        if (cmd === 'toggle-right') toggleRight()
        if (cmd === 'export') void exportNotes()
        if (cmd === 'find') setFindOpen(true)
        if (cmd === 'translate-all') setTrAll(true)
        if (cmd === 'paper-info') setDialog('info')
        if (cmd === 'box-select') {
          if (!pdfLike(mode) && (mode !== 'reflow' || !doc)) switchMode('pdf')
          setBoxMode(true)
        }
        if (cmd === 'ask-ai') {
          const s = window.getSelection()?.toString().trim()
          if (s) askAi(s)
          else showChat()
        }
        if (cmd === 'zoom-in' || cmd === 'zoom-out' || cmd === 'zoom-reset') zoomCmd(cmd)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialog]
  )

  const setZoomTo = useEvent((z: number) => {
    setZoom(z)
    onPosition({ zoom: z })
  })
  const zoomCmd = useEvent((cmd: string) => {
    // 一档 10%：捏合停在 205% 时 ⌘+ 到 210%、⌘- 到 200%（对齐到整 10%）
    const step = (z: number): number => (cmd === 'zoom-in' ? Math.floor(z * 10 + 1e-6) + 1 : Math.ceil(z * 10 - 1e-6) - 1) / 10
    if (pdfLike(mode)) setZoomTo(cmd === 'zoom-reset' ? 1 : Math.min(3, Math.max(0.5, step(zoom))))
    else void api.setSettings({ readSize: cmd === 'zoom-reset' ? 18 : Math.min(24, Math.max(14, settings.readSize + (cmd === 'zoom-in' ? 1 : -1))) })
  })

  // 窗口放不下三栏时自动收一栏：刚点开的那一栏留着，收另一栏；窗口拉宽、放得下了再放回来。自动收的不记进设置
  const autoHid = useRef({ left: false, right: false })
  const lastOpened = useRef<'left' | 'right'>('right')
  const leftOff = mode === 'dual' ? !leftInDual : leftCollapsed
  const toggleLeft = useEvent(() => {
    autoHid.current.left = false
    if (mode === 'dual') {
      if (!leftInDual) lastOpened.current = 'left'
      return setLeftInDual(!leftInDual)
    }
    if (leftCollapsed) lastOpened.current = 'left'
    setLeftCollapsed(!leftCollapsed)
    void api.setSettings({ leftCollapsed: !leftCollapsed })
  })
  const toggleRight = useEvent(() => {
    autoHid.current.right = false
    if (rightCollapsed) lastOpened.current = 'right'
    setRightCollapsed(!rightCollapsed)
    void api.setSettings({ rightCollapsed: !rightCollapsed })
  })

  const [winW, setWinW] = useState(window.innerWidth)
  useEffect(() => {
    const on = (): void => setWinW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  // 右栏让到正文至少剩 MID_MIN：存的宽度比这个窗口放得下的宽时，先按放得下的显示
  const rightFit = Math.min(rightW, Math.max(320, winW - MID_MIN))
  useEffect(() => {
    const room = (l: boolean, r: boolean): boolean => winW - (l ? leftW : 0) - (r ? rightFit : 0) >= MID_MIN
    const L = !leftOff
    const hideLeft = (v: boolean): void => (mode === 'dual' ? setLeftInDual(!v) : setLeftCollapsed(v))
    const R = !rightCollapsed && !floating
    const hid = autoHid.current
    if (!room(L, R)) {
      if (R && lastOpened.current === 'left') ((hid.right = true), setRightCollapsed(true))
      else ((hid.left = true), hideLeft(true))
    } else if (hid.left && !L && room(true, R)) ((hid.left = false), hideLeft(false))
    else if (hid.right && rightCollapsed && !floating && room(L, true)) ((hid.right = false), setRightCollapsed(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, leftOff, rightCollapsed, leftW, rightFit, floating])

  const startResize = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = side === 'left' ? leftW : rightFit
    // 拖到正文只剩 MID_MIN 为止，不把另一栏挤掉
    const cap = winW - MID_MIN - (side === 'left' ? (rightCollapsed || floating ? 0 : rightFit) : leftOff ? 0 : leftW)
    const move = (ev: MouseEvent): void => {
      const d = ev.clientX - x0
      if (side === 'left') setLeftW(Math.max(240, Math.min(400, cap, w0 + d)))
      else setRightW(Math.max(320, Math.min(560, cap, w0 - d)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
      if (side === 'left') setLeftW((w) => (void api.setSettings({ leftW: w }), w))
      else setRightW((w) => (void api.setSettings({ rightW: w }), w))
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const translatable = useMemo(() => (doc ? doc.blocks.filter((b) => b.translatable) : []), [doc])
  const trDone = translatable.filter((b) => {
    const s = tr.map[tr.keyOf(b)]
    return s && 'text' in s
  }).length
  const trAllDone = translatable.length > 0 && trDone === translatable.length
  useEffect(() => {
    if (trAll && trAllDone) setTrAll(false)
  }, [trAll, trAllDone])
  useEffect(() => {
    if (trAll && translatable.length) void tr.request(translatable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trAll])

  const engineMenu = async (e: React.MouseEvent): Promise<void> => {
    if (!paper) return
    const cur = wantTier ?? doc?.tier ?? null
    const st = (t_: 'flash' | 'basic'): string => (paper.reflow[t_] === 'running' ? t('重排中') : paper.reflow[t_] === 'failed' ? t('失败过') : '')
    const act = await showMenu(
      [
        { type: 'section', label: t('重排引擎') },
        { id: 'flash', label: t('快速'), icon: <Zap size={16} />, hint: st('flash') || t('本地，几秒'), checked: cur === 'flash' },
        { id: 'basic', label: t('精细'), icon: <Check size={16} style={{ opacity: 0 }} />, hint: st('basic') || t('本地 MinerU'), checked: cur === 'basic' || cur === 'edited' },
        { id: 'simple', label: t('简单'), icon: <Check size={16} style={{ opacity: 0 }} />, hint: t('只取文字，不丢行'), checked: cur === 'simple' },
        { id: 'cloud', label: t('云端精细'), icon: <Cloud size={16} />, hint: t('会员，还没开放'), enabled: false, checked: false },
        { type: 'separator' },
        { id: 'region', label: t('调整重排区域…'), icon: <ScanText size={16} />, enabled: paper.reflow.basic === 'done', checked: false },
        { id: 'redo', label: t('用当前引擎重排'), icon: <RefreshCw size={16} />, checked: false }
      ],
      { el: e.currentTarget }
    )
    if (!act) return
    if (act === 'region') setDialog('region')
    else if (act === 'redo') void api.retryReflow(paperId).then(() => toast(t('已排队重排')))
    else {
      try {
        const d = await api.setEngine(paperId, act as Tier)
        if (d && d.tier === act) setDoc(d)
        else toast(t('正在用「{0}」重排，好了自动换上', TIER_NAME[act as Tier]))
        setPaper(await api.getPaper(paperId))
      } catch (er) {
        toast(errText(er))
      }
    }
  }
  const zoomMenu = async (e: React.MouseEvent): Promise<void> => {
    const act = await showMenu(
      [
        { id: '1', label: t('适合宽度'), hint: '⌘0', checked: Math.abs(zoom - 1) < 0.01 },
        { type: 'separator' },
        ...[0.5, 0.75, 1.25, 1.5, 2, 2.5, 3].map((z) => ({ id: String(z), label: `${Math.round(z * 100)}%`, checked: Math.abs(zoom - z) < 0.01 })),
        { type: 'separator' },
        { id: 'in', label: t('放大'), hint: '⌘+', checked: false },
        { id: 'out', label: t('缩小'), hint: '⌘-', checked: false },
        { type: 'note', label: t('也能双指捏合缩放') }
      ],
      { el: e.currentTarget }
    )
    if (act === 'in' || act === 'out') zoomCmd(act === 'in' ? 'zoom-in' : 'zoom-out')
    else if (act) setZoomTo(Number(act))
  }

  if (!paper || !mode) return <div className="reader-loading drag" />

  const reflowBusy = !doc && (paper.reflow.flash === 'queued' || paper.reflow.flash === 'running' || prog?.status === 'running')
  const showRight = !rightCollapsed && !floating
  const trPct = Math.round((trDone / Math.max(1, translatable.length)) * 100)
  const gridCols = `${leftOff ? 0 : leftW}px minmax(${MID_MIN}px, 1fr) ${showRight ? rightFit : 0}px`
  const midW = winW - (leftOff ? 0 : leftW) - (showRight ? rightFit : 0)
  // 正文列窄的时候（13 寸屏幕开着 AI 栏）：标题栏里带字的按钮只留图标，不然搜索和显示设置会被挤出去
  const compact = midW < COMPACT_BAR
  // 对照：一页不到 480 宽时自动上下排（不存）
  const dualAuto = settings.dualLayout === 'side' && (midW - 64 - 16) / 2 < DUAL_MIN_PAGE
  const dualLayout = dualAuto ? 'stack' : settings.dualLayout
  const trSt = lt.state
  const ltDone = trSt ? doneCount(trSt) : 0
  // 全篇翻完了（没有在翻、没出错、没有没翻成的页）：按钮只留图标，菜单里还能重新翻译
  const ltAllDone = !!trSt && ltDone >= trSt.total && !trSt.busy.length && !trSt.error
  const trFailedN = trSt ? Object.keys(trSt.failed ?? {}).length : 0
  const trLabel = !trSt ? '' : trSt.error ? t('翻译出错') : !trSt.busy.length && trFailedN ? t('{0} 页没翻成 · {1} / {2}', trFailedN, ltDone, trSt.total) : trSt.paused ? t('已暂停 {0} / {1} 页', ltDone, trSt.total) : ltAllDone ? t('已翻完 {0} 页', trSt.total) : t('翻译中 {0} / {1} 页', ltDone, trSt.total)
  const trMenu = async (e: React.MouseEvent): Promise<void> => {
    if (!trSt) return
    const el = e.currentTarget
    const stopped = trSt.paused || !!trSt.error
    const nFailed = Object.keys(trSt.failed ?? {}).length
    const act = await showMenu(
      [
        ...(ltAllDone ? [] : [stopped ? { id: 'resume', label: trSt.error ? t('重试') : t('继续翻译'), checked: false } : { id: 'pause', label: t('暂停'), checked: false }]),
        ...(nFailed && !trSt.error ? [{ id: 'resume', label: t('重新翻译没翻成的 {0} 页', nFailed), checked: false }] : []),
        { id: 'redo', label: t('重新翻译这页（第 {0} 页）', curPage), enabled: !!trSt.pages[curPage] || !!trSt.failed?.[curPage], checked: false },
        { id: 'redoAll', label: t('重新翻译全篇…'), checked: false },
        { type: 'separator' },
        { id: 'service', label: t('换翻译服务…'), hint: settings.trServiceName, checked: false }
      ],
      { el: e.currentTarget }
    )
    if (act === 'resume') void api.layoutTrResume(paperId)
    if (act === 'pause') void api.layoutTrPause(paperId)
    if (act === 'redo') void api.layoutTrRedo(paperId, curPage)
    if (act === 'redoAll') {
      // 重翻全篇要花翻译费：先确认一句
      const ok = await showMenu(
        [
          { type: 'note', label: t('全篇 {0} 页重新翻译，翻好的会换掉', trSt.total) + ' · ' + costLine(trSt.total, settings) },
          { id: 'go', label: t('重新翻译全篇'), checked: false },
          { id: 'no', label: t('取消'), checked: false }
        ],
        { el }
      )
      if (ok === 'go') void api.layoutTrRedoAll(paperId)
    }
    if (act === 'service') void api.openSettings('translate')
  }
  const meta = [paper.venue, paper.year, paper.progress >= 1 ? t('读完') : paper.progress > 0 ? t('读到 {0}%', Math.round(paper.progress * 100)) : ''].filter(Boolean).join(' · ')

  const chat = (
    <ChatPanel
      paper={paper}
      settings={settings}
      attach={attach}
      setAttach={setAttach}
      focusSignal={focusChat}
      clearSignal={clearSignal}
      onSaveNote={async (quote, answer) => {
        const now = Date.now()
        const a: Annotation = { id: crypto.randomUUID().slice(0, 12), paperId, mode: 'reflow', color: settings.lastColor, text: quote, note: answer, page: null, rects: null, blockId: null, blockHash: null, start: null, end: null, section: t('AI 问答'), createdAt: now, updatedAt: now }
        await api.annSave(a)
        setAnns((l) => [...l, a])
        toast(t('已存为笔记'))
      }}
    />
  )
  const questions = (
    <QuestionsPane
      paper={paper}
      anns={anns}
      blockOrder={blockOrder}
      prefetch={settings.explainPrefetch}
      request={walkReq}
      onFocusAnn={(a) => {
        setWalkFocus(a?.id ?? null)
        if (a) goTo(a)
      }}
      onQuote={goQuote}
      onRemoveLabel={(a) => void updateAnn({ ...a, label: null })}
      settings={settings}
      onToChat={(quote, context) => {
        setAttach({ quote, image: null, context })
        setRightTab('ai')
        showChat()
      }}
    />
  )
  const rightTabs = (
    <Segmented
      className="r-tabs"
      value={rightTab}
      onChange={setRightTab}
      options={[
        { value: 'ai', label: t('AI 问答') },
        {
          value: 'q',
          label: (
            <>
              <span className="seg-t">{t('疑问')}</span>
              <QBadge anns={anns} />
            </>
          ),
          title: t('打了「看不懂」「有质疑」的地方，攒着一条条讲')
        }
      ]}
    />
  )
  const chatTools = (
    <>
      <button className="icon-btn" title={t('新对话（清空，能撤销）')} onClick={() => setClearSignal((n) => n + 1)}>
        <SquarePen size={16} />
      </button>
      <button className="icon-btn" title={t('导出对话 Markdown')} onClick={() => void api.chatExport(paperId).then((f) => f && toast(t('已导出到 {0}', f.replace(/^.*\//, ''))))}>
        <FileOutput size={16} />
      </button>
    </>
  )

  return (
    <div className="reader" style={{ gridTemplateColumns: gridCols }} data-mode={mode}>
      {/* 左栏 */}
      {!leftOff && (
        <aside className="col-left">
          <div className="titlebar drag left-bar">
            <span className="spacer" />
            <button className="icon-btn" title={t('收起左栏 ⌃⌘S')} onClick={toggleLeft}>
              <PanelLeft size={16} />
            </button>
          </div>
          <div className="lp-head">
            <div className="lp-title" title={paper.title}>
              {paper.title}
            </div>
            {meta && <div className="hint num">{meta}</div>}
          </div>
          <div className="lp-tabs">
            <Segmented
              className="sm block"
              value={leftTab}
              onChange={setLeftTab}
              options={[
                { value: 'toc', label: t('目录') },
                { value: 'notes', label: t('笔记') },
                { value: 'figs', label: t('图表') },
                { value: 'keys', label: t('重点') },
                { value: 'terms', label: t('术语') }
              ]}
            />
          </div>
          <LeftPane
            tab={leftTab}
            mode={pdfLike(mode) ? 'pdf' : mode}
            pdf={pdf}
            doc={doc}
            headings={headings}
            headingPages={headingPages}
            tr={tr}
            display={settings.display}
            curBlock={curBlock}
            curPage={curPage}
            anns={anns}
            kinds={kinds}
            sections={sections}
            sectionForPage={sectionForPage}
            keys={keys}
            keysBusy={keysBusy}
            focusKey={focusKey}
            onKey={(k) => {
              setFocusKey(k)
              goBlock(k.blockId)
            }}
            terms={terms}
            termsBusy={termsBusy}
            termMarks={settings.termMarks}
            onTermMarks={(v) => void api.setSettings({ termMarks: v })}
            onLoadTerms={(force) => void loadTerms(force)}
            onTerm={onTerm}
            density={density}
            onDensity={(d) => {
              setDensity(d)
              void loadKeys(d)
            }}
            onLoadKeys={(force) => {
              setKeysOn(true)
              void loadKeys(density, force)
            }}
            onHeading={goHeading}
            onBlock={goBlock}
            onPage={(p) => {
              if (!pdfLike(mode)) switchMode('pdf')
              setJump({ nonce: jumpSeq++, kind: 'page', page: p })
            }}
            onAnn={goTo}
            onHoverAnn={setHoverAnn}
            onExport={() => void exportNotes()}
          />
          <div className="resizer" style={{ left: leftW - 4 }} onMouseDown={startResize('left')} onDoubleClick={() => setLeftW(260)} />
        </aside>
      )}

      {/* 中栏 */}
      <section className="col-mid">
        <div className={'titlebar drag mid-bar' + (leftOff ? ' no-left' : '') + (showRight ? '' : ' no-right')}>
          {leftOff && (
            <button className="icon-btn" title={t('显示左栏 ⌃⌘S')} onClick={toggleLeft}>
              <PanelLeft size={16} />
            </button>
          )}
          <button className="icon-btn" title={t('回文献库 ⌘[')} onClick={props.onBack}>
            <ChevronLeft size={16} />
          </button>
          {props.back && (
            <>
              <button className="btn ghost cn-back" title={t('回画布笔记里的「{0}」首页', props.back.folder || t('库'))} onClick={() => void api.cnOpenInCn(null, 'folder', { folder: props.back!.folder })}>
                <Undo2 size={16} />
                {!compact && t('回画布笔记')}
              </button>
              <span className="tb-sep" />
            </>
          )}
          {/* 2026-11-23 用户定看法五格：原文 / 对照 / 译文 / 重排 / 速览；以前的上下、左右对照并进「重排」，在重排里两格换排法 */}
          <Segmented
            className={'mode-seg' + (compact ? ' compact' : '')}
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'pdf', label: t('原文'), title: '⌘1' },
              { value: 'dual', label: t('对照'), title: t('左边原页，右边同版面的译文页 ⌘2') },
              { value: 'mono', label: t('译文'), title: t('只看同版面的译文页 ⌘3') },
              { value: 'reflow', label: t('重排'), busy: reflowBusy, title: t('重排成网页：逐段对照、意群、AI 重点 ⌘4') },
              { value: 'glance', label: t('速览'), title: '⌘5' }
            ]}
          />
          {/* 排法两格；正文列窄时只留现在这一格，点一下换另一种（标题栏放得下搜索和显示设置） */}
          {mode === 'dual' && (
            <Segmented
              className={'lay-seg' + (compact ? ' one' : '')}
              value={dualLayout}
              onChange={(v) => void api.setSettings({ dualLayout: compact ? (dualLayout === 'side' ? 'stack' : 'side') : v })}
              options={[
                { value: 'side' as const, label: <Columns2 size={14} />, title: dualAuto ? t('左右并排（窗口窄，现在自动上下排）') : t('左右并排') },
                { value: 'stack' as const, label: <Rows2 size={14} />, title: t('上下交替：原页在上，译页在下') }
              ].filter((o) => !compact || o.value === dualLayout)}
            />
          )}
          {mode === 'reflow' && (
            <Segmented
              className={'lay-seg' + (compact ? ' one' : '')}
              value={settings.trLayout}
              onChange={(v) => pickReflowLayout(compact ? (settings.trLayout === 'side' ? 'stack' : 'side') : v)}
              options={[
                { value: 'stack' as const, label: <Rows2 size={14} />, title: t('上下对照：⌘4，再按一次换左右') },
                { value: 'side' as const, label: <Columns2 size={14} />, title: t('左右对照：⌘4，再按一次换上下') }
              ].filter((o) => !compact || o.value === settings.trLayout)}
            />
          )}
          {mode === 'reflow' && doc && settings.display === 'both' && <SenseButton settings={settings} compact={compact} />}
          {findOpen && <FindBar scroller={midRef} onClose={() => setFindOpen(false)} />}
          <div className="spacer" />
          <BgParse compact />
          <div className="bar-tools">
          {cnLink && (
            <button className="icon-btn cn-open" title={t('在画布笔记里看这篇的笔记（{0}）', cnLink.note)} onClick={() => void api.cnOpenInCn(paperId, 'note').catch((e) => toast(errText(e)))}>
              <BookMarked size={16} />
            </button>
          )}
          {mode === 'reflow' && doc && (
            <>
              {!trAllDone && settings.display !== 'src' && (
                <button
                  className={'btn' + (trAll ? ' on' : '')}
                  title={trAll ? t('点一下停止') : compact ? t('全文翻译：一次翻完全文（一篇算一次）') : t('一次翻完全文（一篇算一次）')}
                  onClick={() => {
                    if (trAll) {
                      setTrAll(false)
                      tr.cancel()
                    } else setTrAll(true)
                  }}
                >
                  {trAll ? <span className="spin spin-12" /> : <Languages size={16} />}
                  {trAll ? (compact ? `${trPct}%` : t('翻译中 {0}%', trPct)) : !compact && t('全文翻译')}
                </button>
              )}
              <button
                className="btn ghost"
                title={wantTier ? (wantFailed ? t('「{0}」重排没成，现在显示的是「{1}」', TIER_NAME[wantTier], TIER_NAME[doc.tier]) : t('正在用「{0}」重排，好了自动换上；现在显示的是「{1}」', TIER_NAME[wantTier], TIER_NAME[doc.tier])) : t('重排引擎')}
                onClick={(e) => void engineMenu(e)}
              >
                {/* 选了还没排好的那一档：标签写选的那档和进度，不再显示成旧的那档让人以为没选上 */}
                {wantTier && !wantFailed && <span className="spin spin-12" />}
                {wantTier && wantFailed && <span className="dot err sm" />}
                {wantTier ? (wantFailed ? TIER_NAME[wantTier] : prog?.tier === wantTier && prog.percent !== null && prog.status === 'running' ? `${TIER_NAME[wantTier]} ${prog.percent}%` : TIER_NAME[wantTier]) : TIER_NAME[doc.tier]}
                <ChevronDown size={12} />
              </button>
              <button className={'icon-btn' + (keysOn ? ' active' : '')} title={t('AI 重点高亮')} onClick={toggleKeys}>
                {keysBusy ? <span className="spin spin-12" /> : <Highlighter size={16} />}
              </button>
              <button className="icon-btn" title={t('导出双语 PDF')} onClick={() => setDialog('export')}>
                <FileOutput size={16} />
              </button>
            </>
          )}
          {mode === 'reflow' && doc && (
            <button className={'icon-btn' + (boxMode ? ' active' : '')} title={t('截图翻译：框选一块翻译或提问')} onClick={() => (setBoxMode((v) => !v), setSel(null))}>
              <ScanText size={16} />
            </button>
          )}
          {(mode === 'dual' || mode === 'mono') && babel?.phase === 'done' && trSt && trSt.started && (
            // 正文列窄时只留图标和小箭头（字放进悬停提示），放不下时它是最后一个收掉的；全翻完也留着（只剩图标），菜单里能重新翻译
            <button className={'btn tr-prog' + (compact || ltAllDone ? ' compact' : '')} data-testid="tr-progress" title={[trLabel, trSt.error ?? t('翻译用 {0}', settings.trServiceName), ltAllDone ? t('重新翻译这页或全篇') : ''].filter(Boolean).join(' · ')} onClick={(e) => void trMenu(e)}>
              {trSt.error || (!trSt.busy.length && trFailedN) ? <span className="dot err sm" /> : trSt.paused || ltAllDone ? <Languages size={16} /> : <span className="spin spin-12" />}
              {!compact && !ltAllDone && <span className="num">{trLabel}</span>}
              <ChevronDown size={12} />
            </button>
          )}
          {pdfLike(mode) && (
            <>
              <button
                className={'btn' + (boxMode ? ' on' : '')}
                title={t('框选一块翻译或提问（或按住 ⌥ 拖）')}
                onClick={() => {
                  setBoxMode((v) => !v)
                  setShot(null)
                  setSel(null)
                }}
              >
                <ScanText size={16} />
                {!compact && (mode === 'pdf' ? t('截图翻译') : t('框选'))}
              </button>
              {mode === 'pdf' && (
              <button
                className={'icon-btn' + (inkTool?.kind === 'pen' ? ' active' : '')}
                title={t('笔：在页面上画（Esc 放下）')}
                onClick={() => {
                  setBoxMode(false)
                  setSel(null)
                  setInkTool((v) => (v?.kind === 'pen' ? null : { kind: 'pen', color: lastInk.current }))
                }}
              >
                <Pencil size={16} />
              </button>
              )}
              {inkTool && (
                <span className="ink-tools">
                  {INK_COLORS.map((c) => (
                    <button key={c} className={'ink-dot' + (inkTool.kind === 'pen' && inkTool.color === c ? ' on' : '')} title={t('换这个颜色')} onClick={() => ((lastInk.current = c), setInkTool({ kind: 'pen', color: c }))}>
                      <span style={{ background: c }} />
                    </button>
                  ))}
                  <button className={'icon-btn' + (inkTool.kind === 'eraser' ? ' active' : '')} title={t('橡皮：擦掉碰到的笔画')} onClick={() => setInkTool({ kind: 'eraser' })}>
                    <Eraser size={16} />
                  </button>
                </span>
              )}
              <button className="btn ghost num" data-testid="zoom-btn" title={t('缩放（⌘+ / ⌘- / ⌘0，或双指捏合）')} onClick={(e) => void zoomMenu(e)}>
                {Math.round(zoom * 100)}%
                <ChevronDown size={12} />
              </button>
            </>
          )}
          {mode === 'glance' && (
            <>
              <button className="btn ghost" title={t('重新生成')} onClick={() => setRegenSignal((n) => n + 1)}>
                <RefreshCw size={16} />
                {!compact && t('重新生成')}
              </button>
              {doc && (
                <button className="icon-btn" title={t('导出双语 PDF')} onClick={() => setDialog('export')}>
                  <FileOutput size={16} />
                </button>
              )}
            </>
          )}
          </div>
          <button className="icon-btn" title={t('文献信息 ⌘I')} onClick={() => setDialog('info')}>
            <Info size={16} />
          </button>
          <button className={'icon-btn' + (findOpen ? ' active' : '')} title={t('搜索 ⌘F')} onClick={() => setFindOpen((v) => !v)}>
            <Search size={16} />
          </button>
          <button className={'btn ghost show-btn' + (aaOpen ? ' on' : '')} title={t('显示设置')} onClick={() => setAaOpen((v) => !v)}>
            <ALargeSmall size={16} />
            {!compact && t('显示')}
          </button>
          {(rightCollapsed || floating) && (
            <button className={'icon-btn' + (floating && !rightCollapsed ? ' active' : '')} title={floating ? t('AI 悬浮窗 ⌃⌘I') : t('显示 AI 问答 ⌃⌘I')} onClick={toggleRight}>
              <PanelRight size={16} />
            </button>
          )}
        </div>
        {aaOpen && <AaPanel mode={pdfLike(mode) ? 'pdf' : mode} settings={settings} zoom={zoom} onZoom={setZoomTo} onPreview={setTrPreview} onClose={() => (setAaOpen(false), setTrPreview(null))} />}
        <div className="mid-body" ref={midRef}>
          {(mode === 'dual' || mode === 'mono') && <TrBanner inst={babel} state={trSt} total={pdf?.numPages ?? 0} settings={settings} paperId={paperId} onTrSide={mode === 'dual' && dualLayout === 'side'} onLater={() => (setTrLater(true), switchMode('pdf'))} />}
          {pdfLike(mode) &&
            (pdf ? (
              <PdfView
                tr={mode === 'dual' || mode === 'mono' ? { layout: mode === 'mono' ? 'mono' : dualLayout, state: trSt, docs: lt.docs, pending: (n) => <PendingCard n={n} inst={babel} state={trSt} paperId={paperId} /> } : undefined}
                backHandle={backHandle}
                pdf={pdf}
                paper={paper}
                anns={anns}
                ideas={ideas}
                focusIdea={focusIdea}
                onIdeaLibrary={(i) => props.onOpenIdeas(i.id)}
                onIdeaRemove={(i) => void removeIdea(i)}
                zoom={zoom}
                onZoom={setZoomTo}
                invert={settings.pdfInvert}
                boxMode={boxMode}
                shot={shot}
                jump={jump}
                hoverAnn={hoverAnn ?? walkFocus}
                initial={posRef.current}
                onPosition={(page, frac, progress) => {
                  setCurPage(page)
                  onPosition({ page, pageFrac: frac }, progress)
                  trFocus(page)
                }}
                onSelect={(s) => {
                  setShot(null)
                  setSel(s)
                }}
                onBox={(img, page, frac, text, side) => {
                  setBoxMode(false)
                  setShot({ page, frac, side })
                  // 对照、译文看法：两边同一块都截下来，小条里能换截哪一边（默认你框的那边）
                  const other = mode === 'pdf' ? null : cropPage(page, side === 'src' ? 'tr' : 'src', frac)
                  setSel({
                    text,
                    paragraph: pageTexts[page - 1] ?? '',
                    image: img,
                    target: null,
                    ...(mode === 'pdf' ? {} : { shot: { page, frac, side, src: side === 'src' ? img : other, tr: side === 'tr' ? img : other } }),
                    getRect: () => {
                      const el = document.querySelector(`.page[data-page="${page}"][data-side="${side}"]`)
                      if (!el) return null
                      const r = el.getBoundingClientRect()
                      return new DOMRect(r.left + frac[0] * r.width, r.top + frac[1] * r.height, frac[2] * r.width, frac[3] * r.height)
                    }
                  })
                }}
                onRectsFound={(a, rects) => void api.annSave({ ...a, rects })}
                inkTool={mode === 'pdf' ? inkTool : null}
                inks={mode === 'pdf' ? inks : []}
                onInkAdd={(d) => {
                  if (inkTool?.kind !== 'pen') return
                  const k: Ink = { id: crypto.randomUUID().slice(0, 12), paperId, page: d.page, color: inkTool.color, width: INK_WIDTH, points: d.points, createdAt: Date.now() }
                  setInks((l) => [...l, k])
                  myInks.current.push(k.id)
                  void api.inkSave(k)
                }}
                onInkErase={(id) => {
                  setInks((l) => l.filter((k) => k.id !== id))
                  void api.inkDelete(id)
                }}
              />
            ) : (
              <div className="center-note">{pdfErr ? t('打不开 PDF：{0}', pdfErr) : ''}</div>
            ))}
          {mode === 'reflow' && (
            <ReflowView
              backHandle={backHandle}
              onMarkBlock={markBlock}
              paper={paper}
              doc={doc}
              prog={prog}
              anns={anns}
              ideas={ideas}
              focusIdea={focusIdea}
              onIdeaLibrary={(i) => props.onOpenIdeas(i.id)}
              onIdeaRemove={(i) => void removeIdea(i)}
              settings={settings}
              trPreview={trPreview}
              tr={tr}
              jump={jump}
              hoverAnn={hoverAnn ?? walkFocus}
              sections={sections}
              onWalk={(ids) => openQuestions({ ids, auto: true })}
              marks={keysOn ? keys : focusKey ? [focusKey] : null}
              terms={settings.termMarks ? terms : null}
              initial={posRef.current}
              onPosition={(p, progress) => {
                setCurBlock(p.blockId)
                onPosition({ blockHash: p.blockHash, textPrefix: p.textPrefix, heading: p.heading, offset: p.offset }, progress)
              }}
              onSelect={setSel}
              onAsk={askAi}
              onAskImage={askImage}
              onOpenPaper={props.onOpenPaper}
              onBlock={goBlock}
              onReadPdf={() => switchMode('pdf')}
              onRetry={() => void api.retryReflow(paperId).then(() => api.getPaper(paperId).then(setPaper))}
              onSimple={async () => {
                try {
                  await api.simpleReflow(paperId)
                } catch (e) {
                  toast(t('简单重排失败：{0}', errText(e)))
                }
              }}
            />
          )}
          {mode === 'glance' && <GlanceView paper={paper} onSection={goHeadingByName} hasDoc={!!doc} regenSignal={regenSignal} />}
        </div>
        {mode === 'reflow' && boxMode && (
          <ShotLayer
            host={midRef}
            onCancel={() => setBoxMode(false)}
            onShot={(img, text, paragraph, rect) => {
              setBoxMode(false)
              setSel({ text, paragraph, image: img, target: null, getRect: () => rect })
            }}
          />
        )}
        <SelectionLayer
          sel={sel}
          paper={paper}
          lastColor={settings.lastColor}
          kinds={kinds}
          midRef={midRef}
          onClose={() => {
            setSel(null)
            setShot(null)
          }}
          onCreate={createAnn}
          onUpdate={updateAnn}
          onDelete={deleteAnn}
          onExplain={(a) => openQuestions({ ids: [a.id], start: a.id, auto: true })}
          onAsk={askAi}
          onAskImage={askImage}
          ideaTopics={ideaTopics}
          ideaHow={settings.ideaHow}
          pageOf={(text) => pageOfText(pageTexts, text)}
          onIdea={createIdea}
        />
      </section>

      {/* 右栏 */}
      {showRight && (
        <aside className="col-right">
          <div className="titlebar drag right-bar">
            {rightTabs}
            <div className="spacer" />
            {rightTab === 'ai' && chatTools}
            <button className="icon-btn" title={t('改成悬浮窗')} onClick={() => void api.setSettings({ chatFloat: true })}>
              <PictureInPicture2 size={16} />
            </button>
            <button className="icon-btn" title={t('收起右栏 ⌃⌘I')} onClick={toggleRight}>
              <PanelRight size={16} />
            </button>
          </div>
          {rightTab === 'ai' ? chat : questions}
          <div className="resizer" style={{ left: -4 }} onMouseDown={startResize('right')} onDoubleClick={() => setRightW(380)} />
        </aside>
      )}
      {floating && !rightCollapsed && (
        <div className="floatwin" style={{ right: floatPos.right, bottom: floatPos.bottom }}>
          <div
            className="fh"
            onMouseDown={(e) => {
              if ((e.target as Element).closest('button')) return
              const x0 = e.clientX
              const y0 = e.clientY
              const p0 = floatPos
              const move = (ev: MouseEvent): void =>
                setFloatPos({ right: Math.min(window.innerWidth - 120, Math.max(0, p0.right - (ev.clientX - x0))), bottom: Math.min(window.innerHeight - 80, Math.max(0, p0.bottom - (ev.clientY - y0))) })
              const up = (): void => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
          >
            <GripVertical size={14} />
            {rightTabs}
            <span className="spacer" />
            {rightTab === 'ai' && chatTools}
            <button className="icon-btn" title={t('放回右栏')} onClick={() => void api.setSettings({ chatFloat: false })}>
              <PanelRight size={16} />
            </button>
            <button className="icon-btn" title={t('收起')} onClick={toggleRight}>
              <Minimize2 size={16} />
            </button>
          </div>
          {rightTab === 'ai' ? chat : questions}
        </div>
      )}

      {dialog === 'info' && <PaperInfo id={paperId} onClose={() => (setDialog(null), void api.getPaper(paperId).then(setPaper))} />}
      {dialog === 'export' && <ExportDialog id={paperId} onClose={() => setDialog(null)} />}
      {dialog === 'region' && pdf && (
        <RegionEditor
          paperId={paperId}
          pdf={pdf}
          startPage={curPage}
          onClose={() => setDialog(null)}
          onSaved={(d) => {
            if (d) setDoc(d)
            setDialog(null)
            void api.getPaper(paperId).then(setPaper)
          }}
        />
      )}
    </div>
  )
}

function AaPanel(props: { mode: ReadMode; settings: SettingsView; zoom: number; onZoom: (z: number) => void; onPreview: (s: TrStyle | null) => void; onClose: () => void }) {
  const s = props.settings
  const set = (p: Parameters<typeof api.setSettings>[0]): void => void api.setSettings(p)
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const lang = s.targetLang.replace(/^简体|^繁體|^繁体/, '')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  const row = (label: string, c: React.ReactNode) => (
    <div className="aa-row">
      <span>{label}</span>
      <div>{c}</div>
    </div>
  )
  return (
    <>
      <div className="click-catcher" onMouseDown={props.onClose} />
      <div className="pop aa-pop">
        {props.mode === 'pdf' ? (
          <>
            {row(
              t('缩放'),
              <>
                <button className="btn icon" onClick={() => props.onZoom(Math.max(0.5, Math.round((props.zoom - 0.1) * 10) / 10))}>
                  <ChevronDown size={16} />
                </button>
                <span className="num aa-val">{Math.round(props.zoom * 100)}%</span>
                <button className="btn icon" onClick={() => props.onZoom(Math.min(3, Math.round((props.zoom + 0.1) * 10) / 10))}>
                  <ChevronUp size={16} />
                </button>
              </>
            )}
            {dark && row(t('深色反色'), <Switch on={s.pdfInvert} onChange={(v) => set({ pdfInvert: v })} label={t('反色')} />)}
          </>
        ) : (
          <>
            {row(
              t('字号'),
              <>
                <button className="btn icon" onClick={() => set({ readSize: Math.max(14, s.readSize - 1) })} aria-label={t('缩小')}>
                  A
                </button>
                <span className="num aa-val">{s.readSize}</span>
                <button className="btn icon" style={{ fontSize: 16 }} onClick={() => set({ readSize: Math.min(24, s.readSize + 1) })} aria-label={t('放大')}>
                  A
                </button>
              </>
            )}
            {row(
              t('英文字体'),
              <Segmented
                className="sm block"
                value={s.srcFont}
                onChange={(v) => set({ srcFont: v })}
                options={[
                  { value: 'serif', label: t('衬线') },
                  { value: 'sans', label: t('无衬线') }
                ]}
              />
            )}
            {props.mode === 'reflow' && (
              <>
                {row(
                  t('显示'),
                  <Segmented
                    className="sm block"
                    value={s.display}
                    onChange={(v) => set({ display: v })}
                    options={[
                      { value: 'src', label: t('只看英文') },
                      { value: 'both', label: t('双语') },
                      { value: 'tr', label: t('只看{0}', lang || t('译文')) }
                    ]}
                  />
                )}
                {s.display === 'both' &&
                  row(
                    t('意群样式'),
                    <Segmented
                      className="sm block"
                      value={s.senseStyle}
                      onChange={(v) => set({ senseStyle: v, senseGroups: true })}
                      options={[
                        { value: 'text', label: t('文字着色') },
                        { value: 'underline', label: t('下划线') }
                      ]}
                    />
                  )}
                <TrStyleTiles settings={s} onPick={(v) => set({ trStyle: v })} onPreview={props.onPreview} />
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

// 论文内搜索：用 CSS 自定义高亮标出命中，不改 DOM
function FindBar(props: { scroller: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Range[]>([])
  const [cur, setCur] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    const t_ = setTimeout(() => {
      const root = props.scroller.current
      const out: Range[] = []
      if (root && q.trim().length >= 2) {
        const needle = q.trim().toLowerCase()
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => (n.parentElement?.closest('.katex-mathml, .tr-skel') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
        })
        let n: Node | null
        while ((n = w.nextNode()) && out.length < 500) {
          const text = (n as Text).data.toLowerCase()
          let i = text.indexOf(needle)
          while (i >= 0) {
            const r = document.createRange()
            r.setStart(n, i)
            r.setEnd(n, i + needle.length)
            out.push(r)
            i = text.indexOf(needle, i + needle.length)
          }
        }
      }
      setHits(out)
      setCur(0)
    }, 120)
    return () => clearTimeout(t_)
  }, [q, props.scroller])
  useEffect(() => {
    const reg = CSS.highlights
    reg.set('find-hit', new Highlight(...hits))
    reg.set('find-cur', hits[cur] ? new Highlight(hits[cur]) : new Highlight())
    hits[cur]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    return () => {
      reg.delete('find-hit')
      reg.delete('find-cur')
    }
  }, [hits, cur])
  const step = (d: number): void => {
    if (hits.length) setCur((c) => (c + d + hits.length) % hits.length)
  }
  return (
    <div className="find">
      <label className="field-fill" style={{ width: 200 }}>
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          placeholder={t('在论文里搜索')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') props.onClose()
          }}
        />
        <span className="hint num">{hits.length ? `${cur + 1}/${hits.length}` : q.trim().length >= 2 ? '0' : ''}</span>
      </label>
      <button className="icon-btn" onClick={() => step(-1)} title={t('上一个 ⇧↩')}>
        <ChevronUp size={16} />
      </button>
      <button className="icon-btn" onClick={() => step(1)} title={t('下一个 ↩')}>
        <ChevronDown size={16} />
      </button>
      <button className="icon-btn" onClick={props.onClose} title={t('关闭 Esc')}>
        <X size={16} />
      </button>
    </div>
  )
}

// 标题栏的意群按钮：点一下开关，右边小箭头选「文字着色」或「下划线」（2026-11-15 用户定：意群文字和下划线两种）
function SenseButton(props: { settings: SettingsView; compact: boolean }) {
  const s = props.settings
  const on = s.senseGroups
  const sample = (style: string) => (
    <span className={`sg-${style} sg-sample`}>
      <span className="sg" data-c="0">
        数据由
      </span>
      <span className="sg" data-c="1">
        处理器处理
      </span>
    </span>
  )
  const menu = async (el: Element): Promise<void> => {
    const id = await showMenu(
      [
        { type: 'section', label: t('意群样式') },
        { id: 'text', label: t('文字着色'), desc: t('字换成这一块的颜色'), icon: sample('text'), checked: on && s.senseStyle === 'text' },
        { id: 'underline', label: t('下划线'), desc: t('字不变色，底下画同色的线'), icon: sample('underline'), checked: on && s.senseStyle === 'underline' },
        { type: 'separator' },
        { id: 'off', label: t('不显示意群'), checked: !on }
      ],
      { el, align: 'left' }
    )
    if (id === 'off') void api.setSettings({ senseGroups: false })
    else if (id === 'text' || id === 'underline') void api.setSettings({ senseGroups: true, senseStyle: id })
  }
  return (
    <span className="sense-split" data-part="意群开关">
      <button
        className={'btn ghost' + (on ? ' on' : '')}
        title={on ? t('意群开着（{0}），点一下关掉', s.senseStyle === 'underline' ? t('下划线') : t('文字着色')) : t('意群：一句一句对着看，对应的意群同色')}
        onClick={() => void api.setSettings({ senseGroups: !on })}
      >
        <span className="sg-glyph" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
        {!props.compact && t('意群')}
      </button>
      <button className={'btn ghost' + (on ? ' on' : '')} title={t('意群样式')} onClick={(e) => void menu(e.currentTarget)}>
        <ChevronDown size={12} />
      </button>
    </span>
  )
}
