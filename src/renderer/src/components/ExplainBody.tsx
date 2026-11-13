import { useState } from 'react'
import { t } from '@shared/i18n'
import { parseConfused, parseDoubt, parseGroup, STATUS_NAME, STATUS_TONE, statusOf, type Quiz } from '@shared/explain'
import { LABEL_NAME } from '@shared/annLabels'
import type { Annotation, ExplainVersion, LabelStatus, LitItem } from '@shared/types'
import { Markdown } from '../lib/Markdown'
import { Skeleton } from '../lib/ui'

// 按标签讲解的正文：右栏「疑问」逐条过、笔记页「一起讲」共用。流式时按节出，没到的那一节放骨架。

export function StatusChip(props: { s: LabelStatus }) {
  return (
    <span className="st-chip" data-tone={STATUS_TONE[props.s]}>
      <i />
      {STATUS_NAME[props.s]}
    </span>
  )
}

/** 标签小块和状态小块：看不懂蓝、有质疑红；状态用小圆点说 */
export function LabelChips(props: { a: Pick<Annotation, 'label' | 'labelStatus'> }) {
  const s = statusOf(props.a)
  if (!props.a.label || !s) return null
  return (
    <>
      <span className="lb-chip" data-label={props.a.label}>
        {LABEL_NAME[props.a.label]}
      </span>
      <StatusChip s={s} />
    </>
  )
}

const md = (s: string) => <Markdown text={s} inline raw={false} />

function Sec(props: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="ex-sec">
      <div className="ex-sh">
        {props.title}
        {props.tag && <span className="ex-tag">· {props.tag}</span>}
      </div>
      {props.children}
    </div>
  )
}

export function QuizView(props: { quiz: Quiz }) {
  const [pick, setPick] = useState<number | null>(null)
  const o = pick === null ? null : props.quiz.options[pick]
  return (
    <div className="ex-quiz">
      <div className="ex-q">{md(props.quiz.q)}</div>
      {props.quiz.options.map((x, i) => (
        <button key={i} className={'ex-opt' + (pick === i ? (x.ok ? ' ok' : ' no') : '')} onClick={() => setPick(i)}>
          <span className="r" />
          {md(x.text)}
        </button>
      ))}
      {o && <div className={'ex-fb ' + (o.ok ? 'ok' : 'no')}>{md(o.why || (o.ok ? t('对。') : t('不对。')))}</div>}
    </div>
  )
}

function LitRow(props: { x: LitItem; rel: string; note: string }) {
  const meta = [props.x.authors.length ? props.x.authors.join(', ') : '', props.x.venue, props.x.year, props.x.cited ? t('本文引用 {0}', props.x.cited) : ''].filter(Boolean).join(' · ')
  const body = (
    <>
      <span className="t" lang="en">
        {props.x.title}
      </span>
      <span className="m">
        <span className="rel">{props.rel}</span>
        {props.note}
        {meta && <span className="src"> · {meta}</span>}
      </span>
    </>
  )
  return props.x.url ? (
    <a className="ex-lit" href={props.x.url} target="_blank" rel="noreferrer" title={t('在浏览器里打开')}>
      {body}
    </a>
  ) : (
    <div className="ex-lit">{body}</div>
  )
}

// 按节的先后放：一节还没闭合、后面的节也还没开头时，停在这里放骨架（流是按顺序来的）；
// 模型跳过了某一节（后面的节已经开头了）就不等它
function partsOf(raw: string, streaming: boolean, order: string[]) {
  const parts: React.ReactNode[] = []
  const st = { waiting: false }
  const put = (tag: string, ready: boolean, node: () => React.ReactNode): void => {
    if (st.waiting) return
    if (ready) return void parts.push(node())
    const later = order.slice(order.indexOf(tag) + 1)
    if (streaming && !later.some((x) => raw.includes(`<${x}>`))) st.waiting = true
  }
  return { parts, put, st }
}

const LEVEL_NAME = { g: 'ok', y: 'wait', r: 'bad' } as const

