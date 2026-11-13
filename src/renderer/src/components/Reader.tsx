import { ALargeSmall, Check, ChevronDown, ChevronLeft, ChevronUp, Cloud, FileOutput, GripVertical, Highlighter, Info, Languages, Minimize2, PanelLeft, PanelRight, PictureInPicture2, RefreshCw, ScanText, Search, SquarePen, X, Zap, Eraser, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as PdfJs from 'pdfjs-dist'
import { sectionsOf } from '@shared/chunk'
import type { Annotation, HlColor, MajorPoint, Paper, ReadMode, ReadPosition, ReflowDoc, SettingsView, Tier, Term, Ink, AnnLabel } from '@shared/types'
import { api, errText, type ReflowProgress } from '../api'
import { showMenu } from '../lib/menu'
import { loadPdf } from '../lib/pdf'
import { useTranslations } from '../lib/translations'
import { Segmented, Switch, useDebounced, useEvent, useToast } from '../lib/ui'
import { ChatPanel, type Attach } from './ChatPanel'
import { ExportDialog } from './ExportDialog'
import { GlanceView } from './GlanceView'
import { LeftPane, type LeftTab } from './LeftPane'
import { PaperInfo } from './PaperInfo'
import { INK_COLORS, INK_WIDTH, PdfView, type InkTool } from './PdfView'
import { ReflowView } from './ReflowView'
import { RegionEditor } from './RegionEditor'
import { SelectionLayer, type SelInfo } from './Selection'
import { ShotLayer } from './ShotLayer'
import { t } from '@shared/i18n'

export type Jump = { nonce: number; kind: 'block'; blockId: string; annId?: string } | { nonce: number; kind: 'page'; page: number; annId?: string; frac?: number }
export type Density = 'less' | 'default' | 'more'

let jumpSeq = 1
const TIER_NAME: Record<Tier, string> = { flash: t('快速'), basic: t('精细'), simple: t('简单'), edited: t('调整过') }
// 正文那一列最少这么宽：窗口放不下时收侧栏，不压正文
const MID_MIN = 480
// 正文列比这个窄，标题栏的文字按钮只留图标
const COMPACT_BAR = 700

export function Reader(props: { paperId: string; initialMode?: ReadMode; initialAnn?: string; settings: SettingsView; onBack: () => void; onOpenPaper: (id: string) => void }) {
  const { paperId, settings } = props
  const toast = useToast()
  const [paper, setPaper] = useState<Paper | null>(null)
  const [mode, setMode] = useState<ReadMode | null>(null)
  const [doc, setDoc] = useState<ReflowDoc | null>(null)
  const [prog, setProg] = useState<ReflowProgress | null>(null)
  const [anns, setAnns] = useState<Annotation[]>([])
  const [pdf, setPdf] = useState<PdfJs.PDFDocumentProxy | null>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)
  const [pageTexts, setPageTexts] = useState<string[]>([])
  const [leftTab, setLeftTab] = useState<LeftTab>('toc')
  const [leftCollapsed, setLeftCollapsed] = useState(settings.leftCollapsed)
  const [rightCollapsed, setRightCollapsed] = useState(settings.rightCollapsed)
  const [leftW, setLeftW] = useState(settings.leftW)
  const [rightW, setRightW] = useState(settings.rightW)
  const [jump, setJump] = useState<Jump | null>(null)
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
  const [shot, setShot] = useState<{ page: number; frac: [number, number, number, number] } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [aaOpen, setAaOpen] = useState(false)
  const [trAll, setTrAll] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [clearSignal, setClearSignal] = useState(0)
  const [regenSignal, setRegenSignal] = useState(0)
  const [curBlock, setCurBlock] = useState<string | null>(null)
  const [curPage, setCurPage] = useState(1)
  const [hoverAnn, setHoverAnn] = useState<string | null>(null)
  const [keysOn, setKeysOn] = useState(false)
  const [keys, setKeys] = useState<MajorPoint[] | null>(null)
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
      // 新论文重排好之前停在原文，好了以后默认对照；之后记住上次的模式
      setMode(props.initialMode ?? p.lastMode ?? (d ? 'reflow' : 'pdf'))
      setAnns(await api.annList(paperId))
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

  useEffect(() => () => void pdf?.loadingTask.destroy(), [pdf])

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
    if (mode === 'pdf' && tier === 'flash') toast(t('重排好了'), { label: t('切到对照'), run: () => switchMode('reflow') })
    if (mode === null) setMode('reflow')
  })
  useEffect(() => {
    const offs = [
      api.onReflowProgress((p) => p.paperId === paperId && setProg(p)),
      api.onReflowDone((p) => p.paperId === paperId && void reloadDoc(p.tier)),
      api.onReflowFailed((p) => {
        if (p.paperId !== paperId) return
        void api.getPaper(paperId).then(setPaper)
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
  const createAnn = useEvent(async (info: SelInfo, color: HlColor, note: string = '', style: Annotation['style'] = 'highlight', label: AnnLabel | null = null): Promise<Annotation | null> => {
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
      text: info.text,
      note,
      page: t_.mode === 'pdf' ? t_.page : null,
      rects: t_.mode === 'pdf' ? t_.rects : null,
      blockId: t_.mode === 'reflow' ? t_.blockId : null,
      blockHash: t_.mode === 'reflow' ? t_.blockHash : null,
      start: t_.mode === 'reflow' ? t_.start : null,
      end: t_.mode === 'reflow' ? t_.end : null,
      section: t_.mode === 'reflow' ? t_.section : sectionForPage(t_.page),
      createdAt: now,
      updatedAt: now
    }
    // 对照模式里做的标注，主进程会按这几个字去原文里找它在第几页，带着页码回来
    a.page = (await api.annSave(a)) ?? a.page
    setAnns((l) => [...l, a])
    void api.setSettings({ lastColor: color })
    window.getSelection()?.removeAllRanges()
    return a
  })
  const updateAnn = useEvent(async (a: Annotation) => {
    const n = { ...a, updatedAt: Date.now() }
    await api.annSave(n)
    setAnns((l) => l.map((x) => (x.id === a.id ? n : x)))
  })
  const deleteAnn = useEvent(async (a: Annotation) => {
    await api.annDelete(a.id)
    setAnns((l) => l.filter((x) => x.id !== a.id))
    toast(t('已删除高亮'), {
      label: t('撤销'),
      run: () => {
        void api.annSave(a).then(() => setAnns((l) => [...l, a]))
      }
    })
  })

  const showChat = useEvent(() => {
    setRightCollapsed(false)
    setFocusChat((n) => n + 1)
  })
  const askAi = useEvent((quote: string, extra?: string) => {
    setAttach({ quote, image: null, prefill: extra })
    showChat()
  })
  const askImage = useEvent((image: string, context: string, prefill?: string) => {
    setAttach({ quote: null, image, context, prefill })
    showChat()
  })

  const goTo = useEvent((a: Annotation) => {
    if (a.mode === 'reflow') {
      if (mode !== 'reflow') switchMode('reflow')
      if (a.blockId) setJump({ nonce: jumpSeq++, kind: 'block', blockId: a.blockId.replace(/:tr$/, ''), annId: a.id })
    } else {
      if (mode !== 'pdf') switchMode('pdf')
      if (a.page) setJump({ nonce: jumpSeq++, kind: 'page', page: a.page, annId: a.id, frac: a.rects?.[0]?.[1] })
    }
  })
  // 从笔记页点进来的：论文和标注都读到了以后，跳到那一条
  const cameFor = useRef(props.initialAnn)
  useEffect(() => {
    const a = cameFor.current && paper && mode ? anns.find((x) => x.id === cameFor.current) : undefined
    if (!a) return
    cameFor.current = undefined
    const t_ = setTimeout(() => goTo(a), 400)
    return () => clearTimeout(t_)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anns, paper, mode])
  const goBlock = useEvent((blockId: string) => {
    if (mode !== 'reflow') switchMode('reflow')
    setTimeout(() => setJump({ nonce: jumpSeq++, kind: 'block', blockId }), mode === 'reflow' ? 0 : 60)
  })
  const goHeading = useEvent((blockId: string) => {
    if (mode === 'pdf') {
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
        if (cmd === 'back') props.onBack()
        if (cmd === 'mode-pdf') switchMode('pdf')
        if (cmd === 'mode-reflow') switchMode('reflow')
        if (cmd === 'mode-glance') switchMode('glance')
        if (cmd === 'toggle-left') toggleLeft()
        if (cmd === 'toggle-right') toggleRight()
        if (cmd === 'export') void exportNotes()
        if (cmd === 'find') setFindOpen(true)
        if (cmd === 'translate-all') setTrAll(true)
        if (cmd === 'paper-info') setDialog('info')
        if (cmd === 'box-select') {
          if (mode !== 'reflow' || !doc) switchMode('pdf')
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
    if (mode === 'pdf') setZoomTo(cmd === 'zoom-reset' ? 1 : Math.min(3, Math.max(0.5, Math.round((zoom + (cmd === 'zoom-in' ? 0.1 : -0.1)) * 10) / 10)))
    else void api.setSettings({ readSize: cmd === 'zoom-reset' ? 18 : Math.min(24, Math.max(14, settings.readSize + (cmd === 'zoom-in' ? 1 : -1))) })
  })

  // 窗口放不下三栏时自动收一栏：刚点开的那一栏留着，收另一栏；窗口拉宽、放得下了再放回来。自动收的不记进设置
  const autoHid = useRef({ left: false, right: false })
  const lastOpened = useRef<'left' | 'right'>('right')
  const toggleLeft = useEvent(() => {
    autoHid.current.left = false
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
    const L = !leftCollapsed
    const R = !rightCollapsed && !floating
    const hid = autoHid.current
    if (!room(L, R)) {
      if (R && lastOpened.current === 'left') ((hid.right = true), setRightCollapsed(true))
      else ((hid.left = true), setLeftCollapsed(true))
    } else if (hid.left && !L && room(true, R)) ((hid.left = false), setLeftCollapsed(false))
    else if (hid.right && rightCollapsed && !floating && room(L, true)) ((hid.right = false), setRightCollapsed(false))
  }, [winW, leftCollapsed, rightCollapsed, leftW, rightFit, floating])

  const startResize = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = side === 'left' ? leftW : rightFit
    // 拖到正文只剩 MID_MIN 为止，不把另一栏挤掉
    const cap = winW - MID_MIN - (side === 'left' ? (rightCollapsed || floating ? 0 : rightFit) : leftCollapsed ? 0 : leftW)
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
    const cur = doc?.tier ?? null
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
        ...[0.75, 1, 1.25, 1.5, 2].map((z) => ({ id: String(z), label: `${Math.round(z * 100)}%`, checked: Math.abs(zoom - z) < 0.01 })),
        { type: 'separator' },
        { id: 'in', label: t('放大'), hint: '⌘=', checked: false },
        { id: 'out', label: t('缩小'), hint: '⌘-', checked: false }
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
  const gridCols = `${leftCollapsed ? 0 : leftW}px minmax(${MID_MIN}px, 1fr) ${showRight ? rightFit : 0}px`
  // 正文列窄的时候（13 寸屏幕开着 AI 栏）：标题栏里带字的按钮只留图标，不然搜索和显示设置会被挤出去
  const compact = winW - (leftCollapsed ? 0 : leftW) - (showRight ? rightFit : 0) < COMPACT_BAR
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
      {!leftCollapsed && (
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
            mode={mode}
            pdf={pdf}
            doc={doc}
            headings={headings}
            headingPages={headingPages}
            tr={tr}
            display={settings.display}
            curBlock={curBlock}
            curPage={curPage}
            anns={anns}
            sections={sections}
            sectionForPage={sectionForPage}
            keys={keys}
            keysBusy={keysBusy}
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
              if (mode !== 'pdf') switchMode('pdf')
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
        <div className={'titlebar drag mid-bar' + (leftCollapsed ? ' no-left' : '') + (showRight ? '' : ' no-right')}>
          {leftCollapsed && (
            <button className="icon-btn" title={t('显示左栏 ⌃⌘S')} onClick={toggleLeft}>
              <PanelLeft size={16} />
            </button>
          )}
          <button className="icon-btn" title={t('回文献库 ⌘[')} onClick={props.onBack}>
            <ChevronLeft size={16} />
          </button>
          <Segmented
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'pdf', label: t('原文'), title: '⌘1' },
              { value: 'reflow', label: t('对照'), busy: reflowBusy, title: '⌘2' },
              { value: 'glance', label: t('速览'), title: '⌘3' }
            ]}
          />
          {findOpen && <FindBar scroller={midRef} onClose={() => setFindOpen(false)} />}
          <div className="spacer" />
          <div className="bar-tools">
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
              <button className="btn ghost" title={t('重排引擎')} onClick={(e) => void engineMenu(e)}>
                {TIER_NAME[doc.tier]}
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
          {mode === 'pdf' && (
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
                {!compact && t('截图翻译')}
              </button>
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
              <button className="btn ghost num" title={t('缩放')} onClick={(e) => void zoomMenu(e)}>
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
          <button className={'icon-btn' + (aaOpen ? ' active' : '')} title={t('显示设置')} onClick={() => setAaOpen((v) => !v)}>
            <ALargeSmall size={16} />
          </button>
          {(rightCollapsed || floating) && (
            <button className={'icon-btn' + (floating && !rightCollapsed ? ' active' : '')} title={floating ? t('AI 悬浮窗 ⌃⌘I') : t('显示 AI 问答 ⌃⌘I')} onClick={toggleRight}>
              <PanelRight size={16} />
            </button>
          )}
        </div>
        {aaOpen && <AaPanel mode={mode} settings={settings} zoom={zoom} onZoom={setZoomTo} onClose={() => setAaOpen(false)} />}
        <div className="mid-body" ref={midRef}>
          {mode === 'pdf' &&
            (pdf ? (
              <PdfView
                pdf={pdf}
                paper={paper}
                anns={anns}
                zoom={zoom}
                invert={settings.pdfInvert}
                boxMode={boxMode}
                shot={shot}
                jump={jump}
                hoverAnn={hoverAnn}
                initial={posRef.current}
                onPosition={(page, frac, progress) => {
                  setCurPage(page)
                  onPosition({ page, pageFrac: frac }, progress)
                }}
                onSelect={(s) => {
                  setShot(null)
                  setSel(s)
                }}
                onBox={(img, page, frac, text) => {
                  setBoxMode(false)
                  setShot({ page, frac })
                  setSel({
                    text,
                    paragraph: pageTexts[page - 1] ?? '',
                    image: img,
                    target: null,
                    getRect: () => {
                      const el = document.querySelector(`.page[data-page="${page}"]`)
                      if (!el) return null
                      const r = el.getBoundingClientRect()
                      return new DOMRect(r.left + frac[0] * r.width, r.top + frac[1] * r.height, frac[2] * r.width, frac[3] * r.height)
                    }
                  })
                }}
                onRectsFound={(a, rects) => void api.annSave({ ...a, rects })}
                inkTool={inkTool}
                inks={inks}
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
              paper={paper}
              doc={doc}
              prog={prog}
              anns={anns}
              settings={settings}
              tr={tr}
              jump={jump}
              hoverAnn={hoverAnn}
              sections={sections}
              marks={keysOn ? keys : null}
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
          midRef={midRef}
          onClose={() => {
            setSel(null)
            setShot(null)
          }}
          onCreate={createAnn}
          onUpdate={updateAnn}
          onDelete={deleteAnn}
          onAsk={askAi}
          onAskImage={askImage}
        />
      </section>

      {/* 右栏 */}
      {showRight && (
        <aside className="col-right">
          <div className="titlebar drag right-bar">
            <span className="bar-title">{t('AI 问答')}</span>
            <div className="spacer" />
            {chatTools}
            <button className="icon-btn" title={t('改成悬浮窗')} onClick={() => void api.setSettings({ chatFloat: true })}>
              <PictureInPicture2 size={16} />
            </button>
            <button className="icon-btn" title={t('收起右栏 ⌃⌘I')} onClick={toggleRight}>
              <PanelRight size={16} />
            </button>
          </div>
          {chat}
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
            {t('AI 问答')}
            <span className="spacer" />
            {chatTools}
            <button className="icon-btn" title={t('放回右栏')} onClick={() => void api.setSettings({ chatFloat: false })}>
              <PanelRight size={16} />
            </button>
            <button className="icon-btn" title={t('收起')} onClick={toggleRight}>
              <Minimize2 size={16} />
            </button>
          </div>
          {chat}
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

function AaPanel(props: { mode: ReadMode; settings: SettingsView; zoom: number; onZoom: (z: number) => void; onClose: () => void }) {
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
                    t('排列'),
                    <Segmented
                      className="sm block"
                      value={s.trLayout}
                      onChange={(v) => set({ trLayout: v })}
                      options={[
                        { value: 'stack', label: t('上下') },
                        { value: 'side', label: t('左右') }
                      ]}
                    />
                  )}
                {s.display === 'both' &&
                  row(
                    t('意群'),
                    <>
                      <Switch on={s.senseGroups} onChange={(v) => set({ senseGroups: v })} label={t('意群')} />
                      <span className="aa-hint">{t('一句一行，对应的意群同色')}</span>
                    </>
                  )}
                {row(
                  t('译文样式'),
                  <Segmented
                    className="sm block"
                    value={s.trStyle}
                    onChange={(v) => set({ trStyle: v })}
                    options={[
                      { value: 'text', label: t('浅色字') },
                      { value: 'fill', label: t('浅底色') }
                    ]}
                  />
                )}
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
