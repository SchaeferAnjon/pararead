// 保版面翻译出错了怎么办（2026-11-25 用户：「这个翻译不稳定啊，老是出错，而且不快」）：错归哪一类、按类重试。
// 整条路（假翻译服务、假 BabelDOC）在 layoutTrFlaky.test.ts。
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, shell: {} }))

import { trErrKind, trWhy } from '../src/shared/layoutTr'
import { withTrRetry } from '../src/main/trRetry'
import { errorLine } from '../src/main/babeldoc'

const fast = { sleep: async () => {}, noJitter: true }

describe('错归哪一类', () => {
  it('按状态码和原话认：限流、超时、5xx、网络、Key、余额、BabelDOC', () => {
    expect(trErrKind('AI 服务 429：rate limit', 429)).toBe('rate')
    expect(trErrKind('AI 服务 429：1113 余额不足', 429)).toBe('balance')
    expect(trErrKind('AI 服务 402：Insufficient Balance', 402)).toBe('balance')
    expect(trErrKind('AI 服务 401：Authentication Fails', 401)).toBe('auth')
    expect(trErrKind('Claude Code：Not logged in · Please run /login')).toBe('auth')
    expect(trErrKind('AI 服务 503：overloaded', 503)).toBe('server')
    expect(trErrKind('请求超时')).toBe('timeout')
    expect(trErrKind('Request timed out')).toBe('timeout')
    expect(trErrKind('网络错误：fetch failed（ECONNRESET）')).toBe('network')
    expect(trErrKind('BabelDOC 退出码 1：boom')).toBe('layout')
    expect(trErrKind('BabelDOC：Scanned PDF detected.')).toBe('scanned')
    expect(trErrKind('92% 的原文原样留着')).toBe('same')
  })
  it('每类有一句人话', () => {
    expect(trWhy('timeout')).toBe('翻译服务超时')
    expect(trWhy('same')).toBe('译文和原文一样')
  })
  it('从 BabelDOC 的输出里挑出错的那行（它这时退出码是 0）', () => {
    const tail = '[11/25/26 22:49:32] INFO     INFO:babeldoc.format.pdf.high_level:Peak memory usage: 873.06 MB      high_level.py:457\n                    ERROR    ERROR:babeldoc.format.pdf.high_level:translate error: Scanned PDF detected.          high_level.py:788\nTotal tokens: 0'
    expect(errorLine(tail)).toBe('translate error: Scanned PDF detected.')
  })
})

describe('一个请求失败了：按种类重试', () => {
  it('限流等一会再试，第三次成了', async () => {
    const waits: number[] = []
    let n = 0
    const r = await withTrRetry(
      async () => {
        if (++n < 3) throw Object.assign(new Error('AI 服务 429：rate limit'), { status: 429 })
        return 'ok'
      },
      { noJitter: true, sleep: async (ms) => void waits.push(ms) }
    )
    expect([r, n, waits]).toEqual(['ok', 3, [2000, 5000]])
  })
  it('Key 不对不重试，马上报', async () => {
    let n = 0
    const e = await withTrRetry(async () => {
      n++
      throw Object.assign(new Error('AI 服务 401：Authentication Fails'), { status: 401 })
    }, fast).catch((x) => x)
    expect([n, e.kind]).toEqual([1, 'auth'])
  })
  it('超时重试两次，还超时就报超时', async () => {
    let n = 0
    const e = await withTrRetry(async () => {
      n++
      throw Object.assign(new Error('timeout'), { kind: 'timeout' })
    }, fast).catch((x) => x)
    expect([n, e.kind, e.attempts]).toEqual([3, 'timeout', 3])
  })
})