export function ExplainBody(props: {
  a: Annotation
  raw: string
  streaming: boolean
  version?: ExplainVersion | null
  focus: string // 现在围着讲的；空是整句
  focusList: string[]
  onFocus?: (f: string) => void
  onQuote?: (quote: string) => void
}) {
  const { a, raw, streaming } = props
  const chips = (
    <div className="ex-focus">
      <span>{a.label === 'confused' ? t('卡在哪') : t('哪里可疑')}</span>
      {['', ...props.focusList].map((f) => (
        <button key={f || '_'} className={'ex-fchip' + (f === props.focus ? ' on' : '')} disabled={!props.onFocus} onClick={() => props.onFocus?.(f)}>
          {f ? md(f) : t('整句')}
        </button>
      ))}
    </div>
  )
  if (a.label === 'confused') {
    const { parts, put, st } = partsOf(raw, streaming, ['one', 'chunks', 'pre', 'example', 'refs', 'quiz'])
    const v = parseConfused(raw)
    const chunks = props.version?.chunks?.length ? props.version.chunks : v.chunks
    put('one', v.one !== null, () => (
      <Sec key="one" title={t('一句话')}>
        <p className="ex-one">{md(v.one!)}</p>
      </Sec>
    ))
    put('chunks', !!props.version?.chunks?.length || v.chunks !== null, () =>
      chunks?.length ? (
        <Sec key="chunks" title={t('拆开看')} tag={t('同色是同一块')}>
          <div className="ex-chunks">
            {chunks.map((c, i) => (
              <div key={i} className="ex-ck" data-sg={(i % 4) + 1}>
                <span className="en" lang="en">
                  {md(c.en)}
                </span>
                <span className="zh">{md(c.zh)}</span>
              </div>
            ))}
          </div>
        </Sec>
      ) : null
    )
    put('pre', v.pre !== null, () =>
      v.pre!.length ? (
        <Sec key="pre" title={t('先要知道')}>
          <dl className="ex-pre">
            {v.pre!.map((p, i) => (
              <div key={i}>
                <dt>{md(p.term)}</dt>
                {p.text && <dd>{md(p.text)}</dd>}
              </div>
            ))}
          </dl>
        </Sec>
      ) : null
    )
    put('example', v.example !== null, () => (
      <Sec key="ex" title={t('举个例子')}>
        <Markdown className="ex-example" text={v.example!} raw={false} />
      </Sec>
    ))
    put('refs', v.refs !== null, () =>
      v.refs!.length ? (
        <Sec key="refs" title={t('这篇里')}>
          <div className="ex-refs">
            {v.refs!.map((r, i) => (
              <button key={i} className="ex-ref" disabled={!r.quote || !props.onQuote} title={r.quote ? t('跳到正文的这一处') : undefined} onClick={() => props.onQuote?.(r.quote)}>
                <b>{md(r.where)}</b>
                <span>{md(r.what)}</span>
              </button>
            ))}
          </div>
        </Sec>
      ) : null
    )
    put('quiz', v.quiz !== null || raw.includes('</quiz>'), () =>
      v.quiz ? (
        <Sec key="quiz" title={t('考你一下')}>
          <QuizView key={raw.length} quiz={v.quiz} />
        </Sec>
      ) : null
    )
    if (!streaming && v.one === null && raw) parts.push(<div key="bad" className="ex-err">{t('AI 没按格式回答，点「换个讲法」再讲一次')}</div>)
    return (
      <div className="ex">
        <div className="ex-quote" lang={a.blockId?.endsWith(':tr') ? undefined : 'en'}>
          {a.text}
        </div>
        {(props.focusList.length > 0 || props.focus) && chips}
        {parts}
        {st.waiting && <Skeleton lines={[100, 92, 70]} />}
      </div>
    )
  }
  const { parts, put, st } = partsOf(raw, streaming, ['says', 'evidence', 'assume', 'lit', 'asks', 'lean'])
  const d = parseDoubt(raw)
  const lit = props.version?.lit ?? []
  put('says', d.says !== null, () => (
    <Sec key="says" title={t('它在说')} tag={d.says!.tag || undefined}>
      <p className="ex-one">{md(d.says!.text)}</p>
    </Sec>
  ))
  put('evidence', d.evidence !== null, () =>
    d.evidence!.length ? (
      <Sec key="ev" title={t('论文自己的依据')}>
        {d.evidence!.map((e, i) => (
          <div key={i} className="ex-ev">
            <span className="st-chip" data-tone={LEVEL_NAME[e.level]}>
              <i />
              {e.tag}
            </span>
            <span>
              {md(e.text)}
              {e.quote && props.onQuote && (
                <button className="ex-jump" title={t('跳到正文的这一处')} onClick={() => props.onQuote!(e.quote)}>
                  {t('看原文')}
                </button>
              )}
            </span>
          </div>
        ))}
      </Sec>
    ) : null
  )
  put('assume', d.assume !== null, () =>
    d.assume!.length ? (
      <Sec key="as" title={t('没说出来的前提')}>
        <ol className="ex-ol">
          {d.assume!.map((x, i) => (
            <li key={i}>{md(x)}</li>
          ))}
        </ol>
      </Sec>
    ) : null
  )
  put('lit', d.lit !== null, () => {
    const rows = d.lit!.map((l) => ({ ...l, x: lit.find((x) => x.n === l.n) })).filter((l) => l.x)
    return (
      <Sec key="lit" title={t('别的文献')} tag={t('学术检索')}>
        {rows.length ? rows.map((l) => <LitRow key={l.n} x={l.x!} rel={l.rel} note={l.note} />) : <div className="ex-note">{t('学术检索没找到和这句直接相关的文献')}</div>}
      </Sec>
    )
  })
  put('asks', d.asks !== null, () =>
    d.asks!.length ? (
      <Sec key="asks" title={t('可以问作者')}>
        <ol className="ex-ol">
          {d.asks!.map((x, i) => (
            <li key={i}>{md(x)}</li>
          ))}
        </ol>
      </Sec>
    ) : null
  )
  put('lean', d.lean !== null, () => (
    <div key="lean" className="ex-lean">
      <b>{t('AI 的看法：{0}。', STATUS_NAME[d.lean!.v])}</b>
      {md(d.lean!.why)}
    </div>
  ))
  if (!streaming && d.says === null && raw) parts.push(<div key="bad" className="ex-err">{t('AI 没按格式回答，换个焦点再讲一次')}</div>)
  return (
    <div className="ex">
      <div className="ex-quote" lang={a.blockId?.endsWith(':tr') ? undefined : 'en'}>
        {a.text}
      </div>
      {(props.focusList.length > 0 || props.focus) && chips}
      {parts}
      {st.waiting && <Skeleton lines={[100, 92, 70]} />}
    </div>
  )
}

