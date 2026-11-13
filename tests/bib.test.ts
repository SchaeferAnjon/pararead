import { describe, expect, it } from 'vitest'
import { bibEntry, bibFile, bibKeys } from '../src/shared/bib'

const paper = (id: string, createdAt: number, title: string, authors = ['Rotem Ben-Hur'], year: number | null = 2020) => ({
  id, createdAt, title, authors, year, venue: 'IEEE TCAD', volume: '39', issue: '10', pages: '2434-2447', doi: null, url: null, publisher: null, arxiv: null
})

describe('BibTeX key', () => {
  it('没撞车就是第一作者姓、年份、题目第一个长词', () => {
    const keys = bibKeys([paper('a', 1, 'SIMPLER MAGIC: Synthesis and Mapping'), paper('b', 2, 'MAGIC—Memristor-Aided Logic', ['Shahar Kvatinsky'], 2014)])
    expect(keys.get('a')).toBe('benhur2020simpler')
    expect(keys.get('b')).toBe('kvatinsky2014magic')
  })

  it('撞车时先进库的不变，后面的按进库先后加 a、b', () => {
    const ps = [paper('late', 30, 'Simpler designs'), paper('first', 10, 'SIMPLER MAGIC'), paper('mid', 20, 'Simpler again')]
    const keys = bibKeys(ps)
    expect(keys.get('first')).toBe('benhur2020simpler')
    expect(keys.get('mid')).toBe('benhur2020simplera')
    expect(keys.get('late')).toBe('benhur2020simplerb')
    // 再加一篇不会改已有的 key
    const more = bibKeys([...ps, paper('new', 40, 'Simpler at last')])
    expect(more.get('mid')).toBe('benhur2020simplera')
    expect(more.get('new')).toBe('benhur2020simplerc')
  })

  it('碰上本身就以 a 结尾的 key 也不重复', () => {
    // 第二篇的基础 key 正好等于第一篇撞车后的 key
    const keys = bibKeys([paper('x', 1, 'Simpler'), paper('y', 2, 'Simpler'), paper('z', 3, 'Simplera')])
    expect(new Set(keys.values()).size).toBe(3)
  })

  it('条目里换成去重后的 key，特殊字符转义', () => {
    const e = bibEntry(paper('a', 1, 'Fast 100% & cheap'), 'benhur2020fasta')
    expect(e.startsWith('@article{benhur2020fasta,\n')).toBe(true)
    expect(e).toContain('title = {{Fast 100\\% \\& cheap}}')
    expect(e).toContain('pages = {2434--2447}')
  })

  it('整个文件按 key 排，每条都在', () => {
    const f = bibFile([paper('b', 2, 'Zeta'), paper('a', 1, 'Alpha study')])
    expect(f.startsWith('% Exported by ParaRead: 2 entries')).toBe(true)
    expect(f.indexOf('benhur2020alpha')).toBeLessThan(f.indexOf('benhur2020zeta'))
  })
})
