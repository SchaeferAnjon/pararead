import { AlertTriangle, BookMarked, Check, CircleAlert, Inbox, Lightbulb, ListChecks, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { bibEntries, check, numbering, WORD_STYLES, type CiteItem, type Issue, type WordStyle } from '@shared/wordCite'
import { Segmented } from '../lib/ui'
import type { Seg } from '@shared/draft'
import { docStyle, insertBib, insertCitation, insertInline, insertParagraph, readDoc, refresh, selectCite, type DocState } from './doc'
import { ideaSegments } from '@shared/ideas'
import type { IdeaHow } from '@shared/types'

type Tab = 'cite' | 'idea' | 'bib' | 'check'
interface InboxItem {
  id: string
  createdAt: number
  title: string
  segments: Seg[]
  items: CiteItem[]
  inline?: boolean // 灵感：插在光标处，不另起一段
}
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

  // 从 ParaRead 对比表「送进 Word」的段落：窗格开着时送来的直接插在光标处；打开窗格前就在排队的，列在上面点一下插入
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [got, setGot] = useState<{ cites: number } | null>(null)
  const openedAt = useRef(Date.now())
  const handled = useRef(new Set<string>())
  const styleRef = useRef(style)
  styleRef.current = style
  const insertPara = useCallback(
    async (it: InboxItem): Promise<void> => {
      handled.current.add(it.id)
      const n = it.segments.filter((x) => 'cite' in x).length
      const ok = await act(() => (it.inline ? insertInline(it, styleRef.current) : insertParagraph(it, styleRef.current)), it.inline ? t('已插入，{0} 处引用', n) : t('已插入 1 段，{0} 处引用', n))
      if (!ok) return void handled.current.delete(it.id)
      setGot({ cites: n })
      setInbox((x) => x.filter((y) => y.id !== it.id))
      await fetch('/api/inbox/done?id=' + encodeURIComponent(it.id), { method: 'POST' }).catch(() => {})
    },
    [act]
  )
  useEffect(() => {
    let stop = false
    const poll = async (): Promise<void> => {
      try {
        const r = (await (await fetch('/api/inbox')).json()) as { items: InboxItem[] }
        if (stop) return
        const fresh = r.items.filter((x) => !handled.current.has(x.id))
        setInbox(fresh.filter((x) => x.createdAt < openedAt.current))
        for (const it of fresh.filter((x) => x.createdAt >= openedAt.current)) await insertPara(it)
      } catch {
        // 连不上应用：别的请求会报「连不上 ParaRead」
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [insertPara])

  const cited = doc ? numbering(doc.cites).size : 0
  return (
    <div className="wp">
      <div className="wp-top">
        <Segmented
          className="sm block"
          value={tab}
          onChange={setTab}
          options={[{ value: 'cite' as Tab, label: t('插入引用') }, { value: 'idea' as Tab, label: t('灵感') }, { value: 'bib' as Tab, label: t('参考文献表') }, ...(showCheck ? [{ value: 'check' as Tab, label: t('格式检查') }] : [])]}
        />
      </div>
      {offline && (
        <div className="wp-note bad">
          <CircleAlert size={14} />
          <span>{t('连不上 ParaRead。把它打开，再重新打开这个窗格')}</span>
        </div>
      )}
      {inbox.length > 0 && (
        <div className="wp-got" data-part="inbox">
          <b>
            <Inbox size={14} />
            {t('从 ParaRead 收到 {0} 段', inbox.length)}
          </b>
          {inbox.map((it) => (
            <div key={it.id} className="wp-got-row">
              <span className="ellipsis">{it.title}</span>
              <button className="btn sm" disabled={busy} onClick={() => void insertPara(it)}>
                {t('插入')}
              </button>
            </div>
          ))}
        </div>
      )}
      {got && inbox.length === 0 && (
        <div className="wp-got" data-part="got">
          <b>
            <span className="dot ok sm" />
            {t('从 ParaRead 收到 1 段')}
          </b>
          <p>{t('插在光标处，{0} 处引用已变成插件管的引用（{1}），参考文献表跟着更新。', got.cites, WORD_STYLES.find((x) => x.id === style)!.name)}</p>
        </div>
      )}
      {tab === 'cite' && <CiteTab busy={busy} onInsert={(picked) => act(() => insertCitation(picked, style), t('已插入'))} onOffline={setOffline} />}
      {tab === 'idea' && (
        <IdeaTab
          busy={busy}
          onOffline={setOffline}
          onInsert={(it, how, para) => act(() => insertInline({ segments: ideaSegments({ paperId: it.paper.id, text: it.text, page: it.page }, how, para), items: [it.paper] }, style), how === 'quote' ? t('已插入原句和引用') : t('已插入转述和引用'))}
        />
      )}
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

interface PaneIdea {
  id: string
  text: string
  page: number | null
  section: string
  use: string
  topics: string[]
  how: IdeaHow
  paraphrase: { en?: string; zh?: string } | null
  paper: CiteItem
}

// 灵感：搜你在 ParaRead 收的句子（按主题筛），插原句（带页码）或插转述（没转述过的先让 ParaRead 的 AI 转一次）
function IdeaTab(props: { busy: boolean; onInsert: (it: PaneIdea, how: IdeaHow, para: string) => Promise<boolean>; onOffline: (v: boolean) => void }) {
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState('')
  const [res, setRes] = useState<{ total: number; topics: string[]; items: PaneIdea[] } | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [err, setErr] = useState<{ id: string; text: string } | null>(null)
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const seq = useRef(0)
  const { onOffline } = props
  useEffect(() => {
    const n = ++seq.current
    const timer = setTimeout(
      () =>
        void fetch(`/api/ideas?q=${encodeURIComponent(q)}&topic=${encodeURIComponent(topic)}`)
          .then((r) => r.json())
          .then((r) => (n === seq.current && setRes(r), onOffline(false)))
          .catch(() => onOffline(true)),
      q ? 150 : 0
    )
    return () => clearTimeout(timer)
  }, [q, topic, onOffline])
  // 转述用底下选的语言；没转过的去问 ParaRead（它会存下来，下次直接用）
  const paraphrase = async (it: PaneIdea): Promise<string> => {
    if (it.paraphrase?.[lang]) return it.paraphrase[lang]!
    const r = await fetch(`/api/ideas/paraphrase?id=${encodeURIComponent(it.id)}&lang=${lang}`, { method: 'POST', headers: { 'X-ParaRead-Pane': '1' } })
    const j = (await r.json()) as { text?: string; error?: string }
    if (!r.ok || !j.text) throw new Error(j.error ?? t('转述失败'))
    return j.text
  }
  const insert = async (it: PaneIdea, how: IdeaHow): Promise<void> => {
    setWorking(it.id + how)
    setErr(null)
    try {
      const para = how === 'paraphrase' ? await paraphrase(it) : ''
      await props.onInsert(it, how, para)
    } catch (e) {
      setErr({ id: it.id, text: errText(e) })
    } finally {
      setWorking(null)
    }
  }
  return (
    <>
      <div className="wp-search">
        <label className="field-fill">
          <Search size={14} />
          <input autoFocus value={q} placeholder={t('搜原句、用法、主题')} onChange={(e) => setQ(e.target.value)} />
        </label>
        {!!res?.topics.length && (
          <div className="wp-topics" data-part="topics">
            {['', ...res.topics].map((x) => (
              <button key={x || '__all'} className={'tag wp-topic' + (topic.toLowerCase() === x.toLowerCase() ? ' on' : '')} onClick={() => setTopic(x)}>
                {x || t('全部')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="wp-list">
        {res && res.items.length === 0 && (
          <div className="wp-empty">
            {q || topic ? (
              t('没有符合的灵感')
            ) : (
              <>
                <b>{t('还没有灵感')}</b>
                {t('在 ParaRead 里读论文时选中一句，点「灵感」收进来')}
              </>
            )}
          </div>
        )}
        {res?.items.map((it) => (
          <div key={it.id} className="wp-idea" data-idea={it.id}>
            <div className="q">{it.text}</div>
            <div className="hint">{[it.paper.authors.length > 1 ? t('{0} 等', it.paper.authors[0]) : it.paper.authors[0], it.paper.year, it.page ? t('第 {0} 页', it.page) : ''].filter(Boolean).join(' · ')}</div>
            {it.use && <div className="use">{it.use}</div>}
            <div className="row">
              <button className="btn sm" disabled={props.busy || !!working} onClick={() => void insert(it, 'quote')}>
                {working === it.id + 'quote' ? <span className="spin spin-12" /> : null}
                {t('插原句')}
              </button>
              <button className="btn sm" disabled={props.busy || !!working} onClick={() => void insert(it, 'paraphrase')}>
                {working === it.id + 'paraphrase' ? <span className="spin spin-12" /> : null}
                {t('插转述')}
              </button>
              <span className="spacer" />
              <span className="hint">{it.how === 'quote' ? t('你想直接引') : t('你想转述')}</span>
            </div>
            {err?.id === it.id && <div className="hint bad">{err.text}</div>}
          </div>
        ))}
      </div>
      <div className="wp-act">
        <Lightbulb size={14} className="idea-ic" />
        <span className="hint">{t('插在光标处，原句带页码')}</span>
        <span className="spacer" />
        <span className="hint">{t('转述用')}</span>
        <Segmented className="sm" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'zh', label: t('中文') }]} />
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
