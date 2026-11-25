/**
 * AI 的输入框（第 2b 段）：AI 对话（AiPanel）、读 PDF 的主对话（ReadingAi）共用；第 3 段的旁支也用它，只是不放「谁来答」那颗。
 * - 外形照小样 .inp：外边距 8 12 12、圆角 12、--card、1px --line2 外圈 + 投影，有焦点时 --acc-ring + --acc-soft；字最多 6 行再在框里滚，不把输入框撑大。
 * - 底行（CN-91 方向 C「照 Dispatch 三颗」）：「+」加图、谁来答 · 模型 · effort、快捷键提示、发送圆钮。
 *   模型和 effort 只管这个对话（记在这个对话里），没选过用设置 › AI「AI 对话」那一行；换谁来答改的就是那一行。
 * - 顶上一排材料（多段引用方向 B「材料一排加编号」）：引用的一段、贴的图收成 44 高的小卡，字里在当时的光标处留一个编号 ①②③；
 *   点一张看全文，× 删掉，拖着换顺序，字里的编号跟着改。读 PDF 框好的那块是这一排的第一张，不带编号（lead）。
 * - 发出去的那一条（MatMsg）：字里的编号换成小圆点数字，下面一行一条列出每块。
 * - 回答里选一段：选区上方黑色浮条「引用 ⇧⌘L · 拷贝」（QuoteCap）；⇧⌘L 有选区就引用。
 * 弹出来的菜单、看全文的小卡挂在 body 上（右栏有磨砂，fixed 的子元素会另起坐标、被岛的圆角裁掉），都用 use-dismiss：点外面、esc、失焦收起，再点按钮是收起。
 */
import { trackDrag } from '@cn/design/drag-end'
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type AiPick, CLAUDE_DEFAULT, convPick, DEFAULT_EFFORT, ENGINE_LABEL, type EngineId, type EngineInfo, hasEffort, isEngineId, pickLabel, pickReq, t as tNow } from '@cn/ai-engines/shared'
import { AiPicker, engineFamily } from './ai-picker'
import { countLine, MAX_MATERIALS, markOf, type Material, numberOf, renumberMarks, shiftMarks } from './materials'
import { type AtItem, atQuery, eraseMention, liveMentions, type Mention, snapOut, tokenOf } from './mentions'
import { AtMenu, MentionLayers, MentionText } from './mention'
import { clipText, imageFiles, MAX_PASTED, toBytes } from './paste'
import { useDismiss } from './use-dismiss'
import { following, NEAR } from './follow'
import { Icon, useChat, useUi } from './context'
import type { ChatAiState, ChatEngine, ChatPick, WebImg } from './host'
import './composer.css'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------- 输入框里的字和材料 ----------

/** 输入框里的一块材料：id 给界面认（拖、删）；doc：文档里 ⌘J、右键「问 AI」带进来的那一块（跟着那个标签：换了标签拿掉，再 ⌘J 换掉它） */
export type Mat = Material & { id: number; doc?: { tab: string | null } }

let matSeq = 0

export interface Composer {
  text: string
  mats: Mat[]
  /** 字里 @ 点名的文档（画成胶囊；删掉、改坏了的自己去掉） */
  mentions: Mention[]
  ta: RefObject<HTMLTextAreaElement | null>
  /** at：光标放在哪（不给不动） */
  setText(t: string | ((v: string) => string), at?: number): void
  /** 加一块：编号插在光标处，光标落在编号后面；doc：文档里带进来的，是第一块（已经有一块就换掉它） */
  add(m: Material, o?: { doc?: { tab: string | null } }): boolean
  remove(id: number): void
  /** 拖着换顺序：这一块放到第 to 个（从 0 数） */
  move(id: number, to: number): void
  /** 换了标签：别的标签带进来的那一块拿掉（自己打的字留着） */
  dropDocQuotes(tab: string | null): void
  /** @ 候选选上一篇：from 到 to（「@几个字」）换成「@标题 」，光标在空格后面 */
  mention(m: Mention, from: number, to: number): void
  /** 发出去了：字、材料、点名的都清掉 */
  clear(): void
  /** 排着的那一问不发了：它的字接在后面（空一行），材料接在后面（字里的编号跟着往后挪） */
  restore(text: string, mats: Material[]): void
  /** 粘贴、拖进来的文件：图变成材料；没有图返回 false（字照常粘） */
  addFiles(files: (File | null)[]): Promise<boolean>
  /** 字和图一起粘、先贴成了字，点「改贴图片」：at 处贴进去的那段字拿掉，图从那里附上 */
  pasteAsImages(at: number, text: string, files: File[]): Promise<boolean>
  /** 网页上的一张图（拖进来的、右键「问 AI 这张图」的）：取回来、SVG 画成 PNG，成为一块材料，来源「图 6.2.1 · zh.d2l.ai」 */
  addWebImage(img: WebImg): Promise<boolean>
  /** 底行「+」：系统选图框 */
  pickImages(): Promise<void>
  /** 要发出去的材料（去掉界面用的编号） */
  plain(): Material[]
}

