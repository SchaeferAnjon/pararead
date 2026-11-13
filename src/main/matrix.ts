// 综述对比表：学术 AI 的一种会话（kind = matrix）。表的内容存在这个会话唯一一条消息的 meta.matrix 里。
// 每格由 AI 读这篇论文的全文填，附上原文原句，再到全文里一字不差地找这句在第几页：找不到的标出来，不当成有出处。
// 关系：先在 A 的正文里找提到 B 的句子（按参考文献编号、作者、题目缩写），再让 AI 判断是基于、对比还是指出不足。
// 指标：每篇抽出的数字让 AI 归成几组同一种指标，条件不同的标出来。
// 写一段：勾的格子 → 提纲 → 句子（每句带出处格子和引用的论文，只许引用表里这几篇）→ 查证。
import { dialog, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bibKeys } from '../shared/bib'
import { formatCitation, splitName } from '../shared/cite'
import { cleanOutline, cleanSentences, fillOutline, plainText, ruleCheck, toLatex, wordSegments } from '../shared/draft'
import { t } from '../shared/i18n'
import {
  BASE_COLS,
  cellId,
  findQuote,
  isRel,
  mentions,
  NOTE_COL,
  relCellId,
  splitCell,
  squash,
  titleMarks,
  type Cell,
  type Draft,
  type MatrixCol,
  type MatrixRow,
  type MatrixState,
  type Metric,
  type MetricGroup,
  type NoteItem,
  type Org,
  type Relation,
  type RelKind,
  type SentenceCheck
} from '../shared/matrix'
import type { Paper, Term } from '../shared/types'
import type { BibStatus } from './bibExport'
import type { Ctx } from './ctx'
import { getGlance, getPaper, getPaperCache, listAnnotations, listPapers } from './db'
import { safeFileName } from './exporter'
import { parseJsonLoose } from './glm'
import { newId } from './library'
import type { WordAddin, WordInboxItem } from './wordAddin'

const COL_NAME: Record<string, string> = { q: t('要解决的问题'), m: t('方法'), r: t('主要结果'), l: t('局限') }
const COL_ASK: Record<string, string> = {
  q: '这篇要解决的问题',
  m: '用的方法',
  r: '主要结果（有数字写数字）',
  l: '局限（论文自己承认的，或者从实验设置能看出来的，比如只在 8 位数据上测过）'
}

export const short = (p: Pick<Paper, 'authors' | 'year' | 'title'>): string => {
  const who = p.authors[0] ? splitName(p.authors[0]).last : p.title.split(/\s+/)[0]
  return `${who}${p.year ? ' ' + p.year : ''}`
}
const nameOf = (p: Pick<Paper, 'title'>): string => titleMarks(p.title)[0] ?? p.title

export interface MatrixView {
  sessionId: string
  state: MatrixState
  papers: { id: string; title: string; name: string; short: string; authors: string[]; year: number | null; venue: string | null; kind: Paper['kind'] }[]
  notes: Record<string, NoteItem[]>
  keys: Record<string, string>
  lang: string
}

