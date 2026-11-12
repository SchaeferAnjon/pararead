import { Copy, Languages, Lightbulb, MessageCircleQuestion, MessageSquareReply, NotebookPen, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HL_COLORS, type Annotation, type HlColor, type Paper } from '@shared/types'
import { api, streamRequest } from '../api'
import { Markdown } from '../lib/Markdown'
import { Kbd, Skeleton, useDebounced, useEvent } from '../lib/ui'
import { t } from '@shared/i18n'

export interface SelInfo {
  text: string
  paragraph: string
  getRect: () => DOMRect | null
  target: { mode: 'reflow'; blockId: string; blockHash: string; start: number; end: number; section: string } | { mode: 'pdf'; page: number; rects: number[][] } | null
  existing?: Annotation
  image?: string // 原文模式框选的截图
}

type Card = { kind: 'translate' | 'explain'; text: string; done: boolean; error: string | null }

// 划词工具条、翻译和解释的结果卡、笔记编辑。原文和对照共用。
export function SelectionLayer(props: {
  sel: SelInfo | null
  paper: Paper
  lastColor: HlColor
  midRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onCreate: (s: SelInfo, c: HlColor, note?: string) => Promise<Annotation | null>
  onUpdate: (a: Annotation) => Promise<void>
  onDelete: (a: Annotation) => Promise<void>
  onAsk: (quote: string, extra?: string) => void
  onAskImage: (image: string, context: string, prefill?: string) => void
}) {
  const { sel } = props
  const [card, setCard] = useState<Card | null>(null)
  const [noteFor, setNoteFor] = useState<Annotation | null>(null)
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)

  useEffect(() => {
    setCard(null)
    setNoteFor(null)
    setCopied(false)
  }, [sel])

  // 滚动时跟着选区走
  useEffect(() => {
    const el = props.midRef.current
    if (!el) return
    const on = (): void => setTick((t_) => t_ + 1)
    el.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      el.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  }, [props.midRef])

  useLayoutEffect(() => {
    const r = sel?.getRect()
    const mid = props.midRef.current?.getBoundingClientRect()
    const box = boxRef.current
    if (!sel || !r || !mid || !box) return setPos(null)
    const w = box.offsetWidth
    const h = box.offsetHeight
    const preferBelow = !!card || !!noteFor
    const spaceAbove = r.top - mid.top
    let below = preferBelow ? true : spaceAbove < 44 + 8
    let top = below ? r.bottom + 8 : r.top - 8 - h
    if (below && top + h > window.innerHeight - 12 && r.top - 8 - h > mid.top + 12) {
      below = false
      top = r.top - 8 - h
    }
    let left = r.left + r.width / 2 - w / 2
    left = Math.min(Math.max(left, mid.left + 12), mid.right - 12 - w)
    setPos({ left, top, below })
  }, [sel, card, noteFor, tick])

  const close = useEvent(() => {
    props.onClose()
  })

  const runAi = useEvent((kind: 'translate' | 'explain') => {
    if (!sel) return
    stopRef.current?.()
    setCard({ kind, text: '', done: false, error: null })
    const s = streamRequest((id) => api.aiSelection(id, kind, { text: sel.text, paragraph: sel.paragraph, title: props.paper.title, image: sel.image }), {
      delta: (full) => setCard((c) => (c && c.kind === kind ? { ...c, text: full } : c)),
      done: (full) => setCard((c) => (c && c.kind === kind ? { ...c, text: full, done: true } : c)),
      error: (msg, partial) => setCard((c) => (c && c.kind === kind ? { ...c, text: partial, error: msg, done: true } : c))
    })
    // 卡关了请求照样跑完并缓存（主进程缓存），这里只是不再更新界面
    stopRef.current = null
    void s
  })

  const color = useEvent(async (c: HlColor) => {
    if (!sel) return
    if (sel.existing) await props.onUpdate({ ...sel.existing, color: c })
    else await props.onCreate(sel, c)
    close()
  })

  const note = useEvent(async (text: string = '') => {
    if (!sel) return
    let a = sel.existing ?? null
    if (a) {
      if (text) {
        a = { ...a, note: text }
        await props.onUpdate(a)
      }
    } else a = await props.onCreate(sel, props.lastColor, text)
    if (a) setNoteFor(a)
  })

  const ask = useEvent(() => {
    if (!sel) return
    if (sel.image) props.onAskImage(sel.image, sel.paragraph)
    else props.onAsk(sel.text)
    close()
  })

  const copy = useEvent(() => {
    if (!sel) return
    void navigator.clipboard.writeText(sel.text)
    setCopied(true)
    setTimeout(close, 500)
  })

  // 单键快捷：T 翻译、E 解释、1 到 4 颜色、N 笔记、A 问 AI；Esc 关
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'Escape') {
        close()
        window.getSelection()?.removeAllRanges()
        return
      }
      if (card || noteFor || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 't') runAi('translate')
      else if (k === 'e') runAi('explain')
      else if (k === 'n') void note()
      else if (k === 'a') ask()
      else if (['1', '2', '3', '4'].includes(k)) void color(HL_COLORS[Number(k) - 1])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, card, noteFor, runAi, note, ask, color, close])

  // 点空白处关
  useEffect(() => {
    if (!sel) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current?.contains(e.target as Node)) return
      if (card || noteFor) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [sel, card, noteFor, close])

  if (!sel) return null
  const style: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }

  if (noteFor)
    return (
      <div ref={boxRef} className="pop note-pop" style={style}>
        <NoteEditor
          a={noteFor}
          onSave={(t_) => props.onUpdate({ ...noteFor, note: t_ })}
          onColor={(c) => {
            const n = { ...noteFor, color: c }
            setNoteFor(n)
            void props.onUpdate(n)
          }}
          onDelete={() => {
            void props.onDelete(noteFor)
            close()
          }}
        />
      </div>
    )

  if (card)
    return (
      <div ref={boxRef} className="pop result-card" style={style}>
        <div className="card-head">
          <span className="card-kind">{sel.image ? t('截图') : ''}{card.kind === 'translate' ? t('翻译') : t('解释')}</span>
          <div className="spacer" />
          <button className="icon-btn" title={t('复制')} onClick={() => void navigator.clipboard.writeText(card.text)} disabled={!card.text}>
            <Copy size={16} />
          </button>
          <button className="icon-btn" title={t('存为笔记')} disabled={!card.done || !!card.error} onClick={() => void note(card.text)}>
            <NotebookPen size={16} />
          </button>
          <button
            className="icon-btn"
            title={t('追问')}
            disabled={!card.done}
            onClick={() => {
              if (sel.image) props.onAskImage(sel.image, sel.paragraph, `${card.kind === 'translate' ? t('翻译') : t('解释')}：${card.text}`)
              else props.onAsk(sel.text, `${card.kind === 'translate' ? t('翻译') : t('解释')}：${card.text}`)
              close()
            }}
          >
            <MessageSquareReply size={16} />
          </button>
        </div>
        {sel.image ? <img className="card-shot" src={sel.image} alt={t('框选的截图')} /> : <div className="card-quote">{sel.text}</div>}
        <div className="card-body">
          {card.text ? <Markdown text={card.text} className="md" /> : !card.error && <Skeleton lines={[100, 90, 60]} />}
          {card.error && (
            <div className="inline-err">
              <span className="dot sm err" />
              {card.error}
              <button className="text-btn" onClick={() => runAi(card.kind)}>
                {t('重试')}
              </button>
            </div>
          )}
        </div>
      </div>
    )

  const ex = sel.existing
  return (
    <div ref={boxRef} className="pop sel-toolbar" style={style} onMouseDown={(e) => e.preventDefault()}>
      <TBtn icon={<Languages size={16} />} label={t('翻译')} k="T" onClick={() => runAi('translate')} />
      <TBtn icon={<Lightbulb size={16} />} label={t('解释')} k="E" onClick={() => runAi('explain')} />
      <span className="tb-sep" />
      {(sel.target || ex) &&
        HL_COLORS.map((c, i) => (
          <button key={c} className={'dot-btn' + (ex?.color === c ? ' current' : '')} title={t('{0}色高亮 {1}', [t('黄'), t('绿'), t('蓝'), t('红')][i], i + 1)} onClick={() => void color(c)}>
            <span className="hl-dot" data-color={c} />
          </button>
        ))}
      {(sel.target || ex) && <span className="tb-sep" />}
      {(sel.target || ex) && <TBtn icon={<StickyNote size={16} />} label={t('笔记')} k="N" onClick={() => void note()} />}
      <TBtn icon={<MessageCircleQuestion size={16} />} label={t('问 AI')} k="A" onClick={ask} />
      {ex ? (
        <TBtn
          icon={<Trash2 size={16} />}
          label={t('删除')}
          onClick={() => {
            void props.onDelete(ex)
            close()
          }}
        />
      ) : (
        (!sel.image || sel.text) && <TBtn icon={<Copy size={16} />} label={copied ? t('已复制') : sel.image ? t('复制文字') : t('复制')} onClick={copy} />
      )}
    </div>
  )
}

