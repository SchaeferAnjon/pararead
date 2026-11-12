import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, Ellipsis, FileDown, FileText, Folder as FolderIcon, MessagesSquare, Network, PanelLeft, Pencil, Plus, RotateCcw, ScrollText, Telescope, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Folder, Paper, SettingsView } from '@shared/types'
import { api, errText, streamRequest, type GuideMap, type ResearchKind, type ResearchMessage, type ResearchSession, type SearchHit, type Source } from '../api'
import { Composer } from '../lib/Composer'
import { Markdown } from '../lib/Markdown'
import { showMenu } from '../lib/menu'
import { Dots, useToast } from '../lib/ui'
import { AI_ICON } from './Sidebar'
import { t } from '@shared/i18n'

const MODES: { kind: ResearchKind; icon: typeof MessagesSquare; title: string; desc: string; ph: string; tries: string[] }[] = [
  { kind: 'ask', icon: MessagesSquare, title: t('问文献库'), desc: t('只看你库里的论文回答，带出处'), ph: t('问你的文献库，比如「库里哪些论文比较过这几种方法的延迟？」'), tries: [t('库里这些论文主要在解决哪几类问题？'), t('把最近读的几篇按方法分成几类，各举一篇')] },
  { kind: 'find', icon: Telescope, title: t('找论文'), desc: t('说想找什么，去全网检索并挑出来'), ph: t('想找什么论文？比如「2022 年后有开源代码的存内乘法器」'), tries: [t('近三年这个方向引用最多的综述'), t('有开源代码、能复现的相关工作')] },
  { kind: 'guide', icon: Network, title: t('学习指南'), desc: t('把一个方向的概念理成一张图'), ph: t('想入门哪个方向？比如「存内计算」'), tries: [t('我库里论文所在的这个方向'), t('这个领域的基本概念和常用方法')] },
  { kind: 'review', icon: ScrollText, title: t('写综述报告'), desc: t('定计划、检索、读摘要、成文'), ph: t('输入研究课题，比如「基于忆阻器的存内乘法器」'), tries: [] }
]
const MODE = Object.fromEntries(MODES.map((m) => [m.kind, m])) as Record<ResearchKind, (typeof MODES)[number]>

export function ResearchPage(props: {
  id: string | null
  prompt?: string
  papers: Paper[]
  folders: Folder[]
  settings: SettingsView
  sideHidden: boolean
  onShowSide: () => void
  onCreated: (id: string, prompt: string) => void
  onDeleted: () => void
  onOpenPaper: (id: string) => void
}) {
  if (!props.id) return <NewSession {...props} />
  return <Session {...props} id={props.id} />
}

function Header(props: { icon: React.ReactNode; title: React.ReactNode; sub: string; sideHidden: boolean; onShowSide: () => void; right?: React.ReactNode }) {
  return (
    <header className={'hdr drag' + (props.sideHidden ? ' side-hidden' : '')}>
      {props.sideHidden && (
        <button className="icon-btn" title={t('显示侧栏 ⌃⌘S')} onClick={props.onShowSide}>
          <PanelLeft size={16} />
        </button>
      )}
      {props.icon}
      <h1 className="page-title ellipsis">{props.title}</h1>
      <span className="sub">{props.sub}</span>
      <span className="spacer" />
      {props.right}
    </header>
  )
}

