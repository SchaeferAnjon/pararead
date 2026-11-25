import { describe, expect, it } from 'vitest'
import { pageLinkOf, parsePdfAnchor, formatPdfAnchor, type PdfPageText, type PdfTextItem, quoteRect, quoteBlock, pageBlocks, citeOf } from '../src'

/** 一页：左栏两段，右栏一个小标题和一段（字号 10，行距 12，段间空一行） */
function page(): PdfPageText {
  const items: PdfTextItem[] = []
  const col = (x: number, y0: number, lines: (string | null)[]) => {
    let y = y0
    for (const l of lines) {
      if (l) items.push({ str: l, x, y, w: l.length * 4.2, h: 10 })
      y += l === null ? 24 : 12
    }
  }
  col(40, 100, [
    'personalized stress detection. To address this limitation,',
    'we propose a solution for driver stress detection that captures',
    'complex spatio-temporal dependencies among signals.',
    null,
    'In this study, we selected the AffectiveROAD dataset, which',
    'was collected during a real-world driving protocol.',
  ])
  col(320, 100, ['B. Static Feature Stream'])
  col(320, 124, [
    'We additionally extract a static feature stream composed of',
    'low-frequency statistical descriptors computed over each',
    'window, which complements the dynamic stream.',
  ])
  return { width: 600, height: 800, items }
}

describe('页码链接跳到段：引的那句找是哪一段', () => {
  it('整句、改了大小写和断行连字符都认得；返回那一段的框（页上的比例）', () => {
    const r = quoteRect(page(), 'We additionally extract a static feature stream', 2)!
    expect(r).not.toBeNull()
    // 右栏那一段：左边在页宽一半右边，上沿在 124 往上一个字高附近
    expect(r[0]).toBeGreaterThan(0.5)
    expect(r[1] * 800).toBeGreaterThan(100)
    expect(r[1] * 800).toBeLessThan(124)
    expect(quoteRect(page(), 'complex SPATIOTEMPORAL dependencies', 2)![0]).toBeLessThan(0.2)
  })

  it('引到小标题：连着下面那一段一起框', () => {
    const r = quoteRect(page(), 'B. Static Feature Stream', 2)!
    const body = quoteRect(page(), 'We additionally extract a static', 2)!
    expect(r[1]).toBeLessThan(body[1])
    expect(r[1] + r[3]).toBeCloseTo(body[1] + body[3], 2)
  })

  it('AI 改了后半句：开头一截对得上也认；结尾一截对得上也认', () => {
    const blocks = pageBlocks(page(), 2)
    expect(quoteBlock(blocks, 'In this study, we selected the AffectiveROAD dataset for everything')?.text).toContain('AffectiveROAD')
    expect(quoteBlock(blocks, 'Something else entirely, low-frequency statistical descriptors computed over each window')?.text).toContain('low-frequency')
  })

  it('找不到、太短、是译文时返回 null；给了译文按译文认', () => {
    expect(quoteRect(page(), '再结合一个由低频统计描述量构成的静态特征流', 2)).toBeNull()
    expect(quoteRect(page(), 'the', 2)).toBeNull()
    expect(quoteRect(page(), 'This sentence is nowhere on the page at all', 2)).toBeNull()
    const tr = (b: { text: string }) => (b.text.startsWith('We additionally') ? '我们另外提取一个由低频统计描述量构成的静态特征流' : undefined)
    expect(quoteRect(page(), '由低频统计描述量构成的静态特征流', 2, tr)![0]).toBeGreaterThan(0.5)
  })

  it('链接里的 text= 读得出来、写得回去；笔记里光写 #page=N&text= 的也认', () => {
    expect(parsePdfAnchor('x.pdf#page=2&text=We%20additionally%20extract')).toEqual({ file: 'x.pdf', page: 2, text: 'We additionally extract' })
    expect(formatPdfAnchor({ file: 'a b.pdf', page: 2, text: 'We (also) extract' })).toBe('a%20b.pdf#page=2&text=We%20(also)%20extract')
    expect(pageLinkOf('课程/x 笔记.md', '#page=2&text=We%20additionally')).toEqual({ file: null, page: 2, text: 'We additionally' })
    const c = citeOf('课程/x.pdf#page=2&text=We%20additionally', { base: '', root: '/v', files: ['课程/x.pdf'] })
    expect(c).toMatchObject({ kind: 'pdf', path: '课程/x.pdf', page: 2, text: 'We additionally' })
  })
})
