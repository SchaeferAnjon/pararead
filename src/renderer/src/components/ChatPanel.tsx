import { ArrowDown, ArrowRight, AtSign, Bookmark, Brain, ChevronDown, ChevronRight, Copy, FileDown, FileText, Plus, Quote, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { splitFollowups } from '@shared/followups'
import type { ChatMessage, Concept, Paper, SettingsView } from '@shared/types'
import { api, errText, streamRequest } from '../api'
import { Composer } from '../lib/Composer'
import { Markdown } from '../lib/Markdown'
import { showMenu } from '../lib/menu'
import { Dots, useToast } from '../lib/ui'
import { t } from '@shared/i18n'
import { thinkMode } from '@shared/thinking'

export interface Attach {
  quote: string | null
  image: string | null
  prefill?: string
  context?: string // 框选截图所在页的文字，给看图模型做参考
}

const PRESETS = [
  { label: t('总结全文'), q: t('总结全文') },
  { label: t('研究问题和贡献'), q: t('这篇论文研究什么问题，主要贡献是什么？') },
  { label: t('方法怎么做的'), q: t('方法是怎么做的？请按步骤讲。') },
  { label: t('实验结果'), q: t('实验结果怎么样？关键数字有哪些？') },
  { label: t('局限和可改进处'), q: t('这篇论文有哪些局限，可以怎么改进？') }
]

interface Msg extends ChatMessage {
  streaming?: boolean
  thinking?: string
}

const short = (t_: string): string => (t_.length > 28 ? t_.slice(0, 28) + '…' : t_)

// 右栏 AI 问答：本篇加其他文献一起问，深度思考可开关，回答下面一排动作和「接着问」
export function ChatPanel(props: {
  paper: Paper
  settings: SettingsView
  attach: Attach | null
  setAttach: (a: Attach | null) => void
  focusSignal: number
  clearSignal: number
  onSaveNote: (quote: string, answer: string) => Promise<void>
}) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [ctx, setCtx] = useState<{ truncated: boolean; ratio: number } | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<{ id: string; stop: () => void } | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const [thinking, setThinking] = useState(props.settings.thinking)
  const [others, setOthers] = useState<Paper[]>([])
  const [concepts, setConcepts] = useState<{ concepts: Concept[]; questions: string[] } | null>(null)
  const [conceptsBusy, setConceptsBusy] = useState(false)
  const [openThink, setOpenThink] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    void api.chatList(props.paper.id).then(setMsgs)
    void api.chatContext(props.paper.id).then(setCtx)
  }, [props.paper.id])

  useEffect(() => {
    if (!props.focusSignal) return
    taRef.current?.focus()
    if (props.attach?.prefill) setInput('')
  }, [props.focusSignal, props.attach])

  useEffect(() => {
    if (!props.clearSignal) return
    void api.chatClear(props.paper.id).then(() => {
      setMsgs([])
      toast(t('已开始新对话'), {
        label: t('撤销'),
        run: () => void api.chatUndoClear(props.paper.id).then(() => api.chatList(props.paper.id).then(setMsgs))
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clearSignal])

  // 流式时只有本来在底部才跟着滚
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (atBottom.current) el.scrollTop = el.scrollHeight
    else if (busy) setNewBelow(true)
  }, [msgs, busy])

  const onScroll = (): void => {
    const el = listRef.current!
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom.current) setNewBelow(false)
  }

  const send = (text: string): void => {
    if (busy) return
    const a = props.attach
    const content = text.trim() || (a?.image ? t('解释这块') : '')
    if (!content && !a?.quote) return
    const quote = a?.quote ? (a.prefill ? `${a.quote}\n\n${a.prefill}` : a.quote) : null
    const paperIds = others.map((p) => p.id)
    const tempUser: Msg = { id: 'u' + Date.now(), paperId: props.paper.id, role: 'user', content: content || t('解释这段'), quote, image: a?.image ?? null, createdAt: Date.now(), paperIds }
    const tempAns: Msg = { id: 'a' + Date.now(), paperId: props.paper.id, role: 'assistant', content: '', quote: null, image: null, createdAt: Date.now() + 1, streaming: true }
    setMsgs((m) => [...m, tempUser, tempAns])
    setInput('')
    props.setAttach(null)
    atBottom.current = true
    const t0 = Date.now()
    let t1: number | null = null
    const s = streamRequest(
      (id) => api.chatSend(id, props.paper.id, { content: tempUser.content, quote, image: tempUser.image, context: a?.context ?? null, paperIds, thinking: thinking && !tempUser.image }),
      {
        reasoning: (full) => setMsgs((m) => m.map((x) => (x.id === tempAns.id ? { ...x, thinking: full } : x))),
        delta: (full) => {
          t1 ??= Date.now()
          setMsgs((m) => m.map((x) => (x.id === tempAns.id ? { ...x, content: full, thinkMs: x.thinking ? t1! - t0 : null, reasoning: x.thinking ?? null } : x)))
        },
        done: (full) => {
          setMsgs((m) => m.map((x) => (x.id === tempAns.id ? { ...x, content: full, streaming: false } : x)))
          setBusy(null)
          // 换成主进程存好的 id，删除和导出要用
          void api.chatList(props.paper.id).then(setMsgs)
        },
        error: (msg, partial) => {
          setMsgs((m) => m.map((x) => (x.id === tempAns.id ? { ...x, content: partial, streaming: false, error: msg } : x)))
          setBusy(null)
        }
      }
    )
    setBusy(s)
  }

  const regenerate = (i: number): void => {
    const u = [...msgs.slice(0, i)].reverse().find((m) => m.role === 'user')
    if (!u) return
    props.setAttach(u.quote ? { quote: u.quote, image: u.image } : u.image ? { quote: null, image: u.image } : null)
    setTimeout(() => send(u.content), 0)
  }

  const addPaperMenu = async (el: Element): Promise<void> => {
    const all = await api.listPapers()
    const pick = all
      .filter((p) => p.id !== props.paper.id && p.kind !== 'link' && !others.some((o) => o.id === p.id))
      .sort((a, b) => (b.lastOpened ?? b.createdAt) - (a.lastOpened ?? a.createdAt))
      .slice(0, 20)
    if (!pick.length) return toast(t('文献库里没有别的论文'))
    const act = await showMenu(
      [{ type: 'section', label: t('一起问（最近读的）') }, ...pick.map((p) => ({ id: p.id, label: short(p.title), icon: <FileText size={16} />, hint: p.year ? String(p.year) : undefined }))],
      { el }
    )
    const p = pick.find((x) => x.id === act)
    if (p) setOthers((o) => [...o, p])
  }

  const loadConcepts = async (): Promise<void> => {
    setConceptsBusy(true)
    try {
      setConcepts(await api.concepts(props.paper.id))
    } catch (e) {
      toast(t('没列出来：{0}', errText(e)))
    } finally {
      setConceptsBusy(false)
    }
  }

  const canSend = !!(input.trim() || props.attach?.quote || props.attach?.image)
  const lastAns = msgs.map((m) => m.role).lastIndexOf('assistant')

  return (
    <div className="chat">
      <div className="ctxrow">
        <span className="chip on" title={props.paper.title}>
          <FileText size={14} />
          <span className="l">{t('本篇 ')}{short(props.paper.title)}</span>
        </span>
        {others.map((p) => (
          <span className="chip" key={p.id} title={p.title}>
            <FileText size={14} />
            <span className="l">{short(p.title)}</span>
            <button className="chip-x" title={t('不一起问了')} onClick={() => setOthers((o) => o.filter((x) => x.id !== p.id))}>
              <X size={12} />
            </button>
          </span>
        ))}
        {others.length < 19 && (
          <button className="chip dash" onClick={(e) => void addPaperMenu(e.currentTarget)}>
            <Plus size={14} />
            {t('加文献')}
          </button>
        )}
      </div>
      <div className="msgs" ref={listRef} onScroll={onScroll}>
        {ctx?.truncated && <div className="hint">{t('论文较长，只读了前 {0}%', Math.round(ctx.ratio * 100))}</div>}
        {msgs.length === 0 ? (
          <>
            <div>
              <div className="sec-t">{t('核心概念速查')}</div>
              {concepts ? (
                <div className="concepts">
                  {concepts.concepts.map((c) => (
                    <button key={c.term} className="c" title={c.explain} onClick={() => send(t('「{0}」在这篇论文里指什么？', c.term))}>
                      {c.term}
                    </button>
                  ))}
                </div>
              ) : (
                <button className="btn sm" disabled={conceptsBusy} onClick={() => void loadConcepts()}>
                  {conceptsBusy ? <span className="spin spin-12" /> : <Sparkles size={14} />}
                  {conceptsBusy ? t('在读全文…') : t('列出核心概念')}
                </button>
              )}
            </div>
            <div>
              <div className="sec-t">{t('快速开始')}</div>
              <div className="sugg">
                {[...PRESETS.map((p) => p.q), ...(concepts?.questions ?? [])].map((q, i) => (
                  <button key={q} className="s" onClick={() => send(q)}>
                    {i < PRESETS.length ? PRESETS[i].label : q}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          msgs.map((m, i) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg-user">
                {m.quote && <div className="msg-quote">{m.quote}</div>}
                {m.image && <img className="msg-img" src={m.image} alt={t('框选的截图')} />}
                <div className="ubub">{m.content}</div>
                {!!m.paperIds?.length && <div className="hint">{t('和另外 {0} 篇一起问', m.paperIds.length)}</div>}
              </div>
            ) : (
              <div key={m.id} className={'msg-ai' + (i === lastAns ? ' last' : '')}>
                {(m.reasoning || m.thinking) && (
                  <>
                    <button
                      className="think"
                      onClick={() =>
                        setOpenThink((s) => {
                          const n = new Set(s)
                          if (n.has(m.id)) n.delete(m.id)
                          else n.add(m.id)
                          return n
                        })
                      }
                    >
                      {m.streaming && !m.content ? <span className="spin spin-12" /> : openThink.has(m.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {m.streaming && !m.content ? t('正在深度思考…') : t('已深度思考{0}', m.thinkMs ? t('（用时 {0} 秒）', Math.max(1, Math.round(m.thinkMs / 1000))) : '')}
                    </button>
                    {openThink.has(m.id) && <div className="thinkbody">{m.reasoning || m.thinking}</div>}
                  </>
                )}
                {m.content ? <Markdown text={splitFollowups(m.content).body} className="md" /> : m.streaming && !m.thinking ? <Dots /> : null}
                {m.error && (
                  <div className="inline-err">
                    <span className="dot sm err" />
                    {m.error}
                    <button className="text-btn" onClick={() => regenerate(i)}>
                      {t('重试')}
                    </button>
                  </div>
                )}
                {!m.streaming && m.content && (
                  <div className="acts">
                    <button className="icon-btn" title={t('复制')} onClick={() => void navigator.clipboard.writeText(splitFollowups(m.content).body).then(() => toast(t('已复制')))}>
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title={t('存为笔记')}
                      onClick={() => {
                        const u = [...msgs.slice(0, i)].reverse().find((x) => x.role === 'user')
                        void props.onSaveNote(u?.quote ?? u?.content ?? '', splitFollowups(m.content).body).catch((e) => toast(errText(e)))
                      }}
                    >
                      <Bookmark size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title={t('引用到输入框，接着问')}
                      onClick={() => {
                        props.setAttach({ quote: splitFollowups(m.content).body.slice(0, 1200), image: null })
                        taRef.current?.focus()
                      }}
                    >
                      <Quote size={14} />
                    </button>
                    <button className="icon-btn" title={t('重新生成')} onClick={() => regenerate(i)} disabled={!!busy}>
                      <RotateCcw size={14} />
                    </button>
                    <button className="icon-btn" title={t('导出这条 Markdown')} onClick={() => void api.chatExport(props.paper.id, m.id).then((f) => f && toast(t('已导出到 {0}', f.replace(/^.*\//, ''))))}>
                      <FileDown size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title={t('删除这条回答')}
                      onClick={() => {
                        void api.chatDelete(m.id)
                        setMsgs((l) => l.filter((x) => x.id !== m.id))
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
                {i === lastAns && !m.streaming && !busy && splitFollowups(m.content).follow.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="sec-t">{t('接着问')}</div>
                    <div className="sugg">
                      {splitFollowups(m.content).follow.map((q) => (
                        <button key={q} className="s" onClick={() => send(q)}>
                          <ArrowRight size={14} />
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          )
        )}
      </div>
      {newBelow && (
        <button
          className="new-below"
          onClick={() => {
            listRef.current!.scrollTop = listRef.current!.scrollHeight
            setNewBelow(false)
          }}
        >
          <ArrowDown size={14} />{t(' 新回答')}
        </button>
      )}
      <Composer
        inputRef={taRef}
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        canSend={canSend}
        busy={!!busy}
        onStop={() => busy?.stop()}
        placeholder={props.attach?.image ? t('回车直接解释这块，或者写下问题') : others.length ? t('问这 {0} 篇论文', others.length + 1) : t('问这篇论文，⌘L 带上选中的字')}
        top={
          (props.attach?.quote || props.attach?.image) && (
            <div className="attach">
              {props.attach.quote && <div className="attach-quote">{props.attach.quote}</div>}
              {props.attach.image && <img className="attach-img" src={props.attach.image} alt={t('框选的截图')} />}
              <button className="icon-btn sm" title={t('移除')} onClick={() => props.setAttach(null)}>
                <X size={14} />
              </button>
            </div>
          )
        }
        tools={
          <>
            {/* 总会先想的模型（Kimi K3、Claude）开关不起作用，不显示 */}
            {thinkMode(props.settings.provider, props.settings.textModel) !== 'always' && (
              <button
                className={'tchip' + (thinking ? ' on' : '')}
                title={t('深度思考：先想清楚再答，慢一些')}
                onClick={() => {
                  setThinking((v) => !v)
                  void api.setSettings({ thinking: !thinking })
                }}
              >
                <Brain size={14} />
                {t('深度思考')}
              </button>
            )}
            <button className="tchip" title={t('加一篇文献一起问')} onClick={(e) => void addPaperMenu(e.currentTarget)}>
              <AtSign size={14} />
              {t('文献')}
            </button>
          </>
        }
      />
    </div>
  )
}
