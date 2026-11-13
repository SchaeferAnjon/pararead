import { describe, expect, it } from 'vitest'
import { thinkMode, thinkParams } from '../src/shared/thinking'
import { buildRequest } from '../src/main/glm'

const body = (model: string, thinking: boolean, baseUrl = 'https://x/v1') => buildRequest({ apiKey: 'k', model, baseUrl, messages: [], thinking }).body

describe('深度思考参数', () => {
  it('每家服务开关都换成自己的参数', () => {
    expect(body('deepseek-flash', true).thinking).toEqual({ type: 'enabled' })
    expect(body('deepseek-flash', false).thinking).toEqual({
      type: 'disabled'
    })
    expect(body('glm-5.3-flash', true).reasoning_effort).toBe('high')
    expect(body('glm-5.3-flash', false).reasoning_effort).toBe('low')
    expect(body('glm-4.6v', true).thinking).toEqual({ type: 'disabled' })
    expect(body('qwen3.8-flash', true).enable_thinking).toBe(true)
    expect(body('qwen3.8-flash', false).enable_thinking).toBe(false)
    expect(body('doubao-seed-1-6-251015', false).thinking).toEqual({
      type: 'disabled'
    })
    expect(body('doubao-seed-1-6-251015', true).thinking).toEqual({
      type: 'enabled'
    })
    expect(body('gpt-5.6-luna', true).reasoning_effort).toBe('high')
    expect(body('gpt-5.6-luna', false).reasoning_effort).toBeUndefined()
    expect(body('gemini-3.8-flash', true).reasoning_effort).toBe('high')
    expect(body('gemini-3.8-flash', false).reasoning_effort).toBe('low')
    expect(body('kimi-k3.1-pro', true).reasoning_effort).toBe('max')
    expect(body('kimi-k2.6', false).thinking).toEqual({ type: 'disabled' })
  })

  it('OpenRouter 用 reasoning 对象，不加别家的字段', () => {
    const b = body('openai/gpt-5.6-luna', true, 'https://openrouter.ai/api/v1')
    expect(b.reasoning).toEqual({ effort: 'high' })
    expect(b.reasoning_effort).toBeUndefined()
    expect(body('openai/gpt-5.6-luna', false, 'https://openrouter.ai/api/v1').reasoning).toBeUndefined()
  })

  it('总在思考的模型不加参数，开关不显示', () => {
    expect(body('kimi-k3', true)).toEqual({
      model: 'kimi-k3',
      messages: [],
      stream: false
    })
    expect(body('claude-haiku-5-5', true).thinking).toBeUndefined()
    expect(thinkMode('kimi', 'kimi-k3')).toBe('always')
    expect(thinkMode('claude', 'claude-haiku-5-5')).toBe('always')
    expect(thinkMode('claude-code', 'haiku')).toBe('switch')
    expect(thinkMode('deepseek', 'deepseek-flash')).toBe('switch')
    expect(thinkMode('custom', 'llama-4')).toBe('unknown')
    expect(thinkParams('llama-4', '', true)).toBeNull()
  })
})
