// AI 看得到公式（2026-11-24）：MinerU 快速解析把公式裁成图，以前给 AI 的全文里只剩「[图]」。
// 现在第一次问时把公式图交给看图模型转成 LaTeX、存一份；给 AI 的全文里公式就是 LaTeX；还没转（转失败、没配好）时图不丢，留着带给 AI。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { openDb, setReflow } from '../src/main/db'
import { Library } from '../src/main/library'
import { makeFormulas } from '../src/main/formulas'
import type { Ai } from '../src/main/ai'
import type { ChatMsg, ContentPart } from '../src/main/glm'

const dir = mkdtempSync(join(tmpdir(), 'pr-formulas-'))
const db = openDb(join(dir, 'library.sqlite'))
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** 一张假 PNG（只有文件头和 IHDR）的 base64 */
function png(w: number, h: number, salt: number): string {
  const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, w >> 8, w & 255, 0, 0, h >> 8, h & 255, 8, 2, 0, 0, 0, salt])
  return b.toString('base64')
}
const F1 = png(618, 34, 1)
const F2 = png(565, 102, 2)
const FIG = png(1428, 633, 3)
const MD = [
  'The GAT computes self-attention coefficients as shown in (1), which are used to update node features as shown in (2):',
  '',
  `![](data:image/png;base64,${F1})`,
  '',
  'where N (i) denotes the neighborhood of node i.',
  '',
  `![](data:image/png;base64,${F2})`,
  '',
  `![](data:image/png;base64,${FIG})`,
  '',
  'Fig. 2. Overview of the proposed network.'
].join('\n')
const TEX1 = '\\alpha_{ij} = \\exp\\left(\\mathrm{LeakyReLU}\\left(\\mathbf{a}^T\\left[\\mathbf{W}_i \\mathbf{h}_i \\parallel \\mathbf{W}_j \\mathbf{h}_j\\right]\\right)\\right) \\tag{1}'
const TEX2 = "\\mathbf{h}'_i = \\frac{1}{K}\\sum_{k=1}^{K}\\sigma\\left(\\sum_{j\\in\\mathcal{N}(i)}\\alpha_{ij}^{(k)}\\mathbf{W}^{(k)}\\mathbf{h}_j\\right) \\tag{2}"

function setup(id: string) {
  const library = new Library({ db, dataDir: dir, ai: {} as Ai, log: () => {} })
  mkdirSync(join(dir, 'reflow', id), { recursive: true })
  writeFileSync(library.reflowPath(id, 'flash'), MD)
  setReflow(db, id, 'flash', 'done')
  return library
}

/** 假的看图模型：记下收到的话，按收到几张图回 JSON */
function fakeAi(reply: (n: number) => string, ready = true) {
  const calls: { msgs: ChatMsg[]; kind?: string }[] = []
  const once = vi.fn(async (msgs: ChatMsg[], o: { kind?: string } = {}) => {
    calls.push({ msgs, kind: o.kind })
    const parts = msgs[0]!.content as ContentPart[]
    return reply(parts.filter((p) => p.type === 'image_url').length)
  })
  return { ai: { once, ready: () => ready } as unknown as Ai, calls, once }
}

describe('公式图转 LaTeX（formulas.ts、library.contextText）', () => {
  it('还没转：给 AI 的全文里公式图是「[公式图 Fn]」，两张都留着（不丢图）；图表照旧是「[图]」', () => {
    const library = setup('p0')
    const ctx = library.contextText('p0').text
    expect(ctx).toContain('[公式图 F1]')
    expect(ctx).toContain('[公式图 F2]')
    expect(ctx).toContain('[图]')
    expect(library.aiMarkdown('p0')!.pending.map((f) => f.data)).toEqual([F1, F2])
  })

  it('第一次问：两张公式图（不带图表）一次交给看图模型，转好存进 formulas.json，全文里公式换成 LaTeX；再问不再转', async () => {
    const library = setup('p1')
    const { ai, calls, once } = fakeAi(() => JSON.stringify([{ n: 1, latex: TEX1 }, { n: 2, latex: TEX2 }]))
    const f = makeFormulas({ library, ai, log: () => {} })
    expect(await f.ensure('p1')).toEqual([])
    expect(once).toHaveBeenCalledTimes(1)
    expect(calls[0]!.kind).toBe('vision')
    const parts = calls[0]!.msgs[0]!.content as ContentPart[]
    expect(parts.filter((p) => p.type === 'image_url').map((p) => (p as { image_url: { url: string } }).image_url.url)).toEqual([`data:image/png;base64,${F1}`, `data:image/png;base64,${F2}`])
    expect(existsSync(library.formulasPath('p1'))).toBe(true)
    const ctx = library.contextText('p1').text
    expect(ctx).toContain(`$$\n${TEX1}\n$$\n（转写自原文的公式图 F1）`)
    expect(ctx).toContain('LeakyReLU')
    expect(ctx).toContain('\\parallel')
    expect(ctx).not.toContain('[公式图')
    // 重排的原文没动（重排看法照旧显示原图）
    expect(readFileSync(library.reflowPath('p1', 'flash'), 'utf8')).toBe(MD)
    await f.ensure('p1')
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('同一篇同时问两次只转一次', async () => {
    const library = setup('p2')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const once = vi.fn(async () => {
      await gate
      return JSON.stringify([{ n: 1, latex: TEX1 }, { n: 2, latex: TEX2 }])
    })
    const f = makeFormulas({ library, ai: { once, ready: () => true } as unknown as Ai, log: () => {} })
    const a = f.ensure('p2')
    const b = f.ensure('p2')
    release()
    expect(await Promise.all([a, b])).toEqual([[], []])
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('看图模型出错、没配好：图原样返回（问的时候带给 AI），不写缓存', async () => {
    const library = setup('p3')
    const bad = makeFormulas({ library, ai: { once: async () => Promise.reject(new Error('402 余额不足')), ready: () => true } as unknown as Ai, log: () => {} })
    expect((await bad.ensure('p3')).map((x) => x.n)).toEqual([1, 2])
    expect(existsSync(library.formulasPath('p3'))).toBe(false)
    const { ai, once } = fakeAi(() => '[]', false)
    expect((await makeFormulas({ library, ai, log: () => {} }).ensure('p3')).map((x) => x.n)).toEqual([1, 2])
    expect(once).not.toHaveBeenCalled()
  })

  it('一张转好、一张说不是公式：说不是的照旧当图，转好的换成 LaTeX', async () => {
    const library = setup('p4')
    const { ai } = fakeAi(() => JSON.stringify([{ n: 1, latex: TEX1 }, { n: 2, latex: null }]))
    expect(await makeFormulas({ library, ai, log: () => {} }).ensure('p4')).toEqual([])
    const ctx = library.contextText('p4').text
    expect(ctx).toContain(TEX1)
    expect(ctx.match(/\[图\]/g)).toHaveLength(2)
  })
})
