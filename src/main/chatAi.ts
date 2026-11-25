// 右栏 AI 问答（2026-11-23 起照画布笔记）：谁来答在输入框底下一键切，画布笔记那十家（本机命令行四家、API Key 四家、本机模型两家）
// 走共用的 @cn/ai-engines，会话接着问、贴多张图、全能模式和画布笔记读 PDF 一样；'pararead' 是设置里那家服务商（会员时走会员），
// 走原来的 HTTP 流式。翻译、意群这类批量小请求不经过这里，一直走设置里那家（ai.ts）。
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { Engine, EngineImage, EngineStep } from '@cn/ai-engines'
import { checkMaterials, imageNames, type Material, PASTED_NAME, withMaterials } from '@cn/ai-chat/materials'
import { type ApiId, canSeeImages, type EngineId, fitPick, pickLabel, type ModelOption } from '@cn/ai-engines/shared'
import { asksFormula, formulaImagesNote, formulaList, type MdFormulaImage, pickFormulaImages } from '@cn/format'
import { t } from '../shared/i18n'
import { providerOf } from '../shared/providers'
import { levelName, thinkKey, thinkLevel, type ThinkLevel } from '../shared/thinking'
import type { ChatBox, ChatMessage, ChatMeta, StreamEvent } from '../shared/types'
import type { Ctx } from './ctx'
import { addChat, chatSession, getPaper, listChats, setChatSession } from './db'
import type { ChatMsg, ContentPart } from './glm'
import { newId } from './library'
import { chatSystem, FOLLOWUP_HINT } from './prompts'
import { makeFormulas } from './formulas'

/** 设置里那家服务商（会员时走会员）在引擎菜单里的 id */
export const PARAREAD_ENGINE = 'pararead'

export interface ChatPick {
  engine: string
  model?: string
  effort?: string
}

export interface ChatAskReq {
  content: string
  quote: string | null
  /** 输入框顶上那一排（引的段、贴的图），字里的 ①② 是它们的位置（@cn/ai-chat/materials） */
  mats?: Material[]
  /** 框选截图那一块（data URL，读论文时框的那块），排在贴的图前面 */
  crop?: string | null
  /** 对照、译文看法里框的那块：页、框、截的哪边（存在这一问上，写进配对笔记用） */
  box?: ChatBox | null
  context?: string | null
  paperIds?: string[]
  pick: ChatPick
  think?: ThinkLevel
}

export interface ChatAiDeps {
  /** 这一家的引擎（@cn/ai-engines 的 createEngines 给的） */
  engine(id: string): Engine
  /** 这一家能选的模型（回答头上写「Claude Code · Opus 5.5 · High」用） */
  models(id: string): ModelOption[]
  /** 这一家要 Key、ParaRead 自己没有、画布笔记有：先问「用画布笔记那把？」 */
  needBorrow(id: string): ApiId | null
}

/** 给命令行的全文最多多少字（一篇论文通常两三万字，书和综述截一下） */
const FULL_CHARS = 200_000

