import { t } from '../shared/i18n'
// 论文元数据：从 PDF 文字里找 DOI 和 arXiv 号，到 Crossref、arXiv、Semantic Scholar 查期刊、日期、摘要。
// 全网检索（文献库「全网搜索」、找论文、写综述）也用这里的 Semantic Scholar 和 arXiv 接口。都是公开接口，不要 Key。

export interface MetaPatch {
  title?: string
  authors?: string[]
  year?: number | null
  doi?: string | null
  venue?: string | null
  abstract?: string | null
  url?: string | null
  publisher?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  published?: string | null
  arxiv?: string | null
}

export interface SearchHit {
  id: string // Semantic Scholar paperId 或 arxiv:xxxx
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  doi: string | null
  arxiv: string | null
  pdfUrl: string | null // 开放获取的 PDF，能直接下载导入
  url: string | null
  citations: number | null
  tldr: string | null
}

const UA = 'ParaRead/0.2 (desktop paper reader)'

export async function getJson<T>(url: string, timeoutMs = 15_000, headers: Record<string, string> = {}): Promise<T> {
  const ctl = new AbortController()
  const t_ = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctl.signal })
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
    return (await res.json()) as T
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(t('{0} 超时', new URL(url).host))
    throw e
  } finally {
    clearTimeout(t_)
  }
}

export async function getText(url: string, timeoutMs = 15_000): Promise<string> {
  const ctl = new AbortController()
  const t_ = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal })
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
    return await res.text()
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(t('{0} 超时', new URL(url).host))
    throw e
  } finally {
    clearTimeout(t_)
  }
}

// DOI 和 arXiv 号：第一页文字、PDF 元数据、网址里都可能有
export function findDoi(text: string): string | null {
  const m = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+[A-Za-z0-9])/.exec(text)
  return m ? m[1].replace(/[.)]+$/, '') : null
}

export function findArxiv(text: string): string | null {
  const m = /arXiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?/i.exec(text) ?? /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i.exec(text)
  return m ? m[1] : null
}

// 第一页文字里的摘要：Abstract 之后，到 Index Terms / Keywords / 引言标题之前
export function abstractFromText(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ')
  const m = /\b(?:Abstract|ABSTRACT)\b[\s.:—–-]*(.{80,3000}?)(?=\s(?:Index Terms|Keywords|KEYWORDS|Key words|CCS Concepts|(?:1|I)\.?\s+I(?:NTRODUCTION|ntroduction))\b|$)/.exec(flat)
  if (!m) return null
  return m[1].trim().replace(/^[-—–:.\s]+/, '')
}

interface CrossrefWork {
  title?: string[]
  author?: { given?: string; family?: string; name?: string }[]
  'container-title'?: string[]
  publisher?: string
  volume?: string
  issue?: string
  page?: string
  abstract?: string
  URL?: string
  DOI?: string
  issued?: { 'date-parts'?: number[][] }
  published?: { 'date-parts'?: number[][] }
}

export function parseCrossref(w: CrossrefWork): MetaPatch {
  const dp = (w.published ?? w.issued)?.['date-parts']?.[0]
  return {
    title: w.title?.[0],
    authors: (w.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
    year: dp?.[0] ?? null,
    published: dp ? dp.map((n, i) => (i ? String(n).padStart(2, '0') : String(n))).join('-') : null,
    venue: w['container-title']?.[0] ?? null,
    publisher: w.publisher ?? null,
    volume: w.volume ?? null,
    issue: w.issue ?? null,
    pages: w.page ?? null,
    abstract: w.abstract ? stripTags(w.abstract).replace(/^Abstract\s*/i, '') : null,
    url: w.URL ?? null,
    doi: w.DOI ?? null
  }
}

export async function crossref(doi: string): Promise<MetaPatch> {
  const j = await getJson<{ message: CrossrefWork }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
  return parseCrossref(j.message)
}

// arXiv 的 Atom：不引 XML 库，几个字段用正则取
export function parseArxivAtom(xml: string): (MetaPatch & { pdfUrl: string })[] {
  const out: (MetaPatch & { pdfUrl: string })[] = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const tag = (n: string): string | null => {
      const m = new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`).exec(entry)
      return m ? decodeXml(m[1]).replace(/\s+/g, ' ').trim() : null
    }
    const id = tag('id') ?? ''
    const ax = /abs\/([^v<\s]+)/.exec(id)?.[1] ?? null
    const published = tag('published')?.slice(0, 10) ?? null
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => decodeXml(m[1]).trim())
    const doi = /<arxiv:doi[^>]*>([^<]+)</.exec(entry)?.[1] ?? null
    const venue = /<arxiv:journal_ref[^>]*>([^<]+)</.exec(entry)?.[1] ?? null
    out.push({
      title: tag('title') ?? undefined,
      authors,
      abstract: tag('summary'),
      published,
      year: published ? Number(published.slice(0, 4)) : null,
      arxiv: ax,
      doi,
      venue: venue ?? 'arXiv',
      url: ax ? `https://arxiv.org/abs/${ax}` : null,
      pdfUrl: ax ? `https://arxiv.org/pdf/${ax}` : ''
    })
  }
  return out
}

