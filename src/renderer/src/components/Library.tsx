import { ArrowDown, ArrowRight, ArrowUp, Bookmark, BookOpen, BookOpenCheck, Check, ChevronDown, Clock, Download, Eye, FileOutput, FileText, Folder as FolderIcon, FolderOpen, FolderPlus, Globe, LayoutGrid, LibraryBig, Link, List, ListChecks, MessagesSquare, PanelLeft, PanelRight, Pencil, Plus, Quote, RefreshCw, Search as SearchIcon, Trash2, User, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CITE_STYLES, citationText, type CiteStyle } from '@shared/cite'
import type { Folder, Paper, ReadMode, ScholareadPreview, SettingsView } from '@shared/types'
import { api, errText, type ImportResult, type ReflowProgress, type SearchMatch } from '../api'
import { showMenu, type MenuEntry } from '../lib/menu'
import { useThumb } from '../lib/thumbs'
import { useTitleTranslations } from '../lib/titles'
import { authorsShort, Empty, fmtOpened, groupOf, Kbd, Segmented, useToast } from '../lib/ui'
import { ExportDialog } from './ExportDialog'
import { BookmarkletDialog, UrlImport, WebSearch, ZoteroImport } from './ImportDialogs'
import { Inspector } from './Inspector'
import { folderPath, PaperInfo } from './PaperInfo'
import { SMART, smartCount } from './Sidebar'
import { t } from '@shared/i18n'
import { modKey, ON_WIN } from '@shared/kbd'

type SortKey = SettingsView['libSort']['key']
type Dialog = { kind: 'url' } | { kind: 'zotero' } | { kind: 'web'; q?: string } | { kind: 'bookmarklet' } | { kind: 'info'; id: string } | { kind: 'export'; id: string }

const SORT_LABEL: Record<SortKey, string> = { opened: t('最近打开'), added: t('添加时间'), title: t('标题'), year: t('年份'), progress: t('进度') }

