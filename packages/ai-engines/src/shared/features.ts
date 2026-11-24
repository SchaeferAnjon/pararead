/**
 * 设置 › AI（CN-44 方向 A）：上面「默认」一家一个模型；下面每个功能各自「跟默认」或指定某家某模型。
 * 主进程按这里选的跑，界面上「哪个模型做的」（CN-54）也从这里取名字。不碰 Electron，能单独测。
 * 翻译另有自己的一串顺序（设置 › 插件 › 双语翻译），不在这里存。
 */
import type { EngineId, EngineInfo } from './types'
import { ANTHROPIC_EFFORTS, API_DEFAULT, canSeeImages, isApi, isEngineId, isLocal, SOURCE_LABEL } from './sources'

/**
 * 跟着这里走的功能：AI 对话（浮窗、边读边问、/ 命令）、梦游（整理、周记、可视化）、看图问（视频框一块问、拍导图）、小活（视频摘要、起名、插件快问）、
 * 出卡（读 PDF 问过的改成 Anki 卡，task-tz7y3；选择器在设置 › 读PDF「改写成卡用哪家AI」，没选跟默认）
 */
export type AiFeature = 'chat' | 'dream' | 'vision' | 'quick' | 'cards'
export const FEATURES: AiFeature[] = ['chat', 'dream', 'vision', 'quick', 'cards']

export interface AiPick {
  engine: EngineId
  /** 模型：Claude Code 的 --model；Codex 的 turn/start model（不给是 Codex 自己的默认模型）；Gemini、OpenCode 用它自己的默认模型，不留 */
  model?: string
  /** 想多久（CN-91）：Claude Code 的 --effort、Codex 的 turn/start effort；不给是 High（DEFAULT_EFFORT）；Gemini、OpenCode 没有 */
  effort?: string
}

/** effort 菜单里的一档：id 是命令行认的 */
export interface EffortOption {
  id: string
  label: string
  /** 菜单里的旁注 */
  note?: string
}

/** Claude Code 的 --effort（claude 2.1.323、2.1.330 的 --help 核过：low、medium、high、xhigh、max）；讲解默认 High */
export const CLAUDE_EFFORTS: EffortOption[] = [
  { id: 'low', label: 'Low', note: '最快，小追问够用' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High', note: '讲解默认' },
  { id: 'xhigh', label: 'Extra high', note: '想得更久' },
  { id: 'max', label: 'Max', note: '最慢、最贵' },
]
export const DEFAULT_EFFORT = 'high'

/** Codex 那几档（app-server model/list 的 supportedReasoningEfforts）：名字、旁注和 Claude Code 的同一套；它自己的说明是英文，不用 */
const EFFORT_EXTRA: EffortOption[] = [
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'ultra', label: 'Ultra', note: '最慢，会自己分派子任务' },
]
export function effortOption(id: string): EffortOption {
  return CLAUDE_EFFORTS.find((e) => e.id === id) ?? EFFORT_EXTRA.find((e) => e.id === id) ?? { id, label: id.charAt(0).toUpperCase() + id.slice(1) }
}
/** 「Claude Code · Opus 5.5 · High」去掉最后那一档：写进文档的 AI 块头上不带档（同 AI 讲解，DESIGN.v3 2.4） */
export function withoutEffort(label: string): string {
  const names = new Set([...CLAUDE_EFFORTS, ...EFFORT_EXTRA].map((e) => e.label))
  const parts = label.split(' · ')
  return parts.length > 1 && names.has(parts[parts.length - 1]!) ? parts.slice(0, -1).join(' · ') : label
}

/** 拿不到 Codex 模型列表时给它的几档（哪个模型都认） */
const CODEX_EFFORTS = ['low', 'medium', 'high'].map(effortOption)

/**
 * 没选过 effort 时也给一档（High）的两家：Claude Code、Codex 的模型都认 effort。
 * Gemini、OpenCode 看拉到的模型（task-m55m7）：OpenCode 的模型带它自己那几档（variants），选了才传；Gemini 没有
 */
