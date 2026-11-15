import { Lightbulb } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Idea } from '@shared/types'
import { IdeaPeek } from './IdeaCard'

export type Peek = ReturnType<typeof useIdeaPeek>

/** 悬停在小灯泡上出用法：离开灯泡 200ms 内移进弹层就不关 */
export function useIdeaPeek() {
  const [id, setId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keep = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const open = useCallback(
    (x: string) => {
      keep()
      setId(x)
    },
    [keep]
  )
  const leave = useCallback(() => {
    keep()
    timer.current = setTimeout(() => setId(null), 200)
  }, [keep])
  const close = useCallback(() => {
    keep()
    setId(null)
  }, [keep])
  useEffect(() => keep, [keep])
  return { id, open, leave, keep, close }
}

/** 正文左边空白处的小灯泡（位置相对正文那一栏），悬停出 IdeaPeek */
export function IdeaGutter(props: { marks: { id: string; top: number; left: number }[]; ideas: Idea[]; focus: string | null; peek: Peek; onLibrary: (i: Idea) => void; onRemove: (i: Idea) => void }) {
  const { peek } = props
  const shown = props.marks.find((m) => m.id === peek.id)
  const idea = shown && props.ideas.find((i) => i.id === shown.id)
  return (
    <>
      {props.marks.map((m) => (
        <button
          key={m.id}
          className={'idea-gut' + (peek.id === m.id || props.focus === m.id ? ' on' : '')}
          style={{ top: m.top, left: m.left }}
          data-idea={m.id}
          title={t('灵感')}
          aria-label={t('灵感')}
          onMouseEnter={() => peek.open(m.id)}
          onMouseLeave={peek.leave}
          onClick={() => (peek.id === m.id ? peek.close() : peek.open(m.id))}
        >
          <Lightbulb size={14} />
        </button>
      ))}
      {shown && idea && (
        <IdeaPeek
          idea={idea}
          style={{ top: shown.top + 26, left: Math.max(0, shown.left - 4) }}
          onEnter={peek.keep}
          onLeave={peek.leave}
          onOpenLibrary={() => props.onLibrary(idea)}
          onRemove={() => {
            peek.close()
            props.onRemove(idea)
          }}
        />
      )}
    </>
  )
}
