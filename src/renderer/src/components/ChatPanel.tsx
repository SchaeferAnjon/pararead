import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, FileText, MessageCircleQuestion, Plus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AiInput, type Lead, sendText, useComposer, useConvPick } from '@cn/ai-chat/composer'
import { AnswerTurn, UserTurn } from '@cn/ai-chat/turns'
import { AnswerBar, type AbAct, type AbMenuItem, type AbReply } from '@cn/ai-chat/answer-bar'
import { ChatToc } from '@cn/ai-chat/chat-toc'
import { AiError } from '@cn/ai-chat/ai-error'
import { AskBox } from '@cn/ai-chat/side/AskBox'
import { EngineLogo } from '@cn/ai-chat/engine-logo'
import type { ChatEngine, ChatPick, StepView } from '@cn/ai-chat/host'
import type { Material } from '@cn/ai-chat/materials'
import { splitFollowups } from '@shared/followups'
import type { ChatBox, ChatMessage, ChatMeta, Concept, Paper, SettingsView } from '@shared/types'
import { api, errText } from '../api'
import { loadPasted, onPastedLoaded, setOwnLogo } from '../lib/aiChatHost'
import { showMenu } from '../lib/menu'
import { useToast } from '../lib/ui'
import { t } from '@shared/i18n'
import { providerOf } from '@shared/providers'
import { isCli } from '@cn/ai-engines/shared'

export interface Attach {
  quote: string | null
  image: string | null
  prefill?: string
  context?: string // 框选截图所在页的文字，给看图模型做参考
  box?: ChatBox // 对照、译文看法里框的：页、框、截的哪边（写进配对笔记用）
}

const PRESETS = [
  { label: t('总结全文'), q: t('总结全文') },
  { label: t('研究问题和贡献'), q: t('这篇论文研究什么问题，主要贡献是什么？') },
  { label: t('方法怎么做的'), q: t('方法是怎么做的？请按步骤讲。') },
  { label: t('实验结果'), q: t('实验结果怎么样？关键数字有哪些？') },
  { label: t('局限和可改进处'), q: t('这篇论文有哪些局限，可以怎么改进？') }
]

/** 正在答的那一条（还没存进主进程） */
interface Live {
  reqId: string
  text: string
  reasoning: string
  steps: NonNullable<ChatMeta['steps']>
  error?: string
}

/** 这一问的请求（要借画布笔记的 Key 时先搁着，同意后再发） */
interface Ask {
  content: string
  quote: string | null
  mats: Material[]
  crop: string | null
  /** 对照、译文看法里框的那块：页、框、截的哪边（写进配对笔记用） */
  box: ChatBox | null
  context: string | null
  paperIds: string[]
  pick: ChatPick
}

const short = (t_: string): string => (t_.length > 28 ? t_.slice(0, 28) + '…' : t_)

/** 命令行自己的一步（全能模式下跑命令、读写文件、上网）写成一行人话 */
function stepView(s: NonNullable<ChatMeta['steps']>[number]): StepView {
  const str = (k: string): string => (typeof s.input[k] === 'string' ? (s.input[k] as string) : '')
  const cut = (x: string, n = 40): string => {
    const one = x.replace(/\s+/g, ' ').trim()
    return one.length > n ? one.slice(0, n) + '…' : one
  }
  const tail = (p: string): string => (p.length > 44 ? '…' + p.slice(-43) : p)
  const view = ((): { label: string; code?: string } => {
    switch (s.tool) {
      case 'Bash':
        return { label: t('跑命令'), code: cut(str('command')) }
      case 'Read':
        return { label: t('读'), code: tail(str('file_path')) }
      case 'Write':
        return { label: t('写'), code: tail(str('file_path')) }
      case 'Edit':
      case 'MultiEdit':
        return { label: t('改'), code: tail(str('file_path')) }
      case 'Glob':
        return { label: t('找文件'), code: cut(str('pattern')) }
      case 'Grep':
        return { label: t('搜「{0}」', cut(str('pattern'), 24)) }
      case 'WebSearch':
        return { label: t('上网搜「{0}」', cut(str('query'), 24)) }
      case 'WebFetch':
        return { label: t('读网页'), code: cut(str('url')) }
      case 'Task':
      case 'Agent':
        return { label: t('开子 Agent：{0}', cut(str('description') || str('prompt'), 24)) }
      default:
        return { label: t('用 {0}', s.tool) }
    }
  })()
  return { id: s.id, ...view, status: s.status, ...(s.detail ? { detail: s.detail } : {}) }
}

