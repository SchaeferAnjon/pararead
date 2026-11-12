import { useEffect, useRef, useState } from 'react'
import { translationKey } from '@shared/hash'
import { api } from '../api'

// 文献库标题翻译：标题按文字哈希缓存在主进程（和段落译文同一张表），这里只管请求和收结果
const LIB = '__library__'

export function useTitleTranslations(titles: string[], lang: string, on: boolean): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({})
  const asked = useRef(new Set<string>())
  useEffect(
    () =>
      api.onTranslateResult((r) => {
        if (r.paperId === LIB && r.text) setMap((m) => ({ ...m, [r.key]: r.text! }))
      }),
    []
  )
  useEffect(() => {
    if (!on) return
    const need = titles.filter((t) => !asked.current.has(translationKey(t, lang)))
    if (!need.length) return
    for (const t of need) asked.current.add(translationKey(t, lang))
    void api.translate(LIB, need, false).then((cached) => setMap((m) => ({ ...m, ...cached })))
  }, [titles, lang, on])
  const out: Record<string, string> = {}
  if (on) for (const t of titles) {
    const v = map[translationKey(t, lang)]
    if (v) out[t] = v
  }
  return out
}
