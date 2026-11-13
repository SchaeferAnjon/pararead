import type {
  Annotation,
  ChatMessage,
  Concept,
  Folder,
  MajorPoint,
  MenuItem,
  Tier,
  Glance,
  Paper,
  ReflowDoc,
  ScholareadPreview,
  Settings,
  SettingsView,
  StreamEvent,
  WordStatus,
  LocalCliStatus,
  NoteEntry,
  Term,
  Ink
} from '@shared/types'
import type { SenseSentence } from '@shared/senses'

export interface ReflowProgress {
  paperId: string
  tier: 'flash' | 'basic'
  status: 'queued' | 'running' | 'done' | 'failed'
  percent: number | null
  stage: string
  logLine: string
  startedAt: number | null
  error?: string
}

export interface SearchMatch {
  id: string
  where: 'title' | 'author' | 'abstract' | 'venue' | 'text'
  snippet: string
}

export type PaperPatch = Partial<
  Pick<
    Paper,
    'title' | 'authors' | 'year' | 'tags' | 'progress' | 'lastOpened' | 'lastMode' | 'lastPosition' | 'doi' | 'venue' | 'abstract' | 'url' | 'publisher' | 'volume' | 'issue' | 'pages' | 'published' | 'arxiv' | 'engine'
  >
>

export type { ResearchKind, ResearchMessage, ResearchMeta, ResearchSession, Source, GuideMap } from '../../main/research'
import type { ResearchKind, ResearchMessage, ResearchSession } from '../../main/research'
export type { AgentSession, AgentStep, Project } from '../../main/agent'
export type { SyncStatus } from '../../main/sync'
export type { MemberStatus } from '../../main/member'
export type { MineruInstallState } from '../../main/mineruInstall'
import type { MineruInstallState } from '../../main/mineruInstall'
export type { UpdateState } from '../../main/updater'
import type { UpdateState } from '../../main/updater'
import type { MemberStatus } from '../../main/member'
export type { Layout, Region, RegionType } from '../../main/layout'
export { REGION_TYPES } from '../../main/layout'
import type { Layout } from '../../main/layout'
import type { SyncStatus } from '../../main/sync'
import type { AgentSession, Project } from '../../main/agent'

export interface SearchHit {
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  doi: string | null
  arxiv: string | null
  pdfUrl: string | null
  url: string | null
  citations: number | null
  tldr: string | null
}

export type ZoteroState = 'waiting' | 'importing' | 'done' | 'duplicate' | 'failed' | 'paused' | 'skipped'

export interface ZoteroScan {
  found: boolean
  dir?: string
  collections?: { id: number; name: string; parentId: number | null; count: number }[]
  items?: { itemId: number; title: string; authors: string[]; year: number | null; collections: number[]; hasFile: boolean; fileType: string | null; inLibrary: boolean }[]
}

export type UrlImportResult = ImportResult | { status: 'noPdf'; meta: Partial<Paper>; landing: string | null; error?: string }

export type ImportResult = { status: 'added' | 'duplicate'; paper: Paper } | { status: 'failed'; file: string; error: string }

export interface ScholareadImportResult {
  papersAdded: number
  papersMatched: number
  papersSkipped: { title: string; reason: string }[]
  notesAdded: number
  notesSkipped: number
}

type Off = () => void

