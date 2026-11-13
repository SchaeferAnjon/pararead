import { NotebookPen, Search, Underline } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import type { AnnLabel, NoteEntry } from '@shared/types'
import { LABEL_NAME } from '@shared/annLabels'
import { api } from '../api'
import { authorsShort, Segmented } from '../lib/ui'

// 全库的笔记和摘录：所有论文里画的高亮、划线和写的批注汇在一起，按论文分组，每条写着在原文第几页、哪一节；
// 点一条回到那篇论文的那一处。
export function NotesPage(props: { sideHidden: boolean; onOpen: (paperId: string, annId?: string) => void }) {
  const [all, setAll] = useState<NoteEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'noted' | AnnLabel>('all')
  useEffect(() => {
    const load = (): void => void api.annAll().then(setAll)
    load()
    return api.onLibraryChanged(load)
  }, [])
  const groups = useMemo(() => {
    const k = q.trim().toLowerCase()
    const hit = (a: NoteEntry): boolean => (only === 'all' || (only === 'noted' ? !!a.note : a.label === only)) && (!k || [a.text, a.note, a.paperTitle, a.section].some((s) => s.toLowerCase().includes(k)))
    const by = new Map<string, NoteEntry[]>()
    for (const a of all ?? []) if (hit(a)) by.set(a.paperId, [...(by.get(a.paperId) ?? []), a])
    // 每篇里按页码、位置排；论文按最近做过标注的排前面
    return [...by.values()].map((l) => l.sort((x, y) => (x.page ?? 1e9) - (y.page ?? 1e9) || (x.start ?? 0) - (y.start ?? 0) || x.createdAt - y.createdAt)).sort((x, y) => Math.max(...y.map((a) => a.updatedAt)) - Math.max(...x.map((a) => a.updatedAt)))
  }, [all, q, only])
  const total = groups.reduce((n, g) => n + g.length, 0)
  return (
    <div className="notes-page">
      <div className={'titlebar drag np-bar' + (props.sideHidden ? ' no-side' : '')}>
        <span className="bar-title">{t('笔记')}</span>
        {all && <span className="hint num">{t('{0} 条，{1} 篇论文', total, groups.length)}</span>}
        <span className="spacer" />
        <Segmented className="sm" value={only} onChange={setOnly} options={[{ value: 'all', label: t('全部') }, { value: 'noted', label: t('有批注的') }, { value: 'confused', label: LABEL_NAME.confused }, { value: 'doubt', label: LABEL_NAME.doubt }]} />
        <label className="field-fill np-search">
          <Search size={14} />
          <input value={q} placeholder={t('搜摘录、批注、论文')} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="np-list">
        {all && !groups.length && (
          <div className="np-empty">
            <NotebookPen size={28} strokeWidth={1.5} />
            <b>{all.length ? t('没有符合的笔记') : t('还没有笔记')}</b>
            <span>{all.length ? t('换个词，或者切回「全部」') : t('读论文时选中文字，点颜色做高亮、点 U 划线、点「笔记」写批注，都会汇到这里')}</span>
          </div>
        )}
        {groups.map((g) => (
          <section key={g[0].paperId} className="np-group">
            <button className="np-paper" onClick={() => props.onOpen(g[0].paperId)}>
              <span className="tt">{g[0].paperTitle}</span>
              <span className="hint">{[authorsShort(g[0].paperAuthors), g[0].paperYear, t('{0} 条', g.length)].filter(Boolean).join(' · ')}</span>
            </button>
            {g.map((a) => (
              <button key={a.id} className="np-item" data-ann={a.id} onClick={() => props.onOpen(a.paperId, a.id)}>
                <span className="np-mark">{a.style === 'underline' ? <Underline size={13} className="ul" data-color={a.color} /> : <span className="hl-dot" data-color={a.color} />}</span>
                <span className="np-body">
                  {a.label && <span className="lb-chip" data-label={a.label}>{LABEL_NAME[a.label]}</span>}
                  <span className="np-quote">{a.text}</span>
                  {a.note && <span className="np-note">{a.note}</span>}
                  <span className="hint num">{[a.page ? t('第 {0} 页', a.page) : '', a.section, new Date(a.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
