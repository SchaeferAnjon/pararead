import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { chunkMarkdown, markdownForContext } from '../shared/chunk'
import type { Paper, ReflowDoc, Tier } from '../shared/types'
import { getPaper, setReflow, updatePaper, type DB, type PaperPatch } from './db'
import { readEpub } from './epub'
import { lookupMeta, type MetaPatch } from './meta'
import type { Ai } from './ai'
import { parseJsonLoose } from './glm'
import { extractPdf, guessMetadata, pageToText, simpleReflow } from './pdftext'
import { metadataMessages } from './prompts'
import { t } from '../shared/i18n'

export function newId(): string {
  return randomBytes(6).toString('base64url')
}

export interface LibraryDeps {
  db: DB
  dataDir: string
  ai: Ai
  log: (msg: string) => void
}

export interface ImportExtra {
  title?: string
  authors?: string[]
  tags?: string[]
  doi?: string | null
  createdAt?: number
  lastOpened?: number | null
  source?: Paper['source']
  srId?: string
  fileName?: string
  meta?: MetaPatch
}

export type ImportResult = { status: 'added'; paper: Paper } | { status: 'duplicate'; paper: Paper } | { status: 'failed'; file: string; error: string }

export class Library {
  constructor(private d: LibraryDeps) {
    mkdirSync(this.papersDir(), { recursive: true })
    mkdirSync(join(d.dataDir, 'reflow'), { recursive: true })
  }

  papersDir(): string {
    return join(this.d.dataDir, 'papers')
  }

  pdfPath(id: string): string {
    return join(this.papersDir(), `${id}.pdf`)
  }

  reflowPath(id: string, tier: Tier): string {
    return join(this.d.dataDir, 'reflow', id, `${tier}.md`)
  }

  async importFile(file: string, extra: ImportExtra = {}): Promise<ImportResult> {
    const { db } = this.d
    let data: Buffer
    try {
      data = readFileSync(file)
    } catch (e) {
      return { status: 'failed', file, error: t('读不了文件：{0}', (e as Error).message) }
    }
    if (data.subarray(0, 2).toString('latin1') === 'PK' && /\.epub$/i.test(file)) return this.importEpub(file, data, extra)
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') return { status: 'failed', file, error: t('不是 PDF 或 EPUB 文件') }
    const hash = createHash('sha256').update(data).digest('hex')
    const dup = db.prepare('SELECT id, deleted FROM papers WHERE file_hash = ?').get(hash) as { id: string; deleted: number } | undefined
    if (dup) {
      if (dup.deleted) db.prepare('UPDATE papers SET deleted = 0 WHERE id = ?').run(dup.id)
      if (extra.srId) db.prepare('UPDATE papers SET scholaread_id = COALESCE(scholaread_id, ?) WHERE id = ?').run(extra.srId, dup.id)
      return { status: 'duplicate', paper: getPaper(db, dup.id)! }
    }

    let ext
    try {
      ext = await extractPdf(new Uint8Array(data))
    } catch (e) {
      return { status: 'failed', file, error: t('PDF 解析失败：{0}', (e as Error).message) }
    }
    const guess = guessMetadata(ext.info, ext.pages[0])
    let title = extra.title || guess.title
    let authors = extra.authors?.length ? extra.authors : guess.authors
    let year = guess.year
    // 标题或作者取不到时让 GLM 从第一页文字里抽
    if ((!title || !authors.length) && this.d.ai.ready()) {
      try {
        const out = await this.d.ai.once(metadataMessages(ext.pages[0] ? pageToText(ext.pages[0]) : ''), { json: true, timeoutMs: 45_000 })
        const j = parseJsonLoose<{ title?: string; authors?: string[]; year?: number | null }>(out)
        if (!title && j.title) title = j.title.trim()
        if (!authors.length && Array.isArray(j.authors)) authors = j.authors.map((a) => String(a).trim()).filter(Boolean)
        if (!year && typeof j.year === 'number') year = j.year
      } catch (e) {
        this.d.log(`AI 抽取元数据失败：${(e as Error).message}`)
      }
    }
    if (!title) title = basename(file).replace(/\.pdf$/i, '').replace(/[_]+/g, ' ')

    const id = newId()
    copyFileSync(file, this.pdfPath(id))
    const now = Date.now()
    const insert = db.transaction(() => {
      db.prepare(
        `INSERT INTO papers (id, title, authors, year, tags, file_name, file_hash, page_count, created_at, last_opened, doi, source, scholaread_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        title,
        JSON.stringify(authors),
        year,
        JSON.stringify(extra.tags ?? []),
        extra.fileName ?? basename(file),
        hash,
        ext.pageCount,
        extra.createdAt ?? now,
        extra.lastOpened ?? null,
        extra.doi ?? null,
        extra.source ?? 'import',
        extra.srId ?? null
      )
      const ins = db.prepare('INSERT INTO page_text (paper_id, page, text) VALUES (?, ?, ?)')
      ext.pages.forEach((p, i) => ins.run(id, i + 1, pageToText(p)))
    })
    insert()
    if (extra.meta) this.applyMeta(id, extra.meta, false)
    return { status: 'added', paper: getPaper(db, id)! }
  }

  // EPUB：转成 Markdown 存为「简单重排」，没有原文模式；按 3000 字切成「页」给搜索和 AI 用
  private importEpub(file: string, data: Buffer, extra: ImportExtra): ImportResult {
    const { db } = this.d
    const hash = createHash('sha256').update(data).digest('hex')
    const dup = db.prepare('SELECT id, deleted FROM papers WHERE file_hash = ?').get(hash) as { id: string; deleted: number } | undefined
    if (dup) {
      if (dup.deleted) db.prepare('UPDATE papers SET deleted = 0 WHERE id = ?').run(dup.id)
      return { status: 'duplicate', paper: getPaper(db, dup.id)! }
    }
    let book
    try {
      book = readEpub(new Uint8Array(data))
    } catch (e) {
      return { status: 'failed', file, error: (e as Error).message }
    }
    const id = newId()
    copyFileSync(file, this.epubPath(id))
    mkdirSync(join(this.d.dataDir, 'reflow', id), { recursive: true })
    writeFileSync(this.reflowPath(id, 'simple'), book.md)
    if (book.cover) {
      mkdirSync(join(this.d.dataDir, 'thumbs'), { recursive: true })
      writeFileSync(join(this.d.dataDir, 'thumbs', `${id}.jpg`), book.cover.data)
    }
    const plain = markdownForContext(book.md, Number.MAX_SAFE_INTEGER).text
    const pages: string[] = []
    for (let i = 0; i < plain.length; i += 3000) pages.push(plain.slice(i, i + 3000))
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO papers (id, title, authors, year, tags, file_name, file_hash, page_count, created_at, source, kind, abstract) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 'epub', ?)`
      ).run(id, extra.title || book.title, JSON.stringify(extra.authors?.length ? extra.authors : book.authors), book.year, extra.fileName ?? basename(file), hash, pages.length, extra.createdAt ?? Date.now(), extra.source ?? 'import', book.description)
      const ins = db.prepare('INSERT INTO page_text (paper_id, page, text) VALUES (?, ?, ?)')
      pages.forEach((t_, i) => ins.run(id, i + 1, t_))
    })
    tx()
    setReflow(db, id, 'simple', 'done')
    if (extra.meta) this.applyMeta(id, extra.meta, false)
    return { status: 'added', paper: getPaper(db, id)! }
  }

