import { useCallback, useEffect, useRef, useState } from 'react'
import { sensesKey } from '@shared/hash'
import type { SenseSentence } from '@shared/senses'
import { api } from '../api'

export type SenseState = { data: SenseSentence[] } | { pending: true } | { error: string }

// 意群的状态：按「这一段原文 + 它的译文」的键存。排队、并发和缓存都在主进程。
export function useSenses(paperId: string, onError: (msg: string) => void) {
  const [map, setMap] = useState<Record<string, SenseState>>({})
  const mapRef = useRef(map)
  mapRef.current = map
  const errRef = useRef(onError)
  errRef.current = onError

  useEffect(
    () =>
      api.onSensesResult((r) => {
        if (r.paperId !== paperId) return
        setMap((m) => ({ ...m, [r.key]: r.data ? { data: r.data } : { error: r.error ?? '' } }))
        if (r.error) errRef.current(r.error)
      }),
    [paperId]
  )

  const request = useCallback(
    async (items: { en: string; zh: string }[]) => {
      const need = items.filter((it) => !mapRef.current[sensesKey(it.en, it.zh)])
      if (!need.length) return
      setMap((m) => ({ ...m, ...Object.fromEntries(need.map((it) => [sensesKey(it.en, it.zh), { pending: true } as SenseState])) }))
      const cached = await api.senses(paperId, need)
      if (Object.keys(cached).length) setMap((m) => ({ ...m, ...Object.fromEntries(Object.entries(cached).map(([k, data]) => [k, { data }])) }))
    },
    [paperId]
  )

  /** 关掉再打开时：没成功的那些重新要 */
  const retryFailed = useCallback(() => setMap((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => !('error' in v)))), [])

  return { map, request, retryFailed }
}