function TBtn(p: { icon: React.ReactNode; label: string; k?: string; onClick: () => void }) {
  return (
    <button className="tb-btn" onClick={p.onClick} title={p.k ? `${p.label}（${p.k}）` : p.label}>
      {p.icon}
      <span>{p.label}</span>
      {p.k && <span className="sr-only"><Kbd>{p.k}</Kbd></span>}
    </button>
  )
}

function NoteEditor(p: { a: Annotation; onSave: (t: string) => Promise<void>; onColor: (c: HlColor) => void; onDelete: () => void }) {
  const [text, setText] = useState(p.a.note)
  const save = useDebounced((t_: string) => void p.onSave(t_), 300)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 12 * 13 * 1.6 + 8) + 'px'
  }, [text])
  return (
    <div className="note-editor">
      <div className="card-quote" data-color={p.a.color}>
        {p.a.text}
      </div>
      <textarea
        ref={ref}
        value={text}
        placeholder={t('写笔记，自动保存')}
        onChange={(e) => {
          setText(e.target.value)
          save(e.target.value)
        }}
      />
      <div className="note-foot">
        {HL_COLORS.map((c) => (
          <button key={c} className={'dot-btn' + (p.a.color === c ? ' current' : '')} onClick={() => p.onColor(c)} title={t('换颜色')}>
            <span className="hl-dot" data-color={c} />
          </button>
        ))}
        <div className="spacer" />
        <button className="icon-btn" title={t('删除')} onClick={p.onDelete}>
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}
