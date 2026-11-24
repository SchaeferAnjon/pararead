import { BookOpen, ChevronDown, Copy, Languages, Lightbulb, MessageCircleQuestion, MessageSquareReply, NotebookPen, Sparkles, StickyNote, Trash2, Underline } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Annotation, type AnnLabel, type ChatBox, type HlColor, type IdeaHow, type Paper } from '@shared/types'
import type { ShotSide } from '@shared/layoutTr'
import { showMenu } from '../lib/menu'
import { stackImages } from '../lib/layoutTr'
import { CONFUSED, type HlKind } from '@cn/format'
import { firstPlainKind, kindOf, withKind } from '@shared/cnLink'
import { IdeaCapture, type IdeaDraft } from './IdeaCard'
import { LABEL_NAME } from '@shared/annLabels'
import { api, streamRequest } from '../api'
import { Markdown } from '../lib/Markdown'
import { Kbd, Skeleton, useDebounced, useEvent } from '../lib/ui'
import { t } from '@shared/i18n'

export interface SelInfo {
  text: string
  paragraph: string
  getRect: () => DOMRect | null
  target: { mode: 'reflow'; blockId: string; blockHash: string; start: number; end: number; section: string } | { mode: 'pdf'; page: number; rects: number[][]; side?: 'tr' } | null
  existing?: Annotation
  image?: string // 原文模式框选的截图
  /** 对照、译文看法里框的：哪一页、框在页上的比例位置，两边的截图（小条里选截哪一边） */
  shot?: { page: number; frac: [number, number, number, number]; side: 'src' | 'tr'; src: string | null; tr: string | null }
}

type Card = { kind: 'translate' | 'explain'; text: string; done: boolean; error: string | null }

