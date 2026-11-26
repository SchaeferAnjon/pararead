import type { Material } from '@cn/ai-chat/materials'
import type { ThinkLevel } from './thinking'
import type { SenseStyle, TrStyle } from './trStyles'
// 看法五格（2026-11-23 用户定）：原文、对照（左原页右同版面译文页）、译文（只看同版面译文页）、重排（MinerU 重排的上下 / 左右对照）、速览
export type ReadMode = 'pdf' | 'dual' | 'mono' | 'reflow' | 'glance'
/** 划线的颜色：前四种是默认四种含义（重点、定义、想引用、看不懂）的颜色，后四种给画布笔记那边「加一种」（@cn/format 的 HL_COLORS） */
export type HlColor = 'yellow' | 'green' | 'blue' | 'red' | 'orange' | 'purple' | 'pink' | 'gray'
export const HL_COLORS: HlColor[] = ['yellow', 'green', 'blue', 'red']
/** 标注上打的标签：这一处看不懂、对这一处有质疑 */
export type AnnLabel = 'confused' | 'doubt'
export const ANN_LABELS: AnnLabel[] = ['confused', 'doubt']
/** 标签的处理状态：看不懂是 还没懂 → 懂了；有质疑是 待判断 → 质疑成立 / 质疑不成立 / 还要查 */
export type LabelStatus = 'open' | 'understood' | 'pending' | 'upheld' | 'dismissed' | 'checking'
/** 讲解的一版：focus 是围着讲的「卡在哪」（空是整句），raw 是模型按标签分节的原文；lit 是给模型看过的文献候选 */
export interface ExplainVersion {
  focus: string
  raw: string
  at: number
  lit?: LitItem[]
  chunks?: { en: string; zh: string }[] // 拆开看：这段有意群对齐时用它（原文一块对译文一块），没有时模型在 raw 里自己切
}
export interface LitItem {
  n: number
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  url: string | null
  cited: string | null // 本文自己引用的写编号，如 [16]
}
/** 几处一起讲的那一段：挂在这几处的每一条上 */
export interface GroupExplain {
  key: string
  ids: string[]
  raw: string
  at: number
}
/** 存在标注上的讲解：每次「换个讲法」留一版；misses 是说过几次「还不懂」 */
export interface ExplainRecord {
  versions: ExplainVersion[]
  misses: number
  group?: GroupExplain | null
  chat?: ExplainTurn[] // 讲解下面「接着问这一处」的一问一答
}
/** 讲解卡里接着问的一轮 */
export interface ExplainTurn {
  q: string
  a: string
  at: number
}
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
  /** 在连上的画布笔记库里的一篇（PDF 不拷贝，直接读库里那份；划线、问答写进旁边那篇配对笔记）：库的根目录、库里的路径、库或文件现在找不找得到 */
  cn: { root: string; path: string; missing: boolean } | null
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

/** 后台解析的状态条：这一批几篇、解析完几篇、正在解析哪篇（标题）、暂停着没有（manual 手动，busy 等用户停手） */
export interface BgStatus {
  total: number
  done: number
  current: { paperId: string; tier: 'flash' | 'basic' } | null
  title: string | null
  paused: 'manual' | 'busy' | null
}

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
  style?: 'highlight' | 'underline' | 'box' // 高亮（底色）、划线，还是整块（公式、图、表）用颜色框住；老数据没有这一项，算高亮
  label?: AnnLabel | null // 看不懂 / 有质疑
  kind?: string | null // 划线的含义（@cn/format 的键：key 重点、def 定义、cite 想引用、confused 看不懂…）；老数据没有，按颜色和标签算（shared/cnLink.ts 的 kindOf）
  hl?: string | null // 写进画布笔记配对笔记里的那一条的身份（cn:hl=p2-h1）；不在库里的论文没有
  labelStatus?: LabelStatus | null // 标签的处理状态；空是还没处理（看不懂是还没懂，有质疑是待判断）
  explain?: ExplainRecord | null // 按标签讲的讲解，存下来再看不再花 AI
  side?: 'tr' // 对照、译文看法里划在译页上的（页码、框照原页，版面一样）；没有是原页
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

