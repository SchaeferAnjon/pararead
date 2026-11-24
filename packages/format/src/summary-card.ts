/**
 * 白板上「AI 总结的」卡（task-5yp97，用户看图选「选法 1」）：卡的正文写成一个 `> [!ai] AI 总结 · …` 提示块，和 AI 讲解卡一套——
 * 能选一句开旁支（`> [!side]` 挂在后面，doc-side.ts）、文档里也是一个带「AI 总结」头的提示块、Obsidian 里也是提示块。
 *
 *   <!-- card id=s1 ai=2026-11-21 -->
 *   > [!ai] AI 总结 · Claude Code · Opus 5.5
 *   > 这块白板讲了注意力的三步：……
 *
 * 以前存的（编号行后面一段普通的字）第一次打开时一次转成这样（convertSummaryCards，主进程写回、单独一次提交、能撤回）：
 * 头写「AI 总结」（不知道当时是哪家写的，不编），每行前面加「> 」、空行写「>」，行尾的 \r 照留。
 * 只转编号行管着的那一张卡（doc-board 的一块，段落或列表），别的一个字不动；导图、旧写法的白板不在这里转
 * （旧写法打开时 board-convert 转白板，那一步把总结卡整张写成提示块）。纯函数，不依赖 Electron。
 */
import { aiCalloutHead, calloutWords } from './ai-callout'
import { hasOldLayout } from './board'
import { type DocUnit, splitDoc } from './doc-board'
import { isMindmap } from './mindmap'

/** 一段总结写成 AI 总结块（不带结尾换行）；by：「Claude Code · Opus 5.5」，不知道就不写。已经是提示块的原样返回 */
export function summaryCallout(body: string, by?: string): string {
  if (/^\s*>\s*\[!ai\]/i.test(body)) return body
  const lines = body.split('\n')
  const cr = lines[0]!.endsWith('\r') ? '\r' : ''
  const head = `> [!ai] ${aiCalloutHead({ label: calloutWords().summary, ...(by ? { by } : {}) })}${cr}`
  return [
    head,
    ...lines.map((l) => {
      const end = l.endsWith('\r') ? '\r' : ''
      const t = end ? l.slice(0, -1) : l
      return (t.trim() ? `> ${t}` : '>') + end
    }),
  ].join('\n')
}

/** 还是以前写法的总结卡：编号行（或位置行）上写着 ai=，后面那一块是普通的字或列表 */
function oldSummaryCards(text: string): DocUnit[] {
  if (!text.includes('ai=') || isMindmap(text) || hasOldLayout(text)) return []
  const b = splitDoc(text)
  return [...b.columns.flatMap((c) => c.cards), ...b.placed].filter((u) => u.attrs?.ai !== undefined && (u.kind === 'text' || u.kind === 'list'))
}

/**
 * 按 \n 换行看这篇（splitDoc 认空行只认 \n）：整篇都是 \r\n 的换成 \n 看、写回时换回去；\r\n 和 \n 混着的不碰（转了会动到别处的换行）
 */
function lfView(text: string): { t: string; back(s: string): string } | null {
  if (!text.includes('\r')) return { t: text, back: (s) => s }
  if (/(^|[^\r])\n/.test(text)) return null
  return { t: text.replace(/\r\n/g, '\n'), back: (s) => s.replace(/\n/g, '\r\n') }
}

/** 打开时要转：有以前写法的「AI 总结的」卡 */
export function needsSummaryConvert(text: string): boolean {
  const v = lfView(text)
  return !!v && oldSummaryCards(v.t).length > 0
}

/** 以前写法的「AI 总结的」卡都写成 AI 总结块；cards 是转了几张（没有要转的原样返回、0） */
export function convertSummaryCards(text: string): { text: string; cards: number } {
  const v = lfView(text)
  const units = v ? oldSummaryCards(v.t) : []
  if (!v || !units.length) return { text, cards: 0 }
  let out = v.t
  for (const u of [...units].sort((a, b) => b.from - a.from)) out = out.slice(0, u.from) + summaryCallout(out.slice(u.from, u.to)) + out.slice(u.to)
  return { text: v.back(out), cards: units.length }
}
