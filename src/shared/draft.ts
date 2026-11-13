// 对比表写出的段落：AI 给的句子先过一遍（只许引用表里这几篇、出处得是表里的格子），
// 再转成两种送出去的样子：Word 插件收的「文字 + 引用」片段，和带 \cite{key} 的 LaTeX。
import { isRel, splitCell, type OutlineItem, type Sentence, type SentenceCheck } from './matrix'

/** AI 写的句子：cites 用的是论文编号（1 起），这里换成论文 id；编号不在表里的丢掉并记下来 */
export function cleanSentences(
  raw: { t?: unknown; cites?: unknown; src?: unknown }[],
  paperIds: string[],
  cellIds: Set<string>
): { sentences: Sentence[]; dropped: number } {
  let dropped = 0
  const sentences: Sentence[] = []
  for (const r of raw) {
    const t = String(r.t ?? '').trim()
    if (!t) continue
    const nums = Array.isArray(r.cites) ? r.cites.map(Number) : []
    const cites: string[] = []
    for (const n of nums) {
      const id = paperIds[n - 1]
      if (Number.isInteger(n) && id) {
        if (!cites.includes(id)) cites.push(id)
      } else dropped++
    }
    const src = Array.isArray(r.src) ? [...new Set(r.src.map(String).filter((x) => cellIds.has(x)))] : []
    sentences.push({ t: stripCites(t), cites, src })
  }
  return { sentences, dropped }
}

/** 模型有时把 [1] 写进句子里：去掉，引用号由我们加 */
const stripCites = (t: string): string => t.replace(/\s*\[\d+(?:\s*[-–,]\s*\d+)*\]/g, '').replace(/\s+([，。；：、,.;:])/g, '$1')

/** 提纲：每条的格子只留表里有的；空提纲条去掉 */
export function cleanOutline(raw: { h?: unknown; cells?: unknown }[], cellIds: Set<string>): OutlineItem[] {
  return raw
    .map((r) => ({ h: String(r.h ?? '').trim(), cells: Array.isArray(r.cells) ? [...new Set(r.cells.map(String).filter((x) => cellIds.has(x)))] : [] }))
    .filter((r) => r.h)
}

/** 模型漏掉的勾选格子补进提纲：要点里提到这篇（方法名）的那条，否则放进已经有这篇别的格子的那条，都没有放最后一条 */
export function fillOutline(outline: OutlineItem[], selected: string[], names: (cellId: string) => string[], paperOf: (cellId: string) => string[]): OutlineItem[] {
  if (!outline.length) return outline
  const out = outline.map((x) => ({ ...x, cells: [...x.cells] }))
  const used = new Set(out.flatMap((x) => x.cells))
  for (const id of selected) {
    if (used.has(id)) continue
    const ns = names(id).map((n) => n.toLowerCase()).filter((n) => n.length >= 3)
    const ps = paperOf(id)
    const at =
      out.find((x) => ns.some((n) => x.h.toLowerCase().includes(n))) ??
      out.find((x) => x.cells.some((c) => paperOf(c).some((p) => ps.includes(p)))) ??
      out[out.length - 1]
    at.cells.push(id)
    used.add(id)
  }
  return out
}

/** 一句拆成正文和句末标点：引用号放在标点前面 */
export function splitPunct(t: string): [string, string] {
  const m = /^(.*?)([。．.！!？?；;，,：:]*)$/s.exec(t.trim())!
  return [m[1], m[2]]
}

/** 查证的规则部分：没有出处的是推断；引用的论文和出处格子对不上的也标出来。AI 再逐句判断原文撑不撑得住 */
export function ruleCheck(s: Sentence): SentenceCheck | null {
  if (!s.src.length) return { ok: false, why: s.cites.length ? 'nosrc-cited' : 'nosrc' }
  const srcPapers = new Set(s.src.filter((x) => !isRel(x)).map((x) => splitCell(x).paperId))
  const stray = s.cites.filter((id) => !srcPapers.has(id) && !s.src.some(isRel))
  if (stray.length) return { ok: false, why: 'stray' }
  return null
}

export type Seg = { text: string } | { cite: string[] }

/** Word 插件收的样子：一段文字和引用交替。中文句子里引用紧跟正文，英文前面空一格 */
export function wordSegments(sentences: Sentence[], lang: 'zh' | 'en'): Seg[] {
  const out: Seg[] = []
  const push = (text: string): void => {
    const last = out[out.length - 1]
    if (last && 'text' in last) last.text += text
    else if (text) out.push({ text })
  }
  sentences.forEach((s, i) => {
    const [body, punct] = splitPunct(s.t)
    const gap = i && lang === 'en' ? ' ' : ''
    push(gap + body + (s.cites.length && lang === 'en' ? ' ' : ''))
    if (s.cites.length) out.push({ cite: s.cites })
    push(punct || (lang === 'en' ? '.' : '。'))
  })
  return out
}

/** LaTeX 的特殊字符转义 */
export function texEscape(s: string): string {
  return s.replace(/[\\{}$&#%_^~]/g, (c) => ({ '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' })[c] ?? '\\' + c)
}

/** 带 \cite{key} 的一段：引用放在句末标点前，用不断行空格 ~ 连着 */
export function toLatex(sentences: Sentence[], keyOf: (paperId: string) => string, lang: 'zh' | 'en'): string {
  return sentences
    .map((s, i) => {
      const [body, punct] = splitPunct(s.t)
      const cite = s.cites.length ? `~\\cite{${s.cites.map(keyOf).join(',')}}` : ''
      return (i && lang === 'en' ? ' ' : '') + texEscape(body) + cite + texEscape(punct || (lang === 'en' ? '.' : '。'))
    })
    .join('')
}

/** 纯文本（复制、导出 Markdown 用）：引用写成 [n]，n 是表里的行号 */
export function plainText(sentences: Sentence[], numOf: (paperId: string) => number, lang: 'zh' | 'en'): string {
  return sentences
    .map((s, i) => {
      const [body, punct] = splitPunct(s.t)
      const cite = s.cites.length ? `${lang === 'en' ? ' ' : ''}[${s.cites.map(numOf).sort((a, b) => a - b).join(', ')}]` : ''
      return (i && lang === 'en' ? ' ' : '') + body + cite + (punct || (lang === 'en' ? '.' : '。'))
    })
    .join('')
}
