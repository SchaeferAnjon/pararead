import { describe, expect, it } from 'vitest'
import { bibEntries, bibHtml, check, citeTag, fitsTag, idsOfTag, inText, numbering, ranges, type Items } from '../src/shared/wordCite'

const item = (id: string, authors: string[], year: number | null, title: string, venue: string | null = 'Nature', extra = {}): Items[string] => ({
  id, title, authors, year, venue, volume: '1', issue: null, pages: '1-9', doi: null, url: null, publisher: null, arxiv: null, ...extra
})
const items: Items = {
  a: item('a', ['Rotem Ben-Hur', 'Ronny Ronen', 'Ameer Haj-Ali'], 2020, 'SIMPLER MAGIC'),
  b: item('b', ['Ada Lovelace'], 1843, 'Notes on the Analytical Engine'),
  c: item('c', ['Alan Turing', 'Alonzo Church'], 1936, 'On Computable Numbers'),
  d: item('d', ['张三', '李四', '王五'], 2021, '忆阻器逻辑综述', '计算机学报')
}

describe('Word 引用', () => {
  it('tag 来回转，超过 64 个字符的放不下', () => {
    expect(idsOfTag(citeTag(['a', 'b']))).toEqual(['a', 'b'])
    expect(idsOfTag('别的控件')).toBeNull()
    expect(fitsTag(['0XKDlhHO', 'abcdefgh', 'ijklmnop'])).toBe(true)
    expect(fitsTag(Array(8).fill('0XKDlhHO'))).toBe(false)
  })

  it('按第一次出现编号，连着三个以上并成一段', () => {
    const num = numbering([['b'], ['a', 'b'], ['c']])
    expect([...num]).toEqual([['b', 1], ['a', 2], ['c', 3]])
    expect(ranges([1, 2, 3, 5])).toBe('1-3,5')
    expect(ranges([2, 1])).toBe('1,2')
    expect(ranges([4, 1, 2, 3, 7, 8])).toBe('1-4,7,8')
  })

  it('四种格式的文中引用', () => {
    const cites = [['a'], ['b', 'c', 'a'], ['d']]
    const num = numbering(cites)
    expect(inText(['b', 'c', 'a'], 'gbt', num, items)).toBe('[1-3]')
    expect(inText(['a', 'c'], 'gbt', num, items)).toBe('[1,3]')
    expect(inText(['b', 'c', 'a'], 'ieee', num, items)).toBe('[1]–[3]')
    expect(inText(['a', 'd'], 'ieee', num, items)).toBe('[1], [4]')
    expect(inText(['a'], 'apa', num, items)).toBe('(Ben-Hur et al., 2020)')
    expect(inText(['c', 'b'], 'apa', num, items)).toBe('(Lovelace, 1843; Turing & Church, 1936)')
    expect(inText(['c'], 'mla', num, items)).toBe('(Turing and Church)')
    expect(inText(['d'], 'apa', num, items)).toBe('(张三 等, 2021)')
    expect(inText(['x'], 'gbt', num, items)).toBe('[?]')
  })

  it('参考文献表：编号制按编号，著者年份制按姓排，期刊名斜体', () => {
    const cites = [['c'], ['a', 'b']]
    expect(bibEntries(cites, 'gbt', items).map((e) => `${e.label}${e.id}`)).toEqual(['[1]c', '[2]a', '[3]b'])
    expect(bibEntries(cites, 'apa', items).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    const html = bibHtml(bibEntries([['b']], 'apa', items))
    expect(html).toContain('<i>Nature</i>')
    expect(html.startsWith('<p>Lovelace, A. (1843).')).toBe(true)
    expect(bibHtml(bibEntries([['b']], 'gbt', { b: { ...items.b, title: 'A < B & C' } }))).toContain('A &lt; B &amp; C')
  })

  it('格式检查', () => {
    const cites = [['a'], ['b']]
    const base = { cites, texts: ['[1]', '[2]'], items, style: 'gbt' as const, hasBib: true, bibIds: ['a', 'b'], bodyText: '见 [1] 和 [2]。\n[1] …\n[2] …' }
    expect(check(base)).toEqual([])
    // 没有参考文献表
    expect(check({ ...base, hasBib: false, bodyText: '见 [1] 和 [2]。' }).map((i) => i.level)).toEqual(['error'])
    // 引用增删过，表没更新
    expect(check({ ...base, bibIds: ['a'] })[0].text).toContain('对不上')
    // 编号被手改
    const edited = check({ ...base, texts: ['[1]', '[5]'], bodyText: '见 [1] 和 [5]。\n[1] …\n[2] …' })
    expect(edited[0]).toMatchObject({ level: 'error', cite: 1 })
    // 手打的编号
    const manual = check({ ...base, bodyText: base.bodyText + ' 另见 [7] 和 [1，3]' })
    expect(manual).toHaveLength(1)
    expect(manual[0].text).toContain('[7]')
    // 缺项
    const miss = check({ ...base, items: { ...items, b: { ...items.b, year: null, pages: null } } })
    expect(miss).toHaveLength(1)
    expect(miss[0]).toMatchObject({ level: 'warn', cite: 1 })
    // 文献信息丢了
    expect(check({ ...base, items: { a: items.a }, bibIds: ['a'] })[0]).toMatchObject({ level: 'error', cite: 1 })
  })
})