// 划词工具条、翻译和解释的结果卡、笔记编辑。原文和对照共用。
export function SelectionLayer(props: {
  sel: SelInfo | null
  paper: Paper
  lastColor: HlColor
  /** 划线的含义（和画布笔记同一份）：小条上一种一颗，带名字；键 1 到 9 照这个顺序 */
  kinds: HlKind[]
  midRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onCreate: (s: SelInfo, c: HlColor, note?: string, style?: Annotation['style'], label?: AnnLabel | null, kind?: string) => Promise<Annotation | null>
  onUpdate: (a: Annotation) => Promise<void>
  onDelete: (a: Annotation) => Promise<void>
  /** 看不懂、有质疑的一处：右栏「疑问」里讲这一处（一键问 AI） */
  onExplain: (a: Annotation) => void
  onAsk: (quote: string, extra?: string) => void
  onAskImage: (image: string, context: string, prefill?: string, box?: ChatBox) => void
  ideaTopics: string[] // 收灵感的小卡里列出的主题（最近用过的在前）
  ideaHow: IdeaHow
  pageOf: (text: string) => number | null // 对照模式选的字在原文第几页（小卡上写出处）
  onIdea: (s: SelInfo, d: IdeaDraft) => Promise<void>
}) {
  const { sel } = props
  const [card, setCard] = useState<Card | null>(null)
  const [noteFor, setNoteFor] = useState<Annotation | null>(null)
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  // 对照、译文看法里框的：截哪一边（默认你框的那边），两边都带时原文在上、译文在下拼成一张给 AI
  const [shotSide, setShotSide] = useState<ShotSide>('src')
  const [shotImg, setShotImg] = useState<string | null>(null)

  useEffect(() => {
    setCard(null)
    setNoteFor(null)
    setIdeaOpen(false)
    setCopied(false)
    setShotSide(sel?.shot?.side ?? 'src')
    setShotImg(null)
  }, [sel])
  useEffect(() => {
    const sh = sel?.shot
    if (!sh) return
    let alive = true
    if (shotSide === 'both' && sh.src && sh.tr) void stackImages(sh.src, sh.tr).then((x) => alive && setShotImg(x))
    else setShotImg(shotSide === 'tr' ? sh.tr : shotSide === 'src' ? sh.src : null)
    return () => {
      alive = false
    }
  }, [sel, shotSide])
  // 这次给 AI 的截图：对照里按选的那边，原文看法就是框的那张
  const image = sel?.shot ? (shotImg ?? sel.image) : sel?.image
  const box = (): ChatBox | undefined => {
    const sh = sel?.shot
    if (!sh) return undefined
    return { page: sh.page, rect: sh.frac, side: shotSide, src: shotSide === 'tr' ? null : sh.src, tr: shotSide === 'src' ? null : sh.tr }
  }
  const sideMenu = async (e: React.MouseEvent): Promise<void> => {
    const sh = sel?.shot
    if (!sh) return
    const act = await showMenu(
      [
        { type: 'section', label: t('截哪一边') },
        { id: 'tr', label: t('译文'), checked: shotSide === 'tr', enabled: !!sh.tr },
        { id: 'src', label: t('原文'), checked: shotSide === 'src', enabled: !!sh.src },
        { id: 'both', label: t('两边都带'), hint: t('原文在上、译文在下'), checked: shotSide === 'both', enabled: !!sh.src && !!sh.tr }
      ],
      { el: e.currentTarget }
    )
    if (act === 'tr' || act === 'src' || act === 'both') setShotSide(act)
  }

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
    const preferBelow = !!card || !!noteFor || ideaOpen
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
  }, [sel, card, noteFor, ideaOpen, tick])

  const close = useEvent(() => {
    props.onClose()
  })

  const runAi = useEvent((kind: 'translate' | 'explain') => {
    if (!sel) return
    stopRef.current?.()
    setCard({ kind, text: '', done: false, error: null })
    const s = streamRequest((id) => api.aiSelection(id, kind, { text: sel.text, paragraph: sel.paragraph, title: props.paper.title, image: image ?? undefined }), {
      delta: (full) => setCard((c) => (c && c.kind === kind ? { ...c, text: full } : c)),
      done: (full) => setCard((c) => (c && c.kind === kind ? { ...c, text: full, done: true } : c)),
      error: (msg, partial) => setCard((c) => (c && c.kind === kind ? { ...c, text: partial, error: msg, done: true } : c))
    })
    // 卡关了请求照样跑完并缓存（主进程缓存），这里只是不再更新界面
    stopRef.current = null
    void s
  })

  // 不挑含义的动作（笔记、划线、有质疑）用上次的颜色；上次是看不懂（它写成问题段）时用第一种
  const plain = props.kinds.find((k) => k.color === props.lastColor && k.key !== CONFUSED) ?? firstPlainKind(props.kinds)
  // 选一种含义：新选的字划上这种；点在已有的一条上是换成这种（看不懂打上标签、写成问题段）
  const pick = useEvent(async (k: HlKind) => {
    if (!sel) return
    if (sel.existing) await props.onUpdate(withKind(sel.existing, props.kinds, k.key))
    else await props.onCreate(sel, k.color as HlColor, '', 'highlight', k.key === CONFUSED ? 'confused' : null, k.key)
    close()
  })
  // 有质疑：标记、不占颜色。新选的字用上次那种含义划上并打上；点在已有标注上是打上 / 去掉
  const labelIt = useEvent(async (l: AnnLabel) => {
    if (!sel) return
    if (sel.existing) await props.onUpdate({ ...sel.existing, label: sel.existing.label === l ? null : l })
    else await props.onCreate(sel, plain.color as HlColor, '', 'highlight', l, plain.key)
    close()
  })
  // 划线：新选的字画一条线（用上次的颜色）；点在已有的标注上是在高亮和划线之间换
  const underline = useEvent(async () => {
    if (!sel) return
    if (sel.existing) await props.onUpdate({ ...sel.existing, style: sel.existing.style === 'underline' ? 'highlight' : 'underline' })
    else await props.onCreate(sel, plain.color as HlColor, '', 'underline', null, plain.key)
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
    } else a = await props.onCreate(sel, plain.color as HlColor, text, 'highlight', null, plain.key)
    if (a) setNoteFor(a)
  })

  // 灵感：新选的字和点在已有标注上都能收（同一句可以既是高亮、有质疑，又在灵感库里）
  const canIdea = !!sel && (!!sel.target || !!sel.existing) && !!sel.text.trim()
  const idea = useEvent(() => {
    if (canIdea) setIdeaOpen(true)
  })

  const ask = useEvent(() => {
    if (!sel) return
    if (image) props.onAskImage(image, sel.paragraph, undefined, box())
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
      if (card || noteFor || ideaOpen || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 't') runAi('translate')
      else if (k === 'e') runAi('explain')
      else if (k === 'n') void note()
      else if (k === 'i' && canIdea) idea()
      else if (k === 'a') ask()
      else if (/^[1-9]$/.test(k) && props.kinds[Number(k) - 1] && (sel.target || sel.existing)) void pick(props.kinds[Number(k) - 1]!)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, card, noteFor, ideaOpen, canIdea, runAi, note, ask, pick, idea, close, props.kinds])

  // 点空白处关
  useEffect(() => {
    if (!sel) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current?.contains(e.target as Node)) return
      if (card || noteFor || ideaOpen) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [sel, card, noteFor, ideaOpen, close])

  if (!sel) return null
  const style: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }

  if (noteFor)
    return (
      <div ref={boxRef} className="pop note-pop" style={style}>
        <NoteEditor
          a={noteFor}
          kinds={props.kinds}
          onSave={(t_) => props.onUpdate({ ...noteFor, note: t_ })}
          onKind={(k) => {
            const n = withKind(noteFor, props.kinds, k.key)
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

  if (ideaOpen) {
    const tg = sel.target
    const ex = sel.existing
    const page = tg?.mode === 'pdf' ? tg.page : (ex?.page ?? props.pageOf(sel.text))
    const section = tg?.mode === 'reflow' ? tg.section : (ex?.section ?? '')
    return (
      <div ref={boxRef} className="pop idea-pop" style={style}>
        <IdeaCapture
          text={sel.text}
          where={[page ? t('第 {0} 页', page) : '', section].filter(Boolean).join(' · ')}
          topics={props.ideaTopics}
          how={props.ideaHow}
          onCancel={close}
          onSave={(d) => {
            void props.onIdea(sel, d).then(close)
          }}
        />
      </div>
    )
  }

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
              if (image) props.onAskImage(image, sel.paragraph, `${card.kind === 'translate' ? t('翻译') : t('解释')}：${card.text}`, box())
              else props.onAsk(sel.text, `${card.kind === 'translate' ? t('翻译') : t('解释')}：${card.text}`)
              close()
            }}
          >
            <MessageSquareReply size={16} />
          </button>
        </div>
        {image ? <img className="card-shot" src={image} alt={t('框选的截图')} /> : <div className="card-quote">{sel.text}</div>}
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
    <div ref={boxRef} className={'pop sel-toolbar' + (sel.shot ? ' solid' : '') + ((props.midRef.current?.clientWidth ?? 1000) < 820 ? ' compact' : '')} style={style} onMouseDown={(e) => e.preventDefault()}>
      <TBtn icon={<Languages size={16} />} label={t('翻译')} k="T" onClick={() => runAi('translate')} />
      <TBtn icon={<BookOpen size={16} />} label={t('解释')} k="E" onClick={() => runAi('explain')} />
      <span className="tb-sep" />
      {(sel.target || ex) &&
        props.kinds.map((k, i) => (
          <button
            key={k.key}
            className={'tb-btn tb-kind' + (ex && kindOf(ex) === k.key ? ' current' : '')}
            data-kind={k.key}
            title={i < 9 ? `${k.name}（${i + 1}）` : k.name}
            onClick={() => void pick(k)}
          >
            {k.key === CONFUSED ? (
              <svg className="lb-mark" data-label="confused" viewBox="0 0 14 6"><path d="M0 4Q1.75 1 3.5 4T7 4T10.5 4T14 4" /></svg>
            ) : (
              <span className="hl-dot" data-color={k.color} />
            )}
            <span>{k.name}</span>
          </button>
        ))}
      {(sel.target || ex) && (
        <button className={'dot-btn' + (ex?.style === 'underline' ? ' current' : '')} title={t('划线')} onClick={() => void underline()}>
          <Underline size={15} />
        </button>
      )}
      {(sel.target || ex) && <span className="tb-sep" />}
      {(sel.target || ex) && !(ex && kindOf(ex) === CONFUSED) && (
        <button className={'tb-btn tb-label' + (ex?.label === 'doubt' ? ' current' : '')} data-label="doubt" title={ex?.label === 'doubt' ? t('去掉「{0}」', LABEL_NAME.doubt) : t('标成「{0}」', LABEL_NAME.doubt)} onClick={() => void labelIt('doubt')}>
          <svg className="lb-mark" data-label="doubt" viewBox="0 0 14 6"><path d="M0 4Q1.75 1 3.5 4T7 4T10.5 4T14 4" /></svg>
          <span>{LABEL_NAME.doubt}</span>
        </button>
      )}
      {ex?.label && (
        <TBtn
          icon={<Sparkles size={16} />}
          label={t('讲一讲')}
          onClick={() => {
            props.onExplain(ex)
            close()
          }}
        />
      )}
      {(sel.target || ex) && <span className="tb-sep" />}
      {(sel.target || ex) && <TBtn icon={<StickyNote size={16} />} label={t('笔记')} k="N" onClick={() => void note()} />}
      {canIdea && <TBtn icon={<Lightbulb size={16} className="idea-ic" />} label={t('灵感')} k="I" onClick={idea} />}
      <TBtn icon={<MessageCircleQuestion size={16} />} label={t('问 AI')} k="A" onClick={ask} />
      {sel.shot && (
        <>
          <span className="tb-sep" />
          <button className="tb-btn tb-side" data-testid="shot-side" title={t('截哪一边：你框的那边、对面，或两边都带')} onClick={(e) => void sideMenu(e)}>
            <span className="tb-side-k">{t('截：')}</span>
            <span>{shotSide === 'both' ? t('两边都带') : shotSide === 'tr' ? t('译文') : t('原文')}</span>
            <ChevronDown size={12} />
          </button>
        </>
      )}
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

function NoteEditor(p: { a: Annotation; kinds: HlKind[]; onSave: (t: string) => Promise<void>; onKind: (k: HlKind) => void; onDelete: () => void }) {
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
        {p.kinds
          .filter((k) => k.key !== CONFUSED)
          .map((k) => (
            <button key={k.key} className={'dot-btn' + (kindOf(p.a) === k.key ? ' current' : '')} onClick={() => p.onKind(k)} title={t('换成「{0}」', k.name)}>
              <span className="hl-dot" data-color={k.color} />
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
