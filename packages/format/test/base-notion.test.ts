import { describe, expect, it } from 'vitest'
import { clearBaseSort, colType, dropBaseProp, listOf, listText, parseBase, renameBaseProp, setBaseColSize, setBaseColType, setBaseSort, setBaseSummary, summarize } from '../src/base'
import { readProps, renameProp, setProp } from '../src/props'
import { addTableRow, findBlocks, setTableCell } from '../src/blocks'

const SRC = `filters:
  and:
    - file.inFolder("冰岛旅行/住宿")
    - 价格 < 1200
views:
  - type: table
    name: 表格
    order:
      - file.name
      - 价格
      - 评分
    sort:
      - property: 价格
        direction: ASC`

describe('数据库照 Notion 做全（列的类型、列宽、计算行、改名、删列）：只改代码块里那几行，Obsidian 照样认', () => {
  it('列的类型写进 properties，读得回来；拿掉回到按值猜', () => {
    const a = setBaseColType(SRC, '价格', 'number')
    expect(a).toBe(SRC + '\nproperties:\n  价格:\n    type: number')
    expect(parseBase(a).types).toEqual({ 价格: 'number' })
    const b = setBaseColType(a, '标签', 'multi')
    expect(parseBase(b).types).toEqual({ 价格: 'number', 标签: 'multi' })
    // 改类型：只换 type 那一行
    expect(setBaseColType(b, '价格', 'text')).toBe(b.replace('    type: number', '    type: text'))
    // 拿掉：空了的 properties 一起拿掉，回到原样
    expect(setBaseColType(setBaseColType(b, '标签', null), '价格', null)).toBe(SRC)
  })

  it('列宽写进视图的 columnSize，计算行写进 summaries（和 Obsidian 一样）', () => {
    const a = setBaseColSize(SRC, '价格', 140.4)
    expect(a).toContain('    columnSize:\n      价格: 140')
    expect(parseBase(a).sizes).toEqual({ 价格: 140 })
    const b = setBaseSummary(a, '价格', 'Average')
    expect(parseBase(b).summaries).toEqual({ 价格: 'Average' })
    expect(parseBase(b).columns).toEqual(['file.name', '价格', '评分'])
    expect(parseBase(b).sort).toEqual([{ prop: '价格', desc: false }])
    expect(setBaseSummary(setBaseColSize(b, '价格', null), '价格', null)).toBe(SRC)
    // 列名有空格：照样读得回来
    expect(setBaseColSize(SRC, '入住 日期', 100)).toContain('      入住 日期: 100')
    expect(parseBase(setBaseColSize(SRC, '入住 日期', 100)).sizes).toEqual({ '入住 日期': 100 })
  })

  it('改列名：order、排序、筛选、类型、列宽、计算都跟着换', () => {
    const src = setBaseSummary(setBaseColSize(setBaseColType(SRC, '价格', 'number'), '价格', 120), '价格', 'Sum')
    const out = parseBase(renameBaseProp(src, '价格', '一晚多少钱'))
    expect(out.columns).toEqual(['file.name', '一晚多少钱', '评分'])
    expect(out.sort).toEqual([{ prop: '一晚多少钱', desc: false }])
    expect(out.conds).toEqual([{ prop: '一晚多少钱', op: '<', value: '1200' }])
    expect(out.types).toEqual({ 一晚多少钱: 'number' })
    expect(out.sizes).toEqual({ 一晚多少钱: 120 })
    expect(out.summaries).toEqual({ 一晚多少钱: 'Sum' })
  })

  it('删一列：order、筛选、排序、类型、列宽、计算里都拿掉', () => {
    const src = setBaseColType(SRC, '价格', 'number')
    const out = parseBase(dropBaseProp(src, '价格'))
    expect(out.columns).toEqual(['file.name', '评分'])
    expect(out.conds).toEqual([])
    expect(out.sort).toEqual([])
    expect(out.types).toEqual({})
    expect(out.folder).toBe('冰岛旅行/住宿')
  })

  it('多选的值写成一行 [a, b]；按值猜得出多选、链接', () => {
    expect(listOf('[温泉, 海边]')).toEqual(['温泉', '海边'])
    expect(listOf('温泉, 海边')).toEqual(['温泉', '海边'])
    expect(listText(['温泉', '海边'])).toBe('[温泉, 海边]')
    expect(listText(['a, b'])).toBe('["a, b"]')
    expect(colType(['[a]', '[a, b]'])).toBe('multi')
    expect(colType(['https://a.is', 'https://b.is/x'])).toBe('url')
  })

  it('计算行：求和、平均、最大、最早、勾了几条、有值的条数、不同的值', () => {
    expect(summarize('Sum', 'number', ['1080', '980', '', '1150'])).toBe('3210')
    expect(summarize('Average', 'number', ['1080', '980', '1150'])).toBe('1070')
    expect(summarize('Median', 'number', ['1', '9', '4'])).toBe('4')
    expect(summarize('Max', 'number', ['1080', '980'])).toBe('1080')
    expect(summarize('Range', 'number', ['1080', '980'])).toBe('100')
    expect(summarize('Earliest', 'date', ['2026-11-20', '2026-11-18'])).toBe('2026-11-18')
    expect(summarize('Range', 'date', ['2026-11-20', '2026-11-18'])).toBe('2天')
    expect(summarize('Checked', 'check', ['true', 'false', ''])).toBe('1')
    expect(summarize('Filled', 'text', ['a', '', 'b'])).toBe('2')
    expect(summarize('Empty', 'text', ['a', '', 'b'])).toBe('1')
    expect(summarize('Unique', 'multi', ['[a, b]', '[b, c]', ''])).toBe('3')
  })

  it('属性：多选原样写一行列表；换掉一行行的列表；改名只换键', () => {
    const t = '---\n状态: 在读\n---\n正文\n'
    expect(setProp(t, '标签', '[温泉, 海边]', { raw: true })).toBe('---\n状态: 在读\n标签: [温泉, 海边]\n---\n正文\n')
    expect(readProps(setProp(t, '标签', '[温泉, 海边]', { raw: true }))).toEqual([
      { key: '状态', value: '在读' },
      { key: '标签', value: '[温泉, 海边]' },
    ])
    const block = '---\n标签:\n  - a\n  - b\n状态: 在读\n---\n'
    expect(setProp(block, '标签', '[a, b, c]', { raw: true })).toBe('---\n标签: [a, b, c]\n状态: 在读\n---\n')
    expect(setProp(block, '标签', undefined)).toBe('---\n状态: 在读\n---\n')
    expect(renameProp(t, '状态', '读到哪')).toBe('---\n读到哪: 在读\n---\n正文\n')
    // 新名字已经有了：不改
    expect(renameProp('---\na: 1\nb: 2\n---\n', 'a', 'b')).toBe('---\na: 1\nb: 2\n---\n')
  })
})

