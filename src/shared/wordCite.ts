import { formatCitation, splitName } from './cite'
import { t } from './i18n'
import type { Paper } from './types'

// Word 插件的文档侧逻辑（不碰 Office.js，能单测）：文中引用长什么样、怎么编号、参考文献表、格式检查。
// 文档里每处引用是一个内容控件，tag 记着引的是哪几篇；文献信息另存在文档自己的设置里，换电脑、没开应用也能重新排。

export type WordStyle = 'gbt' | 'apa' | 'mla' | 'ieee'
export const WORD_STYLES: { id: WordStyle; name: string; numeric: boolean }[] = [
  { id: 'gbt', name: t('GB/T 7714—2015 顺序编码'), numeric: true },
  { id: 'apa', name: t('APA 第 7 版'), numeric: false },
  { id: 'mla', name: t('MLA 第 9 版'), numeric: false },
  { id: 'ieee', name: 'IEEE', numeric: true }
]
export const isNumeric = (s: WordStyle): boolean => WORD_STYLES.find((x) => x.id === s)!.numeric

export type CiteItem = Pick<Paper, 'id' | 'title' | 'authors' | 'year' | 'venue' | 'volume' | 'issue' | 'pages' | 'doi' | 'url' | 'publisher' | 'arxiv'>
export type Items = Record<string, CiteItem>

export const CITE_PREFIX = 'prcite:'
export const BIB_TAG = 'prbib'
// Word 的内容控件 tag 最长 64 个字符
const MAX_TAG = 64
export const citeTag = (ids: string[]): string => CITE_PREFIX + ids.join(',')
export const fitsTag = (ids: string[]): boolean => citeTag(ids).length <= MAX_TAG
export const idsOfTag = (tag: string): string[] | null => (tag.startsWith(CITE_PREFIX) ? tag.slice(CITE_PREFIX.length).split(',').filter(Boolean) : null)

/** 按第一次出现的先后编号，从 1 起 */
export function numbering(cites: string[][]): Map<string, number> {
  const num = new Map<string, number>()
  for (const ids of cites) for (const id of ids) if (!num.has(id)) num.set(id, num.size + 1)
  return num
}

/** 连着的三个以上并成一段：[1,2,3,5,6] → [[1,3],[5,5],[6,6]] */
function runs(nums: number[]): [number, number][] {
  const s = [...new Set(nums)].sort((x, y) => x - y)
  const out: [number, number][] = []
  for (let i = 0; i < s.length; ) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    if (j - i >= 2) out.push([s[i], s[j]])
    else for (let k = i; k <= j; k++) out.push([s[k], s[k]])
    i = j + 1
  }
  return out
}
/** [1,2,3,5] → 1-3,5；只有两个连着的写 1,2 */
export const ranges = (nums: number[]): string => runs(nums).map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',')

const lastName = (a: string): string => splitName(a).last
function authorYear(it: CiteItem, withYear: boolean): string {
  const ns = it.authors.map(lastName)
  const zh = /[一-鿿]/.test(ns[0] ?? '')
  const who = ns.length === 0 ? it.title.split(/\s+/).slice(0, 3).join(' ') : ns.length === 1 ? ns[0] : ns.length === 2 ? `${ns[0]} ${zh ? '和' : withYear ? '&' : 'and'} ${ns[1]}` : `${ns[0]} ${zh ? '等' : 'et al.'}`
  return withYear ? `${who}, ${it.year ?? 'n.d.'}` : who
}

/** 文中那一处引用的文字 */
export function inText(ids: string[], style: WordStyle, num: Map<string, number>, items: Items): string {
  if (isNumeric(style)) {
    const ns = ids.map((id) => num.get(id)).filter((n): n is number => n !== undefined)
    if (!ns.length) return '[?]'
    // IEEE 每个号各带方括号：[1], [3]–[5]；GB/T 写在一个方括号里：[1,3-5]
    if (style === 'ieee') return runs(ns).map(([a, b]) => (a === b ? `[${a}]` : `[${a}]–[${b}]`)).join(', ')
    return `[${ranges(ns)}]`
  }
  const parts = ids
    .map((id) => items[id])
    .filter(Boolean)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .map((it) => authorYear(it, style === 'apa'))
  return parts.length ? `(${parts.join('; ')})` : '(?)'
}

const sortKey = (it: CiteItem): string => `${(it.authors[0] ? lastName(it.authors[0]) : it.title).toLowerCase()} ${it.year ?? 9999} ${it.title.toLowerCase()}`