export async function arxivMeta(id: string): Promise<(MetaPatch & { pdfUrl: string }) | null> {
  const xml = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`)
  return parseArxivAtom(xml)[0] ?? null
}

export async function arxivSearch(q: string, limit = 10): Promise<SearchHit[]> {
  const xml = await getText(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${q}`)}&start=0&max_results=${limit}&sortBy=relevance`)
  return parseArxivAtom(xml).map((m) => ({
    id: `arxiv:${m.arxiv}`,
    title: m.title ?? '',
    authors: m.authors ?? [],
    year: m.year ?? null,
    venue: m.venue ?? 'arXiv',
    abstract: m.abstract ?? null,
    doi: m.doi ?? null,
    arxiv: m.arxiv ?? null,
    pdfUrl: m.pdfUrl || null,
    url: m.url ?? null,
    citations: null,
    tldr: null
  }))
}

interface S2Paper {
  paperId: string
  title: string
  year?: number | null
  venue?: string | null
  abstract?: string | null
  authors?: { name: string }[]
  externalIds?: { DOI?: string; ArXiv?: string } | null
  openAccessPdf?: { url?: string | null } | null
  url?: string | null
  citationCount?: number | null
  tldr?: { text?: string } | null
  publicationDate?: string | null
  journal?: { name?: string; volume?: string; pages?: string } | null
}

const S2_FIELDS = 'title,year,venue,abstract,authors,externalIds,openAccessPdf,url,citationCount,tldr,publicationDate,journal'

export function s2Hit(p: S2Paper): SearchHit {
  const ax = p.externalIds?.ArXiv ?? null
  return {
    id: p.paperId,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year ?? null,
    venue: p.journal?.name || p.venue || null,
    abstract: p.abstract ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxiv: ax,
    pdfUrl: p.openAccessPdf?.url || (ax ? `https://arxiv.org/pdf/${ax}` : null),
    url: p.url ?? null,
    citations: p.citationCount ?? null,
    tldr: p.tldr?.text ?? null
  }
}

export async function s2Search(q: string, limit = 10, opts: { yearFrom?: number } = {}): Promise<SearchHit[]> {
  const year = opts.yearFrom ? `&year=${opts.yearFrom}-` : ''
  const j = await getJson<{ data?: S2Paper[] }>(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${limit}&fields=${S2_FIELDS}${year}`
  )
  return (j.data ?? []).map(s2Hit)
}

export async function s2Match(title: string): Promise<SearchHit | null> {
  try {
    const j = await getJson<{ data?: S2Paper[] }>(`https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(title)}&fields=${S2_FIELDS}`)
    return j.data?.[0] ? s2Hit(j.data[0]) : null
  } catch (e) {
    // 404 是没匹配到
    if (/ 404$/.test((e as Error).message)) return null
    throw e
  }
}

export async function s2ByDoi(doi: string): Promise<SearchHit | null> {
  try {
    return s2Hit(await getJson<S2Paper>(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=${S2_FIELDS}`))
  } catch (e) {
    if (/ 404$/.test((e as Error).message)) return null
    throw e
  }
}

// OpenAlex：不要 Key、限额宽（Semantic Scholar 不带 Key 时常 429），有摘要、引用数、开放获取 PDF
interface OaWork {
  id: string
  title?: string | null
  display_name?: string | null
  publication_year?: number | null
  publication_date?: string | null
  doi?: string | null
  cited_by_count?: number | null
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null
  primary_location?: { source?: { display_name?: string | null; host_organization_name?: string | null } | null; landing_page_url?: string | null } | null
  authorships?: { author?: { display_name?: string } }[]
  abstract_inverted_index?: Record<string, number[]> | null
  ids?: { arxiv?: string } | null
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null
}