describe('排序面板：换列、换方向、不排序', () => {
  const src = 'filters:\n  and:\n    - file.inFolder("书单")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 评分'
  it('按一列排写进 sort；「不排序」整段拿掉，别的几行一个字不动', () => {
    const sorted = setBaseSort(src, '评分', true)
    expect(parseBase(sorted).sort).toEqual([{ prop: '评分', desc: true }])
    expect(clearBaseSort(sorted)).toBe(src)
    expect(parseBase(clearBaseSort(sorted)).sort).toEqual([])
    // 没有 sort：原样
    expect(clearBaseSort(src)).toBe(src)
  })
  it('加过列（views 后面有 properties）再排序：sort 写进视图里、不落进 properties，排得上；「不排序」回到原样', () => {
    const typed = setBaseColType(src, '读完了', 'check')
    const sorted = setBaseSort(typed, '评分', false)
    expect(sorted).toBe(src + '\n    sort:\n      - property: 评分\n        direction: ASC\nproperties:\n  读完了:\n    type: check')
    expect(parseBase(sorted).sort).toEqual([{ prop: '评分', desc: false }])
    expect(parseBase(sorted).types).toEqual({ 读完了: 'check' })
    // 换方向：只换视图里那一块
    expect(setBaseSort(sorted, '评分', true)).toBe(sorted.replace('direction: ASC', 'direction: DESC'))
    expect(clearBaseSort(sorted)).toBe(typed)
  })
})

describe('文档里的表格就地改格子（方向 A：不露「|」）', () => {
  const md = '# 行程\n\n| 日期 | 地点 |\n| --- | --- |\n|  |  |\n\n后面\n'
  const b = () => findBlocks(md).find((x) => x.kind === 'table')!
  it('改一格只换这一格两条竖线之间的字', () => {
    expect(setTableCell(md, b(), 0, 0, '11月20日')).toBe(md.replace('|  |  |', '| 11月20日 |  |'))
    expect(setTableCell(md, b(), -1, 1, '住哪')).toBe(md.replace('| 日期 | 地点 |', '| 日期 | 住哪 |'))
    // 竖线转义，换行变空格
    expect(setTableCell(md, b(), 0, 1, 'a|b\nc')).toContain('| a\\|b c |')
  })
  it('最后加一行空格子', () => {
    expect(addTableRow(md, b())).toBe('# 行程\n\n| 日期 | 地点 |\n| --- | --- |\n|  |  |\n|  |  |\n\n后面\n')
  })
})
