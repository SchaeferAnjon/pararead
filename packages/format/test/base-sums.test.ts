/**
 * 表底合计（task-i921u「通用合计」）：每种算法、公式列也能算、空值、按月 / 按周分组、组的小计和占比、
 * 换算法和换分组只换那几行、打开再保存不变。
 */
import { describe, expect, it } from 'vitest'
import { parseBaseDoc, setViewGroup, setViewSummary } from '../src/base-doc'
import { baseContext, groupRows, isoWeek, queryView } from '../src/base-rows'
import { isSummaryId, shareOf, SUMMARY_MENU, summarizeVals, summaryOf, sumKind } from '../src/base-sums'
import { SUMMARIES, summarize } from '../src/base'
import { records, SUMS_BASE, SUMS_ROWS } from './base-samples'
import { lineDiff } from './line-diff'

const ctxOf = (src = SUMS_BASE) => baseContext(parseBaseDoc(src), records(SUMS_ROWS), { today: '2026-11-22' })
const diff = (a: string, b: string) => lineDiff(a, b)

describe('每种算法（summarizeVals）', () => {
  const nums = [8800, 41, null, 6, '', 2600]
  it('计数类：全部条数、有值的、空着的、不同的值、有值的占几成、空着的占几成', () => {
    expect(summarizeVals('Count', 'number', nums)).toEqual({ text: '6', num: 6, kind: 'count' })
    expect(summarizeVals('Filled', 'number', nums).text).toBe('4')
    expect(summarizeVals('Empty', 'number', nums).text).toBe('2')
    expect(summarizeVals('Unique', 'other', ['a', 'b', ' a ', '', null]).text).toBe('2')
    expect(summarizeVals('Unique', 'other', [['a', 'b'], ['b', 'c'], []]).text).toBe('3')
    expect(summarizeVals('PercentFilled', 'number', nums)).toEqual({ text: '67%', num: 67, kind: 'percent' })
    expect(summarizeVals('PercentEmpty', 'number', nums).text).toBe('33%')
  })
  it('数字类：求和、求和带占比、平均、中位、最小、最大、范围；不是数的字不算', () => {
    expect(summarizeVals('Sum', 'number', nums)).toEqual({ text: '11447', num: 11447, kind: 'number' })
    expect(summarizeVals('SumShare', 'number', nums).text).toBe('11447')
    expect(summarizeVals('Average', 'number', nums).text).toBe('2861.75')
    expect(summarizeVals('Median', 'number', nums).text).toBe('1320.5')
    expect(summarizeVals('Median', 'number', [3, 1, 2]).text).toBe('2')
    expect(summarizeVals('Min', 'number', nums).text).toBe('6')
    expect(summarizeVals('Max', 'number', nums).text).toBe('8800')
    expect(summarizeVals('Range', 'number', nums).text).toBe('8794')
    expect(summarizeVals('Sum', 'number', [1, '2', 'x', '3.5']).text).toBe('6.5')
  })
  it('日期类：最早、最晚、跨了几天（带钟点的按那一天）', () => {
    const days = [{ date: '2026-11-20' }, null, { date: '2026-09-05', time: '09:00' }, '2026-11-22']
    expect(summarizeVals('Earliest', 'date', days)).toEqual({ text: '2026-09-05', num: null, kind: 'date' })
    expect(summarizeVals('Latest', 'date', days).text).toBe('2026-11-22')
    expect(summarizeVals('Range', 'date', days)).toEqual({ text: '78天', num: 78, kind: 'days' })
  })
  it('勾选：勾了几条、没勾几条、勾了的占几成', () => {
    const c = [true, false, false, true, false]
    expect(summarizeVals('Checked', 'check', c).text).toBe('2')
    expect(summarizeVals('Unchecked', 'check', c).text).toBe('3')
    expect(summarizeVals('PercentChecked', 'check', c)).toEqual({ text: '40%', num: 40, kind: 'percent' })
  })
  it('一条都没有：条数 0、和是 0，平均、最早、占几成这些空着；认不出的算法空着', () => {
    expect(summarizeVals('Count', 'number', []).text).toBe('0')
    expect(summarizeVals('Sum', 'number', []).text).toBe('0')
    for (const id of ['Average', 'Median', 'Min', 'Max', 'Range', 'Earliest', 'PercentFilled', 'PercentChecked']) expect(summarizeVals(id, 'number', []).kind).toBe('none')
    expect(summarizeVals('Whatever', 'number', [1]).kind).toBe('none')
  })
  it('菜单：数字七种 + 计数六种，日期三种 + 计数六种，勾选三种 + 条数，别的计数六种；认得的名字', () => {
    expect(SUMMARY_MENU.number).toEqual([
      ['Sum', 'SumShare', 'Average', 'Median', 'Min', 'Max', 'Range'],
      ['Count', 'Filled', 'Empty', 'Unique', 'PercentFilled', 'PercentEmpty'],
    ])
    expect(SUMMARY_MENU.date[0]).toEqual(['Earliest', 'Latest', 'Range'])
    expect(SUMMARY_MENU.check).toEqual([['Checked', 'Unchecked', 'PercentChecked'], ['Count']])
    expect(SUMMARY_MENU.other).toEqual([['Count', 'Filled', 'Empty', 'Unique', 'PercentFilled', 'PercentEmpty']])
    expect(isSummaryId('PercentChecked')).toBe(true)
    expect(isSummaryId('sum')).toBe(false)
  })
  it('第二批表头的老接口 summarize / SUMMARIES 也认新的几种', () => {
    expect(summarize('Count', 'text', ['a', '', 'b'])).toBe('3')
    expect(summarize('PercentFilled', 'text', ['a', '', 'b', ''])).toBe('50%')
    expect(summarize('PercentChecked', 'check', ['true', 'false', '', 'TRUE'])).toBe('50%')
    expect(summarize('SumShare', 'number', ['1', '2'])).toBe('3')
    expect(SUMMARIES.number.map((s) => s.label)).toEqual(['求和', '求和，组里画占比', '平均', '中位数', '最小', '最大', '最大减最小', '全部条数', '有值的', '空着的', '不同的值', '有值的占几成', '空着的占几成'])
    expect(SUMMARIES.date.map((s) => s.label).slice(0, 3)).toEqual(['最早', '最晚', '跨了几天'])
    expect(SUMMARIES.check.map((s) => s.label)).toEqual(['勾了几条', '没勾几条', '勾了的占几成', '全部条数'])
  })
})