const OA_SELECT = 'id,title,display_name,publication_year,publication_date,doi,cited_by_count,best_oa_location,primary_location,authorships,abstract_inverted_index,ids,biblio'

export function oaAbstract(inv: Record<string, number[]> | null | undefined): string | null {
  if (!inv) return null
  const words: string[] = []
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w
  const t_ = words.filter(Boolean).join(' ').trim()
  return t_ || null
}

export function oaHit(w: OaWork): SearchHit {
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : null
  const ax = findArxiv(`${w.ids?.arxiv ?? ''} ${w.best_oa_location?.landing_page_url ?? ''}`)
  return {
    id: w.id,
    title: w.title ?? w.display_name ?? '',
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    abstract: oaAbstract(w.abstract_inverted_index),
    doi,
    arxiv: ax,
    pdfUrl: w.best_oa_location?.pdf_url || (ax ? `https://arxiv.org/pdf/${ax}` : null),
    url: w.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : null),
    citations: w.cited_by_count ?? null,
    tldr: null
  }
}

export async function oaSearch(q: string, limit = 10, opts: { yearFrom?: number } = {}): Promise<SearchHit[]> {
  const filter = opts.yearFrom ? `&filter=from_publication_date:${opts.yearFrom}-01-01` : ''
  const j = await getJson<{ results?: OaWork[] }>(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${limit}&select=${OA_SELECT}${filter}`)
  return (j.results ?? []).map(oaHit).filter((h) => h.title)
}

export async function oaByDoi(doi: string): Promise<SearchHit | null> {
  try {
    return oaHit(await getJson<OaWork>(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=${OA_SELECT}`))
  } catch (e) {
    if (/ 404$/.test((e as Error).message)) return null
    throw e
  }
}

// 全网检索：OpenAlex 为主，出错时 Semantic Scholar，再不行 arXiv
export async function searchWeb(q: string, limit = 10, opts: { yearFrom?: number } = {}): Promise<{ hits: SearchHit[]; source: string; error?: string }> {
  const errors: string[] = []
  for (const [name, fn] of [
    ['OpenAlex', () => oaSearch(q, limit, opts)],
    ['Semantic Scholar', () => s2Search(q, limit, opts)],
    ['arXiv', () => arxivSearch(q, limit)]
  ] as [string, () => Promise<SearchHit[]>][]) {
    try {
      const hits = await fn()
      if (hits.length) return { hits, source: name, error: errors.join('；') || undefined }
    } catch (e) {
      errors.push(`${name}：${(e as Error).message}`)
    }
  }
  return { hits: [], source: '', error: errors.join('；') || undefined }
}

// 导入后补元数据：有 DOI 查 Crossref，有 arXiv 号查 arXiv，都没有按标题去 Semantic Scholar 匹配
export async function lookupMeta(o: { title: string; firstPage: string; info: Record<string, unknown> }): Promise<MetaPatch> {
  const blob = `${o.firstPage}\n${Object.values(o.info).filter((v) => typeof v === 'string').join('\n')}`
  const doi = findDoi(blob)
  const ax = findArxiv(blob)
  let m: MetaPatch = {}
  if (doi) m = await crossref(doi).catch(() => ({ doi }))
  // Crossref 的摘要常缺（IEEE 不给），OpenAlex 有
  if (doi && !m.abstract) m.abstract = (await oaByDoi(doi).catch(() => null))?.abstract ?? null
  else if (ax) m = (await arxivMeta(ax).catch(() => null)) ?? { arxiv: ax }
  else if (o.title.length > 12) {
    const hit = (await oaSearch(o.title, 1).catch(() => []))[0] ?? (await s2Match(o.title).catch(() => null))
    // 标题差太多的不认
    if (hit && squashTitle(hit.title) === squashTitle(o.title))
      m = { doi: hit.doi, arxiv: hit.arxiv, venue: hit.venue, abstract: hit.abstract, year: hit.year, url: hit.url, authors: hit.authors }
  }
  if (ax && !m.arxiv) m.arxiv = ax
  if (!m.abstract) m.abstract = abstractFromText(o.firstPage)
  return m
}

export function squashTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function stripTags(s: string): string {
  return decodeXml(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}
