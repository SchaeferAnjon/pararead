// 按标签讲解（方向 B：攒着一起讲）的主进程：点「过一遍」「一起讲」时才问 AI，流式发给界面，讲完存在标注上；
// 设置里开了「打标签后在后台先备好讲解」才在打标签时排队先讲（一次一条）。
// 讲的时候带上：所在段落和前后两段、全文、这篇的术语表、意群对齐（有缓存才用）；有质疑再加学术检索的结果和本文自己的引用。
import { ipcMain } from 'electron'
import { citedIn, groupKey, latest, litQuery, sections, senseChunks, withMiss } from '../shared/explain'
import { sensesKey } from '../shared/hash'
import { findReferences, plain } from '../shared/refs'
import type { SenseSentence } from '../shared/senses'
import { termRegex } from '../shared/terms'
import { t } from '../shared/i18n'
import type { Annotation, Block, ExplainRecord, ExplainVersion, LabelStatus, LitItem, Term } from '../shared/types'
import type { Ctx } from './ctx'
import { getAiCache, getAnnotation, getCachedTranslation, getPaper, getPaperCache, setLabelState } from './db'
import type { ChatMsg } from './glm'
import { searchWeb, squashTitle } from './meta'
import { confusedMessages, doubtMessages, groupMessages, type ExplainInput } from './explainPrompts'

const sq = (s: string): string => plain(s).replace(/[^A-Za-z0-9]+/g, '').toLowerCase()

