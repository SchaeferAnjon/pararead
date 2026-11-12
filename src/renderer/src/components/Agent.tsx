import { ChevronDown, ChevronRight, CircleCheck, CircleX, ExternalLink, File, FileCode, FileText, FlaskConical, Folder as FolderIcon, FolderOpen, Globe, Image, Library, ListTree, MessageCircleQuestion, MessagesSquare, PanelLeft, Pencil, Search, Settings, ShieldCheck, SquarePen, SquareTerminal, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errText, type AgentSession, type AgentStep, type Project } from '../api'
import { Composer } from '../lib/Composer'
import { Markdown } from '../lib/Markdown'
import { showMenu } from '../lib/menu'
import { Empty, useToast } from '../lib/ui'
import { Modal, ModalHead } from './PaperInfo'
import { t } from '@shared/i18n'

type FileRow = { path: string; dir: boolean; size: number; mtime: number }
type Ask = { callId: string; tool: 'run_command' | 'ask_user'; command?: string; question?: string }

const TOOL: Record<string, { label: string; icon: typeof File; arg: (a: Record<string, unknown>) => string }> = {
  list_files: { label: t('列出文件'), icon: ListTree, arg: (a) => String(a.path ?? '.') },
  read_file: { label: t('读取'), icon: FileText, arg: (a) => String(a.path ?? '') },
  write_file: { label: t('写入'), icon: Pencil, arg: (a) => String(a.path ?? '') },
  run_command: { label: t('运行'), icon: SquareTerminal, arg: (a) => String(a.command ?? '') },
  search_library: { label: t('查文献库'), icon: Library, arg: (a) => String(a.query ?? '') },
  read_paper: { label: t('读论文'), icon: FileText, arg: (a) => String(a.paper_id ?? '') + (a.offset ? t(' · 从第 {0} 字', a.offset) : '') },
  search_web: { label: t('全网检索'), icon: Search, arg: (a) => String(a.query ?? '') },
  fetch_url: { label: t('读网页'), icon: Globe, arg: (a) => String(a.url ?? '') },
  add_to_library: { label: t('加入文献库'), icon: Library, arg: (a) => String(a.id ?? '') },
  ask_user: { label: t('问你'), icon: MessageCircleQuestion, arg: (a) => String(a.question ?? '') }
}

