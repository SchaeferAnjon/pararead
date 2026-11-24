/**
 * AI 从哪来（task-587os 收口第 2 条，设计页 64-没装ClaudeCode时的AI）：三条路。
 * - 本机命令行（cli）：Claude Code、Codex、Gemini、OpenCode，用它自己的订阅，照旧排第一；
 * - API Key（api）：Anthropic、OpenAI、DeepSeek、OpenRouter，按用量扣用户自己的 Key；
 *   不用工具的活软件直接问接口（Anthropic Messages、OpenAI chat/completions），要动手的 AI 对话交给软件自带的 OpenCode；
 * - 本机模型（local）：Ollama、LM Studio（OpenAI 兼容接口），只聊天和小活，不动手、不判梦游。
 * 名字照 iPad 的叫法：「Claude API」「DeepSeek API」「Ollama」。不碰 Electron，主进程、界面、画布今日都用。
 */
import type { EngineId } from './types'

export type CliId = 'claude' | 'codex' | 'gemini' | 'opencode'
export type ApiId = 'anthropic' | 'openai' | 'deepseek' | 'openrouter'
export type LocalId = 'ollama' | 'lmstudio'
export type Route = 'cli' | 'api' | 'local'

export const CLI_IDS: CliId[] = ['claude', 'codex', 'gemini', 'opencode']
export const API_IDS: ApiId[] = ['anthropic', 'openai', 'deepseek', 'openrouter']
export const LOCAL_IDS: LocalId[] = ['ollama', 'lmstudio']
/** 所有的家，按三条路排：命令行、Key、本机模型（菜单和「找到哪家默认哪家」都照这个顺序） */
export const ALL_IDS: EngineId[] = [...CLI_IDS, ...API_IDS, ...LOCAL_IDS]

export const isCli = (id: unknown): id is CliId => (CLI_IDS as unknown[]).includes(id)
export const isApi = (id: unknown): id is ApiId => (API_IDS as unknown[]).includes(id)
export const isLocal = (id: unknown): id is LocalId => (LOCAL_IDS as unknown[]).includes(id)
export const isEngineId = (id: unknown): id is EngineId => (ALL_IDS as unknown[]).includes(id)
export const routeOf = (id: EngineId): Route => (isCli(id) ? 'cli' : isApi(id) ? 'api' : 'local')

/** 回答头上、设置里写的那一家的名字（和 iPad 的「云端 Claude API」同一套叫法，前面不加「云端」） */
export const SOURCE_LABEL: Record<ApiId | LocalId, string> = {
  anthropic: 'Claude API',
  openai: 'OpenAI API',
  deepseek: 'DeepSeek API',
  openrouter: 'OpenRouter API',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
}

/** 选一家时写的公司名（「去 Anthropic 拿 Key」） */
export const PROVIDER_NAME: Record<ApiId, string> = { anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', openrouter: 'OpenRouter' }

/** 拿 Key 的页面（照 ParaRead 那张表） */
export const KEY_PAGE: Record<ApiId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openrouter: 'https://openrouter.ai/settings/keys',
}

/** 占位字跟所选的那家走（Key 长什么样） */
export const KEY_SHAPE: Record<ApiId, string> = { anthropic: 'sk-ant-…', openai: 'sk-…', deepseek: 'sk-…', openrouter: 'sk-or-…' }

/** 本机模型的官网（软件不替人装，两个都是独立 App） */
export const LOCAL_SITE: Record<LocalId, string> = { ollama: 'https://ollama.com/download', lmstudio: 'https://lmstudio.ai/download' }

/** 本机模型的接口地址（都只听 127.0.0.1；CN_LOCAL_BASE_OLLAMA 这样的环境变量能换，测试用） */
export const LOCAL_BASE: Record<LocalId, string> = { ollama: 'http://127.0.0.1:11434', lmstudio: 'http://127.0.0.1:1234' }

/** 各家的接口地址（CN_API_BASE_ANTHROPIC 这样的环境变量能换，测试用本机假的服务） */
export const API_BASE: Record<ApiId, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
}

/** OpenCode 认的环境变量（Key 用环境变量交给它，设计页第 6 节实测 ANTHROPIC_API_KEY、DEEPSEEK_API_KEY 都认） */
export const KEY_ENV: Record<ApiId, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY' }

/**
 * 接上一家以后默认用的模型（设计页：新装默认 Sonnet 不用 Opus）。列表里有就用它，没有用拉到的第一个。
 * quick 是小活用的（快、便宜）
 */
export const API_DEFAULT: Record<ApiId, { chat: string[]; quick: string[] }> = {
  anthropic: { chat: ['claude-sonnet-5-5'], quick: ['claude-haiku-5-5'] },
  openai: { chat: ['gpt-5.5', 'gpt-5.1', 'gpt-5'], quick: ['gpt-5.5-mini', 'gpt-5.1-mini', 'gpt-5-mini'] },
  deepseek: { chat: ['deepseek-chat', 'deepseek-v4-pro', 'deepseek-flash'], quick: ['deepseek-flash', 'deepseek-chat'] },
  openrouter: { chat: ['anthropic/claude-sonnet-5-5'], quick: ['anthropic/claude-haiku-5-5'] },
}

/** 列表里先找推荐的，没有用第一个 */
export function preferModel(ids: readonly string[], want: readonly string[]): string {
  return want.find((w) => ids.includes(w)) ?? ids[0] ?? want[0] ?? ''
}

/**
 * 没 Claude Code 时梦游怎么判（设计页第 5 节，用户定照推荐）：Anthropic Key 默认 Haiku 5.5 · Low，门槛 0.85（Haiku 的把握偏乐观）；
 * 订阅照旧 Sonnet · Medium（shared/dream-judge.ts 的 JUDGE_DEFAULT）
 */
export const KEY_JUDGE = { engine: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' } as const

/** Anthropic 接口认的几档（output_config.effort；Haiku 5.5、Sonnet 5.5、Opus 5.5 都认这五档） */
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** 能看图的（看图问那一行灰掉不能看的） */
export const canSeeImages = (id: EngineId) => id === 'claude' || id === 'anthropic' || id === 'openai'

/** 一家现在能不能用：Key 填过、验过；本机模型开着、有模型（界面上「能用 · ••••3kQa」「开着 · 3 个模型」） */
export interface SourceState {
  id: ApiId | LocalId
  /** 能用 */
  ready: boolean
  /** Key 的最后 4 位（只有 api） */
  tail?: string
  /** 本机模型开着没有、有几个（只有 local） */
  on?: boolean
  count?: number
  /** 上一次出错的原话（验 Key、连本机模型） */
  error?: string
}

/** 「12 个模型」「6.6 GB」：本机模型的大小（字节）写成给人看的 */
export function sizeText(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}
