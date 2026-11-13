import { BookOpen, Ellipsis, FileText, Info, Languages, MessagesSquare, MousePointerClick, RefreshCw, Sheet, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { translationKey } from '@shared/hash'
import type { Annotation, Folder, Glance, Paper, ReadMode, SettingsView } from '@shared/types'
import { api, errText } from '../api'
import { Markdown } from '../lib/Markdown'
import { authorsShort, Empty, Segmented, Skeleton } from '../lib/ui'
import { Thumb } from './Library'
import { folderPath } from './PaperInfo'
import { t } from '@shared/i18n'

type Tab = 'glance' | 'abs' | 'notes' | 'info'

// 文献库右边的速览栏：单击选中就显示，看下一篇不用关
export function Inspector(props: {
  papers: Paper[]
  settings: SettingsView
  folders: Folder[]
  onOpen: (id: string, mode?: ReadMode) => void
  onInfo: (id: string) => void
  onMenu: (el: Element, id: string) => void
  onAskTogether: () => void
}) {
  if (props.papers.length === 0)
    return (
      <aside className="insp">
        <div className="insp-empty">
          <Empty icon={<MousePointerClick size={32} strokeWidth={1.5} />} title={t('选一篇论文')} text={t('单击看速览，双击打开阅读')} />
        </div>
      </aside>
    )
  if (props.papers.length > 1) return <Multi papers={props.papers} onAsk={props.onAskTogether} />
  return <One key={props.papers[0].id} {...props} paper={props.papers[0]} />
}

function One(props: { paper: Paper; settings: SettingsView; folders: Folder[]; onOpen: (id: string, mode?: ReadMode) => void; onInfo: (id: string) => void; onMenu: (el: Element, id: string) => void }) {
  const p = props.paper
  const [tab, setTab] = useState<Tab>('glance')
  const [g, setG] = useState<Glance | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState<Annotation[]>([])
  const [stats, setStats] = useState<{ total: number } | null>(null)

  useEffect(() => {
    void api.glanceGet(p.id).then((x) => setG(x))
    void api.annList(p.id).then(setNotes)
    void api.readStats(p.id).then(setStats)
  }, [p.id])

  // 没生成过速览就先看摘要；生成要问一次 AI，不自动花额度
  useEffect(() => {
    if (g === null && p.abstract) setTab('abs')
  }, [g, p.abstract])

  const gen = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      setG(await api.glanceGenerate(p.id))
      setTab('glance')
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const meta = [p.venue, p.year, p.progress >= 1 ? t('读完') : p.progress > 0 ? t('读到 {0}%', Math.round(p.progress * 100)) : p.lastOpened ? '' : t('未读')].filter(Boolean).join(' · ')

  return (
    <aside className="insp">
      <div className="insp-bd">
        <div className="insp-head">
          <Thumb p={p} width={96} />
          <div className="x">
            <h3>{p.title}</h3>
            <div className="meta">{authorsShort(p.authors)}</div>
            {meta && <div className="meta num">{meta}</div>}
          </div>
        </div>
        <Segmented
          className="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'glance', label: t('速览') },
            { value: 'abs', label: t('摘要') },
            { value: 'notes', label: notes.length ? t('笔记 {0}', notes.length) : t('笔记') },
            { value: 'info', label: t('信息') }
          ]}
        />
        {tab === 'glance' && <GlancePane g={g} busy={busy} err={err} onGen={() => void gen()} canGen={p.kind !== 'link' || !!p.abstract} />}
        {tab === 'abs' && <AbstractPane paper={p} lang={props.settings.targetLang} />}
        {tab === 'notes' && <NotesPane notes={notes} />}
        {tab === 'info' && (
          <dl className="info-list">
            {p.venue && (
              <>
                <dt>{t('期刊')}</dt>
                <dd>{p.venue}</dd>
              </>
            )}
            {(p.year || p.published) && (
              <>
                <dt>{t('发表')}</dt>
                <dd className="num">{p.published ?? p.year}</dd>
              </>
            )}
            {(p.volume || p.pages) && (
              <>
                <dt>{t('卷期页')}</dt>
                <dd className="num">{[p.volume && t('第 {0} 卷', p.volume), p.issue && t('第 {0} 期', p.issue), p.pages && t('{0} 页', p.pages)].filter(Boolean).join('，')}</dd>
              </>
            )}
            {p.doi && (
              <>
                <dt>DOI</dt>
                <dd>
                  <a href={`https://doi.org/${p.doi}`} className="text-btn" style={{ padding: 0 }}>
                    {p.doi}
                  </a>
                </dd>
              </>
            )}
            {p.arxiv && (
              <>
                <dt>arXiv</dt>
                <dd>{p.arxiv}</dd>
              </>
            )}
            <dt>{t('文件夹')}</dt>
            <dd>{p.folders.length ? p.folders.map((id) => props.folders.find((f) => f.id === id)).filter((f): f is Folder => !!f).map((f) => folderPath(props.folders, f)).join('、') : t('没放进文件夹')}</dd>
            <dt>{t('添加于')}</dt>
            <dd className="num">{new Date(p.createdAt).toLocaleDateString('zh-CN')}</dd>
            {p.pageCount > 0 && (
              <>
                <dt>{t('页数')}</dt>
                <dd className="num">{t('{0} 页', p.pageCount)}</dd>
              </>
            )}
            {!!stats?.total && (
              <>
                <dt>{t('读了')}</dt>
                <dd className="num">{fmtDuration(stats.total)}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <div className="insp-ft">
        <button className="btn" onClick={() => props.onOpen(p.id)}>
          <BookOpen size={16} />
          <span className="ellipsis">{p.progress > 0 && p.progress < 1 ? t('继续阅读') : t('打开阅读')}</span>
        </button>
        {p.kind === 'pdf' && (
          <button className="btn ghost" onClick={() => props.onOpen(p.id, 'pdf')}>
            <FileText size={16} />
            <span className="ellipsis">{t('看原文')}</span>
          </button>
        )}
        <span className="spacer" />
        <button className="icon-btn" title={t('文献信息 ⌘I')} onClick={() => props.onInfo(p.id)}>
          <Info size={16} />
        </button>
        <button className="icon-btn" title={t('更多')} onClick={(e) => props.onMenu(e.currentTarget, p.id)}>
          <Ellipsis size={16} />
        </button>
      </div>
    </aside>
  )
}

function GlancePane(props: { g: Glance | null | undefined; busy: boolean; err: string | null; canGen: boolean; onGen: () => void }) {
  const { g } = props
  if (g === undefined) return <Skeleton lines={[100, 80, 60]} />
  if (!g)
    return (
      <div className="callout">
        <Sparkles size={14} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text)' }}>{t('还没生成速览')}</div>
          <div>{t('AI 读一遍全文，写出一句话总结、研究问题、方法和关键词，问一次 AI。')}</div>
          {props.err && <div style={{ color: 'var(--red)', marginTop: 4 }}>{t('生成失败：')}{props.err}</div>}
          <button className="btn sm" style={{ marginTop: 8 }} disabled={props.busy || !props.canGen} onClick={props.onGen}>
            {props.busy ? <span className="spin spin-12" /> : <Sparkles size={14} />}
            {props.busy ? t('生成中…') : t('生成速览')}
          </button>
        </div>
      </div>
    )
  return (
    <>
      {g.tldr && (
        <div className="one">
          <Markdown text={g.tldr} inline />
        </div>
      )}
      {(
        [
          [t('研究问题'), g.question],
          [t('方法'), g.method],
          [t('主要结论'), g.findings]
        ] as const
      ).map(([h, xs]) =>
        xs.length ? (
          <div key={h}>
            <div className="sec-t">{h}</div>
            <ul>
              {xs.map((x, i) => (
                <li key={i}>
                  <Markdown text={typeof x === 'string' ? x : x.text} inline />
                </li>
              ))}
            </ul>
          </div>
        ) : null
      )}
      {g.keywords.length > 0 && (
        <div>
          <div className="sec-t">{t('关键词')}</div>
          <div className="kw">
            {g.keywords.map((k) => (
              <span className="tag" key={k}>
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <button className="btn ghost sm" disabled={props.busy} onClick={props.onGen} style={{ marginLeft: -8 }}>
          {props.busy ? <span className="spin spin-12" /> : <RefreshCw size={14} />}
          {t('重新生成')}
        </button>
      </div>
    </>
  )
}

function AbstractPane(props: { paper: Paper; lang: string }) {
  const abs = props.paper.abstract
  const [tr, setTr] = useState<string | null>(null)
  const [showTr, setShowTr] = useState(false)
  useEffect(() => {
    if (!abs) return
    const key = translationKey(abs, props.lang)
    const off = api.onTranslateResult((r) => {
      if (r.paperId === '__library__' && r.key === key && r.text) setTr(r.text)
    })
    void api.translate('__library__', [abs], true).then((c) => c[key] && setTr(c[key]))
    return off
  }, [abs, props.lang])
  if (!abs) return <div className="hint">{t('没有摘要。在「文献信息」里能从网上补全。')}</div>
  return (
    <>
      <p className="abs" lang={showTr && tr ? 'zh-Hans' : 'en'} style={showTr && tr ? undefined : { fontFamily: 'var(--font-serif)' }}>
        {showTr && tr ? tr : abs}
      </p>
      <div>
        <button className="btn ghost sm" style={{ marginLeft: -8 }} disabled={!tr} onClick={() => setShowTr((v) => !v)}>
          {tr ? <Languages size={14} /> : <span className="spin spin-12" />}
          {!tr ? t('翻译中…') : showTr ? t('看原文') : t('看译文')}
        </button>
      </div>
    </>
  )
}

function NotesPane(props: { notes: Annotation[] }) {
  if (!props.notes.length) return <div className="hint">{t('还没有高亮和笔记。阅读时选中文字，点色点或「笔记」。')}</div>
  return (
    <div>
      {props.notes.map((a) => (
        <div className="note" key={a.id}>
          <div className="q">
            <mark style={{ background: `var(--hl-${a.color})` }}>{a.text}</mark>
          </div>
          {a.note && <div className="n">{a.note}</div>}
          <div className="hint" style={{ marginTop: 4 }}>
            {[a.section, a.page ? t('原文第 {0} 页', a.page) : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
      ))}
    </div>
  )
}

function Multi(props: { papers: Paper[]; onAsk: () => void }) {
  const ps = props.papers
  const years = ps.map((p) => p.year).filter((y): y is number => !!y)
  const unread = ps.every((p) => !p.lastOpened)
  return (
    <aside className="insp">
      <div className="insp-bd">
        <div className="stack">
          {ps.slice(0, 3).map((p, i) => (
            <Thumb key={p.id} p={p} width={96} style={{ position: 'absolute', left: 110 + i * 36 - (Math.min(3, ps.length) - 1) * 18, top: i * 6, transform: `rotate(${(i - 1) * 5}deg)` }} />
          ))}
        </div>
        <div>
          <h3 className="num">{t('已选 {0} 篇', ps.length)}</h3>
          <div className="meta num" style={{ marginTop: 4 }}>
            {[unread ? t('都还没读') : '', years.length ? (Math.min(...years) === Math.max(...years) ? `${years[0]}` : t('{0} 到 {1}', Math.min(...years), Math.max(...years))) : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="srcl">
          {ps.slice(0, 12).map((p) => (
            <div className="r" key={p.id}>
              <FileText size={14} />
              <span className="t">{p.title}</span>
            </div>
          ))}
          {ps.length > 12 && <div className="r hint">{t('还有 {0} 篇', ps.length - 12)}</div>}
        </div>
        {ps.length > 1 && (
          <div className="callout">
            <Sheet size={14} />
            <span>{t('「做对比表」把这几篇的问题、方法、结果、局限各填一格，每格都能点回原文那一处；你在这几篇里写的批注和「有质疑」会单独成一列。')}</span>
          </div>
        )}
        <div className="callout">
          <MessagesSquare size={14} />
          <span>{t('「一起问 AI」会把这 {0} 篇放进同一个对话，比如问它们各自怎么做、结论有什么不同。', ps.length)}</span>
        </div>
        <div>
          <button className="btn" onClick={props.onAsk}>
            <MessagesSquare size={16} />
            {t('一起问 AI')}
          </button>
        </div>
      </div>
    </aside>
  )
}

export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return t('不到 1 分钟')
  if (m < 60) return t('{0} 分钟', m)
  return t('{0} 小时{1}', Math.floor(m / 60), m % 60 ? t(' {0} 分', m % 60) : '')
}
