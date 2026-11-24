import { describe, expect, it } from 'vitest'
import {
  deleteTableCol,
  deleteTableRow,
  findBlocks,
  gridToTable,
  insertTableCol,
  insertTableRow,
  moveTableCol,
  moveTableRow,
  parseTable,
  pasteTableCells,
  setTableAlign,
  setTableWidths,
  tableWidths,
} from '../src'

// 一张手排过对齐空格的表（打开再改一行、一列时别的格子的空格要原样）
const T = `前面一段。

| 日期      | 路线         | 距离   |
|:----------|--------------|-------:|
| 2.24 周三 | 机场 → 塞尔福斯 | 97 km  |
| 2.25 周四 | 黄金圈       | 215 km |

后面一段。
`
const tb = (s: string) => findBlocks(s).find((b) => b.kind === 'table')!
const lines = (s: string) => s.split('\n')
/** 两篇哪几行不一样 */
const diff = (a: string, b: string) => {
  const A = lines(a)
  const B = lines(b)
  return B.map((l, i) => (l !== A[i] ? i : -1)).filter((i) => i >= 0)
}

describe('表格整行改法', () => {
  it('下面加一行：只多一行，别的行一字不动', () => {
    const out = insertTableRow(T, tb(T), 0, 'below')
    expect(lines(out)).toEqual([...lines(T).slice(0, 5), '|  |  |  |', ...lines(T).slice(5)])
  })
  it('上面加一行、表头下面加一行', () => {
    expect(lines(insertTableRow(T, tb(T), 1, 'above'))[5]).toBe('|  |  |  |')
    expect(lines(insertTableRow(T, tb(T), -1, 'below'))[4]).toBe('|  |  |  |')
  })
  it('删一行只少那一行；删表头时第一行升上去', () => {
    expect(lines(deleteTableRow(T, tb(T), 0))).toEqual([...lines(T).slice(0, 4), ...lines(T).slice(5)])
    const h = deleteTableRow(T, tb(T), -1)
    expect(lines(h)[2]).toBe('| 2.24 周三 | 机场 → 塞尔福斯 | 97 km  |')
    expect(lines(h)[3]).toBe('|:----------|--------------|-------:|')
    expect(parseTable(h, tb(h)).rows).toHaveLength(1)
  })
  it('挪行：两行换位置，字原样', () => {
    const out = moveTableRow(T, tb(T), 0, 1)
    expect(lines(out)[4]).toBe(lines(T)[5])
    expect(lines(out)[5]).toBe(lines(T)[4])
    expect(diff(T, out)).toEqual([4, 5])
  })
})

describe('表格整列改法', () => {
  it('右边加一列：每行在那一处插一格，别的格子的空格原样', () => {
    const out = insertTableCol(T, tb(T), 0, 'right')
    expect(lines(out)[2]).toBe('| 日期      |  | 路线         | 距离   |')
    // 拖过宽的表（「-」不一样多）：新的一列给其余列的平均宽
    expect(lines(out)[3]).toBe('|:----------|----------|--------------|-------:|')
    expect(parseTable(out, tb(out)).head.map((c) => c.text)).toEqual(['日期', '', '路线', '距离'])
  })
  it('最后一列右边加、没有结尾竖线的表也认得', () => {
    const s = 'a | b\n--|--\n1 | 2\n'
    const out = insertTableCol(s, tb(s), 1, 'right')
    expect(parseTable(out, tb(out)).head.map((c) => c.text)).toEqual(['a', 'b', ''])
    expect(parseTable(out, tb(out)).rows[0]!.map((c) => c.text)).toEqual(['1', '2', ''])
  })
  it('删一列、挪一列', () => {
    const d = deleteTableCol(T, tb(T), 1)
    expect(lines(d)[2]).toBe('| 日期      | 距离   |')
    expect(lines(d)[3]).toBe('|:----------|-------:|')
    const m = moveTableCol(T, tb(T), 2, 0)
    expect(lines(m)[2]).toBe('| 距离   | 日期      | 路线         |')
    expect(lines(m)[3]).toBe('|-------:|:----------|--------------|')
    expect(deleteTableCol('| a |\n|---|\n| 1 |', tb('| a |\n|---|\n| 1 |'), 0)).toBe('| a |\n|---|\n| 1 |')
  })
  it('对齐只改第二行那一格', () => {
    const out = setTableAlign(T, tb(T), 1, 'center')
    expect(diff(T, out)).toEqual([3])
    expect(lines(out)[3]).toBe('|:----------|:--------------:|-------:|')
    expect(parseTable(out, tb(out)).align).toEqual(['left', 'center', 'right'])
    expect(lines(setTableAlign(T, tb(T), 2, null))[3]).toBe('|:----------|--------------|-------|')
  })
})

describe('列宽：第二行「-」的个数', () => {
  it('「-」一样多是平分（null）；不一样按比例', () => {
    const s = '| a | b |\n|---|---|\n| 1 | 2 |'
    expect(tableWidths(s, tb(s))).toBeNull()
    expect(tableWidths(T, tb(T))!.map((x) => Math.round(x * 100))).toEqual([32, 45, 23])
  })
  it('写列宽只改第二行，冒号留着；写回平分时每列 3 个', () => {
    const out = setTableWidths(T, tb(T), [0.5, 0.25, 0.25])
    expect(diff(T, out)).toEqual([3])
    expect(lines(out)[3]).toBe('|:' + '-'.repeat(30) + '|' + '-'.repeat(15) + '|' + '-'.repeat(15) + ':|')
    const eq = setTableWidths(out, tb(out), [1 / 3, 1 / 3, 1 / 3])
    expect(lines(eq)[3]).toBe('|:---|---|---:|')
  })
})

describe('粘贴成表', () => {
  it('从一格起贴 2×2：只动这几格，字一样的格子不动', () => {
    const out = pasteTableCells(T, tb(T), 0, 1, [
      ['机场 → 塞尔福斯', '98 km'],
      ['黄金圈', '216 km'],
    ])
    expect(lines(out)[4]).toBe('| 2.24 周三 | 机场 → 塞尔福斯 | 98 km |')
    expect(lines(out)[5]).toBe('| 2.25 周四 | 黄金圈       | 216 km |')
  })
  it('不够的行、列补上', () => {
    const s = '| a | b |\n|---|---|\n| 1 | 2 |'
    const out = pasteTableCells(s, tb(s), 0, 1, [
      ['x', 'y'],
      ['z', 'w'],
    ])
    const t = parseTable(out, tb(out))
    expect(t.head.map((c) => c.text)).toEqual(['a', 'b', ''])
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['1', 'x', 'y'],
      ['', 'z', 'w'],
    ])
  })
  it('几行几格写成一张表', () => {
    expect(gridToTable([['城市', '人口'], ['雷克雅未克', '14 万'], ['a|b']])).toBe('| 城市 | 人口 |\n|---|---|\n| 雷克雅未克 | 14 万 |\n| a\\|b |  |')
  })
})
