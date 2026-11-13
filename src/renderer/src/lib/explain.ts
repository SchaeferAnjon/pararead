import { useCallback, useEffect, useState } from 'react'
import { api, reqId, streamRequest } from '../api'

import type { ExplainVersion } from '@shared/types'

export type Live = { key: string; raw: string; done: boolean; error: string | null; extra?: Pick<ExplainVersion, 'lit' | 'chunks'> }

// 一次讲解（一处或几处一起）的流式状态。key 认是哪一处、哪个焦点；离开了不停（主进程讲完照样存在标注上，推 onExplainSaved），
// 这里的 raw 只管流的过程
export function useExplainStream() {
  const [live, setLive] = useState<Live | null>(null)
  const run = useCallback((key: string, start: (id: string) => Promise<unknown>) => {
    setLive({ key, raw: '', done: false, error: null })
    streamRequest(start, {
      delta: (full) => setLive((l) => (l?.key === key ? { ...l, raw: full } : l)),
      done: (full) => setLive((l) => (l?.key === key ? { ...l, raw: full, done: true } : l)),
      error: (msg, partial) => setLive((l) => (l?.key === key ? { ...l, raw: partial, done: true, error: msg } : l))
    })
  }, [])
  const one = useCallback(
    (annId: string, o: { focus?: string; again?: boolean } = {}) => {
      const key = `${annId}|${o.focus ?? ''}|${o.again ? reqId() : ''}`
      run(key, (id) => api.explainStart(id, annId, o).then((extra) => setLive((l) => (l?.key === key ? { ...l, extra } : l))))
    },
    [run]
  )
  const group = useCallback((key: string, ids: string[]) => run(`g|${key}`, (id) => api.explainGroup(id, ids)), [run])
  const clear = useCallback(() => setLive(null), [])
  return { live, one, group, clear }
}

/** 后台正在备讲解的那些标注 */
export function usePendingExplains(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    void api.explainPending().then((l) => setIds(new Set(l)))
    return api.onExplainPending((l) => setIds(new Set(l)))
  }, [])
  return ids
}
