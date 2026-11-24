import { describe, expect, it } from 'vitest'
import { canvasNotesOpenUrl, mergeReadAt, mergeReadAtMaps, parareadOpenUrl, parseParaReadOpen, parseReadAt, placeNames, putReadAt, readAtJson, readAtLabel, readMinutes, withReadAtProps } from '../src'

describe('读到哪两边合一（ParaRead 联动）', () => {
  const pr = { page: 3, pages: 43, pct: 7, section: 'B. Architecture', at: 2000, by: 'pararead', ms: { pararead: 120_000 } }
  const cn = { page: 28, pages: 43, at: 1000, by: 'canvas-notes', ms: { 'canvas-notes': 600_000 } }

  it('位置取晚的那份，读了多久两边加起来', () => {
    const m = mergeReadAt(cn, pr)!
    expect(m).toMatchObject({ page: 3, by: 'pararead', section: 'B. Architecture' })
    expect(m.ms).toEqual({ 'canvas-notes': 600_000, pararead: 120_000 })
    expect(readMinutes(m)).toBe(12)
    // 反过来合一样（谁晚谁为准，和先后无关）
    expect(mergeReadAt(pr, cn)).toEqual(m)
    expect(readAtLabel(m)).toBe('7% · B. Architecture')
  })

  it('读了多久每个软件只往上加，合两遍不会算两遍', () => {
    const a = { 'x.pdf': cn }
    const b = { 'x.pdf': { ...cn, ms: { 'canvas-notes': 300_000, pararead: 60_000 } } }
    expect(mergeReadAtMaps(mergeReadAtMaps(a, b), b)['x.pdf']!.ms).toEqual({ 'canvas-notes': 600_000, pararead: 60_000 })
  })

  it('这边翻页：位置换成这次的；只加时间时不把另一边更晚的位置盖掉', () => {
    let m = putReadAt({}, 'x.pdf', 'canvas-notes', { page: 5, pages: 43, now: 10 })
    expect(m['x.pdf']).toEqual({ page: 5, pages: 43, at: 10, by: 'canvas-notes' })
    m = { 'x.pdf': mergeReadAt(m['x.pdf'], pr)! }
    m = putReadAt(m, 'x.pdf', 'canvas-notes', { addMs: 30_000, now: 3000 })
    expect(m['x.pdf']).toMatchObject({ page: 3, by: 'pararead', at: 2000 })
    expect(m['x.pdf']!.ms).toEqual({ pararead: 120_000, 'canvas-notes': 30_000 })
    expect(readAtLabel({ page: 5, at: 1, by: 'canvas-notes' })).toBe('第 5 页')
  })

  it('文件往返一个字不差；坏了的条目跳过', () => {
    const text = readAtJson({ 'b.pdf': cn, 'a.pdf': pr })
    expect(readAtJson(parseReadAt(text))).toBe(text)
    expect(Object.keys(JSON.parse(text).files)).toEqual(['a.pdf', 'b.pdf'])
    expect(parseReadAt('{"files":{"a.pdf":{"page":0,"at":1,"by":"x"},"b.pdf":{"page":2,"at":1,"by":"x"}}}')).toEqual({ 'b.pdf': { page: 2, at: 1, by: 'x' } })
    expect(parseReadAt('not json')).toEqual({})
  })

  it('配对笔记的属性「读到」「读了」', () => {
    const md = withReadAtProps('---\n类型: 笔记\n---\n# x\n', mergeReadAt(cn, pr)!)
    expect(md).toBe('---\n类型: 笔记\n读到: 7% · B. Architecture\n读了: 12 分钟\n---\n# x\n')
    // 值没变时一个字节不动
    expect(withReadAtProps(md, mergeReadAt(cn, pr)!)).toBe(md)
  })
})

describe('ParaRead 深链和放进库', () => {
  it('pararead://open 往返', () => {
    const url = parareadOpenUrl({ file: '/库/课程/ecp/Lecture 05.pdf', page: 3, vault: '/库', back: '课程/ecp', view: 'original' })
    expect(url.startsWith('pararead://open?file=')).toBe(true)
    expect(parseParaReadOpen(url)).toEqual({ file: '/库/课程/ecp/Lecture 05.pdf', page: 3, vault: '/库', back: '课程/ecp', view: 'original' })
    expect(parseParaReadOpen('pararead://open')).toBeNull()
    expect(parseParaReadOpen('canvas-notes://open?file=a.pdf')).toBeNull()
    expect(canvasNotesOpenUrl('课程/ecp', 0)).toBe('canvas-notes://open?file=%E8%AF%BE%E7%A8%8B%2Fecp')
  })

  it('同名的 PDF：内容一样用那份，不一样往后数', () => {
    const have = new Set(['课程/ecp/L5.pdf', '课程/ecp/L5 (2) 笔记.md'])
    expect(placeNames('课程/ecp', 'L4.pdf', (p) => have.has(p))).toEqual({ pdf: '课程/ecp/L4.pdf', note: '课程/ecp/L4 笔记.md', renamed: false, reuse: false })
    expect(placeNames('课程/ecp/', 'L5.pdf', (p) => have.has(p), () => true)).toMatchObject({ pdf: '课程/ecp/L5.pdf', reuse: true })
    expect(placeNames('课程/ecp', 'L5.pdf', (p) => have.has(p), () => false)).toEqual({ pdf: '课程/ecp/L5 (3).pdf', note: '课程/ecp/L5 (3) 笔记.md', renamed: true, reuse: false })
    expect(placeNames('', 'x.PDF', () => false).pdf).toBe('x.PDF')
  })
})
