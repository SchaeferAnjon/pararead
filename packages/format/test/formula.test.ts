// AI 看得到公式（2026-11-24）：文字层里认公式那几块、问的话里认公式编号、解析结果里认公式图并换成 LaTeX
import { describe, expect, it } from 'vitest'
import {
  askedEquations,
  asksFormula,
  formulaImages,
  formulaImagesNote,
  formulaLatexAsk,
  formulaList,
  formulaRegions,
  imageSize,
  latexTag,
  parseLatexReply,
  pickFormulaImages,
  withFormulas,
  type PdfPageText,
  type PdfTextItem,
} from '../src'
import { page, prose } from './formula-pages'

describe('文字层里公式那几块（formulaRegions）', () => {
  it('双栏论文第 3 页：认出公式 (1)(2) 两块，编号对，框在左栏、把上下标和求和上下限都框进去', () => {
    const r = formulaRegions(page())
    expect(r.map((x) => x.tags)).toEqual([[1], [2]])
    const [one, two] = r
    // (1)：LeakyReLU、拼接号、上标 T、下标 ij 都在这一块
    expect(one!.lines.join(' ')).toContain('LeakyReLU')
    expect(one!.lines.join(' ')).toContain('∥')
    expect(one!.lines).toContain('T')
    expect(one!.lines).toContain('αij')
    // (2)：求和上下限 k=1、j∈N(i) 和分母 K 并进来了
    expect(two!.lines.some((l) => l.includes('=1'))).toBe(true)
    expect(two!.lines.some((l) => l.includes('∈N'))).toBe(true)
    for (const x of r) {
      const [l, t, w, h] = x.rect
      // 左栏：从左栏正文的左边到它的右边（不越过中线太多）
      expect(l).toBeLessThan(49 / 612)
      expect(l + w).toBeLessThan(0.52)
      expect(l + w).toBeGreaterThan(300 / 612)
      expect(h).toBeLessThan(0.1)
      expect(t).toBeGreaterThan(0.4)
    }
    // 上下各留一截：(1) 的上标 T（402.8 的基线）和 (2) 最下面的 j∈N(i)（532）都在框里
    expect(one!.rect[1] * 792).toBeLessThan(402.8 - 7)
    expect((two!.rect[1] + two!.rect[3]) * 792).toBeGreaterThan(532)
  })

  it('带一个希腊字母的正文、只有正文的页：不算公式', () => {
    const p: PdfPageText = { width: 612, height: 792, items: [prose(100, 49), { str: 'where σ(·) is the activation function and K is the number of heads', x: 49, y: 112, w: 251, h: 10 }, prose(124, 49)] }
    expect(formulaRegions(p)).toEqual([])
    expect(formulaRegions({ width: 612, height: 792, items: [] })).toEqual([])
  })

  it('单栏的页：公式居中、编号靠右离得远，照样连成一块；正文里单列的「(1)」不算', () => {
    const it2 = (str: string, x: number, y: number, w: number, h = 12): PdfTextItem => ({ str, x, y, w, h })
    const p: PdfPageText = {
      width: 612,
      height: 792,
      items: [
        it2('the coefficients are computed for every pair of nodes as follows', 72, 300, 468),
        it2('α', 200, 330, 7),
        it2('ij', 207, 333, 7, 8),
        it2('= exp(LeakyReLU(a', 216, 330, 110),
        it2('(1)', 520, 330, 16),
        it2('where the weights are shared across all heads of the layer', 72, 360, 468),
        it2('(2)', 72, 400, 16),
        it2('lists the second option and continues the paragraph here', 92, 400, 448),
      ],
    }
    const r = formulaRegions(p)
    expect(r).toHaveLength(1)
    expect(r[0]!.tags).toEqual([1])
    expect(r[0]!.lines.join(' ')).toContain('LeakyReLU')
  })

  it('零散一个 α（没有编号、符号不到 3 个）不算', () => {
    const p: PdfPageText = { width: 612, height: 792, items: [prose(100, 49), { str: 'α', x: 150, y: 130, w: 6, h: 10 }, prose(160, 49)] }
    expect(formulaRegions(p)).toEqual([])
  })
})

describe('问的话里的公式编号', () => {
  it.each([
    ['公式 (1) 是什么', [1]],
    ['公式（2）怎么来的', [2]],
    ['式(3)和式(4)', [3, 4]],
    ['公式1和2', [1, 2]],
    ['(5) 式里的 K 是什么', [5]],
    ['Explain Eq. 3 and equation (4)', [3, 4]],
    ['图 1 讲的是什么', []],
    ['表 2 的第 3 行', []],
  ])('%s', (q, want) => {
    expect(askedEquations(q).sort()).toEqual(want)
  })

  it('问的是公式（要附公式那几块看）', () => {
    expect(asksFormula('公式 (1) 是什么')).toBe(true)
    expect(asksFormula('这个推导没看懂')).toBe(true)
    expect(asksFormula('这一段在说什么')).toBe(false)
  })
})

/** 一张假 PNG 的 data URL（只有文件头和 IHDR，宽高随意） */
function png(w: number, h: number, salt = 0): string {
  const b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 2, 0, 0, 0, salt]
  return btoa(String.fromCharCode(...b))
}
const img = (w: number, h: number, salt = 0) => `![](data:image/png;base64,${png(w, h, salt)})`

