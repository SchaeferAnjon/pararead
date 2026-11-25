/**
 * 宿主接口：共用的界面组件（@cn/ai-chat，以后的 @cn/editor）不直接调 window.cn、window.api、app()，
 * 也不写死图标、文案和颜色值。每个软件交一份自己的，同一个组件在画布笔记里是画布笔记的样子，在 ParaRead 里是 ParaRead 的样子：
 *   - 主题：组件只写 CSS 变量（THEME_VARS 里的名字；用到别的给默认值 var(--t2, var(--text-2))），值由宿主的样式表定
 *   - 图标：组件写名字（ICON_NAMES），宿主给画法。画布笔记交 Codicons，ParaRead 交名字到 lucide 的对照表
 *   - 文案：组件里写中文原句，宿主的 t() 翻（画布笔记中英两种，ParaRead 九种）；不在组件里的那几句（材料的「3段引用」、引擎菜单的组名）
 *     走 @cn/ai-engines/shared 的 t()，宿主照旧 setI18n 交一次
 * 宿主启动时 setAiChatHost(ui, chat) 交一次（context.tsx）；界面语言换了再交一次，组件跟着重画。
 */
import type { AiPick, EngineInfo } from '@cn/ai-engines/shared'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { Mention } from './mentions'

/**
 * 共用组件只许用的 CSS 变量：画布笔记（@cn/design 的 tokens.css、themes.css）和 ParaRead（src/renderer/src/styles/tokens.css）都定义了的 73 个。
 * 两边本来同源（都出自 MeetCaption v3）。要用别的变量时在组件里给默认值（var(--isle, var(--bg-elevated))），ParaRead 不定义也不坏。
 * test/theme-vars.test.ts 核对两边都还定义着、包里的 css 都守着这条。
 */
export const THEME_VARS = [
  '--accent', '--accent-bg', '--accent-ring', '--accent-soft', '--accent-text',
  '--bg', '--bg-backdrop', '--bg-elevated', '--bg-inset', '--bg-popover', '--bg-sidebar',
  '--blue', '--blur-pop', '--btn-bg', '--btn-bg-hover', '--btn-stroke',
  '--c-blue', '--c-gray', '--c-green', '--c-indigo', '--c-orange', '--c-pink', '--c-purple', '--c-red', '--c-teal', '--c-yellow',
  '--ease', '--field-bg', '--field-stroke', '--fill-1', '--fill-2', '--fill-3', '--fill-4',
  '--font-mono', '--font-sans', '--fs', '--fs-2xl', '--fs-lg', '--fs-md', '--fs-sm', '--fs-xl', '--fs-xs',
  '--green', '--green-soft', '--paper', '--r-lg', '--r-md', '--r-sm', '--r-xl', '--r-xs', '--red', '--red-soft', '--right-w',
  '--shadow-control', '--shadow-modal', '--shadow-pop', '--shadow-sm', '--sidebar-w',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6',
  '--stroke', '--stroke-soft', '--stroke-strong', '--text', '--text-2', '--text-3', '--titlebar-h', '--yellow', '--yellow-soft',
] as const
export type ThemeVar = (typeof THEME_VARS)[number]

/**
 * 组件里用到的图标名（Codicons 的叫法）。宿主的 icon() 要认这些；ParaRead 照它做 lucide 对照。
 * 'ai' 不是 Codicon：画「AI 对话现在用的那一家」的标志（选中一句的小框里「问这句」前面那颗）。
 * 回答下面那排的按钮图标由宿主随动作交进来（answer-bar 的 AbIcon），不在这张表里。
 */
export const ICON_NAMES = [
  'add', 'ai', 'arrow-down', 'arrow-swap', 'arrow-up', 'check', 'chevron-down', 'chevron-right', 'chip', 'close', 'comment', 'comment-discussion',
  'copy', 'discard', 'edit', 'ellipsis', 'error', 'file-code', 'file-media', 'file-pdf', 'file-text', 'git-compare', 'globe', 'layout', 'loading', 'note', 'play',
  'primitive-square', 'question', 'quote', 'refresh', 'reply', 'settings', 'settings-gear', 'terminal',
] as const
export type IconName = (typeof ICON_NAMES)[number]

