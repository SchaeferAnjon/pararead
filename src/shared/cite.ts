import type { Paper } from './types'

// 引用格式：BibTeX、RIS、APA 7、MLA 9、IEEE、GB/T 7714-2015。只用文献信息里的字段，缺的就不写。

export type CiteStyle = 'gbt' | 'apa' | 'mla' | 'ieee' | 'bibtex' | 'ris'

export const CITE_STYLES: { id: CiteStyle; name: string }[] = [
  { id: 'gbt', name: 'GB/T 7714' },
  { id: 'apa', name: 'APA' },
  { id: 'mla', name: 'MLA' },
  { id: 'ieee', name: 'IEEE' },
  { id: 'bibtex', name: 'BibTeX' },
  { id: 'ris', name: 'RIS' }
]

type P = Pick<Paper, 'title' | 'authors' | 'year' | 'venue' | 'volume' | 'issue' | 'pages' | 'doi' | 'url' | 'publisher' | 'arxiv'>

interface Name {
  first: string
  last: string
}

export function splitName(n: string): Name {
  const s = n.trim()
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim())
    return { first: first ?? '', last }
  }
  // 中文名不拆
  if (/[一-鿿]/.test(s)) return { first: '', last: s }
  const parts = s.split(/\s+/)
  return { last: parts.pop() ?? '', first: parts.join(' ') }
}

const initials = (first: string, dots = true): string =>
  first
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + (dots ? '.' : ''))
    .join(dots ? ' ' : '')

const pagesDash = (p: string): string => p.replace(/\s*[-–—]+\s*/, '–')
const doiUrl = (d: string): string => `https://doi.org/${d}`

function apa(p: P): string {
  const names = p.authors.map(splitName).map((n) => (n.first ? `${n.last}, ${initials(n.first)}` : n.last))
  const au =
    names.length === 0 ? '' : names.length === 1 ? names[0] : names.length <= 20 ? `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}` : `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`
  let s = `${au}${au ? ' ' : ''}(${p.year ?? 'n.d.'}). ${p.title}.`
  if (p.venue) {
    s += ` *${p.venue}*`
    if (p.volume) s += `, *${p.volume}*`
    if (p.issue) s += `(${p.issue})`
    if (p.pages) s += `, ${pagesDash(p.pages)}`
    s += '.'
  }
  if (p.doi) s += ` ${doiUrl(p.doi)}`
  else if (p.url) s += ` ${p.url}`
  return s
}

function mla(p: P): string {
  const ns = p.authors.map(splitName)
  const first = ns[0] ? (ns[0].first ? `${ns[0].last}, ${ns[0].first}` : ns[0].last) : ''
  const au = ns.length === 0 ? '' : ns.length === 1 ? `${first}.` : ns.length === 2 ? `${first}, and ${[ns[1].first, ns[1].last].filter(Boolean).join(' ')}.` : `${first}, et al.`
  let s = `${au}${au ? ' ' : ''}“${p.title}.”`
  if (p.venue) s += ` *${p.venue}*,`
  if (p.volume) s += ` vol. ${p.volume},`
  if (p.issue) s += ` no. ${p.issue},`
  if (p.year) s += ` ${p.year},`
  if (p.pages) s += ` pp. ${pagesDash(p.pages)},`
  s = s.replace(/,$/, '.')
  if (p.doi) s += ` https://doi.org/${p.doi}.`
  return s
}

function ieee(p: P): string {
  const ns = p.authors.map(splitName).map((n) => (n.first ? `${initials(n.first)} ${n.last}` : n.last))
  const au = ns.length > 6 ? `${ns[0]} et al.` : ns.length <= 2 ? ns.join(' and ') : `${ns.slice(0, -1).join(', ')}, and ${ns[ns.length - 1]}`
  let s = `${au}${au ? ', ' : ''}“${p.title},”`
  if (p.venue) s += ` *${p.venue}*,`
  if (p.volume) s += ` vol. ${p.volume},`
  if (p.issue) s += ` no. ${p.issue},`
  if (p.pages) s += ` pp. ${pagesDash(p.pages)},`
  if (p.year) s += ` ${p.year}`
  s = s.replace(/,$/, '')
  if (p.doi) s += `, doi: ${p.doi}`
  return s + '.'
}

