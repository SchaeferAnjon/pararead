// 灵感库：读到的好句子收进来（想怎么用、主题、直接引还是转述），写论文时带出处引用。
// 这里是不碰界面和数据库的部分：主题整理、分组、搜索、复制成 LaTeX 和文字、送进 Word 的片段、导出 Markdown。
import { splitPunct, texEscape, type Seg } from './draft'
import { t } from './i18n'
import type { Idea, IdeaEntry, IdeaHow } from './types'

export type IdeaGroupBy = 'topic' | 'paper' | 'time'
export interface IdeaGroup {
  key: string
  title: string
  items: IdeaEntry[]
}

const CJK = /[㐀-鿿豈-﫿]/

/** 主题：去掉两头空白和开头的 #，空的不要，同名（不分大小写）只留第一个，太长的截到 24 个字 */
export function cleanTopics(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const x = raw.replace(/^[#＃\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 24)
    if (!x || seen.has(x.toLowerCase())) continue
    seen.add(x.toLowerCase())
    out.push(x)
  }
  return out
}

/** 收的小卡里列出来的主题：最近用过的在前 */
export function recentTopics(ideas: Pick<Idea, 'topics' | 'updatedAt'>[], limit = 8): string[] {
  const last = new Map<string, { name: string; at: number }>()
  for (const i of ideas)
    for (const x of i.topics) {
      const k = x.toLowerCase()
      const cur = last.get(k)
      if (!cur || cur.at < i.updatedAt) last.set(k, { name: x, at: i.updatedAt })
    }
  return [...last.values()].sort((a, b) => b.at - a.at).map((x) => x.name).slice(0, limit)
}

/** 搜索：每个词都要在原句、用法、主题、章节、论文题目或作者里出现 */
export function matchIdea(i: IdeaEntry, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [i.text, i.use, i.topics.join(' '), i.section, i.paperTitle, i.paperAuthors.join(' '), i.paraphrase?.en ?? '', i.paraphrase?.zh ?? ''].join('\n').toLowerCase()
  return words.every((w) => hay.includes(w.replace(/^#/, '')))
}

const DAY = 86_400_000
function bucket(at: number, now: number): string {
  const d = new Date(now)
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (at >= today) return t('今天')
  if (at >= today - 6 * DAY) return t('本周')
  if (at >= new Date(d.getFullYear(), d.getMonth(), 1).getTime()) return t('本月')
  return t('更早')
}

/** 按主题（一条有两个主题就在两组里都出现，没打主题的放最后）、按论文、按时间（今天 / 本周 / 本月 / 更早）分组 */
export function groupIdeas(list: IdeaEntry[], by: IdeaGroupBy, now = Date.now()): IdeaGroup[] {
  const newest = [...list].sort((a, b) => b.createdAt - a.createdAt)
  if (by === 'time') {
    const out: IdeaGroup[] = []
    for (const i of newest) {
      const title = bucket(i.createdAt, now)
      const g = out.find((x) => x.key === title)
      if (g) g.items.push(i)
      else out.push({ key: title, title, items: [i] })
    }
    return out
  }
  if (by === 'paper') {
    const out = new Map<string, IdeaGroup>()
    for (const i of newest) {
      if (!out.has(i.paperId)) out.set(i.paperId, { key: i.paperId, title: i.paperTitle, items: [] })
      out.get(i.paperId)!.items.push(i)
    }
    // 一篇里按页码、在段里的位置排；论文按最近收的在前
    for (const g of out.values()) g.items.sort((a, b) => (a.page ?? 9999) - (b.page ?? 9999) || (a.start ?? 0) - (b.start ?? 0) || a.createdAt - b.createdAt)
    return [...out.values()]
  }
  const out = new Map<string, IdeaGroup>()
  const none: IdeaEntry[] = []
  for (const i of newest) {
    if (!i.topics.length) none.push(i)
    for (const x of i.topics) {
      const k = x.toLowerCase()
      if (!out.has(k)) out.set(k, { key: k, title: x, items: [] })
      out.get(k)!.items.push(i)
    }
  }
  const groups = [...out.values()].sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title))
  if (none.length) groups.push({ key: '', title: t('没打主题'), items: none })
  return groups
}

/** 原句自己引了别人（[1]、[3]–[5]、[2, 4]）：写论文时最好引原文献。返回句子里的那几处 */
export function secondaryCites(text: string): string[] {
  return text.match(/\[\d+(?:\s*[-–,]\s*\d+)*\](?:\s*[-–]\s*\[\d+\])?/g) ?? []
}

/** 引号：西文用 LaTeX 的 ``…''，中文用 “…” */
const texQuote = (s: string): string => (CJK.test(s) ? `“${texEscape(s)}”` : `\`\`${texEscape(s)}''`)

/** 复制成 LaTeX：直接引原句带页码 \cite[p.~6]{key}，转述不带页码；引用放在句末标点前，用 ~ 连着 */
export function ideaLatex(i: Pick<Idea, 'text' | 'page'>, key: string, how: IdeaHow, paraphrase = ''): string {
  if (how === 'quote') return `${texQuote(i.text.trim())}~\\cite${i.page ? `[p.~${i.page}]` : ''}{${key}}`
  const [body, punct] = splitPunct(paraphrase)
  return `${texEscape(body)}~\\cite{${key}}${texEscape(punct || (CJK.test(body) ? '。' : '.'))}`
}

/** 复制文字：APA 的样子，直接引带页码 */
export function ideaPlain(i: Pick<IdeaEntry, 'text' | 'page' | 'paperAuthors' | 'paperYear' | 'paperTitle'>, how: IdeaHow, paraphrase = ''): string {
  const last = (a: string): string => (a.includes(',') ? a.split(',')[0] : (a.trim().split(/\s+/).pop() ?? a)).trim()
  const n = i.paperAuthors.map(last)
  const who = n.length === 0 ? i.paperTitle.split(/\s+/).slice(0, 3).join(' ') : n.length === 1 ? n[0] : n.length === 2 ? `${n[0]} & ${n[1]}` : `${n[0]} et al.`
  const cite = `(${who}, ${i.paperYear ?? 'n.d.'}${how === 'quote' && i.page ? `, p. ${i.page}` : ''})`
  if (how === 'quote') return `“${i.text.trim()}” ${cite}`
  const [body, punct] = splitPunct(paraphrase)
  return `${body} ${cite}${punct || '.'}`
}

/** 插进 Word 的片段：直接引是 “原句” 加带页码的引用；转述是转述的话加引用，引用在句末标点前 */
export function ideaSegments(i: Pick<Idea, 'paperId' | 'text' | 'page'>, how: IdeaHow, paraphrase = ''): Seg[] {
  if (how === 'quote') {
    const q = i.text.trim()
    return [{ text: `“${q}”${CJK.test(q) ? '' : ' '}` }, { cite: [i.paperId], ...(i.page ? { page: i.page } : {}) }]
  }
  const [body, punct] = splitPunct(paraphrase)
  const zh = CJK.test(body)
  return [{ text: body + (zh ? '' : ' ') }, { cite: [i.paperId] }, { text: punct || (zh ? '。' : '.') }]
}

/** 导出 Markdown 时跟在笔记后面的「灵感」一节 */
export function ideasMarkdown(list: Idea[]): string[] {
  if (!list.length) return []
  const lines = [`## ${t('灵感')}`, '']
  const sorted = [...list].sort((a, b) => (a.page ?? 9999) - (b.page ?? 9999) || a.createdAt - b.createdAt)
  for (const i of sorted) {
    lines.push(...i.text.split('\n').map((l) => `> ${l}`))
    lines.push(`> （${[i.page ? t('第 {0} 页', i.page) : '', i.section].filter(Boolean).join('，')}）`, '')
    const meta = [i.use.trim() && `${t('想怎么用')}：${i.use.trim()}`, i.topics.length && `${t('主题')}：${i.topics.map((x) => `#${x.replace(/\s+/g, '_')}`).join(' ')}`, `${t('写论文时')}：${i.how === 'quote' ? t('直接引原句') : t('转述')}`].filter(Boolean)
    lines.push(meta.join('  \n'), '')
    for (const [k, v] of Object.entries(i.paraphrase ?? {})) if (v) lines.push(`${t('转述')}（${k === 'en' ? 'English' : t('中文')}）：${v}`, '')
  }
  return lines
}