/** 组件认的两个快捷键：quote 把选中的那段引用进输入框（画布笔记 ⇧⌘L），ask-page 选着时也是引用（画布笔记 ⌘↵，没选时是「问这一页」） */
export type KeyId = 'quote' | 'ask-page'

/** 中文原句里 {name} 的值 */
export type Params = Record<string, string | number>

/** 界面上的宿主：文案、图标、快捷键，和两处可选的画法（认不出的那一家的标志、输入框边上的光）。组件只经它拿这几样 */
export interface UiHost {
  /** 中文原句当键，{name} 放变量（和 @cn/ai-engines/shared 的 t 同一个写法） */
  t(key: string, p?: Params): string
  /** 按名字画一个图标：ICON_NAMES 里的，和回答下面那排宿主自己交进来的动作图标名 */
  icon(name: string, o?: { size?: number; className?: string }): ReactNode
  /** 同一个图标画成一个元素（不在 React 里画的：回答里问过那句后面的小标） */
  iconEl(name: string, size: number): Element
  /** 这一下是不是那个快捷键 */
  isKey(e: KeyboardEvent | ReactKeyboardEvent, id: KeyId): boolean
  /** 按钮、浮条上写的那个键（「⇧⌘L」）；没设键是 null */
  keyLabel(id: KeyId): string | null
  /** 认不出的那一家的标志（EngineLogo 自带画布笔记那十家和翻译的智谱；ParaRead 自己那一家走这里）；不给画终端图标 */
  engineLogo?(id: string, size: number): ReactNode
  /** AI 在答时输入框边上那一圈光（画布笔记的流光 A2，test id ai-input-glow）；不给就没有 */
  inputGlow?(running: boolean): ReactNode
}

/** 列表里的一家：EngineInfo 的样子，id 是任意字（画布笔记交那十家 EngineId，ParaRead 多一家自己的） */
export type ChatEngine = Omit<EngineInfo, 'id'> & { id: string }
/** 这一问用哪家、哪个模型、哪一档：engine 是任意字 */
export type ChatPick = Omit<AiPick, 'engine'> & { engine: string }

/** 引擎那一摊：列表、AI 对话那一行、全能开关、一家都没接上、第一次开 AI 那句说明看过没有 */
export interface ChatAiState {
  engines: ChatEngine[]
  /** 设置里「AI 对话」那一行（谁来答、模型、effort） */
  chat: ChatPick
  /** 全能模式开着没有 */
  omni: boolean
  /** 一家都没接上（底行写「还没接AI」，全能开关灰着） */
  none: boolean
  intro: { ai: boolean }
}

/** AI 动手的一步（StepRow 画的）：在做转圈、做完绿勾、出错红叉跟原因、要先问用户的黄色问号 */
export interface StepView {
  id: string
  label: string
  /** 命令、库外的路径：等宽一段 */
  code?: string
  status: 'run' | 'ok' | 'err' | 'ask'
  detail?: string
  /** 这一步动过的文件（宿主的 renderMarkdown 认回答里的引用时用） */
  paths?: string[]
}

/** AI 没答出来时能点的下一步；switch 是「换一家」（打开输入框底下谁来答那一列） */
export type AiErrorAct = 'retry' | 'rephrase' | 'settings' | 'switch'

/** AI 没答出来：一行说明（跟界面语言）、能点的下一步、收起来的原话（和说明不一样时） */
export interface AiErrorView {
  code: string
  title: string
  acts: AiErrorAct[]
  raw: string | null
}

/**
 * 对话框的宿主：组件要的引擎、贴图、回答正文和复制。问、停、收事件不在这里：发问和存对话是宿主自己的那一摊
 * （画布笔记 AiPanel / reading/store.ts，ParaRead 自己的 store），组件只拿回调（onSend、onStop）。
 */