// 右栏 AI 问答（2026-11-23 起照画布笔记读 PDF 的对话）：输入框底下一键切谁来答 · 模型 · effort，贴多张图（字里 ①② 是位置），
// 会话接着问，全能模式，回答下面那排；组件是 @cn/ai-chat，和画布笔记同一份。本篇加其他文献一起问、核心概念、快速开始照旧
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
  const notice = (m: string): void => void toast(m)
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [live, setLive] = useState<Live | null>(null)
  const [ctx, setCtx] = useState<{ truncated: boolean; ratio: number } | null>(null)
  const [others, setOthers] = useState<Paper[]>([])
  const [concepts, setConcepts] = useState<{ concepts: Concept[]; questions: string[] } | null>(null)
  const [conceptsBusy, setConceptsBusy] = useState(false)
  const [openThink, setOpenThink] = useState<Set<string>>(new Set())
  const [borrow, setBorrow] = useState<{ id: string; ask: Ask } | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const [, bump] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const c = useComposer(notice)
  // 谁来答 · 模型 · effort：记在设置里（chatPick），输入框底下换了马上记
  const cp = useConvPick<ChatPick, ChatEngine>(undefined, (p) => void api.chatSetPick(p), notice)
  const paperId = props.paper.id

  // 设置里那家（'pararead'）的标志：会员画闪光，别家画服务商的
  useEffect(() => setOwnLogo({ icon: providerOf(props.settings.provider).icon, member: props.settings.provider === 'member' }), [props.settings.provider])

  const reload = (): Promise<void> =>
    api.chatList(paperId).then((list) => {
      setMsgs(list)
      loadPasted(list.flatMap((m) => (m.meta?.mats ?? []).flatMap((x) => (x.kind === 'image' ? [x.name] : []))))
    })

  useEffect(() => {
    setLive(null)
    void reload()
    void api.chatContext(paperId).then(setCtx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])
  useEffect(() => onPastedLoaded(() => bump((n) => n + 1)), [])

  useEffect(() => {
    if (!props.focusSignal) return
    c.ta.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusSignal, props.attach])

  useEffect(() => {
    if (!props.clearSignal) return
    void api.chatClear(paperId).then(() => {
      void api.chatNewConversation(paperId)
      setMsgs([])
      toast(t('已开始新对话'), {
        label: t('撤销'),
        run: () => void api.chatUndoClear(paperId).then(reload)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clearSignal])

  // 流式时只有本来在底部才跟着滚
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (atBottom.current) el.scrollTop = el.scrollHeight
    else if (live) setNewBelow(true)
  }, [msgs, live])

  const onScroll = (): void => {
    const el = listRef.current!
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom.current) setNewBelow(false)
  }

  function go(a: Ask): void {
    const reqId = 'c' + Date.now() + Math.random().toString(36).slice(2, 6)
    const st: Live = { reqId, text: '', reasoning: '', steps: [] }
    setLive({ ...st })
    atBottom.current = true
    const off = api.onStream((e) => {
      if (e.reqId !== reqId) return
      if (e.delta) st.text += e.delta
      if (e.reasoning) st.reasoning += e.reasoning
      if (e.step) {
        const i = st.steps.findIndex((x) => x.id === e.step!.id)
        if (i >= 0) st.steps[i] = e.step
        else st.steps.push(e.step)
      }
      if (e.error) st.error = e.error
      if (e.done || e.error) {
        off()
        void reload().then(() => setLive(null))
        return
      }
      setLive({ ...st, steps: [...st.steps] })
    })
    api
      .chatAsk(reqId, paperId, { content: a.content, quote: a.quote, mats: a.mats, crop: a.crop, box: a.box, context: a.context, paperIds: a.paperIds, pick: a.pick })
      .then((r) => {
        if ('borrow' in r) {
          off()
          setLive(null)
          setBorrow({ id: r.borrow, ask: a })
          return
        }
        setMsgs((m) => [...m, r.user])
      })
      .catch((e: unknown) => {
        off()
        setLive(null)
        toast(errText(e))
      })
  }

  /** 发一问：输入框里的字和材料，读论文时带过来的那段 / 框的那块 */
  function send(raw?: string): void {
    if (live) return
    const a = props.attach
    const mats = raw === undefined ? c.plain() : []
    const typed = raw ?? sendText(c.text, mats)
    const content = typed.trim() || (a?.image ? t('解释这块') : a?.quote ? t('解释这段') : '')
    if (!content && !mats.length) return
    const quote = a?.quote ? (a.prefill ? `${a.quote}\n\n${a.prefill}` : a.quote) : null
    if (raw === undefined) c.clear()
    props.setAttach(null)
    go({ content, quote, mats, crop: a?.image ?? null, box: a?.box ?? null, context: a?.context ?? null, paperIds: others.map((p) => p.id), pick: { engine: cp.pick.engine, ...cp.req } })
  }

  const regenerate = (i: number): void => {
    const u = [...msgs.slice(0, i)].reverse().find((m) => m.role === 'user')
    if (!u) return
    go({ content: u.content, quote: u.quote, mats: u.meta?.mats ?? [], crop: u.image, box: u.box ?? null, context: null, paperIds: u.paperIds ?? [], pick: { engine: cp.pick.engine, ...cp.req } })
  }

  const addPaperMenu = async (el: Element): Promise<void> => {
    const all = await api.listPapers()
    const pick = all
      .filter((p) => p.id !== paperId && p.kind !== 'link' && !others.some((o) => o.id === p.id))
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
      setConcepts(await api.concepts(paperId))
    } catch (e) {
      toast(t('没列出来：{0}', errText(e)))
    } finally {
      setConceptsBusy(false)
    }
  }

  const running = !!live
  const lastAns = msgs.map((m) => m.role).lastIndexOf('assistant')
  const engineLabel = cp.engines.find((e) => e.id === cp.pick.engine)?.label ?? ''
  const a = props.attach
  // 读论文时带过来的：框的那块（图）或选中的那段，放在输入框顶上那一排的第一张
  const lead: Lead | null = a?.image
    ? { img: a.image, label: t('框选的截图'), alt: t('框选的截图'), removeLabel: t('移除'), onRemove: () => props.setAttach(null) }
    : a?.quote
      ? { label: t('论文原文'), quote: a.quote, alt: '', removeLabel: t('移除'), onRemove: () => props.setAttach(null) }
      : null

  /** 一条回答：回答头（谁答的）、命令行的几步、想了什么、正文、下面那排 */
  const answer = (m: ChatMessage, i: number) => {
    const body = splitFollowups(m.content)
    const ask = [...msgs.slice(0, i)].reverse().find((x) => x.role === 'user')
    const last = i === lastAns && !live
    const acts: AbAct[] = [
      { id: 'copy', icon: 'copy', label: t('拷贝'), flash: { icon: 'check', label: t('已拷贝') }, onClick: () => void navigator.clipboard.writeText(body.body) },
      {
        id: 'note',
        icon: 'bookmark',
        label: t('存为笔记'),
        onClick: () => void props.onSaveNote(ask?.quote ?? ask?.content ?? '', body.body).catch((e) => toast(errText(e)))
      }
    ]
    const menu: AbMenuItem[] = [
      {
        id: 'quote',
        icon: 'quote',
        label: t('引用到输入框，接着问'),
        onClick: () => {
          c.add({ kind: 'quote', text: body.body.slice(0, 1200), src: t('AI 的回答') })
          c.ta.current?.focus()
        }
      },
      { id: 'again', icon: 'refresh', label: t('重新生成'), disabled: running, onClick: () => regenerate(i) },
      { id: 'export', icon: 'file-down', label: t('导出这条 Markdown'), onClick: () => void api.chatExport(paperId, m.id).then((f) => f && toast(t('已导出到 {0}', f.replace(/^.*\//, '')))) },
      {
        id: 'delete',
        icon: 'trash',
        label: t('删除这条回答'),
        onClick: () => {
          void api.chatDelete(m.id)
          setMsgs((l) => l.filter((x) => x.id !== m.id))
        }
      }
    ]
    // 右边快捷回复（最新那条）：和画布笔记读 PDF 那两颗一样短；AI 给的「接着问」几句长，照旧在下面一行一句
    const replies: AbReply[] = last
      ? [
          { id: 'confused', label: t('还是不懂'), onClick: () => send(t('还是不懂')) },
          { id: 'again2', label: t('换个讲法'), onClick: () => send(t('换个方式讲')) }
        ]
      : []
    const pick = m.meta?.pick
    const by = m.meta?.label ?? (pick ? undefined : t('设置里那家'))
    return (
      <AnswerTurn
        key={m.id}
        msg={i}
        src={t('AI 的回答')}
        testId="pr-answer"
        head={by ? { by } : null}
        logo={<EngineLogo id={pick?.engine ?? 'pararead'} size={12} className="by-logo" />}
        {...(m.meta?.steps?.length ? { steps: m.meta.steps.map(stepView) } : {})}
        {...(body.body ? { text: m.content } : {})}
        conv={`pararead:${paperId}`}
      >
        {m.reasoning && (
          <div className="think-row">
            <button
              className="think lnk"
              onClick={() =>
                setOpenThink((s) => {
                  const n = new Set(s)
                  if (n.has(m.id)) n.delete(m.id)
                  else n.add(m.id)
                  return n
                })
              }
            >
              {openThink.has(m.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {m.thinkMs ? t('已思考（用时 {0} 秒）', Math.max(1, Math.round(m.thinkMs / 1000))) : t('已思考')}
            </button>
            {openThink.has(m.id) && <div className="thinkbody">{m.reasoning}</div>}
          </div>
        )}
        {m.meta?.error && <AiError raw={m.meta.error} engine={{ id: pick?.engine ?? 'pararead', ...(by ? { label: by } : {}) }} {...(ask && !running ? { onRetry: () => regenerate(i), onRephrase: () => c.setText(ask.content) } : {})} />}
        {!m.meta?.error && body.body && <AnswerBar acts={acts} menu={menu} replies={replies} on={last} text={{ more: t('更多'), moreReplies: t('快捷回复') }} testId="pr-answer-bar" />}
        {last && body.follow.length > 0 && (
          <div className="follow">
            <div className="sec-t">{t('接着问')}</div>
            <div className="sugg">
              {body.follow.map((q) => (
                <button key={q} className="s" onClick={() => send(q)}>
                  <ArrowRight size={14} />
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </AnswerTurn>
    )
  }

  return (
    <div className="chat reading-ai ai">
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
      <div className={'msgs-box' + (msgs.some((m) => m.role === 'user') ? ' toc' : '')}>
      <div className="msgs" ref={listRef} onScroll={onScroll}>
        {ctx?.truncated && <div className="hint">{t('论文较长，只读了前 {0}%', Math.round(ctx.ratio * 100))}</div>}
        {msgs.length === 0 && !live ? (
          <>
            <div className="greet">
              <div className="gt">{t('读《{0}》时想问什么？', short(props.paper.title))}</div>
              <div className="gs">{t('在正文里选一段按 ⌘L 带进来，或者框一块图、贴一张图问')}</div>
            </div>
            <div>
              <div className="sec-t">{t('核心概念速查')}</div>
              {concepts ? (
                <div className="concepts">
                  {concepts.concepts.map((x) => (
                    <button key={x.term} className="c" title={x.explain} onClick={() => send(t('「{0}」在这篇论文里指什么？', x.term))}>
                      {x.term}
                    </button>
                  ))}
                </div>
              ) : (
                <button className="btn sm" disabled={conceptsBusy} onClick={() => void loadConcepts()}>
                  {conceptsBusy ? <span className="spin spin-12" /> : <MessageCircleQuestion size={14} />}
                  {conceptsBusy ? t('在读全文…') : t('列出核心概念')}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <UserTurn
                  key={m.id}
                  text={m.content}
                  {...(m.meta?.mats?.length ? { mats: m.meta.mats } : {})}
                  image={m.image ? { src: m.image, alt: t('框选的截图') } : null}
                  {...(m.quote ? { quote: m.quote.length > 120 ? m.quote.slice(0, 120) + '…' : m.quote } : {})}
                  tocLabel={m.content}
                  acts={m.paperIds?.length ? <div className="hint">{t('和另外 {0} 篇一起问', m.paperIds.length)}</div> : undefined}
                />
              ) : (
                answer(m, i)
              )
            )}
            {live && (
              <AnswerTurn
                msg={msgs.length}
                src={t('AI 的回答')}
                testId="pr-answer-live"
                head={{ by: cp.label }}
                logo={<EngineLogo id={cp.pick.engine} size={12} className="by-logo" />}
                {...(live.steps.length ? { steps: live.steps.map(stepView) } : {})}
                thinking={!live.text && !live.steps.length ? (live.reasoning ? t('正在思考…') : t('正在想…')) : null}
                {...(live.text ? { text: live.text } : {})}
                conv={`pararead:${paperId}`}
              />
            )}
          </>
        )}
      </div>
      {msgs.some((m) => m.role === 'user') && <ChatToc list={listRef} sides={[]} openSide={null} onSide={() => undefined} />}
      </div>
      {/* 回答里选中一句：「引用」进输入框那一排；「问这句」带着这句在这里接着问（ParaRead 没有旁支） */}
      <AskBox
        list={listRef}
        active
        onQuote={(text, src) => c.add({ kind: 'quote', text, src })}
        onAsk={(at, question) => {
          c.add({ kind: 'quote', text: at.quote, src: t('AI 的回答') })
          if (question) c.setText((v) => `${v}${question}`)
          c.ta.current?.focus()
        }}
      />
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
      {borrow && (
        <div className="borrow" data-testid="borrow">
          <b>{t('用画布笔记里存的 {0} Key？', cp.engines.find((e) => e.id === borrow.id)?.label ?? borrow.id)}</b>
          <div className="sub">{t('同意后存一份到 ParaRead 的设置里，钥匙串会问一次')}</div>
          <div className="row2">
            <button
              className="btn primary btn-sm"
              onClick={() =>
                void api.chatBorrow(borrow.id, true).then((r) => {
                  const ask = borrow.ask
                  setBorrow(null)
                  if (r.ok) go(ask)
                  else toast(t('没借成：{0}', r.message ?? ''))
                })
              }
            >
              {t('用它')}
            </button>
            <button
              className="btn ghost btn-sm"
              onClick={() =>
                void api.chatBorrow(borrow.id, false).then(() => {
                  // 没发出去：字和材料放回输入框
                  c.restore(borrow.ask.content, borrow.ask.mats)
                  setBorrow(null)
                  toast(t('在问答框底下换一家，或在 设置 › AI 服务 里填 Key'))
                })
              }
            >
              {t('不用')}
            </button>
          </div>
        </div>
      )}
      {msgs.length === 0 && !live && (
        <div className="quick" data-testid="pr-quick">
          {[...PRESETS.map((p) => p.q), ...(concepts?.questions ?? [])].map((q, i) => (
            <button key={q} className="qb" onClick={() => send(q)}>
              {i < PRESETS.length ? PRESETS[i].label : q}
            </button>
          ))}
        </div>
      )}
      <div className="ai-input-wrap">
        <AiInput
          c={c}
          placeholder={a?.image ? t('回车直接解释这块，或者写下问题') : others.length ? t('问这 {0} 篇论文', others.length + 1) : t('跟{0}说，⌘L 带上选中的字', engineLabel)}
          hint={t('↵ 发送 · ⇧↵ 换行 · 能贴图')}
          lead={lead}
          picks={cp.picks}
          // 全能模式只对本机命令行起作用（ParaRead 的 Key 那几家只聊天）：别的家灰着
          omni={{
            ...cp.omni,
            // 灰着时也写「关着」那一句，不写开着能做什么
            on: cp.omni.on && isCli(cp.pick.engine),
            off: cp.omni.off || !isCli(cp.pick.engine),
            say: {
              on: t('能读写这台电脑上的文件、跑命令、上网'),
              off: t('关着：只回答，不动手'),
              disabled: t('只有本机命令行（Claude Code、Codex 这些）能动手；{0}只回答', engineLabel),
              tip: t('开着：和在终端里用{0}一样，AI 能在研究项目文件夹里读写文件、跑命令、上网搜，不停下来问你。\n关着：只回答，不碰文件、不跑命令。\n只对本机命令行起作用。', cp.omni.engine)
            }
          }}
          running={running}
          sendDisabled={!c.text.trim() && !c.mats.length && !a}
          onSend={() => send()}
          onStop={() => live && void api.aiAbort(live.reqId)}
          onNotice={notice}
          list={listRef}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
              e.preventDefault()
              send()
            }
          }}
          above={
            others.length > 0 ? (
              <button className="lnk" onClick={(e) => void addPaperMenu(e.currentTarget)}>
                {t('和另外 {0} 篇一起问', others.length)}
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  )
}
