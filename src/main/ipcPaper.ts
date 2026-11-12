import { dialog, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cyrb53 } from '../shared/hash'
import { plain } from '../shared/refs'
import type { ChatMessage, Concept, MajorPoint, MajorType, Tier } from '../shared/types'
import type { Ctx } from './ctx'
import { addChat, addReadTime, getAiCache, getPaper, getPaperCache, listChats, putAiCache, putPaperCache, updatePaper } from './db'
import { safeFileName } from './exporter'
import { parseJsonLoose, type ChatMsg, type ContentPart } from './glm'
import { newId } from './library'
import { oaSearch, squashTitle, type SearchHit } from './meta'
import { chatSystem, conceptsMessages, FOLLOWUP_HINT, majorPointsMessages } from './prompts'
import { t } from '../shared/i18n'

const MAJOR_COUNT = { less: 8, default: 14, more: 24 }

// 阅读页：AI 问答（可加多篇、深度思考）、AI 重点句、核心概念、参考文献查询、阅读时长、重排档位
export function registerPaper(c: Ctx): void {
  const { db, library, settings, ai } = c

  ipcMain.handle(
    'chat:send',
    (e, reqId: string, paperId: string, msg: { content: string; quote: string | null; image: string | null; context?: string | null; paperIds?: string[]; thinking?: boolean }) => {
      const paper = getPaper(db, paperId)
      if (!paper) throw new Error(t('论文不存在'))
      const s = settings.get()
      const lang = s.aiLang || s.targetLang
      const history = listChats(db, paperId).slice(-12)
      const others = (msg.paperIds ?? []).filter((x) => x !== paperId).slice(0, 19)
      const user: ChatMessage = { id: newId(), paperId, role: 'user', content: msg.content, quote: msg.quote, image: msg.image, createdAt: Date.now(), paperIds: others }
      addChat(db, user)
      // 上下文：这篇占六成，其余几篇平分剩下的
      const budget = ai.ctxChars()
      const main = library.contextText(paperId, others.length ? Math.round(budget * 0.6) : budget)
      let context = main.text
      if (others.length) {
        const each = Math.round((budget * 0.4) / others.length)
        context = `【本篇】《${paper.title}》\n${main.text}`
        others.forEach((id, i) => {
          const p = getPaper(db, id)
          if (!p) return
          context += `\n\n【文献 ${i + 2}】《${p.title}》${p.year ? `（${p.year}）` : ''}\n${library.contextText(id, each).text}`
        })
      }
      const messages: ChatMsg[] = [
        {
          role: 'system',
          content:
            chatSystem({ title: paper.title, context, truncated: main.truncated, lang }) +
            (others.length ? `\n\n这次一起读的还有 ${others.length} 篇文献（上面标了【文献 N】）。比较和引用时写清是哪一篇。` : '')
        }
      ]
      for (const h of history) messages.push({ role: h.role, content: h.quote ? `引用：\n> ${h.quote}\n\n${h.content}` : h.content })
      const text = msg.quote ? `引用论文里的这段：\n> ${msg.quote.replace(/\n/g, '\n> ')}\n\n${msg.content}` : msg.content
      let kind: 'text' | 'vision' = 'text'
      if (msg.image) {
        // 看图走看图模型；它不需要整篇论文，给标题和截图就够，避免超长
        kind = 'vision'
        const parts: ContentPart[] = [
          { type: 'image_url', image_url: { url: msg.image } },
          {
            type: 'text',
            text:
              `这是论文《${paper.title}》里的一块截图（图、表或公式）。${text || '请解释这块内容。'}\n用${lang}回答，术语保留英文，公式用 LaTeX，不用破折号。` +
              (msg.context ? `\n\n截图所在页的文字（供参考，图注通常在里面）：\n${msg.context.slice(0, 4000)}` : '')
          }
        ]
        messages.splice(0, messages.length, { role: 'user', content: parts })
      } else messages.push({ role: 'user', content: text + FOLLOWUP_HINT })
      c.streamer.streamTo(e.sender, reqId, messages, {
        kind,
        thinking: !!msg.thinking,
        onFinish: (full, info) =>
          addChat(db, { id: newId(), paperId, role: 'assistant', content: full, quote: null, image: null, createdAt: Date.now(), reasoning: info.reasoning || null, thinkMs: info.thinkMs })
      })
      return user
    }
  )
  ipcMain.handle('chat:delete', (_e, id: string) => {
    db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  })
  ipcMain.handle('chat:export', async (_e, paperId: string, onlyId?: string) => {
    const paper = getPaper(db, paperId)
    if (!paper) throw new Error(t('论文不存在'))
    const msgs = listChats(db, paperId).filter((m) => !onlyId || m.id === onlyId)
    const md = [`# AI 问答：${paper.title}`, '', ...msgs.map((m) => (m.role === 'user' ? `## 问\n\n${m.quote ? `> ${m.quote.replace(/\n/g, '\n> ')}\n\n` : ''}${m.content}\n` : `## 答\n\n${m.content.replace(/\n?接着问[:：].*$/s, '')}\n`))].join('\n')
    const name = `${safeFileName(paper.title)} AI 问答.md`
    const r = process.env.PARAREAD_EXPORT_DIR
      ? { canceled: false, filePath: join(process.env.PARAREAD_EXPORT_DIR, name) }
      : await dialog.showSaveDialog(c.mainWindow()!, { title: t('导出 AI 问答'), defaultPath: join(homedir(), 'Downloads', name), filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, md)
    return r.filePath
  })

  // AI 重点句：按段编号给模型，让它原样抄出关键句并标类型；抄得对不上原文的丢掉
  ipcMain.handle('paper:majorPoints', async (_e, paperId: string, density: keyof typeof MAJOR_COUNT = 'default', force = false) => {
    const doc = library.reflowDoc(paperId)
    if (!doc) throw new Error(t('重排好以后才能标重点'))
    const key = `major:${doc.tier}:${density}`
    if (!force) {
      const hit = getPaperCache<MajorPoint[]>(db, paperId, key)
      if (hit) return hit
    }
    const paras = doc.blocks.filter((b) => b.type === 'paragraph' && b.translatable)
    let budget = Math.min(ai.ctxChars(), 120000)
    const numbered: string[] = []
    for (let i = 0; i < paras.length && budget > 0; i++) {
      const t_ = plain(paras[i].md)
      numbered.push(`[${i + 1}] ${t_}`)
      budget -= t_.length
    }
    const paper = getPaper(db, paperId)!
    const out = await ai.once(majorPointsMessages({ title: paper.title, paragraphs: numbered.join('\n\n'), count: MAJOR_COUNT[density] }), { json: true, timeoutMs: 180_000 })
    const j = parseJsonLoose<{ points?: { p: number; s: string; t: string }[] }>(out)
    const norm = (x: string): string => x.replace(/\s+/g, ' ').trim()
    const types: MajorType[] = ['objective', 'method', 'result', 'novelty']
    const points: MajorPoint[] = []
    for (const pt of j.points ?? []) {
      const b = paras[Number(pt.p) - 1]
      if (!b || !pt.s) continue
      const s = norm(pt.s).replace(/^["“]|["”]$/g, '')
      if (!norm(plain(b.md)).includes(s) || s.length < 12) continue
      points.push({ blockId: b.id, text: s, type: types.includes(pt.t as MajorType) ? (pt.t as MajorType) : 'result' })
    }
    putPaperCache(db, paperId, key, points)
    return points
  })

  // 核心概念速查和推荐问题：空对话时显示
  ipcMain.handle('paper:concepts', async (_e, paperId: string, force = false) => {
    if (!force) {
      const hit = getPaperCache<{ concepts: Concept[]; questions: string[] }>(db, paperId, 'concepts')
      if (hit) return hit
    }
    const paper = getPaper(db, paperId)
    if (!paper) throw new Error(t('论文不存在'))
    const s = settings.get()
    const ctx = library.contextText(paperId, Math.min(ai.ctxChars(), 80000))
    const out = await ai.once(conceptsMessages({ title: paper.title, context: ctx.text, lang: s.aiLang || s.targetLang }), { json: true, timeoutMs: 120_000 })
    const j = parseJsonLoose<{ concepts?: Concept[]; questions?: string[] }>(out)
    const v = {
      concepts: (j.concepts ?? []).filter((x) => x.term).slice(0, 10).map((x) => ({ term: String(x.term), explain: String(x.explain ?? '') })),
      questions: (j.questions ?? []).map(String).filter(Boolean).slice(0, 5)
    }
    putPaperCache(db, paperId, 'concepts', v)
    return v
  })

  // 点正文 [12]：按参考文献条目去 OpenAlex 找这篇（摘要、开放获取 PDF），标题对不上就当没找到
  ipcMain.handle('refs:lookup', async (_e, entry: string) => {
    if (plain(entry).length < 20) return null
    const key = `ref:${cyrb53(entry)}`
    const hit = getAiCache(db, key)
    if (hit !== null) return JSON.parse(hit) as SearchHit | null
    const quoted = /[“"]([^”"]{12,})[,.]?[”"]/.exec(entry)?.[1]
    const q = (quoted ?? entry.replace(/^[^.]*\.\s*/, '').split(/\.\s/)[0]).slice(0, 200)
    const hits = await oaSearch(q, 3).catch(() => [])
    const want = squashTitle(quoted ?? q)
    const found = want.length < 12 ? null : hits.find((h) => {
      const t_ = squashTitle(h.title)
      return t_.length > 8 && (want.includes(t_.slice(0, 40)) || t_.includes(want.slice(0, 40)))
    }) ?? null
    putAiCache(db, key, JSON.stringify(found))
    return found
  })

  ipcMain.handle('papers:readTime', (_e, paperId: string, ms: number) => {
    if (ms > 0 && ms < 10 * 60_000) addReadTime(db, paperId, Math.round(ms))
  })
  ipcMain.handle('papers:readStats', (_e, paperId: string) => {
    const rows = db.prepare('SELECT day, ms FROM reading_log WHERE paper_id = ? ORDER BY day').all(paperId) as { day: string; ms: number }[]
    return { total: rows.reduce((n, r) => n + r.ms, 0), days: rows }
  })

  // 手动选重排档位：有结果直接用，没有就排队跑（简单重排当场跑）
  ipcMain.handle('reflow:engine', async (_e, paperId: string, tier: Tier | null) => {
    updatePaper(db, paperId, { engine: tier })
    const p = getPaper(db, paperId)!
    if (tier === 'flash' || tier === 'basic') {
      if (p.reflow[tier] !== 'done') c.enqueueReflow(paperId, [tier])
    } else if (tier === 'simple' && p.reflow.ready !== 'simple' && !library.hasTier(paperId, 'simple')) {
      await library.runSimpleReflow(paperId)
    }
    c.broadcast('reflow:done', { paperId, tier: library.bestTier(paperId) })
    c.broadcast('library:changed', null)
    return library.reflowDoc(paperId)
  })

  // 重新翻译一段：丢掉缓存再翻
  ipcMain.handle('translate:redo', (_e, paperId: string, text: string) => {
    db.prepare('DELETE FROM translations WHERE key = ?').run(c.translator.keyFor(text))
    return c.translator.request(paperId, [{ text }], true)
  })

}