  epubPath(id: string): string {
    return join(this.papersDir(), `${id}.epub`)
  }

  // 元数据填进论文：只填空着的字段，force 时覆盖
  applyMeta(id: string, m: MetaPatch, force: boolean): void {
    const p = getPaper(this.d.db, id)
    if (!p) return
    const patch: PaperPatch = {}
    const keys = ['doi', 'venue', 'abstract', 'url', 'publisher', 'volume', 'issue', 'pages', 'published', 'arxiv'] as const
    for (const k of keys) if (m[k] && (force || !p[k])) patch[k] = m[k]
    if (m.year && (force || !p.year)) patch.year = m.year
    if (m.authors?.length && (force || !p.authors.length)) patch.authors = m.authors
    updatePaper(this.d.db, id, patch)
  }

  // 只有链接、还没有全文的论文（全网检索里没有开放获取 PDF 的）：之后可以「关联 PDF」
  addLink(m: MetaPatch & { title: string }, source: Paper['source'] = 'search'): ImportResult {
    const { db } = this.d
    const key = `link:${(m.doi ?? m.arxiv ?? m.url ?? m.title).toLowerCase()}`
    const dup = db.prepare('SELECT id, deleted FROM papers WHERE file_hash = ?').get(key) as { id: string; deleted: number } | undefined
    if (dup) {
      if (dup.deleted) db.prepare('UPDATE papers SET deleted = 0 WHERE id = ?').run(dup.id)
      return { status: 'duplicate', paper: getPaper(db, dup.id)! }
    }
    const id = newId()
    db.prepare(
      `INSERT INTO papers (id, title, authors, year, tags, file_name, file_hash, page_count, created_at, doi, source, kind) VALUES (?, ?, ?, ?, '[]', '', ?, 0, ?, ?, ?, 'link')`
    ).run(id, m.title, JSON.stringify(m.authors ?? []), m.year ?? null, key, Date.now(), m.doi ?? null, source)
    this.applyMeta(id, m, false)
    return { status: 'added', paper: getPaper(db, id)! }
  }

  // 给「仅链接」的论文补上 PDF：拷进库、抽文字，之后照常重排
  async attachPdf(id: string, file: string): Promise<void> {
    const { db } = this.d
    const data = readFileSync(file)
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(t('不是 PDF 文件'))
    const hash = createHash('sha256').update(data).digest('hex')
    const other = db.prepare('SELECT id FROM papers WHERE file_hash = ? AND id != ?').get(hash, id) as { id: string } | undefined
    if (other) throw new Error(t('这个 PDF 已经在库里了'))
    const ext = await extractPdf(new Uint8Array(data))
    copyFileSync(file, this.pdfPath(id))
    const tx = db.transaction(() => {
      db.prepare("UPDATE papers SET kind = 'pdf', file_hash = ?, file_name = ?, page_count = ? WHERE id = ?").run(hash, basename(file), ext.pageCount, id)
      db.prepare('DELETE FROM page_text WHERE paper_id = ?').run(id)
      const ins = db.prepare('INSERT INTO page_text (paper_id, page, text) VALUES (?, ?, ?)')
      ext.pages.forEach((p, i) => ins.run(id, i + 1, pageToText(p)))
    })
    tx()
  }

