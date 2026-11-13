import { Check, ChevronLeft, Copy, ListChecks, RotateCcw, Waves } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { LABEL_NAME } from '@shared/annLabels'
import { askMarkdown, asksOf, isOpen, latest, openCounts, parseConfused, parseDoubt, STATUS_NAME, statusOf, walkOrder } from '@shared/explain'
import type { Annotation, LabelStatus, Paper } from '@shared/types'
import { api, errText } from '../api'
import { useExplainStream, usePendingExplains } from '../lib/explain'
import { showMenu } from '../lib/menu'
import { Empty, useToast } from '../lib/ui'
import { ExplainBody, LabelChips, StatusChip } from './ExplainBody'

export type WalkRequest = { nonce: number; ids: string[] | null; start?: string; auto: boolean }

/** 右栏顶上「疑问」后面的数：蓝点几处看不懂、红点几处有质疑；多了一处时跳一下 */
export function QBadge(props: { anns: Annotation[] }) {
  const n = openCounts(props.anns)
  const total = n.confused + n.doubt
  const last = useRef(total)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (total > last.current) setBump((x) => x + 1)
    last.current = total
  }, [total])
  if (!total) return null
  return (
    <span className="q-badge num" key={bump} data-bump={bump > 0 || undefined}>
      {n.confused > 0 && (
        <>
          <i data-label="confused" />
          {n.confused}
        </>
      )}
      {n.doubt > 0 && (
        <>
          <i data-label="doubt" />
          {n.doubt}
        </>
      )}
    </span>
  )
}

type Ask = { q: string; status: LabelStatus }
type View = { kind: 'list' } | { kind: 'walk'; ids: string[]; i: number; auto: boolean; asks: Ask[] } | { kind: 'done'; ids: string[]; asks: Ask[] }

