/**
 * AI 动手的一步那一行（DESIGN.v3 2.3）：在做转圈、做完绿勾、出错红叉跟原因；命令、库外的路径是等宽的一段，和前面的字之间留 3px（不手打空格）。
 * AI 对话、读 PDF 的回答、旁支共用（以前在画布笔记 AiPanel.tsx）
 */
import { Icon } from './context'
import type { StepView } from './host'
import './steps.css'

export function StepRow({ s }: { s: StepView }) {
  return (
    <div className={'read tstep ' + s.status} data-testid="ai-step" title={s.detail ?? s.code}>
      <Icon name={s.status === 'run' ? 'loading' : s.status === 'ok' ? 'check' : 'close'} size={12} className={s.status === 'run' ? 'spin' : ''} />
      <span className="sl">{s.label}</span>
      {s.code && <code className="sc">{s.code}</code>}
      {s.status === 'err' && s.detail && <span className="why">：{s.detail}</span>}
    </div>
  )
}
