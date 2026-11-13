import { ChartBar, Check, RefreshCw, Waypoints, X } from 'lucide-react'
import { useState } from 'react'
import { t } from '@shared/i18n'
import { cellId, edgeLine, layoutGraph, NOTE_COL, relCellId, type Relation } from '@shared/matrix'
import type { MatrixView } from '../../api'
import { Empty, Skeleton } from '../../lib/ui'
import { Quote, type Src } from './SourceDrawer'

const pageLine = (page: number | null, found: boolean, inferred?: boolean): React.ReactNode =>
  found && page ? <span className="pg">{t('第 {0} 页', page)}</span> : <span className="pg warn">{inferred ? t('推断，原文没直接说') : t('原文里没找到这句')}</span>

// —— 表格 ——
export function TableView(props: {
  v: MatrixView
  sel: string[]
  lit: string[]
  srcId: string | null
  onToggle: (id: string) => void
  onOpen: (s: Src) => void
  onNotes: (paperId: string) => void
  onRetry: (paperId: string) => void
  onDelCol: (col: string) => void
}) {
  const { v } = props
  const st = v.state
  const cols = [...st.cols, { id: NOTE_COL, name: t('你的批注') }]
  const tmpl = `minmax(140px, 170px) repeat(${cols.length}, minmax(150px, 1fr))`
  const cls = (id: string, extra = ''): string =>
    'mx-cell' + extra + (props.sel.includes(id) ? ' on' : '') + (props.lit.includes(id) ? ' lit' : '') + (props.srcId === id ? ' src' : '')
  const box = (id: string): React.ReactNode => (
    <span
      className={'checkbox' + (props.sel.includes(id) ? ' on' : '')}
      role="checkbox"
      aria-checked={props.sel.includes(id)}
      title={t('勾进段落')}
      onClick={(e) => {
        e.stopPropagation()
        props.onToggle(id)
      }}
    >
      {props.sel.includes(id) && <Check size={10} strokeWidth={3} />}
    </span>
  )
  return (
    <>
      <p className="mx-lead">{t('每格是 AI 读全文写的一句话，点格子看原文那一句和页码；勾右上角的小方块，攒够了点「用选中的写一段」。最后一列是你自己的批注。')}</p>
      <div className="mx-grid" style={{ gridTemplateColumns: tmpl }} role="table">
        <div className="mx-h">{t('论文')}</div>
        {cols.map((c) => (
          <div className="mx-h" key={c.id} title={'ask' in c && c.ask ? c.ask : undefined}>
            <span className="ellipsis">{c.name}</span>
            {/^c\d+$/.test(c.id) && (
              <button className="icon-btn sm" title={t('删掉这一列')} onClick={() => props.onDelCol(c.id)}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {st.rows.map((r, i) => {
          const p = v.papers.find((x) => x.id === r.paperId)
          if (!p) return null
          const notes = v.notes[r.paperId] ?? []
          return (
            <div key={r.paperId} style={{ display: 'contents' }} data-row={r.paperId}>
              <div className="mx-pp" title={p.title}>
                <b>{p.name}</b>
                <span className="hint">
                  [{i + 1}] {[p.short, p.venue].filter(Boolean).join(' · ')}
                </span>
              </div>
              {r.status === 'failed' ? (
                <div className="mx-fail" style={{ gridColumn: `2 / span ${cols.length - 1}` }}>
                  <span className="dot err sm" />
                  <span className="ellipsis">{t('没填上：{0}', r.error ?? '')}</span>
                  <button className="text-btn" onClick={() => props.onRetry(r.paperId)}>
                    {t('重试')}
                  </button>
                </div>
              ) : (
                st.cols.map((c) => {
                  const cell = r.cells[c.id]
                  const id = cellId(r.paperId, c.id)
                  if (!cell)
                    return (
                      <div key={c.id} className="mx-cell mx-empty">
                        {r.status === 'done' && !/^c\d+$/.test(c.id) ? t('没有') : <Skeleton lines={[100, 70]} />}
                      </div>
                    )
                  return (
                    <div
                      key={c.id}
                      className={cls(id)}
                      data-cell={id}
                      role="button"
                      onClick={() => props.onOpen({ paperId: r.paperId, cellId: id, head: cell.text, quote: cell.quote, zh: cell.zh, page: cell.page, found: cell.found, inferred: cell.inferred })}
                    >
                      {cell.text}
                      {pageLine(cell.page, cell.found, cell.inferred)}
                      {box(id)}
                    </div>
                  )
                })
              )}
              {notes.length ? (
                <div className={cls(cellId(r.paperId, NOTE_COL))} data-cell={cellId(r.paperId, NOTE_COL)} role="button" onClick={() => props.onNotes(r.paperId)}>
                  {notes.slice(0, 3).map((n) => (
                    <div className="mx-note" key={n.annId}>
                      {n.label && (
                        <span className="lb-chip" data-label={n.label}>
                          {n.label === 'doubt' ? t('有质疑') : t('看不懂')}
                        </span>
                      )}
                      <span className="t" data-label={n.label ?? undefined}>
                        {n.note ? `「${n.note}」` : n.text.length > 80 ? n.text.slice(0, 80) + '…' : n.text}
                      </span>
                    </div>
                  ))}
                  <span className="pg">{notes.length > 3 ? t('你的笔记 · 共 {0} 条', notes.length) : t('你的笔记')}</span>
                  {box(cellId(r.paperId, NOTE_COL))}
                </div>
              ) : (
                <div className="mx-cell mx-empty">{t('没有批注')}</div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// —— 关系 ——
const W = 190
const H = 58
const textW = (s: string): number => [...s].reduce((n, ch) => n + (/[⺀-￿]/.test(ch) ? 12 : 7), 0)

export function RelationsView(props: { v: MatrixView; sel: string[]; done: boolean; onToggle: (id: string, on?: boolean) => void; onRetry: () => void }) {
  const { v } = props
  const st = v.state
  const [on, setOn] = useState<string | null>(null)
  if (!props.done || st.relStatus === 'running' || st.relStatus === 'none')
    return (
      <div className="mx-lead" style={{ marginTop: 40, justifyContent: 'center' }}>
        <span className="spin spin-12" />
        {props.done ? t('正在找这几篇在正文里互相提到的地方，再判断是基于、对比还是指出不足') : t('表填完以后再看关系')}
      </div>
    )
  if (st.relStatus === 'failed')
    return (
      <div className="mx-lead" style={{ marginTop: 40, justifyContent: 'center' }}>
        <span className="dot err sm" />
        {t('关系没分析出来：{0}', st.relError ?? '')}
        <button className="text-btn" onClick={props.onRetry}>
          {t('重试')}
        </button>
      </div>
    )
  const rels = st.relations ?? []
  const nodes = st.rows.map((r) => ({ id: r.paperId, year: v.papers.find((p) => p.id === r.paperId)?.year ?? null }))
  const g = layoutGraph(nodes, { w: W, h: H, gapX: 170, gapY: 64 })
  const colOf = (id: string): number => g.years.findIndex((y) => y.x === g.pos[id][0])
  // 相邻两栏：框边到框边的直线；隔了一栏以上：从两个框的顶边中间往上拱，一条比一条高，别穿过中间那篇
  let arc = 0
  const geo = rels.map((r) => {
    const span = Math.abs(colOf(r.from) - colOf(r.to))
    if (span <= 1) {
      const [x1, y1, x2, y2] = edgeLine(g.pos[r.from], g.pos[r.to], W, H)
      return { d: `M${x1} ${y1}L${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
    }
    const [ax, ay] = g.pos[r.from]
    const [bx, by] = g.pos[r.to]
    // 几条拱线落在同一篇上时错开一点
    const x1 = ax + W / 2 - 20 - 14 * arc
    const x2 = bx + W / 2 + 20 + 14 * arc
    const top = Math.min(ay, by)
    const cy = top - 70 - 56 * arc++
    const cx = (x1 + x2) / 2
    return { d: `M${x1} ${ay}Q${cx} ${cy} ${x2} ${by}`, mx: cx, my: (ay + 2 * cy + by) / 4 }
  })
  const minY = Math.min(-10, ...geo.map((e) => e.my - 20))
  const doubts = (pid: string): number => (v.notes[pid] ?? []).filter((n) => n.label === 'doubt').length
  const cur = rels.find((r) => r.id === on)
  const paper = (id: string) => v.papers.find((p) => p.id === id)!
  return (
    <>
      <div className="mx-legend">
        <span>
          <svg viewBox="0 0 28 8">
            <path d="M0 4h28" stroke="currentColor" strokeWidth="1.5" />
          </svg>{' '}
          {t('基于')}
        </span>
        <span>
          <svg viewBox="0 0 28 8">
            <path d="M0 4h28" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>{' '}
          {t('对比')}
        </span>
        <span>
          <span className="dot err sm" /> {t('指出不足')}
        </span>
        <span>{t('箭头从后一篇指向它说到的那篇 · 点一条关系看两边原文')}</span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={props.onRetry}>
          <RefreshCw size={14} />
          {t('重新分析')}
        </button>
      </div>
      {rels.length === 0 ? (
        <div style={{ marginTop: 60 }}>
          <Empty icon={<Waypoints size={32} strokeWidth={1.5} />} title={t('没找到这几篇之间的关系')} text={t('它们的正文里没有互相引用或提到对方。关系只从正文里引用对方的那句话判断，不靠猜。')} />
        </div>
      ) : (
        <svg className="mx-rel" viewBox={`-10 ${minY} ${g.width + 20} ${g.height + 90 - minY}`} style={{ maxWidth: g.width + 20 }} role="img" aria-label={t('关系图')}>
          <defs>
            <marker id="mx-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" style={{ fill: 'var(--text-2)' }} />
            </marker>
          </defs>
          {rels.map((r, k) => {
            const { d, mx, my } = geo[k]
            const tw = textW(r.label) + (r.kind === 'bad' ? 34 : 20)
            return (
              <g key={r.id} className={'edge ' + r.kind + (on === r.id ? ' on' : '')} data-rel={r.id} onClick={() => setOn(on === r.id ? null : r.id)}>
                <path className="hit" d={d} />
                <path className="l" d={d} markerEnd={r.kind === 'cmp' ? undefined : 'url(#mx-ar)'} />
                <rect x={mx - tw / 2} y={my - 13} width={tw} height={26} rx={6} />
                {r.kind === 'bad' && <circle cx={mx - tw / 2 + 13} cy={my} r={3.5} />}
                <text x={mx + (r.kind === 'bad' ? 8 : 0)} y={my + 4} textAnchor="middle">
                  {r.label}
                </text>
              </g>
            )
          })}
          {st.rows.map((r) => {
            const p = paper(r.paperId)
            const [x, y] = g.pos[r.paperId]
            const n = doubts(r.paperId)
            return (
              <g key={r.paperId} className="node">
                <title>{p.title}</title>
                <rect x={x} y={y} width={W} height={H} rx={8} />
                <text className="n1" x={x + 14} y={y + 24}>
                  {p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name}
                </text>
                <text className="n2" x={x + 14} y={y + 43}>
                  {((x) => (x.length > 25 ? x.slice(0, 24) + '…' : x))([p.short, p.venue].filter(Boolean).join(' · '))}
                </text>
                {n > 0 && (
                  <text className="n3" x={x + 14} y={y + H + 20}>
                    {t('你在这篇打了 {0} 个「有质疑」', n)}
                  </text>
                )}
              </g>
            )
          })}
          {g.years.map((y) => (
            <text key={String(y.year)} className="yr" x={y.x + W / 2} y={g.height + 70} textAnchor="middle">
              {y.year ?? t('年份不明')}
            </text>
          ))}
        </svg>
      )}
      {cur && <RelPanel r={cur} v={v} picked={props.sel.includes(relCellId(cur.id))} onPick={() => props.onToggle(relCellId(cur.id), true)} onClose={() => setOn(null)} />}
    </>
  )
}

function RelPanel(props: { r: Relation; v: MatrixView; picked: boolean; onPick: () => void; onClose: () => void }) {
  const { r, v } = props
  const a = v.papers.find((p) => p.id === r.from)!
  const b = v.papers.find((p) => p.id === r.to)!
  const colName = v.state.cols.find((c) => c.id === r.b.col)?.name ?? ''
  const kind = { base: t('基于'), cmp: t('对比'), bad: t('指出不足') }[r.kind]
  return (
    <div className="mx-relp" data-part="rel-panel">
      <div className="mx-dh" style={{ marginBottom: 4 }}>
        <b>
          {a.name} {kind} {b.name}：{r.label}
        </b>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="two">
        <div>
          <div className="mx-subh" style={{ marginTop: 6 }}>{t('{0} 怎么说', a.name)}</div>
          <Quote en={r.a.quote} zh={r.a.zh} meta={[a.short, r.a.page ? t('第 {0} 页', r.a.page) : null].filter(Boolean).join(' · ')} />
        </div>
        <div>
          <div className="mx-subh" style={{ marginTop: 6 }}>{t('{0} 原文 · {1}', b.name, colName)}</div>
          {r.b.quote ? <Quote en={r.b.quote} zh={r.b.zh} meta={[b.short, r.b.page ? t('第 {0} 页', r.b.page) : null].filter(Boolean).join(' · ')} /> : <div className="hint">{t('这一格没有原文出处')}</div>}
        </div>
      </div>
      <div className="foot">
        <button className="btn" disabled={props.picked} onClick={props.onPick}>
          {props.picked ? t('已勾进段落') : t('勾进段落')}
        </button>
        <span className="hint">{t('勾进去以后，写段落时会用到这层关系和两边的原文')}</span>
      </div>
    </div>
  )
}

// —— 指标 ——
export function MetricsView(props: { v: MatrixView; done: boolean; onOpen: (s: Src) => void; onRetry: () => void }) {
  const { v } = props
  const st = v.state
  if (!props.done || st.metStatus === 'running' || st.metStatus === 'none')
    return (
      <div className="mx-lead" style={{ marginTop: 40, justifyContent: 'center' }}>
        <span className="spin spin-12" />
        {props.done ? t('正在把几篇报告的数字归成同一种指标') : t('表填完以后再看指标')}
      </div>
    )
  if (st.metStatus === 'failed')
    return (
      <div className="mx-lead" style={{ marginTop: 40, justifyContent: 'center' }}>
        <span className="dot err sm" />
        {t('指标没排出来：{0}', st.metError ?? '')}
        <button className="text-btn" onClick={props.onRetry}>
          {t('重试')}
        </button>
      </div>
    )
  const groups = st.metrics ?? []
  return (
    <>
      <div className="mx-lead">
        <span>{t('AI 把几篇报告的同一种数字排在一起，点一行看原句；条件不同的标黄点，不能直接比。')}</span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={props.onRetry}>
          <RefreshCw size={14} />
          {t('重新排')}
        </button>
      </div>
      {groups.length === 0 && (
        <div style={{ marginTop: 60 }}>
          <Empty icon={<ChartBar size={32} strokeWidth={1.5} />} title={t('没有能放在一起比的数字')} text={t('这几篇报告的数字不是同一种指标，或者单位换算不了。')} />
        </div>
      )}
      {groups.map((g, gi) => {
        const max = Math.max(...g.rows.map((r) => Math.abs(r.value)), 1e-9)
        return (
          <section className="mx-met" key={gi} data-group={gi}>
            <h3>
              {g.name}
              <span className="hint">{g.better === 'lower' ? t('越小越好') : t('越大越好')}</span>
            </h3>
            <div className="mx-met-grid">
              <div className="h">{t('论文')}</div>
              <div className="h">{g.unit ? t('数值（{0}）', g.unit) : t('数值')}</div>
              <div className="h">{t('条件')}</div>
              {g.rows.map((r) => {
                const p = v.papers.find((x) => x.id === r.paperId)
                if (!p) return null
                return (
                  <div
                    className="mx-mrow"
                    role="button"
                    key={r.paperId}
                    onClick={() => props.onOpen({ paperId: r.paperId, cellId: null, head: `${g.name}：${r.value}${g.unit ? ' ' + g.unit : ''}${r.what ? `（${r.what}）` : ''}`, quote: r.quote, zh: '', page: r.page, found: r.found })}
                  >
                    <div>
                      <b style={{ fontWeight: 500 }}>{p.name}</b>
                      <div className="hint ellipsis">{r.what || p.short}</div>
                    </div>
                    <div className="mx-barx">
                      <i className={r.ok ? '' : 'ap'} style={{ width: `${(Math.abs(r.value) / max) * 60}%` }} />
                      <span className="num">{r.value}</span>
                      {pageLine(r.page, r.found)}
                    </div>
                    <div className="mx-cond">
                      {r.ok ? <span className="hint">{t('条件一致')}</span> : (<><span className="dot warn sm" /><span className="hint">{r.note || t('条件不同，不能直接比')}</span></>)}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}
