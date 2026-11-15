// 跳走以后回来：点引用跳到参考文献、点 PDF 里的链接、输页码跳页之前记下读到的位置，
// 阅读区底部出「回到刚才读的地方」，点它或按 ⌘[ 回去；自己滚回那附近就收起。
import { CornerUpLeft, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { t } from '@shared/i18n'
import { kbd } from '@shared/kbd'

export type BackHandle = MutableRefObject<(() => boolean) | null>

export function useJumpBack(scroller: RefObject<HTMLElement | null>, handle?: BackHandle) {
  const [saved, setSaved] = useState<{ top: number; label: string } | null>(null)
  const left = useRef(false) // 跳走以后真的离开过那里（滚回附近才算「自己回去了」）

  const remember = useCallback(
    (label: string) => {
      const el = scroller.current
      if (!el) return
      left.current = false
      setSaved({ top: el.scrollTop, label })
    },
    [scroller]
  )

  const goBack = useCallback((): boolean => {
    const el = scroller.current
    if (!el || !saved) return false
    el.scrollTop = saved.top
    setSaved(null)
    return true
  }, [scroller, saved])

  // 滚动时：离开过再回到原处附近，就不用再提示了
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el || !saved) return
    const near = Math.abs(el.scrollTop - saved.top) < el.clientHeight * 0.4
    if (!near) left.current = true
    else if (left.current) setSaved(null)
  }, [scroller, saved])

  useEffect(() => {
    if (!handle) return
    handle.current = goBack
    return () => {
      if (handle.current === goBack) handle.current = null
    }
  }, [handle, goBack])

  const node = saved ? <BackPill label={saved.label} onBack={() => void goBack()} onClose={() => setSaved(null)} /> : null
  return { remember, onScroll, node }
}

function BackPill(p: { label: string; onBack: () => void; onClose: () => void }) {
  return (
    <div className="back-pill" onMouseDown={(e) => e.stopPropagation()}>
      <button className="bp-go" onClick={p.onBack} title={kbd('⌘[')}>
        <CornerUpLeft size={15} />
        {p.label}
        <span className="kbd">{kbd('⌘[')}</span>
      </button>
      <button className="icon-btn sm" title={t('不用了')} onClick={p.onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