export function useComposer(onNotice: (text: string) => void): Composer {
  const chat = useChat()
  const st = useRef<{ text: string; mats: Mat[]; ments: Mention[] }>({ text: '', mats: [], ments: [] })
  const ta = useRef<HTMLTextAreaElement>(null)
  const [, render] = useReducer((x: number) => x + 1, 0)
  const caret = useRef<{ at: number; focus: boolean } | null>(null)
  const notice = useRef(onNotice)
  notice.current = onNotice
  const set = (text: string, mats: Mat[], at?: { at: number; focus: boolean }, ments: readonly Mention[] = st.current.ments) => {
    st.current = { text, mats, ments: ments.length ? liveMentions(text, ments) : [] }
    if (at) caret.current = at
    render()
  }
  // 改了字、加了一块：等字真的写进输入框再放光标（不然写字会把光标挪到最后）
  useLayoutEffect(() => {
    const c = caret.current
    const t = ta.current
    if (!c || !t) return
    caret.current = null
    const put = () => {
      if (c.focus) t.focus()
      t.setSelectionRange(c.at, c.at)
    }
    put()
    // 输入框刚露出来（⌘J 打开 AI 那一格）时第一下可能没落进去：下一帧再放一次
    if (c.focus)
      requestAnimationFrame(() => {
        if (document.activeElement !== t) put()
      })
  })
  const images = () => st.current.mats.filter((m) => m.kind === 'image').length

  const c: Composer = {
    get text() {
      return st.current.text
    },
    get mats() {
      return st.current.mats
    },
    get mentions() {
      return st.current.ments
    },
    ta,
    setText: (t, at) => set(typeof t === 'function' ? t(st.current.text) : t, st.current.mats, at === undefined ? undefined : { at, focus: false }),
    add(m, o = {}) {
      const { text, mats } = st.current
      if (o.doc) {
        const old = mats.findIndex((x) => x.doc)
        if (old >= 0) {
          const next = mats.map((x, i) => (i === old ? ({ ...m, id: x.id, doc: o.doc } as Mat) : x))
          const mark = markOf(old + 1)
          const i = text.indexOf(mark)
          set(i >= 0 ? text : mark + text, next, { at: i >= 0 ? i + 1 : 1, focus: true })
          return true
        }
      }
      if (mats.length >= MAX_MATERIALS) {
        notice.current(tNow('最多{n}块', { n: MAX_MATERIALS }))
        return false
      }
      if (m.kind === 'image' && images() >= MAX_PASTED) {
        notice.current(tNow('最多{n}张', { n: MAX_PASTED }))
        return false
      }
      const mat = { ...m, id: ++matSeq, ...(o.doc ? { doc: o.doc } : {}) } as Mat
      // 文档里带进来的是第一块：别的编号往后挪一个，① 放在字的最前面，光标在它后面
      if (o.doc) set(markOf(1) + shiftMarks(text, mats.length, 1), [mat, ...mats], { at: 1, focus: true })
      else {
        const pos = Math.min(ta.current?.selectionStart ?? text.length, text.length)
        set(text.slice(0, pos) + markOf(mats.length + 1) + text.slice(pos), [...mats, mat], { at: pos + 1, focus: true })
      }
      return true
    },
    remove(id) {
      const { text, mats } = st.current
      const i = mats.findIndex((x) => x.id === id)
      if (i < 0) return
      const r = renumberMarks(
        text,
        mats.map((_, j) => (j < i ? j + 1 : j === i ? 0 : j)),
      )
      set(
        r.text,
        mats.filter((x) => x.id !== id),
        ta.current ? { at: r.at(ta.current.selectionStart), focus: false } : undefined,
      )
    },
    move(id, to) {
      const { text, mats } = st.current
      const from = mats.findIndex((x) => x.id === id)
      if (from < 0 || from === to) return
      const next = [...mats]
      const [m] = next.splice(from, 1)
      next.splice(Math.max(0, Math.min(to, next.length)), 0, m!)
      const r = renumberMarks(
        text,
        mats.map((x) => next.indexOf(x) + 1),
      )
      set(r.text, next, ta.current ? { at: ta.current.selectionStart, focus: false } : undefined)
    },
    dropDocQuotes(tab) {
      const { text, mats } = st.current
      const gone = (x: Mat) => !!x.doc && x.doc.tab !== tab
      if (!mats.some(gone)) return
      let k = 0
      const r = renumberMarks(
        text,
        mats.map((x) => (gone(x) ? 0 : ++k)),
      )
      set(r.text.replace(/^\n+/, ''), mats.filter((x) => !gone(x)))
    },
    mention(m, from, to) {
      const { text, mats, ments } = st.current
      const rest = text.slice(to)
      const ins = tokenOf(m) + (rest.startsWith(' ') ? '' : ' ')
      set(text.slice(0, from) + ins + rest, mats, { at: from + ins.length + (rest.startsWith(' ') ? 1 : 0), focus: true }, [...ments, m])
    },
    clear: () => set('', [], undefined, []),
    restore(text, add) {
      const cur = st.current
      const keep = add.slice(0, MAX_MATERIALS - cur.mats.length)
      const back = renumberMarks(
        shiftMarks(text, add.length, cur.mats.length),
        // 放不下的那几块：字里的编号去掉
        Array.from({ length: cur.mats.length + add.length }, (_, i) => (i < cur.mats.length + keep.length ? i + 1 : 0)),
      ).text
      const joined = cur.text.trim() ? `${cur.text.replace(/\s+$/, '')}\n\n${back}` : back
      set(joined, [...cur.mats, ...keep.map((m) => ({ ...m, id: ++matSeq }) as Mat)], { at: joined.length, focus: true })
    },
    async addFiles(files) {
      const imgs = imageFiles(files)
      if (!imgs.length) return false
      for (const f of imgs) {
        if (images() >= MAX_PASTED) {
          notice.current(tNow('最多{n}张', { n: MAX_PASTED }))
          break
        }
        try {
          const { bytes, mime } = await toBytes(f)
          c.add({ kind: 'image', name: await chat.aiPaste(bytes, mime), src: tNow('粘贴的图') })
        } catch (e) {
          notice.current(errText(e))
        }
      }
      return true
    },
    pasteAsImages(at, text, files) {
      const cur = st.current.text
      if (cur.slice(at, at + text.length) === text) {
        st.current = { ...st.current, text: cur.slice(0, at) + cur.slice(at + text.length) }
        // 光标先放回贴的地方：图的编号插在光标处（add 读 selectionStart）
        if (ta.current) {
          ta.current.value = st.current.text
          ta.current.setSelectionRange(at, at)
        }
        render()
      }
      return c.addFiles(files)
    },
    async addWebImage(img) {
      if (images() >= MAX_PASTED) {
        notice.current(tNow('最多{n}张', { n: MAX_PASTED }))
        return false
      }
      try {
        if (!chat.webImage) return false
        const { name, label } = await chat.webImage.paste(img)
        return c.add({ kind: 'image', name, src: label, ...(/^https?:/i.test(img.url) ? { url: img.url } : {}) })
      } catch (e) {
        notice.current(tNow('这张图没附上：{why}', { why: errText(e) }))
        return false
      }
    },
    async pickImages() {
      const room = MAX_PASTED - images()
      if (room <= 0) return notice.current(tNow('最多{n}张', { n: MAX_PASTED }))
      try {
        for (const g of await chat.aiPickImages(room)) c.add({ kind: 'image', name: g.name, src: g.label })
      } catch (e) {
        notice.current(errText(e))
      }
    },
    plain: () =>
      st.current.mats.map((m) => {
        const { id, doc, ...rest } = m
        void id
        void doc
        return rest as Material
      }),
  }
  return c
}

/**
 * 发出去的那句话：字里只有编号（没打别的字）、带的全是图时，问「这张图讲的是什么」（CN-24，编号不留，图在下面那一行里）；
 * 别的照原样（去掉头尾空白）。替用户问的这句跟界面语言（气泡里看得到，AI 也照它的语言答）
 */
export function sendText(text: string, mats: readonly Material[]): string {
  const bare = !text.replace(/[①-⑳\s]/g, '')
  return bare && mats.length && mats.every((m) => m.kind === 'image') ? tNow('这张图讲的是什么') : text.trim()
}

/** 底行提示：有材料时「3段引用、2张图 · 字里的 ①② 是它们的位置」 */
export const matsHint = (mats: readonly Material[]) => tNow('{count} · 字里的 ①② 是它们的位置', { count: countLine(mats) })

// ---------- 输入框 ----------

