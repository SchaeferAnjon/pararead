import { ChevronDown, ChevronRight, Download, Ellipsis, Highlighter, Image as ImageIcon, RefreshCw, Table } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as PdfJs from 'pdfjs-dist'
import { sectionForText } from '@shared/chunk'
import { listFigures } from '@shared/refs'
import { HL_COLORS, type Annotation, type Block, type HlColor, type MajorPoint, type MajorType, type ReadMode, type ReflowDoc } from '@shared/types'
import { Markdown } from '../lib/Markdown'
import { showMenu } from '../lib/menu'
import type { useTranslations } from '../lib/translations'
import { Empty, Segmented } from '../lib/ui'
import type { Density } from './Reader'
import { t } from '@shared/i18n'

export type LeftTab = 'toc' | 'notes' | 'figs' | 'keys'

export const MAJOR_NAME: Record<MajorType, string> = { objective: t('研究目标'), method: t('方法'), result: t('结论'), novelty: t('创新点') }

interface TocItem {
  id: string
  title: string
  level: number
  page?: number
  blockId?: string
  children: TocItem[]
}

type Props = {
  tab: LeftTab
  mode: ReadMode
  pdf: PdfJs.PDFDocumentProxy | null
  doc: ReflowDoc | null
  headings: Block[]
  headingPages: Map<string, number>
  tr: ReturnType<typeof useTranslations>
  display: 'src' | 'both' | 'tr'
  curBlock: string | null
  curPage: number
  anns: Annotation[]
  sections: Map<string, string>
  sectionForPage: (p: number | null) => string
  keys: MajorPoint[] | null
  keysBusy: boolean
  density: Density
  onDensity: (d: Density) => void
  onLoadKeys: (force?: boolean) => void
  onHeading: (blockId: string) => void
  onBlock: (blockId: string) => void
  onPage: (p: number) => void
  onAnn: (a: Annotation) => void
  onHoverAnn: (id: string | null) => void
  onExport: () => void
}

export function LeftPane(props: Props) {
  return (
    <div className="left-body">
      {props.tab === 'toc' && <Toc {...props} />}
      {props.tab === 'notes' && <Notes {...props} />}
      {props.tab === 'figs' && <Figures {...props} />}
      {props.tab === 'keys' && <Keys {...props} />}
    </div>
  )
}

