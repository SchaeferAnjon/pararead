import { ChartBar, Ellipsis, FileDown, PanelLeft, Pencil, Plus, Sheet, SquarePen, Trash2, Waypoints, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { isRel, splitCell, type MatrixState } from '@shared/matrix'
import { api, errText, type MatrixView, type OpenAt, type ResearchSession } from '../../api'
import { showMenu } from '../../lib/menu'
import { Segmented, useDebounced, useToast } from '../../lib/ui'
import '../../styles/writing.css'
import { MetricsView, RelationsView, TableView } from './views'
import { NotesDrawer, SourceDrawer, type Src } from './SourceDrawer'
import { WriteDrawer } from './WriteDrawer'

type View = 'table' | 'rel' | 'met'
export type Drawer = { kind: 'src'; src: Src } | { kind: 'notes'; paperId: string } | { kind: 'write' } | null

/** 对比表里一篇论文的称呼：题目里的缩写（MAGIC），没有就用题目 */
export type MPaper = MatrixView['papers'][number]

// 综述对比表页：学术 AI 的一种会话。表格 / 关系 / 指标三种看法，右边出处或「写一段」抽屉
export function MatrixPage(props: { session: ResearchSession; sideHidden: boolean; onShowSide: () => void; onDeleted: () => void; onOpenPaper: (id: string, at?: OpenAt, ann?: string) => void; onRenamed: () => void }) {
  const sid = props.session.id
  const toast = useToast()
  const [v, setV] = useState<MatrixView | null>(null)
  const [view, setView] = useState<View>('table')
  const [sel, setSel] = useState<string[]>([])
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [lit, setLit] = useState<string[]>([])
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const started = useRef(false)

  const load = useCallback(async () => {
    const r = await api.matrixGet(sid)
    setV(r)
    return r
  }, [sid])
  useEffect(() => {
    void load().then((r) => {
      setSel(r.state.selected)
      // 上次没填完（应用关了、刚建好）：接着填。失败的行等用户点重试
      if (!started.current && r.state.rows.some((x) => x.status === 'queued' || x.status === 'running')) {
        started.current = true
        void api.matrixBuild(sid)
      }
    })
    const offs = [
      api.onMatrixChanged((p) => p.sessionId === sid && void load()),
      api.onResearchChanged(props.onRenamed),
      api.onLibraryChanged(() => void load())
    ]
    return () => offs.forEach((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, load])

  const saveSel = useDebounced((ids: string[]) => void api.matrixSelect(sid, ids), 300)
  const toggle = (id: string, on?: boolean): void => {
    setSel((cur) => {
      const want = on ?? !cur.includes(id)
      const next = want ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)
      saveSel(next)
      return next
    })
  }
  const clearSel = (): void => {
    setSel([])
    saveSel([])
  }

  const st: MatrixState | null = v?.state ?? null
  const done = !!st && st.rows.every((r) => r.status === 'done' || r.status === 'failed')
  // 关系、指标：第一次切过去、表也填完了才去分析
  useEffect(() => {
    if (!st || !done) return
    if (view === 'rel' && st.relStatus === 'none') void api.matrixRelations(sid)
    if (view === 'met' && st.metStatus === 'none') void api.matrixMetrics(sid)
  }, [view, done, st, sid])

  const papers = useMemo(() => new Map((v?.papers ?? []).map((p) => [p.id, p])), [v])
  const num = useCallback((pid: string) => (st?.rows.findIndex((r) => r.paperId === pid) ?? -1) + 1, [st])
  const label = useCallback(
    (id: string): string => {
      if (!st) return id
      if (isRel(id)) {
        const r = st.relations?.find((x) => `rel:${x.id}` === id)
        return r ? t('关系 · {0} → {1}：{2}', papers.get(r.from)?.name ?? '', papers.get(r.to)?.name ?? '', r.label) : t('关系')
      }
      const { paperId, col } = splitCell(id)
      const colName = col === 'n' ? t('你的批注') : (st.cols.find((x) => x.id === col)?.name ?? col)
      return `${papers.get(paperId)?.name ?? ''} · ${colName}`
    },
    [st, papers]
  )

  const openAt = async (paperId: string, quote: string, page: number | null): Promise<void> => {
    const at = quote ? await api.matrixLocate(paperId, quote, page) : { page, blockId: null }
    props.onOpenPaper(paperId, at)
  }

  const menu = async (e: React.MouseEvent): Promise<void> => {
    const act = await showMenu(
      [
        { id: 'rename', label: t('重命名'), icon: <Pencil size={16} /> },
        { id: 'md', label: t('导出 Markdown…'), icon: <FileDown size={16} /> },
        { type: 'separator' },
        { id: 'delete', label: t('删除会话'), icon: <Trash2 size={16} />, danger: true }
      ],
      { el: e.currentTarget, align: 'right' }
    )
    if (act === 'rename') setRenaming(true)
    if (act === 'md') void exportMd()
    if (act === 'delete') {
      await api.researchDelete(sid)
      props.onDeleted()
    }
  }
  const exportMd = async (): Promise<void> => {
    try {
      const f = await api.matrixExport(sid)
      if (f) toast(t('已导出到 {0}', f.replace(/^\/Users\/[^/]+/, '~')), { label: t('在 Finder 中显示'), run: () => void api.reveal(f.replace(/\/[^/]+$/, '')) })
    } catch (e) {
      toast(errText(e))
    }
  }
  const addCol = async (name: string): Promise<void> => {
    setAdding(null)
    if (!name.trim()) return
    toast(t('正在让 AI 填「{0}」这一列', name.trim()))
    try {
      setV(await api.matrixAddCol(sid, name))
    } catch (e) {
      toast(errText(e))
    }
  }

  if (!v || !st) return null
  const writing = drawer?.kind === 'write'
  const selPapers = new Set(
    sel.flatMap((x) => {
      if (!isRel(x)) return [splitCell(x).paperId]
      const r = st.relations?.find((y) => `rel:${y.id}` === x)
      return r ? [r.from, r.to] : []
    })
  ).size
  return (
    <>
      <header className={'hdr drag' + (props.sideHidden ? ' side-hidden' : '')}>
        {props.sideHidden && (
          <button className="icon-btn" title={t('显示侧栏 ⌃⌘S')} onClick={props.onShowSide}>
            <PanelLeft size={16} />
          </button>
        )}
        <Sheet size={16} />
        <h1 className="page-title ellipsis" style={{ flex: '0 1 auto' }}>
          {renaming ? (
            <input
              className="input"
              style={{ width: 300, fontSize: 'var(--fs-lg)', fontWeight: 600 }}
              autoFocus
              defaultValue={props.session.title}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const val = e.target.value.trim()
                if (val && val !== props.session.title) void api.researchRename(sid, val).then(props.onRenamed)
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <span onDoubleClick={() => setRenaming(true)}>{props.session.title}</span>
          )}
        </h1>
        <span className="sub">{t('对比表 · {0} 篇', st.rows.length)}</span>
        <span className="spacer" />
        <Segmented
          value={view}
          onChange={(x) => {
            setView(x)
            if (x !== 'table' && drawer?.kind !== 'write') setDrawer(null)
          }}
          options={[
            { value: 'table' as View, label: <><Sheet size={16} /><span className="seg-t">{t('表格')}</span></> },
            { value: 'rel' as View, label: <><Waypoints size={16} /><span className="seg-t">{t('关系')}</span></>, busy: st.relStatus === 'running' },
            { value: 'met' as View, label: <><ChartBar size={16} /><span className="seg-t">{t('指标')}</span></>, busy: st.metStatus === 'running' }
          ]}
        />
        <span className="spacer" />
        {adding !== null ? (
          <span className="mx-addcol">
            <input
              className="input"
              autoFocus
              placeholder={t('这一列写什么，比如「器件」「位宽」')}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addCol(adding)
                if (e.key === 'Escape') setAdding(null)
              }}
            />
            <button className="icon-btn" title={t('取消')} onClick={() => setAdding(null)}>
              <X size={16} />
            </button>
          </span>
        ) : (
          <button className="btn ghost" disabled={!done} onClick={() => (setView('table'), setAdding(''))}>
            <Plus size={16} />
            {t('加一列')}
          </button>
        )}
        <button className="btn ghost" onClick={() => void exportMd()}>
          <FileDown size={16} />
          {t('导出')}
        </button>
        <button className="icon-btn" title={t('更多')} onClick={(e) => void menu(e)}>
          <Ellipsis size={16} />
        </button>
      </header>
      <div className="mx-work">
        <div className="mx-pane">
          {view === 'table' && (
            <TableView
              v={v}
              sel={sel}
              lit={lit}
              srcId={drawer?.kind === 'src' ? drawer.src.cellId : drawer?.kind === 'notes' ? `${drawer.paperId}:n` : null}
              onToggle={toggle}
              onOpen={(src) => setDrawer({ kind: 'src', src })}
              onNotes={(paperId) => setDrawer({ kind: 'notes', paperId })}
              onRetry={(pid) => void api.matrixRetryRow(sid, pid)}
              onDelCol={(col) => void api.matrixDelCol(sid, col).then(setV)}
            />
          )}
          {view === 'rel' && <RelationsView v={v} sel={sel} done={done} onToggle={toggle} onRetry={() => void api.matrixRelations(sid)} />}
          {view === 'met' && <MetricsView v={v} done={done} onOpen={(src) => setDrawer({ kind: 'src', src })} onRetry={() => void api.matrixMetrics(sid)} />}
          {sel.length > 0 && !writing && (
            <div className="mx-selbar">
              <span className="num" style={{ fontWeight: 500 }}>{t('已选 {0} 格 · 来自 {1} 篇', sel.length, selPapers)}</span>
              <button className="btn ghost" onClick={clearSel}>
                {t('清空')}
              </button>
              <button className="btn primary" onClick={() => setDrawer({ kind: 'write' })}>
                <SquarePen size={16} />
                {t('用选中的写一段')}
              </button>
            </div>
          )}
        </div>
        {drawer?.kind === 'src' && (
          <SourceDrawer
            src={drawer.src}
            paper={papers.get(drawer.src.paperId)!}
            picked={drawer.src.cellId ? sel.includes(drawer.src.cellId) : false}
            onPick={() => drawer.src.cellId && toggle(drawer.src.cellId, true)}
            onOpen={() => void openAt(drawer.src.paperId, drawer.src.quote, drawer.src.page)}
            onClose={() => setDrawer(null)}
          />
        )}
        {drawer?.kind === 'notes' && (
          <NotesDrawer
            paper={papers.get(drawer.paperId)!}
            notes={v.notes[drawer.paperId] ?? []}
            picked={sel.includes(`${drawer.paperId}:n`)}
            onPick={() => toggle(`${drawer.paperId}:n`, true)}
            onOpen={(annId) => props.onOpenPaper(drawer.paperId, undefined, annId)}
            onClose={() => setDrawer(null)}
          />
        )}
        {writing && <WriteDrawer v={v} sel={sel} label={label} num={num} onLit={setLit} onClose={() => (setDrawer(null), setLit([]))} />}
      </div>
    </>
  )
}