/** 顶上那一排的第一张（读 PDF 框好的那块、选中的那段、视频那一帧）：不带编号 */
export interface Lead {
  /** 框的图（blob 网址或库里的图）；还在截时是空的 */
  img?: string | null
  /** 图左下角的小牌「第28页」，或引用那两行的上面一行 */
  label: string
  /** 选中的那段字（有它是引用的样子） */
  quote?: string
  alt: string
  /** × 的说法 */
  removeLabel: string
  onRemove(): void
}

export interface AiInputProps {
  c: Composer
  placeholder: string
  /** 平时底行写的快捷键提示（有材料时换成「几段引用、几张图 · …」） */
  hint: string
  /** 比材料那句还要先说的（读 PDF 框着一块时「↵ 讲解一下 · ⌘↵ 改问法 · esc 取消这块」） */
  hintNow?: string
  lead?: Lead | null
  /** 三颗；不给就没有（只留「+」和发送） */
  picks?: PicksProps | null
  /** 底行「+」后面宿主自己画的那几颗（画布今日：谁来答 · 模型 · 想多久，菜单是它自己的，只管这一段对话）；给了就不画 picks */
  bar?: ReactNode
  running: boolean
  sendDisabled?: boolean
  sendTip?: string
  onSend(): void
  onStop(): void
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void
  onChange?(text: string): void
  onNotice(text: string): void
  className?: string
  /** 输入框里其余的东西（/ 命令菜单、提示一行）：在最上面 */
  children?: ReactNode
  /** 那一排下面、字上面（读 PDF 排着的几问） */
  above?: ReactNode
  /** 输入框正下面一句：发不出去、排着队时写为什么（「另一段对话在用 AI · 去看看」） */
  below?: ReactNode
  /** 输入框里的字只有预填的（或空着）：PDF 那边按 esc 时据此决定连图一起取消（CN-97） */
  own?: boolean
  /** 上面的消息区：输入框长高（材料一排出来）时，原来停在最底下的跟着贴底，不被切掉一截 */
  list?: RefObject<HTMLElement | null>
  /** 输入框下面那一行的全能模式开关（AI 对话、读 PDF 有；旁支不放，跟主对话） */
  omni?: OmniProps | null
  /** 全能模式上面那一排「记笔记 ·《记进哪篇》▾ ｜ 旁支」（AI 对话记笔记开关，shared/ai-note.ts）；旁支里不放 */
  note?: NoteLineProps | null
  /**
   * @ 点名文档（@文档胶囊）：打「@几个字」时列哪几篇（最多列 8 篇，已经点了的不再列）；不给就没有 @。
   * 候选第一条亮着，Tab、↵ 选上，选上的在字里是一颗胶囊；↵ 选的时候不发送。点胶囊打开走 ChatHost.openMention
   */
  at?: ((q: string) => AtItem[]) | null
  /**
   * 开着旁支（task-4edsc 方向 A「就地展开」）：缩成一行灰字（打了的字或占位字），不和旁支的输入框摞着；
   * 点它 onWake（收起旁支），光标回到这里。字和材料都留着
   */
  slim?: { onWake(): void } | null
}

/** 开着的 AI 输入框：右键「问 AI 这张图」附进看得见的那个（网页图拖进对话） */
const inputs = new Map<HTMLElement, { current: Composer }>()

/** 看得见的那个 AI 输入框（有焦点的优先，不然最靠下的那个：主对话的输入框在一栏最下面）；都看不见是 null */
export function shownComposer(): Composer | null {
  const shown = [...inputs].filter(([el]) => el.isConnected && el.checkVisibility({ visibilityProperty: true }) && el.getBoundingClientRect().height > 0)
  const focused = shown.find(([el]) => el.contains(document.activeElement))
  if (focused) return focused[1].current
  shown.sort((a, b) => b[0].getBoundingClientRect().bottom - a[0].getBoundingClientRect().bottom)
  return shown[0]?.[1].current ?? null
}

