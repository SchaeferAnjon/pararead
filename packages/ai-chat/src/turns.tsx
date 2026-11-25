/**
 * 对话里的一来一回（照画布笔记读 PDF 的对话，ReadingAi）：你发的那句（UserTurn）、AI 的回答（AnswerTurn）。
 * 只管画：存在哪、怎么问、右键菜单、回答下面那排按钮由宿主交（children、acts、onContextMenu）。
 * - UserTurn：右边的气泡；框的那块图在气泡最上面，带材料的那一条是 MatMsg（字里的编号是小圆点数字，下面一行一块），
 *   以前粘贴的图（没有材料那时候）画在气泡上面，问的是哪一句（「…」）写在气泡上面；外面那层带 data-toc-q，对话目录按它列问题。
 * - AnswerTurn：回答头「✓ 读了第4页 · [标志] Claude Code · Opus 5.5 · High」、动手的每一步、「正在想…」、正文（宿主的 renderMarkdown），
 *   下面是宿主交的（出错、回答下面那排、记进笔记的进度）。.am[data-msg] 和 data-src 是选中一句（AskBox）、旁支挂在哪（side/host）认的。
 * 样子在 turns.css；读 PDF 那一套（气泡里的图、问的那句、闪一下）挂在 .reading-ai 下面，ParaRead 的对话那一格也带这个 class。
 */
import type { ReactNode, Ref } from 'react'
import { MatMsg } from './composer'
import { Icon, useChat, useUi } from './context'
import { ByLogo } from './engine-logo'
import type { StepView } from './host'
import type { Material } from './materials'
import { MentionText } from './mention'
import type { Mention } from './mentions'
import { StepRow } from './steps'
import './turns.css'

export interface UserTurnProps {
  text: string
  /** 带的材料（引用的段、贴的图）：有就画成 MatMsg */
  mats?: readonly Material[]
  /** 气泡最上面那块图（读 PDF 框的那块、整页） */
  image?: { src: string; alt: string } | null
  /** 以前粘贴的图（pasted 里的名字；没有材料那时候）：画在气泡上面 */
  pasted?: readonly string[]
  /** 这一问问的是哪一句（读 PDF 选着一段问的） */
  quote?: string
  /** 字里 @ 点名的文档：画成胶囊 */
  mentions?: readonly Mention[]
  /** 对话目录里这一问写什么 */
  tocLabel: string
  /** 这一串对话的头一问：外面那层带 data-thread（从笔记点「完整对话」滚到这里） */
  thread?: string
  /** 外圈亮一下 */
  flash?: boolean
  onContextMenu?(e: React.MouseEvent<HTMLElement>): void
  /** 气泡下面悬停出的那排（画布笔记：拷贝 · 存成快捷回复） */
  acts?: ReactNode
}

export function UserTurn(p: UserTurnProps) {
  const { t } = useUi()
  const { pastedUrl } = useChat()
  const crop = p.image ? (
    <div className="att">
      <img src={p.image.src} alt={p.image.alt} />
    </div>
  ) : null
  return (
    <div className={'um-wrap' + (p.flash ? ' flash' : '')} data-thread={p.thread} data-toc-q={p.tocLabel}>
      {!p.mats?.length &&
        p.pasted?.map((n) => (
          <div key={n} className="att">
            <img src={pastedUrl(n)} alt={t('粘贴的图')} />
          </div>
        ))}
      {p.quote && <div className="uq">「{p.quote}」</div>}
      {p.mats?.length ? (
        <MatMsg text={p.text} mats={[...p.mats]} lead={crop} {...(p.mentions ? { mentions: p.mentions } : {})} {...(p.onContextMenu ? { onContextMenu: p.onContextMenu } : {})} />
      ) : (
        <div className={'um' + (crop ? ' wimg' : '')} onContextMenu={p.onContextMenu}>
          {crop}
          {crop ? (
            <div className="ut">
              <MentionText text={p.text} {...(p.mentions ? { mentions: p.mentions } : {})} />
            </div>
          ) : (
            <MentionText text={p.text} {...(p.mentions ? { mentions: p.mentions } : {})} />
          )}
        </div>
      )}
      {p.acts}
    </div>
  )
}

export interface AnswerTurnProps {
  /** 这条回答的编号（data-msg：选中一句、旁支挂在哪按它找） */
  msg: number | string
  /** 引用这条回答里的字时写的来源（「AI的回答 · 第28页」） */
  src: string
  testId?: string
  /** 回答头：读了什么（「读了第4页」）、谁答的（「Claude Code · Opus 5.5 · High」，前面画那一家的标志）；ok：勾画成绿的 */
  head?: { read?: string; by?: string; ok?: boolean } | null
  /** 谁答的那一家的标志（不给按 by 的名字认画布笔记那十家） */
  logo?: ReactNode
  steps?: readonly StepView[]
  /** 还没出字时那一行（「正在想…」）；不给不画 */
  thinking?: string | null
  /** 正文（Markdown 原文） */
  text?: string
  /** 这段对话的键（宿主的 renderMarkdown 用） */
  conv: string
  /** 正文那一块：宿主要在画好的字上动手（划问过的那句）时拿它；有小标时整块换掉用 txtKey */
  txtRef?: Ref<HTMLDivElement>
  txtKey?: string
  onContextMenu?(e: React.MouseEvent<HTMLElement>): void
  /** 正文下面的：出错、回答下面那排、记进笔记的进度 */
  children?: ReactNode
}

export function AnswerTurn(p: AnswerTurnProps) {
  const chat = useChat()
  const h = p.head
  return (
    <div className="am" data-testid={p.testId} data-msg={p.msg} data-src={p.src} onContextMenu={p.onContextMenu}>
      {h && (h.read || h.by) && (
        <div className="read">
          {h.read && <Icon name="check" size={12} {...(h.ok ? { className: 'ok' } : {})} />}
          {h.read && <span className="rd">{h.read}</span>}
          {h.by && (
            <span className="by">
              {h.read ? ' · ' : ''}
              {p.logo ?? <ByLogo by={h.by} />}
              {h.by}
            </span>
          )}
        </div>
      )}
      {p.steps?.map((s) => (
        <StepRow key={s.id} s={s} />
      ))}
      {p.thinking && <div className="thinking">{p.thinking}</div>}
      {p.text && (
        <div className="txt md" key={p.txtKey ?? 'txt'} ref={p.txtRef}>
          {chat.renderMarkdown(p.text, { conv: p.conv, ...(p.steps ? { steps: p.steps } : {}) })}
        </div>
      )}
      {p.children}
    </div>
  )
}
