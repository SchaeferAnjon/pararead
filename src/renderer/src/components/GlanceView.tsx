import { useEffect, useState } from 'react'
import type { Glance, GlancePoint, Paper } from '@shared/types'
import { api, errText } from '../api'
import { Markdown } from '../lib/Markdown'
import { Skeleton } from '../lib/ui'
import { t } from '@shared/i18n'

// 速览：一次生成并缓存 TL;DR、研究问题、方法、主要结论、关键词、值得精读的部分
export function GlanceView(props: { paper: Paper; hasDoc: boolean; regenSignal: number; onSection: (name: string, sec?: string) => void }) {
  const [g, setG] = useState<Glance | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const generate = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      setG(await api.glanceGenerate(props.paper.id))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void api.glanceGet(props.paper.id).then((x) => {
      setG(x)
      setLoaded(true)
      if (!x) void generate()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.paper.id])

  useEffect(() => {
    if (props.regenSignal) void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.regenSignal])

  const sec = (title: string, body: React.ReactNode): React.ReactNode => (
    <section className="glance-sec">
      <h2>{title}</h2>
      {busy && !g ? <Skeleton lines={[100, 85, 60]} /> : body}
    </section>
  )
  // 旧缓存里的要点是字符串，没有出处
  const list = (xs: (GlancePoint | string)[] | undefined): React.ReactNode => (
    <ul>
      {(xs ?? []).map((x, i) => {
        const p = typeof x === 'string' ? { text: x, sec: '', title: '' } : x
        return (
          <li key={i}>
            <Markdown text={p.text} inline />
            {(p.sec || p.title) && (
              <button className="cchip" title={p.title || p.sec} onClick={() => props.onSection(p.title, p.sec)}>
                §{p.sec || p.title.split(/\s/)[0].replace(/\.$/, '')}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="reflow-scroller">
      <article className="reflow glance">
        <h1 className="doc-title">{props.paper.title}</h1>
        <div className="doc-authors">
          {[props.paper.venue, props.paper.year].filter(Boolean).join(' ')}
          {loaded && t(' · 速览由 AI 生成，点来源跳回原文')}
          {busy && g && (
            <>
              {t(' · 正在重新生成 ')}
              <span className="spin spin-10" />
            </>
          )}
        </div>
        {!props.hasDoc && <div className="doc-tier">{t('还没重排完，速览基于 PDF 文字')}</div>}
        {err && (
          <div className="inline-err">
            <span className="dot sm err" />
            {t('生成失败：')}{err}
            <button className="text-btn" onClick={() => void generate()}>
              {t('重试')}
            </button>
          </div>
        )}
        <div className="glance-tldr">{busy && !g ? <Skeleton lines={[100, 50]} /> : g && <Markdown text={g.tldr} inline />}</div>
        {(g || busy) && (
          <>
            {sec(t('研究问题'), list(g?.question))}
            {sec(t('方法'), list(g?.method))}
            {sec(t('主要结论'), list(g?.findings))}
            {sec(
              t('关键词'),
              <div className="kw">
                {(g?.keywords ?? []).map((k) => (
                  <span className="tag" key={k}>
                    {k}
                  </span>
                ))}
              </div>
            )}
            {sec(
              t('值得精读'),
              <div className="worth">
                {(g?.worth ?? []).map((w, i) => (
                  <button key={i} className="worth-row" onClick={() => props.onSection(w.section)}>
                    <span className="worth-sec">{w.section}</span>
                    <span className="worth-why">{w.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </article>
    </div>
  )
}