/**
 * 在对照、译文看法里框了一块问的：哪一页、框在页上的比例位置（原页、译页版面一样，两边通用）、截的哪一边，两边的截图。
 * 写进配对笔记时页码链接永远指原 PDF，截图照截的那边写（译文的文件名带 .zh，图注「我框的 · 译文」）
 */
export interface ChatBox {
  page: number
  rect: [number, number, number, number]
  side: 'src' | 'tr' | 'both'
  src: string | null
  tr: string | null
}

export interface ChatMessage {
  id: string
  paperId: string
  role: 'user' | 'assistant'
  content: string
  quote: string | null
  image: string | null
  box?: ChatBox | null
  createdAt: number
  error?: string | null
  reasoning?: string | null // 深度思考的内容
  paperIds?: string[] // 一起问的其他论文
  thinkMs?: number | null
  meta?: ChatMeta
}

/** 一条问答的附加信息（2026-11-23 起对话照画布笔记：谁来答、贴的图、命令行做的几步） */
export interface ChatMeta {
  /** 谁答的：引擎 id（画布笔记那十家，或 'pararead' 是设置里那家服务商）、模型、effort，和回答头上写的那一行 */
  pick?: { engine: string; model?: string; effort?: string }
  label?: string
  /** 你发的那句带的材料（引的段、贴的图，图是数据目录 pasted/ 里的名字），字里的 ①② 是它们的位置 */
  mats?: Material[]
  /** 全能模式下命令行自己做的几步（跑命令、读写文件、上网） */
  steps?: { id: string; tool: string; input: Record<string, unknown>; status: 'run' | 'ok' | 'err'; detail?: string }[]
  /** 出错的原话（回答没答完） */
  error?: string
}

// AI 重点句：研究目标、方法、结论、创新点
export type MajorType = 'objective' | 'method' | 'result' | 'novelty'
export interface MajorPoint {
  blockId: string
  text: string
  type: MajorType
}

/** 术语表的一条：term 是论文里的原样写法，zh 是译名，explain 是一句解释 */
export interface Term {
  term: string
  zh: string
  explain: string
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
  trStyle: TrStyle // 译文样式，十二种（shared/trStyles.ts）
  trLayout: 'stack' | 'side' // 双语的排法：译文跟在原文下面，或者原文在左、译文在右
  termMarks: boolean // 正文里给术语画虚线、悬停看解释
  defaultEngine: 'flash' | 'basic' // 默认用哪种重排：basic 是导入后快速先出、精细好了换上；flash 是只用快速，精细不自动跑（每篇在阅读页还能单独换）
  bgParse: 'opened' | 'vault' // 画布笔记库里的论文什么时候解析：打开哪篇解析哪篇（默认），或连着的库都在后台解析（低优先级、用户在操作时暂停）
  basicBroken: { error: string; at: number } | null // 精细解析在这台电脑上失败过（环境问题）：之后不再每篇自动跑，设置里能「重试精细解析」
  senseGroups: boolean // 双语时的意群显示：一句原文配一句译文，原文的一块和译文里对它的那几段同色
  senseStyle: SenseStyle // 意群怎么上色：字换成这一块的颜色，或者字不变色、底下画同色的线
  leftW: number
  rightW: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  libSideW: number
  lastColor: HlColor
  ideaHow: IdeaHow // 收灵感时「写论文时」上次选的：直接引原句还是转述
  ideaGroup: 'topic' | 'paper' | 'time' // 灵感库按什么分组
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
  thinkLevels: Record<string, ThinkLevel> // AI 问答的思考强度，每个模型记一份（键是 shared/thinking.ts 的 thinkKey）；没记过的用最省的一档
  explainPrefetch: boolean // 打了「看不懂」「有质疑」以后在后台先备好讲解（默认关：不自动花额度）
  agentDir: string // 研究项目放在哪，空是 文稿/ParaRead 项目
  syncEnabled: boolean // 多设备同步（iCloud 云盘）
  syncDir: string // 空是 iCloud 云盘/ParaRead 同步
  syncDevice: string // 这台电脑在同步里的编号（第一次打开时随机生成）
  uiLang: string // 界面语言：auto 跟系统，或 shared/i18n 的九种之一
  onboarded: boolean // 首次引导走完或跳过了
  autoUpdate: boolean // 自动检查更新
  wordStyle: 'gbt' | 'apa' | 'mla' | 'ieee' // Word 插件新文档默认用的引用格式
  wordCheck: boolean // Word 插件里显示「格式检查」
  bibDir: string // 文献库自动导出 .bib 放在哪个文件夹（文件名 ParaRead.bib），空是不导出
  // AI 问答由谁答（2026-11-23 起照画布笔记，输入框底下一键切）：engine 是画布笔记那十家（本机命令行、API Key、本机模型）
  // 或 'pararead'（上面 provider 那家，会员时走会员）。翻译、意群这类批量小请求一直走 provider，不跟这里
  chatPick: { engine: string; model?: string; effort?: string }
  chatToNote: boolean // 右栏问答答完记进连着的画布笔记库里这篇的配对笔记（照画布笔记 0.5.7「记笔记」开关，默认开）
  omni: boolean // 全能模式：命令行在 AI 工作目录里和终端里一样能读写文件、跑命令、上网（照画布笔记，默认开）
  borrowAsked: string[] // 问过「用画布笔记那把？」的几家（ApiId），答过就不再问
  openView: 'dual' | 'paper-reflow' | 'pdf' // 打开一篇还没换过看法的 PDF：都先看对照；论文看重排、课件（横版页）看对照；看原文
  trOnOpen: boolean // 打开就翻正在看的几页、后面边看边翻；关着要点「翻成对照」才翻
  trService: '' | 'member' | 'deepseek' | 'claude-code' | 'ai' // 翻译、意群这类批量小请求用哪家；空是自动（会员或 DeepSeek）
  trCcModel: string // 翻译用本机 Claude Code 时的模型（haiku / sonnet / opus，2026-11-25 加，默认照旧 haiku）
  trCcEffort: ThinkLevel // 翻译用本机 Claude Code 时的档位（--effort，默认 low）
  dualLayout: 'side' | 'stack' // 对照看法：原页和译页左右并排，还是上下一页一页交替
  cnVaults: CnVault[] // 连上的画布笔记库（第二个来源）
  cnLastPlace: { root: string; folder: string } | null // 「放到画布笔记…」上次放进的文件夹（弹窗默认停在这里）
}

