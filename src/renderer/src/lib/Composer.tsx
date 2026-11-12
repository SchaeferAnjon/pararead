import { ArrowUp, Square } from 'lucide-react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { t } from '@shared/i18n'

// AI 输入框（学术 AI、Agent、阅读页右栏共用）：回车发送、⇧回车换行，输入法选词时不发；忙的时候发送键变成停止
export function Composer(props: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  busy?: boolean
  onStop?: () => void
  placeholder: string
  tools?: ReactNode
  top?: ReactNode
  canSend?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  minHeight?: number
  maxHeight?: number
  className?: string
  style?: React.CSSProperties
}) {
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = props.inputRef ?? own
  const min = props.minHeight ?? 44
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(Math.max(el.scrollHeight, min), props.maxHeight ?? 240) + 'px'
  }, [props.value, min, props.maxHeight, ref])
  const ready = props.canSend ?? !!props.value.trim()
  return (
    <div className={'inbox ' + (props.className ?? '')} style={props.style} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), ref.current?.focus())}>
      {props.top}
      <textarea
        ref={ref}
        value={props.value}
        placeholder={props.placeholder}
        rows={1}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!props.busy && ready) props.onSend()
          }
        }}
      />
      <div className="tools">
        {props.tools}
        <span className="spacer" />
        {props.busy && props.onStop ? (
          <button className="send stop" title={t('停止')} onClick={props.onStop}>
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button className={'send' + (ready && !props.busy ? '' : ' off')} title={t('发送 ↩')} disabled={!ready || props.busy} onClick={props.onSend}>
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
