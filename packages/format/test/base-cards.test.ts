/**
 * 画廊卡片没图时露的前几行（previewOf）、看板 / 画廊卡片上露哪几列（cardColumns）：第 2 块（看板、日历、画廊三种看法）加的接口。
 */
import { describe, expect, it } from 'vitest'
import { parseBaseDoc } from '../src/base-doc'
import { baseContext, cardColumns, previewOf } from '../src/base-rows'
import { ECP_BASE, EXERCISES, LECTURES, records } from './base-samples'

describe('previewOf：画廊没图时露的字', () => {
  it('去掉开头属性、标题行、图、代码块和记号，按行留着', () => {
    expect(previewOf(LECTURES['课程/ecp/课程计划/第1讲 绪论.md']!)).toBe('经济学研究稀缺资源怎么分配。这一讲讲机会成本和边际思考。\n读第1章')
    expect(previewOf(LECTURES['课程/ecp/课程计划/第3讲 生产.md']!)).toBe('短期只有劳动能变，边际产量先升后降。\n看完第3、4节视频')
    expect(
      previewOf('---\n状态: 在学\n---\n# 标题\n\n```js\nconst a = 1\n```\n**粗**和 ==高亮== 、`代码`、[链接](https://x.y) 和 [[第2讲|别名]] [[第3讲]] ^abc123\n> 引一句\n<span>标签</span>里的字'),
    ).toBe('粗和 高亮 、代码、链接 和 别名 第3讲\n引一句\n标签里的字')
  })
  it('没有正文是空字；长了截断带省略号', () => {
    expect(previewOf('---\n状态: 未开始\n---\n')).toBe('')
    expect(previewOf('')).toBe('')
    const long = previewOf('字'.repeat(300), 100)
    expect(long).toBe('字'.repeat(100) + '…')
  })
})

describe('cardColumns：卡片上露哪几列', () => {
  const ctx = baseContext(parseBaseDoc(ECP_BASE), records(LECTURES), {
    related: { '课程/ecp/练习': records(EXERCISES) },
    today: '2026-11-22',
  })
  it('视图自己写了列：照它（去掉名字和分组那一列）', () => {
    const doc = parseBaseDoc(ECP_BASE.replace('  - type: kanban\n    name: 看板\n', '  - type: kanban\n    name: 看板\n    order:\n      - file.name\n      - 状态\n      - 已看\n'))
    const c = baseContext(doc, records(LECTURES), { today: '2026-11-22' })
    expect(cardColumns(c, 1, '状态')).toEqual(['已看'])
  })
  it('没写列（看板、画廊默认）：照第一个表格的列，去掉名字、分组那一列和关联列（顺着它的汇总留着）', () => {
    // 全部：名字、状态、日期、进度、练习、做完几题 → 看板（按状态分列）：日期、进度、做完几题（照原型的卡片）
    expect(cardColumns(ctx, 1, '状态')).toEqual(['日期', 'formula.进度', '做完几题'])
    // 画廊：只露状态（画小圆点）和日期（原型「● 学完 · 11月10日」）
    expect(cardColumns(ctx, 3, null)).toEqual(['状态', '日期'])
  })
})