describe('表里算：公式列、日期列、勾选列', () => {
  const ctx = ctxOf()
  it('公式列按算出来的值归类：收入、支出、结余是数字；日期、勾选照列的类型；文字列是别的', () => {
    expect(sumKind(ctx, 'formula.收入')).toBe('number')
    expect(sumKind(ctx, 'formula.结余')).toBe('number')
    expect(sumKind(ctx, '日期')).toBe('date')
    expect(sumKind(ctx, '报销了')).toBe('check')
    expect(sumKind(ctx, '分类')).toBe('other')
    expect(sumKind(ctx, 'file.name')).toBe('other')
  })
  it('「按月」表底：条数 10、收入 25200、支出 5656、结余 19544（公式列能被算，空值不算）', () => {
    const rows = queryView(ctx, 0).rows
    expect(summaryOf(ctx, rows, 'file.name', 'Count').text).toBe('10')
    expect(summaryOf(ctx, rows, 'formula.收入', 'Sum').text).toBe('25200')
    expect(summaryOf(ctx, rows, 'formula.支出', 'Sum').text).toBe('5656')
    expect(summaryOf(ctx, rows, 'formula.结余', 'Sum').text).toBe('19544')
    expect(summaryOf(ctx, rows, 'formula.收入', 'PercentFilled').text).toBe('30%')
    expect(summaryOf(ctx, rows, 'formula.支出', 'Average').text).toBe('808')
  })
  it('「全部」：日期跨了 327 天、金额中位 1450、勾了的占一成；分类有值的九成、五种', () => {
    const rows = queryView(ctx, 2).rows
    expect(summaryOf(ctx, rows, '日期', 'Range').text).toBe('327天')
    expect(summaryOf(ctx, rows, '日期', 'Earliest').text).toBe('2025-12-30')
    expect(summaryOf(ctx, rows, '金额', 'Median').text).toBe('1450')
    expect(summaryOf(ctx, rows, '报销了', 'PercentChecked').text).toBe('10%')
    expect(summaryOf(ctx, rows, '报销了', 'Checked').text).toBe('1')
    expect(summaryOf(ctx, rows, '分类', 'PercentFilled').text).toBe('90%')
    expect(summaryOf(ctx, rows, '分类', 'Unique').text).toBe('5')
  })
})