export function AiInput(p: AiInputProps) {
  const { c } = p
  const { t, inputGlow: glow } = useUi()
  const chat = useChat()
  const [drop, setDrop] = useState(false)
  /** 字和图一起粘、贴成了字：贴在哪、贴的什么、那几张图、贴完输入框里的字（不一样了就不再给「改贴图片」） */
  const [alt, setAlt] = useState<{ at: number; text: string; files: File[]; after: string } | null>(null)
  useEffect(() => {
    if (!alt) return
    const id = setTimeout(() => setAlt(null), 8000)
    return () => clearTimeout(id)
  }, [alt])
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(c)
  latest.current = c
  useEffect(() => {
    const el = root.current
    if (!el) return
    inputs.set(el, latest)
    return () => void inputs.delete(el)
  }, [!!p.slim])
  const shelf = !!p.lead || c.mats.length > 0
  useEffect(() => {
    const el = root.current
    const l = p.list?.current
    if (!el || !l) return
    // 跟不跟着到底照对话那一格的 useFollow（follow.tsx）：人翻上去看着的时候输入框变高也不拽下去
    const bottom = () => l.scrollHeight - l.scrollTop - l.clientHeight <= NEAR
    let atBottom = bottom()
    const onScroll = () => (atBottom = bottom())
    let h = el.offsetHeight
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight !== h && (following(l) ?? atBottom)) l.scrollTop = l.scrollHeight
      h = el.offsetHeight
    })
    l.addEventListener('scroll', onScroll)
    ro.observe(el)
    return () => {
      ro.disconnect()
      l.removeEventListener('scroll', onScroll)
    }
  }, [p.list, !!p.slim])
  const hint = p.hintNow ?? (c.mats.length ? matsHint(c.mats) : p.hint)
  const row = useTightRow()
  // ---------- @ 点名文档 ----------
  /** 光标在哪（@ 候选按光标前面那段认）、上一次在哪（光标进了胶囊往哪头挪） */
  const [caret, setCaret] = useState(0)
  const prevCaret = useRef(0)
  /** 输入法开始组字的地方（组着字时 ↵ 和 Tab 是输入法的） */
  const [ime, setIme] = useState<number | null>(null)
  const [atOn, setAtOn] = useState(0)
  /** esc 收起的那一次 @（从哪儿起的）：接着打字也不再弹，换一个 @ 再弹 */
  const [atShut, setAtShut] = useState<number | null>(null)
  const query = p.at ? atQuery(c.text, Math.min(caret, c.text.length)) : null
  const atItems = query && p.at ? p.at(query.q).filter((x) => !c.mentions.some((m) => m.path === x.path)).slice(0, 8) : []
  const atOpen = !!query && atItems.length > 0 && atShut !== query.from
  const atAt = Math.min(atOn, Math.max(0, atItems.length - 1))
  useEffect(() => setAtOn(0), [query?.from, query?.q])
  const putCaret = (at: number) => {
    prevCaret.current = at
    setCaret(at)
  }
  const pickAt = (i: number) => {
    const n = atItems[i]
    if (!n || !query) return
    const { sub, ...m } = n
    void sub
    c.mention(m, query.from, query.from + 1 + query.q.length)
    // 光标落在「@标题 」的空格后面（c.mention 也放在那里）
    putCaret(query.from + 1 + m.title.length + 1)
  }
  const composingKey = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!composingKey(e)) {
      if (atOpen) {
        const n = atItems.length
        if (e.key === 'ArrowDown') return (e.preventDefault(), setAtOn((atAt + 1) % n))
        if (e.key === 'ArrowUp') return (e.preventDefault(), setAtOn((atAt - 1 + n) % n))
        const plain = !e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey
        if ((e.key === 'Enter' || e.key === 'Tab') && plain) return (e.preventDefault(), pickAt(atAt))
        // esc 只收这个菜单，不往下传（不关 AI 那一格、不清字）
        if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), setAtShut(query!.from))
      }
      // 退格、Delete 碰到胶囊：整个删掉
      const el = e.currentTarget
      if ((e.key === 'Backspace' || e.key === 'Delete') && c.mentions.length && el.selectionStart === el.selectionEnd && !e.metaKey && !e.altKey) {
        const r = eraseMention(c.text, c.mentions, el.selectionStart, e.key === 'Backspace' ? 'back' : 'forward')
        if (r) {
          e.preventDefault()
          c.setText(r.text, r.at)
          putCaret(r.at)
          p.onChange?.(r.text)
          return
        }
      }
    }
    p.onKeyDown(e)
  }
  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    let at = el.selectionStart
    if (c.mentions.length && el.selectionStart === el.selectionEnd) {
      const out = snapOut(el.value, c.mentions, at, prevCaret.current)
      if (out !== at) {
        el.setSelectionRange(out, out)
        at = out
      }
    }
    prevCaret.current = at
    if (at !== caret) setCaret(at)
  }
  const ments = c.mentions.length > 0
  if (p.slim) {
    const wake = p.slim.onWake
    const go = () => {
      wake()
      requestAnimationFrame(() => c.ta.current?.focus())
    }
    return (
      <div
        className={'aiin-slim' + (p.className ? ' ' + p.className : '')}
        data-testid="ai-input-slim"
        role="button"
        tabIndex={0}
        aria-label={t('回到主对话的输入框')}
        title={t('点这里收起旁支、回到主对话')}
        onClick={go}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            go()
          }
        }}
      >
        <span className="ph">{c.text.trim() ? c.text.replace(/\s+/g, ' ').trim() : p.placeholder}</span>
      </div>
    )
  }
  return (
    <>
      <div
        ref={root}
        className={'aiin' + (p.className ? ' ' + p.className : '') + (drop ? ' hot' : '') + (p.omni || p.note ? ' with-omni' : '')}
        data-testid="ai-input"
        data-composer=""
        onDragOver={(e) => {
          const file = [...e.dataTransfer.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))
          // 右栏网页里拖出来的图：带的是网址和 html（不是文件），网页开始拖时报过（宿主的 webImage.dragLive）
          const web = !file && !!chat.webImage?.dragLive() && (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/html'))
          if (!file && !web) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDrop(true)
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) setDrop(false)
        }}
        onDrop={(e) => {
          setDrop(false)
          const files = [...e.dataTransfer.files]
          if (imageFiles(files).length) {
            e.preventDefault()
            void c.addFiles(files)
            return
          }
          // 网页里的图：不让输入框把网址当字插进去；主进程用网页那个会话取图，来源「图 6.2.1 · zh.d2l.ai」
          if (!chat.webImage?.looks(e.dataTransfer)) return
          e.preventDefault()
          void chat.webImage.read(e.dataTransfer).then((found) => {
            for (const img of found) void c.addWebImage(img)
          })
        }}
      >
        {/* AI 在答：边上一道光绕着走（流光 A2，DESIGN.v3 2.3） */}
        {glow?.(p.running)}
        {drop && (
          <div className="aiin-drop" data-testid="ai-drop-say" aria-hidden="true">
            <Icon name="file-media" size={14} />
            {t('松手附上这张图')}
          </div>
        )}
        {atOpen && <AtMenu items={atItems} on={atAt} composing={ime !== null} onPick={pickAt} onHover={setAtOn} />}
        {p.children}
        {shelf && <Shelf c={c} lead={p.lead ?? null} />}
        {p.above}
        <div className={'aiin-tx' + (ments ? ' ment' : '')}>
        {ments && <MentionLayers ta={c.ta} text={c.text} mentions={c.mentions} ime={ime === null ? null : { from: ime, to: caret }} />}
        <textarea
          ref={c.ta}
          rows={1}
          aria-label={t('问 AI')}
          placeholder={p.placeholder}
          value={c.text}
          data-own={p.own ? '1' : undefined}
          onChange={(e) => {
            c.setText(e.target.value)
            putCaret(e.target.selectionStart)
            if (atShut !== null && !atQuery(e.target.value, e.target.selectionStart)) setAtShut(null)
            p.onChange?.(e.target.value)
          }}
          onSelect={onSelect}
          onCompositionStart={(e) => setIme(e.currentTarget.selectionStart)}
          onCompositionEnd={() => setIme(null)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = imageFiles([...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()))
            if (!files.length) return
            e.preventDefault()
            const text = clipText(e.clipboardData)
            if (!text) return void c.addFiles(files)
            // 字和图都有（微信多条聊天记录）：贴字，下面一行「同时有一张图 · 改贴图片」。
            // 用 insertText 写进去（⌘Z 撤得掉；照浏览器自己的粘贴，合成的粘贴事件也一样）
            const el = e.currentTarget
            const at = el.selectionStart
            if (!document.execCommand('insertText', false, text)) c.setText((v) => v.slice(0, at) + text + v.slice(el.selectionEnd))
            setAlt({ at, text, files, after: el.value })
          }}
        />
        </div>
        {/* 贴成字之后：字原样在（没再打字、没发出去）就一直给，8 秒后收起 */}
        {alt && c.text === alt.after && (
          <div className="aiin-alt" data-testid="ai-paste-alt">
            <span>{alt.files.length > 1 ? t('同时有{n}张图', { n: alt.files.length }) : t('同时有一张图')}</span>
            <span aria-hidden="true">·</span>
            <button
              data-testid="ai-paste-alt-go"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setAlt(null)
                void c.pasteAsImages(alt.at, alt.text, alt.files)
              }}
            >
              {t('改贴图片')}
            </button>
          </div>
        )}
        <div className={'ft' + (row.tight ? ' tight' : '')} ref={row.ref}>
          <button className="pick add" aria-label={t('加图')} data-tip={t('加图')} data-side="above" onClick={() => void c.pickImages()}>
            <Icon name="add" size={14} />
          </button>
          {p.bar ?? (p.picks && (p.picks.none ? <NoAi onSetup={p.picks.none.onSetup} /> : <AiPicks {...p.picks} />))}
          <span className="k" data-testid="ai-hint">
            {hint}
          </span>
          {p.running ? (
            <button className="send" aria-label={t('停下')} onClick={p.onStop}>
              <Icon name="primitive-square" size={12} />
            </button>
          ) : (
            <button className="send" aria-label={t('发送')} disabled={p.sendDisabled} data-tip={p.sendTip} data-side="above-left" onClick={p.onSend}>
              <Icon name="arrow-up" size={14} />
            </button>
          )}
        </div>
      </div>
      {p.below}
      {p.note && <NoteLine {...p.note} />}
      {p.omni && <OmniLine {...p.omni} />}
    </>
  )
}

