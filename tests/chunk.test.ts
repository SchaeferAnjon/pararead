import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignPosition, chunkMarkdown, markdownForContext, sectionForText, sectionsOf, squash } from '../src/shared/chunk'
import { normalizeText, paraHash, translationKey } from '../src/shared/hash'

// MinerU 对一篇真论文的两种输出（tests/fixtures/simpler-*.md）。论文有版权，公开的仓库里不带这两个文件，用到它们的用例就跳过
const HAS_FX = existsSync(join(__dirname, 'fixtures', 'simpler-basic.md'))
const fx = (n: string): string => (HAS_FX ? readFileSync(join(__dirname, 'fixtures', n), 'utf8') : '')

describe('chunkMarkdown', () => {
  it('切出标题、段落、多行公式、表格、图片和 details', () => {
    const md = [
      '# Title',
      '',
      'First paragraph with $V _ { g }$ inline.',
      'Second line of same paragraph.',
      '',
      '$$',
      'a + b',
      '',
      '= c \\tag{1}',
      '$$',
      '',
      '![](data:image/jpeg;base64,AAAA)',
      '',
      '<details>',
      '<summary>image content</summary>',
      '',
      '(a)',
      '</details>',
      '',
      'Fig. 2. Serial execution of two gates.',
      '',
      '<table><tr><td>1</td></tr>',
      '',
      '<tr><td>2</td></tr></table>',
      '',
      '## II. METHOD',
      'Text right after heading.'
    ].join('\n')
    const b = chunkMarkdown(md)
    expect(b.map((x) => x.type)).toEqual(['heading', 'paragraph', 'equation', 'image', 'details', 'caption', 'table', 'heading', 'paragraph'])
    expect(b[0]).toMatchObject({ level: 1, md: 'Title', translatable: true })
    expect(b[1].md).toContain('Second line')
    expect(b[2].md).toContain('\\tag{1}')
    expect(b[2].translatable).toBe(false)
    expect(b[3].translatable).toBe(false)
    expect(b[6].md).toContain('<tr><td>2</td></tr></table>')
    expect(b[7]).toMatchObject({ level: 2, md: 'II. METHOD' })
  })

  it('同样内容的块 id 不重复，哈希相同', () => {
    const b = chunkMarkdown('Same text here again.\n\nSame text here again.\n')
    expect(b[0].hash).toBe(b[1].hash)
    expect(b[0].id).not.toBe(b[1].id)
  })

  it('单行 $$...$$ 公式', () => {
    const b = chunkMarkdown('Intro words here.\n$$x=1$$\nafter words here')
    expect(b.map((x) => x.type)).toEqual(['paragraph', 'equation', 'paragraph'])
  })

  it('纯公式或编号段不翻译', () => {
    const b = chunkMarkdown('(b)\n\n$x$ and $y$\n\nThis has real words.')
    expect(b.map((x) => x.translatable)).toEqual([false, false, true])
  })

  it.skipIf(!HAS_FX)('MinerU flash 实际输出：12 个章节标题，没有公式块', () => {
    const b = chunkMarkdown(fx('simpler-flash.md'))
    const heads = b.filter((x) => x.type === 'heading')
    expect(heads[0].md).toMatch(/^SIMPLER MAGIC/)
    expect(heads.some((h) => h.md === 'I. INTRODUCTION')).toBe(true)
    expect(b.filter((x) => x.type === 'equation')).toHaveLength(0)
    expect(b.filter((x) => x.type === 'image').length).toBeGreaterThan(20)
  })

  it.skipIf(!HAS_FX)('MinerU basic 实际输出：6 个独立公式块、5 个表格', () => {
    const b = chunkMarkdown(fx('simpler-basic.md'))
    expect(b.filter((x) => x.type === 'equation')).toHaveLength(6)
    expect(b.filter((x) => x.type === 'table')).toHaveLength(5)
    expect(b.every((x) => x.md.length > 0)).toBe(true)
  })

  it.skipIf(!HAS_FX)('flash 和 basic 之间大部分正文段落哈希一致，译文能复用', () => {
    const f = chunkMarkdown(fx('simpler-flash.md')).filter((x) => x.type === 'paragraph' && x.translatable)
    const bset = new Set(chunkMarkdown(fx('simpler-basic.md')).map((x) => x.hash))
    const shared = f.filter((x) => bset.has(x.hash)).length
    expect(shared / f.length).toBeGreaterThan(0.5)
  })
})

describe('hash', () => {
  it('空白差异不影响段落哈希', () => {
    expect(paraHash('a  b\n c ')).toBe(paraHash('a b c'))
    expect(normalizeText(' x \n y ')).toBe('x y')
  })
  it('译文键带目标语言', () => {
    expect(translationKey('abc', '简体中文')).not.toBe(translationKey('abc', 'English'))
  })
})

describe.skipIf(!HAS_FX)('alignPosition', () => {
  const flash = chunkMarkdown(fx('simpler-flash.md'))
  const basic = chunkMarkdown(fx('simpler-basic.md'))
  it('同哈希的段落直接对齐', () => {
    const target = flash.find((b) => b.md.startsWith('Numerous methods'))!
    const id = alignPosition(basic, { blockHash: target.hash })
    expect(basic.find((b) => b.id === id)!.md.startsWith('Numerous methods')).toBe(true)
  })
  it('哈希对不上时按文字前缀对齐（flash 用 <sub>，basic 用 $...$）', () => {
    const f = flash.find((b) => b.md.includes('The MAGIC NOR gate is performed'))!
    const id = alignPosition(basic, { blockHash: 'nope', textPrefix: f.md.slice(0, 80) })
    expect(id).not.toBeNull()
    expect(squash(basic.find((b) => b.id === id)!.md)).toContain('themagicnorgateisperformed')
  })
  it('都对不上就找同名标题', () => {
    const id = alignPosition(basic, { blockHash: 'x', textPrefix: 'zzzzzzzzzzzzzzzzzzzz', heading: 'I. INTRODUCTION' })
    expect(basic.find((b) => b.id === id)!.md).toBe('I. INTRODUCTION')
  })
})

describe('sectionForText', () => {
  it.skipIf(!HAS_FX)('原文模式的高亮按文字找到重排里的小节', () => {
    const b = chunkMarkdown(fx('simpler-basic.md'))
    expect(sectionForText(b, sectionsOf(b), 'This data transfer bottleneck is known as the memory wall')).toBe('I. INTRODUCTION')
    expect(sectionForText(b, sectionsOf(b), 'zzzz qqqq wwww')).toBeNull()
  })
})

describe('markdownForContext / sectionsOf', () => {
  it('去掉内嵌图片并截断', () => {
    const r = markdownForContext('a ![](data:image/png;base64,QUJD) b\n\n<details>x</details>' + 'z'.repeat(100), 50)
    expect(r.text).not.toContain('base64')
    expect(r.text).not.toContain('details')
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBe(50)
  })
  it.skipIf(!HAS_FX)('表格压成竖线分隔，basic 全文压缩后不超过 6 万字', () => {
    const r = markdownForContext('<table><tr><td rowspan=2>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(r.text).toBe('A | B\n1 | 2')
    const full = markdownForContext(fx('simpler-basic.md'))
    expect(full.text).not.toMatch(/<td/)
  })
  it('块的小节是上一个标题', () => {
    const b = chunkMarkdown('# T\n\nintro words here\n\n## A. Sec\n\nbody words here')
    const s = sectionsOf(b)
    expect(s.get(b[3].id)).toBe('A. Sec')
    expect(s.get(b[1].id)).toBe('T')
  })
})