// 右栏「疑问」：这篇打了标签的地方。打标签时不打断，读完一节或想看的时候点「过一遍」一条条讲：
// 正文滚到那一处并加深，看不懂讲到「懂了」，有质疑讲到你判断；过完一张小结和问作者清单。
export function QuestionsPane(props: {
  paper: Paper
  anns: Annotation[]
  blockOrder: Map<string, number>
  prefetch: boolean
  request: WalkRequest | null
  onFocusAnn: (a: Annotation | null) => void
  onQuote: (quote: string) => void
  onRemoveLabel: (a: Annotation) => void
}) {
  const toast = useToast()
  const [view, setView] = useState<View>({ kind: 'list' })
  const labeled = useMemo(() => props.anns.filter((a) => a.label), [props.anns])
  const open = useMemo(() => walkOrder(labeled, props.blockOrder), [labeled, props.blockOrder])
  const pending = usePendingExplains()

  const startWalk = (ids: string[], start?: string, auto = true): void => {
    if (!ids.length) return setView({ kind: 'list' })
    setView({ kind: 'walk', ids, i: Math.max(0, start ? ids.indexOf(start) : 0), auto, asks: [] })
  }
  useEffect(() => {
    const r = props.request
    if (!r) return
    const ids = r.ids ?? open.map((a) => a.id)
    startWalk(r.start && !ids.includes(r.start) ? [r.start] : ids, r.start, r.auto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request?.nonce])

  // 正文跟着走：逐条时滚到这一处并加深，回到列表时取消
  const curId = view.kind === 'walk' ? view.ids[view.i] : null
  useEffect(() => {
    const a = curId ? props.anns.find((x) => x.id === curId) : null
    props.onFocusAnn(a ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId])
  useEffect(() => () => props.onFocusAnn(null), [])

  if (view.kind === 'walk') {
    const a = props.anns.find((x) => x.id === view.ids[view.i])
    if (!a?.label) return <div className="q-pane" />
    const next = (asks: Ask[] = []): void => {
      const all = [...view.asks, ...asks]
      if (view.i >= view.ids.length - 1) setView({ kind: 'done', ids: view.ids, asks: all })
      else setView({ ...view, i: view.i + 1, asks: all })
    }
    return (
      <div className="q-pane">
        <div className="q-walkbar">
          <button className="btn ghost sm" onClick={() => setView({ kind: 'list' })}>
            <ChevronLeft size={14} />
            {t('列表')}
          </button>
          <span className="spacer" />
          <span className="hint num">{t('第 {0} / {1} 条', view.i + 1, view.ids.length)}</span>
          <span className="q-prog" aria-hidden>
            {view.ids.map((id, i) => (
              <i key={id} className={i < view.i ? 'done' : i === view.i ? 'cur' : ''} />
            ))}
          </span>
        </div>
        <WalkItem key={a.id} a={a} auto={view.auto} pending={pending.has(a.id)} onQuote={props.onQuote} onNext={next} toast={toast} />
      </div>
    )
  }

  if (view.kind === 'done') {
    const list = view.ids.map((id) => props.anns.find((x) => x.id === id)).filter((x): x is Annotation => !!x)
    const count = (s: LabelStatus): number => list.filter((x) => statusOf(x) === s).length
    const still = list.filter((x) => x.label === 'confused' && isOpen(x)).length
    const rows: [LabelStatus, number, string][] = [
      ['understood', count('understood'), ''],
      ['upheld', count('upheld'), ''],
      ['checking', count('checking'), ''],
      ['dismissed', count('dismissed'), ''],
      ['open', still, t('留在疑问里')]
    ]
    const md = askMarkdown([{ paperTitle: props.paper.title, items: view.asks }])
    return (
      <div className="q-pane">
        <div className="q-done">
          <h4>{t('这一轮过完了')}</h4>
          <div className="hint">{t('讲解和你的判断都存在各条标注上，笔记里能看到')}</div>
          {rows
            .filter((r) => r[1] > 0)
            .map(([s, n, extra]) => (
              <div key={s} className="q-done-row">
                <StatusChip s={s} />
                <span className="num">{t('{0} 处', n)}</span>
                {extra && <span className="hint">{extra}</span>}
              </div>
            ))}
          {view.asks.length > 0 && (
            <div className="q-asks">
              <b>{t('问作者清单')}</b>
              <ol>
                {view.asks.map((x, i) => (
                  <li key={i}>{x.q}</li>
                ))}
              </ol>
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(md).then(
                    () => toast(t('复制好了，可以贴进邮件或笔记')),
                    (e) => toast(t('没复制上：{0}', errText(e)))
                  )
                }}
              >
                <Copy size={14} />
                {t('复制')}
              </button>
            </div>
          )}
          <button className="btn ghost" onClick={() => setView({ kind: 'list' })}>
            <ChevronLeft size={14} />
            {t('回到列表')}
          </button>
        </div>
      </div>
    )
  }

  const settled = labeled.filter((a) => !isOpen(a)).sort((x, y) => y.updatedAt - x.updatedAt)
  const bySec = new Map<string, Annotation[]>()
  for (const a of open) bySec.set(a.section || t('未分节'), [...(bySec.get(a.section || t('未分节')) ?? []), a])
  const row = (a: Annotation, ids: string[]) => {
    const ready = !!latest(a.explain)
    return (
      <button
        key={a.id}
        className="q-item"
        data-ann={a.id}
        onClick={() => startWalk(isOpen(a) ? ids : [a.id], a.id)}
        onContextMenu={async (e) => {
          const id = await showMenu(
            [
              { id: 'walk', label: isOpen(a) ? t('从这一条过') : t('看讲解') },
              { id: 'goto', label: t('跳到正文') },
              { type: 'separator' },
              { id: 'remove', label: t('去掉「{0}」', LABEL_NAME[a.label!]), danger: true }
            ],
            e
          )
          if (id === 'walk') startWalk(isOpen(a) ? ids : [a.id], a.id)
          if (id === 'goto') props.onFocusAnn(a)
          if (id === 'remove') props.onRemoveLabel(a)
        }}
      >
        <span className="q-chips">
          <LabelChips a={a} />
          {isOpen(a) && pending.has(a.id) && !ready && (
            <span className="q-prep">
              <span className="spin spin-10" />
              {t('在备讲解')}
            </span>
          )}
          {isOpen(a) && ready && (
            <span className="q-prep">
              <span className="dot ok sm" />
              {t('讲解备好了')}
            </span>
          )}
        </span>
        <span className="q-x" lang={a.blockId?.endsWith(':tr') ? undefined : 'en'}>
          {a.text}
        </span>
      </button>
    )
  }
  const openIds = open.map((a) => a.id)
  return (
    <div className="q-pane">
      {labeled.length === 0 ? (
        <div className="q-empty">
          <Empty icon={<Waves size={32} strokeWidth={1.5} />} title={t('还没有疑问')} text={t('选中一段字，在工具条里点「看不懂」或「有质疑」；这里攒着，读完一节再一条条讲。')} />
        </div>
      ) : (
        <>
          <div className="q-head">
            <div className="t">{t('这篇的疑问')}</div>
            <div className="hint">
              {props.prefetch ? t('打标签时不打断你，讲解在后台备好；读完一节，或者想看的时候，一条条过。') : t('打标签时不打断你；读完一节，或者想看的时候，点「过一遍」一条条讲。')}
            </div>
            {open.length > 0 && (
              <button className="btn primary" onClick={() => startWalk(openIds)}>
                <ListChecks size={16} />
                {t('过一遍（{0} 条）', open.length)}
              </button>
            )}
          </div>
          <div className="q-list">
            {[...bySec.entries()].map(([sec, list]) => (
              <section key={sec}>
                <div className="q-grp">{t('{0} · 还没处理', sec)}</div>
                {list.map((a) => row(a, openIds))}
              </section>
            ))}
            {!open.length && <div className="q-none hint">{t('都处理完了')}</div>}
            {settled.length > 0 && (
              <section>
                <div className="q-grp">{t('处理过的')}</div>
                {settled.map((a) => row(a, [a.id]))}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// 逐条里的一条：讲过的直接出（不再花 AI）；没讲过的，是「过一遍」进来的就当场讲，从笔记跳过来的先给一个「讲一讲」
function WalkItem(props: { a: Annotation; auto: boolean; pending: boolean; onQuote: (q: string) => void; onNext: (asks?: Ask[]) => void; toast: (s: string) => void }) {
  const { a } = props
  const ex = useExplainStream()
  const versions = a.explain?.versions ?? []
  const [sel, setSel] = useState(() => latest(a.explain)?.focus ?? '')
  const version = [...versions].reverse().find((v) => v.focus === sel) ?? null
  const live = ex.live && ex.live.key.startsWith(`${a.id}|`) ? ex.live : null
  // 流着的、出错的、格式不对没存下的显示流里的字；存好了（versions 变了）清掉，显示存下的那版
  const showLive = !!live
  const raw = live ? live.raw : (version?.raw ?? '')
  const streaming = !!live && !live.done
  const first = versions[0]?.raw ?? live?.raw ?? ''
  const focusList = (a.label === 'confused' ? parseConfused(first).focus : parseDoubt(first).focus).slice(0, 2)
  const started = useRef(false)
  const [busy, setBusy] = useState(false)

  const explain = (o: { focus?: string; again?: boolean } = {}): void => {
    started.current = true
    ex.one(a.id, o)
  }
  useEffect(() => {
    if (props.auto && !versions.length && !props.pending && !started.current) explain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pending])
  // 新的一版存好了：换个讲法以后显示新的这版
  useEffect(() => {
    if (live?.done && !live.error) ex.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.length])

  const status = async (s: LabelStatus, asks: Ask[] = []): Promise<void> => {
    setBusy(true)
    try {
      await api.explainStatus([a.id], s)
      props.onNext(asks)
    } catch (e) {
      props.toast(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const onFocus = (f: string): void => {
    setSel(f)
    if (!versions.some((v) => v.focus === f)) explain({ focus: f || undefined })
  }
  const again = (): void => {
    const cands = ['', ...focusList]
    const f = cands.find((x) => !versions.some((v) => v.focus === x)) ?? cands[(cands.indexOf(sel) + 1) % cands.length]
    setSel(f)
    explain({ focus: f || undefined, again: true })
  }
  const misses = a.explain?.misses ?? 0
  const lean = a.label === 'doubt' && raw ? parseDoubt(raw).lean?.v : undefined
  const err = live?.error

  return (
    <>
      <div className="q-walk">
        <div className="q-chips">
          <LabelChips a={a} />
        </div>
        {misses > 0 && isOpen(a) && <div className="q-again">{t('上次讲过 {0} 次你还没懂', misses)}</div>}
        {raw || streaming ? (
          <ExplainBody a={a} raw={raw} streaming={streaming} version={showLive ? { focus: sel, raw, at: 0, ...live!.extra } : version} focus={sel} focusList={focusList} onFocus={streaming ? undefined : onFocus} onQuote={props.onQuote} />
        ) : props.pending ? (
          <div className="q-wait hint">
            <span className="spin spin-12" />
            {t('在后台备讲解，马上好')}
          </div>
        ) : (
          !err && (
            <div className="q-ask">
              <div className="ex-quote" lang="en">
                {a.text}
              </div>
              <button className="btn" onClick={() => explain()}>
                {t('讲一讲这一处')}
              </button>
            </div>
          )
        )}
        {err && (
          <div className="ex-err">
            <span className="dot err sm" />
            {t('讲解没出来：{0}', err)}
            <button className="text-btn" onClick={() => explain({ focus: sel || undefined })}>
              {t('重试')}
            </button>
            {/Key|服务/.test(err) && (
              <button className="text-btn" onClick={() => void api.openSettings('ai')}>
                {t('去设置')}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="q-foot">
        {a.label === 'confused' && !isOpen(a) ? (
          <>
            <span className="hint">{t('这一处你标了「懂了」')}</span>
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => void status('open')}>
              <RotateCcw size={14} />
              {t('其实还没懂，放回疑问')}
            </button>
          </>
        ) : a.label === 'confused' ? (
          <>
            <button className="btn ghost" disabled={streaming || busy} onClick={again}>
              <RotateCcw size={14} />
              {t('还不懂，换个讲法')}
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={busy} onClick={() => void status('understood')}>
              <Check size={16} />
              {t('懂了，下一条')}
            </button>
          </>
        ) : (
          <>
            <span className="q-foot-lbl">{lean ? t('你的判断（带圆点的是 AI 倾向的）') : t('你的判断')}</span>
            {(['upheld', 'dismissed', 'checking'] as const).map((s) => (
              <button key={s} className={'btn' + (statusOf(a) === s ? ' on' : '')} disabled={busy} data-verdict={s} onClick={() => void status(s, s === 'dismissed' ? [] : asksOf({ label: 'doubt', explain: { versions: [{ focus: '', raw, at: 0 }], misses: 0 } }).map((q) => ({ q, status: s })))}>
                {lean === s && <i className="lean-dot" />}
                {STATUS_NAME[s]}
              </button>
            ))}
            <span className="spacer" />
            <button className="btn ghost" disabled={busy} onClick={() => props.onNext()}>
              {t('跳过')}
            </button>
          </>
        )}
      </div>
    </>
  )
}