export function Library(props: {
  settings: SettingsView
  papers: Paper[] | null
  folders: Folder[]
  filter: string
  sideHidden: boolean
  searchSignal: number
  initial: { top: number; selected: string[] }
  startWith: 'zotero' | null
  onShowSide: () => void
  onFilter: (f: string) => void
  onOpen: (id: string, st: { top: number; selected: string[] }, mode?: ReadMode) => void
  onAskTogether: (ids: string[]) => void
  onAiFind: (q: string) => void
}) {
  const s = props.settings
  const toast = useToast()
  const all = useMemo(() => props.papers ?? [], [props.papers])
  const folders = props.folders
  const filter = props.filter
  const [prog, setProg] = useState<Record<string, ReflowProgress>>({})
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [scopeAll, setScopeAll] = useState(true)
  const [deep, setDeep] = useState<SearchMatch[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [sort, setSortState] = useState(s.libSort)
  const [view, setViewState] = useState(s.libView)
  const [selected, setSelected] = useState<string[]>(props.initial.selected)
  const [batch, setBatch] = useState(false)
  const [insp, setInsp] = useState(true)
  const [drag, setDrag] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [sr, setSr] = useState<ScholareadPreview | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(props.startWith ? { kind: props.startWith } : null)
  const [zoteroCount, setZoteroCount] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const importArrow = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void api.srPreview().then(setSr)
    void api
      .zoteroScan()
      .then((z) => setZoteroCount(z.found ? (z.items?.length ?? 0) : null))
      .catch(() => setZoteroCount(null))
    return api.onReflowProgress((p) => setProg((m) => ({ ...m, [p.paperId]: p })))
  }, [])

  useEffect(() => {
    if (props.papers && listRef.current && props.initial.top) listRef.current.scrollTop = props.initial.top
    // 只在第一次拿到列表时恢复滚动位置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.papers === null])

  useEffect(() => {
    if (props.searchSignal) {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [props.searchSignal])

  // 搜索：标题作者本地即时过滤；摘要和全文 300ms 后问主进程
  useEffect(() => {
    const t_ = setTimeout(() => setQ(query.trim().toLowerCase()), 120)
    const t2 = setTimeout(() => {
      if (query.trim().length >= 2) void api.searchPapers(query).then(setDeep)
      else setDeep([])
    }, 300)
    return () => {
      clearTimeout(t_)
      clearTimeout(t2)
    }
  }, [query])

  const setSort = (v: SettingsView['libSort']): void => {
    setSortState(v)
    void api.setSettings({ libSort: v })
  }
  const setView = (v: SettingsView['libView']): void => {
    setViewState(v)
    void api.setSettings({ libView: v })
  }
  const remember = (text: string): void => {
    const t_ = text.trim()
    if (t_.length < 2) return
    void api.setSettings({ recentSearches: [t_, ...s.recentSearches.filter((x) => x !== t_)].slice(0, 8) })
  }

  const folderOf = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const curFolder = filter.startsWith('folder:') ? (folderOf.get(filter.slice(7)) ?? null) : null
  // 文件夹被删了就回到全部
  useEffect(() => {
    if (filter.startsWith('folder:') && folders.length && !curFolder) props.onFilter('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders])

  const deepById = useMemo(() => new Map(deep.map((d) => [d.id, d])), [deep])
  const inFilter = useCallback((p: Paper): boolean => (filter.startsWith('folder:') ? p.folders.includes(filter.slice(7)) : filter.startsWith('tag:') ? p.tags.includes(filter.slice(4)) : smartCount(filter, p)), [filter])
  const shown = useMemo(() => {
    let list = q && scopeAll ? all : all.filter(inFilter)
    if (q) list = list.filter((p) => (p.title + ' ' + p.authors.join(' ') + ' ' + (p.venue ?? '')).toLowerCase().includes(q) || deepById.has(p.id))
    const dir = sort.desc ? -1 : 1
    const val = (p: Paper): number | string =>
      sort.key === 'title' ? p.title.toLowerCase() : sort.key === 'year' ? (p.year ?? 0) : sort.key === 'progress' ? p.progress : sort.key === 'added' ? p.createdAt : Math.max(p.lastOpened ?? 0, p.createdAt)
    return [...list].sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0))
  }, [all, inFilter, q, scopeAll, sort, deepById])

  // 选中的论文不在当前列表里了（换了文件夹、删了）就去掉
  useEffect(() => {
    if (!props.papers) return
    const ids = new Set(shown.map((p) => p.id))
    setSelected((x) => (x.every((i) => ids.has(i)) ? x : x.filter((i) => ids.has(i))))
  }, [shown, props.papers])

  const titleTr = useTitleTranslations(
    useMemo(() => shown.map((p) => p.title), [shown]),
    s.targetLang,
    s.titleTr !== 'off'
  )
  const titleLine = (p: Paper): { main: string; sub?: string } => {
    const tr = titleTr[p.title]
    return s.titleTr === 'tr' && tr ? { main: tr, sub: p.title } : { main: p.title, sub: tr }
  }

  const open = (id: string, mode?: ReadMode): void => {
    remember(query)
    props.onOpen(id, { top: listRef.current?.scrollTop ?? 0, selected: [id] }, mode)
  }

  const reveal = (id: string): void => {
    setSelected([id])
    setFlash(id)
    setTimeout(() => document.querySelector(`[data-paper="${id}"]`)?.scrollIntoView({ block: 'center' }), 50)
    setTimeout(() => setFlash(null), 1400)
  }
  const handleImportResults = (res: ImportResult[]): void => {
    const failed = res.filter((r) => r.status === 'failed')
    const dup = res.find((r) => r.status === 'duplicate')
    const added = res.flatMap((r) => (r.status === 'added' ? [r.paper.id] : []))
    if (failed.length) toast(t('{0} 个文件没导入：{1}', failed.length, failed[0].status === 'failed' ? failed[0].error : ''))
    else if (dup && dup.status === 'duplicate' && !added.length) {
      toast(t('已在库里'))
      reveal(dup.paper.id)
    } else if (added.length) toast(added.length > 1 ? t('导入了 {0} 篇', added.length) : t('导入了 1 篇，正在重排'))
    // 在文件夹里导入的直接放进这个文件夹
    if (curFolder && added.length) void api.setFolders(added, [curFolder.id], [])
    if (added.length) setSelected([added[0]])
  }
  const doImport = async (paths?: string[]): Promise<void> => {
    try {
      handleImportResults(await api.importPdfs(paths))
    } catch (e) {
      toast(t('导入失败：{0}', errText(e)))
    }
  }
  const importScholaread = async (): Promise<void> => {
    try {
      const r = await api.srImport()
      const parts = [t('导入 {0} 篇', r.papersAdded)]
      if (r.papersMatched) parts.push(t('{0} 篇已在库里', r.papersMatched))
      parts.push(t('{0} 条笔记', r.notesAdded))
      if (r.papersSkipped.length) parts.push(t('{0} 篇跳过（{1}）', r.papersSkipped.length, r.papersSkipped[0].reason))
      toast(t('从 Scholaread {0}', parts.join('，')))
    } catch (e) {
      toast(t('从 Scholaread 导入失败：{0}', errText(e)))
    }
  }

  const importMenu = async (): Promise<void> => {
    if (!importArrow.current) return
    const act = await showMenu(
      [
        { id: 'file', label: t('导入 PDF 或 EPUB…'), icon: <FileText size={16} />, hint: '⌘O' },
        { id: 'url', label: t('从网址导入…'), icon: <Link size={16} />, hint: 'arXiv、DOI' },
        { id: 'zotero', label: t('从 Zotero 导入…'), icon: <LibraryBig size={16} />, hint: zoteroCount !== null ? t('{0} 篇', zoteroCount) : undefined },
        { id: 'scholaread', label: t('从 Scholaread 导入…'), icon: <Download size={16} />, hint: sr?.found ? t('{0} 篇', sr.papers) : t('没找到'), enabled: !!sr?.found },
        { type: 'separator' },
        { id: 'web', label: t('全网检索论文…'), icon: <Globe size={16} />, hint: '⇧⌘F' },
        { id: 'bookmarklet', label: t('浏览器小书签…'), icon: <Bookmark size={16} /> }
      ],
      { el: importArrow.current, align: 'right' }
    )
    if (act === 'file') void doImport()
    if (act === 'url' || act === 'zotero' || act === 'web' || act === 'bookmarklet') setDialog({ kind: act })
    if (act === 'scholaread') void importScholaread()
  }

  useEffect(
    () =>
      api.onCommand((cmd) => {
        if (dialog) return
        if (cmd === 'import') void doImport()
        if (cmd === 'import-url') setDialog({ kind: 'url' })
        if (cmd === 'web-search') setDialog({ kind: 'web' })
        if (cmd === 'scholaread') void importScholaread()
        if (cmd === 'find') {
          searchRef.current?.focus()
          searchRef.current?.select()
        }
        if (cmd === 'toggle-right') setInsp((v) => !v)
        if (cmd === 'paper-info' && selected[0]) setDialog({ kind: 'info', id: selected[0] })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialog, selected, curFolder]
  )

  // 移到文件夹的子菜单：当前所在的打勾，再点一次是移出
  const folderEntries = (ids: string[]): MenuEntry[] => {
    const items: MenuEntry[] = []
    const ps = all.filter((p) => ids.includes(p.id))
    const walk = (parent: string | null, depth: number): void => {
      for (const f of folders.filter((x) => x.parentId === parent)) {
        items.push({
          id: `folder:${f.id}`,
          checked: ps.length > 0 && ps.every((p) => p.folders.includes(f.id)),
          icon: <FolderIcon size={16} style={{ marginLeft: depth * 14 }} />,
          label: f.name
        })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    if (items.length) items.push({ type: 'separator' })
    items.push({ id: 'folder:__new', label: t('新建文件夹…'), icon: <FolderPlus size={16} />, checked: false })
    return items
  }
  const toggleFolder = async (ids: string[], fid: string): Promise<void> => {
    if (fid === '__new') {
      const id = await api.createFolder(t('新文件夹'), null)
      await api.setFolders(ids, [id], [])
      toast(t('已放进「新文件夹」，在左边双击改名'))
      return
    }
    const ps = all.filter((p) => ids.includes(p.id))
    const name = folderOf.get(fid)?.name ?? ''
    if (ps.every((p) => p.folders.includes(fid))) {
      await api.setFolders(ids, [], [fid])
      toast(t('已从「{0}」移出', name))
    } else {
      await api.setFolders(ids, [fid], [])
      toast(t('已放进「{0}」', name))
    }
  }
  const citeEntries = (): MenuEntry[] => CITE_STYLES.map((c) => ({ id: `cite:${c.id}`, label: c.name }))
  const copyCite = (ids: string[], style: CiteStyle): void => {
    const ps = ids.map((i) => all.find((p) => p.id === i)).filter((p): p is Paper => !!p)
    const sep = style === 'bibtex' || style === 'ris' ? '\n\n' : '\n'
    void navigator.clipboard.writeText(ps.map((p, i) => (style === 'ieee' && ps.length > 1 ? `[${i + 1}] ` : '') + citationText(p, style)).join(sep))
    toast(t('已复制{0} {1} 引用', ps.length > 1 ? t(' {0} 条', ps.length) : '', CITE_STYLES.find((c) => c.id === style)?.name))
  }
  const markRead = async (ids: string[], read: boolean): Promise<void> => {
    for (const i of ids) await api.updatePaper(i, { progress: read ? 1 : 0 })
    toast(read ? t('已标记读完{0}', ids.length > 1 ? t(' {0} 篇', ids.length) : '') : t('已标记未读'))
  }
  const remove = async (ids: string[]): Promise<void> => {
    await api.deletePapers(ids)
    setSelected([])
    toast(ids.length > 1 ? t('已删除 {0} 篇', ids.length) : t('已删除'), { label: t('撤销'), run: () => void api.restorePapers(ids) })
  }

  const paperMenu = async (at: React.MouseEvent | { el: Element }, id: string): Promise<void> => {
    const ids = selected.includes(id) ? selected : [id]
    if (!selected.includes(id)) setSelected([id])
    const one = ids.length === 1
    const p = all.find((x) => x.id === id)
    if (!p) return
    const failed = p.reflow.flash === 'failed' || p.reflow.basic === 'failed'
    const sep: MenuEntry = { type: 'separator' }
    const act = await showMenu(
      [
        ...(one
          ? [
              { id: 'open', label: t('打开'), icon: <BookOpen size={16} />, hint: '↩' },
              ...(p.kind === 'pdf' ? [{ id: 'pdf', label: t('看原文'), icon: <FileText size={16} /> }] : []),
              { id: 'insp', label: insp ? t('收起速览栏') : t('速览'), icon: <Eye size={16} />, hint: t('空格') },
              sep
            ]
          : []),
        { label: t('移到文件夹'), icon: <FolderIcon size={16} />, submenu: folderEntries(ids) },
        ...(one ? [{ id: 'info', label: t('编辑文献信息…'), icon: <Pencil size={16} />, hint: '⌘I' }] : []),
        { label: t('复制引用'), icon: <Quote size={16} />, submenu: citeEntries() },
        p.progress >= 1 ? { id: 'unread', label: t('标记为未读'), icon: <BookOpen size={16} /> } : { id: 'read', label: t('标记为读完'), icon: <BookOpenCheck size={16} /> },
        ...(!one ? [{ id: 'ask', label: t('一起问 AI（{0} 篇）', ids.length), icon: <MessagesSquare size={16} /> }] : []),
        sep,
        ...(one
          ? [
              ...(p.kind !== 'link' ? [{ id: 'reveal', label: t('在 Finder 中显示'), icon: <FolderOpen size={16} /> }] : []),
              ...(p.kind === 'pdf' ? [{ id: 'export', label: t('导出双语 PDF…'), icon: <FileOutput size={16} /> }] : []),
              { id: 'enrich', label: t('从网上补全信息'), icon: <RefreshCw size={16} /> },
              ...(failed ? [{ id: 'retry', label: t('重试重排'), icon: <RefreshCw size={16} /> }] : []),
              sep
            ]
          : []),
        { id: 'delete', label: one ? t('删除') : t('删除 {0} 篇', ids.length), icon: <Trash2 size={16} />, hint: '⌘⌫', danger: true }
      ],
      at
    )
    if (!act) return
    if (act === 'open') open(id)
    if (act === 'pdf') open(id, 'pdf')
    if (act === 'insp') setInsp((v) => !v)
    if (act === 'info') setDialog({ kind: 'info', id })
    if (act === 'export') setDialog({ kind: 'export', id })
    if (act.startsWith('folder:')) void toggleFolder(ids, act.slice(7))
    if (act.startsWith('cite:')) copyCite(ids, act.slice(5) as CiteStyle)
    if (act === 'read' || act === 'unread') void markRead(ids, act === 'read')
    if (act === 'ask') props.onAskTogether(ids)
    if (act === 'reveal') void api.revealPaper(id)
    if (act === 'enrich')
      void api
        .enrichPaper(id)
        .then(() => toast(t('已更新信息')))
        .catch((er) => toast(t('获取失败：{0}', errText(er))))
    if (act === 'retry') void api.retryReflow(id)
    if (act === 'delete') void remove(ids)
  }

  // 单击选中，⌘ 点或多选模式下加减，⇧ 点连选；双击打开
  const onItemClick = (e: React.MouseEvent, id: string, idx: number): void => {
    listRef.current?.focus({ preventScroll: true })
    if (batch || modKey(e)) setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
    else if (e.shiftKey && selected.length) {
      const last = shown.findIndex((p) => p.id === selected[selected.length - 1])
      const [a, b] = [Math.min(last, idx), Math.max(last, idx)]
      setSelected(shown.slice(a, b + 1).map((p) => p.id))
    } else setSelected([id])
  }

  // 列表上的键盘：上下移动、回车打开、空格开关速览栏、⌘A 全选、⌘⌫ 删除、Esc 退出多选
  const onListKey = (e: React.KeyboardEvent): void => {
    const idx = shown.findIndex((p) => p.id === selected[selected.length - 1])
    const cols = view === 'card' ? Math.max(1, Math.floor(((listRef.current?.clientWidth ?? 800) - 48 + 16) / (172 + 16))) : 1
    const move = (d: number): void => {
      const n = shown[Math.min(shown.length - 1, Math.max(0, idx < 0 ? 0 : idx + d))]
      if (!n) return
      setSelected(e.shiftKey || batch ? [...new Set([...selected, n.id])] : [n.id])
      document.querySelector(`[data-paper="${n.id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'ArrowDown') move(cols)
    else if (e.key === 'ArrowUp') move(-cols)
    else if (e.key === 'ArrowRight' && view === 'card') move(1)
    else if (e.key === 'ArrowLeft' && view === 'card') move(-1)
    else if (e.key === 'Enter' && selected.length === 1) open(selected[0])
    else if (e.key === ' ') setInsp((v) => !v)
    else if (e.key === 'a' && modKey(e)) setSelected(shown.map((p) => p.id))
    // 删除：Mac 上 ⌘⌫，Windows 上 Delete（照各自的文件管理器）
    else if (selected.length && (ON_WIN ? e.key === 'Delete' : e.key === 'Backspace' && e.metaKey)) void remove(selected)
    else if (e.key === 'Escape' && (batch || selected.length > 1)) {
      setBatch(false)
      setSelected(selected.slice(-1))
    } else return
    e.preventDefault()
  }

  // 拖论文进文件夹：带上被拖的论文 id
  const onItemDragStart = (e: React.DragEvent, id: string): void => {
    const ids = selected.includes(id) ? selected : [id]
    e.dataTransfer.setData('application/x-papers', JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'copy'
  }
  // 拖入 PDF / EPUB
  const isOurs = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('application/x-papers') || e.dataTransfer.types.includes('application/x-folder')
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDrag(0)
    if (isOurs(e)) return
    const paths = [...e.dataTransfer.files].filter((f) => /\.(pdf|epub)$/i.test(f.name)).map((f) => api.filePath(f))
    if (paths.length) void doImport(paths)
  }

  const SortHead = (p: { k: SortKey; label: string; className: string }) => (
    <button className={'th ' + p.className + (sort.key === p.k ? ' on' : '')} onClick={() => setSort({ key: p.k, desc: sort.key === p.k ? !sort.desc : p.k !== 'title' })}>
      {p.label}
      {sort.key === p.k && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  )
  const sortMenu = async (e: React.MouseEvent): Promise<void> => {
    const act = await showMenu(
      [
        ...(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ id: k, label: SORT_LABEL[k], checked: sort.key === k })),
        { type: 'separator' },
        { id: 'desc', label: t('从新到旧 / 从大到小'), checked: sort.desc },
        { id: 'asc', label: t('从旧到新 / 从小到大'), checked: !sort.desc }
      ],
      { el: e.currentTarget, align: 'right' }
    )
    if (act === 'desc' || act === 'asc') setSort({ ...sort, desc: act === 'desc' })
    else if (act) setSort({ key: act as SortKey, desc: act !== 'title' })
  }

  // 搜索建议：作者、文件夹、最近搜索，范围切换，到全网检索
  const suggestions = useMemo(() => {
    const t_ = query.trim().toLowerCase()
    const authorCount = new Map<string, number>()
    if (t_) for (const p of all) for (const a of p.authors) if (a.toLowerCase().includes(t_)) authorCount.set(a, (authorCount.get(a) ?? 0) + 1)
    return {
      authors: [...authorCount].sort((a, b) => b[1] - a[1]).slice(0, 3),
      folders: t_ ? folders.filter((f) => f.name.toLowerCase().includes(t_)).slice(0, 3) : [],
      recent: s.recentSearches.filter((r) => !t_ || (r.toLowerCase().includes(t_) && r.toLowerCase() !== t_)).slice(0, 3)
    }
  }, [query, all, folders, s.recentSearches])

  const grouped = (sort.key === 'opened' || sort.key === 'added') && sort.desc && !q
  const pageTitle = curFolder ? curFolder.name : filter.startsWith('tag:') ? `# ${filter.slice(4)}` : (SMART.find((x) => x.id === filter)?.label ?? t('全部论文'))
  const empty = props.papers !== null && props.papers.length === 0
  const selPapers = selected.map((i) => all.find((p) => p.id === i)).filter((p): p is Paper => !!p)
  const scopeLabel = q ? t('找到 {0} 篇 · 范围：{1}', shown.length, scopeAll ? t('全部论文') : pageTitle) : ''

  let lastGroup = ''
  const groupHead = (p: Paper): React.ReactNode => {
    if (!grouped) return null
    const g = groupOf(sort.key === 'added' ? p.createdAt : (p.lastOpened ?? p.createdAt))
    if (g === lastGroup) return null
    lastGroup = g
    return <div className="grp-title">{g}</div>
  }

  const subLine = (p: Paper): React.ReactNode => {
    const d = deepById.get(p.id)
    if (q && d && d.where !== 'title' && d.where !== 'author')
      return (
        <span className="a">
          <Hl text={authorsShort(p.authors)} q={q} />
          {' · '}
          <span className="hit-where">{d.where === 'abstract' ? t('摘要') : d.where === 'venue' ? t('期刊') : t('正文')}</span>
          <Hl text={d.snippet} q={q} />
        </span>
      )
    return (
      <span className="a">
        <Hl text={authorsShort(p.authors)} q={q} />
        {p.venue && <span className="v"> · {p.venue}</span>}
      </span>
    )
  }

  return (
    <>
      <header className={'hdr drag' + (props.sideHidden ? ' side-hidden' : '')}>
        {props.sideHidden && (
          <button className="icon-btn" title={t('显示侧栏 ⌃⌘S')} onClick={props.onShowSide}>
            <PanelLeft size={16} />
          </button>
        )}
        <h1 className="page-title">{q ? t('搜索结果') : pageTitle}</h1>
        {!empty && <span className="sub num">{q ? t('找到 {0} 篇', shown.length) : t('{0} 篇', shown.length)}</span>}
        <div className="spacer" />
        <div className="no-drag" style={{ position: 'relative' }}>
          <label className="field-fill" style={{ width: 260 }}>
            <SearchIcon size={16} />
            <input
              ref={searchRef}
              placeholder={t('搜标题、作者、摘要、全文')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSuggestOpen(true)
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (query) setQuery('')
                  else searchRef.current?.blur()
                  setSuggestOpen(false)
                }
                if (e.key === 'Enter') {
                  remember(query)
                  setSuggestOpen(false)
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSuggestOpen(false)
                  listRef.current?.focus()
                  if (shown[0]) setSelected([shown[0].id])
                }
              }}
            />
            {query ? (
              <button className="icon-btn sm" style={{ width: 18, height: 18 }} title={t('清除')} onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : (
              <span style={{ display: 'inline-flex', gap: 2 }}>
                <Kbd>⌘</Kbd>
                <Kbd>F</Kbd>
              </span>
            )}
          </label>
          {suggestOpen && (query.trim() || suggestions.recent.length > 0) && (
            <div className="pop suggest" style={{ position: 'absolute', top: 34, right: 0 }} onMouseDown={(e) => e.preventDefault()}>
              {suggestions.authors.length > 0 && <div className="menu-sec">{t('作者')}</div>}
              {suggestions.authors.map(([a, n]) => (
                <button key={'a' + a} className="menu-item" onClick={() => setQuery(a)}>
                  <User size={16} />
                  <span className="ellipsis">{a}</span>
                  <span className="h">{t('{0} 篇', n)}</span>
                </button>
              ))}
              {suggestions.folders.length > 0 && <div className="menu-sec">{t('文件夹')}</div>}
              {suggestions.folders.map((f) => (
                <button
                  key={'f' + f.id}
                  className="menu-item"
                  onClick={() => {
                    setQuery('')
                    props.onFilter(`folder:${f.id}`)
                    searchRef.current?.blur()
                  }}
                >
                  <FolderIcon size={16} />
                  <span className="ellipsis">{folderPath(folders, f)}</span>
                  <span className="h">{t('{0} 篇', f.count)}</span>
                </button>
              ))}
              {suggestions.recent.length > 0 && <div className="menu-sec">{t('最近搜索')}</div>}
              {suggestions.recent.map((r) => (
                <button key={'r' + r} className="menu-item" onClick={() => setQuery(r)}>
                  <Clock size={16} />
                  <span className="ellipsis">{r}</span>
                </button>
              ))}
              {query.trim() && (
                <>
                  {(suggestions.authors.length > 0 || suggestions.folders.length > 0 || suggestions.recent.length > 0) && <div className="menu-sep" />}
                  {filter !== 'all' && (
                    <div className="suggest-scope">
                      <span className="hint">{t('范围')}</span>
                      <Segmented
                        className="sm"
                        value={scopeAll ? 'all' : 'here'}
                        onChange={(v) => setScopeAll(v === 'all')}
                        options={[
                          { value: 'here', label: curFolder ? t('当前文件夹') : pageTitle },
                          { value: 'all', label: t('全部') }
                        ]}
                      />
                    </div>
                  )}
                  <button
                    className="menu-item"
                    onClick={() => {
                      remember(query)
                      setDialog({ kind: 'web', q: query.trim() })
                      setSuggestOpen(false)
                    }}
                  >
                    <Globe size={16} />
                    <span className="ellipsis">{t('到全网检索「{0}」', query.trim())}</span>
                    <span className="h">
                      <ArrowRight size={14} />
                    </span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="seg" role="radiogroup" title={t('列表 / 卡片')}>
          <button className={'seg-item icon' + (view === 'table' ? ' on' : '')} title={t('列表')} onClick={() => setView('table')}>
            <List size={16} />
          </button>
          <button className={'seg-item icon' + (view === 'card' ? ' on' : '')} title={t('卡片')} onClick={() => setView('card')}>
            <LayoutGrid size={16} />
          </button>
        </div>
        <button
          className={'icon-btn' + (batch ? ' active' : '')}
          title={t('多选')}
          onClick={() => {
            setBatch((v) => !v)
            setSelected((x) => x.slice(-1))
          }}
        >
          <ListChecks size={16} />
        </button>
        <button className={'icon-btn' + (insp ? ' active' : '')} title={t('速览栏 ⌃⌘I')} onClick={() => setInsp((v) => !v)}>
          <PanelRight size={16} />
        </button>
        <div className="btn-group">
          <button className="btn primary" title={t('导入 PDF 或 EPUB ⌘O')} onClick={() => void doImport()}>
            <Plus size={16} />
            {t('导入')}
          </button>
          <button ref={importArrow} className="btn primary" title={t('更多导入方式')} onClick={() => void importMenu()}>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>

      <div className="lib-body">
        <div
          className="lib-list"
          onDragEnter={(e) => {
            if (isOurs(e)) return
            e.preventDefault()
            setDrag(e.dataTransfer.items.length || 1)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(0)
          }}
          onDrop={onDrop}
        >
          {empty ? (
            <div className="lib-empty">
              <Empty
                icon={<FileText size={32} strokeWidth={1.5} />}
                title={t('还没有论文')}
                text={t('把 PDF 或 EPUB 拖进窗口，或点右上角「导入」；也能粘贴 arXiv、DOI 网址。')}
                action={
                  zoteroCount ? (
                    <button className="btn" onClick={() => setDialog({ kind: 'zotero' })}>
                      <LibraryBig size={16} />{t('从 Zotero 导入 {0} 篇', zoteroCount)}
                    </button>
                  ) : sr?.found ? (
                    <button className="btn" onClick={() => void importScholaread()}>
                      <Download size={16} />{t('从 Scholaread 导入 {0} 篇', sr.papers)}
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : view === 'table' ? (
            <>
              <div className="thead">
                <span style={{ width: batch ? 16 : 12, flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0 }}>{q ? scopeLabel : <SortHead k="title" label={t('标题和作者')} className="" />}</span>
                <SortHead k="year" label={t('年份')} className="c-year" />
                <SortHead k="progress" label={t('进度')} className="c-prog" />
                {sort.key === 'added' ? <SortHead k="added" label={t('添加时间')} className="c-time" /> : <SortHead k="opened" label={t('最近打开')} className="c-time" />}
              </div>
              <div className="lib-scroll" ref={listRef} tabIndex={0} onKeyDown={onListKey}>
                {shown.length === 0 && <div className="no-result">{q ? t('没有找到「{0}」', query.trim()) : curFolder ? t('这个文件夹里还没有论文，把论文拖到左边的文件夹上') : t('这里还没有论文')}</div>}
                {shown.map((p, i) => {
                  const t_ = titleLine(p)
                  const on = selected.includes(p.id)
                  return (
                    <div key={p.id}>
                      {groupHead(p)}
                      <div
                        className={'row' + (on ? ' on' : '') + (flash === p.id ? ' flash' : '')}
                        data-paper={p.id}
                        draggable
                        title={t('单击选中，双击打开')}
                        onDragStart={(e) => onItemDragStart(e, p.id)}
                        onClick={(e) => onItemClick(e, p.id, i)}
                        onDoubleClick={() => !batch && open(p.id)}
                        onContextMenu={(e) => void paperMenu(e, p.id)}
                      >
                        {batch ? (
                          <span className="c-check">
                            <span className={'checkbox' + (on ? ' on' : '')}>{on && <Check size={12} strokeWidth={3} />}</span>
                          </span>
                        ) : (
                          <span className="c-dot">{!p.lastOpened && <i className="dot accent sm" aria-label={t('未读')} />}</span>
                        )}
                        <div className="c1">
                          <span className="t">
                            <Hl text={t_.main} q={q} />
                          </span>
                          {t_.sub && <span className="t-tr">{t_.sub}</span>}
                          {subLine(p)}
                        </div>
                        <span className="c-year">{p.year ?? ''}</span>
                        <span className="c-prog">
                          <ProgressCell p={p} live={prog[p.id]} />
                        </span>
                        <span className="c-time">{fmtOpened(sort.key === 'added' ? p.createdAt : p.lastOpened)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div className="thead">
                <span style={{ flex: 1, minWidth: 0 }}>{scopeLabel}</span>
                <button className="th on" onClick={(e) => void sortMenu(e)}>
                  {SORT_LABEL[sort.key]}
                  {sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                </button>
              </div>
              <div className="lib-scroll" ref={listRef} tabIndex={0} onKeyDown={onListKey}>
                {shown.length === 0 && <div className="no-result">{q ? t('没有找到「{0}」', query.trim()) : t('这里还没有论文')}</div>}
                <div className="grid">
                  {shown.map((p, i) => (
                    <Card
                      key={p.id}
                      p={p}
                      title={titleLine(p).main}
                      batch={batch}
                      selected={selected.includes(p.id)}
                      flash={flash === p.id}
                      live={prog[p.id]}
                      onClick={(e) => onItemClick(e, p.id, i)}
                      onOpen={() => !batch && open(p.id)}
                      onMenu={(e) => void paperMenu(e, p.id)}
                      onDragStart={(e) => onItemDragStart(e, p.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
          {(batch || selected.length > 1) && (
            <div className="batch">
              <span className="n num">{t('已选 {0} 篇', selected.length)}</span>
              <button className="btn ghost sm" onClick={() => setSelected(selected.length === shown.length ? [] : shown.map((p) => p.id))}>
                {selected.length === shown.length ? t('全不选') : t('全选')}
              </button>
              <span className="vr" />
              <button
                className="btn ghost"
                disabled={!selected.length}
                onClick={async (e) => {
                  const act = await showMenu(folderEntries(selected), { el: e.currentTarget })
                  if (act?.startsWith('folder:')) void toggleFolder(selected, act.slice(7))
                }}
              >
                <FolderIcon size={16} />
                {t('移到文件夹')}
                <ChevronDown size={12} />
              </button>
              <button className="btn ghost" disabled={!selected.length} onClick={() => void markRead(selected, true)}>
                <BookOpenCheck size={16} />
                {t('标记读完')}
              </button>
              <button
                className="btn ghost"
                disabled={!selected.length}
                onClick={async (e) => {
                  const act = await showMenu(citeEntries(), { el: e.currentTarget })
                  if (act) copyCite(selected, act.slice(5) as CiteStyle)
                }}
              >
                <Quote size={16} />
                {t('复制引用')}
              </button>
              <button className="btn ghost" disabled={selected.length < 2} onClick={() => props.onAskTogether(selected)}>
                <MessagesSquare size={16} />
                {t('一起问 AI')}
              </button>
              <button className="btn ghost danger" disabled={!selected.length} onClick={() => void remove(selected)}>
                <Trash2 size={16} />
                {t('删除')}
              </button>
              <span className="vr" />
              <button
                className="btn ghost"
                onClick={() => {
                  setBatch(false)
                  setSelected((x) => x.slice(-1))
                }}
              >
                {t('完成 ')}<Kbd>esc</Kbd>
              </button>
            </div>
          )}
          {drag > 0 && (
            <div className="drop-zone">
              <Download size={32} strokeWidth={1.5} />
              <div>{drag > 1 ? t('松手导入 {0} 个文件', drag) : t('松手导入')}</div>
            </div>
          )}
        </div>
        {insp && !empty && (
          <Inspector
            papers={selPapers}
            settings={s}
            folders={folders}
            onOpen={(id, mode) => open(id, mode)}
            onInfo={(id) => setDialog({ kind: 'info', id })}
            onMenu={(el, id) => void paperMenu({ el }, id)}
            onAskTogether={() => props.onAskTogether(selected)}
          />
        )}
      </div>

      {dialog?.kind === 'url' && <UrlImport folders={folders} folder={curFolder?.id ?? null} onClose={() => setDialog(null)} onAdded={reveal} />}
      {dialog?.kind === 'zotero' && <ZoteroImport onClose={() => setDialog(null)} />}
      {dialog?.kind === 'web' && <WebSearch folders={folders} folder={curFolder?.id ?? null} q={dialog.q} onClose={() => setDialog(null)} onAiFind={props.onAiFind} />}
      {dialog?.kind === 'bookmarklet' && <BookmarkletDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'info' && <PaperInfo id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'export' && <ExportDialog id={dialog.id} onClose={() => setDialog(null)} />}
    </>
  )
}

function Card(p: {
  p: Paper
  title: string
  batch: boolean
  selected: boolean
  flash: boolean
  live?: ReflowProgress
  onClick: (e: React.MouseEvent) => void
  onOpen: () => void
  onMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
}) {
  return (
    <div
      className={'card' + (p.selected ? ' on' : '') + (p.flash ? ' flash' : '')}
      data-paper={p.p.id}
      draggable
      title={t('单击选中，双击打开')}
      onDragStart={p.onDragStart}
      onClick={p.onClick}
      onDoubleClick={p.onOpen}
      onContextMenu={p.onMenu}
    >
      <div className="cv">
        <Thumb p={p.p} />
        {p.batch && <span className={'checkbox' + (p.selected ? ' on' : '')}>{p.selected && <Check size={12} strokeWidth={3} />}</span>}
      </div>
      <div className="ct" title={p.p.title}>
        {!p.p.lastOpened && <i className="dot accent sm" style={{ verticalAlign: 2, marginRight: 6 }} aria-label={t('未读')} />}
        {p.title}
      </div>
      <div className="ca">{authorsShort(p.p.authors)}</div>
      <div className="cm">
        <span className="num">{p.p.year ?? ''}</span>
        <ProgressCell p={p.p} live={p.live} card />
      </div>
    </div>
  )
}

export function Thumb(props: { p: Paper; width?: number; style?: React.CSSProperties }) {
  const th = useThumb(props.p.id, props.p.kind)
  return (
    <div className="thumbx" ref={th.ref} style={{ width: props.width ?? '100%', ...props.style }}>
      {th.url ? <img src={th.url} alt="" draggable={false} /> : <div className="ph">{props.p.kind === 'epub' ? 'EPUB' : props.p.kind === 'link' ? t('仅链接') : ''}</div>}
    </div>
  )
}

function Hl(props: { text: string; q: string }) {
  if (!props.q) return <>{props.text}</>
  const i = props.text.toLowerCase().indexOf(props.q)
  if (i < 0) return <>{props.text}</>
  return (
    <>
      {props.text.slice(0, i)}
      <mark className="hit">{props.text.slice(i, i + props.q.length)}</mark>
      {props.text.slice(i + props.q.length)}
    </>
  )
}

function ProgressCell(props: { p: Paper; live?: ReflowProgress; card?: boolean }) {
  const { p, live } = props
  const running = live?.status === 'running' ? live : null
  if (running && !p.reflow.ready)
    return (
      <span className="parse">
        <span className="spin spin-10" />
        {t('解析中')}{running.percent !== null ? ` ${running.percent}%` : ''}
      </span>
    )
  const failed = (live?.status === 'failed' || p.reflow.flash === 'failed' || (p.scanned && p.reflow.basic === 'failed')) && !p.reflow.ready
  if (failed)
    return (
      <span className="parse" title={live?.error ?? p.reflow.error ?? ''}>
        <i className="dot sm err" />
        {t('解析失败')}
      </span>
    )
  if (p.kind === 'link') return <span>{props.card && '· '}{t('仅链接')}</span>
  if (p.progress >= 1) return <span>{props.card && '· '}{t('读完')}</span>
  if (p.progress > 0)
    return (
      <span className="bar" aria-label={`${Math.round(p.progress * 100)}%`}>
        <i style={{ width: `${Math.max(4, p.progress * 100)}%` }} />
      </span>
    )
  return null
}