export function AgentPage(props: { project: Project | null; sideHidden: boolean; onShowSide: () => void; onChanged: () => void; onOpenPaper: (id: string) => void }) {
  const p = props.project
  const toast = useToast()
  const [files, setFiles] = useState<FileRow[]>([])
  const first = useRef<Map<string, number> | null>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sid, setSid] = useState<string | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [thinking, setThinking] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [answer, setAnswer] = useState('')
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sidRef = useRef(sid)
  sidRef.current = sid

  const loadFiles = useCallback(() => {
    if (!p) return
    void api.agentFiles(p.id).then((f) => {
      if (!first.current) first.current = new Map(f.map((x) => [x.path, x.mtime]))
      setFiles(f)
    })
  }, [p])
  const loadSessions = useCallback(async (): Promise<AgentSession[]> => {
    if (!p) return []
    const s = await api.agentSessions(p.id)
    setSessions(s)
    return s
  }, [p])

  useEffect(() => {
    loadFiles()
    void loadSessions().then((s) => {
      if (s[0]) {
        setSid(s[0].id)
        setSteps(s[0].messages)
      }
    })
  }, [loadFiles, loadSessions])

  useEffect(
    () =>
      api.onAgentEvent((e) => {
        if (e.type === 'files') loadFiles()
        if (e.type === 'done') {
          setRunning((r) => {
            const n = new Set(r)
            n.delete(e.sessionId)
            return n
          })
          void loadSessions()
        }
        if (e.sessionId !== sidRef.current) return
        if (e.type === 'thinking') setThinking(true)
        if (e.type === 'text') {
          setThinking(false)
          setSteps((s) => [...s, { kind: 'assistant', text: String(e.text), at: Date.now() }])
        }
        if (e.type === 'tool') {
          setThinking(false)
          const st = e.step as AgentStep & { kind: 'tool' }
          setSteps((s) => (s.some((x) => x.kind === 'tool' && x.callId === st.callId) ? s.map((x) => (x.kind === 'tool' && x.callId === st.callId ? st : x)) : [...s, st]))
        }
        if (e.type === 'ask') setAsk({ callId: String(e.callId), tool: e.tool as Ask['tool'], command: e.command as string | undefined, question: e.question as string | undefined })
        if (e.type === 'error') {
          setThinking(false)
          toast(t('Agent 出错：{0}', String(e.error)))
        }
        if (e.type === 'done') {
          setThinking(false)
          setAsk(null)
        }
      }),
    [loadFiles, loadSessions, toast]
  )

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [steps, ask, thinking])

  const tree = useMemo(() => {
    const kids = new Map<string, FileRow[]>()
    for (const f of files) {
      const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
      if (!kids.has(parent)) kids.set(parent, [])
      kids.get(parent)!.push(f)
    }
    for (const l of kids.values()) l.sort((a, b) => (a.dir === b.dir ? a.path.localeCompare(b.path) : a.dir ? -1 : 1))
    return kids
  }, [files])

  if (!p)
    return (
      <div className="lib-empty">
        <Empty icon={<FlaskConical size={32} strokeWidth={1.5} />} title={t('没找到这个项目')} text={t('可能被移走或删了。在左边新建一个研究项目。')} />
      </div>
    )

  const busy = !!sid && running.has(sid)
  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    let id = sid
    if (!id) {
      const s = await api.agentNewSession(p.id)
      id = s.id
      setSid(id)
      setSteps([])
    }
    setInput('')
    setSteps((s) => [...s, { kind: 'user', text, at: Date.now() }])
    setRunning((r) => new Set(r).add(id!))
    setThinking(true)
    try {
      await api.agentSend(p.id, id, text)
    } catch (e) {
      toast(errText(e))
      setRunning((r) => {
        const n = new Set(r)
        n.delete(id!)
        return n
      })
      setThinking(false)
    }
  }
  const reply = (a: string): void => {
    if (!sid || !ask) return
    void api.agentAnswer(sid, ask.callId, a)
    setAsk(null)
    setAnswer('')
  }
  const newSession = (): void => {
    setSid(null)
    setSteps([])
    setAsk(null)
  }
  const pickSession = (s: AgentSession): void => {
    setSid(s.id)
    setSteps(s.messages)
    setAsk(null)
  }
  const sessionMenu = async (e: React.MouseEvent, s: AgentSession): Promise<void> => {
    const act = await showMenu([{ id: 'delete', label: t('删除会话'), icon: <Trash2 size={16} />, danger: true, enabled: !running.has(s.id) }], e)
    if (act === 'delete') {
      await api.agentDeleteSession(p.id, s.id)
      if (sid === s.id) newSession()
      void loadSessions()
    }
  }
  const fileMenu = async (e: React.MouseEvent, f: FileRow): Promise<void> => {
    const act = await showMenu(
      [
        { id: 'open', label: t('用默认程序打开'), icon: <ExternalLink size={16} />, enabled: !f.dir },
        { id: 'reveal', label: t('在 Finder 中显示'), icon: <FolderOpen size={16} /> },
        { id: 'mention', label: t('在输入框里提到它'), icon: <MessagesSquare size={16} /> }
      ],
      e
    )
    if (act === 'open') void api.agentOpenFile(p.id, f.path)
    if (act === 'reveal') void api.agentReveal(p.id, f.path)
    if (act === 'mention') setInput((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}${f.path} `)
  }

  const mark = (f: FileRow): string => {
    const m0 = first.current?.get(f.path)
    if (f.dir) return ''
    if (m0 === undefined) return t('新')
    return f.mtime > m0 + 1 ? t('改') : ''
  }
  const fileRow = (f: FileRow, depth: number): React.ReactNode => {
    const name = f.path.split('/').pop()!
    const isOpen = openDirs.has(f.path)
    const Icon = f.dir ? (isOpen ? FolderOpen : FolderIcon) : /\.(py|js|ts|r|jl|m|cpp|c|sh|ipynb)$/i.test(name) ? FileCode : /\.(png|jpe?g|svg|gif)$/i.test(name) ? Image : /\.(md|txt|pdf)$/i.test(name) ? FileText : File
    return (
      <div key={f.path}>
        <button
          className={'f' + (preview === f.path ? ' on' : '')}
          style={{ paddingLeft: 6 + depth * 16 }}
          onClick={() => {
            if (f.dir)
              setOpenDirs((s) => {
                const n = new Set(s)
                if (n.has(f.path)) n.delete(f.path)
                else n.add(f.path)
                return n
              })
            else setPreview(f.path)
          }}
          onDoubleClick={() => !f.dir && void api.agentOpenFile(p.id, f.path)}
          onContextMenu={(e) => void fileMenu(e, f)}
        >
          {f.dir ? isOpen ? <ChevronDown size={12} className="chev" /> : <ChevronRight size={12} className="chev" /> : <span className="chev" />}
          <Icon size={14} />
          <span className="ellipsis">{name}</span>
          {mark(f) && <span className="m">{mark(f)}</span>}
        </button>
        {f.dir && isOpen && (tree.get(f.path) ?? []).map((k) => fileRow(k, depth + 1))}
      </div>
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
        <FlaskConical size={16} />
        {renaming ? (
          <input
            className="input"
            style={{ width: 280, fontSize: 'var(--fs-lg)', fontWeight: 600 }}
            autoFocus
            defaultValue={p.name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== p.name)
                void api
                  .agentRenameProject(p.id, v)
                  .then(props.onChanged)
                  .catch((er) => toast(errText(er)))
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <h1 className="page-title" onDoubleClick={() => setRenaming(true)} title={t('双击改名')}>
            {p.name}
          </h1>
        )}
        <span className="sub ellipsis">{p.dir.replace(/^\/Users\/[^/]+/, '~')}</span>
        <span className="spacer" />
        <button className="icon-btn" title={t('在 Finder 中显示')} onClick={() => void api.agentReveal(p.id)}>
          <FolderOpen size={16} />
        </button>
        <button className="icon-btn" title={t('项目设置')} onClick={() => setSettingsOpen(true)}>
          <Settings size={16} />
        </button>
      </header>
      <div className="lib-body">
        <aside className="ag-files">
          <div className="nav-sec" style={{ marginTop: 0, paddingTop: 12, paddingLeft: 18 }}>
            <span>{t('文件')}</span>
            <span className="spacer" />
            <button className="icon-btn" title={t('在 Finder 中打开项目文件夹，往里放文件')} onClick={() => void api.agentReveal(p.id)}>
              <FolderOpen size={14} />
            </button>
          </div>
          <div className="tree">{(tree.get('') ?? []).map((f) => fileRow(f, 0))}</div>
          <div className="nav-sec" style={{ paddingLeft: 18 }}>
            <span>{t('会话')}</span>
            <span className="spacer" />
            <button className="icon-btn" title={t('新会话')} onClick={newSession}>
              <SquarePen size={14} />
            </button>
          </div>
          <div className="tree">
            {sessions.map((s) => (
              <button className={'f' + (s.id === sid ? ' on' : '')} key={s.id} onClick={() => pickSession(s)} onContextMenu={(e) => void sessionMenu(e, s)}>
                <MessagesSquare size={14} />
                <span className="ellipsis">{s.title}</span>
                {running.has(s.id) && (
                  <span className="m">
                    <span className="spin spin-10" />
                  </span>
                )}
              </button>
            ))}
            {!sid && (
              <button className="f on">
                <MessagesSquare size={14} />
                <span className="ellipsis">{t('新会话')}</span>
              </button>
            )}
          </div>
        </aside>
        <div className="aimain">
          <div className="ag-steps" ref={scrollRef}>
            {!steps.length && (
              <div className="ag-intro">
                <div className="ai-hero" style={{ fontSize: 'var(--fs-xl)' }}>
                  {t('在「{0}」里做研究', p.name)}
                </div>
                <div className="hint">{t('Agent 能读写这个项目文件夹、跑代码、查你的文献库和全网文献。跑命令前会先问你。')}</div>
                <div className="sugg" style={{ marginTop: 8 }}>
                  {[t('把文献库里和这个课题相关的论文找出来，每篇写三行笔记，存成 notes.md'), t('读一篇论文的实验部分，用 Python 复现它的主要表格'), t('全网找近三年的相关工作，列成表存成 related.csv')].map((q) => (
                    <button className="s" key={q} onClick={() => setInput(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {steps.map((s, i) =>
              s.kind === 'user' ? (
                <div className="ubub" key={i}>
                  {s.text}
                </div>
              ) : s.kind === 'assistant' ? (
                <Markdown key={i} className="md" text={s.text} />
              ) : (
                <ToolStep key={s.callId} s={s} />
              )
            )}
            {busy && thinking && !ask && (
              <div className="think">
                <span className="spin spin-12" />
                {t('想下一步')}
              </div>
            )}
            {ask?.tool === 'run_command' && (
              <div className="perm">
                <div className="perm-t">
                  <ShieldCheck size={16} />
                  {t('Agent 想运行一条命令')}
                </div>
                <code>{ask.command}</code>
                <div className="hint">{t('在项目文件夹里运行，最长 2 分钟。')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => reply('deny')}>
                    {t('不允许')}
                  </button>
                  <span className="spacer" />
                  <button className="btn" onClick={() => reply('always')} title={t('这一轮里后面的命令不再问')}>
                    {t('这一轮都允许')}
                  </button>
                  <button className="btn primary" onClick={() => reply('once')}>
                    {t('允许一次')}
                  </button>
                </div>
              </div>
            )}
            {ask?.tool === 'ask_user' && (
              <div className="perm">
                <div className="perm-t">
                  <MessageCircleQuestion size={16} />
                  {t('Agent 问你')}
                </div>
                <div>{ask.question}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && answer.trim() && reply(answer.trim())} />
                  <button className="btn" onClick={() => reply('deny')}>
                    {t('不回答')}
                  </button>
                  <button className="btn primary" disabled={!answer.trim()} onClick={() => reply(answer.trim())}>
                    {t('回答')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            busy={busy}
            onStop={() => sid && void api.agentStop(sid)}
            placeholder={t('描述研究任务，比如「读 papers 里的论文，复现它的表 3」')}
          />
        </div>
        {preview && <Preview project={p} path={preview} mtime={files.find((f) => f.path === preview)?.mtime ?? 0} onClose={() => setPreview(null)} />}
      </div>
      {settingsOpen && <ProjectSettings project={p} onClose={() => setSettingsOpen(false)} onSaved={props.onChanged} />}
    </>
  )
}

function ToolStep(props: { s: AgentStep & { kind: 'tool' } }) {
  const s = props.s
  const [open, setOpen] = useState(false)
  const t_ = TOOL[s.name] ?? { label: s.name, icon: SquareTerminal, arg: () => JSON.stringify(s.args) }
  const done = s.result !== undefined || s.error !== undefined || s.denied
  const out = s.error ? t('错误：{0}', s.error) : s.result
  return (
    <div className="tool">
      <button className="th" onClick={() => out && setOpen((v) => !v)}>
        {!done ? <span className="spin spin-12" /> : s.error || s.denied ? <CircleX size={14} className="bad" /> : <CircleCheck size={14} className="good" />}
        <t_.icon size={14} />
        <span className="tt">
          {t_.label} <code>{t_.arg(s.args)}</code>
          {s.denied && <span className="hint">{t(' · 没允许')}</span>}
        </span>
        {out && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </button>
      {open && out && <div className="out">{out}</div>}
    </div>
  )
}

function Preview(props: { project: Project; path: string; mtime: number; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const binary = /\.(png|jpe?g|gif|pdf|docx?|xlsx?|pptx?|zip|ipynb)$/i.test(props.path)
  useEffect(() => {
    setText(null)
    setErr(null)
    if (binary) return
    api
      .agentReadFile(props.project.id, props.path)
      .then(setText)
      .catch((e) => setErr(errText(e)))
  }, [props.project.id, props.path, props.mtime, binary])
  const csv = /\.(csv|tsv)$/i.test(props.path) && text ? parseCsv(text, props.path.endsWith('.tsv') ? '\t' : ',') : null
  return (
    <aside className="preview">
      <div className="pv-hd">
        <File size={16} />
        <span className="ellipsis" style={{ fontWeight: 500 }}>
          {props.path}
        </span>
        <span className="spacer" />
        <button className="icon-btn" title={t('用默认程序打开')} onClick={() => void api.agentOpenFile(props.project.id, props.path)}>
          <ExternalLink size={16} />
        </button>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="pv-bd">
        {binary ? (
          <div className="callout">
            <span>{t('这种文件在这里预览不了，点右上角用默认程序打开。')}</span>
          </div>
        ) : err ? (
          <div className="callout warn">{err}</div>
        ) : text === null ? (
          <span className="spin spin-12" />
        ) : csv ? (
          <table className="pv-table">
            <tbody>
              {csv.slice(0, 200).map((r, i) => (
                <tr key={i} className={i === 0 ? 'h' : ''}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : /\.md$/i.test(props.path) ? (
          <Markdown className="md" text={text} />
        ) : (
          <pre className="pv-code">{text}</pre>
        )}
      </div>
    </aside>
  )
}

function parseCsv(t_: string, sep: string): string[][] {
  return t_
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const out: string[] = []
      let cur = ''
      let q = false
      for (const ch of line) {
        if (ch === '"') q = !q
        else if (ch === sep && !q) {
          out.push(cur)
          cur = ''
        } else cur += ch
      }
      out.push(cur)
      return out
    })
}

function ProjectSettings(props: { project: Project; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(props.project.instructions)
  return (
    <Modal width={560} label={t('项目设置')} onClose={props.onClose}>
      <ModalHead title={t('项目设置')} sub={`「${props.project.name}」 · ${props.project.dir.replace(/^\/Users\/[^/]+/, '~')}`} onClose={props.onClose} />
      <div className="m-bd">
        <label className="lbl" htmlFor="ins">
          {t('项目说明')}
        </label>
        <textarea id="ins" className="input area" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('每次都告诉 Agent 的话：研究课题、用什么语言写代码、结果放哪个文件夹、要注意什么')} />
        <div className="callout">
          <ShieldCheck size={14} />
          <span>{t('Agent 只能读写这个项目文件夹；跑命令前都会问你，「这一轮都允许」只管当前这一轮。')}</span>
        </div>
      </div>
      <div className="m-ft">
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>
          {t('取消')}
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            await api.agentSetInstructions(props.project.id, text)
            props.onSaved()
            props.onClose()
          }}
        >
          {t('保存')}
        </button>
      </div>
    </Modal>
  )
}
