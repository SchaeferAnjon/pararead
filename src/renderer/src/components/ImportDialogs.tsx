import { Calendar, Check, ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen, Pause, Play, Plus, Search, Telescope } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Folder, Paper } from '@shared/types'
import { api, errText, type SearchHit, type UrlImportResult, type ZoteroScan, type ZoteroState } from '../api'
import { showMenu } from '../lib/menu'
import { Segmented, Switch, useToast } from '../lib/ui'
import { folderPath, Modal, ModalHead } from './PaperInfo'
import { t } from '@shared/i18n'
import { modKey } from '@shared/kbd'

// 选「放进哪个文件夹」的下拉
function FolderPick(props: { folders: Folder[]; value: string | null; onChange: (v: string | null) => void }) {
  const cur = props.folders.find((f) => f.id === props.value)
  return (
    <button
      className="btn"
      style={{ maxWidth: 220 }}
      onClick={async (e) => {
        const act = await showMenu(
          [
            { id: '__none', label: t('不放进文件夹'), checked: !props.value },
            ...(props.folders.length ? [{ type: 'separator' as const }] : []),
            ...props.folders.map((f) => ({ id: f.id, label: folderPath(props.folders, f), checked: f.id === props.value, icon: <FolderIcon size={16} /> }))
          ],
          { el: e.currentTarget }
        )
        if (act) props.onChange(act === '__none' ? null : act)
      }}
    >
      <FolderIcon size={16} />
      <span className="ellipsis">{cur ? cur.name : t('不放进文件夹')}</span>
      <ChevronDown size={14} />
    </button>
  )
}

type UrlRow = { input: string; state: 'waiting' | 'working' | 'added' | 'duplicate' | 'noPdf' | 'link' | 'failed'; title?: string; error?: string; paperId?: string; result?: UrlImportResult }

