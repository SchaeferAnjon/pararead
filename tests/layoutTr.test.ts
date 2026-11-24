// 保版面翻译（对照、译文看法）：先翻哪几页、译文页在哪个文件、给 BabelDOC 的参数、本机转发口
import { describe, expect, it } from 'vitest'
import { babelLang, FIRST_AROUND, indexBatch, LATER_BATCH, nextBatch, pagesArg } from '../src/shared/layoutTr'
import { TrProxy } from '../src/main/trProxy'

describe('先翻哪几页', () => {
  it('第一批：在看的这一页和前后各 2 页', () => {
    expect(nextBatch(43, 9, new Set())).toEqual([7, 8, 9, 10, 11])
    expect(FIRST_AROUND).toBe(2)
  })
  it('开头、结尾不越界', () => {
    expect(nextBatch(43, 1, new Set())).toEqual([1, 2, 3])
    expect(nextBatch(7, 7, new Set())).toEqual([5, 6, 7])
  })
  it('附近翻好了：从这里往后接着翻，一批 12 页，到底再从头补', () => {
    const done = new Set([7, 8, 9, 10, 11])
    expect(nextBatch(43, 9, done)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
    expect(LATER_BATCH).toBe(12)
    const most = new Set(Array.from({ length: 43 }, (_, i) => i + 1).filter((p) => p < 3 || p > 6))
    expect(nextBatch(43, 40, most)).toEqual([3, 4, 5, 6])
  })
  it('剩下的不到一批半就一次翻完（少起一次 BabelDOC）', () => {
    const done = new Set(Array.from({ length: 25 }, (_, i) => i + 1))
    expect(nextBatch(43, 20, done)).toEqual(Array.from({ length: 18 }, (_, i) => i + 26))
  })
  it('跳到后面没翻的地方：先翻那里', () => {
    const done = new Set([1, 2, 3])
    expect(nextBatch(43, 30, done)).toEqual([28, 29, 30, 31, 32])
  })
  it('正在翻的不再排；全翻完是空的', () => {
    expect(nextBatch(10, 5, new Set(), new Set([3, 4, 5, 6, 7]))).toEqual([1, 2, 8, 9, 10])
    expect(nextBatch(3, 2, new Set([1, 2, 3]))).toEqual([])
  })
})

describe('一批的译文文件', () => {
  it('只含这一批的页、按页码升序（BabelDOC --only-include-translated-page 实测）', () => {
    expect(indexBatch([11, 7, 9], 'b.pdf')).toEqual({ 7: { file: 'b.pdf', at: 1 }, 9: { file: 'b.pdf', at: 2 }, 11: { file: 'b.pdf', at: 3 } })
  })
  it('--pages 连着的写成区间', () => {
    expect(pagesArg([9, 7, 8, 11, 3])).toBe('3,7-9,11')
    expect(pagesArg([5])).toBe('5')
  })
  it('目标语言给 BabelDOC 的代码：简体写 zh-CN（它按 CN 选中文字体）', () => {
    expect(babelLang('简体中文')).toBe('zh-CN')
    expect(babelLang('繁體中文')).toBe('zh-TW')
    expect(babelLang('日本語')).toBe('ja')
    expect(babelLang('English')).toBe('en')
  })
})

describe('给 BabelDOC 的本机翻译口', () => {
  const post = (url: string, token: string, body: unknown) =>
    fetch(`${url}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('带对的令牌：转给 ParaRead 选的那家，回 OpenAI 的格式', async () => {
    const seen: unknown[] = []
    const p = new TrProxy(async (c, useId) => {
      seen.push({ c, useId })
      return { text: '你好', prompt: 10, completion: 2 }
    })
    p.useId = 'layout-p1'
    const url = await p.start()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    const r = await post(url, p.token, { model: 'pararead', messages: [{ role: 'user', content: 'Hello' }], response_format: { type: 'json_object' }, max_tokens: 2048 })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { choices: { message: { content: string } }[]; usage: { total_tokens: number } }
    expect(j.choices[0].message.content).toBe('你好')
    expect(j.usage.total_tokens).toBe(12)
    expect(seen).toEqual([{ c: { messages: [{ role: 'user', content: 'Hello' }], json: true, maxTokens: 2048 }, useId: 'layout-p1' }])
    p.stop()
  })
  it('令牌不对：401，不转发', async () => {
    let called = false
    const p = new TrProxy(async () => ((called = true), { text: '', prompt: 0, completion: 0 }))
    const url = await p.start()
    const r = await post(url, 'nope', { messages: [{ role: 'user', content: 'x' }] })
    expect(r.status).toBe(401)
    expect(called).toBe(false)
    p.stop()
  })
  it('上游限流回 429（BabelDOC 碰到 429 会等一会再试），别的错 502', async () => {
    let n = 0
    const p = new TrProxy(async () => {
      n++
      throw Object.assign(new Error(n === 1 ? 'HTTP 429 rate limit' : 'boom'), { status: n === 1 ? 429 : 500 })
    })
    const url = await p.start()
    expect((await post(url, p.token, { messages: [{ role: 'user', content: 'x' }] })).status).toBe(429)
    expect((await post(url, p.token, { messages: [{ role: 'user', content: 'x' }] })).status).toBe(502)
    p.stop()
  })
})
