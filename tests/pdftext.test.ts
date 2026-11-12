import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from '../src/shared/chunk'
import { extractPdf, guessMetadata, itemsToLines, orderedLines, simpleReflow, type PageText } from '../src/main/pdftext'

// 用一篇真的双栏论文测抽文字：TEST_PAPER=<PDF 路径> npm test；没给就跳过
const PAPER = process.env.TEST_PAPER ?? ''

describe('行拼接和栏位', () => {
  const page: PageText = {
    width: 600,
    height: 800,
    items: [
      { str: 'A Wide Title Line', x: 100, y: 50, w: 400, h: 20 },
      { str: 'left one', x: 40, y: 120, w: 200, h: 10 },
      { str: 'right one', x: 320, y: 120, w: 200, h: 10 },
      { str: 'left', x: 40, y: 132, w: 30, h: 10 },
      { str: 'two', x: 72, y: 132, w: 30, h: 10 },
      { str: 'right two', x: 320, y: 132, w: 200, h: 10 }
    ]
  }
  it('同一基线的项拼成一行，补空格', () => {
    const lines = itemsToLines(page.items)
    expect(lines.find((l) => l.y === 132 && l.x === 40)!.text).toBe('left two')
  })
  it('双栏：通栏标题在前，先左栏后右栏', () => {
    expect(orderedLines(page).map((l) => l.text)).toEqual(['A Wide Title Line', 'left one', 'left two', 'right one', 'right two'])
  })
  it('元数据没有标题时取第一页最大字号的行', () => {
    const g = guessMetadata({ Title: 'untitled.pdf', CreationDate: 'D:20190730' }, page)
    expect(g.title).toBe('A Wide Title Line')
    expect(g.year).toBe(2019)
  })
})

describe.skipIf(!existsSync(PAPER))('测试论文', () => {
  it('抽出 14 页文字，标题正确，简单重排出段落和标题', async () => {
    const ext = await extractPdf(new Uint8Array(readFileSync(PAPER)))
    expect(ext.pageCount).toBe(14)
    const g = guessMetadata(ext.info, ext.pages[0])
    expect(g.title ?? '').toMatch(/SIMPLER MAGIC/i)
    const md = simpleReflow(ext.pages, g.title ?? 'x')
    const blocks = chunkMarkdown(md)
    const heads = blocks.filter((b) => b.type === 'heading')
    expect(heads.length).toBeGreaterThan(5)
    expect(heads.every((h) => /^[A-Z0-9]/.test(h.md))).toBe(true)
    expect(heads.some((h) => /^SIMPLER MAGIC: Synthesis and In-Memory Logic/.test(h.md) || /^SIMPLER MAGIC: Synthesis and Mapping/.test(h.md))).toBe(true)
    expect(blocks.some((b) => b.type === 'paragraph' && /memory wall/i.test(b.md))).toBe(true)
  }, 30_000)
})
