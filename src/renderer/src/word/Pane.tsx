import { AlertTriangle, BookMarked, Check, CircleAlert, ListChecks, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { bibEntries, check, numbering, WORD_STYLES, type CiteItem, type Issue, type WordStyle } from '@shared/wordCite'
import { Segmented } from '../lib/ui'
import { docStyle, insertBib, insertCitation, readDoc, refresh, selectCite, type DocState } from './doc'

type Tab = 'cite' | 'bib' | 'check'
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Word 里的任务窗格：搜文献库插入引用、参考文献表、格式检查。页面和接口都由本机的 ParaRead 给。
export function Pane() {
  const first = (new URLSearchParams(location.search).get('tab') as Tab | null) ?? 'cite'
  const [tab, setTab] = useState<Tab>(first)
  const [style, setStyle] = useState<WordStyle>('gbt')
  const [showCheck, setShowCheck] = useState(true)
  const [doc, setDoc] = useState<DocState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [offline, setOffline] = useState(false)

  // 起步：应用里的默认格式，文档已经定过格式的用文档的；读一遍文档
  useEffect(() => {
    void (async () => {
      try {
        const st = (await (await fetch('/api/state')).json()) as { style: WordStyle; check: boolean }
        setStyle(docStyle() ?? st.style)
        setShowCheck(st.check)
      } catch {
        setOffline(true)
        setStyle(docStyle() ?? 'gbt')
      }
      setDoc(await readDoc().catch(() => null))
    })()
  }, [])

  // 动文档的操作：转圈、报错写在底下，不弹窗
  const act = useCallback(async (fn: () => Promise<DocState>, done?: string): Promise<boolean> => {
    setBusy(true)
    setMsg(null)
    try {
      setDoc(await fn())
      if (done) setMsg({ text: done })
      return true
    } catch (e) {
      setMsg({ text: errText(e), bad: true })
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const changeStyle = (v: WordStyle): void => {
    setStyle(v)
    void act(() => refresh(v), t('全文已换成 {0}', WORD_STYLES.find((x) => x.id === v)!.name))
  }

  const cited = doc ? numbering(doc.cites).size : 0
  return (
    <div className="wp">
      <div className="wp-top">
        <Segmented
          className="sm block"
          value={tab}
          onChange={setTab}
          options={[{ value: 'cite' as Tab, label: t('插入引用') }, { value: 'bib' as Tab, label: t('参考文献表') }, ...(showCheck ? [{ value: 'check' as Tab, label: t('格式检查') }] : [])]}
        />
      </div>
      {offline && (
        <div className="wp-note bad">
          <CircleAlert size={14} />
          <span>{t('连不上 ParaRead。把它打开，再重新打开这个窗格')}</span>
        </div>
      )}
      {tab === 'cite' && <CiteTab busy={busy} onInsert={(picked) => act(() => insertCitation(picked, style), t('已插入'))} onOffline={setOffline} />}
      {tab === 'bib' && <BibTab doc={doc} style={style} busy={busy} onStyle={changeStyle} onInsert={() => void act(() => insertBib(style), t('参考文献表已更新'))} onRefresh={() => void act(() => refresh(style), t('全文已更新'))} />}
      {tab === 'check' && <CheckTab doc={doc} style={style} busy={busy} onRun={() => void act(readDoc)} onFix={() => void act(() => refresh(style), t('全文已更新'))} />}
      <div className="wp-foot">
        {busy ? <span className="spin spin-12" /> : msg ? msg.bad ? <CircleAlert size={14} className="bad" /> : <Check size={14} className="ok" /> : null}
        <span className={'ellipsis' + (msg?.bad ? ' bad' : '')} title={msg?.text}>
          {msg?.text ?? (doc ? t('这个文档引了 {0} 篇，{1} 处', cited, doc.cites.length) : '')}
        </span>
      </div>
    </div>
  )
}

function CiteTab(props: { busy: boolean; onInsert: (picked: CiteItem[]) => Promise<boolean>; onOffline: (v: boolean) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ total: number; items: CiteItem[] } | null>(null)
  const [picked, setPicked] = useState<CiteItem[]>([])
  const seq = useRef(0)
  const { onOffline } = props
  useEffect(() => {
    const n = ++seq.current
    const timer = setTimeout(
      () =>
        void fetch('/api/search?q=' + encodeURIComponent(q))
          .then((r) => r.json())
          .then((r) => (n === seq.current && setHits(r), onOffline(false)))
          .catch(() => onOffline(true)),
      q ? 150 : 0
    )
    return () => clearTimeout(timer)
  }, [q, onOffline])
  const toggle = (it: CiteItem): void => setPicked((p) => (p.some((x) => x.id === it.id) ? p.filter((x) => x.id !== it.id) : [...p, it]))
  return (
    <>
      <div className="wp-search">
        <label className="field-fill">
          <Search size={14} />
          <input autoFocus value={q} placeholder={t('搜标题、作者、年份')} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="wp-list">
        {hits && hits.items.length === 0 && <div className="wp-empty">{q ? t('文献库里没找到「{0}」', q) : t('文献库还是空的，先在 ParaRead 里导入论文')}</div>}
        {hits?.items.map((it) => {
          const on = picked.some((x) => x.id === it.id)
          return (
            <button key={it.id} className={'wp-row' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(it)}>
              <span className={'checkbox' + (on ? ' on' : '')}>{on && <Check size={12} strokeWidth={3} />}</span>
              <span className="c">
                <span className="tt">{it.title}</span>
                <span className="hint ellipsis">{[it.authors.length > 2 ? t('{0} 等', it.authors[0]) : it.authors.join(', '), it.year, it.venue].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          )
        })}
        {hits && hits.total > hits.items.length && <div className="wp-empty">{t('只列前 {0} 篇，再多打几个字', hits.items.length)}</div>}
      </div>
      <div className="wp-act">
        <span className="hint">{picked.length ? t('已选 {0} 篇', picked.length) : t('点论文选中，可以选几篇')}</span>
        <span className="spacer" />
        <button className="btn primary" disabled={!picked.length || props.busy} onClick={() => void props.onInsert(picked).then((ok) => ok && setPicked([]))}>
          {t('插入引用')}
        </button>
      </div>
    </>
  )
}

function BibTab(props: { doc: DocState | null; style: WordStyle; busy: boolean; onStyle: (v: WordStyle) => void; onInsert: () => void; onRefresh: () => void }) {
  const { doc, style } = props
  const entries = useMemo(() => (doc ? bibEntries(doc.cites, style, doc.items) : []), [doc, style])
  return (
    <>
      <div className="wp-search">
        <label className="wp-pick">
          <span className="hint">{t('格式')}</span>
          <select className="input" value={style} disabled={props.busy} onChange={(e) => props.onStyle(e.target.value as WordStyle)}>
            {WORD_STYLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="wp-list">
        {entries.length === 0 && (
          <div className="wp-empty">
            <BookMarked size={28} strokeWidth={1.5} />
            <b>{t('正文里还没有引用')}</b>
            <span>{t('先在「插入引用」里引几篇，参考文献表按引用自动生成')}</span>
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="wp-bib">
            {e.label && <span className="num">{e.label}</span>}
            <span>
              {e.text.split(/(\*[^*]+\*)/).map((s, i) => (s.startsWith('*') && s.endsWith('*') && s.length > 2 ? <i key={i}>{s.slice(1, -1)}</i> : <span key={i}>{s}</span>))}
            </span>
          </div>
        ))}
      </div>
      <div className="wp-act">
        <button className="btn" disabled={props.busy || !doc?.cites.length} onClick={props.onRefresh}>
          <RefreshCw size={14} />
          {t('更新全文')}
        </button>
        <span className="spacer" />
        <button className="btn primary" disabled={props.busy || !entries.length} onClick={props.onInsert}>
          {doc?.hasBib ? t('跳到参考文献表') : t('插入参考文献表')}
        </button>
      </div>
    </>
  )
}

function CheckTab(props: { doc: DocState | null; style: WordStyle; busy: boolean; onRun: () => void; onFix: () => void }) {
  const { doc, style } = props
  const issues: Issue[] = useMemo(() => (doc ? check({ ...doc, style }) : []), [doc, style])
  const fixable = issues.some((i) => i.level === 'error')
  return (
    <>
      <div className="wp-list">
        {doc && issues.length === 0 && (
          <div className="wp-empty">
            <ListChecks size={28} strokeWidth={1.5} />
            <b>{t('没发现问题')}</b>
            <span>{doc.cites.length ? t('引用的编号、参考文献表、文献信息都对得上') : t('这个文档还没有用 ParaRead 插入的引用')}</span>
          </div>
        )}
        {issues.map((it, i) => (
          <button key={i} className="wp-issue" disabled={it.cite === undefined || it.cite < 0} onClick={() => it.cite !== undefined && void selectCite(it.cite)}>
            {it.level === 'error' ? <CircleAlert size={14} className="bad" /> : <AlertTriangle size={14} className="warn" />}
            <span>{it.text}</span>
          </button>
        ))}
      </div>
      <div className="wp-act">
        <button className="btn" disabled={props.busy} onClick={props.onRun}>
          <RefreshCw size={14} />
          {t('重新检查')}
        </button>
        <span className="spacer" />
        {fixable && (
          <button className="btn primary" disabled={props.busy} onClick={props.onFix}>
            {t('更新全文')}
          </button>
        )}
      </div>
    </>
  )
}