export const hasEffort = (e: EngineId) => e === 'claude' || e === 'codex' || e === 'anthropic'

/** 输入框底行模型菜单里的一项：id 是命令行认的；空串是这家自己的默认模型（不传 --model） */
export interface ModelOption {
  id: string
  label: string
  /** 这个模型能选的 effort（Gemini、OpenCode 是空的） */
  efforts: EffortOption[]
  /** 这个模型自己的默认档（Codex 的 model/list 给的） */
  defaultEffort?: string
  /** 别名实际是哪个型号（Claude Code 报的：sonnet → claude-sonnet-5-5）；存着的是实际型号时也认得出是这一项 */
  resolved?: string
  /** 模型菜单里分组的小标题（OpenCode 按服务商分：zai、deepseek…） */
  group?: string
}

/** 模型名：命令行认的那几种写法（Claude Code 的别名和型号、Codex 的模型、OpenCode 的「服务商/模型」） */
export const MODEL_ID = /^[\w.:\-[\]/@]{0,200}$/

/** 模型列表里的这一项：先按 id 找，再按别名实际的型号找（设置里存的是 claude-opus-5-5，拉到的是 opus → claude-opus-5-5） */
export function findModel(models: readonly ModelOption[], id: string): ModelOption | undefined {
  return models.find((m) => m.id === id) ?? (id ? models.find((m) => m.resolved === id) : undefined)
}

export interface AiPrefs {
  default: AiPick
  /** 没写 = 跟默认 */
  features: Partial<Record<AiFeature, AiPick>>
}

export const ENGINE_LABEL: Record<EngineId, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode', ...SOURCE_LABEL }

/** Claude Code 能选的模型：名字是 claude 命令行的 --model 认的 */
export const CLAUDE_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]
export const CLAUDE_DEFAULT = 'claude-opus-5-5'

/** Anthropic 接口的几档：名字、旁注和 Claude Code 的同一套 */
export const API_EFFORTS: EffortOption[] = ANTHROPIC_EFFORTS.map(effortOption)
/** Claude API 还没拉到模型列表时用的（接口的型号，没有别名） */
export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: API_EFFORTS, defaultEffort: 'high' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: API_EFFORTS, defaultEffort: 'medium' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: API_EFFORTS, defaultEffort: 'medium' },
]
export const ANTHROPIC_DEFAULT = 'claude-sonnet-5-5'

/**
 * 每家能选的模型（CN-91，task-m55m7 起从命令行拉，pulled 是拉到的），第一项是这家的默认：
 * Claude Code 拉到了就是它报的那几个（别名 opus / sonnet / haiku… 和具体型号，各自那几档），没拉到用自带的三个、各五档；
 * Codex、Gemini、OpenCode 第一项「某家默认模型」（不传模型，用它自己设置里的），后面是拉到的（拉不到就只有这一项）；
 * Codex 默认那一项的档照它默认的那个模型，Gemini、OpenCode 的默认模型不知道是哪个、不给档
 */
export function modelsOf(engine: EngineId, pulled: ModelOption[] = []): ModelOption[] {
  if (engine === 'claude') return pulled.length ? pulled : CLAUDE_MODELS.map((m) => ({ ...m, efforts: CLAUDE_EFFORTS }))
  // API Key、本机模型（task-587os）：验 Key、找本机模型时拉到的；还没拉到时 Anthropic 给自带的三个，别家给推荐的那个
  if (isApi(engine) || isLocal(engine)) {
    if (pulled.length) return pulled
    if (engine === 'anthropic') return ANTHROPIC_MODELS
    return isApi(engine) ? [{ id: API_DEFAULT[engine].chat[0]!, label: API_DEFAULT[engine].chat[0]!, efforts: [] }] : [{ id: '', label: `${ENGINE_LABEL[engine]} 默认模型`, efforts: [] }]
  }
  if (engine !== 'codex') return [{ id: '', label: `${ENGINE_LABEL[engine]} 默认模型`, efforts: [] }, ...pulled]
  const def = pulled[0]
  return [{ id: '', label: 'Codex 默认模型', efforts: def?.efforts ?? CODEX_EFFORTS, ...(def?.defaultEffort ? { defaultEffort: def.defaultEffort } : {}) }, ...pulled]
}