function gbt(p: P): string {
  const ns = p.authors.map(splitName).map((n) => (n.first ? `${n.last.toUpperCase()} ${initials(n.first, false)}` : n.last))
  const au = ns.length > 3 ? `${ns.slice(0, 3).join(', ')}, et al` : ns.join(', ')
  const type = p.venue ? (/arxiv/i.test(p.venue) ? 'EB/OL' : /conference|proceedings|symposium|workshop/i.test(p.venue) ? 'C' : 'J') : 'J'
  let s = `${au}${au ? '. ' : ''}${p.title}[${type}].`
  if (p.venue) s += ` ${p.venue},`
  if (p.year) s += ` ${p.year}`
  if (p.volume) s += `, ${p.volume}`
  if (p.issue) s += `(${p.issue})`
  if (p.pages) s += `: ${p.pages.replace(/\s*[–—]+\s*/, '-')}`
  s = s.replace(/,$/, '') + '.'
  if (p.doi) s += ` DOI: ${p.doi}.`
  return s
}

export function bibKey(p: P): string {
  const last = p.authors[0] ? splitName(p.authors[0]).last.replace(/[^A-Za-z]/g, '').toLowerCase() : 'anon'
  const word = (p.title.match(/[A-Za-z]{4,}/)?.[0] ?? 'paper').toLowerCase()
  return `${last}${p.year ?? ''}${word}`
}

const bibEsc = (s: string): string => s.replace(/([&%$#_{}])/g, '\\$1')

function bibtex(p: P): string {
  const fields: [string, string | null | undefined][] = [
    ['title', `{${bibEsc(p.title)}}`],
    ['author', p.authors.map((a) => { const n = splitName(a); return n.first ? `${n.last}, ${n.first}` : n.last }).join(' and ')],
    ['journal', p.venue],
    ['year', p.year ? String(p.year) : null],
    ['volume', p.volume],
    ['number', p.issue],
    ['pages', p.pages?.replace(/\s*[–—-]+\s*/, '--')],
    ['publisher', p.publisher],
    ['doi', p.doi],
    ['eprint', p.arxiv],
    ['url', p.url]
  ]
  const type = p.arxiv && !p.doi ? 'misc' : 'article'
  return `@${type}{${bibKey(p)},\n${fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${k === 'title' ? v : bibEsc(String(v))}}`)
    .join(',\n')}\n}`
}

function ris(p: P): string {
  const lines = ['TY  - JOUR', `TI  - ${p.title}`, ...p.authors.map((a) => `AU  - ${a}`)]
  if (p.venue) lines.push(`JO  - ${p.venue}`)
  if (p.year) lines.push(`PY  - ${p.year}`)
  if (p.volume) lines.push(`VL  - ${p.volume}`)
  if (p.issue) lines.push(`IS  - ${p.issue}`)
  if (p.pages) {
    const [sp, ep] = p.pages.split(/\s*[–—-]+\s*/)
    lines.push(`SP  - ${sp}`)
    if (ep) lines.push(`EP  - ${ep}`)
  }
  if (p.doi) lines.push(`DO  - ${p.doi}`)
  if (p.url) lines.push(`UR  - ${p.url}`)
  lines.push('ER  - ')
  return lines.join('\n')
}

export function formatCitation(p: P, style: CiteStyle): string {
  switch (style) {
    case 'apa':
      return apa(p)
    case 'mla':
      return mla(p)
    case 'ieee':
      return ieee(p)
    case 'gbt':
      return gbt(p)
    case 'bibtex':
      return bibtex(p)
    case 'ris':
      return ris(p)
  }
}

// 纯文本（复制到剪贴板时去掉 Markdown 的斜体星号）
export function citationText(p: P, style: CiteStyle): string {
  return formatCitation(p, style).replace(/\*([^*]+)\*/g, '$1')
}
