/**
 * AI 写进文档的回答（CN-76 方向 A）：一个 Obsidian 提示块，和自己写的字分得开。
 *
 *   > [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧
 *   > 回答……
 *   >
 *   > - 要点一
 *
 * 头一行：「AI 讲解」（换过讲法时「AI 讲解（第 2 版）」）· 哪家 · 哪个模型 · 看了什么。
 * 白板上「AI 总结的」卡也是这一块（task-5yp97，用户看图选的「选法 1」）：头一个词是「AI 总结」（summary-card.ts）。
 * Obsidian 里打开也是提示块；块下面那一段留给自己写（编辑器在空段落上画占位「写下你自己的理解…」，不写进 md）。
 */

/** 「AI 总结的」卡头一行的第一个词（中文库；英文库见 EN_CALLOUT_WORDS） */
export const SUMMARY_LABEL = 'AI 总结'

/**
 * 写进文件的说法跟库语言（task-zojmg，英文版设计稿第 4 节）：英文库「> [!ai] AI explanation (v2) · Claude Code · Opus 5.5 · Saw page 5」。
 * 画布笔记打开库时照库语言设（setCalloutWords），默认中文；读的时候中文、英文两种都认（一个库里两种都可能有）。
 */
export interface CalloutWords {
  /** 头一个词：讲解 */
  explain: string
  /** 头一个词：白板上「AI 总结的」卡 */
  summary: string
  /** 换过讲法时接在头一个词后面 */
  version(n: number): string
  /** 看了什么：第几页、视频哪一帧（带前后字幕时写上字幕的时段）、网页这一段、框的这一块 */
  seenPage(page: number): string
  seenFrame(time: string, subs?: { from: string; to: string }): string
  seenWeb: string
  seenBox: string
  /** 头一个词：AI 往文档里新加的一段（AI 对话、全能模式改文件、/ 菜单写一段……，task-dtc34） */
  wrote: string
  /** 用户自己补标的（「标成 AI 写的」）：不知道是哪家写的，不编 */
  marked: string
  /** 用户在块里改过字 */
  edited: string
  /** 头上链回那段 AI 对话的字 */
  backToChat: string
  /** 头一个词：AI 对话里一条回答插进文档（task-83vl3） */
  answer: string
  /** AI 对话写进笔记（ai-note.ts）：旁支那一问的小标题开头、旁支回答的头一个词、旁支引用那句下面的来源 */
  sideHead: string
  sideAnswer: string
  inAnswer(q: string): string
  /** 讲的是论文外的前置知识的那一问：小标题末尾的标签（ai-note.ts 的 splitPreTag 两种都认） */
  preTag: string
}

export const ZH_CALLOUT_WORDS: CalloutWords = {
  explain: 'AI 讲解',
  summary: SUMMARY_LABEL,
  version: (n) => `（第 ${n} 版）`,
  seenPage: (p) => `看了第 ${p} 页`,
  seenFrame: (time, subs) => (subs ? `看了 ${time} 这一帧、${subs.from}–${subs.to} 的字幕` : `看了 ${time} 这一帧`),
  seenWeb: '看了网页这一段',
  seenBox: '看了框的这一块',
  wrote: 'AI 写的',
  marked: '补标',
  edited: '改过',
  backToChat: '回到 AI 对话',
  answer: 'AI 回答',
  sideHead: '旁支：',
  sideAnswer: '旁支回答',
  inAnswer: (q) => `在「${q}」的回答里`,
  preTag: '#前置知识',
}

export const EN_CALLOUT_WORDS: CalloutWords = {
  explain: 'AI explanation',
  summary: 'AI summary',
  version: (n) => ` (v${n})`,
  seenPage: (p) => `Saw page ${p}`,
  seenFrame: (time, subs) => (subs ? `Saw the frame at ${time} and subtitles ${subs.from}–${subs.to}` : `Saw the frame at ${time}`),
  seenWeb: 'Saw this part of the page',
  seenBox: 'Saw the boxed area',
  wrote: 'Written by AI',
  marked: 'marked by you',
  edited: 'edited',
  backToChat: 'Back to AI chat',
  answer: 'AI answer',
  sideHead: 'Side: ',
  sideAnswer: 'Side answer',
  inAnswer: (q) => `in the answer to “${q}”`,
  preTag: '#prerequisite',
}

