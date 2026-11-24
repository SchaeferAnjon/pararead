import { describe, expect, it } from 'vitest'
import {
  type BaseCond,
  type BaseFilter,
  condExpr,
  condText,
  dayLabel,
  FILTER_OPS,
  filterCount,
  filterEditable,
  filterFromYaml,
  filterText,
  mergeFilters,
  opLabel,
  parseCond,
  relDay,
  simplifyFilter,
} from '../src/base-filter'

describe('筛选的一句 ↔ 条件（新加的几种）', () => {
  it('不为空、不包含、相对今天的日期，读回来和写出去一样', () => {
    const cases: [string, BaseCond][] = [
      ['!日期.isEmpty()', { prop: '日期', op: 'notempty', value: '' }],
      ['!标签.contains("温泉")', { prop: '标签', op: 'notcontains', value: '温泉' }],
      ['日期 <= today() + "7d"', { prop: '日期', op: '<=', value: 'today() + "7d"' }],
      ['日期 >= today()', { prop: '日期', op: '>=', value: 'today()' }],
      ['日期 < today() - "30d"', { prop: '日期', op: '<', value: 'today() - "30d"' }],
      ['formula.进度 == "50%"', { prop: 'formula.进度', op: '==', value: '50%' }],
      ['练习.contains("练习 3.2")', { prop: '练习', op: 'contains', value: '练习 3.2' }],
      ['评分 > -1', { prop: '评分', op: '>', value: '-1' }],
    ]
    for (const [expr, cond] of cases) {
      expect(parseCond(expr)).toEqual(cond)
      expect(condExpr(cond)).toBe(expr)
    }
  })
  it('写法松一点也认：没空格、now()、"7 days"；最近 N 天照以前', () => {
    expect(parseCond('日期<=today()+"7 days"')).toEqual({ prop: '日期', op: '<=', value: 'today() + "7d"' })
    expect(parseCond('日期 >= now() - "7d"')).toEqual({ prop: '日期', op: 'days', value: '7' })
    expect(parseCond('状态 != \'学完\'')).toEqual({ prop: '状态', op: '!=', value: '学完' })
  })
  it('两列比、套着的运算、别的函数：不是面板上的条件（原样留着）', () => {
    expect(parseCond('已看 >= 节数')).toBeNull()
    expect(parseCond('已看 + 1 > 3')).toBeNull()
    expect(parseCond('file.hasTag("书")')).toBeNull()
    expect(parseCond('今天 == today() + 1')).toBeNull()
  })
  it('以前的表头写出过带横杠的列名（a-b == 1）：照以前认，写回去改成 note["a-b"]', () => {
    expect(parseCond('开始-结束 == 1')).toEqual({ prop: '开始-结束', op: '==', value: '1' })
    expect(condExpr({ prop: '开始-结束', op: '==', value: '1' })).toBe('note["开始-结束"] == 1')
    expect(parseCond('note["开始-结束"] == 1')).toEqual({ prop: '开始-结束', op: '==', value: '1' })
  })
})

describe('筛选面板的条件、小标签（照原型的字）', () => {
  it('日期：早于 / 晚于 / 是 / 为空 / 不为空；值是今天、7天后、30天后', () => {
    expect(FILTER_OPS.date.map((o) => o.label)).toEqual(['早于', '晚于', '是', '为空', '不为空'])
    expect(FILTER_OPS.status.map((o) => o.label)).toEqual(['是', '不是', '为空'])
    expect(FILTER_OPS.relation.map((o) => o.label)).toEqual(['不为空', '为空', '包含'])
    expect([relDay(0), relDay(7), relDay(30), relDay(-7)].map(dayLabel)).toEqual(['今天', '7天后', '30天后', '7天前'])
    expect(dayLabel('today() + "2w"')).toBe('2周后')
    expect(dayLabel('2026-12-01')).toBe('2026-12-01')
  })
  it('一条的小标签、整个筛选的小标签、数几条', () => {
    expect(condText({ prop: '状态', op: '!=', value: '学完' }, 'status')).toBe('状态 不是 学完')
    expect(condText({ prop: '日期', op: '<=', value: relDay(7) }, 'date')).toBe('日期 早于 7天后')
    expect(condText({ prop: '日期', op: 'empty', value: '' }, 'date')).toBe('日期 为空')
    expect(condText({ prop: '读完', op: 'days', value: '7' }, 'date')).toBe('读完 最近 7 天')
    expect(condText({ prop: 'file.name', op: 'contains', value: '讲' }, 'title')).toBe('名字 包含 讲')
    expect(condText({ prop: '在读', op: '==', value: 'false' }, 'check')).toBe('在读 否')
    expect(opLabel('<', 'date')).toBe('早于（不含那天）')
    const f: BaseFilter = {
      conj: 'and',
      items: [
        { prop: '状态', op: '!=', value: '学完' },
        {
          conj: 'or',
          items: [
            { prop: '日期', op: '<=', value: relDay(7) },
            { prop: '日期', op: 'empty', value: '' },
          ],
        },
      ],
    }
    expect(filterText(f, (c) => (c === '状态' ? 'status' : 'date'))).toBe('状态 不是 学完 且 （日期 早于 7天后 或 日期 为空）')
    expect(filterCount(f)).toBe(3)
    expect(filterEditable(f)).toBe(true)
  })
})

describe('读 YAML 里的筛选', () => {
  it('一句、一串、and / or / not、几个键并列都认；认不出的句子原样（raw）', () => {
    expect(filterFromYaml('状态 == "在读"')).toEqual({ conj: 'and', items: [{ prop: '状态', op: '==', value: '在读' }] })
    expect(filterFromYaml(['a == 1', 'file.hasTag("书")'])).toEqual({ conj: 'and', items: [{ prop: 'a', op: '==', value: '1' }, { raw: 'file.hasTag("书")' }] })
    expect(filterFromYaml({ not: ['a == 1'] })).toEqual({ conj: 'not', items: [{ prop: 'a', op: '==', value: '1' }] })
    expect(filterFromYaml({ and: ['a == 1'], or: ['b == 2', 'c == 3'] })).toEqual({
      conj: 'and',
      items: [
        { conj: 'and', items: [{ prop: 'a', op: '==', value: '1' }] },
        {
          conj: 'or',
          items: [
            { prop: 'b', op: '==', value: '2' },
            { prop: 'c', op: '==', value: '3' },
          ],
        },
      ],
    })
    expect(filterFromYaml('')).toBeNull()
  })
  it('面板能不能改：not、套两层的不能（去「改写法」）', () => {
    expect(filterEditable(filterFromYaml({ not: ['a == 1'] }))).toBe(false)
    expect(filterEditable(filterFromYaml({ and: ['a == 1', { or: ['b == 1', { and: ['c == 1'] }] }] }))).toBe(false)
    expect(filterEditable(null)).toBe(true)
  })
  it('合并：都是全部满足时摊平；只剩一组时拆开', () => {
    const a: BaseFilter = { conj: 'and', items: [{ prop: 'x', op: '==', value: '1' }] }
    const b: BaseFilter = { conj: 'or', items: [{ prop: 'y', op: '==', value: '1' }, { prop: 'z', op: '==', value: '1' }] }
    expect(mergeFilters(a, b)).toEqual({ conj: 'and', items: [a.items[0], b] })
    expect(mergeFilters(null, b)).toBe(b)
    expect(simplifyFilter({ conj: 'and', items: [b] })).toEqual(b)
  })
})
