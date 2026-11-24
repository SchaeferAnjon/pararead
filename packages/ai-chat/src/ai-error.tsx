import { useState } from 'react'
import { openEnginePick } from './ai-picker'
import { Icon, useChat, useUi } from './context'
import { EngineLogo } from './engine-logo'
import type { AiErrorAct } from './host'
import './ai-error.css'

/** 有自己标志的几家：「再问一次」画那一家的标志，别的画刷新 */
const LOGOS: readonly string[] = ['claude', 'codex', 'gemini', 'opencode', 'deepseek', 'zhipu']

/**
 * AI 没答出来（CN-75）：前面一个红色 error 小图标 + 一行中文说明，下面能点的下一步，
 * 英文原话（带 Request ID 那些）收在「看原话 ›」里，点开才看到，等宽、能拷。
 * 下一步那排（task-eavzx 款式页「出错那条」）：再问一次（画那一家的标志）· 换个问法 · 换一家；能再问一次的都给「换一家」；
 * 接着做、去设置照原来按原因出。AI 对话、读 PDF、网页、旁支、视频问框都用这一个。
 */
export function AiError(props: {
  raw: string
  engine?: { id?: string; label?: string }
  onRetry?(): void
  onRephrase?(): void
  /**
   * 这一轮已经动手做了几步才断的（停下、中途退出、出错）：写「没做完：…」和做到哪一步；下一步是「接着做」（接着同一个会话），
   * 不是「再问一次」（那样从头再来一遍）。onContinue 只在最后一条、没在答时给
   */
  cut?: { at: { label: string; code?: string } | null; onContinue?(): void }
  /** 我们自己说的「这次没做」（/ 命令跑不了的原因）：照原话写，不认原因、不给下一步、没有原话可看 */
  own?: boolean
}) {
  const { t } = useUi()
  const chat = useChat()
  const v = props.own ? { code: 'own', title: props.raw.trim(), acts: [] as AiErrorAct[], raw: null } : chat.aiErrorView(props.raw, props.engine)
  const [open, setOpen] = useState(false)
  const cut = props.cut
  const acts = v.acts.filter((a) => (a === 'retry' ? props.onRetry && !cut : a === 'rephrase' ? props.onRephrase && !cut : true))
  // 能再问一次的，换一家也给上（同一句换一家问）
  if (acts.includes('retry') && !acts.includes('switch')) acts.push('switch')
  const id = props.engine?.id
  const logo = id && LOGOS.includes(id) ? <EngineLogo id={id} size={12} /> : <Icon name="refresh" size={12} />
  return (
    <div className="aierr" data-testid="ai-error" data-code={v.code}>
      <div className="t">
        <Icon name="error" size={12} className="ic" />
        <span>{cut ? t('没做完：{title}', { title: v.title }) : v.title}</span>
      </div>
      {cut?.at && (
        <div className="at">
          {t('做到：{step}', { step: cut.at.label })}
          {cut.at.code && <code className="sc">{cut.at.code}</code>}
        </div>
      )}
      {(acts.length > 0 || cut?.onContinue) && (
        <div className="acts">
          {cut?.onContinue && (
            <button className="btn btn-xs" onClick={cut.onContinue}>
              <Icon name="play" size={12} />
              {t('接着做')}
            </button>
          )}
          {acts.includes('retry') && (
            <button className="btn btn-xs" data-act="retry" onClick={props.onRetry}>
              {logo}
              {t('再问一次')}
            </button>
          )}
          {acts.includes('rephrase') && (
            <button className="btn btn-xs" data-act="rephrase" onClick={props.onRephrase}>
              <Icon name="edit" size={12} />
              {t('换个问法')}
            </button>
          )}
          {acts.includes('switch') && (
            <button className="btn btn-xs" data-act="switch" onClick={openEnginePick}>
              <Icon name="arrow-swap" size={12} />
              {t('换一家')}
            </button>
          )}
          {acts.includes('settings') && (
            <button className="btn btn-xs" onClick={chat.openAiSettings}>
              <Icon name="settings-gear" size={12} />
              {t('去设置 › AI')}
            </button>
          )}
        </div>
      )}
      {v.raw && (
        <>
          <button className="raw-tg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? t('收起原话') : t('看原话')}
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
          {open && <pre className="raw">{v.raw}</pre>}
        </>
      )}
    </div>
  )
}