/**
 * 底行「谁来答 · 模型 · effort」三颗写全名放不下时（task-c22p9，AI 栏 350 宽三颗都被省略成半截）：
 * 快捷键提示先让（CSS 按宽藏），再让谁来答只留标志（悬停看名字），还放不下模型名才省略；effort 不缩。
 * 量的是三颗都写全名要多宽（藏起来的那个名字用记下的宽），比这一行宽就 tight
 */
function useTightRow() {
  const [ft, ref] = useState<HTMLDivElement | null>(null)
  const [tight, setTight] = useState(false)
  /** 谁来答的名字写出来占多宽（连同它前面的空隙） */
  const engW = useRef(0)
  const measure = useRef(() => {})
  measure.current = () => {
    if (!ft || !ft.clientWidth) return
    const gap = parseFloat(getComputedStyle(ft).columnGap) || 0
    let need = 0
    let n = 0
    for (const el of ft.children as HTMLCollectionOf<HTMLElement>) {
      if (el.classList.contains('k') || !el.offsetWidth) continue
      const lb = el.querySelector<HTMLElement>(':scope > .lb')
      if (lb && lb.offsetWidth) {
        need += el.offsetWidth + lb.scrollWidth - lb.clientWidth
        if (el.classList.contains('eng')) engW.current = lb.scrollWidth + (parseFloat(getComputedStyle(el).columnGap) || 0)
      } else {
        need += el.offsetWidth + (lb && el.classList.contains('eng') ? engW.current : 0)
      }
      n++
    }
    need += gap * Math.max(0, n - 1)
    const next = need > ft.clientWidth
    setTight((cur) => (cur === next ? cur : next))
  }
  useLayoutEffect(() => measure.current())
  useLayoutEffect(() => {
    if (!ft) return
    const ro = new ResizeObserver(() => measure.current())
    ro.observe(ft)
    return () => ro.disconnect()
  }, [ft])
  return { ref, tight }
}

// ---------- 输入框下面、全能模式上面那一排：记笔记开关（2026-11-24 方向 A「开关两颗」，shared/ai-note.ts） ----------

export interface NoteLineProps {
  /** 主对话记不记 */
  main: boolean
  /** 旁支记不记 */
  side: boolean
  /** 记进哪篇（名字，不带书名号）；还没定是 null，显示「选一篇」 */
  target: string | null
  onMain(): void
  onSide(): void
  /** 点「《记进哪篇》▾」：在 at 下面弹「记进哪篇」 */
  onTarget(at: HTMLElement): void
}


/**
 * 两颗方角开关分开：「记笔记 ·《记进哪篇》▾」在左，竖线后「旁支」在右；样子和全能模式那一行同一套（.ai-omni 的 .om / .sw）。
 * 关着时「《记进哪篇》」照样显示，点得开换一篇
 */
/** 篇名太长截到 n 个字加「…」（同画布笔记 shared/ai-note.ts 的 noteName） */
function noteName(name: string, n: number): string {
  const s = [...name]
  return s.length <= n ? name : s.slice(0, n - 1).join('') + '…'
}

function NoteLine(p: NoteLineProps) {
  const { t } = useUi()
  return (
    <div className="ai-omni ai-note-sw" data-testid="ai-note-sw">
      <button className="om" role="switch" aria-checked={p.main} aria-label={t('记笔记')} data-testid="ai-note-main" data-tip={t('这段对话答一条记一条，记进下面这篇')} data-side="above-start" onClick={p.onMain}>
        <span className="sw" aria-hidden="true" />
        <span className="nm">{t('记笔记')}</span>
      </button>
      <button className="tgt" data-testid="ai-note-target" aria-label={t('记进哪篇')} data-tip={t('记进哪篇')} data-side="above" onClick={(e) => p.onTarget(e.currentTarget)}>
        {p.target ? <span className="nm">{`《${noteName(p.target, 15)}》`}</span> : <span className="dim">{t('选一篇')}</span>}
        <Icon name="chevron-down" size={12} />
      </button>
      <span className="gap" />
      <span className="vr" aria-hidden="true" />
      <button className="om" role="switch" aria-checked={p.side} aria-label={t('旁支也记')} data-testid="ai-note-side" data-tip={t('旁支答完也记进去；单条旁支在它框头上另拨')} data-side="above-end" onClick={p.onSide}>
        <span className="sw" aria-hidden="true" />
        <span className="nm">{t('旁支')}</span>
      </button>
    </div>
  )
}

// ---------- 输入框下面那一行：全能模式（2026-11-19，照 Dispatch 输入框下面的权限那一行） ----------

export interface OmniProps {
  on: boolean
  /** 没接 AI（task-587os）：开关灰着点不了；接上 Key 或 Claude Code 后照已定默认开 */
  off?: boolean
  /** 谁来答（悬停提示里「和在终端里用 Claude Code 一样」） */
  engine: string
  onToggle(): void
  /** 宿主自己的说法（ParaRead 没有库）：开着、关着那一句，灰着时的提示，悬停的全文；不给用画布笔记的 */
  say?: { on: string; off: string; disabled: string; tip: string }
}

/** 悬停说清两种模式各能做什么（三段：开着、关着、两种都一样的） */
export const omniTip = (engine: string) =>
  [
    tNow('开着：和在终端里用{engine}一样，AI能读写这台Mac上的文件、跑命令、上网搜、开子Agent，不停下来问你。', { engine }),
    tNow('关着：AI只在库里动手（新建、改写、改名、挪动、删笔记，建文件夹），不碰库外的文件、不跑命令、不上网搜。'),
    tNow('两种都是一轮改动提交一次，能撤回；AI对话和读PDF共用这一个开关。'),
  ].join('\n')

/**
 * 方角开关（`方角开关`：轨道和滑块都是小圆角方形）+「全能模式」+ 一句现在能做什么；点一下切换，全局记住。
 * 开着时轨道是强调色（开关是「选中」，强调色只给选中和标记）。
 * 那句说明放不下时整句藏起来（不省略成半截），只留开关和「全能模式」，悬停提示里有全文（英文版设计稿第 2 节）
 */
