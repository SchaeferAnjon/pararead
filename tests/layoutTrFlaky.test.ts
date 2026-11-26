// 保版面翻译不稳定（2026-11-25 用户：「这个翻译不稳定啊，老是出错，而且不快」）整条路的测试：
// 请求按错的种类重试（假翻译服务随机超时、限流、5xx），一批 BabelDOC 出错拆开重翻，某页永远翻不成只标那页、别的页照常翻完，
// 翻译服务本身用不了（Key 不对、一直连不上）才整篇停下。只引改之前就有的接口，改前跑这个文件是挂的（报告里有数）。
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, shell: {} }))

import type { LayoutTrState } from '../src/shared/layoutTr'
import { TrProxy } from '../src/main/trProxy'
import { LayoutTranslator } from '../src/main/babeldoc'
// @ts-expect-error 测试夹具是 .mjs（假 BabelDOC 也用它）
import { makePdf, srcText } from './fixtures/fakePdf.mjs'

const fast = { sleep: async () => {}, noJitter: true }
/** 一页自动试几次（MAX_PAGE_TRIES） */
const TRIES = 3

describe('本机转发口：假翻译服务随机超时、限流、5xx', () => {
  const post = (url: string, token: string, text: string) =>
    fetch(`${url}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }] }) })
  it('40 段一起翻：随机出错的都重试成了，只有永远失败的那段回 502、不让 BabelDOC 再试', async () => {
    // 固定种子的随机数：每段前两次随机超时（不回）、429、503 或成功
    let seed = 7
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const tries = new Map<string, number>()
    const p = new TrProxy(
      (c, _id, signal) => {
        const text = String(c.messages[0].content)
        const n = (tries.get(text) ?? 0) + 1
        tries.set(text, n)
        if (text === 'POISON') return Promise.reject(Object.assign(new Error('AI 服务 500：boom'), { status: 500 }))
        const roll = n <= 2 ? rnd() : 1
        if (roll < 0.2) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) // 超时：一直不回
        if (roll < 0.4) return Promise.reject(Object.assign(new Error('AI 服务 429：rate limit'), { status: 429 }))
        if (roll < 0.6) return Promise.reject(Object.assign(new Error('AI 服务 503：overloaded'), { status: 503 }))
        return Promise.resolve({ text: `译 ${text}`, prompt: 1, completion: 1 })
      },
      () => {},
      { attemptMs: () => 50, retry: fast }
    )
    const url = await p.start()
    const texts = [...Array.from({ length: 39 }, (_, i) => `para ${i}`), 'POISON']
    const res = await Promise.all(texts.map(async (t) => ({ t, r: await post(url, p.token, t) })))
    for (const { t, r } of res) {
      if (t === 'POISON') {
        expect(r.status).toBe(502)
        expect(r.headers.get('x-should-retry')).toBe('false')
      } else {
        expect(r.status).toBe(200)
        expect(((await r.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe(`译 ${t}`)
      }
    }
    expect(p.failed).toBe(1)
    expect(p.retries).toBeGreaterThan(10)
    expect(tries.get('POISON')).toBe(4) // 5xx：第一次加重试 3 次
    p.stop()
  })
  it('空译文也重试，重试了还空才算失败', async () => {
    let n = 0
    const p = new TrProxy(async () => ({ text: ++n < 2 ? ' ' : '好', prompt: 0, completion: 0 }), () => {}, { retry: fast })
    const url = await p.start()
    expect((await post(url, p.token, 'x')).status).toBe(200)
    expect(n).toBe(2)
    p.stop()
  })
})

// 假 BabelDOC 是 sh 脚本：Windows 上不跑
describe.skipIf(process.platform === 'win32')('一批翻不成：只标那几页，别的页照常翻完', () => {
  const root = mkdtempSync(join(tmpdir(), 'pr-trretry-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const TOTAL = 12

  function setup(name: string, conf: { crash: number[]; same: number[] }, trOnce: () => Promise<string>) {
    const dir = join(root, name)
    const comp = join(dir, 'babeldoc')
    mkdirSync(join(comp, 'venv', 'bin'), { recursive: true })
    writeFileSync(join(comp, 'installed.json'), JSON.stringify({ version: 'test' }))
    // babelCommand 起的是 venv/bin/python -c …：换成跑假 BabelDOC 的脚本（丢掉 -c 和那段代码）
    const py = join(comp, 'venv', 'bin', 'python')
    writeFileSync(py, `#!/bin/sh\nshift 2\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${join(__dirname, 'fixtures', 'fake-babeldoc.mjs')}" "$@"\n`)
    chmodSync(py, 0o755)
    const pdf = join(dir, 'paper.pdf')
    writeFileSync(pdf, makePdf(Array.from({ length: TOTAL }, (_, i) => srcText(i + 1))))
    const log = join(dir, 'runs.log')
    writeFileSync(join(dir, 'conf.json'), JSON.stringify({ ...conf, log }))
    const states: LayoutTrState[] = []
    const lt = new LayoutTranslator({
      dataDir: dir,
      componentDir: comp,
      settings: { get: () => ({ targetLang: '简体中文', trOnOpen: true }) } as never,
      ai: { trWarm: async () => {}, trReady: () => null, trQps: () => 4, trConcurrency: () => 4, trLocal: () => false, trName: () => 'DeepSeek', trOnce } as never,
      pdfPath: () => pdf,
      broadcast: (_c, s) => void states.push(s as LayoutTrState),
      log: () => {},
      mineruUv: () => null,
      trRetry: fast,
      retryWaitMs: () => 1
    })
    const confPath = join(dir, 'conf.json')
    const runs = (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])
    return { lt, states, confPath, runs }
  }
  /** 等到不再翻（全翻完、标完没翻成，或整篇停下） */
  async function settle(lt: LayoutTranslator, id: string): Promise<LayoutTrState> {
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const s = lt.state(id)
      const running = (lt as unknown as { running: boolean }).running
      if (!running && !s.busy.length && (s.error || Object.keys(s.pages).length + Object.keys(s.failed).length >= TOTAL)) return s
    }
    throw new Error('翻译一直没停下')
  }

  it('第 7 页让 BabelDOC 崩、第 9 页永远照抄原文：别的 10 页都翻好，只有 7、9 标没翻成，整篇不停', async () => {
    const { lt, confPath, runs } = setup('crash', { crash: [7], same: [9] }, async () => '好')
    process.env.FAKE_BABEL_CONF = confPath
    lt.focus('p', 1, TOTAL)
    const s = await settle(lt, 'p')
    lt.stop()
    expect(s.error).toBeNull()
    expect(Object.keys(s.pages).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 11, 12])
    expect(s.failed).toEqual({ 7: '排版组件 BabelDOC 出错', 9: '译文和原文一样' })
    // 带第 7 页的那批一半一半拆开重翻（拆的时候不记次数，别的页不受连累），最后第 7 页单独试够 3 次；第 9 页不用缓存再翻
    const r = runs()
    expect(r.filter((l) => l === '7').length).toBe(TRIES)
    expect(r.filter((l) => /^9 fresh$/.test(l)).length).toBe(TRIES - 1)
  }, 60_000)

  it('翻译服务一直 503：连着 3 批一个请求都没成就整篇停下说原因，页不标没翻成', async () => {
    const { lt, confPath, runs } = setup('down', { crash: [], same: [] }, async () => {
      throw Object.assign(new Error('AI 服务 503：service unavailable'), { status: 503 })
    })
    process.env.FAKE_BABEL_CONF = confPath
    lt.focus('p', 1, TOTAL)
    const s = await settle(lt, 'p')
    lt.stop()
    expect([s.error, s.errorRaw]).toEqual(['翻译服务暂时出错，连着 3 批都没翻成', expect.stringMatching(/503/)])
    expect(s.failed).toEqual({})
    expect(runs().length).toBe(3)
  }, 60_000)

  it('Key 不对：第一批就停下，不往下花钱', async () => {
    const { lt, confPath, runs } = setup('auth', { crash: [], same: [] }, async () => {
      throw Object.assign(new Error('AI 服务 401：Authentication Fails'), { status: 401 })
    })
    process.env.FAKE_BABEL_CONF = confPath
    lt.focus('p', 1, TOTAL)
    const s = await settle(lt, 'p')
    lt.stop()
    expect([s.error, s.errorRaw]).toEqual(['翻译服务的 Key 不对或没登录', expect.stringMatching(/401/)])
    expect(runs().length).toBe(1)
  }, 60_000)
})
