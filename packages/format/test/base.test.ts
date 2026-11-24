import { describe, expect, it } from 'vitest'
import { type BaseCond, baseRows, baseYaml, colType, condExpr, condHolds, condLabel, parseBase, parseCond, parseYamlLite, setBaseFilters, setBaseOrder, setBaseSort } from '../src/base'

const SRC = `filters:
  and:
    - file.inFolder("读书/书单")
    - 状态 != "放弃"
views:
  - type: table
    name: 在读的书
    order:
      - file.name
      - 作者
      - 评分
    sort:
      - property: 评分
        direction: DESC`

describe('数据库代码块（CN-19 A，写法同 Obsidian Bases）', () => {
  it('读出数据源文件夹、筛选、列、排序', () => {
    expect(parseBase(SRC)).toEqual({
      folder: '读书/书单',
      match: 'and',
      conds: [{ prop: '状态', op: '!=', value: '放弃' }],
      extra: [],
      filtersLocked: false,
      view: '在读的书',
      columns: ['file.name', '作者', '评分'],
      sort: [{ prop: '评分', desc: true }],
      types: {},
      sizes: {},
      summaries: {},
    })
  })

  it('新建的块能原样读回来', () => {
    expect(parseBase(baseYaml('书单', ['file.name', '状态', '日期']))).toMatchObject({ folder: '书单', columns: ['file.name', '状态', '日期'], sort: [] })
  })

  it('YAML：列表里的映射', () => {
    expect(parseYamlLite('a:\n  - x: 1\n    y: "2"\n  - 3\n')).toEqual({ a: [{ x: '1', y: '2' }, '3'] })
  })

  it('行：只要文件夹里的、按筛选留下、按排序排', () => {
    const notes = [
      { path: '读书/书单/明朝那些事儿.md', text: '---\n作者: 当年明月\n评分: 9\n状态: 在读\n---\n' },
      { path: '读书/书单/三体.md', text: '---\n作者: 刘慈欣\n评分: 10\n---\n' },
      { path: '读书/书单/某书.md', text: '---\n状态: 放弃\n评分: 3\n---\n' },
      { path: '读书/别的.md', text: '---\n评分: 100\n---\n' },
    ]
    expect(baseRows(parseBase(SRC), notes).map((r) => [r.name, r.props['评分']])).toEqual([
      ['三体', '10'],
      ['明朝那些事儿', '9'],
    ])
  })

  it('点列头换排序：第一次升序，再点倒过来；只动 sort 那几行', () => {
    const one = setBaseSort(SRC, '作者', false)
    expect(parseBase(one).sort).toEqual([{ prop: '作者', desc: false }])
    expect(parseBase(setBaseSort(one, '作者', true)).sort).toEqual([{ prop: '作者', desc: true }])
    expect(one.split('\n').slice(0, 11)).toEqual(SRC.split('\n').slice(0, 11))
    expect(parseBase(setBaseSort(baseYaml('书单', ['file.name']), '日期', false)).sort).toEqual([{ prop: '日期', desc: false }])
  })

  it('列的类型：勾选、数字、日期、单选、文字', () => {
    expect(colType(['true', 'false'])).toBe('check')
    expect(colType(['9', '10.5'])).toBe('number')
    expect(colType(['2026-11-17', '2026-01-02'])).toBe('date')
    expect(colType(['在读', '读完', '在读', '在读'])).toBe('select')
    expect(colType(['一句很长很长的评价写在这里了', '另一句'])).toBe('text')
  })

  it('筛选表达式：== != > >= < <= .contains() .isEmpty() 最近 N 天，读回来和写出去一样', () => {
    const cases: [string, BaseCond][] = [
      ['状态 == "在读"', { prop: '状态', op: '==', value: '在读' }],
      ['评分 >= 8', { prop: '评分', op: '>=', value: '8' }],
      ['读完 < "2026-11-01"', { prop: '读完', op: '<', value: '2026-11-01' }],
      ['作者.contains("明")', { prop: '作者', op: 'contains', value: '明' }],
      ['读完.isEmpty()', { prop: '读完', op: 'empty', value: '' }],
      ['读完 >= today() - "7d"', { prop: '读完', op: 'days', value: '7' }],
      ['note["读 完"] > "2026-01-01"', { prop: '读 完', op: '>', value: '2026-01-01' }],
      ['file.name.contains("史")', { prop: 'file.name', op: 'contains', value: '史' }],
      ['在读 == true', { prop: '在读', op: '==', value: 'true' }],
    ]
    for (const [expr, cond] of cases) {
      expect(parseCond(expr)).toEqual(cond)
      expect(condExpr(cond)).toBe(expr)
    }
    expect(parseCond('note.评分 > 7')).toEqual({ prop: '评分', op: '>', value: '7' })
    expect(parseCond('file.hasTag("书")')).toBeNull()
  })

  it('筛出来的行：全部满足 / 任一满足；数字按数字比，日期按日子比，最近 N 天按今天算', () => {
    const notes = [
      { path: '书单/a.md', text: '---\n状态: 在读\n评分: 9\n读完: 2026-11-10\n---\n' },
      { path: '书单/b.md', text: '---\n状态: 在读\n评分: 10\n---\n' },
      { path: '书单/c.md', text: '---\n状态: 读完\n评分: 7\n读完: 2026-10-01\n---\n' },
    ]
    const today = new Date(2026, 10, 17)
    const and = parseBase(setBaseFilters(baseYaml('书单', ['file.name']), 'and', [{ prop: '状态', op: '==', value: '在读' }, { prop: '评分', op: '>=', value: '9.5' }]))
    const rows = baseRows(and, notes, today)
    expect(rows.map((r) => r.name)).toEqual(['b'])
    expect(rows.hidden).toBe(2)
    const or = parseBase(setBaseFilters(baseYaml('书单', ['file.name']), 'or', [{ prop: '评分', op: '<', value: '8' }, { prop: '读完', op: 'days', value: '7' }]))
    expect(or.match).toBe('or')
    expect(baseRows(or, notes, today).map((r) => r.name)).toEqual(['a', 'c'])
    expect(condHolds({ prop: 'x', op: 'empty', value: '' }, '')).toBe(true)
    expect(condHolds({ prop: 'x', op: '>', value: '8' }, '')).toBe(false)
  })

  it('写回筛选：只换 filters 那几行；任一满足时数据源文件夹照样要满足（and 里套 or），读回来认得；认不出的原样留着', () => {
    const src = SRC.replace('    - 状态 != "放弃"', '    - 状态 != "放弃"\n    - file.hasTag("书")')
    const out = setBaseFilters(src, 'and', [{ prop: '状态', op: '==', value: '在读' }, { prop: '评分', op: '>=', value: '8' }])
    expect(out).toBe(src.replace('    - 状态 != "放弃"\n    - file.hasTag("书")', '    - 状态 == "在读"\n    - 评分 >= 8\n    - file.hasTag("书")'))
    const or = setBaseFilters(SRC, 'or', [{ prop: '状态', op: '==', value: '在读' }, { prop: '读完', op: 'empty', value: '' }])
    expect(or.split('\n').slice(0, 6)).toEqual(['filters:', '  and:', '    - file.inFolder("读书/书单")', '    - or:', '        - 状态 == "在读"', '        - 读完.isEmpty()'])
    expect(parseBase(or)).toMatchObject({ folder: '读书/书单', match: 'or', filtersLocked: false, conds: [{ prop: '状态', op: '==', value: '在读' }, { prop: '读完', op: 'empty', value: '' }] })
    expect(or.split('\n').slice(6)).toEqual(SRC.split('\n').slice(4))
    // 去掉全部条件：只剩数据源
    expect(setBaseFilters(or, 'and', []).split('\n').slice(0, 4)).toEqual(['filters:', '  and:', '    - file.inFolder("读书/书单")', 'views:'])
    // 嵌套的组合：表头上不改
    const nested = 'filters:\n  and:\n    - file.inFolder("x")\n    - or:\n        - a == 1\n        - and:\n            - b == 2\nviews:\n  - type: table\n'
    expect(parseBase(nested).filtersLocked).toBe(true)
    expect(() => setBaseFilters(nested, 'and', [])).toThrow('源文件')
  })

  it('隐藏一列就是从 order 里拿掉；别的行原样', () => {
    const out = setBaseOrder(SRC, ['file.name', '评分'])
    expect(parseBase(out).columns).toEqual(['file.name', '评分'])
    expect(out).toBe(SRC.replace('      - 作者\n', ''))
  })

  it('筛选小标签', () => {
    expect(condLabel({ prop: '状态', op: '==', value: '在读' }, 'select')).toBe('状态 是 在读')
    expect(condLabel({ prop: '评分', op: '>=', value: '8' }, 'number')).toBe('评分 ≥ 8')
    expect(condLabel({ prop: '读完', op: 'days', value: '7' }, 'date')).toBe('读完 最近 7 天')
    expect(condLabel({ prop: '在读', op: '==', value: 'false' }, 'check')).toBe('在读 否')
  })
})
