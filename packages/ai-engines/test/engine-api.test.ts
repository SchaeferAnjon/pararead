/**
 * 没装命令行时的 AI（task-587os）：API Key 直接问接口、验 Key、本机模型、交给自带 OpenCode 的配置。
 * 用本机假的 HTTP 服务演 Anthropic、OpenAI 兼容、Ollama；真 Key 那一段要 CN_TEST_ANTHROPIC_API_KEY（没有就跳过）。
 * 自带 OpenCode 关掉免费模型那一段要本机有 opencode（CN_TEST_OPENCODE 指定，或 /opt/homebrew/bin/opencode）。
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiEngine, askAnthropic, bundledConfig, httpProblem, localEngine, probeLocal, verifyKey } from '../src/engine-api'
import { fitPick, modelsOf, normalizePick, pickLabel, resolvePick } from '../src/shared'
import { preferModel } from '../src/shared'

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void
let server: Server
let base = ''
const seen: { url: string; headers: IncomingMessage['headers']; body: string }[] = []
let handler: Handler = () => {}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body })
      handler(req, body, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const sse = (res: ServerResponse, lines: string[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const l of lines) res.write(`${l}\n\n`)
  res.end()
}
const env = () => ({ CN_API_BASE_ANTHROPIC: base, CN_API_BASE_DEEPSEEK: base, CN_API_BASE_OPENROUTER: base, CN_API_BASE_OPENAI: base, CN_LOCAL_BASE_OLLAMA: base })

describe('直接问接口', () => {
  it('Anthropic Messages：流式收字，effort 放 output_config，Key 在 x-api-key', async () => {
    seen.length = 0
    handler = (_req, _b, res) =>
      sse(res, [
        'event: message_start\ndata: {"type":"message_start"}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"你"}}',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"好"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      ])
    let got = ''
    const text = await askAnthropic('sk-ant-test1234', { system: '系统', prompt: '问', model: 'claude-haiku-5-5', effort: 'low', signal: new AbortController().signal, onText: (d) => (got += d) }, env())
    expect(text).toBe('你好')
    expect(got).toBe('你好')
    const req = seen[0]!
    expect(req.url).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-ant-test1234')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(req.body)
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', stream: true, system: '系统', output_config: { effort: 'low' } })
    expect(body.messages[0].content.at(-1)).toEqual({ type: 'text', text: '问' })
    expect(body.temperature).toBeUndefined()
  })

  it('Key 不认：一句人话，带状态码，不贴英文', async () => {
    handler = (_req, _b, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')
    }
    await expect(verifyKey('anthropic', 'sk-ant-bad', env())).rejects.toMatchObject({ status: 401, message: expect.stringContaining('这把Key Anthropic不认（401）') })
  })

  it('验 Key：拉到模型，推荐的排第一，名字去掉 Claude', async () => {
    handler = (_req, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }] }))
    }
    const models = await verifyKey('anthropic', 'sk-ant-good', env())
    expect(models.map((m) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])
    expect(models[0]!.label).toBe('Sonnet 5.5')
    expect(models[0]!.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('OpenRouter：/models 不看 Key，先问 /key', async () => {
    seen.length = 0
    handler = (req, _b, res) => {
      if (req.url === '/key') {
        res.writeHead(401)
        res.end('{"error":{"message":"No auth credentials found"}}')
        return
      }
      res.writeHead(200)
      res.end('{"data":[]}')
    }
    await expect(verifyKey('openrouter', 'sk-or-bad1234', env())).rejects.toMatchObject({ status: 401 })
    expect(seen.map((s) => s.url)).toEqual(['/key'])
  })

  it('DeepSeek 直接问：OpenAI 兼容 chat/completions，Bearer Key，没给模型用推荐的', async () => {
    seen.length = 0
    handler = (_req, _b, res) => sse(res, ['data: {"choices":[{"delta":{"reasoning_content":"想"}}]}', 'data: {"choices":[{"delta":{"content":"答"}}]}', 'data: [DONE]'])
    const e = apiEngine('deepseek', { key: () => 'sk-deep-1234', env: env() })
    const r = await e.run({ prompt: '问', system: '系统', cwd: tmpdir(), signal: new AbortController().signal, onText: () => {} })
    expect(r.text).toBe('答')
    expect(seen[0]!.url).toBe('/chat/completions')
    expect(seen[0]!.headers.authorization).toBe('Bearer sk-deep-1234')
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ model: 'deepseek-chat', stream: true, messages: [{ role: 'system', content: '系统' }, { role: 'user', content: '问' }] })
  })

  it('没填 Key：说清楚去哪填', async () => {
    const e = apiEngine('anthropic', { key: () => undefined })
    await expect(e.run({ prompt: '问', system: '', cwd: tmpdir(), signal: new AbortController().signal, onText: () => {} })).rejects.toThrow('还没填Anthropic的Key')
  })

  it('要动手却没有自带的 OpenCode：说清楚，不悄悄改成只聊天', async () => {
    const e = apiEngine('anthropic', { key: () => 'sk-ant-1234567', opencode: () => null })
    await expect(e.run({ prompt: '问', system: '', cwd: tmpdir(), signal: new AbortController().signal, onText: () => {}, mcp: { url: 'http://x', token: 't', tools: [] } })).rejects.toThrow('软件自带的OpenCode不在')
  })

  it('全能模式不给 mcp、没有自带 OpenCode（ParaRead 没打包它）：照旧直接问接口，不报错', async () => {
    seen.length = 0
    handler = (_req, _b, res) => sse(res, ['data: {"choices":[{"delta":{"content":"直接答"}}]}', 'data: [DONE]'])
    const e = apiEngine('deepseek', { key: () => 'sk-deep-1234', opencode: () => null, env: env() })
    const r = await e.run({ prompt: '问', system: '系统', cwd: tmpdir(), omni: true, signal: new AbortController().signal, onText: () => {} })
    expect(r.text).toBe('直接答')
    expect(seen[0]!.url).toBe('/chat/completions')
  })

  it('全能模式不给 mcp、有自带 OpenCode：交给它动手（权限全放开，只开这一家），不直接问接口', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cn-bundled-oc-'))
    try {
      const exe = join(dir, 'opencode')
      writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${join(__dirname, 'fixtures', 'fake-acp.mjs')}" "$@"\n`)
      chmodSync(exe, 0o755)
      seen.length = 0
      process.env.FAKE_ACP_ARGS = '1'
      const e = apiEngine('anthropic', { key: () => 'sk-ant-1234567', opencode: () => ({ path: exe, dataDir: join(dir, 'data') }), env: env() })
      try {
        const r = await e.run({ prompt: '用户说：\n你好', system: '系统', cwd: dir, omni: true, signal: new AbortController().signal, onText: () => {} })
        expect(r.text).toContain('它自己写文件 a1；')
        expect(r.text).toContain('MCP ；')
        expect(r.text).toContain(`设置 ${bundledConfig('anthropic', true)}`)
        expect(seen).toEqual([])
      } finally {
        delete process.env.FAKE_ACP_ARGS
        e.dispose?.()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('出错说成人话：余额、太快、模型没有', () => {
    expect(httpProblem('DeepSeek', 402, 'Insufficient Balance').message).toContain('余额不够')
    expect(httpProblem('Anthropic', 429, 'rate').message).toContain('太快了')
    expect(httpProblem('Anthropic', 404, 'model: x').message).toContain('没有这个模型')
  })
})

describe('本机模型', () => {
  it('Ollama 开着：列模型和大小；聊天走 /v1/chat/completions，不带 Key；给了工具也只聊天', async () => {
    seen.length = 0
    handler = (req, _b, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200)
        res.end(JSON.stringify({ models: [{ name: 'qwen3.5:9b', size: 7_086_000_000 }] }))
        return
      }
      sse(res, ['data: {"choices":[{"delta":{"content":"本机答"}}]}', 'data: [DONE]'])
    }
    const found = await probeLocal('ollama', env())
    expect(found).toEqual({ on: true, models: [{ id: 'qwen3.5:9b', size: 7_086_000_000 }] })
    const r = await localEngine('ollama', env()).run({ prompt: '问', system: '系统', model: 'qwen3.5:9b', cwd: tmpdir(), history: '之前聊过的', signal: new AbortController().signal, onText: () => {}, mcp: { url: 'x', token: 't', tools: ['note_create'] } })
    expect(r.text).toBe('本机答')
    const chat = seen.find((s) => s.url === '/v1/chat/completions')!
    expect(chat.headers.authorization).toBeUndefined()
    const body = JSON.parse(chat.body)
    expect(body.tools).toBeUndefined()
    expect(body.messages[0].content).toContain('你没有任何工具')
    expect(body.messages[1].content).toBe('之前聊过的\n\n问')
  })

  it('没开：on 是 false，不抛', async () => {
    const found = await probeLocal('lmstudio', { CN_LOCAL_BASE_LMSTUDIO: 'http://127.0.0.1:9' })
    expect(found.on).toBe(false)
    expect(found.models).toEqual([])
  })
})

describe('设置里的叫法和挑选', () => {
  it('Claude API · Sonnet 5.5 · Medium；本机模型写模型名', () => {
    expect(pickLabel({ engine: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' })).toBe('Claude API · Sonnet 5.5 · Medium')
    expect(pickLabel({ engine: 'ollama', model: 'qwen3.5:9b' }, modelsOf('ollama', [{ id: 'qwen3.5:9b', label: 'qwen3.5:9b', efforts: [] }]))).toBe('Ollama · qwen3.5:9b')
  })
  it('旧设置照读，新的家也认', () => {
    expect(normalizePick({ engine: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' })).toEqual({ engine: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' })
    expect(normalizePick({ engine: 'nope' })).toBeNull()
    expect(normalizePick({ engine: 'claude' })).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
  })
  it('没选模型：Claude API 用 Sonnet 5.5（列表第一）', () => {
    expect(fitPick('anthropic', modelsOf('anthropic'), {})).toEqual({ engine: 'anthropic', model: 'claude-sonnet-5-5', effort: 'high' })
  })
  it('看图问：Claude API 能看，本机模型不能看时回到 Claude Code', () => {
    expect(resolvePick({ default: { engine: 'anthropic', model: 'claude-sonnet-5-5' }, features: {} }, 'vision').engine).toBe('anthropic')
    expect(resolvePick({ default: { engine: 'ollama', model: 'x' }, features: {} }, 'vision').engine).toBe('claude')
  })
  it('推荐的模型不在列表里用第一个', () => {
    expect(preferModel(['a', 'b'], ['c'])).toBe('a')
    expect(preferModel(['a', 'claude-sonnet-5-5'], ['claude-sonnet-5-5'])).toBe('claude-sonnet-5-5')
  })
})

describe('自带 OpenCode 的配置', () => {
  it('只开这一家、不自动升级、不分享；全能模式关着拒改文件和跑命令', () => {
    expect(JSON.parse(bundledConfig('anthropic', true, 'claude-sonnet-5-5'))).toEqual({
      permission: { '*': 'allow' },
      enabled_providers: ['anthropic'],
      model: 'anthropic/claude-sonnet-5-5',
      small_model: 'anthropic/claude-haiku-5-5',
      autoupdate: false,
      share: 'disabled',
    })
    expect(JSON.parse(bundledConfig('deepseek', false)).permission).toMatchObject({ edit: 'deny', bash: 'deny' })
  })

  // 免费模型关干净了没有：在隔离的家目录里跑 opencode models，只能列出这一家的
  const oc = process.env.CN_TEST_OPENCODE || ['/opt/homebrew/bin/opencode'].find((p) => existsSync(p))
  it.skipIf(!oc)('opencode models：不给配置有 opencode/ 免费模型；给了配置只剩 anthropic/', () => {
    const home = mkdtempSync(join(tmpdir(), 'cn-oc-'))
    try {
      const xdg = { XDG_CONFIG_HOME: join(home, 'c'), XDG_DATA_HOME: join(home, 'd'), XDG_CACHE_HOME: join(home, 'k'), XDG_STATE_HOME: join(home, 's') }
      const run = (extra: Record<string, string>) => execFileSync(oc!, ['models'], { env: { HOME: home, PATH: '/usr/bin:/bin', TMPDIR: tmpdir(), ...xdg, ...extra }, encoding: 'utf8', timeout: 120_000 })
      const free = run({}).split('\n').filter(Boolean)
      expect(free.some((m) => m.startsWith('opencode/'))).toBe(true)
      const ours = run({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENCODE_CONFIG_CONTENT: bundledConfig('anthropic', true) }).split('\n').filter(Boolean)
      expect(ours.length).toBeGreaterThan(0)
      expect(ours.every((m) => m.startsWith('anthropic/'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 240_000)
})

describe('真 Key（CN_TEST_ANTHROPIC_API_KEY）', () => {
  const key = process.env.CN_TEST_ANTHROPIC_API_KEY
  it.skipIf(!key)('验 Key 拉到 Sonnet 5.5，Haiku 5.5 · Low 真问一句', async () => {
    const models = await verifyKey('anthropic', key!)
    expect(models[0]!.id).toBe('claude-sonnet-5-5')
    const text = await askAnthropic(key!, { system: '只回答一个词。', prompt: '1+1 等于几？只写阿拉伯数字。', model: 'claude-haiku-5-5', effort: 'low', signal: AbortSignal.timeout(60_000), onText: () => {} })
    expect(text).toContain('2')
  }, 90_000)
})
