/**
 * 输入框里 @ 点名的文档（@文档胶囊）：纯函数，主进程、存对话的类型也引。
 * 字里照旧是「@标题」（交给 AI 的那句话不变），哪几段是胶囊记在 Mention 里；界面按 mentionRanges 认出来画成胶囊。
 */

/** 点名的是什么：文档、白板、PDF、剪来的网页、HTML（各自一个图标） */
export type MentionKind = 'doc' | 'board' | 'pdf' | 'web' | 'html'

export interface Mention {
  /** 库里的路径（悬停看它，点了打开它） */
  path: string
  /** 字里写的那个名字（「@」后面那段） */
  title: string
  kind: MentionKind
}

/** @ 候选的一行：下面那行小字（「文档」「白板 · 12张卡片」「PDF」） */
export interface AtItem extends Mention {
  sub: string
}

/** 胶囊和候选前面的图标（Codicons 的叫法，ICON_NAMES 里有） */
export const MENTION_ICON = { doc: 'file-text', board: 'layout', pdf: 'file-pdf', web: 'globe', html: 'file-code' } as const satisfies Record<MentionKind, string>

/** 字里的那一段 */
export const tokenOf = (m: Pick<Mention, 'title'>) => '@' + m.title

/** 前面：开头或空白（同 atQuery）；后面：结尾、空白或标点（「@周记，帮我看看」也算） */
const before = (c: string | undefined) => c === undefined || /\s/.test(c)
const after = (c: string | undefined) => c === undefined || !/[\p{L}\p{N}_]/u.test(c)

/**
 * 字里哪几段是胶囊：每个点名的「@标题」，前面是开头或空白、后面不接着字母数字才算（「@情绪识别调研究」不算）；
 * 重叠时长的优先（「@周记」和「@周记 2026」都点了）
 */
export function mentionRanges(text: string, mentions: readonly Mention[]): { from: number; to: number; m: Mention }[] {
  const found: { from: number; to: number; m: Mention }[] = []
  for (const m of [...mentions].sort((a, b) => b.title.length - a.title.length)) {
    const tok = tokenOf(m)
    for (let i = text.indexOf(tok); i >= 0; i = text.indexOf(tok, i + 1)) {
      const to = i + tok.length
      if (!before(text[i - 1]) || !after(text[to])) continue
      if (found.some((r) => i < r.to && to > r.from)) continue
      found.push({ from: i, to, m })
    }
  }
  return found.sort((a, b) => a.from - b.from)
}

/** 字里还在的那几个（删掉、改坏了的去掉；同一篇点了两次留一个） */
export function liveMentions(text: string, mentions: readonly Mention[]): Mention[] {
  const hit = new Set(mentionRanges(text, mentions).map((r) => r.m))
  return mentions.filter((m, i) => hit.has(m) && mentions.findIndex((x) => x.path === m.path && x.title === m.title) === i)
}

/** 光标前面正在打的「@几个字」：@ 在开头或空白后面，到光标为止没有空白；不是就 null */
export function atQuery(text: string, caret: number): { from: number; q: string } | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return m ? { from: caret - m[1]!.length - 1, q: m[1]! } : null
}

/**
 * 退格、Delete 碰到胶囊：整个删掉（连同它后面那个空格）。光标在胶囊末尾（或末尾的空格后面）退格、在胶囊开头 Delete；
 * 选着一段时照常删。返回删完的字和光标，不碰胶囊时是 null
 */
export function eraseMention(text: string, mentions: readonly Mention[], caret: number, dir: 'back' | 'forward'): { text: string; at: number } | null {
  for (const r of mentionRanges(text, mentions)) {
    const space = text[r.to] === ' '
    const hit = dir === 'back' ? caret > r.from && caret <= r.to + (space ? 1 : 0) : caret >= r.from && caret < r.to
    if (!hit) continue
    const to = space ? r.to + 1 : r.to
    return { text: text.slice(0, r.from) + text.slice(to), at: r.from }
  }
  return null
}

/** 光标落进胶囊中间（方向键、拖着选）：往哪边走就挪到那一头（从 prev 往左来的到开头，别的到末尾），胶囊里不能放光标、打字 */
export function snapOut(text: string, mentions: readonly Mention[], caret: number, prev: number): number {
  for (const r of mentionRanges(text, mentions)) if (caret > r.from && caret < r.to) return caret < prev ? r.from : r.to
  return caret
}