// 从网址导入：一行一个，arXiv、DOI、PDF 直链、论文网页；能拿到 PDF 的下载，拿不到的可以只建条目
export function UrlImport(props: { folders: Folder[]; folder: string | null; onClose: () => void; onAdded: (id: string) => void }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<UrlRow[] | null>(null)
  const [folder, setFolder] = useState<string | null>(props.folder)
  const running = rows?.some((r) => r.state === 'waiting' || r.state === 'working')
  const lines = text.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean)

  useEffect(() => {
    void navigator.clipboard
      .readText()
      .then((t_) => {
        if (/^(https?:\/\/|10\.\d{4,}\/|arxiv:|\d{4}\.\d{4,5})/i.test(t_.trim()) && t_.length < 4000) setText(t_.trim())
      })
      .catch(() => undefined)
  }, [])

  const set = (i: number, patch: Partial<UrlRow>): void => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const run = async (): Promise<void> => {
    const list: UrlRow[] = lines.map((input) => ({ input, state: 'waiting' }))
    setRows(list)
    for (let i = 0; i < list.length; i++) {
      set(i, { state: 'working' })
      try {
        const r = await api.importUrl(list[i].input)
        if (r.status === 'added' || r.status === 'duplicate') {
          if (r.status === 'added' && folder) await api.setFolders([r.paper.id], [folder], [])
          set(i, { state: r.status, title: r.paper.title, paperId: r.paper.id })
          if (r.status === 'added' && i === list.length - 1) props.onAdded(r.paper.id)
        } else if (r.status === 'noPdf') set(i, { state: 'noPdf', title: r.meta.title ?? undefined, error: r.error, result: r })
        else set(i, { state: 'failed', error: r.status === 'failed' ? r.error : undefined })
      } catch (e) {
        set(i, { state: 'failed', error: errText(e) })
      }
    }
  }
  const linkOnly = async (i: number): Promise<void> => {
    const r = rows?.[i].result
    if (!r || r.status !== 'noPdf' || !r.meta.title) return
    const x = await api.importLink({ ...r.meta, title: r.meta.title, url: r.landing ?? r.meta.url ?? rows![i].input })
    if (x.status !== 'failed') {
      if (folder) await api.setFolders([x.paper.id], [folder], [])
      set(i, { state: 'link', paperId: x.paper.id })
    }
  }

  const added = rows?.filter((r) => r.state === 'added' || r.state === 'link').length ?? 0
  const dup = rows?.filter((r) => r.state === 'duplicate').length ?? 0
  return (
    <Modal width={620} label={t('从网址导入')} onClose={props.onClose}>
      <ModalHead title={t('从网址导入')} sub={t('粘贴 arXiv、DOI、PDF 直链或论文网页，一行一个；能拿到 PDF 的自动下载，拿不到的可以只建条目。')} onClose={props.onClose} />
      <div className="m-bd">
        {!rows ? (
          <textarea
            autoFocus
            className="input area mono"
            rows={5}
            placeholder={'https://arxiv.org/abs/2406.01234\n10.1109/TCAD.2019.2931188'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && modKey(e) && lines.length) void run()
            }}
          />
        ) : (
          <div className="url-rows">
            {rows.map((r, i) => (
              <div className="url-row" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: r.title ? 500 : 400 }}>
                    {r.title ?? r.input}
                  </div>
                  {(r.title || r.error) && <div className="hint ellipsis">{r.error && r.state !== 'duplicate' ? r.error : r.input}</div>}
                </div>
                {r.state === 'waiting' && <span className="hint">{t('等待')}</span>}
                {r.state === 'working' && <span className="spin spin-12" />}
                {r.state === 'added' && (
                  <span className="tag ok">
                    <Check size={12} />
                    {t('已导入')}
                  </span>
                )}
                {r.state === 'link' && <span className="tag ok">{t('已建条目')}</span>}
                {r.state === 'duplicate' && <span className="tag">{t('已在库里')}</span>}
                {r.state === 'failed' && <span className="tag warn">{t('没找到')}</span>}
                {r.state === 'noPdf' &&
                  (r.result?.status === 'noPdf' && r.result.meta.title ? (
                    <button className="btn sm" onClick={() => void linkOnly(i)}>
                      {t('只建条目')}
                    </button>
                  ) : (
                    <span className="tag warn">{t('没有 PDF')}</span>
                  ))}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="hint">{t('放进')}</span>
          <FolderPick folders={props.folders} value={folder} onChange={setFolder} />
        </div>
      </div>
      <div className="m-ft">
        <span className="hint">{rows ? (running ? t('正在导入…') : t('新增 {0} 篇{1}', added, dup ? t('，跳过 {0} 篇重复的', dup) : '')) : lines.length ? t('{0} 条 · ⌘↩ 导入', lines.length) : ''}</span>
        <span className="spacer" />
        {!rows ? (
          <>
            <button className="btn" onClick={props.onClose}>
              {t('取消')}
            </button>
            <button className="btn primary" disabled={!lines.length} onClick={() => void run()}>
              {lines.length > 1 ? t('导入 {0} 条', lines.length) : t('导入')}
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={running} onClick={props.onClose}>
            {t('完成')}
          </button>
        )}
      </div>
    </Modal>
  )
}

// Zotero 导入的进度放在模块里：关掉弹窗在后台接着导入，再打开还看得到
const zot = { states: new Map<number, { state: ZoteroState; error?: string }>(), total: 0, subs: new Set<() => void>(), listening: false }
function listenZotero(): void {
  if (zot.listening) return
  zot.listening = true
  api.onZoteroProgress((p) => {
    zot.states.set(p.itemId, { state: p.state, error: p.error })
    zot.subs.forEach((f) => f())
  })
  api.onZoteroFinished(() => zot.subs.forEach((f) => f()))
}
function useZoteroProgress(): typeof zot {
  const [, tick] = useState(0)
  useEffect(() => {
    listenZotero()
    const f = (): void => tick((n) => n + 1)
    zot.subs.add(f)
    return () => void zot.subs.delete(f)
  }, [])
  return zot
}