describe('按月、按周分组；组头小计和占比', () => {
  const ctx = ctxOf()
  it('读：groupBy 写成几行的 by: month，一行写的 {property: 日期, by: week}；认不出的 by: total 读成没有 by', () => {
    const v = parseBaseDoc(SUMS_BASE).views
    expect(v[0]!.groupBy).toEqual({ prop: '日期', desc: true, by: 'month' })
    expect(v[1]!.groupBy).toEqual({ prop: '分类', desc: true })
    expect(v[2]!.groupBy).toEqual({ prop: '日期', desc: false, by: 'week' })
  })
  it('按月：新的在前，今年的写「11月」，去年的带年，没写日期的在最后「没填」', () => {
    const g = queryView(ctx, 0).groups!
    expect(g.map((x) => [x.key, x.label, x.rows.length])).toEqual([
      ['2026-11', '11月', 4],
      ['2026-10', '10月', 3],
      ['2026-09', '9月', 1],
      ['2025-12', '2025年12月', 1],
      ['', '没填', 1],
    ])
    expect(g[0]!.period).toEqual({ by: 'month', year: 2026, num: 11, start: '2026-11-01', thisYear: true })
  })
  it('组头小计：11月收入 8800、支出 2647、结余 6153；组收起不影响算', () => {
    const nov = queryView(ctx, 0).groups![0]!.rows
    expect(summaryOf(ctx, nov, 'formula.收入', 'Sum').text).toBe('8800')
    expect(summaryOf(ctx, nov, 'formula.支出', 'Sum').text).toBe('2647')
    expect(summaryOf(ctx, nov, 'formula.结余', 'Sum').text).toBe('6153')
  })
  it('按周（ISO 周）：2026-11-22 是第 47 周（11-16 周一起）；2025-12-30 算 2026 年第 1 周', () => {
    expect(isoWeek('2026-11-22')).toEqual({ year: 2026, week: 47, start: '2026-11-16' })
    expect(isoWeek('2026-11-16')).toEqual({ year: 2026, week: 47, start: '2026-11-16' })
    expect(isoWeek('2025-12-30')).toEqual({ year: 2026, week: 1, start: '2025-12-29' })
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53, start: '2026-12-28' })
    expect(isoWeek('2021-01-03')).toEqual({ year: 2020, week: 53, start: '2020-12-28' })
    const g = queryView(ctx, 2).groups!
    expect(g.map((x) => [x.key, x.label, x.rows.length])).toEqual([
      ['2026-W01', '第1周', 1],
      ['2026-W36', '第36周', 1],
      ['2026-W40', '第40周', 1],
      ['2026-W41', '第41周', 1],
      ['2026-W42', '第42周', 1],
      ['2026-W44', '第44周', 1],
      ['2026-W45', '第45周', 1],
      ['2026-W47', '第47周', 2],
      ['', '没填', 1],
    ])
  })
  it('不是日期的值进「没填」；看板不按月分（拖卡会把「2026-11」写进格子）', () => {
    const g = groupRows(ctx, ctx.recs, '分类', false, 'month')
    expect(g.length).toBe(1)
    expect(g[0]!.rows.length).toBe(10)
    const kanban = SUMS_BASE.replace('  - type: table\n    name: 按月', '  - type: kanban\n    name: 按月')
    expect(queryView(ctxOf(kanban), 0).groups!.map((x) => x.key).slice(0, 2)).toEqual(['2026-11-22', '2026-11-20'])
  })
  it('占比条：住房占支出 92%，没填分类的那组 2%，全部是 0 时没有', () => {
    const r = queryView(ctx, 1)
    expect(r.rows.length).toBe(7)
    const by = Object.fromEntries(r.groups!.map((g) => [g.label, g.rows]))
    expect(Math.round(shareOf(ctx, by['住房']!, r.rows, 'formula.支出')! * 100)).toBe(92)
    expect(Math.round(shareOf(ctx, by['没填']!, r.rows, 'formula.支出')! * 100)).toBe(2)
    expect(shareOf(ctx, by['住房']!, r.rows, 'formula.收入')).toBeNull()
  })
})

