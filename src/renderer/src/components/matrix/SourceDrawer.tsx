import { AlertTriangle, ExternalLink, X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { NoteItem } from '@shared/matrix'
import type { MPaper } from './MatrixPage'

/** 抽屉里要显示的一处出处：表里的一格，或者指标里的一个数 */
export interface Src {
  paperId: string
  cellId: string | null // 能勾进段落的才有
  head: string // 「这一格」写的是什么
  quote: string
  zh: string
  page: number | null
  found: boolean
  inferred?: boolean
}

export function Quote(props: { en: string; zh: string; meta: string }) {
  return (
    <div className="mx-q">
      <div className="en" lang="en">
        {props.en}
      </div>
      {props.zh && <div className="zh">{props.zh}</div>}
      <div className="meta">{props.meta}</div>
    </div>
  )
}

const metaOf = (p: MPaper, page: number | null): string => [p.short, p.name !== p.title ? p.name : null, page ? t('第 {0} 页', page) : null].filter(Boolean).join(' · ')

export function SourceDrawer(props: { src: Src; paper: MPaper; picked: boolean; onPick: () => void; onOpen: () => void; onClose: () => void }) {
  const { src, paper } = props
  return (
    <aside className="mx-drawer" aria-label={t('出处')}>
      <div className="mx-dh">
        <b>{t('出处')}</b>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <div style={{ fontWeight: 500 }}>{paper.title}</div>
      <div className="hint">{[paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? t(' 等') : ''), paper.venue, paper.year].filter(Boolean).join(' · ')}</div>
      <div className="mx-subh">{t('这一格')}</div>
      <div>{src.head}</div>
      <div className="mx-subh">{t('原文那一处')}</div>
      {src.found ? (
        <Quote en={src.quote} zh={src.zh} meta={metaOf(paper, src.page)} />
      ) : (
        <>
          <div className="callout warn" style={{ margin: '10px 0' }}>
            <AlertTriangle size={14} />
            <span>{src.quote ? t('AI 给的原句在全文里没找到，可能是改写过的，别当成有出处。') : t('原文没有直接这么说，这一格是 AI 的推断。')}</span>
          </div>
          {src.quote && <Quote en={src.quote} zh={src.zh} meta={t('AI 给的句子，全文里对不上')} />}
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn" onClick={props.onOpen}>
          <ExternalLink size={14} />
          {src.found ? t('打开原文这一处') : t('打开这篇')}
        </button>
        {src.cellId && (
          <button className="btn" disabled={props.picked} onClick={props.onPick}>
            {props.picked ? t('已勾进段落') : t('勾进段落')}
          </button>
        )}
      </div>
    </aside>
  )
}

export function NotesDrawer(props: { paper: MPaper; notes: NoteItem[]; picked: boolean; onPick: () => void; onOpen: (annId: string) => void; onClose: () => void }) {
  return (
    <aside className="mx-drawer" aria-label={t('你的批注')}>
      <div className="mx-dh">
        <b>{t('你的批注')}</b>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <div style={{ fontWeight: 500 }}>{props.paper.title}</div>
      <div className="hint">{t('{0} 条，来自你在这篇里写的批注和打的标签', props.notes.length)}</div>
      {props.notes.map((n) => (
        <div key={n.annId}>
          {n.label && (
            <span className="lb-chip" data-label={n.label} style={{ marginTop: 14 }}>
              {n.label === 'doubt' ? t('有质疑') : t('看不懂')}
            </span>
          )}
          <Quote en={n.text} zh={n.note ? t('你写的：{0}', n.note) : ''} meta={metaOf(props.paper, n.page)} />
          <button className="btn sm" onClick={() => props.onOpen(n.annId)}>
            <ExternalLink size={14} />
            {t('打开这条笔记')}
          </button>
        </div>
      ))}
      <div style={{ marginTop: 16 }}>
        <button className="btn" disabled={props.picked || !props.notes.length} onClick={props.onPick}>
          {props.picked ? t('已勾进段落') : t('勾进段落')}
        </button>
      </div>
    </aside>
  )
}
