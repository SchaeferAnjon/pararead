// 文献库级的学术 AI：不进论文，对整个文献库提问；找论文；学习指南；写综述报告。
// 会话和消息存 ai_sessions / ai_messages。每一步的进度发 research:progress，最后的正文按 reqId 流式发（ai:stream）。
import { ipcMain, type WebContents } from 'electron'
import { plain } from '../shared/refs'
import type { Ctx } from './ctx'
import { getGlance, getPaper, listPapers } from './db'
import { parseJsonLoose, type ChatMsg } from './glm'
import { newId } from './library'
import { searchWeb, type SearchHit } from './meta'
import { t } from '../shared/i18n'

export type ResearchKind = 'ask' | 'find' | 'guide' | 'review' | 'matrix' // matrix：综述对比表（src/main/matrix.ts）

export interface ResearchSession {
  id: string
  kind: ResearchKind
  title: string
  paperIds: string[]
  createdAt: number
  updatedAt: number
}

export interface ResearchMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  meta: ResearchMeta | null
  createdAt: number
}

export interface Source {
  n: number
  paperId?: string // 库里的论文
  hit?: SearchHit // 网上的论文
  title: string
  year: number | null
}

export interface GuideMap {
  overview: string
  topics: { name: string; desc: string; concepts: { name: string; explain: string; papers: number[] }[] }[]
}

export interface ResearchMeta {
  sources?: Source[]
  picks?: (SearchHit & { why: string })[]
  map?: GuideMap
  outline?: { h: string; points: string[] }[]
  queries?: string[]
  error?: string
}

const STOP = new Set('the a an of and or in on for to with by from is are be this that what how why which using use based paper papers 论文 的 是 和 在 了 有 什么 怎么 哪些 如何 为什么'.split(' '))

export function keywords(q: string): string[] {
  const en = (q.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w))
  const zh = q.match(/[一-鿿]{2,}/g) ?? []
  return [...new Set([...en, ...zh])]
}