export function ZoteroImport(props: { onClose: () => void }) {
  const toast = useToast()
  const [scan, setScan] = useState<ZoteroScan | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [openCols, setOpenCols] = useState<Set<number>>(new Set())
  const [mirror, setMirror] = useState(true)
  const [onlyPdf, setOnlyPdf] = useState(true)
  const [paused, setPaused] = useState(false)
  const z = useZoteroProgress()

  const load = (dir?: string): void => {
    setScan(null)
    void api
      .zoteroScan(dir)
      .then(setScan)
      .catch((e) => {
        toast(t('读不了 Zotero 库：{0}', errText(e)))
        setScan({ found: false })
      })
  }
  useEffect(() => load(), [])

  const cols = useMemo(() => scan?.collections ?? [], [scan])
  const items = useMemo(() => scan?.items ?? [], [scan])
  // 一个文件夹算上子文件夹里的条目
  const under = useMemo(() => {
    const m = new Map<number, Set<number>>()
    const kids = (id: number): number[] => [id, ...cols.filter((c) => c.parentId === id).flatMap((c) => kids(c.id))]
    for (const c of cols) {
      const ids = new Set(kids(c.id))
      m.set(c.id, new Set(items.filter((i) => i.collections.some((x) => ids.has(x))).map((i) => i.itemId)))
    }
    return m
  }, [cols, items])
  const eligible = (id: number): boolean => {
    const it = items.find((i) => i.itemId === id)
    return !!it && (!onlyPdf || it.hasFile)
  }
  const stateOf = (ids: Set<number>): 'on' | 'part' | '' => {
    const n = [...ids].filter((i) => picked.has(i)).length
    return n === 0 ? '' : n === ids.size ? 'on' : 'part'
  }
  const toggle = (ids: Set<number>): void => {
    const on = stateOf(ids) === 'on'
    setPicked((p) => {
      const n = new Set(p)
      for (const i of ids) if (on) n.delete(i)
      else n.add(i)
      return n
    })
  }
  const chosen = [...picked].filter(eligible)
  const already = chosen.filter((i) => items.find((x) => x.itemId === i)?.inLibrary).length
  const toImport = chosen.filter((i) => !items.find((x) => x.itemId === i)?.inLibrary)

  const jobIds = [...z.states.keys()]
  const done = jobIds.filter((i) => ['done', 'duplicate', 'failed', 'skipped'].includes(z.states.get(i)!.state)).length
  const running = jobIds.length > 0 && done < jobIds.length
  const current = jobIds.find((i) => z.states.get(i)?.state === 'importing')
  const failed = jobIds.filter((i) => z.states.get(i)?.state === 'failed').length

  const start = async (): Promise<void> => {
    z.states.clear()
    setPaused(false)
    try {
      await api.zoteroImport(toImport, mirror)
    } catch (e) {
      toast(errText(e))
    }
  }

  const colRow = (c: { id: number; name: string; parentId: number | null }, depth: number): React.ReactNode => {
    const ids = under.get(c.id) ?? new Set<number>()
    const kids = cols.filter((x) => x.parentId === c.id)
    const st = stateOf(ids)
    return (
      <div key={c.id}>
        <div className="z-row" style={{ paddingLeft: 8 + depth * 20 }} onClick={() => toggle(ids)}>
          {kids.length ? (
            <span
              className="chev"
              onClick={(e) => {
                e.stopPropagation()
                setOpenCols((s) => {
                  const n = new Set(s)
                  if (n.has(c.id)) n.delete(c.id)
                  else n.add(c.id)
                  return n
                })
              }}
            >
              {openCols.has(c.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          ) : (
            <span className="chev" />
          )}
          <span className={'checkbox ' + st}>{st === 'on' && <Check size={12} strokeWidth={3} />}</span>
          <FolderIcon size={14} />
          <span className="ellipsis" style={{ flex: 1 }}>
            {c.name}
          </span>
          <span className="count">{ids.size}</span>
        </div>
        {openCols.has(c.id) && kids.map((k) => colRow(k, depth + 1))}
      </div>
    )
  }

  return (
    <Modal width={720} label={t('从 Zotero 导入')} onClose={props.onClose}>
      <ModalHead title={t('从 Zotero 导入')} sub={scan?.found ? t('读的是 {0} 里的库，只读不改；PDF 复制一份进 ParaRead。', scan.dir?.replace(/^\/Users\/[^/]+/, '~')) : t('读 Zotero 的库，只读不改；PDF 复制一份进 ParaRead。')} onClose={props.onClose} />
      {!scan ? (
        <div className="m-bd" style={{ alignItems: 'center', padding: 48 }}>
          <span className="spin spin-12" />
        </div>
      ) : !scan.found ? (
        <div className="m-bd">
          <div className="callout warn">
            <FolderOpen size={14} />
            <span>{t('没在 ~/Zotero 找到 Zotero 的数据目录。打开 Zotero 的「设置 › 高级 › 文件和文件夹」能看到它在哪。')}</span>
          </div>
          <div>
            <button className="btn" onClick={() => void api.zoteroChooseDir().then((d) => d && load(d))}>
              <FolderOpen size={16} />
              {t('选择数据目录…')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="m-bd" style={{ flexDirection: 'row', gap: 20 }}>
            <div className="z-tree">
              <div className="z-row" onClick={() => toggle(new Set(items.map((i) => i.itemId)))}>
                <span className="chev" />
                <span className={'checkbox ' + stateOf(new Set(items.map((i) => i.itemId)))}>{stateOf(new Set(items.map((i) => i.itemId))) === 'on' && <Check size={12} strokeWidth={3} />}</span>
                <FolderIcon size={14} />
                <span style={{ flex: 1 }}>{t('我的文库')}</span>
                <span className="count">{items.length}</span>
              </div>
              {cols.filter((c) => c.parentId === null).map((c) => colRow(c, 1))}
            </div>
            <div className="z-side">
              <div>
                <div className="lbl">{t('将导入')}</div>
                <div className="num" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600 }}>
                  {t('{0} 篇', toImport.length)}
                </div>
                {already > 0 && <div className="hint">{t('其中 {0} 篇已在库里，会跳过', already)}</div>}
              </div>
              <label className="z-opt">
                <span>{t('保留 Zotero 的文件夹')}</span>
                <Switch on={mirror} onChange={setMirror} label={t('保留 Zotero 的文件夹')} />
              </label>
              <label className="z-opt">
                <span>{t('只导入有 PDF 的条目')}</span>
                <Switch on={onlyPdf} onChange={setOnlyPdf} label={t('只导入有 PDF 的条目')} />
              </label>
            </div>
          </div>
          {jobIds.length > 0 && (
            <div className="m-bd" style={{ paddingTop: 0 }}>
              <div className="z-prog">
                {running && !paused ? <span className="spin spin-12" /> : <Check size={14} />}
                <span className="ellipsis" style={{ flex: 1 }}>
                  {running
                    ? paused
                      ? t('已暂停，导入了 {0} / {1} 篇', done, jobIds.length)
                      : t('正在导入第 {0} / {1} 篇{2}', Math.min(done + 1, jobIds.length), jobIds.length, current ? `：${items.find((i) => i.itemId === current)?.title ?? ''}` : '')
                    : t('导入完了 {0} 篇{1}', jobIds.length, failed ? t('，{0} 篇失败', failed) : '')}
                </span>
                {running && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      void api.zoteroControl(paused ? 'resume' : 'pause')
                      setPaused(!paused)
                    }}
                  >
                    {paused ? <Play size={14} /> : <Pause size={14} />}
                    {paused ? t('继续') : t('暂停')}
                  </button>
                )}
              </div>
              <span className="bar accent">
                <i style={{ width: `${(done / jobIds.length) * 100}%` }} />
              </span>
              {running && <div className="hint">{t('关掉这个窗口也会在后台接着导入；暂停后接着从第 {0} 篇继续。', done + 1)}</div>}
            </div>
          )}
          <div className="m-ft">
            <span className="spacer" />
            {running ? (
              <button className="btn" onClick={props.onClose}>
                {t('在后台继续')}
              </button>
            ) : (
              <>
                <button className="btn" onClick={props.onClose}>
                  {jobIds.length ? t('完成') : t('取消')}
                </button>
                <button className="btn primary" disabled={!toImport.length} onClick={() => void start()}>
                  {t('导入 {0} 篇', toImport.length)}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// 全网检索：OpenAlex 为主，S2 和 arXiv 兜底；能下载的直接加进来，不能的存成仅链接
export function WebSearch(props: { folders: Folder[]; folder: string | null; q?: string; onClose: () => void; onAiFind?: (q: string) => void }) {
  const toast = useToast()
  const [q, setQ] = useState(props.q ?? '')
  const [res, setRes] = useState<{ hits: SearchHit[]; source: string; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState<'rel' | 'new' | 'cite'>('rel')
  const [since, setSince] = useState<number | null>(null)
  const [onlyPdf, setOnlyPdf] = useState(false)
  const [mine, setMine] = useState<Paper[]>([])
  const [adding, setAdding] = useState<Record<string, 'busy' | 'added' | 'link'>>({})
  const [folder, setFolder] = useState<string | null>(props.folder)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api.listPapers().then(setMine)
    if (props.q) void search(props.q, since)
    else inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async (text: string, from: number | null): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    try {
      setRes(await api.scholarSearch(text.trim(), from ? { yearFrom: from } : undefined))
    } catch (e) {
      setRes({ hits: [], source: '', error: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const inLib = (h: SearchHit): boolean =>
    mine.some((p) => (h.doi && p.doi?.toLowerCase() === h.doi.toLowerCase()) || (h.arxiv && p.arxiv === h.arxiv) || norm(p.title) === norm(h.title))
  const hits = useMemo(() => {
    let l = res?.hits ?? []
    if (onlyPdf) l = l.filter((h) => h.pdfUrl)
    if (sort === 'new') l = [...l].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    if (sort === 'cite') l = [...l].sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0))
    return l
  }, [res, onlyPdf, sort])

  const add = async (h: SearchHit): Promise<void> => {
    setAdding((m) => ({ ...m, [h.id]: 'busy' }))
    try {
      const r = await api.scholarAdd(h)
      if (r.status === 'failed') throw new Error(r.error)
      if (folder && r.status === 'added') await api.setFolders([r.paper.id], [folder], [])
      setAdding((m) => ({ ...m, [h.id]: r.linkOnly ? 'link' : 'added' }))
      if (r.linkOnly) toast(t('没有开放下载的 PDF，存成了仅链接，之后能补 PDF'))
    } catch (e) {
      setAdding((m) => {
        const n = { ...m }
        delete n[h.id]
        return n
      })
      toast(t('加入失败：{0}', errText(e)))
    }
  }

  const yearMenu = async (e: React.MouseEvent): Promise<void> => {
    const now = new Date().getFullYear()
    const act = await showMenu(
      [
        { id: 'any', label: t('不限年份'), checked: since === null },
        { type: 'separator' },
        ...[1, 3, 5, 10].map((n) => ({ id: String(now - n + 1), label: t('{0} 年以来', now - n + 1), checked: since === now - n + 1 }))
      ],
      { el: e.currentTarget }
    )
    if (!act) return
    const v = act === 'any' ? null : Number(act)
    setSince(v)
    void search(q, v)
  }

  return (
    <Modal width={860} height={720} label={t('全网检索')} onClose={props.onClose}>
      <ModalHead inline title={t('全网检索')} onClose={props.onClose} />
      <div className="m-bd" style={{ paddingBottom: 4 }}>
        <label className="field-fill big">
          <Search size={16} />
          <input ref={inputRef} placeholder={t('说说想找什么论文，英文关键词更准')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search(q, since)} />
          {busy && <span className="spin spin-12" />}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Segmented
            className="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'rel', label: t('相关度') },
              { value: 'new', label: t('最新') },
              { value: 'cite', label: t('引用最多') }
            ]}
          />
          <button className="btn sm" onClick={(e) => void yearMenu(e)}>
            <Calendar size={14} />
            {since ? t('{0} 年以来', since) : t('不限年份')}
            <ChevronDown size={12} />
          </button>
          <label className="z-opt" style={{ gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            <Switch on={onlyPdf} onChange={setOnlyPdf} label={t('只看能下载 PDF 的')} />
            {t('只看能下载 PDF 的')}
          </label>
          <span className="spacer" />
          {res && <span className="hint">{res.source ? t('来自 {0} · {1} 条', res.source, hits.length) : ''}</span>}
        </div>
      </div>
      <div className="web-res">
        {res?.error && !res.hits.length && <div className="callout warn">{res.error}</div>}
        {res && !res.hits.length && !res.error && <div className="no-result">{t('没找到，换几个英文关键词试试')}</div>}
        {hits.map((h) => {
          const st = adding[h.id]
          return (
            <div className="res" key={h.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="rt1">{h.url ? <a href={h.url}>{h.title}</a> : h.title}</div>
                <div className="ra">{[(h.authors.length > 3 ? t('{0} 等', h.authors.slice(0, 3).join(', ')) : h.authors.join(', ')), h.venue, h.year, h.citations ? t('被引 {0}', h.citations) : ''].filter(Boolean).join(' · ')}</div>
                {(h.tldr || h.abstract) && <div className="rw">{h.tldr || h.abstract}</div>}
              </div>
              <div style={{ flex: 'none' }}>
                {inLib(h) || st === 'added' ? (
                  <span className="tag ok">
                    <Check size={12} />
                    {st === 'added' ? t('已加入') : t('已在库里')}
                  </span>
                ) : st === 'link' ? (
                  <span className="tag">{t('仅链接')}</span>
                ) : (
                  <button className="btn sm" disabled={st === 'busy'} onClick={() => void add(h)} title={h.pdfUrl ? t('下载 PDF 加进文献库') : t('没有开放的 PDF，先存成仅链接')}>
                    {st === 'busy' ? <span className="spin spin-12" /> : <Plus size={14} />}
                    {h.pdfUrl ? t('加入') : t('加链接')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="m-ft line">
        <span className="hint">{t('加入的论文放进')}</span>
        <FolderPick folders={props.folders} value={folder} onChange={setFolder} />
        <span className="spacer" />
        {props.onAiFind && (
          <button className="btn ghost" disabled={!q.trim()} onClick={() => props.onAiFind!(q.trim())}>
            <Telescope size={16} />
            {t('让 AI 帮我挑')}
          </button>
        )}
      </div>
    </Modal>
  )
}

const BOOKMARKLET = "javascript:location.href='pararead://add?url='+encodeURIComponent(location.href)"

export function BookmarkletDialog(props: { onClose: () => void }) {
  const toast = useToast()
  return (
    <Modal width={520} label={t('浏览器小书签')} onClose={props.onClose}>
      <ModalHead title={t('浏览器小书签')} sub={t('在论文网页上点一下书签，就把这篇加进 ParaRead：arXiv、出版社页面、PDF 都行。')} onClose={props.onClose} />
      <div className="m-bd">
        <div className="bm-drop">
          <a className="btn" ref={(el) => el?.setAttribute('href', BOOKMARKLET)} onClick={(e) => e.preventDefault()} draggable>
            <Plus size={16} />
            {t('加进 ParaRead')}
          </a>
          <span className="hint">{t('把左边这个按钮拖到浏览器的书签栏')}</span>
        </div>
        <div className="callout">
          <span>{t('书签栏没显示的话，Chrome 和 Edge 按 ⇧⌘B，Safari 按 ⇧⌘B 打开「个人收藏栏」。也可以新建一个书签，网址填下面这段。')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input mono" readOnly value={BOOKMARKLET} onFocus={(e) => e.target.select()} />
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(BOOKMARKLET)
              toast(t('已复制'))
            }}
          >
            {t('复制')}
          </button>
        </div>
      </div>
      <div className="m-ft">
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>
          {t('完成')}
        </button>
      </div>
    </Modal>
  )
}
