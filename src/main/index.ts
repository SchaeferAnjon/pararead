import { spawn } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, screen, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionForText, sectionsOf } from '../shared/chunk'
import { cyrb53 } from '../shared/hash'
import type { Annotation, ChatMessage, Glance, MenuItem, Settings, StreamEvent, Tier } from '../shared/types'
import {
  addChat,
  createFolder,
  deleteAnnotation,
  listFolders,
  setPaperFolders,
  tombstone,
  getAiCache,
  getCachedTranslation,
  getGlance,
  getPaper,
  listAnnotations,
  listChats,
  listPapers,
  openDb,
  putAiCache,
  putTranslation,
  saveAnnotation,
  saveGlance,
  setReflow,
  updatePaper,
  type PaperPatch
} from './db'
import { exportMarkdown, safeFileName } from './exporter'
import { Ai } from './ai'
import { claudeStatus, findClaude } from './claudeCode'
import { listModels, parseJsonLoose, type ChatMsg, type ContentPart } from './glm'
import { Library, newId } from './library'
import { MineruQueue, type MineruProgress } from './mineru'
import { chatSystem, explainMessages, FOLLOWUP_HINT, glanceMessages, selectionTranslateMessages } from './prompts'
import { mapNote, mapPaper, readScholaread, SCHOLAREAD_DIR } from './scholaread'
import { providerOf } from '../shared/providers'
import { SettingsStore } from './settings'
import { Translator } from './translate'
import type { Ctx } from './ctx'
import { registerLibrary } from './ipcLibrary'
import { registerImport } from './ipcImport'
import { registerPaper } from './ipcPaper'
import { registerResearch } from './research'
import { registerAgent } from './agent'
import { registerExportPdf } from './exportPdf'
import { registerLayout } from './ipcLayout'
import { makeStreamer, type Streamer } from './stream'
import { Member } from './member'
import { MineruInstaller } from './mineruInstall'
import { Updater } from './updater'
import { WordAddin } from './wordAddin'
import { setUiLang, t, uiLang } from '../shared/i18n'
import { Sync } from './sync'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 测试实例用 --data-dir=<目录> 把数据放到临时目录，不碰真实的 ~/Library/Application Support/ParaRead
app.setName('ParaRead')
const dataArg = process.argv.find((a) => a.startsWith('--data-dir='))
if (dataArg) app.setPath('userData', dataArg.slice('--data-dir='.length))
const dataDir = app.getPath('userData')
mkdirSync(dataDir, { recursive: true })