export interface Api {
  listPapers(): Promise<Paper[]>
  getPaper(id: string): Promise<Paper | null>
  importPdfs(paths?: string[]): Promise<ImportResult[]>
  updatePaper(id: string, patch: PaperPatch): Promise<void>
  deletePapers(ids: string[]): Promise<void>
  restorePapers(ids: string[]): Promise<void>
  revealPaper(id: string): Promise<void>
  pdfData(id: string): Promise<Uint8Array>
  menu(items: MenuItem[]): Promise<string | null>
  pageTexts(id: string): Promise<string[]>
  listFolders(): Promise<Folder[]>
  createFolder(name: string, parentId: string | null): Promise<string>
  renameFolder(id: string, name: string): Promise<void>
  moveFolder(id: string, parentId: string | null): Promise<void>
  deleteFolder(id: string): Promise<string[]>
  setFolders(ids: string[], add: string[], remove: string[]): Promise<void>
  searchPapers(q: string): Promise<SearchMatch[]>
  thumb(id: string): Promise<string | null>
  saveThumb(id: string, dataUrl: string): Promise<void>
  enrichPaper(id: string): Promise<Paper | null>
  importUrl(input: string): Promise<UrlImportResult>
  importLink(meta: Partial<Paper> & { title: string }): Promise<ImportResult>
  scholarSearch(q: string, opts?: { yearFrom?: number }): Promise<{ hits: SearchHit[]; source: string; error?: string }>
  scholarAdd(hit: SearchHit): Promise<ImportResult & { linkOnly?: boolean; error?: string }>
  attachPdf(id: string, path?: string): Promise<Paper | null>
  zoteroScan(dir?: string): Promise<ZoteroScan>
  zoteroChooseDir(): Promise<string | null>
  zoteroImport(itemIds: number[], mirrorFolders: boolean): Promise<number>
  zoteroControl(action: 'pause' | 'resume' | 'cancel'): Promise<void>
  onZoteroProgress(cb: (p: { itemId: number; state: ZoteroState; error?: string; paperId?: string }) => void): Off
  onZoteroFinished(cb: () => void): Off
  onOpenPaper(cb: (id: string) => void): Off
  onToast(cb: (text: string) => void): Off
  getReflow(id: string): Promise<ReflowDoc | null>
  reflowProgress(id: string): Promise<ReflowProgress | null>
  retryReflow(id: string): Promise<void>
  simpleReflow(id: string): Promise<void>
  translate(paperId: string, texts: string[], priority: boolean): Promise<Record<string, string>>
  cancelTranslate(paperId: string): Promise<void>
  /** 意群：返回已经缓存的（键是 sensesKey），没有的排队去问，结果走 onSensesResult */
  senses(paperId: string, items: { en: string; zh: string }[]): Promise<Record<string, SenseSentence[]>>
  cancelSenses(paperId: string): Promise<void>
  aiSelection(reqId: string, kind: 'translate' | 'explain', o: { text: string; paragraph: string; title: string; image?: string }): Promise<void>
  aiAbort(reqId: string): Promise<void>
  chatList(paperId: string): Promise<ChatMessage[]>
  chatContext(paperId: string): Promise<{ truncated: boolean; ratio: number; chars: number }>
  chatSend(
    reqId: string,
    paperId: string,
    msg: { content: string; quote: string | null; image: string | null; context?: string | null; paperIds?: string[]; thinking?: boolean }
  ): Promise<ChatMessage>
  chatDelete(id: string): Promise<void>
  chatExport(paperId: string, onlyId?: string): Promise<string | null>
  majorPoints(paperId: string, density?: 'less' | 'default' | 'more', force?: boolean): Promise<MajorPoint[]>
  /** 术语表（问一次 AI，按论文缓存） */
  terms(paperId: string, force?: boolean): Promise<Term[]>
  concepts(paperId: string, force?: boolean): Promise<{ concepts: Concept[]; questions: string[] }>
  refsLookup(entry: string): Promise<SearchHit | null>
  readTime(paperId: string, ms: number): Promise<void>
  readStats(paperId: string): Promise<{ total: number; days: { day: string; ms: number }[] }>
  setEngine(paperId: string, tier: Tier | null): Promise<ReflowDoc | null>
  translateRedo(paperId: string, text: string): Promise<Record<string, string>>
  researchList(): Promise<ResearchSession[]>
  researchGet(id: string): Promise<{ session: ResearchSession; messages: ResearchMessage[] } | null>
  researchCreate(kind: ResearchKind, paperIds?: string[]): Promise<string>
  researchRename(id: string, title: string): Promise<void>
  researchDelete(id: string): Promise<void>
  researchSend(reqId: string, sessionId: string, text: string): Promise<ResearchMessage>
  onResearchProgress(cb: (p: { sessionId: string; stage: string; detail: string }) => void): Off
  onResearchChanged(cb: () => void): Off
  agentProjects(): Promise<Project[]>
  agentCreateProject(name: string): Promise<Project>
  agentRenameProject(id: string, name: string): Promise<void>
  agentDeleteProject(id: string): Promise<void>
  agentSetInstructions(id: string, text: string): Promise<void>
  agentFiles(id: string): Promise<{ path: string; dir: boolean; size: number; mtime: number }[]>
  agentReadFile(id: string, rel: string): Promise<string>
  agentReveal(id: string, rel?: string): Promise<void>
  agentOpenFile(id: string, rel: string): Promise<string>
  agentSessions(id: string): Promise<AgentSession[]>
  agentNewSession(id: string): Promise<AgentSession>
  agentDeleteSession(id: string, sid: string): Promise<void>
  agentSend(projectId: string, sid: string, text: string): Promise<void>
  agentStop(sid: string): Promise<void>
  agentAnswer(sid: string, callId: string, answer: string): Promise<void>
  exportPdf(paperId: string, o: { layout: 'both' | 'src' | 'tr'; highlights: boolean; notes: boolean }): Promise<string | null>
  onExportProgress(cb: (p: { paperId: string; percent: number; stage: string }) => void): Off
  printReady(): void
  layoutGet(paperId: string): Promise<{ layout: Layout; edited: boolean }>
  layoutSave(paperId: string, layout: Layout, crops: Record<string, string>): Promise<ReflowDoc | null>
  layoutReset(paperId: string): Promise<ReflowDoc | null>
  onLayoutProgress(cb: (p: { paperId: string; line: string }) => void): Off
  syncStatus(): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  onSyncStatus(cb: (s: SyncStatus) => void): Off
  onAgentEvent(cb: (e: { sessionId: string; type: string; [k: string]: unknown }) => void): Off
  chatClear(paperId: string): Promise<void>
  chatUndoClear(paperId: string): Promise<void>
  glanceGet(paperId: string): Promise<Glance | null>
  glanceGenerate(paperId: string): Promise<Glance>
  annList(paperId: string): Promise<Annotation[]>
  /** 全库的标注，连着论文的标题、作者、年份 */
  annAll(): Promise<NoteEntry[]>
  inkList(paperId: string): Promise<Ink[]>
  inkSave(k: Ink): Promise<void>
  inkDelete(id: string): Promise<void>
  /** 截窗口里的一块，返回 PNG 的 data URL */
  capture(r: { x: number; y: number; width: number; height: number }): Promise<string>
  /** 存一条标注；返回它在原文的第几页（对照模式里做的由主进程去找，找不到是 null） */
  annSave(a: Annotation): Promise<number | null>
  annDelete(id: string): Promise<void>
  annExport(paperId: string): Promise<string | null>
  annSections(paperId: string): Promise<Record<string, string>>
  srPreview(): Promise<ScholareadPreview>
  srImport(): Promise<ScholareadImportResult>
  getSettings(): Promise<SettingsView>
  setSettings(patch: Partial<Omit<Settings, 'keys'>>): Promise<SettingsView>
  setApiKey(key: string): Promise<SettingsView>
  revealApiKey(): Promise<string>
  testKey(): Promise<{ ok: boolean; error?: string; models: string[] }>
  /** 本机 Claude Code 找到没有、登录了没有；again 重新找一遍 */
  localCli(again?: boolean): Promise<LocalCliStatus>
  testMineru(): Promise<{ ok: boolean; error?: string }>
  chooseMineru(): Promise<SettingsView>
  openSettings(section?: string): Promise<void>
  onSettingsSection(cb: (section: string) => void): Off
  appInfo(): Promise<{ version: string; dataDir: string }>
  mineruInstallState(): Promise<MineruInstallState>
  mineruInstall(): Promise<void>
  mineruStopInstall(): Promise<void>
  onMineruInstall(cb: (s: MineruInstallState) => void): Off
  /** 浏览器插件的接收口开着没有，插件文件夹在哪 */
  connectorStatus(): Promise<{ running: boolean; port: number; error: string; dir: string }>
  connectorReveal(): Promise<void>
  connectorOpenBrowser(name: 'Google Chrome' | 'Microsoft Edge'): Promise<void>
  wordStatus(): Promise<WordStatus>
  /** 装 Word 插件：系统会弹一次密码框（信任本机证书） */
  wordInstall(): Promise<WordStatus>
  wordRemove(): Promise<WordStatus>
  updateStatus(): Promise<UpdateState>
  updateCheck(): Promise<UpdateState>
  updateInstall(): Promise<boolean>
  onUpdateState(cb: (s: UpdateState) => void): Off
  memberStatus(): Promise<MemberStatus>
  memberActivate(code: string): Promise<MemberStatus>
  memberUnbind(): Promise<MemberStatus>
  memberCheckout(plan: 'month' | 'year', currency: 'cny' | 'usd', mode: 'sub' | 'pass'): Promise<'paid' | 'expired' | 'stopped'>
  memberCancelWait(): Promise<void>
  memberPortal(): Promise<void>
  onMemberStatus(cb: (s: MemberStatus | null) => void): Off
  reveal(path: string): Promise<string>
  chooseDir(title: string): Promise<string | null>
  filePath(f: File): string
  onReflowProgress(cb: (p: ReflowProgress) => void): Off
  onReflowDone(cb: (p: { paperId: string; tier: string }) => void): Off
  onReflowFailed(cb: (p: { paperId: string; tier: string; error: string }) => void): Off
  onLibraryChanged(cb: () => void): Off
  onTranslateResult(cb: (r: { paperId: string; key: string; text?: string; error?: string }) => void): Off
  onSensesResult(cb: (r: { paperId: string; key: string; data?: SenseSentence[]; error?: string }) => void): Off
  onStream(cb: (e: StreamEvent) => void): Off
  onSettings(cb: (s: SettingsView) => void): Off
  onCommand(cb: (cmd: string) => void): Off
}

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api

let seq = 0
export function reqId(): string {
  return `r${Date.now().toString(36)}${(seq++).toString(36)}`
}

// 订阅一次流式请求：返回取消函数
export function streamRequest(
  start: (id: string) => Promise<unknown>,
  on: { delta: (full: string) => void; done: (full: string) => void; error: (msg: string, partial: string) => void; reasoning?: (full: string) => void }
): { id: string; stop: () => void } {
  const id = reqId()
  let full = ''
  let thought = ''
  const off = api.onStream((e) => {
    if (e.reqId !== id) return
    if (e.reasoning) {
      thought += e.reasoning
      on.reasoning?.(thought)
    }
    if (e.delta) {
      full += e.delta
      on.delta(full)
    }
    if (e.done) {
      off()
      on.done(full)
    }
    if (e.error) {
      off()
      on.error(e.error, full)
    }
  })
  start(id).catch((err: Error) => {
    off()
    on.error(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), full)
  })
  return {
    id,
    stop: () => {
      void api.aiAbort(id)
    }
  }
}

export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
