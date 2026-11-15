// 讲解卡里「接着问这一处」：讲解下面一问一答往下排（流式），问答存在标注上；
// 输入框在「还不懂 / 懂了」上面；聊长了点「放到 AI 问答里接着聊」，把这几轮带过去。
import { MessageSquareShare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Annotation, SettingsView } from '@shared/types'
import { api, errText, streamRequest } from '../api'
import { Composer } from '../lib/Composer'
import { Markdown } from '../lib/Markdown'
import { Dots } from '../lib/ui'
import { ThinkChip } from './ThinkPicker'

interface Live {
  q: string
  a: string
  error?: string
}

/** 讲解下面的几轮问答（存下的加上正在流的这一轮） */
export function ExplainTurns(props: { a: Annotation; live: Live | null; onToChat: () => void }) {
  const turns = props.a.explain?.chat ?? []
  if (!turns.length && !props.live) return null
  return (
    <div className="ex-chat">
      <div className="ex-sh">{t('接着问')}</div>
      {turns.map((x) => (
        <Turn key={x.at} q={x.q} a={x.a} />
      ))}
      {props.live && <Turn q={props.live.q} a={props.live.a} streaming={!props.live.error} error={props.live.error} />}
      {turns.length > 0 && !props.live && (
        <button className="text-btn ex-tochat" onClick={props.onToChat}>
          <MessageSquareShare size={14} />
          {t('放到 AI 问答里接着聊')}
        </button>
      )}
    </div>
  )
}

function Turn(p: { q: string; a: string; streaming?: boolean; error?: string }) {
  return (
    <div className="ex-turn">
      <div className="ubub">{p.q}</div>
      <div className="ex-ans">{p.a ? <Markdown text={p.a} className="md" /> : p.streaming ? <Dots /> : null}</div>
      {p.error && (
        <div className="ex-err">
          <span className="dot err sm" />
          {t('没答出来：{0}', p.error)}
        </div>
      )}
    </div>
  )
}

/** 输入框和正在问的这一轮；换一条标注时清掉 */
export function useExplainAsk(a: Annotation) {
  const [live, setLive] = useState<Live | null>(null)
  const stop = useRef<(() => void) | null>(null)
  const saved = a.explain?.chat?.length ?? 0
  // 这一轮存好了（标注上多了一轮）就显示存下的
  useEffect(() => {
    if (live && !live.error) setLive(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])
  useEffect(() => () => stop.current?.(), [a.id])
  const ask = (q: string): void => {
    setLive({ q, a: '' })
    const r = streamRequest((id) => api.explainAsk(id, a.id, q), {
      delta: (full) => setLive({ q, a: full }),
      done: (full) => {
        stop.current = null
        if (!full.trim()) setLive({ q, a: '', error: t('没有回答') })
      },
      error: (msg, partial) => {
        stop.current = null
        setLive({ q, a: partial, error: errText(msg) })
      }
    })
    stop.current = r.stop
  }
  const busy = !!live && !live.error && !(a.explain?.chat ?? []).some((x) => x.q === live.q && x.a)
  return { live, ask, busy, stop: () => (stop.current?.(), (stop.current = null)) }
}

export function ExplainAskBox(props: { settings: SettingsView; busy: boolean; disabled: boolean; onAsk: (q: string) => void; onStop: () => void; label: Annotation['label'] }) {
  const [v, setV] = useState('')
  return (
    <Composer
      className="ex-inbox"
      value={v}
      onChange={setV}
      busy={props.busy}
      onStop={props.onStop}
      canSend={!!v.trim() && !props.disabled}
      onSend={() => {
        props.onAsk(v.trim())
        setV('')
      }}
      minHeight={22}
      maxHeight={140}
      placeholder={props.label === 'doubt' ? t('接着问这一处，比如「作者为什么不做这个对照？」') : t('接着问这一处，比如「这一步为什么成立？」')}
      tools={<ThinkChip settings={props.settings} />}
    />
  )
}

