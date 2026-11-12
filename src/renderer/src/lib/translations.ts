import { useCallback, useEffect, useRef, useState } from 'react'
import { translationKey } from '@shared/hash'
import type { Block } from '@shared/types'
import { api } from '../api'
import { t } from '@shared/i18n'

export type TrState = { text: string } | { error: string } | { pending: true }

// 译文状态：按段落哈希（含目标语言）存。请求合并、并发和缓存都在主进程。
export function useTranslations(paperId: string, lang: string) {
  const [map, setMap] = useState<Record<string, TrState>>({})
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(
    () =>
      api.onTranslateResult((r) => {
        if (r.paperId !== paperId) return
        setMap((m) => ({ ...m, [r.key]: r.text !== undefined ? { text: r.text } : { error: r.error ?? t('未知错误') } }))
      }),
    [paperId]
  )

  const keyOf = useCallback((b: Block) => translationKey(b.md, lang), [lang])

  const request = useCallback(
    async (blocks: Block[], priority = false) => {
      const need = blocks.filter((b) => {
        const s = mapRef.current[keyOf(b)]
        return !s || ('error' in s && priority)
      })
      if (!need.length) return
      setMap((m) => {
        const n = { ...m }
        for (const b of need) n[keyOf(b)] = { pending: true }
        return n
      })
      const cached = await api.translate(
        paperId,
        need.map((b) => b.md),
        priority
      )
      if (Object.keys(cached).length) setMap((m) => ({ ...m, ...Object.fromEntries(Object.entries(cached).map(([k, t_]) => [k, { text: t_ }])) }))
    },
    [paperId, keyOf]
  )

  const retry = useCallback(
    (b: Block) => {
      setMap((m) => {
        const n = { ...m }
        delete n[keyOf(b)]
        return n
      })
      setTimeout(() => void request([b], true), 0)
    },
    [keyOf, request]
  )

  const cancel = useCallback(() => {
    void api.cancelTranslate(paperId)
    setMap((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => !('pending' in v))))
  }, [paperId])

  return { map, keyOf, request, retry, cancel }
}
