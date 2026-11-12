// 从网址导入：arXiv 号或链接、DOI、PDF 直链、论文网页（找 citation_pdf_url）。
// 先把 PDF 地址和元数据解析出来，再下载到临时文件走普通导入。找不到开放获取的 PDF 时返回 noPdf，界面可以存成「仅链接」。
import { createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { arxivMeta, crossref, findArxiv, findDoi, oaByDoi, type MetaPatch } from './meta'
import { t } from '../shared/i18n'

export interface Resolved {
  pdfUrl: string | null
  meta: MetaPatch
  landing: string | null // 找不到 PDF 时给用户打开的网页
}

const MAX_BYTES = 300 * 1024 * 1024

export function parseInput(input: string): { kind: 'arxiv' | 'doi' | 'url'; value: string } | null {
  const s = input.trim()
  if (!s) return null
  const ax = /^(?:arxiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i.exec(s)?.[1] ?? (/arxiv\.org/i.test(s) ? findArxiv(s) : null)
  if (ax) return { kind: 'arxiv', value: ax }
  const doi = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i.exec(s)?.[1]
  if (doi) return { kind: 'doi', value: decodeURIComponent(doi) }
  if (/^https?:\/\//i.test(s)) return { kind: 'url', value: s }
  return null
}

// 论文网页里的 <meta name="citation_pdf_url">、citation_title、citation_doi 等（Google Scholar 规范，期刊网站基本都有）
export function citationMeta(html: string, base: string): { pdfUrl: string | null; meta: MetaPatch } {
  const metas = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => m[0])
  const get = (name: string): string[] =>
    metas
      .filter((m) => new RegExp(`(?:name|property)\\s*=\\s*["']${name}["']`, 'i').test(m))
      .map((m) => /content\s*=\s*["']([^"']*)["']/i.exec(m)?.[1] ?? '')
      .filter(Boolean)
  const abs = (u: string): string => {
    try {
      return new URL(u, base).toString()
    } catch {
      return u
    }
  }
  const pdf = get('citation_pdf_url')[0]
  const date = get('citation_publication_date')[0] ?? get('citation_date')[0] ?? ''
  return {
    pdfUrl: pdf ? abs(pdf) : null,
    meta: {
      title: get('citation_title')[0],
      authors: get('citation_author'),
      doi: get('citation_doi')[0] ?? null,
      venue: get('citation_journal_title')[0] ?? get('citation_conference_title')[0] ?? null,
      year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
      abstract: get('citation_abstract')[0] ?? get('description')[0] ?? null,
      url: base
    }
  }
}

export async function resolve(input: string): Promise<Resolved> {
  const p = parseInput(input)
  if (!p) throw new Error(t('认不出这个地址：支持 arXiv 号或链接、DOI、PDF 链接和论文网页'))
  if (p.kind === 'arxiv') {
    const m = await arxivMeta(p.value).catch(() => null)
    return { pdfUrl: `https://arxiv.org/pdf/${p.value}`, meta: m ?? { arxiv: p.value }, landing: `https://arxiv.org/abs/${p.value}` }
  }
  if (p.kind === 'doi') {
    const [cr, oa] = await Promise.all([crossref(p.value).catch(() => ({ doi: p.value }) as MetaPatch), oaByDoi(p.value).catch(() => null)])
    const meta: MetaPatch = { ...cr, abstract: cr.abstract || oa?.abstract || null, arxiv: oa?.arxiv ?? null }
    return { pdfUrl: oa?.pdfUrl ?? null, meta, landing: cr.url ?? `https://doi.org/${p.value}` }
  }
  // 普通网址：先看是不是直接给 PDF
  const ctl = new AbortController()
  const t_ = setTimeout(() => ctl.abort(), 20_000)
  try {
    const res = await fetch(p.value, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 ParaRead' }, redirect: 'follow' })
    const type = res.headers.get('content-type') ?? ''
    if (/application\/pdf/i.test(type) || /\.pdf(\?|$)/i.test(res.url)) {
      void res.body?.cancel()
      const doi = findDoi(p.value)
      return { pdfUrl: res.url, meta: doi ? await crossref(doi).catch(() => ({ doi })) : {}, landing: p.value }
    }
    const html = (await res.text()).slice(0, 2_000_000)
    const c = citationMeta(html, res.url)
    const doi = c.meta.doi ?? findDoi(p.value)
    if (!c.pdfUrl && doi) {
      const oa = await oaByDoi(doi).catch(() => null)
      if (oa?.pdfUrl) c.pdfUrl = oa.pdfUrl
    }
    return { pdfUrl: c.pdfUrl, meta: { ...c.meta, doi }, landing: res.url }
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(t('打开网页超时（20 秒）'))
    throw e
  } finally {
    clearTimeout(t_)
  }
}

// 下载 PDF 到临时文件：最长 2 分钟，最大 300 MB，开头必须是 %PDF-
export async function download(url: string, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  const ctl = new AbortController()
  const t_ = setTimeout(() => ctl.abort(), 120_000)
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 ParaRead', Accept: 'application/pdf,*/*' }, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(t('下载失败：{0} 返回 {1}', new URL(url).host, res.status))
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) throw new Error(t('文件太大（超过 300 MB）'))
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file))
    if (statSync(file).size > MAX_BYTES) throw new Error(t('文件太大（超过 300 MB）'))
    return file
  } catch (e) {
    rmSync(file, { force: true })
    if (ctl.signal.aborted) throw new Error(t('下载超时（2 分钟）'))
    throw e
  } finally {
    clearTimeout(t_)
  }
}