let words = ZH_CALLOUT_WORDS
/** 现在写进文件用的说法 */
export const calloutWords = (): CalloutWords => words
/** 换库时照库语言设（画布笔记的 shared/i18n/file-words.ts） */
export function setCalloutWords(w: CalloutWords) {
  words = w
}

/** 这一块 AI 写的是总结（不是讲解）：头一行（`> [!ai] …`，或者去掉了「> [!ai] 」的标题）第一个词是「AI 总结」或「AI summary」 */
export function isSummaryHead(line: string): boolean {
  return /^(?:\s*>\s*\[!ai\][+-]?[ \t]*)?(?:AI 总结|AI summary)(?:[ \t]*·|[ \t]*$)/i.test(line)
}

export interface AiCallout {
  /** 头一个词：默认「AI 讲解」（英文库「AI explanation」）；「AI 总结的」卡是「AI 总结」 */
  label?: string
  /** 「Claude Code · Opus 5.5」 */
  by?: string
  /** 「看了 00:06 这一帧」「看了第 5 页」 */
  seen?: string
  /** 换过讲法时是第几版 */
  version?: number
  text: string
  points?: string[]
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()

export function aiCalloutHead(c: Pick<AiCallout, 'label' | 'by' | 'seen' | 'version'>): string {
  return [`${c.label ?? words.explain}${c.version ? words.version(c.version) : ''}`, c.by, c.seen].filter(Boolean).map((x) => oneLine(x!)).join(' · ')
}

/** 写成提示块（不带结尾换行） */
export function aiCallout(c: AiCallout): string {
  const body = [c.text.trim(), ...(c.points?.length ? ['', ...c.points.map((p) => `- ${oneLine(p)}`)] : [])].join('\n')
  const lines = body.split('\n').map((l) => (l.trim() ? `> ${l}` : '>'))
  return [`> [!ai] ${aiCalloutHead(c)}`, ...lines].join('\n')
}

/** 认头一行「AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页」，英文库的「AI explanation (v2) · … · Saw page 5」也认 */
export function parseAiCalloutHead(head: string): Pick<AiCallout, 'by' | 'seen' | 'version'> {
  // 头上「回到对话」的链接、「改过」「补标」不是哪家哪个模型（task-dtc34）
  const parts = head
    .split(' · ')
    .map((s) => s.trim())
    .filter((p, i) => i === 0 || !isHeadExtra(p))
  const v = /第\s*(\d+)\s*版|\(v(\d+)\)/.exec(parts[0] ?? '')
  const isSeen = (p: string) => p.startsWith('看了') || p.startsWith('Saw ')
  const seen = parts.find((p, i) => i > 0 && isSeen(p))
  const by = parts.slice(1).filter((p) => !isSeen(p)).join(' · ')
  return { ...(v ? { version: Number(v[1] ?? v[2]) } : {}), ...(by ? { by } : {}), ...(seen ? { seen } : {}) }
}

/** 提示块正文拆回回答和要点：要点是最后空一行之后那一串列表（回答里自己的列表留在回答里） */
export function splitAiBody(body: string[]): { text: string; points: string[] } {
  const lines = [...body]
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
  let i = lines.length
  while (i > 0 && /^[-*]\s+/.test(lines[i - 1]!.trim())) i--
  const isPoints = i < lines.length && (i === 0 || !lines[i - 1]!.trim())
  if (!isPoints) return { text: lines.join('\n').trim(), points: [] }
  return { text: lines.slice(0, i).join('\n').trim(), points: lines.slice(i).map((l) => l.trim().replace(/^[-*]\s+/, '').trim()) }
}

/** 头上一截是不是「回到对话」那样的链接、「改过」「补标」（中文、英文两种都认）：不算哪家哪个模型、看了什么 */
export function isHeadExtra(part: string): boolean {
  const p = part.trim()
  return /^\[[^\]]*\]\([^)]*\)$/.test(p) || [ZH_CALLOUT_WORDS, EN_CALLOUT_WORDS].some((w) => p === w.edited || p === w.marked)
}