/** 连上的一个画布笔记库：根目录、勾上的文件夹（库里的相对路径，'' 是最外层）、藏起来的单篇（库里的相对路径） */
export interface CnVault {
  root: string
  folders: string[]
  hidden: string[]
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
  trServiceName: string // 翻译实际用的哪家（trService 是自动时按会员、Key 算出来的）
  trServiceError: string | null // 翻译用的那一家现在用不了的原因
}

export interface StreamEvent {
  reqId: string
  delta?: string
  reasoning?: string
  done?: boolean
  error?: string
  /** 全能模式下命令行自己的一步（开始、做完）：对话里的步骤行 */
  step?: NonNullable<ChatMeta['steps']>[number]
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

/** 全库笔记页里的一条：标注加它所在的论文 */
export interface NoteEntry extends Annotation {
  paperTitle: string
  paperAuthors: string[]
  paperYear: number | null
}

/** 原文模式里用笔画的一笔：points 是页内归一化坐标 [x, y]（0 到 1），按画的先后 */
export interface Ink {
  id: string
  paperId: string
  page: number
  color: string
  width: number
  points: [number, number][]
  createdAt: number
}


/** 灵感：读到的好句子收进灵感库，写论文时带出处引用。和高亮、标签是两回事，同一句可以都有 */
export type IdeaHow = 'quote' | 'paraphrase' // 写论文时直接引原句，还是用自己的话转述
export interface Idea {
  id: string
  paperId: string
  mode: 'pdf' | 'reflow'
  text: string
  page: number | null
  rects: number[][] | null // 原文模式：页内归一化矩形 [x, y, w, h]
  blockId: string | null
  blockHash: string | null
  start: number | null
  end: number | null
  section: string
  use: string // 想怎么用（可以空）
  topics: string[]
  how: IdeaHow
  paraphrase: { en?: string; zh?: string } | null // AI 转述过的存着，再用不再花额度
  createdAt: number
  updatedAt: number
}

/** 灵感库里的一条：连着论文，key 和自动导出的 .bib 一致 */
export interface IdeaEntry extends Idea {
  paperTitle: string
  paperAuthors: string[]
  paperYear: number | null
  bibKey: string
}
