import { Check, Lightbulb, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cleanTopics } from '@shared/ideas'
import { t } from '@shared/i18n'
import type { Idea, IdeaHow } from '@shared/types'
import { Segmented } from '../lib/ui'

export interface IdeaDraft {
  use: string
  topics: string[]
  how: IdeaHow
}

export const HOW_NAME: Record<IdeaHow, string> = { quote: t('直接引原句'), paraphrase: t('用自己的话转述') }

/** 收进灵感库的小卡：原句、想怎么用、主题、写论文时直接引还是转述；三样都能不填，回车收好，Esc 不收 */
export function IdeaCapture(props: { text: string; where: string; topics: string[]; how: IdeaHow; onSave: (d: IdeaDraft) => void; onCancel: () => void }) {
  const [use, setUse] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [how, setHow] = useState<IdeaHow>(props.how)
  const [adding, setAdding] = useState(false)
  const [newTopic, setNewTopic] = useState('')
  const useRef_ = useRef<HTMLInputElement>(null)
  useEffect(() => useRef_.current?.focus(), [])
  const chips = cleanTopics([...props.topics, ...picked])
  const toggle = (x: string): void => setPicked((l) => (l.some((y) => y.toLowerCase() === x.toLowerCase()) ? l.filter((y) => y.toLowerCase() !== x.toLowerCase()) : [...l, x]))
  const save = (): void => props.onSave({ use: use.trim(), topics: cleanTopics(picked), how })
  const addTopic = (): void => {
    const x = cleanTopics([newTopic])[0]
    if (x && !picked.some((y) => y.toLowerCase() === x.toLowerCase())) setPicked((l) => [...l, x])
    setNewTopic('')
    setAdding(false)
    useRef_.current?.focus()
  }
  return (
    <div
      className="idea-capture"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          props.onCancel()
        } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && !(e.target as HTMLElement).closest('.ic-new')) {
          e.preventDefault()
          save()
        }
      }}
    >
      <div className="ic-head">
        <span className="card-kind">{t('收进灵感库')}</span>
        <span className="spacer" />
        {props.where && <span className="hint num">{props.where}</span>}
      </div>
      <div className="ic-quote">{props.text}</div>
      <label className="ic-lbl" htmlFor="ic-use">
        {t('想怎么用')}
      </label>
      <label className="field-fill">
        <input id="ic-use" ref={useRef_} value={use} placeholder={t('比如：引言里说明为什么要在端侧做（可以不写）')} onChange={(e) => setUse(e.target.value)} />
      </label>
      <div className="ic-lbl">{t('主题')}</div>
      <div className="ic-chips">
        {chips.map((x) => {
          const on = picked.some((y) => y.toLowerCase() === x.toLowerCase())
          return (
            <button key={x} type="button" className={'tag idea-topic' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(x)}>
              {on && <Check size={12} strokeWidth={2.5} />}
              {x}
            </button>
          )
        })}
        {adding ? (
          <label className="field-fill ic-new">
            <input
              autoFocus
              value={newTopic}
              placeholder={t('新主题，回车')}
              onChange={(e) => setNewTopic(e.target.value)}
              onBlur={addTopic}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  addTopic()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNewTopic('')
                  setAdding(false)
                }
              }}
            />
          </label>
        ) : (
          <button type="button" className="tag idea-topic dash" onClick={() => setAdding(true)}>
            <Plus size={12} />
            {t('新主题')}
          </button>
        )}
      </div>
      <div className="ic-how">
        <span className="ic-lbl">{t('写论文时')}</span>
        <Segmented className="sm" value={how} onChange={setHow} options={[{ value: 'quote', label: HOW_NAME.quote }, { value: 'paraphrase', label: HOW_NAME.paraphrase }]} />
      </div>
      <div className="ic-foot">
        <span className="hint">{t('回车收好 · Esc 不收')}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={save}>
          {t('收进灵感库')}
        </button>
      </div>
    </div>
  )
}

/** 正文左边的小灯泡悬停出来的：用法、主题、怎么用，能去灵感库或拿掉 */
export function IdeaPeek(props: { idea: Idea; style: React.CSSProperties; onOpenLibrary: () => void; onRemove: () => void; onEnter: () => void; onLeave: () => void }) {
  const i = props.idea
  return (
    <div className="pop idea-peek" style={props.style} onMouseEnter={props.onEnter} onMouseLeave={props.onLeave} data-idea={i.id}>
      <div className="ip-head">
        <Lightbulb size={14} />
        <span>{t('灵感')}</span>
        <span className="spacer" />
        <span className="hint">{HOW_NAME[i.how]}</span>
      </div>
      <div className={'ip-use' + (i.use ? '' : ' hint')}>{i.use || t('没写用法')}</div>
      {i.topics.length > 0 && (
        <div className="ip-topics">
          {i.topics.map((x) => (
            <span key={x} className="tag sm">
              {x}
            </span>
          ))}
        </div>
      )}
      <div className="ip-acts">
        <button className="btn sm" onClick={props.onOpenLibrary}>
          {t('在灵感库里看')}
        </button>
        <button className="btn ghost sm" onClick={props.onRemove}>
          {t('从灵感库拿掉')}
        </button>
      </div>
    </div>
  )
}