function OmniLine(p: OmniProps) {
  const { t } = useUi()
  const say = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const el = say.current
    if (!el?.parentElement) return
    const check = () => setFits(el.scrollWidth <= el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [p.on, t])
  return (
    <div className="ai-omni" data-testid="ai-omni">
      <button className="om" role="switch" aria-checked={p.on && !p.off} aria-label={t('全能模式')} disabled={p.off} data-tip={p.off ? (p.say?.disabled ?? t('还没接AI：接上API Key或Claude Code后能用')) : (p.say?.tip ?? omniTip(p.engine))} data-side="above-start" data-tip-class="tip-para" onClick={p.onToggle}>
        <span className="sw" aria-hidden="true" />
        <span className="nm">{t('全能模式')}</span>
        {/* 放不下时藏起来、照样占着那一格：宽了量得出它又放得下（composer.css 别的分支正改着，样式写在这里） */}
        <span ref={say} className="say" style={fits ? undefined : { visibility: 'hidden' }}>
          {p.on ? (p.say?.on ?? t('能读写这台Mac上的文件、跑命令、上网')) : (p.say?.off ?? t('关着：只在库里新建、改名、挪动、删笔记'))}
        </span>
      </button>
    </div>
  )
}

/** 顶上那一排：第一张是框好的那块（不带编号），后面是材料 ①②③；点一张看全文，× 删掉，按住拖着换顺序 */
function Shelf(p: { c: Composer; lead: Lead | null }) {
  const { c } = p
  const { t } = useUi()
  const { pastedUrl } = useChat()
  const ref = useRef<HTMLDivElement>(null)
  const [peek, setPeek] = useState<{ key: string; el: HTMLElement } | null>(null)
  const [drag, setDrag] = useState<{ id: number; to: number } | null>(null)
  const n = c.mats.length
  // 加了一块：滚到最后，新的那张露出来
  const before = useRef(n)
  useLayoutEffect(() => {
    if (n > before.current && ref.current) ref.current.scrollLeft = ref.current.scrollWidth
    before.current = n
  }, [n])
  // 看全文的那一块没了（删掉、发出去）：小卡收起
  useEffect(() => {
    if (peek && peek.key !== 'lead' && !c.mats.some((m) => String(m.id) === peek.key)) setPeek(null)
    if (peek?.key === 'lead' && !p.lead) setPeek(null)
  })

  /** 指针在第几张前面（0 到 n） */
  const slot = (x: number) => [...ref.current!.querySelectorAll<HTMLElement>('[data-mat]')].filter((el) => x > el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2).length
  const open = (key: string, el: HTMLElement) => setPeek((v) => (v?.key === key ? null : { key, el }))
  const shown = peek && (peek.key === 'lead' ? p.lead : c.mats.find((m) => String(m.id) === peek.key))

  return (
    <div className="shelf" ref={ref} data-testid="ai-shelf" aria-label={t('引用的材料')}>
      {p.lead && (
        <div
          className={'chipm lead' + (p.lead.quote !== undefined ? ' q' : ' img')}
          data-testid="reading-att"
          onClick={(e) => {
            if (!(e.target as Element).closest('.pxx')) open('lead', e.currentTarget)
          }}
        >
          {p.lead.quote !== undefined ? (
            <>
              {p.lead.img && <img className="fr" src={p.lead.img} alt={p.lead.alt} />}
              <span className="cq">
                <span className="cs">{p.lead.label}</span>
                <span className="ct">{p.lead.quote}</span>
              </span>
            </>
          ) : (
            <span className="lim">
              {p.lead.img ? <img src={p.lead.img} alt={p.lead.alt} /> : <span className="wait" />}
              <span className="pg">{p.lead.label}</span>
            </span>
          )}
          <button className="pxx" aria-label={p.lead.removeLabel} data-tip={p.lead.removeLabel} data-side="above" onClick={p.lead.onRemove}>
            <Icon name="close" size={11} />
          </button>
        </div>
      )}
      {c.mats.map((m, i) => (
        <div
          key={m.id}
          data-mat=""
          data-testid="ai-mat"
          data-src={m.src}
          className={'chipm' + (m.kind === 'image' ? ' img' : '') + (m.kind === 'image' && m.url ? ' web' : '') + (drag?.id === m.id ? ' dragging' : '') + (drag && drag.to === i ? ' dropat' : '') + (drag && drag.to === n && i === n - 1 ? ' dropend' : '')}
          title={m.kind === 'quote' ? t('{src}：{text}', { src: m.src, text: m.text }) : m.src}
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as Element).closest('.pxx')) return
            const el = e.currentTarget
            const x0 = e.clientX
            const y0 = e.clientY
            let moved = false
            el.setPointerCapture(e.pointerId)
            // 松手没送到页面（窗口外松手、失焦）：当没拖过，先后不变、也不打开（trackDrag，task-0nz63）
            trackDrag<PointerEvent>(e, {
              move: (ev) => {
                if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
                moved = true
                setDrag({ id: m.id, to: slot(ev.clientX) })
              },
              end: (how, ev) => {
                setDrag(null)
                if (how !== 'up') return
                if (!moved) return open(String(m.id), el)
                const to = slot(ev!.clientX)
                // 放回原处（自己前后）就不动
                if (to !== i && to !== i + 1) c.move(m.id, to > i ? to - 1 : to)
              },
            })
          }}
        >
          <span className="nb">{i + 1}</span>
          {m.kind === 'image' && m.url ? (
            // 网页上拿来的图：缩略图旁边写来源（照引用卡：上面网站、下面图号）
            <>
              <img src={pastedUrl(m.name)} alt={m.src} draggable={false} />
              <span className="cq" data-testid="ai-mat-src">
                <span className="cs">{webSite(m.src)}</span>
                <span className="ct">{webName(m.src)}</span>
              </span>
            </>
          ) : m.kind === 'image' ? (
            <img src={pastedUrl(m.name)} alt={m.src} draggable={false} />
          ) : (
            <span className="cq">
              <span className="cs">{m.src}</span>
              <span className="ct">{m.text}</span>
            </span>
          )}
          <button className="pxx" aria-label={t('删掉这块')} data-tip={t('删掉这块')} data-side="above" onClick={() => c.remove(m.id)}>
            <Icon name="close" size={11} />
          </button>
        </div>
      ))}
      {peek && shown && <Peek item={shown} anchor={peek.el} onClose={() => setPeek(null)} />}
    </div>
  )
}

/** 网页图的来源「图 6.2.1 · zh.d2l.ai」拆成两行：图号、网站（只有一段时网站那行空着） */
const webName = (src: string) => (src.includes(' · ') ? src.slice(0, src.lastIndexOf(' · ')) : src)
const webSite = (src: string) => (src.includes(' · ') ? src.slice(src.lastIndexOf(' · ') + 3) : '')

