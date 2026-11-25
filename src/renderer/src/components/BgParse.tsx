import { Hourglass, Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BgStatus } from '@shared/types'
import { t } from '@shared/i18n'
import { api } from '../api'

// 后台解析的状态条：「后台在解析 3/14 篇 · 暂停」。文献库在左下角（侧栏底下），阅读页在标题栏；没有在排的就不出现
export function BgParse(props: { compact?: boolean }) {
  const [st, setSt] = useState<BgStatus | null>(null)
  useEffect(() => {
    void api.bgStatus().then(setSt)
    return api.onBgStatus(setSt)
  }, [])
  if (!st || st.total === 0) return null
  const n = `${st.done}/${st.total}`
  const label = st.paused === 'manual' ? t('后台解析已暂停 · {0} 篇', n) : st.paused === 'busy' ? t('后台在解析 {0} 篇 · 等你停手', n) : t('后台在解析 {0} 篇', n)
  const tip = [label, st.title ? t('正在解析《{0}》（{1}）', st.title, st.current?.tier === 'basic' ? t('精细') : t('快速')) : '', st.paused === 'busy' ? t('你在滚动、打字时先停下，停手 10 秒再接着解析') : '']
    .filter(Boolean)
    .join('\n')
  const act = st.paused === 'manual' ? t('继续') : t('暂停')
  // 阅读页标题栏挤：只留转圈、「3/14」和一颗图标按钮，整句在悬停提示里
  return (
    <div className={'bg-parse' + (props.compact ? ' compact' : '')} title={tip} data-paused={st.paused ?? ''}>
      {st.paused === 'manual' ? <Pause size={12} /> : st.paused === 'busy' ? <Hourglass size={12} /> : <span className="spin spin-10" />}
      <span className="bp-l num">{props.compact ? n : label}</span>
      <button className={'btn sm ghost bp-btn' + (props.compact ? ' icon' : '')} aria-label={act} title={act} onClick={() => void api.bgPause(st.paused !== 'manual')}>
        {props.compact ? st.paused === 'manual' ? <Play size={12} /> : <Pause size={12} /> : act}
      </button>
    </div>
  )
}

// 用户在操作（滚动、打字、点）：报给主进程，后台解析先停下；一秒最多报一次
export function useActivityReport(): void {
  useEffect(() => {
    let last = 0
    const ping = (): void => {
      const now = Date.now()
      if (now - last < 1000) return
      last = now
      api.bgActivity()
    }
    const evs = ['wheel', 'scroll', 'keydown', 'pointerdown', 'touchmove'] as const
    for (const e of evs) window.addEventListener(e, ping, { capture: true, passive: true })
    return () => {
      for (const e of evs) window.removeEventListener(e, ping, { capture: true })
    }
  }, [])
}
