import { Check, Copy, Layers, ListChecks, NotebookPen, Search, Underline } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import { askList, askMarkdown, groupKey, isOpen, summaryOf, STATUS_NAME } from '@shared/explain'
import type { AnnLabel, NoteEntry } from '@shared/types'
import { LABEL_NAME } from '@shared/annLabels'
import { api, errText } from '../api'
import { useExplainStream } from '../lib/explain'
import { authorsShort, Segmented, useToast } from '../lib/ui'
import { GroupBody, LabelChips } from './ExplainBody'

type Sub = 'open' | 'done' | 'all'

// 全库的笔记和摘录：所有论文里画的高亮、划线和写的批注汇在一起，按论文分组，每条写着在原文第几页、哪一节；
// 点一条回到那篇论文的那一处。按「看不懂」筛时能勾几条一起讲（先找共同卡点），按「有质疑」筛时能整理成问作者清单。
export function NotesPage(props: { sideHidden: boolean; onOpen: (paperId: string, annId?: string) => void }) {
  const toast = useToast()
  const [all, setAll] = useState<NoteEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'noted' | AnnLabel>('all')
  const [sub, setSub] = useState<Sub>('open')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<{ kind: 'group'; ids: string[] } | { kind: 'asks' } | null>(null)
  const ex = useExplainStream()
  useEffect(() => {
    const load = (): void => void api.annAll().then(setAll)
    load()
    const offs = [api.onLibraryChanged(load), api.onExplainSaved((a) => setAll((l) => l && l.map((x) => (x.id === a.id ? { ...x, ...a } : x))))]
    return () => offs.forEach((f) => f())
  }, [])
  const setFilter = (v: typeof only): void => {
    setOnly(v)
    // 这一类都处理完了就直接看全部，不停在一页空的「还没懂」上
    setSub((all ?? []).some((a) => a.label === v && isOpen(a)) ? 'open' : 'all')
    setPicked(new Set())
    setPanel(null)
  }
  const isLabel = only === 'confused' || only === 'doubt'
  const ofLabel = useMemo(() => (isLabel ? (all ?? []).filter((a) => a.label === only) : []), [all, only, isLabel])
  const openN = ofLabel.filter(isOpen).length
  const groups = useMemo(() => {
    const k = q.trim().toLowerCase()
    const hit = (a: NoteEntry): boolean =>
      (only === 'all' || (only === 'noted' ? !!a.note : a.label === only)) &&
      (!isLabel || sub === 'all' || (sub === 'open') === isOpen(a)) &&
      (!k || [a.text, a.note, a.paperTitle, a.section, summaryOf(a)].some((s) => s.toLowerCase().includes(k)))
    const by = new Map<string, NoteEntry[]>()
    for (const a of all ?? []) if (hit(a)) by.set(a.paperId, [...(by.get(a.paperId) ?? []), a])
    // 每篇里按页码、位置排；论文按最近做过标注的排前面
    return [...by.values()].map((l) => l.sort((x, y) => (x.page ?? 1e9) - (y.page ?? 1e9) || (x.start ?? 0) - (y.start ?? 0) || x.createdAt - y.createdAt)).sort((x, y) => Math.max(...y.map((a) => a.updatedAt)) - Math.max(...x.map((a) => a.updatedAt)))
  }, [all, q, only, sub, isLabel])
  const total = groups.reduce((n, g) => n + g.length, 0)
  const canPick = (a: NoteEntry): boolean => only === 'confused' && isOpen(a)
  const anyPick = groups.some((g) => g.some(canPick))
  const toggle = (id: string): void =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // 一起讲：这几处上已经挂着同一段讲解就直接出，不再花 AI
  const groupItems = panel?.kind === 'group' ? panel.ids.map((id) => all?.find((a) => a.id === id)).filter((x): x is NoteEntry => !!x) : []
  const gKey = panel?.kind === 'group' ? groupKey(panel.ids) : ''
  const stored = groupItems.length && groupItems.every((a) => a.explain?.group?.key === gKey) ? groupItems[0].explain!.group!.raw : null
  const liveG = ex.live?.key === `g|${gKey}` ? ex.live : null
  const startGroup = (): void => {
    const ids = groups.flat().filter((a) => picked.has(a.id)).map((a) => a.id)
    setPanel({ kind: 'group', ids })
    const key = groupKey(ids)
    const have = ids.map((id) => all?.find((a) => a.id === id)).every((a) => a?.explain?.group?.key === key)
    if (!have) ex.group(key, ids)
  }
  useEffect(() => {
    if (liveG?.done && !liveG.error && stored) ex.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])
  const allUnderstood = async (): Promise<void> => {
    try {
      await api.explainStatus(groupItems.map((a) => a.id), 'understood')
      toast(t('{0} 处标成「懂了」，共同的那段讲解存在这几处上', groupItems.length))
      setPicked(new Set())
      setPanel(null)
    } catch (e) {
      toast(errText(e))
    }
  }
  const asks = useMemo(() => askList(all ?? []), [all])

  return (
    <div className="notes-page">
      <div className={'titlebar drag np-bar' + (props.sideHidden ? ' no-side' : '')}>
        <span className="bar-title">{t('笔记')}</span>
        {all && <span className="hint num">{t('{0} 条，{1} 篇论文', total, groups.length)}</span>}
        <span className="spacer" />
        <Segmented className="sm" value={only} onChange={setFilter} options={[{ value: 'all', label: t('全部') }, { value: 'noted', label: t('有批注的') }, { value: 'confused', label: LABEL_NAME.confused }, { value: 'doubt', label: LABEL_NAME.doubt }]} />
        {only === 'confused' && (
          <button className="btn primary" disabled={picked.size < 2 || panel?.kind === 'group'} title={picked.size < 2 ? t('勾上两条以上还没懂的') : undefined} onClick={startGroup}>
            <Layers size={16} />
            {picked.size ? t('一起讲（{0}）', picked.size) : t('一起讲')}
          </button>
        )}
        {only === 'doubt' && (
          <button className="btn primary" disabled={panel?.kind === 'asks'} onClick={() => setPanel({ kind: 'asks' })}>
            <ListChecks size={16} />
            {t('整理成问作者清单')}
          </button>
        )}
        <label className="field-fill np-search">
          <Search size={14} />
          <input value={q} placeholder={t('搜摘录、批注、讲解')} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="np-list">
        {isLabel && all && ofLabel.length > 0 && (
          <div className="np-sub">
            <Segmented
              className="sm"
              value={sub}
              onChange={(v) => (setSub(v), setPicked(new Set()))}
              options={[
                { value: 'open', label: `${only === 'confused' ? t('还没懂') : t('还没判断')} ${openN}` },
                { value: 'done', label: `${only === 'confused' ? t('懂了') : t('判断过的')} ${ofLabel.length - openN}` },
                { value: 'all', label: t('全部') }
              ]}
            />
            <span className="hint">{only === 'confused' ? t('勾上几条还没懂的，「一起讲」会先找它们共同卡在哪') : t('把质疑过的地方整理成能发给作者的问题')}</span>
          </div>
        )}
        {panel?.kind === 'group' && (
          <div className="np-panel" data-panel="group">
            <h4>{t('这 {0} 处卡在同一件事上', groupItems.length)}</h4>
            <GroupBody raw={liveG ? liveG.raw : (stored ?? '')} streaming={!!liveG && !liveG.done} items={groupItems} />
            {liveG?.error && (
              <div className="ex-err">
                <span className="dot err sm" />
                {t('讲解没出来：{0}', liveG.error)}
                <button className="text-btn" onClick={() => ex.group(gKey, panel.ids)}>
                  {t('重试')}
                </button>
              </div>
            )}
            <div className="np-panel-ft">
              <span className="hint">{t('这段讲解会存成一条笔记，挂在这 {0} 处上', groupItems.length)}</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => (setPanel(null), groupItems[0] && props.onOpen(groupItems[0].paperId, groupItems[0].id))}>
                {t('逐条再看')}
              </button>
              <button className="btn primary" disabled={!stored} onClick={() => void allUnderstood()}>
                <Check size={16} />
                {t('这几处都懂了')}
              </button>
            </div>
          </div>
        )}
        {panel?.kind === 'asks' && (
          <div className="np-panel" data-panel="asks">
            <h4>{t('问作者清单')}</h4>
            <div className="hint">{t('从你判断为「质疑成立」「还要查」的地方整理；「质疑不成立」的不放进来')}</div>
            {asks.length ? (
              asks.map((g) => (
                <div key={g.paperTitle} className="np-asks">
                  <div className="ex-sh" lang="en">
                    {g.paperTitle}
                  </div>
                  <ol>
                    {g.items.map((x, i) => (
                      <li key={i}>
                        {x.q}
                        <span className="hint">（{STATUS_NAME[x.status]}）</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            ) : (
              <div className="hint np-asks-empty">{t('还没有判断为成立或还要查的质疑。在论文的右栏「疑问」里过一遍，判断完的会到这里。')}</div>
            )}
            <div className="np-panel-ft">
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setPanel(null)}>
                {t('收起')}
              </button>
              <button
                className="btn"
                disabled={!asks.length}
                onClick={() => {
                  void navigator.clipboard.writeText(askMarkdown(asks)).then(
                    () => toast(t('复制好了，可以贴进邮件或笔记')),
                    (e) => toast(t('没复制上：{0}', errText(e)))
                  )
                }}
              >
                <Copy size={14} />
                {t('复制为 Markdown')}
              </button>
            </div>
          </div>
        )}
        {all && !groups.length && !panel && (
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
            {g.map((a) => {
              const sum = a.label ? summaryOf(a) : ''
              return (
                <div key={a.id} className={'np-item' + (picked.has(a.id) ? ' picked' : '')} data-ann={a.id} role="button" tabIndex={0} onClick={() => props.onOpen(a.paperId, a.id)}>
                  {anyPick && (
                    <span
                      className={'checkbox np-cb' + (picked.has(a.id) ? ' on' : '') + (canPick(a) ? '' : ' off')}
                      role="checkbox"
                      aria-checked={picked.has(a.id)}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (canPick(a)) toggle(a.id)
                      }}
                    >
                      {picked.has(a.id) && <Check size={12} strokeWidth={3} />}
                    </span>
                  )}
                  <span className="np-mark">{a.label ? <i className="lb-dot" data-label={a.label} /> : a.style === 'underline' ? <Underline size={13} className="ul" data-color={a.color} /> : <span className="hl-dot" data-color={a.color} />}</span>
                  <span className="np-body">
                    {a.label && (
                      <span className="np-chips">
                        <LabelChips a={a} />
                        {isOpen(a) && (a.explain?.misses ?? 0) > 0 && <span className="hint">{t('讲过 {0} 次', a.explain!.versions.length)}</span>}
                        {isOpen(a) && !!a.explain?.versions.length && !a.explain.misses && <span className="hint">{t('讲解备好了')}</span>}
                      </span>
                    )}
                    <span className="np-quote">{a.text}</span>
                    {sum && !isOpen(a) && (
                      <span className="np-sum">
                        <b>{t('讲解')}</b>
                        {sum}
                      </span>
                    )}
                    {a.note && <span className="np-note">{a.note}</span>}
                    <span className="hint num">{[a.page ? t('第 {0} 页', a.page) : '', a.section, new Date(a.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
                  </span>
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