describe('写进视图：只换那几行，换回去一个字不差', () => {
  it('表底换算法：只换 summaries 里那一行；新加一列的算法加一行；不算拿掉那一行', () => {
    const a = setViewSummary(SUMS_BASE, 0, 'formula.支出', 'Average')
    expect(diff(SUMS_BASE, a)).toEqual({ removed: ['      formula.支出: Sum'], added: ['      formula.支出: Average'] })
    const b = setViewSummary(SUMS_BASE, 0, '金额', 'SumShare')
    expect(diff(SUMS_BASE, b)).toEqual({ removed: [], added: ['      金额: SumShare'] })
    const c = setViewSummary(SUMS_BASE, 2, '报销了', null)
    expect(diff(SUMS_BASE, c)).toEqual({ removed: ['      报销了: PercentChecked'], added: [] })
    expect(setViewSummary(setViewSummary(a, 0, 'formula.支出', 'Sum'), 0, '金额', null)).toBe(SUMS_BASE)
    expect(setViewSummary(setViewSummary(b, 0, '金额', null), 0, '金额', null)).toBe(SUMS_BASE)
    // 别的视图上同名的列不动
    expect(parseBaseDoc(a).views[1]!.summaries).toEqual(parseBaseDoc(SUMS_BASE).views[1]!.summaries)
  })
  it('按月分组：没分组的视图加三行（property、by、direction）；改成按周只换 by 那一行；改回不分组回到原样', () => {
    const src = SUMS_BASE.replace('    groupBy:\n      property: 日期\n      by: month\n      direction: DESC\n', '')
    const a = setViewGroup(src, 0, { prop: '日期', by: 'month', desc: true })
    expect(a).toBe(SUMS_BASE)
    const w = setViewGroup(SUMS_BASE, 0, { prop: '日期', by: 'week', desc: true })
    expect(diff(SUMS_BASE, w)).toEqual({ removed: ['      by: month'], added: ['      by: week'] })
    const plain = setViewGroup(SUMS_BASE, 0, { prop: '收支', desc: true })
    expect(diff(SUMS_BASE, plain)).toEqual({ removed: ['      property: 日期', '      by: month'], added: ['      property: 收支'] })
    expect(setViewGroup(SUMS_BASE, 0, null)).toBe(src)
  })
  it('一行写的 {property: 日期, by: week}：照读到的写回去一个字不动；换了才改写成几行', () => {
    const v = parseBaseDoc(SUMS_BASE).views
    expect(setViewGroup(SUMS_BASE, 2, v[2]!.groupBy)).toBe(SUMS_BASE)
    expect(setViewGroup(SUMS_BASE, 1, v[1]!.groupBy)).toBe(SUMS_BASE)
    const m = setViewGroup(SUMS_BASE, 2, { prop: '日期', by: 'month', desc: false })
    expect(diff(SUMS_BASE, m)).toEqual({ removed: ['    groupBy: {property: 日期, by: week}'], added: ['    groupBy:', '      property: 日期', '      by: month', '      direction: ASC'] })
    expect(parseBaseDoc(m).views[2]!.groupBy).toEqual({ prop: '日期', by: 'month', desc: false })
  })
  it('一个字写的 groupBy: 状态 换成按月：写成几行（同一行的注释照 setBlock 的老规矩不留）', () => {
    const src = 'filters:\n  and:\n    - file.inFolder("x")\nviews:\n  - type: table\n    groupBy: 状态 # 注释'
    const out = setViewGroup(src, 0, { prop: '日期', by: 'month', desc: false })
    expect(out).toBe('filters:\n  and:\n    - file.inFolder("x")\nviews:\n  - type: table\n    groupBy:\n      property: 日期\n      by: month\n      direction: ASC')
  })
})
