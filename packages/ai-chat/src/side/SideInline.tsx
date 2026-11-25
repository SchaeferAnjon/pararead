/**
 * 旁支就地展开（task-4edsc，用户选的方向 A，原型见那个任务的交付）：
 * 被问的那句所在的那一段下面长出一小块。头（⌄ 收起 · 旁支 · 名字 …… + 这句再开一条 · ⋯ · ×），一句好几条时头下面一排小签，
 * 问答（问的话右边气泡，回答正文；长了在块里滚），答完是回答下面那排（task-eavzx：拷贝 · 插进文档 · ⋯（插进主对话、在笔记里看、存进收件箱、拷贝为 Markdown），
 * 右边快捷回复跟它所在那一处一样，310 宽放不下的进 ⋯），出错是再问一次 · 换个问法 · 换一家；输入框（字 + 「+ · 模型 · effort · 发送」，
 * 不放谁来答：引擎跟主对话，CN-91），最下面一行「记到哪」。焦点在这一块里按 esc 收起。
 * 读 PDF、AI 对话、网页上框着问的回答、文档里的 AI 讲解块共用这一个；问答存在哪、怎么问由各处给。
 */
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiError } from '../ai-error'
import { AiInput, MatMsg, type PicksProps, sendText, useComposer } from '../composer'
import { Icon, useChat, useUi } from '../context'
import { useFollow } from '../follow'
import type { ChatHost, IconName, StepView } from '../host'
import type { Material } from '../materials'
import { StepRow } from '../steps'
import { useDismiss } from '../use-dismiss'
import { ASK_THIS } from './name'
import './side-inline.css'

export { ASK_THIS } from './name'

export interface SideMsgView {
  id: number
  role: 'user' | 'ai'
  text: string
  error?: string
  mats?: Material[]
  engine?: string
  steps?: StepView[]
}

export interface SideView {
  id: string
  quote: string
  name: string
  msgs: SideMsgView[]
}

export interface SideInlineProps {
  side: SideView
  /** 回答里认名字时「不是这篇」记在哪段对话上（task-3e53q）；不给按这条旁支记 */
  conv?: string
  /** 这一句的几条旁支（含这条），按开的先后：两条以上时头下面一排小签 */
  group: { id: string; name: string }[]
  running: boolean
  /** 最下面那一行：记到了哪 */
  /** icon：图标名（宿主的 icon() 画） */
  record: { icon: string; text: string }
  /**
   * 输入框和「记到哪」画在哪：给了就钉在那一格里（视频问框的底部，task-5yp97 选法 2：问框矮，旁支一长输入框就落到外面），
   * 不给就在这一块的最下面
   */
  dock?: HTMLElement | null
  /** 模型、effort 那两颗（跟主对话；谁来答不放） */
  picks: PicksProps
  /** 「在笔记里看」（读 PDF、HTML 才有） */
  onNote?: () => void
  /** 这条旁支挂在哪一处（宿主画回答下面那排时快捷回复跟着那一处排，画布笔记的 ReplyPlace）；不给是 AI 对话 */
  place?: string
  /** 插进文档那块的块头链回哪段对话的哪条回答（旁支挂着的那条）；不给不带链接 */
  link?: { key: string; msg: number }
  onSend(text: string, mats: Material[]): void
  onStop(): void
  onClose(): void
  /** 「+」：这句再开一条 */
  onNew(): void
  onSwitch(id: string): void
  /** 「插进主对话」（⋯ 里）：这条回答作为一块引用进主对话的输入框（不发） */
  onPut(text: string): void
  /** ⋯：改名、删掉、这一份的全部旁支 */
  menu: { title: string; all: { id: string; name: string; right: string }[]; onRename(name: string): void; onDelete(): void }
  onNotice(text: string): void
  /** 要不要把光标放进输入框（打开、切过来的那一下） */
  takeFocus(): boolean
  /** 问答变了（开、问、出字）：外面那一格把这一块滚进来 */
  onGrow?(): void
  /** 头上「全能 / 只在库里」那颗标签的说明里，开关在哪改（右栏 AI、读 PDF：收起旁支后输入框下面那行） */
  omniWhere?: string
  /** 头上「记进笔记 / 不记」那颗小标签（AI 对话记笔记开关，2026-11-24 方向 A）：只管这一条旁支；不给不画 */
  noteTag?: { on: boolean; onToggle(): void } | null
  /** 每条回答下面那一行（「✓ 已记进《…》 · 撤回」）：给这条回答的编号，画什么由外面定 */
  noted?: (id: number) => ReactNode
}