/**
 * 这一问真正用的模型和那一档（CN-91）：没给模型用这家的默认；给的那一档这个模型不认，就用它自己的默认档，再不认用 High，再不认用第一档。
 * Claude Code、Codex 没选过档时是 High；Gemini、OpenCode 只有这个模型有那一档、而且选过才带（OpenCode 不选就是它自己的默认档）。
 * 主进程（effectivePick）和输入框底行（convPick）用同一套
 */
export function fitPick(engine: EngineId, models: ModelOption[], want: { model?: string; effort?: string }): AiPick {
  let model = want.model ?? ''
  if (engine === 'claude') model ||= CLAUDE_DEFAULT
  // API Key、本机模型没有「这家自己的默认模型」：没选用列表里第一个（接上时把推荐的排在第一）
  if (isApi(engine) || isLocal(engine)) model ||= models[0]?.id ?? ''
  const option = findModel(models, model)
  if (!hasEffort(engine)) {
    const effort = want.effort && option?.efforts.some((e) => e.id === want.effort) ? want.effort : undefined
    return { engine, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
  }
  const efforts = option?.efforts ?? (engine === 'claude' ? CLAUDE_EFFORTS : engine === 'anthropic' ? API_EFFORTS : [])
  // 拉到的这个模型明说不认 effort（Claude Code 的 Haiku 4.5）：不带
  if (option && !efforts.length && models.some((m) => m.efforts.length)) return { engine, ...(model ? { model } : {}) }
  let effort = want.effort ?? DEFAULT_EFFORT
  if (efforts.length && !efforts.some((e) => e.id === effort)) {
    const fallback = [option?.defaultEffort, DEFAULT_EFFORT].find((x) => x && efforts.some((e) => e.id === x))
    effort = fallback ?? efforts[0]!.id
  }
  return { engine, ...(model ? { model } : {}), effort }
}

/** 交给主进程的这一问的模型和 effort（ai:turn、reading:ask）：模型空串是这家自己的默认模型 */
export const pickReq = (p: AiPick): { model?: string; effort?: string } => ({ model: p.model ?? '', ...(p.effort ? { effort: p.effort } : {}) })

/**
 * 一个对话这一问用的（CN-91 方向 C）：哪家跟设置 › AI「AI 对话」那一行（chat，ai:engines 给的）；
 * 这个对话自己选过这一家的模型、effort（own，记在这个对话里）就用自己的，没选过、选的是别家的用那一行的
 */
export function convPick(engines: EngineInfo[], chat: AiPick, own?: AiPick | null): AiPick {
  const id = chat.engine
  const models = engines.find((e) => e.id === id)?.models ?? modelsOf(id)
  const mine = own && own.engine === id ? own : null
  return fitPick(id, models, { model: mine?.model ?? chat.model, effort: mine?.effort ?? chat.effort })
}

/** 从没设过时：都跟默认，只有小活用 Claude Code 的 Haiku（快、便宜，一次问很多遍） */
export const INITIAL_PREFS: AiPrefs = { default: { engine: 'claude', model: CLAUDE_DEFAULT }, features: { quick: { engine: 'claude', model: 'haiku' } } }

const isEngine = isEngineId

/**
 * 存的东西读回来：不认识的丢掉；模型四家都留（task-m55m7 起 Gemini、OpenCode 也能选模型），写法不对的丢掉；
 * effort：Claude Code 只留那五档，别家留它自己的（旧设置没有 effort，读成不设 = Claude Code、Codex 是 High）
 */
export function normalizePick(x: unknown): AiPick | null {
  if (!x || typeof x !== 'object') return null
  const o = x as { engine?: unknown; model?: unknown; effort?: unknown }
  if (!isEngine(o.engine)) return null
  const model = typeof o.model === 'string' && o.model.trim() && MODEL_ID.test(o.model.trim()) ? o.model.trim() : undefined
  const effort = typeof o.effort === 'string' && /^[a-z]{1,20}$/.test(o.effort) && ((o.engine !== 'claude' && o.engine !== 'anthropic') || CLAUDE_EFFORTS.some((e) => e.id === o.effort)) ? o.effort : undefined
  if (o.engine === 'claude') return { engine: 'claude', model: model ?? CLAUDE_DEFAULT, ...(effort ? { effort } : {}) }
  return { engine: o.engine, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}

export function normalizePrefs(x: unknown, legacyEngine?: EngineId): AiPrefs {
  const o = (x && typeof x === 'object' ? x : {}) as { default?: unknown; features?: unknown }
  const def = normalizePick(o.default) ?? (legacyEngine ? normalizePick({ engine: legacyEngine }) : null) ?? INITIAL_PREFS.default
  const features: AiPrefs['features'] = {}
  const f = (o.features && typeof o.features === 'object' ? o.features : o.default === undefined ? INITIAL_PREFS.features : {}) as Record<string, unknown>
  for (const k of FEATURES) {
    const p = normalizePick(f[k])
    if (p) features[k] = p
  }
  return { default: def, features }
}

/**
 * 这个功能真的用哪家哪个模型。看图问：Claude Code、Claude API、OpenAI API 能看图（task-587os），
 * 默认那家不能看图时用 Claude Code 的默认模型
 */
export function resolvePick(p: AiPrefs, feature: AiFeature): AiPick {
  const own = p.features[feature]
  const pick = own ?? p.default
  if (feature === 'vision' && !canSeeImages(pick.engine)) return { engine: 'claude', model: CLAUDE_DEFAULT }
  return pick
}

/** 模型的名字：拉到的列表里的（「Sonnet 5.5」），列表里没有时 Claude Code 用自带的叫法，再没有写型号本身 */
export function modelLabel(engine: EngineId, id: string, models: readonly ModelOption[] = []): string {
  return findModel(models, id)?.label ?? (engine === 'claude' ? CLAUDE_MODELS.find((x) => x.id === id)?.label : undefined) ?? id
}

/**
 * 回答头上、设置里写的「Claude Code · Opus 5.5」，带了 effort 再加一截「· High」（CN-91）；模型名用拉到的（task-m55m7：「Claude Code · Sonnet 5.5 · Low」，
 * models 是 EngineInfo.models）。用这家默认模型的不写模型；Gemini、OpenCode 选了模型写模型名，这个模型有那一档才写 effort
 */
export function pickLabel(p: AiPick, models: readonly ModelOption[] = []): string {
  const parts = [ENGINE_LABEL[p.engine]]
  if (p.engine === 'claude') parts.push(modelLabel('claude', p.model ?? CLAUDE_DEFAULT, models))
  else if (p.model) parts.push(modelLabel(p.engine, p.model, p.engine === 'anthropic' && !models.length ? ANTHROPIC_MODELS : models))
  if (p.effort && (hasEffort(p.engine) || findModel(models, p.model ?? '')?.efforts.some((e) => e.id === p.effort))) parts.push(effortOption(p.effort).label)
  return parts.join(' · ')
}

/** 「Claude Code · Opus 5.5」是哪家（放它的标志） */
export function engineOfLabel(label: string): EngineId | null {
  const name = label.split(' · ')[0]
  return (Object.entries(ENGINE_LABEL).find(([, v]) => v === name)?.[0] as EngineId | undefined) ?? null
}