/** MinerU 快速解析写出的样子：公式裁成扁图单独成段，图表下面跟着图注 */
const FLASH_MD = [
  '## B. Architecture',
  '',
  'The GAT computes self-attention coefficients as shown in (1), which are used to update node features as shown in (2):',
  '',
  img(618, 34, 1),
  '',
  'where N (i) denotes the neighborhood of node i.',
  '',
  img(565, 102, 2),
  '',
  img(1428, 633, 3),
  '',
  'Fig. 2. Overview of the proposed network.',
  '',
  img(1428, 120, 4),
  '',
  'Table 1. Results.',
  '',
  'Inline ' + img(300, 30, 5) + ' is not a display formula.',
].join('\n')

describe('解析结果里的公式图（formulaImages、withFormulas）', () => {
  it('读出 PNG、JPEG 的宽高', () => {
    expect(imageSize(png(618, 34))).toEqual({ w: 618, h: 34 })
    // JPEG：SOI + APP0 + SOF0（高 34、宽 618）
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 34, 0x02, 0x6a, 3, 0, 0, 0))
    expect(imageSize(jpeg)).toEqual({ w: 618, h: 34 })
    expect(imageSize('not base64!')).toBeNull()
  })

  it('单独成段的扁图算公式；后面跟着图注的、大图、行内的图不算', () => {
    const f = formulaImages(FLASH_MD)
    expect(f.map((x) => [x.n, x.w, x.h])).toEqual([
      [1, 618, 34],
      [2, 565, 102],
    ])
    expect(f[0]!.before).toMatch(/as shown in \(2\):$/)
    // 指纹按图的内容：同一张图换个位置还是同一个键
    expect(formulaImages(`x\n\n${img(618, 34, 1)}\n`)[0]!.key).toBe(f[0]!.key)
    expect(f[0]!.key).not.toBe(f[1]!.key)
  })

  it('没转过：公式图换成「[公式图 Fn]」占位、两张都在 pending 里（不丢图）', () => {
    const r = withFormulas(FLASH_MD, {})
    expect(r.md).toContain('[公式图 F1]')
    expect(r.md).toContain('[公式图 F2]')
    expect(r.pending.map((x) => x.n)).toEqual([1, 2])
    expect(r.pending[0]!.data).toBe(png(618, 34, 1))
    expect(r.done).toBe(0)
    // 图表照旧是图（交给后面的「[图]」）
    expect(r.md).toContain(img(1428, 633, 3))
  })

  it('转好了：换成 LaTeX，注明转写自哪张；看图模型说不是公式的照旧当图', () => {
    const [f1, f2] = formulaImages(FLASH_MD)
    const tex = '\\alpha_{ij} = \\exp\\left(\\mathrm{LeakyReLU}\\left(\\mathbf{a}^T[\\mathbf{W}_i\\mathbf{h}_i \\parallel \\mathbf{W}_j\\mathbf{h}_j]\\right)\\right) \\tag{1}'
    const r = withFormulas(FLASH_MD, { [f1!.key]: tex, [f2!.key]: null })
    expect(r.md).toContain(`$$\n${tex}\n$$\n（转写自原文的公式图 F1）`)
    expect(r.md).not.toContain('[公式图 F1]')
    expect(r.md).toContain(img(565, 102, 2))
    expect(r.pending).toEqual([])
    expect(r.done).toBe(1)
  })

  it('转 LaTeX：问法要求照原样和 \\tag，读回答（JSON 前后有字、n 对不上、读不出的留着下次）', () => {
    expect(formulaLatexAsk(2)).toMatch(/这 2 张图/)
    expect(formulaLatexAsk(2)).toMatch(/\\tag\{n\}/)
    expect(parseLatexReply('好的：\n```json\n[{"n":2,"latex":"b"},{"n":1,"latex":"$$a \\\\tag{1}$$"}]\n```', 3)).toEqual(['a \\tag{1}', 'b', undefined])
    expect(parseLatexReply('[{"n":1,"latex":null}]', 1)).toEqual([null])
    expect(parseLatexReply('读不出来', 2)).toEqual([undefined, undefined])
    expect(latexTag('x = 1 \\tag{12}')).toBe(12)
    expect(latexTag('x = 1')).toBeNull()
  })

  it('转不成时挑几张带给 AI：多了先挑问到的编号紧跟着的那张', () => {
    const many = Array.from({ length: 12 }, (_x, i) => `Then as shown in (${i + 1}):\n\n${img(500, 40, i)}\n`).join('\n')
    const pending = withFormulas(many, {}).pending
    expect(pickFormulaImages(pending, '这一段', 8).map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(pickFormulaImages(pending, '公式 (11) 是什么', 8).map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 11])
    expect(pickFormulaImages(pending.slice(0, 3), '公式 (11)', 8)).toHaveLength(3)
  })

  it('会话接着问时补上转好的公式：点了编号只列那个', () => {
    const [f1, f2] = formulaImages(FLASH_MD)
    const latex = { [f1!.key]: 'a \\tag{1}', [f2!.key]: 'b \\tag{2}' }
    expect(formulaList(FLASH_MD, latex, '公式 (2) 是什么')).toBe('论文里的公式（从原文公式图转写的 LaTeX）：\n公式图 F2：$$b \\tag{2}$$')
    expect(formulaList(FLASH_MD, latex, '讲讲这些公式')).toContain('公式图 F1：$$a \\tag{1}$$')
    expect(formulaList(FLASH_MD, {}, '公式 (2)')).toBe('')
  })

  it('附图说明：从第几张起、每张是什么', () => {
    expect(formulaImagesNote(2, ['第 3 页公式 (1)', '第 3 页公式 (2)'])).toMatch(/^附图第 2–3 张依次是原文公式的截图：第 3 页公式 \(1\)；第 3 页公式 \(2\)。/)
    expect(formulaImagesNote(1, ['公式图 F1'])).toMatch(/^附图第 1 张/)
    expect(formulaImagesNote(1, [])).toBe('')
  })
})
