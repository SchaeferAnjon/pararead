/**
 * AI 动手的一步那一行（DESIGN.v3 2.3）：在做转圈、做完绿勾、出错红叉跟原因、等用户点头的黄色问号（这一下没做）；命令、库外的路径是等宽的一段，和前面的字之间留 3px（不手打空格）。
 * 放不下就折到下一行（对话区不横向滚）：动作、命令、原因在同一段字里接着排，长路径优先在 / 后面断，没空格的一长串任意处断。
 * AI 对话、读 PDF 的回答、旁支共用（以前在画布笔记 AiPanel.tsx）
 */
import { Fragment } from 'react'
import { Icon } from './context'
import type { StepView } from './host'
import './steps.css'

/** 每个 / 后面给一个断行的机会（<wbr>，不多出字，拷出来照旧） */
function slashBreaks(s: string) {
  const parts = s.split('/')
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ))
}

export function StepRow({ s }: { s: StepView }) {
  return (
    <div className={'read tstep ' + s.status} data-testid="ai-step" title={s.detail ?? s.code}>
      <Icon name={s.status === 'run' ? 'loading' : s.status === 'ok' ? 'check' : s.status === 'ask' ? 'question' : 'close'} size={12} className={s.status === 'run' ? 'spin' : ''} />
      <span className="st">
        <span className="sl">{slashBreaks(s.label)}</span>
        {s.code && <code className="sc">{slashBreaks(s.code)}</code>}
        {s.status === 'err' && s.detail && <span className="why">：{s.detail}</span>}
      </span>
    </div>
  )
}
