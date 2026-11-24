// 右栏 AI 问答的引擎（2026-11-23 起照画布笔记）：和画布笔记同一个 @cn/ai-engines 的引擎表，加一项「设置里那家服务商」。
// Key 用 ParaRead 自己存的那几把（设置 › AI 服务，providers.ts 的 id）；ParaRead 没有、画布笔记存了的，第一次用时问一句「用画布笔记那把？」，
// 同意后从画布笔记那份解出来（钥匙串会弹一次允许），存一份到 ParaRead 自己的设置里。
import { dialog, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { join } from 'node:path'
import { createEngines, localModels, type LocalFound, notesHasKey, notesSettingsDir, parseTestKeys, probeLocal, readNotesKey, startEngineWatch } from '@cn/ai-engines'
import { type ApiId, type EngineInfo, isApi, isEngineId, isLocal, LOCAL_IDS, PROVIDER_NAME, type LocalId } from '@cn/ai-engines/shared'
import { providerOf } from '../shared/providers'
import { levelHint, levelName, thinkKey, thinkLevel, type ThinkLevel, thinkSpec } from '../shared/thinking'
import { t } from '../shared/i18n'
import type { Ctx } from './ctx'
import { makeChatAi, PARAREAD_ENGINE, type ChatAskReq, type ChatPick } from './chatAi'
import { dropChatSessions } from './db'
import { E2E } from './testMode'

/** 画布笔记的 API Key 那几家 → ParaRead 设置里存 Key 用的服务商 id */
const PROVIDER_OF: Record<ApiId, string> = { anthropic: 'claude', openai: 'openai', deepseek: 'deepseek', openrouter: 'openrouter' }

/** 界面上的一家：画布笔记那十家的样子，加一项 'pararead'（id 是字符串） */
export type ChatEngineInfo = Omit<EngineInfo, 'id'> & { id: string }

export function registerChat(c: Ctx): { stop(reqId: string): boolean; dispose(): void } {
  const { settings, db } = c
  const keyOf = (id: ApiId): string | undefined => settings.apiKey(PROVIDER_OF[id]).key || undefined
  const local: Partial<Record<LocalId, LocalFound>> = {}
  const notes = { dir: notesSettingsDir(), test: E2E ? parseTestKeys(process.env.PR_TEST_NOTES_KEYS ?? '{}') : null }
  const changed = (): void => c.broadcast('chat:enginesChanged', null)

  const engines = createEngines({
    key: keyOf,
    keyTail: (id) => keyOf(id)?.slice(-4),
    // ParaRead 不带 OpenCode：Key 那几家只聊天（全能模式只给本机命令行；借用户自己装的 OpenCode 动手实测换不了模型，2026-11-23）
    sourceReady: (id) => (isApi(id) ? !!keyOf(id) : isLocal(id) ? !!local[id]?.on && !!local[id]?.models.length : false),
    sourceModels: (id) => (isLocal(id) && local[id] ? localModels(local[id]!) : []),
    changed
  })
  startEngineWatch({ dir: join(c.dataDir, 'ai'), changed, enabled: !E2E })
  for (const id of LOCAL_IDS)
    void probeLocal(id).then((f) => {
      local[id] = f
      if (f.on) changed()
    })

  /** 这一家要 Key、ParaRead 自己没有、画布笔记有、还没问过 */
  function needBorrow(id: string): ApiId | null {
    if (!isApi(id) || keyOf(id) || settings.get().borrowAsked.includes(id)) return null
    try {
      return notesHasKey(notes, id) ? id : null
    } catch (e) {
      c.log(`看画布笔记有没有 ${id} 的 Key 时出错：${(e as Error).message}`)
      return null
    }
  }

  const chat = makeChatAi(c, {
    engine: (id) => {
      if (!isEngineId(id)) throw new Error(t('AI 参数不对'))
      return engines.engine(id)
    },
    models: (id) => (isEngineId(id) ? engines.models(id) : []),
    needBorrow
  })

  /** 设置里那家服务商在菜单里的样子：会员时写「ParaRead 会员」 */
  function ownInfo(): ChatEngineInfo {
    const cf = c.ai.conf()
    const p = providerOf(cf.provider)
    // 和画布笔记那几家的「DeepSeek API」分开：写明是设置 › AI 服务里那家
    const label = cf.provider === 'member' ? t('ParaRead 会员') : t('{0}（设置里那家）', p.name)
    // 想多久那一颗：这个模型能选的思考档（shared/thinking.ts，DeepSeek 是关 / 开），和问答框原来的「思考」同一套
    const efforts = thinkSpec(cf.provider, cf.model).levels.map((l) => ({ id: l, label: levelName(l), note: levelHint(l) }))
    // 设置里那家是本机命令行（Claude Code）：算命令行这条路，全能模式能开，问的时候走共用引擎的 claude（ask 里转过去）
    return { id: PARAREAD_ENGINE, label, route: p.local ? 'cli' : 'api', path: c.ai.ready() ? `api:${cf.provider}` : null, where: t('设置 › AI 服务'), models: [{ id: cf.model, label: cf.model, efforts }], efforts }
  }

  ipcMain.handle('chat:engines', () => {
    const s = settings.get()
    // ParaRead 没有、画布笔记存着 Key 的那几家也能选：第一次问时先问「用画布笔记那把？」
    const list = engines.list().map((e) => (isApi(e.id) && !e.path && needBorrow(e.id) ? { ...e, path: `api:${e.id}`, where: t('画布笔记里有这一家的 Key，第一次用时问一句') } : e))
    // 设置里那家的「想多久」就是它的思考档：和设置 › AI 服务、讲解卡同一个值（thinkLevels，每个模型记一份）
    const own = (): ChatPick => {
      const cf = c.ai.conf()
      const lv = thinkLevel(s.thinkLevels, cf.provider, cf.model)
      return { engine: PARAREAD_ENGINE, model: cf.model, ...(lv ? { effort: lv } : {}) }
    }
    return { list: [ownInfo(), ...list] satisfies ChatEngineInfo[], pick: s.chatPick.engine === PARAREAD_ENGINE ? own() : s.chatPick, omni: s.omni }
  })
  ipcMain.handle('chat:setPick', (_e, p: ChatPick) => {
    if (!p || (p.engine !== PARAREAD_ENGINE && !isEngineId(p.engine))) throw new Error(t('AI 参数不对'))
    if (p.engine === PARAREAD_ENGINE) {
      // 选的档记进 thinkLevels（这个模型那一份），讲解卡、设置里跟着变
      const cf = c.ai.conf()
      const can = thinkSpec(cf.provider, cf.model).levels as string[]
      const levels = typeof p.effort === 'string' && can.includes(p.effort) ? { ...settings.get().thinkLevels, [thinkKey(cf.provider, cf.model)]: p.effort as ThinkLevel } : settings.get().thinkLevels
      settings.set({ chatPick: { engine: PARAREAD_ENGINE }, thinkLevels: levels })
    } else settings.set({ chatPick: { engine: p.engine, ...(typeof p.model === 'string' ? { model: p.model } : {}), ...(typeof p.effort === 'string' ? { effort: p.effort } : {}) } })
    changed()
  })
  ipcMain.handle('chat:setOmni', (_e, on: boolean) => {
    settings.set({ omni: !!on })
    changed()
  })
  ipcMain.handle('chat:ask', (e, reqId: string, paperId: string, req: ChatAskReq) => chat.ask(e.sender, reqId, paperId, req))
  ipcMain.handle('chat:paste', (_e, bytes: Uint8Array, mime: string) => chat.savePaste(bytes, mime))
  // 底行「+」：系统选图框，选的图拷进 pasted/（测试模式下框不弹，见 testMode.ts）
  ipcMain.handle('chat:pickImages', async (_e, room: number) => {
    const win = c.mainWindow()
    const r = await (win ? dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: t('图片'), extensions: ['png', 'jpg', 'jpeg'] }] }) : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
    if (r.canceled) return []
    return r.filePaths.slice(0, Math.max(0, room)).map((f) => ({ name: chat.savePaste(readFileSync(f), /\.jpe?g$/i.test(extname(f)) ? 'image/jpeg' : 'image/png'), label: f.split(/[\\/]/).pop() ?? t('图') }))
  })
  ipcMain.handle('chat:pasted', (_e, name: string) => chat.pastedUrl(name))
  ipcMain.handle('chat:newConversation', (_e, paperId: string) => dropChatSessions(db, paperId))
  // 「用画布笔记那把？」：yes 解出来存进 ParaRead 的设置；no 记下问过了，以后不再问
  ipcMain.handle('chat:borrow', async (_e, id: string, yes: boolean) => {
    if (!isApi(id)) throw new Error(t('AI 参数不对'))
    settings.set({ borrowAsked: [...new Set([...settings.get().borrowAsked, id])] })
    if (!yes) return { ok: true }
    try {
      settings.setKey(await readNotesKey(notes, id), PROVIDER_OF[id])
      changed()
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })
  ipcMain.handle('chat:notesKeys', () => (Object.keys(PROVIDER_OF) as ApiId[]).filter((id) => !keyOf(id) && notesHasKey(notes, id)).map((id) => ({ id, provider: PROVIDER_OF[id], name: PROVIDER_NAME[id] })))

  return { stop: chat.stop, dispose: () => engines.dispose() }
}