/** 参考文献表里的顺序：编号制按编号，著者年份制按第一作者姓、年份 */
export function bibOrder(cites: string[][], style: WordStyle, items: Items): string[] {
  const ids = [...numbering(cites).keys()].filter((id) => items[id])
  return isNumeric(style) ? ids : ids.sort((a, b) => sortKey(items[a]).localeCompare(sortKey(items[b])))
}

export interface BibEntry {
  id: string
  label: string // 编号制是 [1]，著者年份制是空的
  text: string // 期刊名两边带 * 表示斜体
}
export function bibEntries(cites: string[][], style: WordStyle, items: Items): BibEntry[] {
  const num = numbering(cites)
  return bibOrder(cites, style, items).map((id) => ({ id, label: isNumeric(style) ? `[${num.get(id)}]` : '', text: formatCitation(items[id], style) }))
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** 参考文献表写进 Word 用的 HTML：一条一段，期刊名斜体 */
export function bibHtml(entries: BibEntry[]): string {
  if (!entries.length) return `<p>${esc(t('（正文里还没有引用）'))}</p>`
  return entries.map((e) => `<p>${e.label ? esc(e.label) + ' ' : ''}${esc(e.text).replace(/\*([^*]+)\*/g, '<i>$1</i>')}</p>`).join('')
}

export interface Issue {
  level: 'error' | 'warn'
  text: string
  cite?: number // 第几处引用（从 0 起），点了能跳过去
}

/** 论文格式检查：文献缺项、编号被手改、手打的编号、参考文献表没有或者过期 */
export function check(input: {
  cites: string[][]
  texts: string[] // 每处引用现在在文档里的文字
  items: Items
  style: WordStyle
  hasBib: boolean
  bibIds: string[] // 上次生成参考文献表时的顺序
  bodyText: string
}): Issue[] {
  const { cites, texts, items, style } = input
  const out: Issue[] = []
  const num = numbering(cites)
  cites.forEach((ids, i) => {
    const lost = ids.filter((id) => !items[id])
    if (lost.length) out.push({ level: 'error', cite: i, text: t('第 {0} 处引用有 {1} 篇文献的信息不在这个文档里，重新插入一次', i + 1, lost.length) })
    const want = inText(ids, style, num, items)
    if (texts[i] !== undefined && texts[i].trim() !== want) out.push({ level: 'error', cite: i, text: t('第 {0} 处引用被手改过：现在是 {1}，应该是 {2}。点「更新全文」改回来', i + 1, texts[i].trim() || t('空的'), want) })
  })
  for (const id of num.keys()) {
    const it = items[id]
    if (!it) continue
    const miss = [!it.authors.length && t('作者'), !it.year && t('年份'), !it.venue && t('期刊或会议名')].filter(Boolean)
    const journal = it.venue && !/arxiv|conference|proceedings|symposium|workshop/i.test(it.venue)
    if (journal && !it.volume) miss.push(t('卷'))
    if (journal && !it.pages) miss.push(t('页码'))
    if (miss.length) out.push({ level: 'warn', cite: cites.findIndex((c) => c.includes(id)), text: t('《{0}》缺 {1}，到 ParaRead 的文献信息里补上', it.title.length > 40 ? it.title.slice(0, 40) + '…' : it.title, miss.join('、')) })
  }
  if (cites.length && !input.hasBib) out.push({ level: 'error', text: t('正文引了 {0} 篇，但文档里还没有参考文献表', num.size) })
  else if (input.hasBib && input.bibIds.join(',') !== bibOrder(cites, style, items).join(',')) out.push({ level: 'error', text: t('参考文献表和正文对不上（引用增删过），点「更新全文」') })
  // 手打的 [12]：不会跟着重新编号。正文里所有方括号编号，减掉插件自己写的（引用和参考文献表的条目号）
  if (isNumeric(style)) {
    const ours = new Map<string, number>()
    const add = (s: string): void => void ours.set(s, (ours.get(s) ?? 0) + 1)
    cites.forEach((ids) => (inText(ids, style, num, items).match(/\[[\d,-]+\]/g) ?? []).forEach(add))
    if (input.hasBib) for (const n of num.values()) add(`[${n}]`)
    const manual: string[] = []
    for (const m of input.bodyText.match(/\[\d+(?:\s*[-–,，]\s*\d+)*\]/g) ?? []) {
      const k = m.replace(/\s+/g, '').replace(/，/g, ',')
      const left = ours.get(k) ?? 0
      if (left > 0) ours.set(k, left - 1)
      else manual.push(m)
    }
    if (manual.length) out.push({ level: 'warn', text: t('正文里有 {0} 处手打的编号（{1}），不会跟着重新编号', manual.length, [...new Set(manual)].slice(0, 5).join(' ')) })
  }
  return out
}
