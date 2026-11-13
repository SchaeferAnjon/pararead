// 深度思考按各家自己的参数开关（2026-11 查过各家文档）。按模型名认，自定义接口和 OpenRouter 上的同名模型也一样。
// switch：开关真的起作用；always：模型总会先想，关不掉（开关不显示）；unknown：认不出的模型，不加参数。
// 关的时候尽量压到最浅（快、省），开的时候给高档。

export type ThinkMode = 'switch' | 'always' | 'unknown'

const bare = (model: string) => model.replace(/^[^/]+\//, '').toLowerCase()

export function thinkMode(provider: string, model: string): ThinkMode {
  if (provider === 'claude-code') return 'switch' // 命令行 --effort high / low
  const m = bare(model)
  // Claude 5 经 OpenAI 兼容层：默认自适应思考，兼容层不回思考内容，各型号能不能关又不一样
  if (/^claude-/.test(m)) return 'always'
  // kimi-k3 总在推理，文档说别传思考参数；kimi-k2-thinking 同样关不掉
  if (/^kimi-k3(?!\.1)/.test(m) || /^kimi-k2-thinking/.test(m)) return 'always'
  if (thinkParams(model, '', true)) return 'switch'
  return 'unknown'
}

// 要合进请求体的字段；null 表示这个模型不认识，什么都不加
export function thinkParams(model: string, baseUrl: string, on: boolean): Record<string, unknown> | null {
  const m = bare(model)
  // OpenRouter 统一用 reasoning 对象，关的时候交给模型默认
  if (/openrouter\.ai/.test(baseUrl) && /\//.test(model)) return on ? { reasoning: { effort: 'high' } } : {}
  // DeepSeek V4 默认开思考：平时关掉，深度思考时打开
  if (/^deepseek/.test(m)) return { thinking: { type: on ? 'enabled' : 'disabled' } }
  // 智谱看图模型开着思考会先出一版草稿，界面上像重复了一遍：一直关
  if (/^glm-\d+(\.\d+)?v/.test(m)) return { thinking: { type: 'disabled' } }
  // GLM-5.3 关不掉思考，靠档位：low 实测不想，high 想几百字
  if (/^glm-5/.test(m)) return { reasoning_effort: on ? 'high' : 'low' }
  if (/^glm-4\.[5-9]/.test(m)) return { thinking: { type: on ? 'enabled' : 'disabled' } }
  // 通义 Qwen3 系列混合思考
  if (/^(qwen3|qwen-(plus|flash|turbo))/.test(m)) return { enable_thinking: on }
  // 豆包 Seed 默认开思考
  if (/^doubao-seed/.test(m)) return { thinking: { type: on ? 'enabled' : 'disabled' } }
  if (/^kimi-k3\.1/.test(m)) return { reasoning_effort: on ? 'max' : 'low' }
  if (/^kimi-k2\.[5-9]/.test(m)) return { thinking: { type: on ? 'enabled' : 'disabled' } }
  // OpenAI 推理模型：关的时候用模型默认（GPT-5.1 起默认不想）
  if (/^(gpt-5|o\d)/.test(m)) return on ? { reasoning_effort: 'high' } : {}
  // Gemini 3 关不掉，只能压到 low
  if (/^gemini-/.test(m)) return { reasoning_effort: on ? 'high' : 'low' }
  return null
}