/**
 * 全能模式开没开（task-3e53q「四、c」）：旁支跟着主对话那颗开关走，不单独放开关；设置 › AI、输入框下面那行一改，各处马上跟着变。
 * 没读到之前不画标签（不先画一个可能是错的）
 */
function useOmni(): boolean | null {
  const chat = useChat()
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      void chat.aiEngines().then((r) => {
        if (live) setOn(r.omni)
      })
    load()
    const off = chat.onAiPrefsChanged(load)
    return () => {
      live = false
      off()
    }
  }, [chat])
  return on
}

/** 钉在别处（dock）就用 portal 画过去：键盘、点击照样冒到这一块（esc 收起这一块） */
const dockIn = (dock: HTMLElement | null | undefined, node: ReactNode) => (dock ? createPortal(node, dock) : node)

/** 最后一条答好的回答原文（插进主对话、拷贝用）：去掉可视化、配图那两行标记 */
const lastAnswer = (s: SideView, chat: ChatHost) => {
  const last = [...s.msgs].reverse().find((m) => m.role === 'ai' && m.text.trim() && !m.error)
  return last ? chat.plainAnswer(last.text) : ''
}

export function SideInline(p: SideInlineProps) {
  const { t } = useUi()
  const chat = useChat()
  const { side } = p
  const c = useComposer(p.onNotice)
  const qa = useRef<HTMLDivElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const asked = side.msgs.some((m) => m.role === 'user')
  const answered = side.msgs.some((m) => m.role === 'ai' && m.text.trim() && !m.error)
  const lastAi = [...side.msgs].reverse().find((m) => m.role === 'ai' && m.text.trim() && !m.error)
  const lastAsk = lastAi ? [...side.msgs.slice(0, side.msgs.indexOf(lastAi))].reverse().find((m) => m.role === 'user') : undefined
  const at = p.group.findIndex((g) => g.id === side.id)
  const grow = useRef(p.onGrow)
  grow.current = p.onGrow
  const root = useRef<HTMLDivElement>(null)
  const closeNow = useRef(p.onClose)
  closeNow.current = p.onClose
  // 开着时按 esc 就收起（原型 A）：焦点在这一块里、在回答上、在页面上都算；在别的输入框、文档正文里按的不管（那里有自己的 esc），
  // 弹出来的菜单、小框先收（use-dismiss 在捕获阶段拦住了）
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
      const at = e.target instanceof HTMLElement ? e.target : null
      if (at && !root.current?.contains(at) && at.closest('textarea, input, [contenteditable="true"], webview')) return
      e.preventDefault()
      closeNow.current()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // 换了一条旁支：输入框清掉；打开、切过来的那一下光标进输入框
  useEffect(() => {
    c.clear()
    setRenaming(null)
    requestAnimationFrame(() => {
      if (p.takeFocus()) c.ta.current?.focus({ preventScroll: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side.id])
  // 换了一条、新问：块里滚到底接着跟，外面那一格把整块滚进来（那句留在上面）。
  // 边答边出字：块里跟着到底，人往上翻了就停（follow.tsx）；块还在长高时外面才跟着挪，长满了不再拽外面那一格
  const tail = side.msgs.length ? side.msgs[side.msgs.length - 1]!.text.length : 0
  const fol = useFollow(qa)
  const tall = useRef(0)
  useLayoutEffect(() => {
    fol.follow()
    tall.current = root.current?.offsetHeight ?? 0
    requestAnimationFrame(() => grow.current?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side.id, side.msgs.length])
  useLayoutEffect(() => {
    fol.stick()
    const h = root.current?.offsetHeight ?? 0
    if (h === tall.current) return
    tall.current = h
    requestAnimationFrame(() => grow.current?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail, p.running])

  function send() {
    const mats = c.plain()
    const text = sendText(c.text, mats)
    c.clear()
    p.onSend(text, mats)
  }

  /** 出错那条（最后一条、没在答）：再问一次 = 同一句重发，换个问法 = 那句放回旁支的输入框；换一家照 AiError 自己的 */
  const retryOf = (i: number) => {
    const q = side.msgs[i - 1]
    if (p.running || q?.role !== 'user') return {}
    return {
      onRetry: () => p.onSend(q.text, q.mats ?? []),
      onRephrase: () => {
        c.setText(q.text)
        requestAnimationFrame(() => c.ta.current?.focus())
      },
    }
  }

  const omni = useOmni()
  const omniTip = [
    omni ? t('全能：能读写这台 Mac 上的文件、跑命令、上网。') : t('只在库里：能读库里的笔记，能在库里新建、改名、挪动、删笔记；不碰库外的文件、不跑命令、不上网。'),
    t('和主对话同一个开关；{where}。', { where: p.omniWhere ?? t('在右栏 AI 输入框下面那行改，设置 › AI 里也能改') }),
  ].join('\n')
  const sub = p.group.length > 1 ? t('· {n} 条，在第 {i} 条', { n: p.group.length, i: at + 1 }) : `· ${side.name}`
  return (
    <div
      ref={root}
      className="side-inl"
      role="region"
      aria-label={t('旁支')}
      data-side={side.id}
      onKeyDown={(e) => {
        // 焦点在这一块里按 esc：收起（弹出来的菜单先收，use-dismiss 拦住了）
        if (e.key === 'Escape' && !e.nativeEvent.isComposing && renaming === null) {
          e.preventDefault()
          e.stopPropagation()
          p.onClose()
        }
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="sd-head">
        <button className="ib" aria-label={t('收起旁支')} title={t('收起 esc')} onClick={p.onClose}>
          <Icon name="chevron-down" size={12} />
        </button>
        <Icon name="comment-discussion" size={14} />
        <b>{t('旁支')}</b>
        {renaming !== null ? (
          <input
            className="rn"
            aria-label={t('旁支的名字')}
            autoFocus
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                p.menu.onRename(renaming)
                setRenaming(null)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setRenaming(null)
              }
            }}
            onBlur={() => {
              p.menu.onRename(renaming)
              setRenaming(null)
            }}
          />
        ) : (
          <span className="s" data-tip={side.name}>
            {sub}
          </span>
        )}
        <span className="sp" />
        {p.noteTag && (
          <button
            className={'tagbtn' + (p.noteTag.on ? ' on' : '')}
            data-testid="side-note-tag"
            aria-pressed={p.noteTag.on}
            data-tip={p.noteTag.on ? t('这条旁支答完记进笔记；点一下这条以后不记') : t('这条旁支不记进笔记；点一下记进去（答好的也补进去）')}
            data-side="below-left"
            onClick={p.noteTag.onToggle}
          >
            {p.noteTag.on ? t('记进笔记') : t('不记')}
          </button>
        )}
        {/* 只显示、不能点：开关在主对话输入框下面那行（旁支开着时那行藏起来） */}
        {omni !== null && (
          <span className="mode" data-testid="side-mode" data-tip={omniTip} data-side="below-left" data-tip-class="tip-para" data-tip-in="aside">
            {omni ? t('全能') : t('只在库里')}
          </span>
        )}
        <button className="ib" aria-label={t('这句再开一条旁支')} title={t('这句再开一条旁支')} onClick={p.onNew}>
          <Icon name="add" size={14} />
        </button>
        <button ref={menuBtn} className={'ib' + (menu ? ' open' : '')} aria-label={t('旁支菜单')} aria-haspopup="menu" aria-expanded={menu} title={t('改名、删掉、别的旁支')} onClick={() => setMenu((v) => !v)}>
          <Icon name="ellipsis" size={14} />
        </button>
        <button className="ib" aria-label={t('收起旁支')} title={t('收起 esc')} onClick={p.onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {p.group.length > 1 && (
        <div className="chips" role="tablist" aria-label={t('这一句的旁支')}>
          {p.group.map((g, i) => (
            <button key={g.id} className={'chip' + (g.id === side.id ? ' on' : '')} role="tab" aria-selected={g.id === side.id} title={g.name} onClick={() => g.id !== side.id && p.onSwitch(g.id)}>
              <b>{i + 1}</b>
              <span className="nm">{g.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="qa" ref={qa}>
        {side.msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="sq">
              {m.mats?.length ? <MatMsg text={m.text} mats={m.mats} /> : <span>{m.text}</span>}
            </div>
          ) : (
            <div key={m.id} className="sa" data-testid="side-msg">
              {m.steps?.map((s) => (
                <StepRow key={s.id} s={s} />
              ))}
              {m.text ? (
                <div className="sat">
                  {chat.renderMarkdown(m.text, { conv: p.conv ?? `side:${side.id}`, ...(m.steps ? { steps: m.steps } : {}) })}
                </div>
              ) : m.error ? null : (
                <p className="wait">{t('在答…')}</p>
              )}
              {m.error && <AiError raw={m.error} engine={{ id: m.engine ?? p.picks.pick.engine }} {...(i === side.msgs.length - 1 ? retryOf(i) : {})} />}
              {p.noted?.(m.id)}
            </div>
          ),
        )}
      </div>
      {answered && !p.running && lastAi && (
        <div className="acts" role="group" aria-label={t('这条回答')}>
          {chat.sideAnswerRow ? (
            chat.sideAnswerRow({
              md: lastAnswer(side, chat),
              question: lastAsk?.text ?? '',
              ...(p.place ? { place: p.place } : {}),
              ...(p.link ? { link: p.link } : {}),
              busy: p.running,
              send: (text) => p.onSend(text, []),
              onPut: () => p.onPut(lastAnswer(side, chat)),
              ...(p.onNote ? { onNote: p.onNote } : {}),
            })
          ) : (
            <>
              <button onClick={() => p.onPut(lastAnswer(side, chat))}>
                <Icon name="reply" size={12} />
                {t('放进主对话')}
              </button>
              {p.onNote && (
                <button onClick={p.onNote}>
                  <Icon name="note" size={12} />
                  {t('在笔记里看')}
                </button>
              )}
              <button
                onClick={() => {
                  void chat.copy(lastAnswer(side, chat))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? t('已拷贝') : t('拷贝')}
              </button>
            </>
          )}
        </div>
      )}
      {dockIn(
        p.dock,
        <>
          <AiInput
            c={c}
            className="side-in"
            placeholder={asked ? t('接着问这条旁支…') : t('问这句…（直接 ↵ 就是「{q}」）', { q: t(ASK_THIS) })}
            hint={t('↵ 发送')}
            picks={{ ...p.picks, engine: false }}
            running={p.running}
            sendDisabled={asked && !c.text.trim() && !c.mats.length}
            onSend={send}
            onStop={p.onStop}
            onNotice={p.onNotice}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
                e.preventDefault()
                // 还没问过：空着回车就是「讲讲这句」；问过以后空着不发（发送键也灰着）
                if (!p.running && (!asked || c.text.trim() || c.mats.length)) send()
              }
            }}
          />
          <div className="rec">
            <Icon name={p.record.icon} size={12} />
            <span>{p.record.text}</span>
          </div>
        </>,
      )}
      {menu && (
        <SideMenu
          anchor={menuBtn}
          title={p.menu.title}
          all={p.menu.all}
          current={side.id}
          onClose={() => setMenu(false)}
          onRename={() => {
            setMenu(false)
            setRenaming(side.name)
          }}
          onDelete={() => {
            setMenu(false)
            p.menu.onDelete()
          }}
          onPick={(id) => {
            setMenu(false)
            if (id !== side.id) p.onSwitch(id)
          }}
        />
      )}
    </div>
  )
}

/** 头上 ⋯：300 宽、往下弹、右边和按钮对齐。改名…、删掉这条旁支；这一份的旁支（当前那条打勾，右边在哪 · 几问），点一条切过去 */
function SideMenu(p: {
  anchor: RefObject<HTMLButtonElement | null>
  title: string
  all: { id: string; name: string; right: string }[]
  current: string
  onClose(): void
  onRename(): void
  onDelete(): void
  onPick(id: string): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const a = p.anchor.current!.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(a.right - 300, window.innerWidth - 308)), top: a.bottom + 6 })
  }, [p.anchor])
  useDismiss(true, [ref, p.anchor], p.onClose)
  const { t } = useUi()
  return createPortal(
    <div ref={ref} className="ai-menu side-menu" role="menu" aria-label={t('旁支')} data-composer-pop="" style={{ width: 300, ...(pos ?? { visibility: 'hidden' }) }}>
      <button className="it" role="menuitem" onClick={p.onRename}>
        <span className="ck">
          <Icon name="edit" size={13} />
        </span>
        <span className="nm">{t('改名…')}</span>
      </button>
      <button className="it" role="menuitem" onClick={p.onDelete}>
        <span className="ck">
          <Icon name="close" size={13} />
        </span>
        <span className="nm">{t('删掉这条旁支')}</span>
      </button>
      <div className="sep" />
      <div className="mh">{p.title}</div>
      {p.all.map((s) => (
        <button key={s.id} className="it" role="menuitemradio" aria-checked={s.id === p.current} onClick={() => p.onPick(s.id)}>
          <span className="ck">{s.id === p.current && <Icon name="check" size={14} />}</span>
          <span className="nm">{s.name}</span>
          <span className="r">{s.right}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
