import { describe, expect, it } from 'vitest'
import { cleanTranslation, parseTranslateBatch, buildTranslateBatch } from '../src/main/prompts'
import { makeBatches, Translator } from '../src/main/translate'
import type { ChatMsg } from '../src/main/glm'

describe('翻译提示词和解析', () => {
  it('批量请求用 seg 标签，系统提示要求保留公式和引用号', () => {
    const m = buildTranslateBatch([{ id: '1', text: 'Hello [12].' }, { id: '2', text: 'World $x$.' }], '简体中文')
    expect(m[0].content).toContain('[12]')
    expect(m[0].content).toContain('括注英文')
    expect(m[1].content).toBe('<seg id="1">Hello [12].</seg>\n\n<seg id="2">World $x$.</seg>')
  })
  it('解析 seg 输出', () => {
    const map = parseTranslateBatch('<seg id="1">你好 [12]。</seg>\n<seg id="2">\n世界 $x$。\n</seg>')
    expect(map.get('1')).toBe('你好[12]。')
    expect(map.get('2')).toBe('世界$x$。')
  })
  it('删掉中西文之间的半角空格，公式内部不动', () => {
    expect(cleanTranslation('使用 MAGIC NOR 门，延迟为 $a + b$ 个周期')).toBe('使用MAGIC NOR门，延迟为$a + b$个周期')
  })
})

describe('makeBatches', () => {
  it('按字数和段数切批', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ key: String(i), text: 'x'.repeat(1000), paperId: 'p' }))
    const b = makeBatches(items, 2800, 5)
    expect(b.map((x) => x.length)).toEqual([2, 2, 2, 1])
    const small = Array.from({ length: 7 }, (_, i) => ({ key: String(i), text: 'x', paperId: 'p' }))
    expect(makeBatches(small, 2800, 5).map((x) => x.length)).toEqual([5, 2])
  })
})

describe('Translator', () => {
  function setup(callImpl: (m: ChatMsg[]) => Promise<string>) {
    const cache = new Map<string, string>()
    const results: { key: string; text?: string; error?: string }[] = []
    let active = 0
    let maxActive = 0
    let calls = 0
    const t = new Translator({
      lang: () => '简体中文',
      getCached: (k) => cache.get(k) ?? null,
      putCached: (k, v) => cache.set(k, v),
      call: async (m) => {
        calls++
        active++
        maxActive = Math.max(maxActive, active)
        try {
          return await callImpl(m)
        } finally {
          active--
        }
      },
      onResult: (r) => results.push(r),
      debounceMs: 5,
      maxBatchItems: 2
    })
    return { t, cache, results, stats: () => ({ calls, maxActive }) }
  }

  const echo = async (m: ChatMsg[]): Promise<string> => {
    await new Promise((r) => setTimeout(r, 20))
    const segs = [...String(m[1].content).matchAll(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g)]
    return segs.map((s) => `<seg id="${s[1]}">译:${s[2]}</seg>`).join('\n')
  }

  it('合并请求、并发不超过 3、结果写缓存', async () => {
    const { t, results, cache, stats } = setup(echo)
    const texts = Array.from({ length: 10 }, (_, i) => ({ text: `para ${i}` }))
    expect(t.request('p', texts)).toEqual({})
    await new Promise((r) => setTimeout(r, 200))
    expect(results).toHaveLength(10)
    expect(results.every((r) => r.text?.startsWith('译:'))).toBe(true)
    expect(stats().calls).toBe(5)
    expect(stats().maxActive).toBeLessThanOrEqual(3)
    expect(cache.size).toBe(10)
  })

  it('已缓存的直接返回，不再请求', async () => {
    const { t, stats } = setup(echo)
    t.request('p', [{ text: 'hello world' }])
    await new Promise((r) => setTimeout(r, 100))
    const before = stats().calls
    const hit = t.request('p', [{ text: 'hello  world' }])
    expect(Object.values(hit)).toEqual(['译:hello world'])
    expect(stats().calls).toBe(before)
  })

  it('请求失败时每段都收到错误原文', async () => {
    const { t, results } = setup(async () => {
      throw new Error('GLM 429：1302 并发过高')
    })
    t.request('p', [{ text: 'a b' }, { text: 'c d' }])
    await new Promise((r) => setTimeout(r, 60))
    expect(results.map((r) => r.error)).toEqual(['GLM 429：1302 并发过高', 'GLM 429：1302 并发过高'])
  })

  it('取消后排队的段不再请求', async () => {
    const { t, stats } = setup(echo)
    t.request('p', Array.from({ length: 6 }, (_, i) => ({ text: `x ${i}` })))
    t.cancel('p')
    await new Promise((r) => setTimeout(r, 80))
    expect(stats().calls).toBe(0)
  })
})