export function registerResearch(c: Ctx): void {
  const { db, ai, library, settings } = c

  const rowSession = (r: { id: string; kind: string; title: string; paper_ids: string; created_at: number; updated_at: number }): ResearchSession => ({
    id: r.id,
    kind: r.kind as ResearchKind,
    title: r.title,
    paperIds: JSON.parse(r.paper_ids) as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })
  const messages = (sid: string): ResearchMessage[] =>
    (
      db.prepare('SELECT * FROM ai_messages WHERE session_id = ? ORDER BY created_at, rowid').all(sid) as {
        id: string
        session_id: string
        role: string
        content: string
        meta: string | null
        created_at: number
      }[]
    ).map((m) => ({ id: m.id, sessionId: m.session_id, role: m.role === 'user' ? 'user' : 'assistant', content: m.content, meta: m.meta ? JSON.parse(m.meta) : null, createdAt: m.created_at }))
  const addMsg = (sid: string, role: 'user' | 'assistant', content: string, meta: ResearchMeta | null = null): ResearchMessage => {
    const m = { id: newId(), sessionId: sid, role, content, meta, createdAt: Date.now() }
    db.prepare('INSERT INTO ai_messages (id, session_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.id, sid, role, content, meta ? JSON.stringify(meta) : null, m.createdAt)
    db.prepare('UPDATE ai_sessions SET updated_at = ? WHERE id = ?').run(m.createdAt, sid)
    return m
  }
  const lang = (): string => settings.get().aiLang || settings.get().targetLang

  ipcMain.handle('research:list', () =>
    (db.prepare('SELECT * FROM ai_sessions ORDER BY updated_at DESC').all() as Parameters<typeof rowSession>[0][]).map(rowSession)
  )
  ipcMain.handle('research:get', (_e, id: string) => {
    const r = db.prepare('SELECT * FROM ai_sessions WHERE id = ?').get(id) as Parameters<typeof rowSession>[0] | undefined
    return r ? { session: rowSession(r), messages: messages(id) } : null
  })
  ipcMain.handle('research:create', (_e, kind: ResearchKind, paperIds: string[] = []) => {
    const id = newId()
    const now = Date.now()
    const title = { ask: t('问文献库'), find: t('找论文'), guide: t('学习指南'), review: t('综述报告'), matrix: t('对比表') }[kind]
    db.prepare('INSERT INTO ai_sessions (id, kind, title, paper_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, title, JSON.stringify(paperIds), now, now)
    c.broadcast('research:changed', null)
    return id
  })
  ipcMain.handle('research:rename', (_e, id: string, title: string) => {
    db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(title.trim() || t('未命名'), id)
    c.broadcast('research:changed', null)
  })
  ipcMain.handle('research:delete', (_e, id: string) => {
    db.prepare('DELETE FROM ai_messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM ai_sessions WHERE id = ?').run(id)
    c.broadcast('research:changed', null)
  })

  // 在库里找和问题相关的论文：标题、摘要、速览里的关键词命中加权，再加全文命中次数
  const retrieve = (q: string, limit: number, only: string[] = []): { id: string; score: number }[] => {
    const papers = listPapers(db).filter((p) => p.kind !== 'link' && (!only.length || only.includes(p.id)))
    if (only.length) return papers.map((p) => ({ id: p.id, score: 1 }))
    const kws = keywords(q)
    const scored = papers.map((p) => {
      const g = getGlance(db, p.id)
      const head = `${p.title} ${p.abstract ?? ''} ${g?.tldr ?? ''} ${(g?.keywords ?? []).join(' ')}`.toLowerCase()
      let score = 0
      for (const k of kws) {
        if (p.title.toLowerCase().includes(k)) score += 5
        if (head.includes(k)) score += 2
        const n = (db.prepare("SELECT COUNT(*) n FROM page_text WHERE paper_id = ? AND lower(text) LIKE ? ESCAPE '\\'").get(p.id, `%${k.replace(/[%_]/g, (m) => '\\' + m)}%`) as { n: number }).n
        score += Math.min(n, 6) * 0.5
      }
      return { id: p.id, score }
    })
    const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
    // 一篇都没命中（问的是很泛的问题）：最近读的几篇
    return (hits.length ? hits : scored).slice(0, limit)
  }

  // 每篇的摘要式材料：标题、年份、摘要、速览要点
  const brief = (id: string, n: number, full = 0): string => {
    const p = getPaper(db, id)!
    const g = getGlance(db, id)
    let s = `[${n}] 《${p.title}》${p.year ? `（${p.year}）` : ''}${p.authors.length ? `，${p.authors.slice(0, 3).join(', ')}` : ''}\n`
    if (p.abstract) s += `摘要：${p.abstract}\n`
    if (g) s += `速览：${g.tldr}\n${[...g.question, ...g.method, ...g.findings].map((x) => `- ${typeof x === 'string' ? x : x.text}`).join('\n')}\n`
    if (full > 0) s += `全文（节选）：\n${library.contextText(id, full).text}\n`
    else if (!p.abstract && !g) s += `开头：${library.contextText(id, 3000).text}\n`
    return s
  }

  const progress = (wc: WebContents, sessionId: string, stage: string, detail = ''): void => {
    if (!wc.isDestroyed()) wc.send('research:progress', { sessionId, stage, detail })
  }

  ipcMain.handle('research:send', async (e, reqId: string, sessionId: string, text: string) => {
    const r = db.prepare('SELECT * FROM ai_sessions WHERE id = ?').get(sessionId) as Parameters<typeof rowSession>[0] | undefined
    if (!r) throw new Error(t('会话不存在'))
    const s = rowSession(r)
    const history = messages(sessionId)
    const user = addMsg(sessionId, 'user', text)
    if (!history.length) {
      db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(text.slice(0, 40), sessionId)
      c.broadcast('research:changed', null)
    }
    const wc = e.sender
    const first = !history.some((m) => m.role === 'assistant')
    try {
      if (s.kind === 'find' && first) await findPapers(wc, reqId, s, text)
      else if (s.kind === 'guide' && first) await guide(wc, reqId, s, text)
      else if (s.kind === 'review' && first) await review(wc, reqId, s, text)
      else askLibrary(wc, reqId, s, text, history)
    } catch (err) {
      const msg = (err as Error).message
      addMsg(sessionId, 'assistant', '', { error: msg })
      if (!wc.isDestroyed()) wc.send('ai:stream', { reqId, error: msg })
    }
    return user
  })

  // 问文献库：找相关的几篇，带编号给模型，回答里用 [n] 引用
  function askLibrary(wc: WebContents, reqId: string, s: ResearchSession, q: string, history: ResearchMessage[]): void {
    progress(wc, s.id, '在文献库里找相关论文')
    const prev = history.flatMap((m) => m.meta?.sources ?? []).filter((x) => x.paperId)
    const picked = s.paperIds.length ? retrieve(q, 20, s.paperIds) : retrieve(q, 8)
    const ids = [...new Set([...picked.map((p) => p.id), ...prev.map((x) => x.paperId!)])].slice(0, 12)
    const budget = Math.min(ai.ctxChars(), 200000)
    const fullEach = ids.length <= 3 ? Math.round(budget / Math.max(ids.length, 1) / 1.5) : 0
    const sources: Source[] = ids.map((id, i) => ({ n: i + 1, paperId: id, title: getPaper(db, id)!.title, year: getPaper(db, id)!.year }))
    progress(wc, s.id, '读论文', t('{0} 篇', ids.length))
    const material = ids.map((id, i) => brief(id, i + 1, i < 3 ? fullEach : 0)).join('\n\n')
    const msgs: ChatMsg[] = [
      {
        role: 'system',
        content: [
          `你是学术助手，帮用户基于他文献库里的论文回答问题。用${lang()}回答，术语保留英文，公式用 LaTeX。`,
          '只根据下面给的论文材料回答；材料里没有的要说明是你的补充。引用时在句末写 [n]（n 是论文编号），可以写 [1][3]。',
          '用 Markdown，条理清楚，不要客套话，不用破折号。',
          '',
          '文献库里的相关论文：',
          material || '（文献库是空的）'
        ].join('\n')
      },
      ...history.filter((m) => m.content).slice(-8).map((m) => ({ role: m.role, content: m.content }) as ChatMsg),
      { role: 'user', content: q }
    ]
    c.streamer.streamTo(wc, reqId, msgs, { onFinish: (full) => addMsg(s.id, 'assistant', full, { sources }) })
  }

  // 找论文：模型拆检索词 → OpenAlex 检索 → 模型挑最相关的并说理由
  async function findPapers(wc: WebContents, reqId: string, s: ResearchSession, q: string): Promise<void> {
    progress(wc, s.id, '理解需求，拆成检索词')
    const plan = parseJsonLoose<{ queries?: string[]; yearFrom?: number | null }>(
      await ai.once(
        [
          {
            role: 'system',
            content:
              '把用户找论文的需求拆成 2 到 4 条英文学术检索式（关键词组合，不要布尔符号），需求里有时间范围就给 yearFrom（四位年份），没有给 null。只输出 JSON：{"queries": [...], "yearFrom": 年份或 null}'
          },
          { role: 'user', content: q }
        ],
        { json: true, timeoutMs: 60_000 }
      )
    )
    const queries = (plan.queries ?? [q]).slice(0, 4)
    const all = new Map<string, SearchHit>()
    for (const [i, qq] of queries.entries()) {
      progress(wc, s.id, '检索', `${i + 1}/${queries.length}：${qq}`)
      const r = await searchWeb(qq, 15, { yearFrom: plan.yearFrom ?? undefined })
      for (const h of r.hits) {
        const k = (h.doi ?? h.title).toLowerCase()
        if (!all.has(k)) all.set(k, h)
      }
    }
    const pool = [...all.values()].slice(0, 45)
    if (!pool.length) throw new Error(t('没有检索到论文，换个说法试试'))
    progress(wc, s.id, '挑出最相关的', t('{0} 篇候选', pool.length))
    const ranked = parseJsonLoose<{ picks?: { i: number; why: string }[]; summary?: string }>(
      await ai.once(
        [
          {
            role: 'system',
            content: `从候选论文里挑出最符合用户需求的 6 到 10 篇，按相关程度排序。用${lang()}写一句理由（不超过 40 字）。再写一句总述。只输出 JSON：{"summary": "...", "picks": [{"i": 候选编号, "why": "..."}]}`
          },
          {
            role: 'user',
            content: `需求：${q}\n\n候选：\n${pool.map((h, i) => `[${i}] ${h.title}（${h.year ?? '?'}，${h.venue ?? ''}，被引 ${h.citations ?? '?'}）\n${(h.abstract ?? h.tldr ?? '').slice(0, 500)}`).join('\n\n')}`
          }
        ],
        { json: true, timeoutMs: 120_000 }
      )
    )
    const picks = (ranked.picks ?? []).filter((p) => pool[p.i]).map((p) => ({ ...pool[p.i], why: p.why }))
    const content = ranked.summary ?? t('找到 {0} 篇', picks.length)
    addMsg(s.id, 'assistant', content, { picks, queries })
    if (!wc.isDestroyed()) {
      wc.send('ai:stream', { reqId, delta: content })
      wc.send('ai:stream', { reqId, done: true })
    }
  }

  // 学习指南：基于库里相关的论文，梳理这个方向的核心议题和概念
  async function guide(wc: WebContents, reqId: string, s: ResearchSession, topic: string): Promise<void> {
    progress(wc, s.id, '在文献库里找相关论文')
    const picked = s.paperIds.length ? retrieve(topic, 20, s.paperIds) : retrieve(topic, 12)
    if (!picked.length) throw new Error(t('文献库里还没有论文：先添加几篇，再生成学习指南'))
    const ids = picked.map((p) => p.id)
    const sources: Source[] = ids.map((id, i) => ({ n: i + 1, paperId: id, title: getPaper(db, id)!.title, year: getPaper(db, id)!.year }))
    progress(wc, s.id, '梳理核心议题和概念', t('{0} 篇论文', ids.length))
    const out = await ai.once(
      [
        {
          role: 'system',
          content: [
            `你帮用户快速入门一个研究方向。基于给的论文，用${lang()}梳理这个方向的核心议题和概念，术语保留英文。只输出 JSON：`,
            '{"overview": 三四句话的概览, "topics": [{"name": 议题名, "desc": 一句话, "concepts": [{"name": 概念, "explain": 两句话以内的解释, "papers": [相关论文编号]}]}]}',
            '3 到 5 个议题，每个 2 到 5 个概念。只用给的论文编号。'
          ].join('\n')
        },
        { role: 'user', content: `方向：${topic}\n\n论文：\n${ids.map((id, i) => brief(id, i + 1)).join('\n\n')}` }
      ],
      { json: true, timeoutMs: 180_000 }
    )
    const map = parseJsonLoose<GuideMap>(out)
    addMsg(s.id, 'assistant', map.overview ?? '', { map, sources })
    if (!wc.isDestroyed()) {
      wc.send('ai:stream', { reqId, delta: map.overview ?? '' })
      wc.send('ai:stream', { reqId, done: true })
    }
  }

  // 写综述报告：制定大纲和检索词 → 检索文献（网上加库里）→ 按大纲成文，引用用 [n]
  async function review(wc: WebContents, reqId: string, s: ResearchSession, topic: string): Promise<void> {
    progress(wc, s.id, '制定研究计划')
    const plan = parseJsonLoose<{ title?: string; outline?: { h: string; points: string[] }[]; queries?: string[] }>(
      await ai.once(
        [
          {
            role: 'system',
            content: `用户要写一篇文献综述。用${lang()}给出综述标题和 4 到 6 节的大纲（每节 2 到 4 个要点），再给 5 到 8 条英文学术检索式。只输出 JSON：{"title": "...", "outline": [{"h": 节标题, "points": [...]}], "queries": [...]}`
          },
          { role: 'user', content: topic }
        ],
        { json: true, timeoutMs: 90_000 }
      )
    )
    const outline = plan.outline ?? []
    const queries = (plan.queries ?? [topic]).slice(0, 8)
    progress(wc, s.id, '计划', JSON.stringify({ title: plan.title, outline }))
    const all = new Map<string, SearchHit>()
    for (const [i, q] of queries.entries()) {
      progress(wc, s.id, '深度检索文献', t('{0}/{1}：{2}，已收集 {3} 篇', i + 1, queries.length, q, all.size))
      const r = await searchWeb(q, 12)
      for (const h of r.hits) {
        if (!h.abstract) continue
        const k = (h.doi ?? h.title).toLowerCase()
        if (!all.has(k)) all.set(k, h)
      }
    }
    // 库里相关的也算进来
    const mine = retrieve(topic, 6).filter((x) => x.score > 0)
    const web = [...all.values()].sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0)).slice(0, 50)
    const sources: Source[] = [
      ...mine.map((m, i) => ({ n: i + 1, paperId: m.id, title: getPaper(db, m.id)!.title, year: getPaper(db, m.id)!.year })),
      ...web.map((h, i) => ({ n: mine.length + i + 1, hit: h, title: h.title, year: h.year }))
    ]
    if (sources.length < 3) throw new Error(t('检索到的文献太少，换个课题描述试试'))
    progress(wc, s.id, '写报告', t('基于 {0} 篇文献', sources.length))
    const material = sources
      .map((src) =>
        src.paperId
          ? brief(src.paperId, src.n)
          : `[${src.n}] 《${src.hit!.title}》（${src.hit!.year ?? '?'}，${src.hit!.venue ?? ''}，被引 ${src.hit!.citations ?? '?'}）\n摘要：${plain(src.hit!.abstract ?? '').slice(0, 1200)}`
      )
      .join('\n\n')
    const msgs: ChatMsg[] = [
      {
        role: 'system',
        content: [
          `你在写一篇学术文献综述，用${lang()}，术语保留英文。按给的大纲写，每节用 ## 标题，节内分段论述，比较不同工作的方法、结论和分歧。`,
          '每个论断都要用 [n] 引用给的文献，只能引用给的编号，不要编造文献或数字。开头写一段引言，结尾写「研究空白与展望」一节。',
          '用 Markdown，不用破折号。不要在文末列参考文献（界面会自动列）。'
        ].join('\n')
      },
      { role: 'user', content: `课题：${topic}\n标题：${plan.title ?? topic}\n大纲：\n${outline.map((o) => `## ${o.h}\n${o.points.map((p) => `- ${p}`).join('\n')}`).join('\n')}\n\n文献：\n${material}` }
    ]
    c.streamer.streamTo(wc, reqId, msgs, {
      maxTokens: 16000,
      onFinish: (full) => {
        addMsg(s.id, 'assistant', `# ${plan.title ?? topic}\n\n${full}`, { sources, outline, queries })
        db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run((plan.title ?? topic).slice(0, 60), s.id)
        c.broadcast('research:changed', null)
      }
    })
  }
}