export interface ChatHost {
  /** 列引擎、AI 对话那一行、全能开关（画布笔记 window.cn.aiEngines） */
  aiEngines(): Promise<ChatAiState>
  /** 设置里改了 AI 对话那一行、换了家、开关了全能：再要一次 aiEngines；返回退订 */
  onAiPrefsChanged(cb: () => void): () => void
  /** 底行换了谁来答（改的就是设置里 AI 对话那一行） */
  aiSetEngine(id: string): unknown
  /** 输入框下面那行的全能开关 */
  aiSetOmni(on: boolean): Promise<unknown>
  /** 引擎菜单最下面「装在别处？指定位置…」：选到了返回带 path 的；不给就没有这一项 */
  aiPickCli?(id: string): Promise<{ path: string | null } | null>
  /** 粘贴、拖进来的图存起来，返回名字（材料里记的就是它） */
  aiPaste(bytes: Uint8Array, mime: string): Promise<string>
  /** 底行「+」：系统选图框，最多 room 张；返回存好的名字和来源那几个字 */
  aiPickImages(room: number): Promise<{ name: string; label: string }[]>
  /** 存好的图在界面上的网址（画布笔记 cn-file://app/pasted/…） */
  pastedUrl(name: string): string
  /**
   * 回答正文（Markdown）画成节点：宿主的 Markdown、公式、能点开的引用都在这里。
   * conv：这段对话的键（引用认名字时「不是这篇」记在哪）；steps：这一轮动过的文件；live：还在出字
   */
  renderMarkdown(text: string, o: { conv: string; steps?: readonly StepView[]; live?: boolean }): ReactNode
  /** 回答原文去掉宿主自己加的标记（可视化、配图那两行），拷贝、放进主对话用 */
  plainAnswer(text: string): string
  /** 拷贝到剪贴板 */
  copy(text: string): unknown
  /** 「去设置 › AI」 */
  openAiSettings(): void
  /** AI 没答出来的原话认成哪一种、怎么说（画布笔记 shared/ai-errors.ts 的 aiErrorView）；engine：这一问是哪家答的 */
  aiErrorView(raw: string, engine?: { id?: string; label?: string }): AiErrorView
  /**
   * 网页上的图（画布笔记右栏网页拖来的、右键「问 AI 这张图」）：输入框认拖进来的网址、取回来存好；不给就只认文件
   */
  webImage?: {
    /** 网页那边正在拖图（拖来的是网址和 html，不是文件） */
    dragLive(): boolean
    /** 这次放下的像不像图 */
    looks(dt: DataTransfer): boolean
    /** 放下的那几张 */
    read(dt: DataTransfer): Promise<WebImg[]>
    /** 取回来、存好：存好的名字和材料卡上的来源（「图 6.2.1 · zh.d2l.ai」） */
    paste(img: WebImg): Promise<{ name: string; label: string }>
  }
  /**
   * 回答里选中一句的小框：「问这句」下面列自己的 AI 命令（画布笔记命令库里的，最多露 4 条、多的在「更多…」），最下面「调整…」去设置。
   * use 是 React 钩子（宿主固定，组件每次都调）；say 拿选中的那句、整条回答填好那条命令的话。不给就没有这一节
   */
  selCmds?: {
    use(): { shown: SelCmd[]; more: SelCmd[] }
    say(c: SelCmd, o: { sel: string; answer?: string }): string
    openSettings(): void
  }
  /**
   * 旁支答完下面那排：宿主画（画布笔记：拷贝 · 插进文档 · ⋯ ｜ 快捷回复，task-eavzx）；不给是包里自带的「放进主对话 · 在笔记里看 · 拷贝」
   */
  sideAnswerRow?(o: SideAnswerRow): ReactNode
  /** 发出去的那条里网页上引的一段（带网址）：点来源回到网页里那一段；不给就只写来源 */
  openQuoteSource?(url: string, text: string): void
  /** 点 @ 点名的那颗胶囊（输入框里、发出去的那条里）：打开那篇；不给点了没反应 */
  openMention?(m: Mention): void
}

/** 旁支答完那排要的：最后一条回答原文、问它的那句、挂在哪一处、块头链回哪条回答、在不在答、发一句、插进主对话、在笔记里看 */
export interface SideAnswerRow {
  md: string
  question: string
  place?: string
  link?: { key: string; msg: number }
  busy: boolean
  send(text: string): void
  onPut(): void
  onNote?: () => void
}

/** 小框里的一条自己的命令：名字、那句话（悬停看） */
export interface SelCmd {
  id: string
  name: string
  say: string
}

/** 网页上的一张图：图的网址、alt、图注、附近的小标题、所在网页的网址和标题 */
export interface WebImg {
  src: string
  alt: string
  caption: string
  head?: string
  url: string
  title: string
}