function Toc(props: Props) {
  const [outline, setOutline] = useState<TocItem[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  // 重排好了用 Markdown 标题；没有就用 PDF 自带的 outline
  useEffect(() => {
    if (props.headings.length || !props.pdf) return
    let alive = true
    void (async () => {
      const ol = await props.pdf!.getOutline()
      if (!ol || !alive) return setOutline([])
      let seq = 0
      const conv = async (items: typeof ol, level: number): Promise<TocItem[]> => {
        const out: TocItem[] = []
        for (const it of items) {
          let page: number | undefined
          try {
            const dest = typeof it.dest === 'string' ? await props.pdf!.getDestination(it.dest) : it.dest
            if (dest && dest[0]) page = (await props.pdf!.getPageIndex(dest[0] as never)) + 1
          } catch {
            page = undefined
          }
          out.push({ id: `o${seq++}`, title: it.title, level, page, children: await conv(it.items ?? [], level + 1) })
        }
        return out
      }
      const items = await conv(ol, 1)
      if (alive) setOutline(items)
    })()
    return () => {
      alive = false
    }
  }, [props.pdf, props.headings.length])

  const tree = useMemo<TocItem[]>(() => {
    if (!props.headings.length) return outline ?? []
    // 第一个一级标题是论文名，跳过；MinerU 的 # / ## 加上「A.」「1)」样式推断层级
    const hs = props.headings.slice(props.headings[0]?.level === 1 ? 1 : 0)
    const root: TocItem[] = []
    let cur: TocItem | null = null
    for (const h of hs) {
      const sub = /^([A-Z]|\d+)[.)]\s/.test(h.md) && !/^[IVX]+\.\s/.test(h.md)
      const item: TocItem = { id: h.id, blockId: h.id, title: h.md, level: sub ? 2 : 1, page: props.headingPages.get(h.id), children: [] }
      if (sub && cur) cur.children.push(item)
      else {
        root.push(item)
        cur = item
      }
    }
    return root
  }, [props.headings, outline, props.headingPages])

  // 当前小节：对照模式按顶部块，原文模式按页码
  const currentId = useMemo(() => {
    const flat = tree.flatMap((t_) => [t_, ...t_.children])
    if (props.mode === 'pdf') {
      let c: string | null = null
      for (const t_ of flat) if (t_.page && t_.page <= props.curPage) c = t_.id
      return c
    }
    if (!props.curBlock) return null
    const keys = [...props.sections.keys()]
    const blockIdx = keys.indexOf(props.curBlock)
    let c: string | null = null
    for (const t_ of flat) {
      if (!t_.blockId) continue
      const hi = keys.indexOf(t_.blockId)
      if (hi >= 0 && hi <= blockIdx) c = t_.id
    }
    return c
  }, [tree, props.mode, props.curPage, props.curBlock, props.sections])

  const parentOfCurrent = tree.find((t_) => t_.children.some((c) => c.id === currentId))?.id

  if (!tree.length) return <div className="pane-empty">{props.pdf ? t('这篇论文没有目录，重排好以后用小节标题') : ''}</div>

  const trOf = (blockId?: string): string | null => {
    if (!blockId) return null
    const h = props.headings.find((x) => x.id === blockId)
    if (!h) return null
    const s = props.tr.map[props.tr.keyOf(h)]
    return s && 'text' in s ? s.text : null
  }

  const Row = ({ t: t_, depth }: { t: TocItem; depth: number }) => {
    const hasKids = t_.children.length > 0
    const isOpen = open.has(t_.id) || t_.id === parentOfCurrent
    const zh = trOf(t_.blockId)
    const showEn = props.display !== 'tr' || !zh
    const showZh = props.display !== 'src' && zh
    return (
      <>
        <button
          className={'ti' + (t_.id === currentId ? ' on' : '') + (t_.level === 1 ? ' l1' : '')}
          style={{ paddingLeft: 6 + depth * 18 }}
          onClick={() => (t_.blockId ? props.onHeading(t_.blockId) : t_.page && props.onPage(t_.page))}
        >
          <span
            className="chev"
            onClick={(e) => {
              if (!hasKids) return
              e.stopPropagation()
              setOpen((s) => {
                const n = new Set(s)
                if (n.has(t_.id)) n.delete(t_.id)
                else n.add(t_.id)
                return n
              })
            }}
          >
            {hasKids && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          </span>
          <span className="x">
            {showEn && (
              <span className="en">
                <Markdown text={t_.title} inline raw />
              </span>
            )}
            {showZh && (
              <span className={showEn ? 'zh' : 'en'}>
                <Markdown text={zh!} inline raw />
              </span>
            )}
          </span>
          {t_.page && <span className="pg num">{t_.page}</span>}
        </button>
        {hasKids && isOpen && t_.children.map((c) => <Row key={c.id} t={c} depth={depth + 1} />)}
      </>
    )
  }

  return (
    <div className="toc">
      {tree.map((t_) => (
        <Row key={t_.id} t={t_} depth={0} />
      ))}
    </div>
  )
}

const HL_BG: Record<string, string> = { yellow: 'var(--hl-yellow)', green: 'var(--hl-green)', blue: 'var(--hl-blue)', red: 'var(--hl-red)' }
const COLOR_NAME: Record<HlColor, string> = { yellow: t('黄'), green: t('绿'), blue: t('蓝'), red: t('红') }

function Notes(props: Props) {
  const [kind, setKind] = useState<'all' | 'hl' | 'note'>('all')
  const [colors, setColors] = useState<Set<HlColor>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const list = props.anns.filter((a) => (!colors.size || colors.has(a.color)) && (kind === 'all' || (kind === 'note' ? !!a.note : !a.note)))
    const secOf = (a: Annotation): string => {
      if (a.mode === 'pdf' && props.doc) {
        const s = sectionForText(props.doc.blocks, props.sections, a.text)
        if (s) return s
      }
      if (a.section) return a.section
      if (a.mode === 'pdf') return props.sectionForPage(a.page) || (a.page ? t('第 {0} 页', a.page) : t('未分节'))
      return t('未分节')
    }
    const order = [...new Set(props.headings.map((h) => h.md))]
    const m = new Map<string, Annotation[]>()
    for (const a of list) {
      const s = secOf(a)
      if (!m.has(s)) m.set(s, [])
      m.get(s)!.push(a)
    }
    const rank = (k: string): number => {
      const i = order.indexOf(k)
      if (i >= 0) return i
      const p = /^第 (\d+) 页$/.exec(k)
      return p ? 1000 + Number(p[1]) : 5000
    }
    return [...m.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([k, v]) => [k, v.sort((x, y) => (x.page ?? 0) - (y.page ?? 0) || (x.start ?? 0) - (y.start ?? 0) || x.createdAt - y.createdAt)] as const)
  }, [props.anns, colors, kind, props.headings, props.sectionForPage, props.doc, props.sections])

  const more = async (e: React.MouseEvent): Promise<void> => {
    const act = await showMenu(
      [
        { type: 'section', label: t('按颜色') },
        ...HL_COLORS.map((c) => ({ id: c, label: t('{0}色', COLOR_NAME[c]), checked: colors.has(c), icon: <span className="hl-dot" data-color={c} /> })),
        { type: 'separator' },
        { id: 'export', label: t('导出 Markdown…'), icon: <Download size={16} />, hint: '⇧⌘E', checked: false }
      ],
      { el: e.currentTarget, align: 'right' }
    )
    if (act === 'export') props.onExport()
    else if (act)
      setColors((s) => {
        const n = new Set(s)
        if (n.has(act as HlColor)) n.delete(act as HlColor)
        else n.add(act as HlColor)
        return n
      })
  }

  return (
    <div className="notes">
      <div className="lp-bar">
        <Segmented
          className="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: t('全部') },
            { value: 'hl', label: t('高亮') },
            { value: 'note', label: t('笔记') }
          ]}
        />
        {colors.size > 0 && (
          <span className="lp-dots">
            {[...colors].map((c) => (
              <span key={c} className="hl-dot" data-color={c} />
            ))}
          </span>
        )}
        <span className="spacer" />
        <button className="icon-btn sm" title={t('按颜色筛选、导出')} onClick={(e) => void more(e)}>
          <Ellipsis size={16} />
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="pane-empty">{props.anns.length ? t('没有符合筛选的') : t('选中文字点色点就能高亮，点「笔记」写批注；都会出现在这里')}</div>
      ) : (
        groups.map(([sec, list]) => (
          <div key={sec} className="note-group">
            <div className="note-sec">
              <Markdown text={sec} inline raw />
            </div>
            {list.map((a) => (
              <div
                key={a.id}
                className="note-item"
                data-note={a.id}
                onMouseEnter={() => props.onHoverAnn(a.id)}
                onMouseLeave={() => props.onHoverAnn(null)}
                onClick={() => props.onAnn(a)}
              >
                <div
                  className={'note-quote' + (expanded.has(a.id) ? ' full' : '')}
                  onDoubleClick={() =>
                    setExpanded((s) => {
                      const n = new Set(s)
                      if (n.has(a.id)) n.delete(a.id)
                      else n.add(a.id)
                      return n
                    })
                  }
                >
                  <span className="note-mark" style={{ background: HL_BG[a.color] }}>
                    {a.text}
                  </span>
                </div>
                {a.note && <div className="note-text">{a.note}</div>}
                {a.mode === 'pdf' && a.page && <div className="hint num">{t('原文 第 {0} 页', a.page)}</div>}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

// 图表清单：图片块的缩略图配图注，表格用图标；点了跳到正文
function Figures(props: Props) {
  const figs = useMemo(() => (props.doc ? listFigures(props.doc.blocks) : []), [props.doc])
  if (!props.doc) return <div className="pane-empty">{t('重排好以后列出图和表')}</div>
  if (!figs.length) return <div className="pane-empty">{t('这篇没找到图和表')}</div>
  const imgOf = (blockId: string): string | null => {
    const b = props.doc!.blocks.find((x) => x.id === blockId)
    return b ? (/!\[[^\]]*\]\((data:image[^)]+)\)/.exec(b.md)?.[1] ?? null) : null
  }
  return (
    <div className="figs">
      {figs.map((f) => {
        const img = f.kind === 'figure' ? imgOf(f.blockId) : null
        return (
          <button key={f.blockId} className="fig-item" title={f.caption} onClick={() => props.onBlock(f.blockId)}>
            <span className="fig-thumb">{img ? <img src={img} alt="" /> : f.kind === 'table' ? <Table size={20} /> : <ImageIcon size={20} />}</span>
            <span className="fig-cap">
              <b>{f.label}</b> {f.caption}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// AI 重点：四类关键句；点了跳到正文那句
function Keys(props: Props) {
  if (!props.doc) return <div className="pane-empty">{t('重排好以后才能标重点')}</div>
  return (
    <div className="keys">
      <div className="lp-bar">
        <span className="hint">{t('标多少')}</span>
        <Segmented
          className="sm"
          value={props.density}
          onChange={props.onDensity}
          options={[
            { value: 'less', label: t('少') },
            { value: 'default', label: t('适中') },
            { value: 'more', label: t('多') }
          ]}
        />
        <span className="spacer" />
        {props.keys && (
          <button className="icon-btn sm" title={t('重新标（问一次 AI）')} disabled={props.keysBusy} onClick={() => props.onLoadKeys(true)}>
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      {props.keysBusy && !props.keys ? (
        <div className="pane-empty">
          <span className="spin spin-12" />{t(' AI 在读全文，标出研究目标、方法、结论和创新点…')}
        </div>
      ) : !props.keys ? (
        <div style={{ padding: '24px 12px' }}>
          <Empty
            icon={<Highlighter size={32} strokeWidth={1.5} />}
            title={t('AI 重点')}
            text={t('AI 读一遍全文，把研究目标、方法、结论和创新点的关键句标出来，正文里画淡底。问一次 AI。')}
            action={
              <button className="btn" onClick={() => props.onLoadKeys()}>
                <Highlighter size={16} />
                {t('标出重点')}
              </button>
            }
          />
        </div>
      ) : (
        props.keys.map((k, i) => (
          <button key={i} className="key-item" onClick={() => props.onBlock(k.blockId)}>
            <span className="tag accent sm">{MAJOR_NAME[k.type]}</span>
            {k.text}
          </button>
        ))
      )}
    </div>
  )
}
