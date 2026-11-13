export type ReadMode = 'pdf' | 'reflow' | 'glance'
export type HlColor = 'yellow' | 'green' | 'blue' | 'red'
export const HL_COLORS: HlColor[] = ['yellow', 'green', 'blue', 'red']
export type Tier = 'flash' | 'basic' | 'simple' | 'edited' // edited：调整区域后重新生成的

export interface Paper {
  id: string
  title: string
  authors: string[]
  year: number | null
  tags: string[]
  pageCount: number
  progress: number // 0 到 1
  lastOpened: number | null
  createdAt: number
  lastMode: ReadMode | null
  lastPosition: ReadPosition | null
  fileName: string
  doi: string | null
  source: 'import' | 'scholaread' | 'zotero' | 'url' | 'search' | 'sync'
  reflow: ReflowState
  folders: string[]
  venue: string | null
  abstract: string | null
  url: string | null
  publisher: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  published: string | null
  arxiv: string | null
  kind: 'pdf' | 'epub' | 'link' // link：只有链接和信息，还没有全文
  scanned: boolean
  engine: Tier | null // 用户手动选的重排档位；null 用最好的
  readMs: number
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  count: number
}

export interface ReadPosition {
  // 对照模式：顶部那块的段落哈希、文字前缀和块内偏移；原文模式：页码和页内比例
  blockHash?: string
  textPrefix?: string
  heading?: string
  offset?: number
  page?: number
  pageFrac?: number
  zoom?: number
}

export type JobStatus = 'none' | 'queued' | 'running' | 'done' | 'failed'

export interface ReflowState {
  // 当前可用的最好档位
  ready: Tier | null
  flash: JobStatus
  basic: JobStatus
  running: Tier | null
  startedAt: number | null
  percent: number | null
  logLine: string
  error: string | null
}

export type BlockType = 'heading' | 'paragraph' | 'caption' | 'equation' | 'image' | 'table' | 'details'

export interface Block {
  id: string // 段落哈希加序号，块在本文中唯一
  hash: string // 段落文字哈希，跨档位对齐用
  type: BlockType
  level?: number
  md: string
  translatable: boolean
}

export interface ReflowDoc {
  paperId: string
  tier: Tier
  blocks: Block[]
}

export interface Annotation {
  id: string
  paperId: string
  mode: 'pdf' | 'reflow'
  color: HlColor
  text: string
  note: string
  page: number | null
  rects: number[][] | null // 原文模式：页内归一化矩形 [x, y, w, h]
  blockId: string | null
  blockHash: string | null
  start: number | null
  end: number | null
  section: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  paperId: string
  role: 'user' | 'assistant'
  content: string
  quote: string | null
  image: string | null
  createdAt: number
  error?: string | null
  reasoning?: string | null // 深度思考的内容
  paperIds?: string[] // 一起问的其他论文
  thinkMs?: number | null
}

// AI 重点句：研究目标、方法、结论、创新点
export type MajorType = 'objective' | 'method' | 'result' | 'novelty'
export interface MajorPoint {
  blockId: string
  text: string
  type: MajorType
}

export interface Concept {
  term: string
  explain: string
}

// 速览的一条要点：sec 是小节编号（如 III-B），title 是论文里的小节原标题，点来源 chip 按它跳转
export interface GlancePoint {
  text: string
  sec: string
  title: string
}

export interface Glance {
  tldr: string
  question: GlancePoint[]
  method: GlancePoint[]
  findings: GlancePoint[]
  keywords: string[]
  worth: { section: string; reason: string }[]
}

export interface Settings {
  provider: string // shared/providers.ts 的 id
  keys: Record<string, string> // 每家服务一把 Key
  customBaseUrl: string // provider 是 custom 时的地址
  textModel: string
  visionModel: string
  targetLang: string
  mineruPath: string
  theme: 'system' | 'light' | 'dark'
  readSize: number
  srcFont: 'serif' | 'sans'
  display: 'src' | 'both' | 'tr'
  trStyle: 'text' | 'fill'
  leftW: number
  rightW: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  libSideW: number
  lastColor: HlColor
  pdfInvert: boolean
  libView: 'table' | 'card'
  libSort: { key: 'opened' | 'added' | 'title' | 'year' | 'progress'; desc: boolean }
  libFilter: string // all | reading | unread | done | folder:<id>
  titleTr: 'off' | 'orig' | 'tr' // 文献库标题翻译：不翻译、原标题在前、译名在前
  recentSearches: string[]
  zoteroDir: string | null
  aiLang: string // AI 回答用的语言，空就跟翻译目标语言
  chatSize: number // AI 回答字号
  chatFloat: boolean // AI 问答用悬浮窗
  thinking: boolean // AI 问答默认开深度思考
  agentDir: string // 研究项目放在哪，空是 文稿/ParaRead 项目
  syncEnabled: boolean // 多设备同步（iCloud 云盘）
  syncDir: string // 空是 iCloud 云盘/ParaRead 同步
  syncDevice: string // 这台电脑在同步里的编号（第一次打开时随机生成）
  uiLang: string // 界面语言：auto 跟系统，或 shared/i18n 的九种之一
  onboarded: boolean // 首次引导走完或跳过了
  autoUpdate: boolean // 自动检查更新
  wordStyle: 'gbt' | 'apa' | 'mla' | 'ieee' // Word 插件新文档默认用的引用格式
  wordCheck: boolean // Word 插件里显示「格式检查」
}

// 原生菜单的一项（右键菜单、下拉都走 ui:menu）
export interface MenuItem {
  id?: string
  label?: string
  type?: 'separator'
  enabled?: boolean
  checked?: boolean
  submenu?: MenuItem[]
}

export interface SettingsView extends Omit<Settings, 'keys'> {
  apiKeyMasked: string
  apiKeySource: 'settings' | 'env' | 'none'
  apiKeyEnv: string // 来自哪个环境变量
  mineruInstalled: boolean // mineruPath 指的 mineru-kit 在不在
}

export interface StreamEvent {
  reqId: string
  delta?: string
  reasoning?: string
  done?: boolean
  error?: string
}

export interface ScholareadPreview {
  found: boolean
  papers: number
  notes: number
}

export interface ScholareadResult {
  papersAdded: number
  papersMatched: number
  papersSkipped: { title: string; reason: string }[]
  notesAdded: number
}

// Word 引用插件的状态（设置 › Word 插件）
/** 本机 Claude Code 的状态：找到没有、哪个版本、登录了没有（null 是问不出来） */
export interface LocalCliStatus {
  found: boolean
  path: string
  version: string
  loggedIn: boolean | null
}

export interface WordStatus {
  word: boolean // 这台电脑装了 Microsoft Word
  wordVersion: string
  wps: boolean
  installed: boolean // 清单已经放进 Word 的侧载目录
  trusted: boolean // 本机 HTTPS 用的证书在、没过期、系统信任
  running: boolean // 给插件用的本机服务在跑
  error: string
}
