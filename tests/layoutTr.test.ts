// 保版面翻译（对照、译文看法）：先翻哪几页、译文页在哪个文件、给 BabelDOC 的参数、本机转发口
import { describe, expect, it } from 'vitest'
import { babelLang, FIRST_AROUND, indexBatch, LATER_BATCH, MIN_JUDGE_WORDS, nextBatch, pagesArg, SAME_RUNS, sameRunShare, untranslatedReason } from '../src/shared/layoutTr'
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
  it('上游出错：重试过了还不成回 502 并带 x-should-retry: false（重试在 ParaRead 这头做过了，限流也不回 429，免得 BabelDOC 一直重试）', async () => {
    let n = 0
    const p = new TrProxy(
      async () => {
        n++
        throw Object.assign(new Error(n <= 6 ? 'HTTP 429 rate limit' : 'boom'), { status: n <= 6 ? 429 : 500 })
      },
      () => {},
      { retry: { sleep: async () => {} } }
    )
    const url = await p.start()
    const r1 = await post(url, p.token, { messages: [{ role: 'user', content: 'x' }] })
    expect([r1.status, r1.headers.get('x-should-retry'), n]).toEqual([502, 'false', 6]) // 限流：第一次加退避重试 5 次
    const r2 = await post(url, p.token, { messages: [{ role: 'user', content: 'x' }] })
    expect([r2.status, n]).toEqual([502, 10]) // 5xx：第一次加重试 3 次
    p.stop()
  })
})

// 0.2.1：BabelDOC 的请求全失败时把原文当译文写出来、退出码 0（0.2.0 用户的 BST-GATNet）。每页比原文和译文的三连词
describe('译文页翻了没有', () => {
  const para = 'Accurate real-time driver stress detection under on-device computational constraints is a critical capability for intelligent vehicles and human-centric safety systems. While multimodal physiological signals provide rich information for stress recognition, robustly modeling their time-varying cross-signal interactions remains challenging in resource-constrained deployment scenarios.'
  it('原样留着（没翻）：判成没翻成', () => {
    expect(untranslatedReason(para, para)).toMatch(/原样留着/)
    // BabelDOC 重新排过版：断行、连字符不同也认得出
    expect(untranslatedReason(para, para.replace(/\. /g, '.\n').replace('physiological', 'physio-\nlogical'))).toMatch(/原样留着/)
  })
  it('翻成中文（只剩缩写、人名）：算翻好了', () => {
    const zh = '在设备端计算受限的条件下准确、实时地检测驾驶员压力，是智能车辆和以人为本的安全系统的一项关键能力。多模态生理信号（EDA、HR、BVP）为压力识别提供了丰富信息，但在资源受限的部署场景中，稳健地建模其随时间变化的跨信号交互仍然困难。'
    expect(sameRunShare(para, zh)).toBe(0)
    expect(untranslatedReason(para, zh)).toBeNull()
  })
  it('字太少的页（图、幻灯片标题页）不判，免得误判', () => {
    const slide = 'Hyperdimensional Computing Lecture 5 Learning goals'
    expect(slide.match(/[a-z]{2,}/gi)!.length).toBeLessThan(MIN_JUDGE_WORDS)
    expect(sameRunShare(slide, slide)).toBeNull()
    expect(untranslatedReason(slide, slide)).toBeNull()
  })
  it('参考文献页照规矩不翻：不判', () => {
    const refs = Array.from({ length: 12 }, (_, i) => `[${i + 1}] A. Author and B. Writer, "A study of things number ${i}," in Proc. IEEE Conf., 20${10 + i}, pp. 1-8.`).join('\n')
    expect(sameRunShare(refs, refs)).toBeNull()
  })
  it('作者-年份式的文献页（一条折成几行，带年份的行不到一半）也不判；正文里引了文献的页照判', () => {
    const entry = (i: number) => `Author${i} Name, Other Person, and Third Writer. 20${10 + i}. A study of reasoning in language\nmodels with many words in the title number ${i}. In Proceedings of the conference.`
    const refs = Array.from({ length: 10 }, (_, i) => entry(i)).join('\n')
    expect(sameRunShare(refs, refs)).toBeNull()
    const body = Array.from({ length: 12 }, (_, i) => (i % 3 ? `Large language models reason step by step when they are prompted with worked examples number ${i}.` : `Prior work on chain of thought prompting (Wei et al., 20${10 + i}) shows the same trend again number ${i}.`)).join('\n')
    expect(sameRunShare(body, body)).toBe(1)
  })
  it('阈值：实测翻好的页最高 0.22（BST-GATNet 第 6 页半页文献），没翻的 1.0，取中间 0.6', () => {
    expect(SAME_RUNS).toBeGreaterThan(0.22)
    expect(SAME_RUNS).toBeLessThan(0.9)
  })
})

describe('本机转发口记下失败', () => {
  const post = (url: string, token: string, body: unknown) =>
    fetch(`${url}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  it('上游回空译文：重试过还空就当失败回 502（不然 BabelDOC 把那段留原文、当成功），记进 failed', async () => {
    const fails: string[] = []
    const p = new TrProxy(async () => ({ text: '  ', prompt: 0, completion: 0 }), (m) => fails.push(m), { retry: { sleep: async () => {} } })
    const url = await p.start()
    const r = await post(url, p.token, { messages: [{ role: 'user', content: 'x' }] })
    expect(r.status).toBe(502)
    expect([p.calls, p.failed, p.lastError, p.lastKind, p.retries, fails]).toEqual([1, 1, 'empty translation', 'empty', 2, ['empty translation']])
    p.resetStats()
    expect([p.calls, p.failed, p.lastError, p.retries]).toEqual([0, 0, '', 0])
    p.stop()
  })
  it('Key 不对不重试，记下是哪一类（babeldoc.ts 据此整篇停下）', async () => {
    let n = 0
    const p = new TrProxy(async () => {
      n++
      throw Object.assign(new Error('AI 服务 401：Authentication Fails'), { status: 401 })
    })
    const url = await p.start()
    expect((await post(url, p.token, { messages: [{ role: 'user', content: 'x' }] })).status).toBe(502)
    expect([n, p.failed, p.lastKind]).toEqual([1, 1, 'auth'])
    p.stop()
  })
})
