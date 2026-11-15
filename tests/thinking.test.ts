import { describe, expect, it } from 'vitest'
import { ccEffort, legacyOnLevel, showsThinking, thinkKey, thinkLevel, thinkParams, thinkSpec, type ThinkLevel } from '../src/shared/thinking'
import { buildRequest } from '../src/main/glm'

const body = (model: string, think?: ThinkLevel, baseUrl = 'https://x/v1') => buildRequest({ apiKey: 'k', model, baseUrl, messages: [], think }).body

describe('思考强度：每个模型能选哪几档', () => {
  it('按模型列出档位，第一档是最省的', () => {
    expect(thinkSpec('openai', 'gpt-5.6-luna')).toEqual({ kind: 'levels', levels: ['off', 'low', 'medium', 'high', 'xhigh'] })
    expect(thinkSpec('gemini', 'gemini-3.8-flash').levels).toEqual(['low', 'medium', 'high'])
    expect(thinkSpec('zhipu-coding', 'glm-5.3-flash').levels).toEqual(['low', 'high', 'max'])
    expect(thinkSpec('kimi', 'kimi-k3.1-pro').levels).toEqual(['low', 'high', 'max'])
    expect(thinkSpec('claude-code', 'haiku').levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(thinkSpec('openai', 'o4-mini').levels).toEqual(['low', 'medium', 'high'])
  })

  it('只能开关的模型只有 关 / 开', () => {
    for (const m of ['deepseek-flash', 'doubao-seed-1-6-251015', 'kimi-k2.6', 'glm-4.6', 'qwen3.8-flash']) expect(thinkSpec('x', m)).toEqual({ kind: 'switch', levels: ['off', 'on'] })
  })

  it('总会先想的、认不出的没有档位', () => {
    expect(thinkSpec('kimi', 'kimi-k3')).toEqual({ kind: 'always', levels: [] })
    expect(thinkSpec('claude', 'claude-haiku-5-5').kind).toBe('always')
    expect(thinkSpec('kimi', 'kimi-k2-thinking').kind).toBe('always')
    expect(thinkSpec('custom', 'llama-4').kind).toBe('unknown')
    expect(thinkSpec('zhipu', 'glm-4.6v').kind).toBe('unknown')
    // OpenRouter 上认不出的模型走它统一的 reasoning
    expect(thinkSpec('openrouter', 'meta/llama-4').levels).toEqual(['off', 'low', 'medium', 'high'])
  })
})

describe('思考强度：每个模型记一份', () => {
  it('没记过的从最省一档开始；记过的用记的；这个模型没有那一档就回到最省', () => {
    expect(thinkLevel({}, 'deepseek', 'deepseek-flash')).toBe('off')
    expect(thinkLevel({}, 'zhipu', 'glm-5.3-flash')).toBe('low')
    expect(thinkLevel({ 'glm-5.3-flash': 'max' }, 'zhipu', 'glm-5.3-flash')).toBe('max')
    expect(thinkLevel({ 'glm-5.3-flash': 'medium' }, 'zhipu', 'glm-5.3-flash')).toBe('low')
    expect(thinkLevel({ 'gpt-5.6-luna': 'high' }, 'openai', 'gpt-5.6-luna')).toBe('high')
    expect(thinkLevel({ 'gpt-5.6-luna': 'high' }, 'kimi', 'kimi-k3')).toBeNull()
  })

  it('键按模型名，OpenRouter 的前缀不算，本机 Claude Code 单独一份', () => {
    expect(thinkKey('openrouter', 'openai/gpt-5.6-luna')).toBe('gpt-5.6-luna')
    expect(thinkKey('claude-code', 'sonnet')).toBe('claude-code/sonnet')
    expect(thinkLevel({ 'claude-code/sonnet': 'xhigh' }, 'claude-code', 'sonnet')).toBe('xhigh')
    expect(thinkLevel({ 'claude-code/sonnet': 'xhigh' }, 'claude-code', 'haiku')).toBe('low')
  })

  it('旧设置「深度思考默认开」换成高（只能开关的是开）', () => {
    expect(legacyOnLevel('deepseek', 'deepseek-flash')).toBe('on')
    expect(legacyOnLevel('kimi', 'kimi-k3.1-pro')).toBe('high')
    expect(legacyOnLevel('kimi', 'kimi-k3')).toBeNull()
  })

  it('关的时候界面不显示思考', () => {
    expect(showsThinking('off')).toBe(false)
    expect(showsThinking(null)).toBe(false)
    expect(showsThinking('low')).toBe(true)
    expect(showsThinking('on')).toBe(true)
  })
})

describe('思考强度：请求参数', () => {
  it('能选档的模型按档位给 reasoning_effort', () => {
    expect(body('glm-5.3-flash', 'max').reasoning_effort).toBe('max')
    expect(body('glm-5.3-flash', 'high').reasoning_effort).toBe('high')
    expect(body('glm-5.3-flash').reasoning_effort).toBe('low')
    expect(body('gpt-5.6-luna', 'xhigh').reasoning_effort).toBe('xhigh')
    expect(body('gpt-5.6-luna', 'medium').reasoning_effort).toBe('medium')
    expect(body('gpt-5.6-luna', 'off').reasoning_effort).toBeUndefined()
    expect(body('gpt-5.6-luna').reasoning_effort).toBeUndefined()
    expect(body('gemini-3.8-flash', 'medium').reasoning_effort).toBe('medium')
    expect(body('gemini-3.8-flash').reasoning_effort).toBe('low')
    expect(body('kimi-k3.1-pro', 'max').reasoning_effort).toBe('max')
    expect(body('kimi-k3.1-pro').reasoning_effort).toBe('low')
  })

  it('这个模型没有的档不发出去，换成最省的', () => {
    expect(body('glm-5.3-flash', 'medium').reasoning_effort).toBe('low')
    expect(body('gemini-3.8-flash', 'off').reasoning_effort).toBe('low')
    expect(body('deepseek-flash', 'high').thinking).toEqual({ type: 'disabled' })
  })

  it('只能开关的模型各用各的开关字段', () => {
    expect(body('deepseek-flash', 'on').thinking).toEqual({ type: 'enabled' })
    expect(body('deepseek-flash', 'off').thinking).toEqual({ type: 'disabled' })
    expect(body('deepseek-flash').thinking).toEqual({ type: 'disabled' })
    expect(body('qwen3.8-flash', 'on').enable_thinking).toBe(true)
    expect(body('qwen3.8-flash').enable_thinking).toBe(false)
    expect(body('doubao-seed-1-6-251015', 'on').thinking).toEqual({ type: 'enabled' })
    expect(body('kimi-k2.6', 'off').thinking).toEqual({ type: 'disabled' })
    expect(body('glm-4.6', 'on').thinking).toEqual({ type: 'enabled' })
    expect(body('glm-4.6v', 'on').thinking).toEqual({ type: 'disabled' })
  })

  it('OpenRouter 用 reasoning 对象，最多到 high，不加别家的字段', () => {
    const b = body('openai/gpt-5.6-luna', 'xhigh', 'https://openrouter.ai/api/v1')
    expect(b.reasoning).toEqual({ effort: 'high' })
    expect(b.reasoning_effort).toBeUndefined()
    expect(body('openai/gpt-5.6-luna', 'low', 'https://openrouter.ai/api/v1').reasoning).toEqual({ effort: 'low' })
    expect(body('openai/gpt-5.6-luna', 'off', 'https://openrouter.ai/api/v1').reasoning).toBeUndefined()
  })

  it('总在想的、认不出的模型什么都不加', () => {
    expect(body('kimi-k3', 'high')).toEqual({ model: 'kimi-k3', messages: [], stream: false })
    expect(body('claude-haiku-5-5', 'high').thinking).toBeUndefined()
    expect(thinkParams('llama-4', '', 'high')).toBeNull()
  })

  it('本机 Claude Code 的 --effort 跟着档位，没给就是 low', () => {
    expect(ccEffort('max')).toBe('max')
    expect(ccEffort('xhigh')).toBe('xhigh')
    expect(ccEffort(undefined)).toBe('low')
    expect(ccEffort('off')).toBe('low')
  })
})