/** 几处一起讲：共同卡点、先把这件事讲清楚、回到每一处、考你一下 */
export function GroupBody(props: { raw: string; streaming: boolean; items: Annotation[] }) {
  const g = parseGroup(props.raw)
  const { parts, put, st } = partsOf(props.raw, props.streaming, ['root', 'steps', 'back', 'quiz'])
  put('root', g.root !== null, () => (
    <div key="root" className="gx-root">
      {md(g.root!)}
    </div>
  ))
  put('steps', g.steps !== null, () => (
    <Sec key="steps" title={t('先把这件事讲清楚')}>
      <ol className="ex-ol lg">
        {g.steps!.map((x, i) => (
          <li key={i}>{md(x)}</li>
        ))}
      </ol>
    </Sec>
  ))
  put('back', g.back !== null, () => (
    <Sec key="back" title={t('回到每一处')}>
      <div className="gx-back">
        {props.items.map((a, i) => {
          const b = g.back!.find((x) => x.n === i + 1)
          return (
            <div key={a.id} className="gx-row">
              <span className="x" lang="en">
                {a.text}
              </span>
              <span>{b ? md(b.text) : ''}</span>
            </div>
          )
        })}
      </div>
    </Sec>
  ))
  put('quiz', g.quiz !== null || props.raw.includes('</quiz>'), () =>
    g.quiz ? (
      <Sec key="quiz" title={t('考你一下')}>
        <QuizView quiz={g.quiz} />
      </Sec>
    ) : null
  )
  return (
    <div className="ex">
      {parts}
      {st.waiting && <Skeleton lines={[100, 92, 70]} />}
      {!props.streaming && g.root === null && props.raw && <div className="ex-err">{t('AI 没按格式回答，再点一次「一起讲」')}</div>}
    </div>
  )
}