export function registerExplain(c: Ctx, syncTouch: () => void): { saved: (a: Annotation) => void } {
  const { db, library, settings, ai } = c
  const lang = (): string => settings.get().aiLang || settings.get().targetLang
  const running = new Set<string>() // 正在讲的标注（流式或后台），同一条不同时讲两次
  const queue: string[] = [] // 后台等着备讲解的
  const pending = (): string[] => [...new Set([...queue, ...running])]
  const mark = (id: string, on: boolean): void => {
    if (on) running.add(id)
    else running.delete(id)
    c.broadcast('explain:pending', pending())
  }

  // 标注在重排结果里的那一段：对照模式按段 id（或段哈希），原文模式按摘的字找
  const placeOf = (a: Annotation): { blocks: Block[]; i: number } | null => {
    const doc = library.reflowDoc(a.paperId)
    if (!doc) return null
    let i = -1
    if (a.blockId) {
      const id = a.blockId.replace(/:tr$/, '')
      i = doc.blocks.findIndex((b) => b.id === id)
      if (i < 0 && a.blockHash) i = doc.blocks.findIndex((b) => b.hash === a.blockHash)
    }
    if (i < 0) {
      const n = sq(a.text).slice(0, 40)
      if (n.length >= 6) i = doc.blocks.findIndex((b) => b.type !== 'heading' && sq(b.md).includes(n))
    }
    return i < 0 ? null : { blocks: doc.blocks, i }
  }

  const termsFor = (paperId: string, text: string): Term[] => {
    const list = getPaperCache<Term[]>(db, paperId, 'terms') ?? []
    const re = termRegex(list)
    if (!re) return []
    const hit = new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase().replace(/\s+/g, ' ')))
    return list.filter((x) => hit.has(x.term.toLowerCase().replace(/\s+/g, ' '))).slice(0, 8)
  }
  const termLines = (list: Term[]): string => list.map((x) => `${x.term}${x.zh && x.zh !== x.term ? `（${x.zh}）` : ''}：${x.explain}`).join('\n')

  function input(a: Annotation, focus: string, before: string[]): { inp: ExplainInput; chunks: { en: string; zh: string }[]; place: ReturnType<typeof placeOf> } {
    const paper = getPaper(db, a.paperId)
    if (!paper) throw new Error(t('论文不存在'))
    const place = placeOf(a)
    const block = place?.blocks[place.i]
    let paragraph = block ? block.md : ''
    let around = ''
    if (place) {
      const paras = (from: number, step: number): string[] => {
        const out: string[] = []
        for (let k = from; k >= 0 && k < place.blocks.length && out.length < 2; k += step) if (place.blocks[k].type === 'paragraph') out.push(plain(place.blocks[k].md).slice(0, 1200))
        return out
      }
      around = [...paras(place.i - 1, -1).reverse(), '……', ...paras(place.i + 1, 1)].join('\n\n')
    } else if (a.page) {
      // 没重排的论文：用这一页的字，截标的字前后各 1500 个字
      const page = library.pageTexts(a.paperId)[a.page - 1] ?? ''
      const at = Math.max(0, page.indexOf(a.text.slice(0, 30)))
      paragraph = page.slice(Math.max(0, at - 1500), at + a.text.length + 1500)
    }
    // 意群对齐：这段的译文和对齐都已经缓存着才用（不为它另花一次 AI）
    let chunks: { en: string; zh: string }[] = []
    if (block?.translatable) {
      const zh = getCachedTranslation(db, c.translator.keyFor(block.md))
      const hit = zh ? getAiCache(db, sensesKey(block.md.trim(), zh.trim())) : null
      if (zh && hit) chunks = senseChunks(JSON.parse(hit) as SenseSentence[], block.md.trim(), zh.trim(), a.text)
    }
    const ctx = library.contextText(a.paperId, Math.min(ai.ctxChars(), 40000))
    return {
      place,
      chunks,
      inp: {
        title: paper.title,
        lang: lang(),
        text: a.text,
        onTr: !!a.blockId?.endsWith(':tr'),
        paragraph: plain(paragraph),
        around,
        context: ctx.text,
        terms: termLines(termsFor(a.paperId, `${paragraph}\n${a.text}`)),
        senses: chunks.map((x) => `${x.en} ⇄ ${x.zh}`).join('\n'),
        focus,
        before
      }
    }
  }

  // 「别的文献」的候选：本文在这段里引用的几条，加学术检索（OpenAlex 为主）的前几条；检索最多等 12 秒
  async function litFor(a: Annotation, place: ReturnType<typeof placeOf>, title: string): Promise<LitItem[]> {
    const out: LitItem[] = []
    if (place) {
      const refs = findReferences(place.blocks)
      const nums = citedIn(a.text).length ? citedIn(a.text) : citedIn(place.blocks[place.i].md)
      for (const n of nums.slice(0, 4)) {
        const r = refs.find((x) => x.n === n)
        if (r) out.push({ n: out.length + 1, title: r.text.slice(0, 220), authors: [], year: Number(/\b(19|20)\d{2}\b/.exec(r.text)?.[0]) || null, venue: null, url: null, cited: `[${n}]` })
      }
    }
    const terms = (getPaperCache<Term[]>(db, a.paperId, 'terms') ?? []).map((x) => x.term)
    const q = litQuery(a.text, terms, title)
    const timeout = new Promise<{ hits: [] }>((res) => setTimeout(() => res({ hits: [] }), 12_000))
    const found = await Promise.race([searchWeb(q, 6).catch(() => ({ hits: [] })), timeout])
    const self = squashTitle(title)
    for (const h of found.hits) {
      if (out.length >= 8) break
      const k = squashTitle(h.title)
      if (!k || k === self || out.some((x) => squashTitle(x.title).includes(k.slice(0, 30)))) continue
      out.push({ n: out.length + 1, title: h.title, authors: h.authors.slice(0, 3), year: h.year, venue: h.venue, url: h.url ?? (h.doi ? `https://doi.org/${h.doi}` : null), cited: null })
    }
    c.log(`讲解：学术检索「${q}」找到 ${found.hits.length} 篇`)
    return out
  }

  // 一版讲解的提示词和要跟着存的东西（意群对齐、文献候选）
  async function prepare(a: Annotation, o: { focus?: string; again?: boolean }): Promise<{ messages: ChatMsg[]; extra: Pick<ExplainVersion, 'lit' | 'chunks'> }> {
    const prev = latest(a.explain)
    const before = o.again ? (a.explain?.versions ?? []).map((v) => sections(v.raw).get('one') ?? sections(v.raw).get('lean') ?? '').filter(Boolean).slice(-3) : []
    const { inp, chunks, place } = input(a, o.focus ?? '', before)
    if (a.label === 'doubt') {
      // 换个角度、换个焦点时文献不再查一遍
      const lit = prev?.lit ?? (await litFor(a, place, inp.title))
      return { messages: doubtMessages({ ...inp, lit }), extra: { lit } }
    }
    return { messages: confusedMessages({ ...inp, needChunks: !chunks.length }), extra: chunks.length ? { chunks } : {} }
  }

  function addVersion(id: string, v: ExplainVersion, o: { again?: boolean }): Annotation | null {
    const cur = getAnnotation(db, id)
    if (!cur?.label) return null
    const base: ExplainRecord = o.again ? withMiss(cur.explain) : { versions: cur.explain?.versions ?? [], misses: cur.explain?.misses ?? 0, group: cur.explain?.group ?? null }
    const saved = setLabelState(db, id, { explain: { ...base, versions: [...base.versions, v].slice(-8) } })
    if (saved) c.broadcast('explain:saved', saved)
    syncTouch()
    return saved
  }

  ipcMain.handle('explain:start', async (e, reqId: string, annId: string, o: { focus?: string; again?: boolean } = {}) => {
    const a = getAnnotation(db, annId)
    if (!a?.label) throw new Error(t('这条标注没有标签'))
    // 没设好 AI 就别先去学术检索
    if (!ai.ready()) throw new Error(t('AI 服务还没设好：在设置里选一家、填上 Key'))
    if (running.has(annId) && !o.focus && !o.again) throw new Error(t('这条正在讲，稍等几秒'))
    mark(annId, true)
    try {
      const { messages, extra } = await prepare(a, o)
      c.streamer.streamTo(e.sender, reqId, messages, {
        onFinish: (full) => {
          if (sections(full).size >= 2) addVersion(annId, { focus: o.focus ?? '', raw: full, at: Date.now(), ...extra }, o)
          mark(annId, false)
        },
        onError: () => mark(annId, false)
      })
      // 跟着这一版存的文献候选、意群对齐：流着的时候界面就要用
      return extra
    } catch (err) {
      mark(annId, false)
      throw err
    }
  })

  // 几处一起讲：讲完把这一段挂在每一处上（再打开不再花 AI）
  ipcMain.handle('explain:group', (e, reqId: string, ids: string[]) => {
    if (!ai.ready()) throw new Error(t('AI 服务还没设好：在设置里选一家、填上 Key'))
    const anns = ids.map((id) => getAnnotation(db, id)).filter((x): x is Annotation => !!x?.label)
    if (anns.length < 2) throw new Error(t('勾上两条以上还没懂的'))
    const items = anns.map((a) => {
      const place = placeOf(a)
      return { text: a.text, paragraph: plain(place ? place.blocks[place.i].md : '').slice(0, 2000), paperTitle: getPaper(db, a.paperId)?.title ?? '' }
    })
    const terms = [...new Map(anns.flatMap((a) => termsFor(a.paperId, a.text)).map((x) => [x.term, x])).values()].slice(0, 10)
    const key = groupKey(anns.map((a) => a.id))
    c.streamer.streamTo(e.sender, reqId, groupMessages({ lang: lang(), items, terms: termLines(terms) }), {
      onFinish: (full) => {
        if (sections(full).size < 2) return
        const g = { key, ids: anns.map((a) => a.id), raw: full, at: Date.now() }
        for (const a of anns) {
          const cur = getAnnotation(db, a.id)
          const saved = cur && setLabelState(db, a.id, { explain: { versions: cur.explain?.versions ?? [], misses: cur.explain?.misses ?? 0, group: g } })
          if (saved) c.broadcast('explain:saved', saved)
        }
        syncTouch()
      }
    })
  })

  // 懂了、质疑成立 / 不成立 / 还要查；还不懂（again）在 explain:start 里记
  ipcMain.handle('explain:status', (_e, ids: string[], status: LabelStatus) => {
    const out: Annotation[] = []
    for (const id of ids) {
      const saved = setLabelState(db, id, { status })
      if (saved) {
        out.push(saved)
        c.broadcast('explain:saved', saved)
      }
    }
    syncTouch()
    return out
  })

  // 后台先备好讲解：设置里开着才排；一次讲一条，讲完推给界面
  let busy = false
  ipcMain.handle('explain:pending', () => pending())
  const pump = async (): Promise<void> => {
    if (busy) return
    busy = true
    while (queue.length) {
      const id = queue[0]
      const a = getAnnotation(db, id)
      if (a?.label && !latest(a.explain) && !running.has(id)) {
        mark(id, true)
        try {
          const { messages, extra } = await prepare(a, {})
          const full = await ai.once(messages, { timeoutMs: 180_000 })
          if (sections(full).size >= 2) addVersion(id, { focus: '', raw: full, at: Date.now(), ...extra }, {})
        } catch (err) {
          c.log(`后台备讲解失败 ${id}：${(err as Error).message}`)
        } finally {
          running.delete(id)
        }
      }
      queue.shift()
      c.broadcast('explain:pending', pending())
    }
    busy = false
  }
  return {
    saved: (a) => {
      if (!settings.get().explainPrefetch || !a.label || !ai.ready() || queue.includes(a.id)) return
      if (latest(getAnnotation(db, a.id)?.explain)) return
      queue.push(a.id)
      c.broadcast('explain:pending', pending())
      void pump()
    }
  }
}