  // 导入后到 Crossref / arXiv / OpenAlex 补期刊、日期、摘要；只填空着的字段，force 时（「重新获取」）覆盖
  async enrich(id: string, force = false): Promise<void> {
    const p = getPaper(this.d.db, id)
    if (!p) return
    const first = this.pageTexts(id).slice(0, 2).join('\n')
    let m
    try {
      m = await lookupMeta({ title: p.title, firstPage: first, info: { doi: p.doi ?? '', arxiv: p.arxiv ? `arXiv:${p.arxiv}` : '' } })
    } catch (e) {
      this.d.log(`补元数据失败 ${id}：${(e as Error).message}`)
      if (force) throw e
      return
    }
    this.applyMeta(id, m, force)
  }

  // 影印版：几乎没有文字层（每页不到 40 个字）
  isScanned(id: string): boolean {
    const pages = this.pageTexts(id)
    if (!pages.length) return false
    const chars = pages.reduce((n, t_) => n + t_.replace(/\s+/g, '').length, 0)
    return chars / pages.length < 40
  }

  pageTexts(id: string): string[] {
    const rows = this.d.db.prepare('SELECT text FROM page_text WHERE paper_id = ? ORDER BY page').all(id) as { text: string }[]
    return rows.map((r) => r.text)
  }

  // 用户手动选了档位（且那档有结果）就用它；否则 调整过的 > 精细 > 快速 > 简单
  bestTier(id: string): Tier | null {
    const want = getPaper(this.d.db, id)?.engine
    const order: Tier[] = ['edited', 'basic', 'flash', 'simple']
    if (want) order.unshift(want)
    for (const t_ of order) {
      const r = this.d.db.prepare("SELECT 1 FROM reflow WHERE paper_id = ? AND tier = ? AND status = 'done'").get(id, t_)
      if (r && existsSync(this.reflowPath(id, t_))) return t_
    }
    return null
  }

  hasTier(id: string, t_: Tier): boolean {
    return !!this.d.db.prepare("SELECT 1 FROM reflow WHERE paper_id = ? AND tier = ? AND status = 'done'").get(id, t_) && existsSync(this.reflowPath(id, t_))
  }

  private docCache = new Map<string, ReflowDoc>()

  reflowDoc(id: string): ReflowDoc | null {
    const tier = this.bestTier(id)
    if (!tier) return null
    const key = `${id}:${tier}`
    const hit = this.docCache.get(key)
    if (hit) return hit
    const md = readFileSync(this.reflowPath(id, tier), 'utf8')
    const doc: ReflowDoc = { paperId: id, tier, blocks: chunkMarkdown(md) }
    if (this.docCache.size > 4) this.docCache.delete(this.docCache.keys().next().value!)
    this.docCache.set(key, doc)
    return doc
  }

  // AI 用的全文：重排后的 Markdown，没有就用 pdf.js 抽的文字
  contextText(id: string, limit = 60000): { text: string; truncated: boolean; ratio: number } {
    const tier = this.bestTier(id)
    if (tier) return markdownForContext(readFileSync(this.reflowPath(id, tier), 'utf8'), limit)
    const pages = this.pageTexts(id)
    return markdownForContext(pages.map((t_, i) => `[第 ${i + 1} 页]\n${t_}`).join('\n\n'), limit)
  }

  async runSimpleReflow(id: string): Promise<void> {
    const p = getPaper(this.d.db, id)
    if (!p) throw new Error(t('论文不存在'))
    setReflow(this.d.db, id, 'simple', 'running')
    try {
      const ext = await extractPdf(new Uint8Array(readFileSync(this.pdfPath(id))))
      const md = simpleReflow(ext.pages, p.title)
      mkdirSync(join(this.d.dataDir, 'reflow', id), { recursive: true })
      writeFileSync(this.reflowPath(id, 'simple'), md)
      setReflow(this.d.db, id, 'simple', 'done')
    } catch (e) {
      setReflow(this.d.db, id, 'simple', 'failed', { error: (e as Error).message })
      throw e
    }
  }

  // 在每页文字里找一段原文所在的页（Scholaread 导入的标注用）
  locatePage(id: string, text: string, hint: number | null): number | null {
    const pages = this.pageTexts(id)
    const sq = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
    const needle = sq(text).slice(0, 40)
    if (needle.length >= 6) {
      const order = hint ? [hint, ...pages.map((_, i) => i + 1).filter((p) => p !== hint)] : pages.map((_, i) => i + 1)
      for (const p of order) if (pages[p - 1] && sq(pages[p - 1]).includes(needle)) return p
    }
    return hint
  }
}