const logFile = join(dataDir, 'main.log')
function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`
  try {
    appendFileSync(logFile, line)
  } catch {
    // 日志写不了不影响使用
  }
}

const settings = new SettingsStore(join(dataDir, 'settings.json'))
// 会员：选了会员通道（provider = member）时，AI 走我们的服务器，Key 是设备令牌
const member = new Member(join(dataDir, 'member.json'), app.getVersion(), (st) => broadcast('member:status', st))
const ai = new Ai(
  settings,
  () => {
    const t_ = member.token()
    return settings.get().provider === 'member' && t_ ? { provider: 'member', token: t_ } : null
  },
  join(dataDir, 'claude-code')
)
// 选的是本机 Claude Code：先把 claude 命令找好（导入论文时要同步地问 AI 能不能用）
if (providerOf(settings.get().provider).local) void findClaude().catch((e: Error) => log(`找 claude 命令出错：${e.message}`))
const db = openDb(join(dataDir, 'library.sqlite'))
const library = new Library({ db, dataDir, ai, log })

let mainWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
const progress = new Map<string, MineruProgress>()

let syncRef: Sync | null = null
function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
  if (channel === 'library:changed') syncRef?.touch()
}

const mineru = new MineruQueue({
  command: () => settings.get().mineruPath,
  timeoutMs: 600_000,
  onProgress: (p) => {
    progress.set(p.paperId, p)
    if (p.status === 'running') setReflow(db, p.paperId, p.tier, 'running', { log: p.logLine })
    broadcast('reflow:progress', p)
  },
  onDone: (job) => {
    setReflow(db, job.paperId, job.tier, 'done')
    log(`MinerU ${job.tier} 完成 ${job.paperId}`)
    broadcast('reflow:done', { paperId: job.paperId, tier: job.tier })
    broadcast('library:changed', null)
  },
  onFailed: (job, error) => {
    setReflow(db, job.paperId, job.tier, 'failed', { error })
    log(`MinerU ${job.tier} 失败 ${job.paperId}：${error}`)
    broadcast('reflow:failed', { paperId: job.paperId, tier: job.tier, error })
    broadcast('library:changed', null)
  }
})

// MinerU 在不在（没装的电脑上由 mineruInstaller 在软件里装）
const mineruReady = (): boolean => existsSync(settings.get().mineruPath)
const mineruInstaller = new MineruInstaller(
  join(dataDir, 'mineru'),
  (st) => broadcast('mineru:install', st),
  (command) => {
    settings.set({ mineruPath: command })
    broadcast('settings:changed', settings.view())
    // 装好了：之前只做了简单重排的论文补上快速和精细重排
    for (const p of listPapers(db)) if (p.kind === 'pdf' && p.reflow.basic !== 'done') enqueueReflow(p.id)
  }
)

function enqueueReflow(paperId: string, tiers: ('flash' | 'basic')[] = ['flash', 'basic'], args?: string[]): void {
  // MinerU 还没装好：先用简单重排（只取文字），马上能读；装好后自动补精细的
  if (!mineruReady()) {
    void library
      .runSimpleReflow(paperId)
      .then(() => {
        broadcast('reflow:done', { paperId, tier: 'simple' })
        broadcast('library:changed', null)
      })
      .catch((e) => log(`简单重排失败 ${paperId}：${(e as Error).message}`))
    return
  }
  const p = getPaper(db, paperId)
  // 影印版：快速档认不出字，只跑精细档并强制 OCR
  if (p?.scanned && !args) {
    tiers = ['basic']
    args = ['--ocr-mode', 'ocr']
  }
  for (const tier of tiers) {
    setReflow(db, paperId, tier, 'queued', { error: null })
    mineru.enqueue({ paperId, tier, pdf: library.pdfPath(paperId), out: library.reflowPath(paperId, tier), args })
  }
}

// 新导入的论文：判断影印版、排队重排、后台补元数据
function afterImport(paperId: string): void {
  const p = getPaper(db, paperId)
  if (p?.kind === 'pdf') {
    if (library.isScanned(paperId)) updatePaper(db, paperId, { scanned: true })
    enqueueReflow(paperId)
  }
  // EPUB 是书，OPF 里的信息为准，不按标题去网上配（容易配到别的版本）；同步来的信息已经是另一台补好的
  if (p?.kind !== 'epub' && p?.source !== 'sync') void library.enrich(paperId).then(() => broadcast('library:changed', null))
}

// 上次没跑完的重排（应用被关掉）重新排队
function resumeReflow(): void {
  if (!mineruReady()) return
  const rows = db.prepare("SELECT paper_id, tier FROM reflow WHERE status IN ('queued', 'running') AND tier IN ('flash', 'basic') ORDER BY tier DESC").all() as {
    paper_id: string
    tier: 'flash' | 'basic'
  }[]
  for (const r of rows) {
    const p = getPaper(db, r.paper_id)
    if (!p) continue
    mineru.enqueue({ paperId: r.paper_id, tier: r.tier, pdf: library.pdfPath(r.paper_id), out: library.reflowPath(r.paper_id, r.tier), args: p.scanned ? ['--ocr-mode', 'ocr'] : undefined })
  }
}

const translator = new Translator({
  lang: () => settings.get().targetLang,
  getCached: (k) => getCachedTranslation(db, k),
  putCached: (k, t_) => putTranslation(db, k, settings.get().targetLang, t_, ai.model()),
  call: (messages) => ai.once(messages, { timeoutMs: 120_000 }),
  onResult: (r) => broadcast('translate:result', r),
  concurrency: () => ai.concurrency(),
  maxBatchItems: 8,
  maxBatchChars: 4000
})


const ctx: Ctx = {
  db,
  dataDir,
  library,
  settings,
  ai,
  translator,
  broadcast,
  log,
  enqueueReflow,
  afterImport,
  mainWindow: () => mainWin,
  streamer: null as unknown as Streamer
}

if (!settings.get().syncDevice) settings.set({ syncDevice: randomUUID() })
const sync: Sync = new Sync(ctx, settings.get().syncDevice)
syncRef = sync

const streamer = makeStreamer(ai, db, log)
const { streamTo, sendCached, aborts } = streamer
ctx.streamer = streamer

let urlImporter: ReturnType<typeof registerImport> | null = null

function registerIpc(): void {
  registerLibrary(ctx)
  registerPaper(ctx)
  registerResearch(ctx)
  registerAgent(ctx, (input) => urlImporter!.fromInput(input))
  registerExportPdf(ctx, loadRenderer)
  registerLayout(ctx)
  urlImporter = registerImport(ctx)
  // 文献库
  ipcMain.handle('papers:list', () => listPapers(db).map((p) => withProgress(p)))
  ipcMain.handle('papers:get', (_e, id: string) => {
    const p = getPaper(db, id)
    return p ? withProgress(p) : null
  })
  ipcMain.handle('papers:import', async (_e, paths?: string[]) => {
    let files = paths
    if (!files || !files.length) {
      const r = await dialog.showOpenDialog(mainWin!, { title: t('导入 PDF'), properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (r.canceled) return []
      files = r.filePaths
    }
    return importFiles(files)
  })
  ipcMain.handle('papers:update', (_e, id: string, patch: PaperPatch) => {
    updatePaper(db, id, patch)
    if (patch.tags || patch.title) broadcast('library:changed', null)
  })
  ipcMain.handle('papers:delete', (_e, ids: string[]) => {
    for (const id of ids) {
      db.prepare('UPDATE papers SET deleted = 1, updated_at = ? WHERE id = ?').run(Date.now(), id)
      mineru.cancelPaper(id)
      translator.cancel(id)
    }
    broadcast('library:changed', null)
  })
  ipcMain.handle('papers:restore', (_e, ids: string[]) => {
    for (const id of ids) db.prepare('UPDATE papers SET deleted = 0, updated_at = ? WHERE id = ?').run(Date.now(), id)
    broadcast('library:changed', null)
  })
  ipcMain.handle('papers:reveal', (_e, id: string) => shell.showItemInFolder(library.pdfPath(id)))
  ipcMain.handle('papers:pdf', (_e, id: string) => new Uint8Array(readFileSync(library.pdfPath(id))))
  // 通用原生菜单：界面传菜单项，返回点了哪个 id（没点返回 null）
  ipcMain.handle('ui:menu', (e, items: MenuItem[]) => {
    return new Promise<string | null>((resolve) => {
      let picked: string | null = null
      const conv = (it: MenuItem): MenuItemConstructorOptions =>
        it.type === 'separator'
          ? { type: 'separator' }
          : {
              label: it.label,
              enabled: it.enabled ?? true,
              type: it.checked !== undefined ? 'checkbox' : undefined,
              checked: it.checked,
              submenu: it.submenu ? it.submenu.map(conv) : undefined,
              click: it.submenu ? undefined : () => (picked = it.id ?? null)
            }
      const win = BrowserWindow.fromWebContents(e.sender)!
      Menu.buildFromTemplate(items.map(conv)).popup({ window: win, callback: () => setTimeout(() => resolve(picked), 0) })
    })
  })
  ipcMain.handle('reflow:get', (_e, id: string) => library.reflowDoc(id))
  ipcMain.handle('reflow:progress', (_e, id: string) => progress.get(id) ?? null)
  ipcMain.handle('reflow:retry', (_e, id: string) => {
    const p = getPaper(db, id)
    if (!p) return
    const tiers: ('flash' | 'basic')[] = []
    if (p.reflow.flash !== 'done') tiers.push('flash')
    if (p.reflow.basic !== 'done') tiers.push('basic')
    enqueueReflow(id, tiers.length ? tiers : ['flash', 'basic'])
  })
  ipcMain.handle('reflow:simple', async (_e, id: string) => {
    await library.runSimpleReflow(id)
    broadcast('reflow:done', { paperId: id, tier: 'simple' })
    broadcast('library:changed', null)
  })
  ipcMain.handle('papers:pageTexts', (_e, id: string) => library.pageTexts(id))

  // 翻译
  ipcMain.handle('translate:request', (_e, paperId: string, texts: string[], priority: boolean) =>
    translator.request(paperId, texts.map((text) => ({ text })), priority)
  )
  ipcMain.handle('translate:cancel', (_e, paperId: string) => translator.cancel(paperId))

  // 划词翻译、解释
  // 划词翻译和解释；带 image 的是原文模式里框选的截图，走看图模型
  ipcMain.handle('ai:selection', (e, reqId: string, kind: 'translate' | 'explain', o: { text: string; paragraph: string; title: string; image?: string }) => {
    const s = settings.get()
    if (o.image) {
      const ask =
        kind === 'translate'
          ? `只翻译这张截图里看得见的文字（正文、图注、表头和表格内容），译成${s.targetLang}，保留原来的分段和表格结构，公式用 LaTeX，术语第一次出现时括注英文。截图外的内容不要补。只输出译文。`
          : `这是论文《${o.title}》里的一块截图（图、表或公式）。用${s.targetLang}解释它在说什么：先一句话说结论，再讲怎么读这张图或这个公式。术语保留英文，公式用 LaTeX，不超过 300 字，不用破折号。`
      const parts: ContentPart[] = [
        { type: 'image_url', image_url: { url: o.image } },
        // 翻译只看截图，带上整页文字模型会连页面别处一起翻；解释才给页面文字当背景
        { type: 'text', text: ask + (kind === 'explain' && o.paragraph ? `\n\n截图所在页的文字（只作背景，不用解释）：\n${o.paragraph.slice(0, 4000)}` : '') }
      ]
      const cacheKey = cyrb53(`${kind}:image\n${s.targetLang}\n${ai.model('vision')}\n${o.image}`)
      const hit = getAiCache(db, cacheKey)
      if (hit) return sendCached(e.sender, reqId, hit)
      streamTo(e.sender, reqId, [{ role: 'user', content: parts }], { cacheKey, kind: 'vision' })
      return
    }
    const messages =
      kind === 'translate' ? selectionTranslateMessages(o.text, s.targetLang) : explainMessages({ ...o, lang: s.targetLang })
    const cacheKey = cyrb53(`${kind}\n${s.targetLang}\n${ai.model()}\n${o.text}\n${kind === 'explain' ? o.paragraph : ''}`)
    const hit = getAiCache(db, cacheKey)
    if (hit) return sendCached(e.sender, reqId, hit)
    streamTo(e.sender, reqId, messages, { cacheKey })
  })
  ipcMain.handle('ai:abort', (_e, reqId: string) => aborts.get(reqId)?.abort())

  // AI 问答
  ipcMain.handle('chat:list', (_e, paperId: string) => listChats(db, paperId))
  ipcMain.handle('chat:context', (_e, paperId: string) => {
    const c = library.contextText(paperId)
    return { truncated: c.truncated, ratio: c.ratio, chars: c.text.length }
  })
  ipcMain.handle('chat:clear', (_e, paperId: string) => {
    db.prepare('UPDATE chats SET cleared = 1 WHERE paper_id = ? AND cleared = 0').run(paperId)
  })
  ipcMain.handle('chat:undoClear', (_e, paperId: string) => {
    const last = db.prepare('SELECT MAX(cleared) m FROM chats WHERE paper_id = ?').get(paperId) as { m: number }
    if (last.m > 0) db.prepare('UPDATE chats SET cleared = 0 WHERE paper_id = ? AND cleared = 1').run(paperId)
  })
  ipcMain.handle('chat:saveAnswer', (_e, paperId: string, content: string) => {
    addChat(db, { id: newId(), paperId, role: 'assistant', content, quote: null, image: null, createdAt: Date.now() })
  })

  // 速览
  ipcMain.handle('glance:get', (_e, paperId: string) => getGlance(db, paperId))
  ipcMain.handle('glance:generate', async (_e, paperId: string) => {
    const paper = getPaper(db, paperId)
    if (!paper) throw new Error(t('论文不存在'))
    const s = settings.get()
    const ctx = library.contextText(paperId, 50000)
    const out = await ai.once(glanceMessages({ title: paper.title, context: ctx.text, lang: s.targetLang }), { json: true, timeoutMs: 180_000 })
    const g = parseJsonLoose<Glance>(out)
    const norm: Glance = {
      tldr: String(g.tldr ?? ''),
      question: points(g.question),
      method: points(g.method),
      findings: points(g.findings),
      keywords: arr(g.keywords),
      worth: Array.isArray(g.worth) ? g.worth.map((w) => ({ section: String(w.section ?? ''), reason: String(w.reason ?? '') })) : []
    }
    saveGlance(db, paperId, norm)
    return norm
  })

  // 高亮和笔记
  ipcMain.handle('ann:list', (_e, paperId: string) => listAnnotations(db, paperId))
  ipcMain.handle('ann:save', (_e, a: Annotation) => {
    saveAnnotation(db, a)
    sync.touch()
    if (a.color !== settings.get().lastColor) settings.set({ lastColor: a.color })
  })
  ipcMain.handle('ann:delete', (_e, id: string) => {
    deleteAnnotation(db, id)
    sync.touch()
  })
  ipcMain.handle('sync:status', () => sync.status)
  ipcMain.handle('sync:now', () => sync.run())
  ipcMain.handle('ann:export', async (_e, paperId: string) => {
    const paper = getPaper(db, paperId)
    if (!paper) throw new Error(t('论文不存在'))
    const anns = listAnnotations(db, paperId)
    const doc = library.reflowDoc(paperId)
    const order = doc ? doc.blocks.filter((b) => b.type === 'heading').map((b) => b.md) : []
    if (doc) {
      const secs = sectionsOf(doc.blocks)
      for (const a of anns) if (a.mode === 'pdf') a.section = sectionForText(doc.blocks, secs, a.text) ?? a.section
    }
    const md = exportMarkdown(paper, anns, order)
    const name = `${safeFileName(paper.title)} ${t('笔记')}.md`
    // 自动化测试时用 PARAREAD_EXPORT_DIR 跳过保存面板
    let target: string | undefined
    if (process.env.PARAREAD_EXPORT_DIR) target = join(process.env.PARAREAD_EXPORT_DIR, name)
    else {
      const r = await dialog.showSaveDialog(mainWin!, { title: t('导出笔记'), defaultPath: join(homedir(), 'Downloads', name), filters: [{ name: 'Markdown', extensions: ['md'] }] })
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    writeFileSync(target, md)
    return target
  })
  ipcMain.handle('ann:sections', (_e, paperId: string) => {
    const doc = library.reflowDoc(paperId)
    return doc ? Object.fromEntries(sectionsOf(doc.blocks)) : {}
  })

  // Scholaread
  ipcMain.handle('sr:preview', () => {
    const f = join(SCHOLAREAD_DIR, 'scholaread.sqlite')
    if (!existsSync(f)) return { found: false, papers: 0, notes: 0 }
    try {
      const { papers, notes } = readScholaread(f)
      return { found: true, papers: papers.length, notes: notes.length }
    } catch (e) {
      log(`读 Scholaread 失败：${(e as Error).message}`)
      return { found: false, papers: 0, notes: 0 }
    }
  })
  ipcMain.handle('sr:import', () => importScholaread())

  // 设置
  ipcMain.handle('settings:get', () => settings.view())
  ipcMain.handle('settings:set', (_e, patch: Partial<Omit<Settings, 'keys'>>) => {
    // 换服务时模型回到那家的推荐
    if (patch.provider && patch.provider !== settings.get().provider && !patch.textModel) {
      const p = providerOf(patch.provider)
      patch = { ...patch, textModel: p.text ?? '', visionModel: p.vision ?? p.text ?? '' }
    }
    if (patch.provider && providerOf(patch.provider).local) void findClaude().catch((e: Error) => log(`找 claude 命令出错：${e.message}`))
    settings.set(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if (patch.uiLang !== undefined) {
      // 换界面语言：菜单重建，各窗口重新加载
      setUiLang(process.env.PARAREAD_UI_LANG ?? patch.uiLang, app.getPreferredSystemLanguages()[0])
      buildMenu()
      for (const w of BrowserWindow.getAllWindows()) w.webContents.reload()
    }
    if (patch.syncEnabled !== undefined || patch.syncDir !== undefined) sync.start()
    broadcast('settings:changed', settings.view())
    return settings.view()
  })
  ipcMain.handle('settings:setKey', (_e, key: string) => {
    settings.setKey(key.trim())
    broadcast('settings:changed', settings.view())
    return settings.view()
  })
  ipcMain.handle('settings:revealKey', () => settings.apiKey().key)
  ipcMain.handle('settings:testKey', async () => {
    try {
      const c = ai.conf()
      // 本机 Claude Code 没有 Key 可验：真问一句，订阅能用就算通过
      if (providerOf(c.provider).local) {
        await ai.once([{ role: 'user', content: 'Reply with the single word: ok' }], { timeoutMs: 60_000 })
        return { ok: true, models: [] }
      }
      const models = await listModels(c.apiKey, c.baseUrl)
      return { ok: true, models }
    } catch (e) {
      return { ok: false, error: (e as Error).message, models: [] }
    }
  })
  ipcMain.handle('settings:localCli', (_e, again?: boolean) => claudeStatus(again))
  ipcMain.handle('settings:testMineru', async () => {
    const p = settings.get().mineruPath
    if (!existsSync(p)) return { ok: false, error: t('找不到 {0}', p) }
    const { spawn } = await import('node:child_process')
    return new Promise((resolve) => {
      const child = spawn(p, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      const t_ = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ ok: false, error: t('超时：30 秒没有响应') })
      }, 30_000)
      child.stdout.on('data', (b) => (out += b))
      child.stderr.on('data', (b) => (out += b))
      child.on('error', (e) => {
        clearTimeout(t_)
        resolve({ ok: false, error: e.message })
      })
      child.on('close', (code) => {
        clearTimeout(t_)
        resolve(code === 0 ? { ok: true } : { ok: false, error: `退出码 ${code}：${out.trim().split('\n').pop() ?? ''}` })
      })
    })
  })
  ipcMain.handle('settings:chooseMineru', async () => {
    const r = await dialog.showOpenDialog((settingsWin ?? mainWin)!, { title: t('选择 mineru-kit'), properties: ['openFile'], defaultPath: dirname(settings.get().mineruPath) })
    if (r.canceled || !r.filePaths[0]) return settings.view()
    settings.set({ mineruPath: r.filePaths[0] })
    return settings.view()
  })
  ipcMain.handle('settings:open', (_e, section?: string) => openSettings(section))
  // 软件里装 MinerU
  ipcMain.handle('mineru:installState', () => mineruInstaller.state)
  ipcMain.handle('mineru:install', () => void mineruInstaller.start())
  ipcMain.handle('mineru:stopInstall', () => mineruInstaller.stop())
  // 自动更新
  ipcMain.handle('word:status', () => wordAddin.status())
  ipcMain.handle('word:install', () => wordAddin.install())
  ipcMain.handle('word:remove', () => wordAddin.remove())
  ipcMain.handle('update:status', () => updater.state)
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:install', () => updater.install())
  // 会员：状态、授权码、结账（打开浏览器，等付款结果）、管理订阅
  let paying: string | null = null
  ipcMain.handle('member:status', () => member.refresh())
  ipcMain.handle('member:activate', (_e, code: string) => member.activate(code))
  ipcMain.handle('member:unbind', () => member.unbind())
  ipcMain.handle('member:checkout', async (_e, plan: 'month' | 'year', currency: 'cny' | 'usd', mode: 'sub' | 'pass') => {
    const r = await member.checkout(plan, currency, mode)
    paying = r.claim
    void shell.openExternal(r.url)
    const res = await member.waitPaid(r.claim, () => paying !== r.claim)
    if (res === 'paid' && settings.get().provider !== 'member') {
      settings.set({ provider: 'member' })
      broadcast('settings:changed', settings.view())
    }
    return res
  })
  ipcMain.handle('member:cancelWait', () => void (paying = null))
  ipcMain.handle('member:portal', async () => void shell.openExternal(await member.portal()))
  // 设置窗的「存储」「关于」要用：版本、数据文件夹，选文件夹、在 Finder 里显示
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir }))
  ipcMain.handle('app:reveal', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('app:chooseDir', async (_e, title: string) => {
    const r = await dialog.showOpenDialog((settingsWin ?? mainWin)!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
}

function points(v: unknown): Glance['question'] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) =>
      typeof x === 'string'
        ? { text: x, sec: '', title: '' }
        : { text: String((x as { text?: unknown }).text ?? ''), sec: String((x as { sec?: unknown }).sec ?? ''), title: String((x as { title?: unknown }).title ?? '') }
    )
    .filter((p) => p.text)
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

function withProgress<T extends { id: string; reflow: { percent: number | null; logLine: string; running: Tier | null; startedAt: number | null } }>(p: T): T {
  const pr = progress.get(p.id)
  if (pr && pr.status === 'running') {
    p.reflow.percent = pr.percent
    p.reflow.logLine = pr.logLine
    p.reflow.running = pr.tier
    p.reflow.startedAt = pr.startedAt
  }
  return p
}

async function importFiles(files: string[]): Promise<unknown[]> {
  const results = []
  for (const f of files) {
    const r = await library.importFile(f)
    if (r.status === 'added') afterImport(r.paper.id)
    if (r.status === 'failed') log(`导入失败 ${f}：${r.error}`)
    results.push(r.status === 'failed' ? r : { status: r.status, paper: withProgress(getPaper(db, r.paper.id)!) })
    broadcast('library:changed', null)
  }
  return results
}

async function importScholaread(): Promise<unknown> {
  const { papers, notes } = readScholaread()
  const result = { papersAdded: 0, papersMatched: 0, papersSkipped: [] as { title: string; reason: string }[], notesAdded: 0, notesSkipped: 0 }
  const idBySr = new Map<number, string>()
  for (const row of papers) {
    const m = mapPaper(row, SCHOLAREAD_DIR)
    if (!m.file) {
      result.papersSkipped.push({ title: m.title, reason: t('找不到 PDF 文件') })
      continue
    }
    const r = await library.importFile(m.file, {
      title: m.title,
      authors: m.authors,
      tags: m.tags,
      doi: m.doi,
      createdAt: m.createdAt,
      lastOpened: m.readAt,
      source: 'scholaread',
      srId: String(m.srId)
    })
    if (r.status === 'failed') {
      result.papersSkipped.push({ title: m.title, reason: r.error })
      continue
    }
    idBySr.set(m.srId, r.paper.id)
    if (r.status === 'added') {
      result.papersAdded++
      afterImport(r.paper.id)
    } else result.papersMatched++
    // Scholaread 的标签就是它的文件夹
    if (m.tags.length) {
      const folders = listFolders(db)
      const ids = m.tags.map((t_) => {
        const f = folders.find((x) => x.name === t_ && !x.parentId)
        if (f) return f.id
        const id = newId()
        createFolder(db, id, t_, null)
        folders.push({ id, name: t_, parentId: null, count: 0 })
        return id
      })
      setPaperFolders(db, r.paper.id, ids, [])
    }
    broadcast('library:changed', null)
  }
  const exists = db.prepare('SELECT 1 FROM annotations WHERE source_id = ?')
  for (const row of notes) {
    const n = mapNote(row)
    const paperId = idBySr.get(n.srPaperId)
    if (!paperId || exists.get(n.sourceId)) {
      result.notesSkipped++
      continue
    }
    const page = library.locatePage(paperId, n.text, n.page)
    saveAnnotation(
      db,
      {
        id: newId(),
        paperId,
        mode: 'pdf',
        color: n.color,
        text: n.text,
        note: n.note,
        page,
        rects: null,
        blockId: null,
        blockHash: null,
        start: null,
        end: null,
        section: '',
        createdAt: n.createdAt,
        updatedAt: n.createdAt
      },
      n.sourceId
    )
    result.notesAdded++
  }
  log(`Scholaread 导入：${JSON.stringify(result)}`)
  broadcast('library:changed', null)
  return result
}

interface WinState {
  x?: number
  y?: number
  width: number
  height: number
}

function loadWinState(): WinState {
  const f = join(dataDir, 'window.json')
  const def = { width: 1480, height: 1000 }
  if (!existsSync(f)) return def
  const s = JSON.parse(readFileSync(f, 'utf8')) as WinState
  const area = screen.getPrimaryDisplay().workArea
  return { ...s, width: Math.min(s.width, area.width), height: Math.min(s.height, area.height) }
}

function saveWinState(w: BrowserWindow): void {
  if (w.isDestroyed()) return
  writeFileSync(join(dataDir, 'window.json'), JSON.stringify(w.getBounds()))
}

function loadRenderer(w: BrowserWindow, hash = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void w.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function createMainWindow(): void {
  const st = loadWinState()
  mainWin = new BrowserWindow({
    ...st,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    // 标题栏 52 高：红绿灯 16 高，2 × y + 16 = 52；侧栏是毛玻璃，内容区自己画底色
    trafficLightPosition: { x: 20, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: false
    }
  })
  mainWin.once('ready-to-show', () => mainWin?.show())
  let t_: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (t_) clearTimeout(t_)
    t_ = setTimeout(() => mainWin && saveWinState(mainWin), 400)
  }
  mainWin.on('resize', save)
  mainWin.on('move', save)
  mainWin.on('closed', () => (mainWin = null))
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\u0000')) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  loadRenderer(mainWin)
}

function openSettings(section?: string): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings:section', section)
    settingsWin.focus()
    return
  }
  // 照会议字幕：900 × 660，左边分区（毛玻璃），右边「左标签、右控件」
  settingsWin = new BrowserWindow({
    width: 900,
    height: 660,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    title: t('设置'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: false, contextIsolation: true }
  })
  settingsWin.once('ready-to-show', () => settingsWin?.show())
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  settingsWin.on('closed', () => (settingsWin = null))
  loadRenderer(settingsWin, section ? `settings/${section}` : 'settings')
}

function sendCommand(cmd: string): void {
  const w = BrowserWindow.getFocusedWindow() ?? mainWin
  if (!w) return
  if (w === settingsWin && cmd !== 'close') mainWin?.webContents.send('menu:command', cmd)
  else w.webContents.send('menu:command', cmd)
}

function buildMenu(): void {
  const c = (label: string, accelerator: string | undefined, cmd: string): MenuItemConstructorOptions => ({ id: cmd, label, accelerator, click: () => sendCommand(cmd) })
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'ParaRead',
      submenu: [
        { role: 'about', label: t('关于 ParaRead') },
        { type: 'separator' },
        { label: t('设置…'), accelerator: 'Cmd+,', click: () => openSettings() },
        { type: 'separator' },
        { role: 'hide', label: t('隐藏 ParaRead') },
        { role: 'hideOthers', label: t('隐藏其他') },
        { role: 'unhide', label: t('全部显示') },
        { type: 'separator' },
        { role: 'quit', label: t('退出 ParaRead') }
      ]
    },
    {
      label: t('文件'),
      submenu: [
        c(t('导入 PDF 或 EPUB…'), 'Cmd+O', 'import'),
        c(t('从网址导入…'), undefined, 'import-url'),
        c(t('全网检索论文…'), 'Shift+Cmd+F', 'web-search'),
        c(t('从 Scholaread 导入'), undefined, 'scholaread'),
        { type: 'separator' },
        c(t('文献信息…'), 'Cmd+I', 'paper-info'),
        { type: 'separator' },
        c(t('导出笔记 Markdown…'), 'Cmd+Shift+E', 'export'),
        { type: 'separator' },
        { role: 'close', label: t('关闭窗口') }
      ]
    },
    {
      label: t('编辑'),
      submenu: [
        { role: 'undo', label: t('撤销') },
        { role: 'redo', label: t('重做') },
        { type: 'separator' },
        { role: 'cut', label: t('剪切') },
        { role: 'copy', label: t('拷贝') },
        { role: 'paste', label: t('粘贴') },
        { role: 'selectAll', label: t('全选') },
        { type: 'separator' },
        c(t('查找'), 'Cmd+F', 'find'),
        c(t('搜索文献库'), 'Cmd+K', 'quick-search')
      ]
    },
    {
      label: t('显示'),
      submenu: [
        c(t('原文'), 'Cmd+1', 'mode-pdf'),
        c(t('对照'), 'Cmd+2', 'mode-reflow'),
        c(t('速览'), 'Cmd+3', 'mode-glance'),
        { type: 'separator' },
        c(t('全文翻译'), undefined, 'translate-all'),
        c(t('框选提问'), undefined, 'box-select'),
        { type: 'separator' },
        c(t('放大'), 'Cmd+=', 'zoom-in'),
        c(t('缩小'), 'Cmd+-', 'zoom-out'),
        c(t('适合宽度'), 'Cmd+0', 'zoom-reset'),
        { type: 'separator' },
        c(t('显示或隐藏侧栏'), 'Ctrl+Cmd+S', 'toggle-left'),
        c(t('显示或隐藏右栏（速览、AI 问答）'), 'Ctrl+Cmd+I', 'toggle-right'),
        c(t('问 AI'), 'Cmd+L', 'ask-ai'),
        { type: 'separator' },
        c(t('返回文献库'), 'Cmd+[', 'back'),
        { type: 'separator' },
        { role: 'reload', label: t('重新载入') },
        { role: 'toggleDevTools', label: t('开发者工具') },
        { role: 'togglefullscreen', label: t('进入全屏') }
      ]
    },
    { label: t('窗口'), role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// 用本应用打开 PDF / EPUB（Finder 的「打开方式」、Zotero 设成用它打开）：导入（已在库就找到那篇）并打开
const pendingOpen: string[] = []
app.on('open-file', (e, path) => {
  e.preventDefault()
  if (!ready) pendingOpen.push(path)
  else void openExternalFile(path)
})
async function openExternalFile(path: string): Promise<void> {
  const r = await library.importFile(path)
  if (r.status === 'failed') {
    broadcast('app:toast', t('打不开 {0}：{1}', path.split('/').pop(), r.error))
    return
  }
  if (r.status === 'added') afterImport(r.paper.id)
  broadcast('library:changed', null)
  if (!mainWin) createMainWindow()
  mainWin?.show()
  mainWin?.webContents.send('app:openPaper', r.paper.id)
}

// 浏览器小书签：pararead://add?url=<当前网页>
app.setAsDefaultProtocolClient('pararead')
const pendingUrls: string[] = []
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (!ready) pendingUrls.push(url)
  else void handleProtocol(url)
})
async function handleProtocol(raw: string): Promise<void> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return
  }
  const target = u.searchParams.get('url')
  if (u.hostname !== 'add' || !target || !urlImporter) return
  if (!mainWin) createMainWindow()
  mainWin?.show()
  broadcast('app:toast', t('正在导入 {0} 的论文…', new URL(target).hostname))
  try {
    const r = await urlImporter.fromInput(target)
    if (r.status === 'noPdf') broadcast('app:toast', t('这个网页没有能直接下载的 PDF') + (r.error ? `（${r.error}）` : ''))
    else if (r.status === 'failed') broadcast('app:toast', t('导入失败：{0}', r.error))
    else mainWin?.webContents.send('app:openPaper', r.paper.id)
  } catch (err) {
    broadcast('app:toast', t('导入失败：{0}', (err as Error).message))
  }
}

// Word 引用插件：本机 HTTPS 服务和清单（src/main/wordAddin.ts）
const wordAddin = new WordAddin({
  dir: join(dataDir, 'word'),
  staticDir: join(__dirname, '../renderer'),
  papers: () => listPapers(db),
  prefs: () => ({ style: settings.get().wordStyle, check: settings.get().wordCheck })
})
const updater = new Updater(app.isPackaged, () => settings.get().autoUpdate, (st) => broadcast('update:state', st))
// 各窗口的 preload 启动时同步来问界面语言
ipcMain.on('i18n:lang', (e) => {
  e.returnValue = uiLang()
})

let ready = false
void app.whenReady().then(() => {
  // PARAREAD_UI_LANG：测试和截图时固定界面语言，不看设置和系统
  setUiLang(process.env.PARAREAD_UI_LANG ?? settings.get().uiLang, app.getPreferredSystemLanguages()[0])
  nativeTheme.themeSource = settings.get().theme
  log(`启动，数据目录 ${dataDir}`)
  registerIpc()
  buildMenu()
  createMainWindow()
  resumeReflow()
  void purgeDeleted()
  ready = true
  sync.start()
  updater.start()
  void (process.env.PARAREAD_WORD_SERVE ? wordAddin.serveForTest() : wordAddin.startIfInstalled())
  // 没有 MinerU 的电脑：第一次打开就自己开始下载；上次没装完的接着装
  if (!mineruReady() && (!settings.get().onboarded || mineruInstaller.pending())) void mineruInstaller.start()
  mainWin?.webContents.once('did-finish-load', () => {
    for (const f of pendingOpen.splice(0)) void openExternalFile(f)
    for (const u of pendingUrls.splice(0)) void handleProtocol(u)
  })
  app.on('activate', () => {
    if (!mainWin) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// 退出时停掉 MinerU；标了删除的论文下次启动时移到废纸篓（删除后本次运行里还能撤销）
// 退出：记日志；3 秒还没退完（有窗口或请求挡着）就直接退
app.on('before-quit', () => {
  log('退出：before-quit')
  setTimeout(() => {
    log('退出：3 秒没退完，强制退出')
    app.exit(0)
  }, 3000).unref()
})

app.on('will-quit', () => {
  log('退出：will-quit')
  mineru.stopAll()
  mineruInstaller.stop()
  wordAddin.stop()
  translator.stop()
  for (const c of aborts.values()) c.abort()
  db.close()
  // 到这里要存的都存好了（数据库已关，设置、会员、窗口位置是同步写的文件；界面不用 localStorage、Cookie）。
  // 剩下的是 Chromium 自己的收尾：等网络服务进程落盘（最多 10 秒）、等线程池里的后台任务。系统正忙时
  // （几个 G 的 MinerU 刚被杀）这一步实测约 6 次里有 1 次要 3 到 15 秒，期间 Dock 上图标还在、再点打不开。
  // 所以最多给它 1.5 秒，没退完就强杀自己。will-quit 之后进程里的定时器不再跑，由一个脱离的 sh 来杀；
  // 杀之前核对这个进程号还是本应用。更新包由系统的 ShipIt 在进程退出后装，不受影响。
  spawn('/bin/sh', ['-c', 'sleep 1.5; [ "$(ps -p "$1" -o comm=)" = "$2" ] && kill -9 "$1"', 'sh', String(process.pid), process.execPath], { detached: true, stdio: 'ignore' }).unref()
  app.exit(0)
})

async function purgeDeleted(): Promise<void> {
  const gone = db.prepare('SELECT id, file_hash, updated_at FROM papers WHERE deleted = 1').all() as { id: string; file_hash: string; updated_at: number }[]
  for (const g of gone) {
    tombstone(db, 'paper', g.file_hash, g.updated_at || Date.now())
    const f = library.pdfPath(g.id)
    if (existsSync(f)) await shell.trashItem(f).catch(() => rmSync(f, { force: true }))
    const ep = library.epubPath(g.id)
    if (existsSync(ep)) await shell.trashItem(ep).catch(() => rmSync(ep, { force: true }))
    for (const t_ of ['papers WHERE id', 'page_text WHERE paper_id', 'annotations WHERE paper_id', 'chats WHERE paper_id', 'reflow WHERE paper_id', 'glances WHERE paper_id', 'paper_folders WHERE paper_id', 'paper_cache WHERE paper_id', 'reading_log WHERE paper_id'])
      db.prepare(`DELETE FROM ${t_} = ?`).run(g.id)
    rmSync(join(dataDir, 'reflow', g.id), { recursive: true, force: true })
    rmSync(join(dataDir, 'thumbs', `${g.id}.jpg`), { force: true })
  }
}