export function makeChatAi(c: Ctx, deps: ChatAiDeps) {
  const { db, library, settings } = c
  const pastedDir = join(c.dataDir, 'pasted')
  const asking = new Map<string, AbortController>()
  const formulas = makeFormulas({ library, ai: c.ai, log: c.log })

  /** 问之前把这篇的公式图转成 LaTeX（一篇一次）；转不成的那几张返回来，带图给 AI。转的时候出错不挡这一问 */
  async function formulasFirst(paperId: string, signal?: AbortSignal): Promise<MdFormulaImage[]> {
    try {
      return await formulas.ensure(paperId, signal)
    } catch (e) {
      c.log(`公式图转 LaTeX 出错 ${paperId}：${(e as Error).message}`)
      return library.aiMarkdown(paperId)?.pending ?? []
    }
  }

  /** AI 自己动手的地方：研究 Agent 的项目文件夹（和它同一个），全能模式下命令行在这里读写、跑命令 */
  const workDir = (): string => {
    const d = settings.get().agentDir || join(homedir(), 'Documents', 'ParaRead 项目')
    mkdirSync(d, { recursive: true })
    return d
  }

  function savePaste(bytes: Uint8Array, mime: string): string {
    if (!(bytes instanceof Uint8Array) || bytes.length > 20 * 1024 * 1024) throw new Error(t('图太大了'))
    const name = `${randomUUID()}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`
    mkdirSync(pastedDir, { recursive: true })
    writeFileSync(join(pastedDir, name), bytes)
    return name
  }

  function pastedUrl(name: string): string {
    if (!PASTED_NAME.test(name) || !existsSync(join(pastedDir, name))) throw new Error(t('图不对'))
    const data = readFileSync(join(pastedDir, name)).toString('base64')
    return `data:${name.endsWith('.jpg') ? 'image/jpeg' : 'image/png'};base64,${data}`
  }

  function imagesOf(names: string[], crop?: string | null): EngineImage[] {
    const out: EngineImage[] = []
    if (crop) {
      const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(crop)
      if (m) {
        const bytes = Buffer.from(m[2], 'base64')
        const name = savePaste(bytes, m[1])
        out.push({ mime: m[1] as EngineImage['mime'], data: m[2], path: join(pastedDir, name) })
      }
    }
    for (const n of names) {
      if (!PASTED_NAME.test(n)) throw new Error(t('图不对'))
      const path = join(pastedDir, n)
      out.push({ mime: n.endsWith('.jpg') ? 'image/jpeg' : 'image/png', data: readFileSync(path).toString('base64'), path })
    }
    return out
  }

  /** 论文全文（加一起问的几篇），给第一问用；会话接着问时不再给 */
  function paperText(paperId: string, others: string[]): { text: string; truncated: boolean } {
    const paper = getPaper(db, paperId)!
    const main = library.contextText(paperId, others.length ? Math.round(FULL_CHARS * 0.6) : FULL_CHARS)
    if (!others.length) return { text: main.text, truncated: main.truncated }
    const each = Math.round((FULL_CHARS * 0.4) / others.length)
    let text = `【本篇】《${paper.title}》\n${main.text}`
    others.forEach((id, i) => {
      const p = getPaper(db, id)
      if (p) text += `\n\n【文献 ${i + 2}】《${p.title}》${p.year ? `（${p.year}）` : ''}\n${library.contextText(id, each).text}`
    })
    return { text, truncated: main.truncated }
  }

  /** 交给 AI 的那句：讲解里聊过的、引的论文那段，字后面按 ①② 列出材料；crops：前面已经附了几张图（框的那块） */
  const questionOf = (m: { content: string; quote: string | null; context?: string | null; mats?: Material[] }, crops = 0): string =>
    (m.context ? `在讲解里已经聊过这一处：\n${m.context.slice(0, 6000)}\n\n` : '') +
    (m.quote ? `引用论文里的这段：\n> ${m.quote.replace(/\n/g, '\n> ')}\n\n` : '') +
    withMaterials(m.content, m.mats, crops)

  /** 会话接不上（换了家、软件重开、命令行把会话清了）时补在前面的最近几轮 */
  function historyOf(msgs: ChatMessage[]): string {
    const last = msgs.slice(-12)
    if (!last.length) return ''
    return `之前聊过的（接着聊）：\n${last.map((m) => `${m.role === 'user' ? '问' : '答'}：${m.role === 'user' ? questionOf({ ...m, ...(m.meta?.mats ? { mats: m.meta.mats } : {}) }) : m.content.replace(/\n?接着问[:：].*$/s, '')}`).join('\n\n')}`
  }

  const send = (wc: WebContents, e: StreamEvent): void => {
    if (!wc.isDestroyed()) wc.send('ai:stream', e)
  }

  /** 设置里那家服务商：原来的 HTTP 流式，图按 image_url 一张张给（看图走看图模型） */
  async function askProvider(wc: WebContents, reqId: string, paperId: string, req: ChatAskReq, user: ChatMessage): Promise<void> {
    // 公式图先转成 LaTeX；转不成的（设置里那家看不了图、出错）回答头上写明「公式没看到原图」
    const unseen = (await formulasFirst(paperId)).length
    const paper = getPaper(db, paperId)!
    const s = settings.get()
    const lang = s.aiLang || s.targetLang
    const others = user.paperIds ?? []
    const history = listChats(db, paperId).filter((m) => m.id !== user.id).slice(-12)
    const budget = c.ai.ctxChars()
    const main = library.contextText(paperId, others.length ? Math.round(budget * 0.6) : budget)
    let context = main.text
    if (others.length) {
      const each = Math.round((budget * 0.4) / others.length)
      context = `【本篇】《${paper.title}》\n${main.text}`
      others.forEach((id, i) => {
        const p = getPaper(db, id)
        if (p) context += `\n\n【文献 ${i + 2}】《${p.title}》${p.year ? `（${p.year}）` : ''}\n${library.contextText(id, each).text}`
      })
    }
    const text = questionOf(req, req.crop ? 1 : 0)
    const urls = [...(req.crop ? [req.crop] : []), ...imageNames(req.mats).map(pastedUrl)]
    let messages: ChatMsg[]
    let kind: 'text' | 'vision' = 'text'
    if (urls.length) {
      // 看图走看图模型：不给整篇论文，给标题和图就够，避免超长
      kind = 'vision'
      const parts: ContentPart[] = [
        ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        { type: 'text', text: `这是论文《${paper.title}》里的${urls.length > 1 ? ` ${urls.length} 张图` : '一块截图（图、表或公式）'}。${text || '请解释这块内容。'}\n用${lang}回答，术语保留英文，公式用 LaTeX，不用破折号。` }
      ]
      messages = [{ role: 'user', content: parts }]
    } else {
      messages = [
        {
          role: 'system',
          content: chatSystem({ title: paper.title, context, truncated: main.truncated, lang }) + (others.length ? `\n\n这次一起读的还有 ${others.length} 篇文献（上面标了【文献 N】）。比较和引用时写清是哪一篇。` : '')
        },
        ...history.map((h): ChatMsg => ({ role: h.role, content: h.role === 'user' ? questionOf({ ...h, ...(h.meta?.mats ? { mats: h.meta.mats } : {}) }) : h.content })),
        { role: 'user', content: text + FOLLOWUP_HINT }
      ]
    }
    // 想多久：输入框底下选的那一档（这一家的 effort 就是 ParaRead 的思考档）；这个模型没有那一档用最省的
    const want = (req.pick.effort as ThinkLevel | undefined) ?? req.think
    const think = kind === 'text' && want ? (() => {
      const { provider, model } = c.ai.conf()
      return thinkLevel({ [thinkKey(provider, model)]: want }, provider, model) ?? undefined
    })() : undefined
    const label = providerLabel() + (unseen && kind === 'text' ? ` · ${t('{0} 个公式没看到原图', unseen)}` : '')
    c.streamer.streamTo(wc, reqId, messages, {
      kind,
      think,
      onFinish: (full, info) => {
        addChat(db, { id: newId(), paperId, role: 'assistant', content: full, quote: null, image: null, createdAt: Date.now(), reasoning: info.reasoning || null, thinkMs: info.thinkMs, meta: { pick: { engine: PARAREAD_ENGINE, ...(think ? { effort: think } : {}) }, label: think ? `${label} · ${levelName(think)}` : label } })
        // 答完写进连着的画布笔记库的配对笔记（0.2.0 换成共用对话框后漏了这一句，问答没写进去）
        c.cn.chatChanged(paperId)
      },
      onError: (msg) => addChat(db, { id: newId(), paperId, role: 'assistant', content: '', quote: null, image: null, createdAt: Date.now(), meta: { pick: { engine: PARAREAD_ENGINE }, label, error: msg } })
    })
  }

  /** 「DeepSeek · deepseek-flash」「ParaRead 会员」：回答头上写的 */
  function providerLabel(): string {
    const cf = c.ai.conf()
    return cf.provider === 'member' ? t('ParaRead 会员') : `${providerOf(cf.provider).name} · ${cf.model}`
  }

  /** 画布笔记那十家：共用的引擎跑一问，接着上一轮的会话 */
  async function askEngine(wc: WebContents, reqId: string, paperId: string, req: ChatAskReq, user: ChatMessage): Promise<void> {
    const id = req.pick.engine
    const ac = new AbortController()
    asking.set(reqId, ac)
    const paper = getPaper(db, paperId)!
    const s = settings.get()
    const lang = s.aiLang || s.targetLang
    const others = user.paperIds ?? []
    const was = chatSession(db, paperId, id)
    const needFull = !was?.fullIn
    // 公式图先转成 LaTeX（全文里的公式就是 LaTeX）；转不成的那几张这一家能看图就带上图，不能看图回答头上写明
    const unseen = await formulasFirst(paperId, ac.signal)
    const full = needFull ? paperText(paperId, others) : null
    const images = imagesOf(imageNames(req.mats), req.crop)
    const fImgs = canSeeImages(id as EngineId) ? pickFormulaImages(unseen, req.content) : []
    const fNote = formulaImagesNote(images.length + 1, fImgs.map((f) => `公式图 F${f.n}`))
    for (const f of fImgs) images.push({ mime: f.mime, data: f.data, path: join(pastedDir, savePaste(Buffer.from(f.data, 'base64'), f.mime)) })
    // 会话接着问（全文早给过了，那时公式可能还是「[图]」）、问的是公式：把转好的公式补在这一问前面
    const raw = !full && asksFormula(req.content) ? library.reflowMarkdown(paperId) : null
    const recap = raw ? formulaList(raw, library.formulaLatex(paperId), req.content) : ''
    const prompt = [
      full ? `论文《${paper.title}》全文${full.truncated ? '（太长，只给了前一部分）' : ''}：\n${full.text}\n\n（全文到这里）\n\n` : '',
      others.length && full ? `这次一起读的还有 ${others.length} 篇文献（上面标了【文献 N】）。比较和引用时写清是哪一篇。\n` : '',
      req.crop ? '附图里排第 1 的是我在论文上框的那一块。\n' : '',
      recap ? `${recap}\n\n` : '',
      fNote ? `${fNote}\n` : '',
      questionOf(req, req.crop ? 1 : 0) || '解释这块',
      FOLLOWUP_HINT
    ].join('')
    const system = chatSystem({ title: paper.title, context: t('（全文在第一条消息里）'), truncated: false, lang })
    const steps: EngineStep[] = []
    let text = ''
    // 这一问真正用的模型和那一档：和画布笔记同一套（没选模型用这家的默认，这个模型不认的档换成它自己的默认档）
    const models = deps.models(id)
    const pick = fitPick(id as EngineId, models, { ...(req.pick.model ? { model: req.pick.model } : {}), ...(req.pick.effort ? { effort: req.pick.effort } : {}) })
    const label = pickLabel(pick, models) + (unseen.length > fImgs.length ? ` · ${t('{0} 个公式没看到原图', unseen.length - fImgs.length)}` : '')
    const meta = (): ChatMeta => ({ pick: { engine: id, ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) }, label, ...(steps.length ? { steps: [...steps] } : {}) })
    try {
      const r = await deps.engine(id).run({
        prompt,
        system,
        cwd: workDir(),
        ...(pick.model ? { model: pick.model } : {}),
        ...(pick.effort ? { effort: pick.effort } : {}),
        ...(was ? { session: was.session } : {}),
        history: was ? '' : historyOf(listChats(db, paperId).filter((m) => m.id !== user.id)),
        images,
        keepSession: true,
        omni: s.omni,
        signal: ac.signal,
        onStep: (st) => {
          const i = steps.findIndex((x) => x.id === st.id)
          if (i >= 0) steps[i] = st
          else steps.push(st)
          send(wc, { reqId, step: st })
        },
        onText: (delta) => {
          text += delta
          send(wc, { reqId, delta })
        }
      })
      if (r.session) setChatSession(db, paperId, id, r.session, needFull || !!was?.fullIn)
      addChat(db, { id: newId(), paperId, role: 'assistant', content: (r.text || text).replace(/\n{3,}/g, '\n\n'), quote: null, image: null, createdAt: Date.now(), meta: meta() })
      c.cn.chatChanged(paperId)
      send(wc, { reqId, done: true })
    } catch (e) {
      const err = e as Error & { session?: string }
      const msg = err.name === 'AbortError' || ac.signal.aborted ? t('停下了') : String(err.message ?? e)
      // 没答完也记会话号：说「接着做」时接着它聊
      if (err.session) setChatSession(db, paperId, id, err.session, needFull || !!was?.fullIn)
      addChat(db, { id: newId(), paperId, role: 'assistant', content: text, quote: null, image: null, createdAt: Date.now(), meta: { ...meta(), error: msg } })
      c.log(`AI 问答失败 ${reqId}（${id}）：${msg}`)
      send(wc, { reqId, error: msg })
    } finally {
      asking.delete(reqId)
    }
  }

  /** 问一次：先记下问的那一条，回答经 ai:stream 一段段回去。要先借画布笔记的 Key 时不问，回 { borrow } */
  function ask(wc: WebContents, reqId: string, paperId: string, req: ChatAskReq): { user: ChatMessage } | { borrow: ApiId } {
    if (!getPaper(db, paperId)) throw new Error(t('论文不存在'))
    if (typeof req?.content !== 'string' || !req.pick || typeof req.pick.engine !== 'string') throw new Error(t('AI 参数不对'))
    const mats = checkMaterials(req.mats)
    const id = req.pick.engine
    if (id !== PARAREAD_ENGINE) {
      const b = deps.needBorrow(id)
      if (b) return { borrow: b }
    }
    const others = (req.paperIds ?? []).filter((x) => x !== paperId).slice(0, 19)
    const user: ChatMessage = {
      id: newId(),
      paperId,
      role: 'user',
      content: req.content,
      quote: req.quote,
      image: req.crop ?? null,
      ...(req.box ? { box: req.box } : {}),
      createdAt: Date.now(),
      paperIds: others,
      ...(mats?.length ? { meta: { mats } } : {})
    }
    addChat(db, user)
    // 设置里那家是本机 Claude Code：交给共用引擎的 claude（和画布笔记一样能全能模式、显示步骤），模型和那一档照设置里的
    const cf = c.ai.conf()
    if (id === PARAREAD_ENGINE && cf.provider === 'claude-code') void askEngine(wc, reqId, paperId, { ...req, pick: { engine: 'claude', model: cf.model, ...(req.pick.effort ? { effort: req.pick.effort } : {}) } }, user)
    else if (id === PARAREAD_ENGINE) void askProvider(wc, reqId, paperId, req, user)
    else void askEngine(wc, reqId, paperId, req, user)
    return { user }
  }

  return {
    ask,
    stop: (reqId: string): boolean => {
      const a = asking.get(reqId)
      a?.abort()
      return !!a
    },
    savePaste,
    pastedUrl
  }
}

export type ChatAi = ReturnType<typeof makeChatAi>