/** 点一张卡：在它上面弹 360 宽的小卡看全文（图看大图 + 来源），点外面、esc 收起 */
function Peek(p: { item: Mat | Lead; anchor: HTMLElement; onClose(): void }) {
  const { t } = useUi()
  const { pastedUrl } = useChat()
  const ref = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLElement | null>(p.anchor)
  anchor.current = p.anchor
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    const r = p.anchor.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 368)), bottom: window.innerHeight - r.top + 8 })
  }, [p.anchor])
  // 卡本身也算里面：再点那张卡是收起（Shelf 里切换），不是先收再开
  useDismiss(true, [ref, anchor], p.onClose)
  const it = p.item
  const quote = 'kind' in it ? (it.kind === 'quote' ? it.text : null) : (it.quote ?? null)
  const img = 'kind' in it ? (it.kind === 'image' ? pastedUrl(it.name) : null) : (it.img ?? null)
  const src = 'kind' in it ? it.src : it.label
  return createPortal(
    <div ref={ref} className="ai-peek" data-testid="ai-peek" data-composer-pop="" role="dialog" aria-label={t('看全文')} style={pos ?? { visibility: 'hidden' }}>
      {img && <img src={img} alt={src} />}
      {quote !== null && <div className="pt">{quote}</div>}
      <div className="ps">{src}</div>
    </div>,
    document.body,
  )
}

// ---------- 谁来答 · 模型 · effort ----------

export interface PicksProps {
  engines: ChatEngine[]
  /** 一个 AI 都没接上（task-587os）：底行不假装是哪一家，写「还没接 AI」，点了出上手卡 */
  none?: { onSetup(): void } | null
  /** 这一问真正用的（哪家、模型、effort） */
  pick: ChatPick
  /** 谁来答那一颗：旁支的输入框不放（引擎跟主对话） */
  engine?: boolean
  onEngine(id: string): void
  onModel(id: string): void
  /** null：不指定这一档（OpenCode 的模型不选就是它自己的默认档） */
  onEffort(id: string | null): void
  onNotice(text: string): void
}

/**
 * 这个对话的谁来答 · 模型 · effort（CN-91 方向 C）：哪家跟设置 › AI「AI 对话」那一行（换了就是改那一行）；
 * 模型和 effort 只管这个对话：own 是这个对话自己选过的（记在这个对话里），没选过用那一行的
 */
export function useConvPick<P extends ChatPick = ChatPick, E extends ChatEngine = ChatEngine>(own: P | null | undefined, setOwn: (p: P) => void, onNotice: (t: string) => void, onSetup?: () => void) {
  const chat = useChat()
  const [ai, setAi] = useState<ChatAiState | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      void chat.aiEngines().then((r) => {
        if (live) setAi({ engines: r.engines, chat: r.chat, omni: r.omni, none: r.none, intro: r.intro })
      })
    load()
    // 设置 › AI 里改了「AI 对话」、引擎菜单换了家、「指定位置」找到了：马上跟着换
    const off = chat.onAiPrefsChanged(load)
    return () => {
      live = false
      off()
    }
  }, [chat])
  const engines = (ai?.engines ?? []) as E[]
  // 画布笔记那十家照 @cn/ai-engines 的规矩配模型和档；宿主自己多出来的那一家（ParaRead）也走同一套，认不出的名字下面另写
  const pick = convPick(engines as EngineInfo[], (ai?.chat ?? { engine: 'claude', model: CLAUDE_DEFAULT, effort: DEFAULT_EFFORT }) as AiPick, own as AiPick | null | undefined) as ChatPick as P
  const info = engines.find((e) => e.id === pick.engine)
  // 全能模式：没读到之前当开着（默认开）；点了先在这里换过来，主进程记好以后各处的 AI 面板再要一次
  const omniOn = ai?.omni ?? true
  // 一个都没接上（没命令行、没 Key、本机模型没开）；本机模型这条路不动手，全能开关也灰着
  const none = ai?.none ?? false
  const local = pick.engine === 'ollama' || pick.engine === 'lmstudio'
  return {
    engines,
    pick,
    none,
    /** 第一次开 AI 那一句说明看过没有（没读到之前当看过，不闪一下） */
    introSeen: ai?.intro.ai ?? true,
    omni: {
      on: omniOn,
      off: none || local,
      engine: info?.label ?? labelOfEngine(pick.engine),
      onToggle: () => {
        setAi((x) => (x ? { ...x, omni: !omniOn } : x))
        void chat.aiSetOmni(!omniOn).catch((e: unknown) => onNotice(errText(e)))
      },
    } satisfies OmniProps,
    /** 回答头上写的「Claude Code · Opus 5.5 · High」 */
    label: chatPickLabel(pick, info),
    /** 交给引擎的模型和 effort（空串模型是这家自己的默认模型；task-m55m7 起四家都带：OpenCode、Gemini 也能选模型） */
    req: pickReq(pick as ChatPick as AiPick),
    picks: {
      engines,
      pick,
      none: none && onSetup ? { onSetup } : null,
      onEngine: (id: string) => void chat.aiSetEngine(id),
      onModel: (id: string) => setOwn({ engine: pick.engine, model: id, ...(pick.effort ? { effort: pick.effort } : {}) } as P),
      onEffort: (id: string | null) => setOwn({ engine: pick.engine, model: pick.model ?? '', ...(id ? { effort: id } : {}) } as P),
      onNotice,
    } satisfies PicksProps,
  }
}

/** 这一家叫什么：画布笔记那十家用自带的名字，宿主多出来的用列表里写的（没有就写 id） */
const labelOfEngine = (id: string, info?: ChatEngine) => info?.label ?? (ENGINE_LABEL as Record<string, string>)[id] ?? id

/** 回答头上写的「Claude Code · Opus 5.5 · High」；宿主多出来的那一家：头一段换成它自己的名字 */
function chatPickLabel(pick: ChatPick, info?: ChatEngine): string {
  if (pick.engine in ENGINE_LABEL) return pickLabel(pick as AiPick, info?.models)
  const rest = pickLabel({ ...pick, engine: 'opencode' as const }, info?.models).split(' · ').slice(1)
  return [labelOfEngine(pick.engine, info), ...rest].join(' · ')
}

/** 没接 AI 时底行那一颗：不画任何一家的标志，写「还没接 AI」，点了把上手卡顶上来（task-587os） */
function NoAi(p: { onSetup(): void }) {
  const { t } = useUi()
  return (
    <button className="aipk-noai" data-testid="ai-noai" onClick={p.onSetup}>
      {t('还没接AI')}
    </button>
  )
}

