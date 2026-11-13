// 术语表：AI 从论文里挑出要懂的术语（原文原样、译名、一句解释），这里管在正文里找它们：数出现几次、在哪几段。
import type { Term } from './types'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 一个正则找出所有术语，长的排前面（「carry lookback」先于「carry」）。术语首尾是字母数字时要求是整词，
 * 不分大小写；中间的空白可以是任意空白（断行）。没有术语返回 null。
 */
export function termRegex(terms: Term[]): RegExp | null {
  const list = [...new Set(terms.map((x) => x.term.trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length)
  if (!list.length) return null
  const one = (s: string): string => `${/^\w/.test(s) ? '\\b' : ''}${s.split(/\s+/).map(esc).join('\\s+')}${/\w$/.test(s) ? '\\b' : ''}`
  return new RegExp(list.map(one).join('|'), 'gi')
}

/** 正则匹配到的字对应哪个术语（按不分大小写、空白合一比） */
export function termOf(terms: Term[], hit: string): Term | undefined {
  const k = hit.replace(/\s+/g, ' ').toLowerCase()
  return terms.find((x) => x.term.trim().replace(/\s+/g, ' ').toLowerCase() === k)
}

/** 每个术语在这些段里出现几次、出现在哪几段（段的 id，按先后） */
export function locateTerms(terms: Term[], blocks: { id: string; md: string }[]): Map<string, { count: number; blocks: string[] }> {
  const out = new Map(terms.map((x) => [x.term, { count: 0, blocks: [] as string[] }]))
  const re = termRegex(terms)
  if (!re) return out
  for (const b of blocks)
    for (const m of b.md.matchAll(re)) {
      const x = termOf(terms, m[0])
      const o = x && out.get(x.term)
      if (!o) continue
      o.count++
      if (o.blocks[o.blocks.length - 1] !== b.id) o.blocks.push(b.id)
    }
  return out
}
