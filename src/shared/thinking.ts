// 思考强度按当前模型选（2026-11 查过各家文档，部分真测过）。按模型名认，自定义接口和 OpenRouter 上的同名模型也一样。
// 档位：off 关、on 开（只能开关的模型）、low 低、medium 中、high 高、xhigh 很高、max 最高。
// 每个模型能选哪几档由 thinkSpec 给；levels[0] 是最省的一档，第一次用的模型从它开始，翻译这类不问用户的请求也用它。
//   OpenAI GPT-5 系列 reasoning_effort none/low/medium/high/xhigh（关用模型默认：GPT-5.1 起默认不想）
//   o 系列 low/medium/high（关不掉）；Gemini 3 low/medium/high（关不掉）
//   智谱 GLM-5.3 reasoning_effort low/high/max（关不掉；low 实测不想，Coding Plan 实测 high 也收）
//   Kimi K3.1 Pro low/high/max；Kimi K3、kimi-k2-thinking、Claude API 总在想，别传参数
//   Kimi K2.5/K2.6、豆包、DeepSeek、智谱 GLM-4.5 起、通义 Qwen3 只能开关（通义另有 thinking_budget 字数上限，不做成选项）
//   本机 Claude Code 命令行 --effort low/medium/high/xhigh/max
import { t } from './i18n'

export type ThinkLevel = 'off' | 'on' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// levels：能选档；switch：只能开关；always：总会先想，没得选；unknown：认不出的模型，不加参数、不显示
export type ThinkKind = 'levels' | 'switch' | 'always' | 'unknown'
export interface ThinkSpec {
  kind: ThinkKind
  levels: ThinkLevel[]
}

const bare = (model: string) => model.replace(/^[^/]+\//, '').toLowerCase()
const SWITCH: ThinkSpec = { kind: 'switch', levels: ['off', 'on'] }
const lv = (...levels: ThinkLevel[]): ThinkSpec => ({ kind: 'levels', levels })

export function thinkSpec(provider: string, model: string): ThinkSpec {
  if (provider === 'claude-code') return lv('low', 'medium', 'high', 'xhigh', 'max')
  const m = bare(model)
  // Claude 经 OpenAI 兼容层：默认自适应思考，兼容层不回思考内容；kimi-k3 文档说别传思考参数；kimi-k2-thinking 关不掉
  if (/^claude-/.test(m) || /^kimi-k3(?!\.1)/.test(m) || /^kimi-k2-thinking/.test(m)) return { kind: 'always', levels: [] }
  // 智谱看图模型开着思考会先出一版草稿，界面上像重复了一遍：一直关，不给选
  if (/^glm-\d+(\.\d+)?v/.test(m)) return { kind: 'unknown', levels: [] }
  if (/^gpt-5/.test(m)) return lv('off', 'low', 'medium', 'high', 'xhigh')
  if (/^o\d/.test(m)) return lv('low', 'medium', 'high')
  if (/^gemini-/.test(m)) return lv('low', 'medium', 'high')
  if (/^glm-5/.test(m)) return lv('low', 'high', 'max')
  if (/^kimi-k3\.1/.test(m)) return lv('low', 'high', 'max')
  if (/^(deepseek|doubao-seed|kimi-k2\.[5-9]|glm-4\.[5-9]|qwen3|qwen-(plus|flash|turbo))/.test(m)) return SWITCH
  // OpenRouter 上认不出的模型：统一的 reasoning 对象
  if (provider === 'openrouter' && /\//.test(model)) return lv('off', 'low', 'medium', 'high')
  return { kind: 'unknown', levels: [] }
}

// 设置里每个模型记一份：按模型名记；本机 Claude Code 的 haiku / sonnet / opus 前面带上它
export const thinkKey = (provider: string, model: string): string => (provider === 'claude-code' ? `claude-code/${model}` : bare(model))

// 这个模型现在用哪一档：记过且这个模型能选就用它，否则最省的一档；没得选的模型是 null
export function thinkLevel(saved: Record<string, ThinkLevel>, provider: string, model: string): ThinkLevel | null {
  const s = thinkSpec(provider, model)
  if (!s.levels.length) return null
  const v = saved[thinkKey(provider, model)]
  return v && s.levels.includes(v) ? v : s.levels[0]
}

// 旧设置「深度思考默认开」打开着的：换成这个模型的「高」（只能开关的是「开」）
export function legacyOnLevel(provider: string, model: string): ThinkLevel | null {
  const s = thinkSpec(provider, model)
  if (s.kind === 'switch') return 'on'
  if (s.kind === 'levels') return s.levels.includes('high') ? 'high' : s.levels[s.levels.length - 1]
  return null
}

// 界面要不要显示思考过程：最省的一档是「关」时不显示；关不掉的模型用户选了哪档都算在想
export const showsThinking = (level: ThinkLevel | null | undefined): boolean => !!level && level !== 'off'

// 要合进请求体的字段；null 表示这个模型不认识，什么都不加。level 不给就用最省的一档（翻译这类请求）
export function thinkParams(model: string, baseUrl: string, level?: ThinkLevel): Record<string, unknown> | null {
  const m = bare(model)
  const s = thinkSpec(/openrouter\.ai/.test(baseUrl) ? 'openrouter' : '', model)
  const l = level && s.levels.includes(level) ? level : s.levels[0]
  // OpenRouter 用 reasoning 对象，关的时候交给模型默认
  if (/openrouter\.ai/.test(baseUrl) && /\//.test(model)) return l && l !== 'off' ? { reasoning: { effort: effortOf(l) } } : {}
  if (/^glm-\d+(\.\d+)?v/.test(m)) return { thinking: { type: 'disabled' } }
  if (s.kind === 'always' || s.kind === 'unknown') return null
  if (/^qwen/.test(m)) return { enable_thinking: l === 'on' }
  if (s.kind === 'switch') return { thinking: { type: l === 'on' ? 'enabled' : 'disabled' } }
  // OpenAI 关的时候用模型默认（GPT-5.1 起默认不想）；别家关不掉，最省是 low
  return l === 'off' ? {} : { reasoning_effort: l }
}

// OpenRouter 的 reasoning.effort 只认到 high
const effortOf = (l: ThinkLevel): string => (l === 'low' || l === 'medium' ? l : 'high')

// 本机 Claude Code 的 --effort
export const ccEffort = (level?: ThinkLevel | null): string => (level && level !== 'off' && level !== 'on' ? level : 'low')

export function levelName(l: ThinkLevel): string {
  return { off: t('关'), on: t('开'), low: t('低'), medium: t('中'), high: t('高'), xhigh: t('很高'), max: t('最高') }[l]
}

export function levelHint(l: ThinkLevel): string {
  return {
    off: t('不先想，直接答。最快、最省，查词、翻一句够用。'),
    on: t('先想清楚再答；慢一些，多花一些，想多久由模型自己定。'),
    low: t('想一小会儿再答。比不想慢一点，花费差不多。'),
    medium: t('想清楚再答，多数问题够用；慢一些，多花一些。'),
    high: t('多想几步，适合推导、对比几篇论文；要等一会儿，花得明显多。'),
    xhigh: t('想得很久，适合难的推导和证明；等得久，花得很多。'),
    max: t('这个模型能想的最多；最慢、最贵，留给真难的问题。')
  }[l]
}