/** 输入框底行：谁来答 · 模型 · effort（CN-91 方向 C），用和设置 › AI 同一个选择器（ai-picker.tsx 的 bar 样子） */
export function AiPicks(p: PicksProps) {
  const { t } = useUi()
  const chat = useChat()
  const pickCli = chat.aiPickCli
  async function locate(id: string) {
    try {
      const e = await pickCli!(id)
      if (e?.path) p.onEngine(id)
    } catch (err) {
      p.onNotice(errText(err))
    }
  }
  return (
    <AiPicker
      look="bar"
      ids={{ family: 'ai-engine', model: 'ai-model', effort: 'ai-effort' }}
      familyMenu={t('AI 引擎')}
      familyHead={t('谁来答')}
      families={p.engines.map(engineFamily)}
      value={{ family: p.pick.engine, model: p.pick.model ?? '', ...(p.pick.effort ? { effort: p.pick.effort } : {}) }}
      // Claude Code、Codex 一直有一档（没选是 High）；OpenCode 的模型不选就是它自己的默认档
      // 宿主多出来的那一家（ParaRead 设置里那家）一直有一档，没有「它自己的默认档」
      unsetEffort={hasEffort(p.pick.engine as EngineId) || !isEngineId(p.pick.engine) ? null : { label: t('默认档'), note: t('它自己的') }}
      effortFoot={t('只管这个对话；默认在设置 › AI「AI对话」那一行。')}
      hideFamily={p.engine === false}
      onFamily={(id) => id && p.onEngine(id)}
      onModel={p.onModel}
      onEffort={p.onEffort}
      {...(pickCli ? { locate: (id: string) => void locate(id) } : {})}
    />
  )
}

// ---------- 发出去的那一条 ----------

/** 字里的 ①② 换成小圆点数字（只换有那么多块的编号） */
function withDots(text: string, count: number): ReactNode[] {
  const out: ReactNode[] = []
  let run = ''
  for (const ch of text) {
    const n = numberOf(ch)
    if (n && n <= count) {
      if (run) out.push(run)
      run = ''
      out.push(
        <span key={out.length} className="fn">
          {n}
        </span>,
      )
    } else run += ch
  }
  if (run) out.push(run)
  return out
}

/** 带材料的那一条：字里的编号是 15 的小圆点数字，下面一行一条列出每块（引用：原文省略号 + 「· 来源」；图：36 高小图 + 来源） */
export function MatMsg(p: { text: string; mats: Material[]; mentions?: readonly Mention[]; lead?: ReactNode; onContextMenu?(e: React.MouseEvent<HTMLElement>): void }) {
  const chat = useChat()
  const { pastedUrl } = chat
  return (
    <div className="um mq" onContextMenu={p.onContextMenu}>
      {p.lead}
      {p.text && (
        <div className="mt">
          <MentionText text={p.text} {...(p.mentions ? { mentions: p.mentions } : {})} plain={(s) => withDots(s, p.mats.length)} />
        </div>
      )}
      <div className="fnl">
        {p.mats.map((m, i) => (
          <div key={i} className="fni" title={m.kind === 'quote' ? m.text : m.src}>
            <span className="fn">{i + 1}</span>
            {m.kind === 'image' ? (
              <>
                <img src={pastedUrl(m.name)} alt={m.src} />
                <span className="fs">{m.src}</span>
              </>
            ) : (
              <>
                <span className="fq">{m.text}</span>
                {/* 网页上引的：来源是回到那一段的链接（右栏网页滚到那几句、亮一下） */}
                {m.url && chat.openQuoteSource ? (
                  <>
                    <span className="fs">·</span>
                    <button className="fs back" data-testid="mat-back" title={tNow('回到网页里这一段')} onClick={() => chat.openQuoteSource!(m.url!, m.text)}>
                      {`${m.src} ↩`}
                    </button>
                  </>
                ) : (
                  <span className="fs">{`· ${m.src}`}</span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- 回答里选一段：「引用 ⇧⌘L · 拷贝」 ----------

/** 选区在 list 里某条 AI 回答的正文里：那段字和这条回答（读它的 data-src 当来源） */
function answerSelection(list: HTMLElement | null): { text: string; rect: DOMRect; src: string } | null {
  const sel = window.getSelection()
  if (!list || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const at = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('.am .txt') ?? null
  const a = at(sel.anchorNode)
  if (!a || a !== at(sel.focusNode) || !list.contains(a)) return null
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  if (text.length < 2) return null
  return { text, rect: sel.getRangeAt(0).getBoundingClientRect(), src: a.closest<HTMLElement>('[data-src]')?.dataset.src ?? tNow('AI的回答') }
}

/**
 * AI 回答里选了一段：选区上方黑色浮条「引用 ⇧⌘L · 拷贝」，点「引用」或按 ⇧⌘L 成为一块材料（来源写在回答的 data-src 上）。
 * 读 PDF 的回答里第 3 段会换成「问这句」那个小框；这里是通用的。active：这一格看得见（藏着的不接 ⇧⌘L）
 */
export function QuoteCap(p: { list: RefObject<HTMLElement | null>; active: boolean; onQuote(text: string, src: string): void }) {
  /** cx：选区横着的中点；浮条画出来量了宽再居中（照小样：选区上方 8、横着居中，放不下往里挪） */
  const { t, isKey, keyLabel } = useUi()
  const chat = useChat()
  const [cap, setCap] = useState<{ text: string; src: string; cx: number; top: number } | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const quote = useRef(p.onQuote)
  quote.current = p.onQuote
  useDismiss(!!cap, [ref], () => setCap(null))
  useEffect(() => {
    const list = p.list.current
    if (!list || !p.active) return
    const up = () =>
      setTimeout(() => {
        const s = answerSelection(list)
        if (!s) return setCap(null)
        // 选区上方 8，横着居中；浮条约 160 宽，放不下往里挪
        setLeft(null)
        setCap({ text: s.text, src: s.src, cx: s.rect.left + s.rect.width / 2, top: Math.max(8, s.rect.top - 42) })
      }, 0)
    const key = (e: KeyboardEvent) => {
      if (!isKey(e, 'quote')) return
      const s = answerSelection(list)
      if (!s) return
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      setCap(null)
      quote.current(s.text, s.src)
    }
    // 回答区滚了：浮条不跟着跑，收起
    const scroll = () => setCap(null)
    list.addEventListener('mouseup', up)
    list.addEventListener('scroll', scroll)
    window.addEventListener('keydown', key, true)
    return () => {
      list.removeEventListener('mouseup', up)
      list.removeEventListener('scroll', scroll)
      window.removeEventListener('keydown', key, true)
    }
  }, [p.list, p.active, isKey])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !cap || left !== null) return
    const w = el.offsetWidth
    setLeft(Math.max(8, Math.min(cap.cx - w / 2, window.innerWidth - w - 8)))
  }, [cap, left])
  if (!cap) return null
  return createPortal(
    <div ref={ref} className="capbar ai-cap" role="toolbar" aria-label={t('选中的这段')} data-composer-pop="" style={{ left: left ?? cap.cx, top: cap.top, ...(left === null ? { visibility: 'hidden' } : {}) }}>
      <button
        className="main"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setCap(null)
          window.getSelection()?.removeAllRanges()
          quote.current(cap.text, cap.src)
        }}
      >
        <Icon name="quote" size={14} />
        {t('引用')}
        {keyLabel('quote') && <kbd>{keyLabel('quote')}</kbd>}
      </button>
      <span className="sepv" />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setCap(null)
          void chat.copy(cap.text)
        }}
      >
        <Icon name="copy" size={14} />
        {t('拷贝')}
      </button>
    </div>,
    document.body,
  )
}