export function registerMatrix(c: Ctx, o: { word: () => WordAddin; bib: () => BibStatus }): void {
  const { db, ai, library, settings } = c
  const lang = (): string => settings.get().aiLang || settings.get().targetLang
  const live = new Map<string, MatrixState>()

  // —— 存取 ——
  const msgRow = (sid: string): { id: string; meta: string | null } | undefined =>
    db.prepare("SELECT id, meta FROM ai_messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at LIMIT 1").get(sid) as { id: string; meta: string | null } | undefined
  const load = (sid: string): MatrixState => {
    const hit = live.get(sid)
    if (hit) return hit
    const r = msgRow(sid)
    const st = r?.meta ? (JSON.parse(r.meta) as { matrix?: MatrixState }).matrix : undefined
    if (!st) throw new Error(t('这个对比表不在了'))
    live.set(sid, st)
    return st
  }
  const save = (sid: string, st: MatrixState): void => {
    live.set(sid, st)
    const r = msgRow(sid)
    if (r) db.prepare('UPDATE ai_messages SET meta = ? WHERE id = ?').run(JSON.stringify({ matrix: st }), r.id)
    db.prepare('UPDATE ai_sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sid)
    c.broadcast('matrix:changed', { sessionId: sid })
  }
  const paperIds = (sid: string): string[] => load(sid).rows.map((r) => r.paperId)
  const papersOf = (sid: string): Paper[] => paperIds(sid).map((id) => getPaper(db, id)).filter((p): p is Paper => !!p)

  const notesOf = (paperId: string): NoteItem[] =>
    listAnnotations(db, paperId)
      .filter((a) => a.note.trim() || a.label)
      .map((a) => ({ annId: a.id, text: a.text, note: a.note, label: a.label ?? null, page: a.page }))

  const view = (sid: string): MatrixView => {
    const st = load(sid)
    const ps = papersOf(sid)
    const keys = bibKeys(listPapers(db))
    return {
      sessionId: sid,
      state: st,
      papers: ps.map((p) => ({ id: p.id, title: p.title, name: nameOf(p), short: short(p), authors: p.authors, year: p.year, venue: p.venue, kind: p.kind })),
      notes: Object.fromEntries(ps.map((p) => [p.id, notesOf(p.id)])),
      keys: Object.fromEntries(ps.map((p) => [p.id, keys.get(p.id) ?? ''])),
      lang: lang()
    }
  }

  ipcMain.handle('matrix:create', (_e, ids: string[]) => {
    // 按发表年份排：表、关系图都是从早到晚
    const ps = ids
      .map((id) => getPaper(db, id))
      .filter((p): p is Paper => !!p && p.kind !== 'link')
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))
    if (ps.length < 2) throw new Error(t('至少要两篇有全文的论文'))
    const sid = newId()
    const now = Date.now()
    const st: MatrixState = {
      cols: BASE_COLS.map((id) => ({ id, name: COL_NAME[id] })),
      rows: ps.map((p) => ({ paperId: p.id, status: 'queued', cells: {}, metrics: [] })),
      relations: null,
      relStatus: 'none',
      metrics: null,
      metStatus: 'none',
      selected: [],
      draft: null
    }
    db.prepare('INSERT INTO ai_sessions (id, kind, title, paper_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(sid, 'matrix', t('对比表'), JSON.stringify(ps.map((p) => p.id)), now, now)
    db.prepare('INSERT INTO ai_messages (id, session_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), sid, 'assistant', '', JSON.stringify({ matrix: st }), now)
    c.broadcast('research:changed', null)
    void build(sid)
    return sid
  })
  ipcMain.handle('matrix:get', (_e, sid: string) => view(sid))

  // —— 填格子 ——
  const fullText = (id: string, limit: number): { pages: string[]; text: string } => {
    const pages = library.pageTexts(id)
    let text = ''
    for (let i = 0; i < pages.length && text.length < limit; i++) text += `\n\n[第 ${i + 1} 页]\n${pages[i]}`
    return { pages, text: text.slice(0, limit) }
  }
  const hints = (id: string): string => {
    const g = getGlance(db, id)
    const doc = library.reflowDoc(id)
    const major = doc ? (getPaperCache<{ text: string; type: string }[]>(db, id, `major:${doc.tier}:default`) ?? []) : []
    let s = ''
    if (g) s += `之前生成的速览（可以参考，但 quote 必须从全文里抄）：${g.tldr}\n${[...g.question, ...g.method, ...g.findings].map((x) => `- ${typeof x === 'string' ? x : x.text}`).join('\n')}\n`
    if (major.length) s += `AI 标过的重点原句：\n${major.map((m) => `- (${m.type}) ${m.text}`).join('\n')}\n`
    return s
  }
  const toCell = (raw: Record<string, unknown> | undefined, pages: string[]): Cell => {
    const quote = String(raw?.quote ?? '').trim()
    const page = findQuote(pages, quote, Number(raw?.page) || null)
    return { text: String(raw?.text ?? '').trim(), quote, zh: String(raw?.zh ?? '').trim(), page, found: page !== null, inferred: !!raw?.inferred || !quote }
  }

  async function fillRow(sid: string, paperId: string, cols: MatrixCol[], withMetrics: boolean): Promise<void> {
    const p = getPaper(db, paperId)
    if (!p) throw new Error(t('论文不存在'))
    const { pages, text } = fullText(paperId, Math.round(Math.min(ai.ctxChars(), 160000) * 0.7))
    if (text.replace(/\s|\[第 \d+ 页\]/g, '').length < 500) throw new Error(t('这篇没有能读的文字（影印版？）'))
    const out = await ai.once(
      [
        {
          role: 'system',
          content: [
            `你在帮用户做一张文献综述对比表。下面是一篇论文的全文，每页前面标了 [第 N 页]。为下面每一列写一格，用${lang()}写一句话，不超过 50 个字，术语保留英文：`,
            ...cols.map((col) => `- ${col.id}：${col.ask ?? COL_ASK[col.id]}`),
            '每格还要给 quote：全文里支撑这一格的一句原文，必须从全文里一字不差地复制（原文的原句，不改写、不缩短、不拼接两句，不超过 300 个字符）；page 是这句所在的页码；zh 是这句原文的' + lang() + '翻译。',
            'quote 优先从正文里对应的小节找（方法从方法节、结果从实验节、局限从讨论或实验设置），不要四格都抄摘要。',
            '原文没有直接支撑的（多半是局限），quote 写空字符串，inferred 写 true，text 里写清是推断。不要编原文。',
            withMetrics
              ? `再列出论文报告的关键数字，最多 6 个，只要正文或表格里明确写着的：name（英文指标名，带单位类别，比如 "latency (cycles)"）、value（只写数字）、unit、what（测的是什么，${lang()}一句）、cond（条件：位宽、数据集、是否近似等，${lang()}）、quote（含这个数字的原句，一字不差）、page。`
              : '',
            `只输出 JSON：{"cells": {"<列>": {"text": "", "quote": "", "page": 1, "zh": "", "inferred": false}}${withMetrics ? ', "metrics": [{"name": "", "value": 0, "unit": "", "what": "", "cond": "", "quote": "", "page": 1}]' : ''}}`
          ]
            .filter(Boolean)
            .join('\n')
        },
        { role: 'user', content: `论文：《${p.title}》${p.year ? `（${p.year}）` : ''}\n${hints(paperId)}\n全文：${text}` }
      ],
      { json: true, timeoutMs: 240_000 }
    )
    const j = parseJsonLoose<{ cells?: Record<string, Record<string, unknown>>; metrics?: Record<string, unknown>[] }>(out)
    const st = load(sid)
    const row = st.rows.find((r) => r.paperId === paperId)
    if (!row) return
    for (const col of cols) row.cells[col.id] = toCell(j.cells?.[col.id], pages)
    if (withMetrics) {
      row.metrics = (j.metrics ?? [])
        .map((m): Metric | null => {
          const value = Number(m.value)
          if (!Number.isFinite(value) || !m.name) return null
          const quote = String(m.quote ?? '').trim()
          const page = findQuote(pages, quote, Number(m.page) || null)
          // 数字得真的在那句原文里
          const inQuote = squash(quote).includes(squash(String(m.value)).replace(/^0+(?=\d)/, ''))
          return { name: String(m.name), value, unit: String(m.unit ?? ''), what: String(m.what ?? ''), cond: String(m.cond ?? ''), quote, page, found: page !== null && inQuote }
        })
        .filter((m): m is Metric => !!m)
        .slice(0, 6)
    }
    save(sid, st)
  }

  const building = new Set<string>()
  async function build(sid: string): Promise<void> {
    if (building.has(sid)) return
    building.add(sid)
    try {
      // 填的时候又有行点了重试：做完这一轮再看一遍
      for (let todo = load(sid).rows.filter((r) => r.status !== 'done'); todo.length; todo = load(sid).rows.filter((r) => r.status === 'queued')) {
        todo.forEach((r) => ((r.status = 'queued'), delete r.error))
        save(sid, load(sid))
        // 一次读三篇
        const queue = [...todo]
        const worker = async (): Promise<void> => {
          for (let row = queue.shift(); row; row = queue.shift()) {
            row.status = 'running'
            save(sid, load(sid))
            try {
              await fillRow(sid, row.paperId, load(sid).cols, true)
              row.status = 'done'
            } catch (e) {
              row.status = 'failed'
              row.error = (e as Error).message
              c.log(`对比表填格失败 ${row.paperId}：${row.error}`)
            }
            save(sid, load(sid))
          }
        }
        await Promise.all([worker(), worker(), worker()])
      }
      await nameSession(sid)
    } finally {
      building.delete(sid)
    }
  }
  ipcMain.handle('matrix:build', (_e, sid: string) => void build(sid))

  // 表填好以后起个名字（还叫「对比表」的话）
  async function nameSession(sid: string): Promise<void> {
    const r = db.prepare('SELECT title FROM ai_sessions WHERE id = ?').get(sid) as { title: string } | undefined
    if (!r || r.title !== t('对比表')) return
    try {
      const out = await ai.once(
        [
          { role: 'system', content: `给这组论文起一个主题名，用${lang()}，4 到 12 个字，像文件夹名，术语可以保留英文。只输出名字本身。` },
          { role: 'user', content: papersOf(sid).map((p) => p.title).join('\n') }
        ],
        { timeoutMs: 30_000 }
      )
      const name = out.trim().replace(/^["“「《]|["”」》。]$/g, '').slice(0, 40)
      if (name) {
        db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(name, sid)
        c.broadcast('research:changed', null)
        c.broadcast('matrix:changed', { sessionId: sid })
      }
    } catch (e) {
      c.log(`对比表起名失败：${(e as Error).message}`)
    }
  }

  // 加一列：用户写列名（也是要 AI 填什么），每篇都去填
  ipcMain.handle('matrix:addCol', async (_e, sid: string, name: string) => {
    const st = load(sid)
    const n = Math.max(0, ...st.cols.filter((x) => /^c\d+$/.test(x.id)).map((x) => Number(x.id.slice(1)))) + 1
    const col: MatrixCol = { id: `c${n}`, name: name.trim().slice(0, 30), ask: name.trim() }
    st.cols.push(col)
    save(sid, st)
    await Promise.all(
      st.rows.map((r) =>
        fillRow(sid, r.paperId, [col], false).catch((e: Error) => {
          const row = load(sid).rows.find((x) => x.paperId === r.paperId)
          if (row) row.cells[col.id] = { text: t('没填上：{0}', e.message), quote: '', zh: '', page: null, found: false, inferred: true }
          save(sid, load(sid))
        })
      )
    )
    return view(sid)
  })
  ipcMain.handle('matrix:delCol', (_e, sid: string, colId: string) => {
    const st = load(sid)
    st.cols = st.cols.filter((x) => x.id !== colId || !/^c\d+$/.test(x.id))
    for (const r of st.rows) delete r.cells[colId]
    st.selected = st.selected.filter((x) => isRel(x) || splitCell(x).col !== colId)
    save(sid, st)
    return view(sid)
  })
  ipcMain.handle('matrix:retryRow', (_e, sid: string, paperId: string) => {
    const row = load(sid).rows.find((r) => r.paperId === paperId)
    if (row) row.status = 'queued'
    void build(sid)
  })
  ipcMain.handle('matrix:select', (_e, sid: string, ids: string[]) => {
    const st = load(sid)
    st.selected = [...new Set(ids)]
    save(sid, st)
  })

  // —— 关系 ——
  async function relations(sid: string): Promise<void> {
    const st = load(sid)
    st.relStatus = 'running'
    delete st.relError
    save(sid, st)
    try {
      const ps = papersOf(sid)
      const pagesOf = new Map(ps.map((p) => [p.id, library.pageTexts(p.id)]))
      const rowOf = (id: string): MatrixRow => st.rows.find((r) => r.paperId === id)!
      // 后一篇怎么说前一篇（同一年两个方向都看）
      const pairs: { a: Paper; b: Paper; cand: { page: number; text: string }[] }[] = []
      for (const a of ps)
        for (const b of ps) {
          if (a.id === b.id || (a.year ?? 0) < (b.year ?? 0)) continue
          const cand = mentions(pagesOf.get(a.id)!, b)
          if (cand.length) pairs.push({ a, b, cand })
        }
      let rels: Relation[] = []
      if (pairs.length) {
        const out = await ai.once(
          [
            {
              role: 'system',
              content: [
                `用户在做文献综述。下面每一对是论文 A 正文里提到论文 B 的句子。判断 A 和 B 的关系，用${lang()}：`,
                '- base：A 基于或沿用 B（用 B 的方法、门、映射、框架）',
                '- cmp：A 拿 B 做对比（实验对比，或者讲两条不同路线）',
                '- bad：A 指出 B 的不足或局限',
                '- none：只是顺带提到',
                `label 是写在关系图连线上的短语，${lang()}，不超过 10 个字，比如「基于 MAGIC NOR」「对比：都提速」「指出会覆盖输入」。`,
                's 是最能说明这层关系的那句的编号；zh 是那句的翻译；col 是 B 被说到的是哪一格（q 问题、m 方法、r 结果、l 局限）。',
                '只输出 JSON：{"relations": [{"pair": 1, "kind": "base", "label": "", "s": 1, "zh": "", "col": "m"}]}'
              ].join('\n')
            },
            {
              role: 'user',
              content: pairs
                .map(
                  (x, i) =>
                    `[对 ${i + 1}] A =《${x.a.title}》（${x.a.year ?? '?'}），B =《${x.b.title}》（${x.b.year ?? '?'}）\nA 里提到 B 的句子：\n${x.cand.map((s, k) => `(${k + 1}) 第 ${s.page} 页：${s.text}`).join('\n')}\nB 的格子：${BASE_COLS.map((col) => `${col}：${rowOf(x.b.id).cells[col]?.text ?? ''}`).join('；')}`
                )
                .join('\n\n')
            }
          ],
          { json: true, timeoutMs: 180_000 }
        )
        const j = parseJsonLoose<{ relations?: { pair: number; kind: string; label: string; s: number; zh?: string; col?: string }[] }>(out)
        const seen = new Set<string>()
        rels = (j.relations ?? [])
          .map((r): Relation | null => {
            const x = pairs[Number(r.pair) - 1]
            if (!x || !['base', 'cmp', 'bad'].includes(r.kind) || seen.has(x.a.id + x.b.id)) return null
            seen.add(x.a.id + x.b.id)
            const s = x.cand[Number(r.s) - 1] ?? x.cand[0]
            const col = BASE_COLS.includes(r.col as (typeof BASE_COLS)[number]) ? r.col! : 'm'
            const bc = rowOf(x.b.id).cells[col]
            return {
              id: newId(),
              from: x.a.id,
              to: x.b.id,
              kind: r.kind as RelKind,
              label: String(r.label ?? '').slice(0, 24),
              a: { quote: s.text, zh: String(r.zh ?? ''), page: s.page },
              b: { col, quote: bc?.quote ?? '', zh: bc?.zh ?? '', page: bc?.page ?? null }
            }
          })
          .filter((r): r is Relation => !!r)
      }
      const cur = load(sid)
      cur.relations = rels
      cur.relStatus = 'done'
      save(sid, cur)
    } catch (e) {
      const cur = load(sid)
      cur.relStatus = 'failed'
      cur.relError = (e as Error).message
      save(sid, cur)
    }
  }
  ipcMain.handle('matrix:relations', (_e, sid: string) => void relations(sid))

  // —— 指标 ——
  async function metrics(sid: string): Promise<void> {
    const st = load(sid)
    st.metStatus = 'running'
    delete st.metError
    save(sid, st)
    try {
      const ps = papersOf(sid)
      const all = st.rows.flatMap((r, ri) => r.metrics.map((m, mi) => ({ key: `${ri + 1}:${mi + 1}`, row: r, m, p: ps.find((p) => p.id === r.paperId)! })))
      let groups: MetricGroup[] = []
      if (new Set(all.map((x) => x.row.paperId)).size >= 2) {
        const out = await ai.once(
          [
            {
              role: 'system',
              content: [
                `用户在做文献综述，想把几篇论文报告的同一种数字放在一列里比。把下面的数字归成几组同一种指标，用${lang()}：`,
                '- 一组至少两篇论文；单位不同又不能直接换算的不要放进一组；最多 4 组，挑最能说明这几篇差别的。',
                '- name 是这组指标的名字（带单位，比如「32 位加法要几个周期」），better 是 lower（越小越好）或 higher。',
                '- 每条的 ok：条件和组里多数一致、能直接比就是 true；条件不同（近似结果、做的是乘法不是加法、位宽不同、不同工艺）是 false，note 写清哪里不同（一句）。',
                '只输出 JSON：{"groups": [{"name": "", "unit": "", "better": "lower", "items": [{"m": "1:2", "ok": true, "note": ""}]}]}'
              ].join('\n')
            },
            { role: 'user', content: all.map((x) => `[${x.key}] ${short(x.p)}：${x.m.name} = ${x.m.value} ${x.m.unit}；${x.m.what}；条件：${x.m.cond}`).join('\n') }
          ],
          { json: true, timeoutMs: 120_000 }
        )
        const j = parseJsonLoose<{ groups?: { name: string; unit?: string; better?: string; items?: { m: string; ok?: boolean; note?: string }[] }[] }>(out)
        groups = (j.groups ?? [])
          .map((g): MetricGroup => {
            const rows = (g.items ?? []).flatMap((it) => {
              const x = all.find((y) => y.key === String(it.m))
              return x ? [{ paperId: x.row.paperId, value: x.m.value, ok: it.ok !== false, note: String(it.note ?? ''), what: x.m.what, quote: x.m.quote, page: x.m.page, found: x.m.found }] : []
            })
            // 一篇在一组里只留一个数
            const seen = new Set<string>()
            return { name: String(g.name ?? ''), unit: String(g.unit ?? ''), better: g.better === 'higher' ? 'higher' : 'lower', rows: rows.filter((r) => !seen.has(r.paperId) && seen.add(r.paperId)) }
          })
          .filter((g) => g.name && g.rows.length >= 2)
          .slice(0, 4)
      }
      const cur = load(sid)
      cur.metrics = groups
      cur.metStatus = 'done'
      save(sid, cur)
    } catch (e) {
      const cur = load(sid)
      cur.metStatus = 'failed'
      cur.metError = (e as Error).message
      save(sid, cur)
    }
  }
  ipcMain.handle('matrix:metrics', (_e, sid: string) => void metrics(sid))

  // —— 写一段 ——
  // 素材在提示词里用短编号：第 2 篇的方法是 2m，关系是 R1；回来再换成真编号
  const materials = (sid: string, ids: string[]): { alias: Map<string, string>; back: Map<string, string>; text: string } => {
    const st = load(sid)
    const ps = papersOf(sid)
    const alias = new Map<string, string>()
    const back = new Map<string, string>()
    const lines: string[] = []
    const num = (pid: string): number => st.rows.findIndex((r) => r.paperId === pid) + 1
    let rn = 0
    for (const id of ids) {
      if (isRel(id)) {
        const rel = st.relations?.find((r) => relCellId(r.id) === id)
        if (!rel) continue
        const a = `R${++rn}`
        alias.set(id, a)
        back.set(a.toLowerCase(), id)
        const kind = { base: '基于', cmp: '对比', bad: '指出不足' }[rel.kind]
        lines.push(`[${a}] 关系：论文 ${num(rel.from)} ${kind}论文 ${num(rel.to)}（${rel.label}）。论文 ${num(rel.from)} 原文：${rel.a.quote}${rel.b.quote ? `；论文 ${num(rel.to)} 原文：${rel.b.quote}` : ''}`)
        continue
      }
      const { paperId, col } = splitCell(id)
      const n = num(paperId)
      const p = ps.find((x) => x.id === paperId)
      if (!n || !p) continue
      const a = `${n}${col}`
      alias.set(id, a)
      back.set(a.toLowerCase(), id)
      if (col === NOTE_COL) {
        const ns = notesOf(paperId)
        lines.push(`[${a}] 论文 ${n} · 用户自己的批注：${ns.map((x) => `${x.label === 'doubt' ? '（有质疑）' : x.label === 'confused' ? '（看不懂）' : ''}${x.note || ''}${x.text ? ` 原文：「${x.text}」` : ''}`).join('；')}`)
        continue
      }
      const cell = st.rows[n - 1].cells[col]
      if (!cell) continue
      const colName = st.cols.find((x) => x.id === col)?.name ?? col
      lines.push(`[${a}] 论文 ${n} · ${colName}：${cell.text}${cell.found ? `　原文：${cell.quote}` : '　（原文里没找到出处，是推断）'}`)
    }
    const head = ps.map((p) => `论文 ${num(p.id)}：《${p.title}》，${short(p)}，简称 ${nameOf(p)}`).join('\n')
    return { alias, back, text: `${head}\n\n素材：\n${lines.join('\n')}` }
  }
  // 模型回来的编号可能带方括号、空格、大写
  const unalias = (back: Map<string, string>, a: unknown): string => back.get(String(a).replace(/[[\]\s「」]/g, '').toLowerCase()) ?? ''
  const langName = (l: 'zh' | 'en'): string => (l === 'en' ? 'English' : lang())
  const glossary = (sid: string): string => {
    const terms = paperIds(sid).flatMap((id) => getPaperCache<Term[]>(db, id, 'terms') ?? [])
    const seen = new Set<string>()
    const uniq = terms.filter((x) => x.zh && !seen.has(x.term.toLowerCase()) && seen.add(x.term.toLowerCase())).slice(0, 60)
    return uniq.length ? `术语表（用户在阅读页建的，照它翻）：\n${uniq.map((x) => `${x.term} → ${x.zh}`).join('\n')}` : ''
  }

  ipcMain.handle('matrix:outline', async (_e, sid: string, org: Org, l: 'zh' | 'en') => {
    const st = load(sid)
    if (!st.selected.length) throw new Error(t('先在表里勾几格'))
    const m = materials(sid, st.selected)
    const how = { evo: '按时间演进（谁先谁后、后来的怎么改进前面的）', method: '按方法分类', problem: '按要解决的问题分类' }[org]
    const out = await ai.once(
      [
        {
          role: 'system',
          content: `用户要用这些素材写一段文献综述。先排一个提纲：${how}，2 到 5 条，每条是一句短的要点（${langName(l)}，不超过 30 个字，用简称点出讲的是哪几篇，比如「SIMPLER 把整个函数放进一行」，不写作者和年份），cells 列出这条要用的素材编号（方括号里的那个，比如 2m、R1），每条只放和它有关的素材。每个素材至少用一次，只能用给的编号。只输出 JSON：{"items": [{"h": "", "cells": ["2m"]}]}`
        },
        { role: 'user', content: m.text }
      ],
      { json: true, timeoutMs: 90_000 }
    )
    const raw = parseJsonLoose<{ items?: { h?: string; cells?: string[] }[] }>(out).items ?? []
    const lost = raw.flatMap((x) => x.cells ?? []).filter((a) => !unalias(m.back, a))
    if (lost.length) c.log(`对比表提纲里有对不上的素材编号：${JSON.stringify(lost)}；有的是 ${[...m.back.keys()].join(' ')}`)
    const ps = papersOf(sid)
    const st2 = load(sid)
    const papersOfCell = (id: string): string[] => {
      if (!isRel(id)) return [splitCell(id).paperId]
      const r = st2.relations?.find((x) => relCellId(x.id) === id)
      return r ? [r.from, r.to] : []
    }
    const outline = fillOutline(
      cleanOutline(
        raw.map((x) => ({ h: x.h, cells: (x.cells ?? []).map((a) => unalias(m.back, a)).filter(Boolean) })),
        new Set(st.selected)
      ),
      st.selected,
      (id) => papersOfCell(id).map((pid) => { const p = ps.find((x) => x.id === pid); return p ? nameOf(p) : '' }),
      papersOfCell
    )
    if (!outline.length) throw new Error(t('AI 没排出提纲，再试一次'))
    const cur = load(sid)
    cur.draft = { org, lang: l, outline, sentences: null, checks: null }
    save(sid, cur)
    return cur.draft
  })
  ipcMain.handle('matrix:setDraft', (_e, sid: string, d: Draft) => {
    const st = load(sid)
    st.draft = d
    save(sid, st)
  })

  ipcMain.handle('matrix:write', async (_e, sid: string) => {
    const st = load(sid)
    const d = st.draft
    if (!d) throw new Error(t('先排提纲'))
    const used = [...new Set([...d.outline.flatMap((x) => x.cells), ...st.selected])]
    const m = materials(sid, used)
    const n = st.rows.length
    const out = await ai.once(
      [
        {
          role: 'system',
          content: [
            `照提纲用素材写一段文献综述，用${langName(d.lang)}，一个段落，4 到 10 句，学术写作的语气，不用破折号。用方法或系统的名字指代论文（比如 SIMPLER、MultPIM），不写作者和年份，出处由引用号标。规则：`,
            `- 只能引用论文 1 到 ${n}，cites 写论文编号。素材里没有的说法不要写成有出处；确实需要的过渡、概括或你自己的判断，cites 和 src 都留空。`,
            '- 每句的 src 列出真正撑得住这句话的素材编号（比如 2m、R1）：句子讲的是哪篇论文的哪件事，就写那篇论文那一格；关系素材只用来写两篇之间的关系。',
            '- 句子里不要写 [1] 这种引用号，界面会加。',
            d.lang === 'zh' ? glossary(sid) : '',
            '只输出 JSON：{"s": [{"t": "一句，带句末标点", "cites": [1], "src": ["1m"]}]}',
            // 素材是中文的时候模型容易跟着写中文：英文要说死
            d.lang === 'en' ? 'IMPORTANT: write every sentence ("t") in academic English, even though the outline and materials are in Chinese. Keep technical terms as the papers write them.' : ''
          ]
            .filter(Boolean)
            .join('\n')
        },
        { role: 'user', content: `提纲：\n${d.outline.map((x, i) => `${i + 1}. ${x.h}（素材：${x.cells.map((c_) => m.alias.get(c_)).join('、')}）`).join('\n')}\n\n${m.text}` }
      ],
      { json: true, timeoutMs: 180_000 }
    )
    const raw = parseJsonLoose<{ s?: { t?: string; cites?: number[]; src?: string[] }[] }>(out).s ?? []
    const { sentences } = cleanSentences(
      raw.map((x) => ({ ...x, src: (x.src ?? []).map((a) => unalias(m.back, a)) })),
      paperIds(sid),
      new Set(used)
    )
    if (!sentences.length) throw new Error(t('AI 没写出句子，再试一次'))
    const cur = load(sid)
    cur.draft = { ...d, sentences, checks: null }
    save(sid, cur)
    return cur.draft
  })

  // 查证：先按规则（没出处、引了出处之外的论文），再让 AI 逐句看原文撑不撑得住
  ipcMain.handle('matrix:check', async (_e, sid: string) => {
    const st = load(sid)
    const d = st.draft
    if (!d?.sentences) throw new Error(t('先写成段落'))
    const checks: (SentenceCheck | null)[] = d.sentences.map(ruleCheck)
    const ask = d.sentences.map((s, i) => ({ s, i })).filter((x) => !checks[x.i])
    if (ask.length) {
      const m = materials(sid, [...new Set(ask.flatMap((x) => x.s.src))])
      const out = await ai.once(
        [
          {
            role: 'system',
            content: `逐句查证一段文献综述：每句后面给了它说用到的素材。看素材里的原文能不能撑住这句话（数字、结论、谁做了什么都要对得上），能就 ok=true，不能就 ok=false 并用${lang()}写一句哪里撑不住。只输出 JSON：{"r": [{"i": 1, "ok": true, "why": ""}]}`
          },
          { role: 'user', content: `${m.text}\n\n要查的句子：\n${ask.map((x, k) => `(${k + 1}) ${x.s.t}　素材：${x.s.src.map((c_) => m.alias.get(c_)).join('、')}`).join('\n')}` }
        ],
        { json: true, timeoutMs: 120_000 }
      )
      const r = parseJsonLoose<{ r?: { i: number; ok: boolean; why?: string }[] }>(out).r ?? []
      ask.forEach((x, k) => {
        const v = r.find((y) => Number(y.i) === k + 1)
        checks[x.i] = v && v.ok === false ? { ok: false, why: String(v.why ?? '') || 'unsupported' } : { ok: true, why: '' }
      })
    }
    const cur = load(sid)
    cur.draft = { ...d, checks: checks.map((x) => x ?? { ok: true, why: '' }) }
    save(sid, cur)
    return cur.draft
  })

  // —— 回原文、导出、送出 ——
  ipcMain.handle('matrix:locate', (_e, paperId: string, quote: string, page: number | null) => {
    const doc = library.reflowDoc(paperId)
    const q = squash(quote).slice(0, 48)
    const blk = q.length >= 12 ? doc?.blocks.find((b) => squash(b.md).includes(q)) : undefined
    return { page, blockId: blk?.id ?? null }
  })

  const draftPlain = (sid: string): string => {
    const st = load(sid)
    const d = st.draft
    if (!d?.sentences) return ''
    return plainText(d.sentences, (pid) => st.rows.findIndex((r) => r.paperId === pid) + 1, d.lang)
  }
  ipcMain.handle('matrix:export', async (_e, sid: string) => {
    const st = load(sid)
    const ps = papersOf(sid)
    const title = (db.prepare('SELECT title FROM ai_sessions WHERE id = ?').get(sid) as { title: string }).title
    const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const cols = [...st.cols, { id: NOTE_COL, name: t('你的批注') }]
    const lines = [`# ${title}`, '', `| ${t('论文')} | ${cols.map((x) => esc(x.name)).join(' | ')} |`, `|${' --- |'.repeat(cols.length + 1)}`]
    st.rows.forEach((r, i) => {
      const p = ps.find((x) => x.id === r.paperId)!
      const cell = (col: string): string => {
        if (col === NOTE_COL) return notesOf(r.paperId).map((n) => `${n.label === 'doubt' ? t('有质疑') + '：' : n.label === 'confused' ? t('看不懂') + '：' : ''}${n.note || n.text}`).join('；')
        const c_ = r.cells[col]
        return c_ ? `${c_.text}${c_.page ? `（${t('第 {0} 页', c_.page)}）` : ''}` : ''
      }
      lines.push(`| [${i + 1}] ${esc(short(p))} | ${cols.map((x) => esc(cell(x.id))).join(' | ')} |`)
    })
    if (st.relations?.length) {
      lines.push('', `## ${t('关系')}`, '')
      for (const r of st.relations) lines.push(`- ${short(ps.find((p) => p.id === r.from)!)} → ${short(ps.find((p) => p.id === r.to)!)}：${r.label}。「${r.a.quote}」（${t('第 {0} 页', r.a.page ?? '?')}）`)
    }
    const para = draftPlain(sid)
    if (para) lines.push('', `## ${t('段落')}`, '', para)
    lines.push('', `## ${t('参考文献')}`, '', ...ps.map((p, i) => `[${i + 1}] ${formatCitation(p, 'gbt').replace(/\*([^*]+)\*/g, '$1')}`))
    const name = `${safeFileName(title)}.md`
    const r = process.env.PARAREAD_EXPORT_DIR
      ? { canceled: false, filePath: join(process.env.PARAREAD_EXPORT_DIR, name) }
      : await dialog.showSaveDialog(c.mainWindow()!, { title: t('导出对比表'), defaultPath: join(homedir(), 'Downloads', name), filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, lines.join('\n') + '\n')
    return r.filePath
  })

  ipcMain.handle('matrix:latex', (_e, sid: string) => {
    const st = load(sid)
    const d = st.draft
    if (!d?.sentences) throw new Error(t('先写成段落'))
    const keys = bibKeys(listPapers(db))
    const used = [...new Set(d.sentences.flatMap((s) => s.cites))]
    const bib = o.bib()
    return {
      text: toLatex(d.sentences, (pid) => keys.get(pid) ?? 'missing', d.lang),
      items: used.map((pid) => ({ paperId: pid, key: keys.get(pid) ?? '', title: getPaper(db, pid)?.title ?? '' })),
      bib
    }
  })

  ipcMain.handle('matrix:toWord', (_e, sid: string) => {
    const st = load(sid)
    const d = st.draft
    if (!d?.sentences) throw new Error(t('先写成段落'))
    const word = o.word()
    if (!word.serving()) throw new Error('word-off')
    const used = [...new Set(d.sentences.flatMap((s) => s.cites))]
    const item: WordInboxItem = {
      id: newId(),
      createdAt: Date.now(),
      title: (db.prepare('SELECT title FROM ai_sessions WHERE id = ?').get(sid) as { title: string }).title,
      segments: wordSegments(d.sentences, d.lang),
      items: used.map((id) => getPaper(db, id)).filter((p): p is Paper => !!p).map((p) => word.brief(p))
    }
    word.push(item)
    return { paneOpen: word.paneOpen(), cites: d.sentences.filter((s) => s.cites.length).length }
  })
}

