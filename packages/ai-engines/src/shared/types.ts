/** 哪一家、一家的样子（主进程列出来给界面看的）：画布笔记、画布今日、ParaRead 共用 */
import type { EffortOption, ModelOption } from './features'
import type { EngineHealth } from './health'

/**
 * 哪一家：本机命令行四家（照旧排第一），API Key 四家，本机模型两家（task-587os，三条路见 shared/ai-sources.ts）。
 * 存在设置、对话里的都是这几个字
 */
export type EngineId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'anthropic' | 'openai' | 'deepseek' | 'openrouter' | 'ollama' | 'lmstudio'

export interface EngineInfo {
  id: EngineId
  label: string
  /**
   * 能用的命令行路径（找到了、`--version` 跑得通）；没找到或运行不了是 null。
   * API Key、本机模型（task-587os）没有命令行：Key 验过、本机模型开着有模型时是「api:anthropic」「local:ollama」这样的记号，用不了是 null
   */
  path: string | null
  /** 哪条路：命令行、API Key、本机模型 */
  route?: 'cli' | 'api' | 'local'
  /** API Key：最后 4 位（界面「能用 · ••••3kQa · 存在钥匙串」） */
  tail?: string
  /** 给界面看的在哪找到（CN-87）：「~/.local/bin」「/opt/homebrew/bin」「在 Codex.app 里找到」；没找到是「没找到」 */
  where: string
  /** 找到了但运行不了（`--version` 出错、3 秒没反应）：一句中文原因，和「没找到」分开说 */
  broken?: string
  /** 用的是「装在别处？指定位置…」选的那个 */
  custom?: boolean
  /** 没找到或运行不了时说一句怎么办 */
  hint?: string
  /** 能选的模型（CN-91），第一项是这家的默认；task-m55m7 起从命令行拉（engine-watch.ts），没拉到用自带的 */
  models: ModelOption[]
  /** 默认那个模型能选的 effort（Gemini、OpenCode 是空的：这颗按钮不出现） */
  efforts: EffortOption[]
  /** `--version` 报的版本（「2.1.330」）；没找到、运行不了、还没读到是 undefined */
  version?: string
  /** 模型列表什么时候拉的、拉没拉到：「刚拉的」「上次拉的 11-20 09:14」「自带的几个」（模型菜单底下、设置那一行写） */
  pulled?: string
  /** 拉到几个模型（不算「某家默认模型」那一项）；没拉到是 0 */
  pulledCount?: number
  /** 版本变了以后的自查（shared/engine-health.ts）；checking：正在查 */
  health?: EngineHealth
  checking?: boolean
  /** 新版本（每天在后台看一次、点「检查更新」看一次）：比装着的新才有 */
  latest?: string
  /** 看新版本这一下的结果：「已是最新」「没查到：网络断了」 */
  latestNote?: string
  /** 「更新」：会跑什么（「claude update」）；跑不了时 none 说为什么（「跟着 ChatGPT.app 更新」） */
  updateWith?: { text: string } | { none: string }
  /** 正在更新、刚更新完的结果 */
  update?: { state: 'running'; text: string } | { state: 'ok'; from?: string; to?: string } | { state: 'failed'; why: string }
}