function NewSession(props: { papers: Paper[]; folders: Folder[]; sideHidden: boolean; onShowSide: () => void; onCreated: (id: string, prompt: string) => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<ResearchKind>('ask')
  const [text, setText] = useState('')
  const [scope, setScope] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const m = MODE[kind]
  const usable = props.papers.filter((p) => p.kind !== 'link')
  const folder = props.folders.find((f) => f.id === scope)
  useEffect(() => ref.current?.focus(), [kind])

  const send = async (t_: string): Promise<void> => {
    if (!t_.trim()) return
    const ids = folder ? usable.filter((p) => p.folders.includes(folder.id)).map((p) => p.id) : []
    if (folder && !ids.length) return toast(t('「{0}」里没有能读的论文', folder.name))
    try {
      const id = await api.researchCreate(kind, ids)
      props.onCreated(id, t_.trim())
    } catch (e) {
      toast(errText(e))
    }
  }
  const pickScope = async (e: React.MouseEvent): Promise<void> => {
    const act = await showMenu(
      [
        { id: '__all', label: t('全部论文'), checked: !scope },
        ...(props.folders.length ? [{ type: 'separator' as const }] : []),
        ...props.folders.map((f) => ({ id: f.id, label: f.name, icon: <FolderIcon size={16} />, checked: f.id === scope, hint: t('{0} 篇', f.count) }))
      ],
      { el: e.currentTarget }
    )
    if (act) setScope(act === '__all' ? null : act)
  }

  return (
    <>
      <Header icon={<MessagesSquare size={16} />} title={t('新会话')} sub={t('学术 AI')} sideHidden={props.sideHidden} onShowSide={props.onShowSide} />
      <div className="aiscroll">
        <div className="aicol new">
          <div style={{ textAlign: 'center' }}>
            <div className="ai-hero">{t('问问你的文献库')}</div>
            <div className="hint" style={{ marginTop: 6, fontSize: 'var(--fs)' }}>
              {props.folders.length ? t('{0} 篇论文、{1} 个文件夹', usable.length, props.folders.length) : t('{0} 篇论文', usable.length)} · {t('回答里的每个出处都能点回原文')}
            </div>
          </div>
          <div className="modes">
            {MODES.map((x) => (
              <button key={x.kind} className={'amode' + (x.kind === kind ? ' on' : '')} onClick={() => setKind(x.kind)}>
                <span className="mt">
                  <x.icon size={16} />
                  {x.title}
                </span>
                <span className="ad">{x.desc}</span>
              </button>
            ))}
          </div>
          <Composer
            inputRef={ref}
            value={text}
            onChange={setText}
            onSend={() => void send(text)}
            placeholder={m.ph}
            minHeight={64}
            style={{ margin: 0 }}
            tools={
              kind !== 'find' && kind !== 'review' ? (
                <button className="tchip" onClick={(e) => void pickScope(e)}>
                  <FolderIcon size={14} />
                  {folder ? folder.name : t('全部论文')}
                  <ChevronDown size={12} />
                </button>
              ) : null
            }
          />
          {m.tries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="hint">{t('试试')}</div>
              <div className="sugg">
                {m.tries.map((s) => (
                  <button className="s" key={s} onClick={() => void send(s)}>
                    <ArrowRight size={14} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {kind === 'review' && (
            <div className="callout">
              <ScrollText size={14} />
              <span>{t('先定 4 到 6 节的大纲，再去全网检索几十篇文献，读摘要后按大纲写成综述，每段带可点的引用。一般要两三分钟，问好几次 AI。')}</span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const stageName = (s: string): string =>
  ({
    在文献库里找相关论文: t('在文献库里找相关论文'),
    读论文: t('读论文'),
    '理解需求，拆成检索词': t('理解需求，拆成检索词'),
    检索: t('检索'),
    挑出最相关的: t('挑出最相关的'),
    梳理核心议题和概念: t('梳理核心议题和概念'),
    制定研究计划: t('制定研究计划'),
    深度检索文献: t('深度检索文献'),
    写报告: t('写报告')
  })[s] ?? s

type Live = { stage: string; detail: string; text: string; plan?: { title?: string; outline: { h: string }[] }; stages: string[] }

function Session(props: { id: string; prompt?: string; papers: Paper[]; sideHidden: boolean; onShowSide: () => void; onDeleted: () => void; onOpenPaper: (id: string) => void }) {
  const toast = useToast()
  const [s, setS] = useState<ResearchSession | null>(null)
  const [msgs, setMsgs] = useState<ResearchMessage[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [stopper, setStopper] = useState<(() => void) | null>(null)
  const [input, setInput] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [concept, setConcept] = useState<{ c: GuideMap['topics'][number]['concepts'][number]; sources: Source[] } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sent = useRef(false)

  const load = async (): Promise<{ session: ResearchSession; messages: ResearchMessage[] } | null> => {
    const r = await api.researchGet(props.id)
    if (r) {
      setS(r.session)
      setMsgs(r.messages)
    }
    return r
  }
  useEffect(() => {
    void load().then((r) => {
      if (r && props.prompt && !r.messages.length && !sent.current) {
        sent.current = true
        send(props.prompt)
      }
    })
    return api.onResearchProgress((p) => {
      if (p.sessionId !== props.id) return
      setLive((l) => {
        const base = l ?? { stage: '', detail: '', text: '', stages: [] }
        if (p.stage === '计划') {
          const plan = JSON.parse(p.detail) as Live['plan']
          return { ...base, plan, stages: [...base.stages, '计划'] }
        }
        return { ...base, stage: p.stage, detail: p.detail, stages: base.stages.includes(p.stage) ? base.stages : [...base.stages, p.stage] }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id])

  useEffect(() => {
    const el = scrollRef.current
    if (el && (live || pending)) el.scrollTop = el.scrollHeight
  }, [live, pending, msgs.length])

  const send = (text: string): void => {
    setPending(text)
    setLive({ stage: '', detail: '', text: '', stages: [] })
    setInput('')
    const r = streamRequest((reqId) => api.researchSend(reqId, props.id, text), {
      delta: (full) => setLive((l) => (l ? { ...l, text: full } : l)),
      done: () => void finish(),
      error: () => void finish()
    })
    setStopper(() => r.stop)
  }
  const finish = async (): Promise<void> => {
    // 主进程写完消息再读
    await new Promise((r) => setTimeout(r, 120))
    await load()
    setPending(null)
    setLive(null)
    setStopper(null)
  }

  if (!s) return null
  const mode = MODE[s.kind]
  const Icon = AI_ICON[s.kind]
  const busy = pending !== null
  const firstDone = msgs.some((m) => m.role === 'assistant')

  const menu = async (e: React.MouseEvent): Promise<void> => {
    const report = [...msgs].reverse().find((m) => m.role === 'assistant' && m.content)
    const act = await showMenu(
      [
        { id: 'rename', label: t('重命名'), icon: <Pencil size={16} /> },
        { id: 'md', label: t('导出 Markdown…'), icon: <FileDown size={16} />, enabled: !!report },
        { type: 'separator' },
        { id: 'delete', label: t('删除会话'), icon: <Trash2 size={16} />, danger: true }
      ],
      { el: e.currentTarget, align: 'right' }
    )
    if (act === 'rename') setRenaming(true)
    if (act === 'md') download(`${s.title}.md`, exportMarkdown(s, msgs))
    if (act === 'delete') {
      await api.researchDelete(s.id)
      props.onDeleted()
    }
  }

  return (
    <>
      <Header
        icon={<Icon size={16} />}
        title={
          renaming ? (
            <input
              className="input"
              style={{ width: 360, fontSize: 'var(--fs-lg)', fontWeight: 600 }}
              autoFocus
              defaultValue={s.title}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== s.title) void api.researchRename(s.id, v).then(() => load())
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <span onDoubleClick={() => setRenaming(true)}>{s.title}</span>
          )
        }
        sub={mode.title + (s.paperIds.length ? t(' · 限 {0} 篇', s.paperIds.length) : '')}
        sideHidden={props.sideHidden}
        onShowSide={props.onShowSide}
        right={
          <button className="icon-btn" title={t('更多')} onClick={(e) => void menu(e)}>
            <Ellipsis size={16} />
          </button>
        }
      />
      <div className="lib-body">
        <div className="aimain">
          <div className="aiscroll" ref={scrollRef}>
            <div className="aicol">
              {msgs.map((m) =>
                m.role === 'user' ? (
                  <div className="ubub" key={m.id}>
                    {m.content}
                  </div>
                ) : (
                  <Answer
                    key={m.id}
                    m={m}
                    kind={s.kind}
                    title={s.title}
                    papers={props.papers}
                    onOpenPaper={props.onOpenPaper}
                    onConcept={(c) => setConcept({ c, sources: m.meta?.sources ?? [] })}
                    onRetry={() => {
                      const u = msgs[msgs.indexOf(m) - 1]
                      if (u?.role === 'user') send(u.content)
                    }}
                  />
                )
              )}
              {pending !== null && (
                <>
                  <div className="ubub">{pending}</div>
                  <LiveAnswer live={live} kind={firstDone ? 'ask' : s.kind} />
                </>
              )}
              {!msgs.length && !busy && <div className="hint">{t('这个会话还是空的，在下面输入问题。')}</div>}
            </div>
          </div>
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send(input.trim())}
            busy={busy}
            onStop={stopper ? () => (stopper(), toast(t('已停止'))) : undefined}
            placeholder={s.kind === 'find' ? t('接着问，比如「这几篇里哪篇有代码」') : firstDone ? t('接着问，回答只看你库里的论文') : mode.ph}
            className="center"
          />
        </div>
        {concept && <ConceptCard concept={concept.c} sources={concept.sources} onClose={() => setConcept(null)} onOpenPaper={props.onOpenPaper} onAsk={(q) => send(q)} busy={busy} />}
      </div>
    </>
  )
}

// 正在生成：显示走到哪一步；写综述按计划、检索、成文三步画进度
function LiveAnswer(props: { live: Live | null; kind: ResearchKind }) {
  const l = props.live
  if (props.kind === 'review') {
    const at = (st: string): boolean => !!l?.stages.includes(st)
    const step = (n: number, title: string, done: boolean, doing: boolean, body?: React.ReactNode) => (
      <div className={'step' + (done ? ' done' : doing ? ' doing' : '')}>
        <span className="sd">{done ? <Check size={12} strokeWidth={3} /> : doing ? <span className="spin spin-12" /> : n}</span>
        <div className="sb2">
          <div className="stt" style={done || doing ? undefined : { color: 'var(--text-2)' }}>
            {title}
          </div>
          {body}
        </div>
      </div>
    )
    return (
      <div className="steps">
        {step(
          1,
          t('定计划'),
          at('计划'),
          !at('计划'),
          l?.plan && (
            <div className="sdd">
              {l.plan.title && <b style={{ fontWeight: 500 }}>{l.plan.title}：</b>}
              {l.plan.outline.map((o) => o.h).join(' · ')}
            </div>
          )
        )}
        {step(2, t('检索文献'), at('写报告'), at('深度检索文献') && !at('写报告'), l?.stage === '深度检索文献' && <div className="sdd">{l.detail}</div>)}
        {step(
          3,
          t('写成综述'),
          false,
          at('写报告'),
          at('写报告') && (
            <>
              <div className="sdd">{l?.detail}{t('，每段带可点的引用')}</div>
              {l?.text && <Markdown className="md report live" text={l.text} />}
            </>
          )
        )}
      </div>
    )
  }
  return (
    <div>
      {l?.text ? (
        <Markdown className="md" text={l.text} />
      ) : (
        <div className="think">
          <span className="spin spin-12" />
          {l?.stage ? `${stageName(l.stage)}${l.detail ? ` · ${l.detail}` : ''}` : t('开始')}
        </div>
      )}
      {l?.text && <Dots />}
    </div>
  )
}

// [n] 换成可点的小标签
function withCites(md: string, sources: Source[]): string {
  if (!sources.length) return md
  const ok = new Set(sources.map((x) => String(x.n)))
  return md.replace(/\[(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)\](?!\()/g, (all, inner: string) => {
    const ns = inner.split(/[,，]/).map((x) => x.trim())
    if (!ns.every((n) => ok.has(n))) return all
    return ns.map((n) => `<sup class="cchip" data-n="${n}">${n}</sup>`).join('')
  })
}

function Answer(props: { m: ResearchMessage; kind: ResearchKind; title: string; papers: Paper[]; onOpenPaper: (id: string) => void; onConcept: (c: GuideMap['topics'][number]['concepts'][number]) => void; onRetry: () => void }) {
  const { m } = props
  const meta = m.meta
  const sources = meta?.sources ?? []
  const openSource = (n: string): void => {
    const src = sources.find((x) => String(x.n) === n)
    if (!src) return
    if (src.paperId) props.onOpenPaper(src.paperId)
    else if (src.hit?.url) window.open(src.hit.url)
  }
  const onClick = (e: React.MouseEvent): void => {
    const el = (e.target as HTMLElement).closest('[data-n]')
    if (el) openSource(el.getAttribute('data-n')!)
  }
  if (meta?.error)
    return (
      <div className="callout warn">
        <X size={14} />
        <div style={{ flex: 1 }}>
          {t('出错了：')}{meta.error}
          <div>
            <button className="btn sm" style={{ marginTop: 8 }} onClick={props.onRetry}>
              <RotateCcw size={14} />
              {t('再试一次')}
            </button>
          </div>
        </div>
      </div>
    )
  return (
    <div onClick={onClick}>
      {meta?.queries && meta.picks && <div className="think">{t('检索了 {0} 组关键词：', meta.queries.length)}{meta.queries.join('；')}</div>}
      {m.content && <Markdown className={'md' + (meta?.outline ? ' report' : '')} text={withCites(m.content, sources)} />}
      {meta?.picks && <Picks picks={meta.picks} papers={props.papers} />}
      {meta?.map && <MindMap title={props.title} map={meta.map} onConcept={props.onConcept} />}
      {sources.length > 0 && !meta?.map && <SourceList sources={sources} title={meta?.outline ? t('参考文献') : t('出处')} onOpen={(n) => openSource(String(n))} />}
      {m.content && (
        <div className="acts">
          <button
            className="icon-btn"
            title={t('复制')}
            onClick={() => {
              void navigator.clipboard.writeText(m.content)
            }}
          >
            <Copy size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function SourceList(props: { sources: Source[]; title: string; onOpen: (n: number) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? props.sources : props.sources.slice(0, 6)
  return (
    <div style={{ marginTop: 10 }}>
      <div className="sec-t">{props.title}</div>
      <div className="srcl">
        {shown.map((x) => (
          <button className="r" key={x.n} onClick={() => props.onOpen(x.n)} title={x.paperId ? t('在 ParaRead 里打开') : t('在浏览器里打开')}>
            <span className="num hint" style={{ width: 22 }}>
              [{x.n}]
            </span>
            <span className="t">{x.title}</span>
            <span className="hint">{x.paperId ? t('库里') : (x.year ?? '')}</span>
          </button>
        ))}
        {props.sources.length > 6 && (
          <button className="r hint" onClick={() => setAll((v) => !v)}>
            <span className="t" style={{ fontSize: 'var(--fs-sm)' }}>
              {all ? t('收起') : t('还有 {0} 篇', props.sources.length - 6)}
            </span>
            {all ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

function Picks(props: { picks: (SearchHit & { why: string })[]; papers: Paper[] }) {
  const toast = useToast()
  const [st, setSt] = useState<Record<string, 'busy' | 'added' | 'link'>>({})
  const inLib = (h: SearchHit): boolean => props.papers.some((p) => (h.doi && p.doi?.toLowerCase() === h.doi.toLowerCase()) || (h.arxiv && p.arxiv === h.arxiv) || norm(p.title) === norm(h.title))
  const add = async (h: SearchHit): Promise<void> => {
    setSt((m) => ({ ...m, [h.id]: 'busy' }))
    try {
      const r = await api.scholarAdd(h)
      if (r.status === 'failed') throw new Error(r.error)
      setSt((m) => ({ ...m, [h.id]: r.linkOnly ? 'link' : 'added' }))
    } catch (e) {
      setSt((m) => {
        const n = { ...m }
        delete n[h.id]
        return n
      })
      toast(t('加入失败：{0}', errText(e)))
    }
  }
  const rest = props.picks.filter((h) => !inLib(h) && !st[h.id])
  return (
    <div style={{ marginTop: 8 }}>
      {props.picks.map((h) => (
        <div className="res" key={h.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="rt1">{h.url ? <a href={h.url}>{h.title}</a> : h.title}</div>
            <div className="ra">{[(h.authors.length > 3 ? t('{0} 等', h.authors.slice(0, 3).join(', ')) : h.authors.join(', ')), h.venue, h.year].filter(Boolean).join(' · ')}</div>
            <div className="rw" style={{ WebkitLineClamp: 'unset' }}>
              {h.why}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {h.pdfUrl && <span className="tag">{t('开放获取')}</span>}
              {!!h.citations && <span className="tag">{t('被引 {0}', h.citations)}</span>}
            </div>
          </div>
          <div style={{ flex: 'none' }}>
            {inLib(h) || st[h.id] === 'added' ? (
              <span className="tag ok">
                <Check size={12} />
                {st[h.id] ? t('已加入') : t('已在库里')}
              </span>
            ) : st[h.id] === 'link' ? (
              <span className="tag">{t('仅链接')}</span>
            ) : (
              <button className="btn sm" disabled={st[h.id] === 'busy'} onClick={() => void add(h)}>
                {st[h.id] === 'busy' ? <span className="spin spin-12" /> : <Plus size={14} />}
                {t('加入文献库')}
              </button>
            )}
          </div>
        </div>
      ))}
      {rest.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => rest.forEach((h) => void add(h))}>
            <Plus size={16} />
            {t('全部加入（{0} 篇）', rest.length)}
          </button>
        </div>
      )}
    </div>
  )
}

// 学习指南的概念图：左边方向，中间议题，右边概念；点概念看解释
function MindMap(props: { title: string; map: GuideMap; onConcept: (c: GuideMap['topics'][number]['concepts'][number]) => void }) {
  const [on, setOn] = useState<string | null>(null)
  const layout = useMemo(() => {
    const rowH = 36
    const gap = 14
    let y = 16
    const topics = props.map.topics.map((t_) => {
      const concepts = t_.concepts.map((c) => {
        const r = { c, y: y + rowH / 2 }
        y += rowH
        return r
      })
      const top = { t: t_, y: (concepts[0].y + concepts[concepts.length - 1].y) / 2, concepts }
      y += gap
      return top
    })
    return { topics, h: y + 2 }
  }, [props.map])
  const W = 720
  const wOf = (s: string): number => Math.min(220, [...s].reduce((n, ch) => n + (/[　-鿿]/.test(ch) ? 13 : 7.2), 0) + 24)
  const cut = (s: string, w: number): string => {
    let n = 0
    let out = ''
    for (const ch of s) {
      n += /[　-鿿]/.test(ch) ? 13 : 7.2
      if (n > w - 30) return out + '…'
      out += ch
    }
    return out
  }
  const rootY = layout.h / 2
  const xT = 210
  const xC = 430
  return (
    <div className="mindmap">
      <svg viewBox={`0 0 ${W} ${layout.h}`} width="100%" style={{ display: 'block' }}>
        {layout.topics.map((t_, i) => (
          <g key={i}>
            <path d={`M 150 ${rootY} C 180 ${rootY}, ${xT - 30} ${t_.y}, ${xT} ${t_.y}`} className="mm-edge" />
            {t_.concepts.map((c, j) => (
              <path key={j} d={`M ${xT + wOf(t_.t.name)} ${t_.y} C ${xC - 40} ${t_.y}, ${xC - 40} ${c.y}, ${xC} ${c.y}`} className="mm-edge" />
            ))}
          </g>
        ))}
        <g>
          <rect x={8} y={rootY - 18} width={142} height={36} rx={8} className="mm-root" />
          <text x={79} y={rootY + 5} textAnchor="middle" className="mm-t strong">
            {cut(props.title, 142)}
          </text>
        </g>
        {layout.topics.map((t_, i) => (
          <g key={'t' + i}>
            <rect x={xT} y={t_.y - 16} width={wOf(t_.t.name)} height={32} rx={8} className="mm-topic" />
            <text x={xT + 12} y={t_.y + 5} className="mm-t strong">
              {cut(t_.t.name, wOf(t_.t.name))}
            </text>
            {t_.concepts.map((c, j) => {
              const key = `${i}-${j}`
              const w = wOf(c.c.name)
              return (
                <g
                  key={key}
                  className={'mm-c' + (on === key ? ' on' : '')}
                  onClick={() => {
                    setOn(key)
                    props.onConcept(c.c)
                  }}
                >
                  <title>{c.c.explain}</title>
                  <rect x={xC} y={c.y - 14} width={w} height={28} rx={7} />
                  <text x={xC + 12} y={c.y + 4} className="mm-t">
                    {cut(c.c.name, w)}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
      <div className="hint" style={{ padding: '0 12px 10px' }}>
        {t('点一个概念看解释和库里讲到它的论文')}
      </div>
    </div>
  )
}

function ConceptCard(props: { concept: GuideMap['topics'][number]['concepts'][number]; sources: Source[]; busy: boolean; onClose: () => void; onOpenPaper: (id: string) => void; onAsk: (q: string) => void }) {
  const c = props.concept
  const papers = c.papers.map((n) => props.sources.find((x) => x.n === n)).filter((x): x is Source => !!x)
  return (
    <aside className="insp" style={{ width: 360 }}>
      <div className="insp-bd">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="hint">{t('概念')}</span>
          <span className="spacer" />
          <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>
        <h3 style={{ fontSize: 'var(--fs-xl)' }}>{c.name}</h3>
        <div style={{ fontSize: 'var(--fs-md)', lineHeight: 1.65 }}>{c.explain}</div>
        {papers.length > 0 && (
          <div>
            <div className="sec-t">{t('库里讲到它的论文')}</div>
            <div className="srcl">
              {papers.map((x) => (
                <button className="r" key={x.n} onClick={() => x.paperId && props.onOpenPaper(x.paperId)}>
                  <FileText size={14} />
                  <span className="t">{x.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="sec-t">{t('接着问')}</div>
          <div className="sugg">
            {[t('用简单的话讲讲 {0}，举个例子', c.name), t('{0} 在我库里的论文中是怎么用的？', c.name)].map((q) => (
              <button className="s" key={q} disabled={props.busy} onClick={() => props.onAsk(q)}>
                <ArrowRight size={14} />
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}

function exportMarkdown(s: ResearchSession, msgs: ResearchMessage[]): string {
  const out: string[] = []
  for (const m of msgs) {
    if (m.role === 'user') out.push(`> ${m.content.replace(/\n/g, '\n> ')}`)
    else if (m.content) {
      out.push(m.content)
      const src = m.meta?.sources ?? []
      if (src.length) out.push(t('\n## 参考文献\n\n{0}', src.map((x) => `[${x.n}] ${x.title}${x.year ? `（${x.year}）` : ''}${x.hit?.doi ? `. DOI: ${x.hit.doi}` : ''}`).join('\n')))
      if (m.meta?.picks) out.push(m.meta.picks.map((h, i) => `${i + 1}. ${h.title}（${h.year ?? '?'}）${h.url ? ` ${h.url}` : ''}\n   ${h.why}`).join('\n'))
    }
  }
  return `# ${s.title}\n\n${out.join('\n\n')}\n`
}

export function download(name: string, text: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  a.download = name.replace(/[\\/:*?"<>|]+/g, ' ')
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
