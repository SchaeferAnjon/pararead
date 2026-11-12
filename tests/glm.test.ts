import { describe, expect, it } from 'vitest'
import { buildRequest, chatOnce, chatStream, deltaOf, GLM_BASE, parseJsonLoose, SseParser } from '../src/main/glm'

function sseResponse(chunks: string[], opts: { delayMs?: number; hang?: boolean } = {}): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      for (const c of chunks) {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        ctl.enqueue(enc.encode(c))
      }
      if (!opts.hang) ctl.close()
    }
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const ev = (content: string): string => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

describe('buildRequest', () => {
  it('走 Coding Plan 端点，文本模型带 reasoning_effort low', () => {
    const r = buildRequest({ apiKey: 'k', model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'hi' }], stream: true })
    expect(r.url).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions')
    expect(GLM_BASE).not.toMatch(/\/api\/paas\//)
    expect(r.body).toMatchObject({ model: 'glm-5.3-flash', stream: true, reasoning_effort: 'low' })
    expect((r.init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })
  it('看图模型不带 reasoning_effort，图片用 data URL 内联', () => {
    const r = buildRequest({
      apiKey: 'k',
      model: 'glm-4.6v',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }, { type: 'text', text: '解释' }] }]
    })
    expect(r.body.reasoning_effort).toBeUndefined()
    expect(r.body.thinking).toEqual({ type: 'disabled' })
    expect(JSON.stringify(r.body)).toContain('data:image/png;base64,AAA')
  })
})

describe('SseParser', () => {
  it('事件被任意切开也能拼回来', () => {
    const p = new SseParser()
    const full = ev('你好') + ev('世界') + 'data: [DONE]\n\n'
    const out: string[] = []
    for (let i = 0; i < full.length; i += 7) out.push(...p.feed(full.slice(i, i + 7)))
    out.push(...p.flush())
    expect(out.map((d) => deltaOf(d))).toEqual(['你好', '世界', null])
  })
  it('支持 \\r\\n 分隔和多行 data', () => {
    const p = new SseParser()
    expect(p.feed('data: a\r\ndata: b\r\n\r\n')).toEqual(['a\nb'])
  })
  it('思考内容不算正文', () => {
    expect(deltaOf(JSON.stringify({ choices: [{ delta: { reasoning_content: '想', content: null } }] }))).toBe('')
  })
  it('流里的错误对象抛出原文', () => {
    expect(() => deltaOf(JSON.stringify({ error: { code: '1302', message: '并发过高' } }))).toThrow(/1302/)
  })
})

describe('chatStream / chatOnce', () => {
  it('流式回调逐段收到内容', async () => {
    const parts: string[] = []
    const fetchImpl = (async () => sseResponse([ev('A'), ev('B'), 'data: [DONE]\n\n'])) as typeof fetch
    const full = await chatStream({ apiKey: 'k', model: 'glm-5.3-flash', messages: [], fetchImpl }, (d) => parts.push(d))
    expect(parts).toEqual(['A', 'B'])
    expect(full).toBe('AB')
  })
  it('HTTP 错误透出状态码和错误原文', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: '1113', message: '余额不足或无可用资源包' } }), { status: 429 })) as typeof fetch
    await expect(chatOnce({ apiKey: 'k', model: 'glm-5.3-flash', messages: [], fetchImpl, retryDelays: [] })).rejects.toThrow('AI 服务 429：1113 余额不足或无可用资源包')
  })
  it('429 限流自动重试，成功后返回', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      if (n < 3) return new Response(JSON.stringify({ error: { code: '1302', message: '您的账户已达到速率限制' } }), { status: 429 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }) as typeof fetch
    expect(await chatOnce({ apiKey: 'k', model: 'm', messages: [], fetchImpl, retryDelays: [5, 5, 5] })).toBe('ok')
    expect(n).toBe(3)
  })
  it('1113 不重试', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      return new Response(JSON.stringify({ error: { code: '1113', message: '余额不足' } }), { status: 429 })
    }) as typeof fetch
    await expect(chatOnce({ apiKey: 'k', model: 'm', messages: [], fetchImpl, retryDelays: [5, 5] })).rejects.toThrow(/1113/)
    expect(n).toBe(1)
  })
  it('没有 Key 直接报错', async () => {
    await expect(chatOnce({ apiKey: '', model: 'm', messages: [] })).rejects.toThrow(/API Key/)
  })
  it('流卡住时按空闲超时报错', async () => {
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const res = sseResponse([ev('A')], { hang: true })
      init?.signal?.addEventListener('abort', () => void res.body?.cancel().catch(() => {}))
      return res
    }) as typeof fetch
    await expect(chatStream({ apiKey: 'k', model: 'm', messages: [], fetchImpl, idleMs: 80 }, () => {})).rejects.toThrow(/超时/)
  })
  it('非流式返回内容', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '译文' } }] }), { status: 200 })) as typeof fetch
    expect(await chatOnce({ apiKey: 'k', model: 'm', messages: [], fetchImpl })).toBe('译文')
  })
  it('外部 abort 能停下请求', async () => {
    const ctl = new AbortController()
    const fetchImpl = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch
    const p = chatStream({ apiKey: 'k', model: 'm', messages: [], fetchImpl, signal: ctl.signal }, () => {})
    ctl.abort()
    await expect(p).rejects.toThrow()
  })
})

describe('parseJsonLoose', () => {
  it('能剥掉 ```json 代码块', () => {
    expect(parseJsonLoose<{ a: number }>('好的：\n```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })
  it('不是 JSON 时报错带原文', () => {
    expect(() => parseJsonLoose('没有')).toThrow(/没有返回 JSON/)
  })
})

describe('多家服务', () => {
  it('给了 baseUrl 就发到那家，DeepSeek 平时关思考、深度思考时打开', () => {
    const r = buildRequest({ apiKey: 'k', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/', messages: [{ role: 'user', content: 'hi' }], stream: true })
    expect(r.url).toBe('https://api.deepseek.com/chat/completions')
    expect(r.body).toMatchObject({ thinking: { type: 'disabled' }, stream_options: { include_usage: true } })
    expect(r.body.reasoning_effort).toBeUndefined()
    const t = buildRequest({ apiKey: 'k', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', messages: [], thinking: true, headers: { 'X-Use-Id': 'u1' } })
    expect(t.body.thinking).toEqual({ type: 'enabled' })
    expect((t.init.headers as Record<string, string>)['X-Use-Id']).toBe('u1')
  })
  it('思考内容走 onReasoning，不进正文', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先想想' } }] })}\n\n`,
        ev('答案'),
        'data: [DONE]\n\n'
      ])) as unknown as typeof fetch
    const thought: string[] = []
    const full = await chatStream(
      { apiKey: 'k', model: 'deepseek-flash', baseUrl: 'https://x', messages: [], fetchImpl, thinking: true, onReasoning: (t) => thought.push(t) },
      () => {}
    )
    expect(full).toBe('答案')
    expect(thought).toEqual(['先想想'])
  })
})
