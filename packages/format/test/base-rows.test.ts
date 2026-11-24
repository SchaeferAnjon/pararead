import { describe, expect, it } from 'vitest'
import { parseBaseDoc, setFormula, setPropDef } from '../src/base-doc'
import {
  allColumns,
  baseContext,
  cellOf,
  columnInfo,
  coverOf,
  dateMoved,
  formulaExamples,
  formulaScope,
  groupRows,
  linkedFrom,
  previewFormula,
  queryView,
  recordFields,
  relationChoices,
  relationLinks,
  statusGroups,
  statusTone,
} from '../src/base-rows'
import { checkFormula } from '../src/base-expr'
import { ECP_BASE, EXERCISES, LECTURES, records } from './base-samples'

const ALL = records({ ...LECTURES, ...EXERCISES })
const ctxOf = (src = ECP_BASE, extra: Record<string, string> = {}) => baseContext(parseBaseDoc(src), [...ALL, ...records(extra)], { today: '2026-11-22' })
const P = (n: string) => `课程/ecp/课程计划/${n}.md`
const names = (rs: { name: string }[]) => rs.map((r) => r.name.split(' ')[0])

describe('算一个视图（照原型的八讲、七题，今天 11月22日）', () => {
  const ctx = ctxOf()
  it('全部：八条，按名字排（第2讲在第10讲前面那种排法）', () => {
    const r = queryView(ctx, 0)
    expect(names(r.rows)).toEqual(['第1讲', '第2讲', '第3讲', '第4讲', '第5讲', '第6讲', '第7讲', '第8讲'])
    expect([r.total, r.hidden]).toEqual([8, 0])
  })
  it('没学完的：状态不是学完，且（日期早于 7天后，或日期为空）；按日期升序，没日期的在最后（留下 4 条，筛掉 4 条）', () => {
    const r = queryView(ctx, 4)
    expect(names(r.rows)).toEqual(['第3讲', '第4讲', '第5讲', '第7讲'])
    expect([r.total, r.hidden]).toEqual([8, 4])
    expect(r.errors).toEqual([])
  })
  it('看板：按状态分列，每个选项一列，圆点颜色是它在哪一组；最后是「没填」', () => {
    const r = queryView(ctx, 1)
    expect(r.groupProp).toBe('状态')
    expect(r.groups!.map((g) => [g.label, g.tone, names(g.rows)])).toEqual([
      ['未开始', 0, ['第5讲', '第6讲', '第7讲', '第8讲']],
      ['在学', 1, ['第3讲', '第4讲']],
      ['学完', 2, ['第1讲', '第2讲']],
      ['没填', -1, []],
    ])
  })
  it('日历：哪天有哪几条，没排日子的单独一组', () => {
    const r = queryView(ctx, 2)
    expect(r.dateProp).toBe('日期')
    expect(Object.fromEntries(Object.entries(r.days!).map(([d, rs]) => [d, names(rs)]))).toEqual({
      '2026-11-10': ['第1讲'],
      '2026-11-12': ['第2讲'],
      '2026-11-17': ['第3讲'],
      '2026-11-24': ['第4讲'],
      '2026-11-26': ['第5讲'],
      '2026-12-01': ['第6讲'],
      '2026-12-08': ['第8讲'],
    })
    expect(names(r.undated!)).toEqual(['第7讲'])
  })
  it('画廊的封面：正文第一张图（![]()、![[图]]、<img>），没图是 null', () => {
    expect(ctx.recs.map((r) => coverOf(r.text))).toEqual([null, '第2讲%20需求和效用/需求曲线.png', '边际产量.png', '市场.png', null, null, null, null])
    expect(coverOf('---\n图: x.png\n---\n```md\n![不算](代码里.png)\n```\n正文 ![[笔记]] 和 ![[图 1.JPG|300]]')).toBe('图 1.JPG')
  })
})

describe('每一格：公式、汇总、关联', () => {
  const ctx = ctxOf()
  const rec = (n: string) => ctx.recs.find((r) => r.name.startsWith(n))!
  it('公式「进度」：100%、50%、33%、0%', () => {
    expect(['第1讲', '第3讲', '第4讲', '第5讲'].map((n) => cellOf(ctx, rec(n), 'formula.进度').text)).toEqual(['100%', '50%', '33%', '0%'])
    expect(cellOf(ctx, rec('第3讲'), 'formula.进度').computed).toBe(true)
  })
  it('汇总「做完几题」：顺着练习数做完，「1/2」带进度；没有练习的空着', () => {
    expect(cellOf(ctx, rec('第3讲'), '做完几题')).toEqual({ value: 0.5, text: '1/2', progress: [1, 2], computed: true })
    expect(cellOf(ctx, rec('第2讲'), '做完几题').text).toBe('2/2')
    expect(cellOf(ctx, rec('第4讲'), '做完几题').text).toBe('0/1')
    expect(cellOf(ctx, rec('第6讲'), '做完几题').text).toBe('')
  })
  it('汇总的几种算法：几个、勾了几个、求和、平均、最早、最晚', () => {
    const calc = (calc: string, prop = '做完') => {
      const c = ctxOf(setPropDef(ECP_BASE, '做完几题', { type: 'rollup', via: '练习', prop, calc: calc as 'count' }))
      return cellOf(c, c.recs.find((r) => r.name.startsWith('第2讲'))!, '做完几题').text
    }
    expect(calc('count')).toBe('2')
    expect(calc('checked')).toBe('2')
    const withScore = { '课程/ecp/练习/练习 2.1.md': '---\n分数: 80\n交于: 2026-11-13\n所属讲: ["[[第2讲 需求和效用]]"]\n---\n', '课程/ecp/练习/练习 2.2.md': '---\n分数: 95\n交于: 2026-11-15\n所属讲: ["[[第2讲 需求和效用]]"]\n---\n' }
    const at = (calc: string, prop: string) => {
      const c = baseContext(parseBaseDoc(setPropDef(ECP_BASE, '做完几题', { type: 'rollup', via: '练习', prop, calc: calc as 'sum' })), [...ALL.filter((r) => !(r.path in withScore)), ...records(withScore)], { today: '2026-11-22' })
      return cellOf(c, c.recs.find((r) => r.name.startsWith('第2讲'))!, '做完几题').text
    }
    expect([at('sum', '分数'), at('average', '分数'), at('earliest', '交于'), at('latest', '交于')]).toEqual(['175', '87.5', '2026-11-13', '2026-11-15'])
  })
  it('关联：连着那边哪几篇（名字、路径）；那边没有的 path 是 null', () => {
    expect(relationLinks(ctx, rec('第3讲'), '练习').map((l) => [l.name, l.path])).toEqual([
      ['练习 3.1', '课程/ecp/练习/练习 3.1.md'],
      ['练习 3.2', '课程/ecp/练习/练习 3.2.md'],
    ])
    expect(cellOf(ctx, rec('第3讲'), '练习').text).toBe('练习 3.1, 练习 3.2')
    const odd = ctxOf(ECP_BASE, { [P('第9讲 补课')]: '---\n练习: [[[练习 1.1]], "[[练习/练习 2.1|二点一]]", "[[练习 9.9]]"]\n---\n' })
    expect(relationLinks(odd, odd.recs.find((r) => r.name === '第9讲 补课')!, '练习').map((l) => [l.name, l.path])).toEqual([
      ['练习 1.1', '课程/ecp/练习/练习 1.1.md'],
      ['练习 2.1', '课程/ecp/练习/练习 2.1.md'],
      ['练习 9.9', null],
    ])
    expect(names(linkedFrom(ctx, '练习', '课程/ecp/练习/练习 3.2.md'))).toEqual(['第3讲'])
    expect(relationChoices(ctx, '练习').map((r) => r.name)).toEqual(['练习 1.1', '练习 2.1', '练习 2.2', '练习 3.1', '练习 3.2', '练习 4.1', '练习 5.1'])
  })
  it('公式写错、互相用到：格子空着，带一句话；公式里能用汇总', () => {
    const c = ctxOf(setFormula(setFormula(setFormula(ECP_BASE, '坏的', '状态 * 2'), '甲', '乙 + 1'), '乙', '甲 + 1'))
    const r = c.recs.find((x) => x.name.startsWith('第3讲'))!
    expect(cellOf(c, r, 'formula.坏的')).toMatchObject({ value: null, error: '「状态」是字，不能乘' })
    expect(cellOf(c, r, 'formula.甲').error).toBe('「乙」和「甲」互相用到，算不出来')
    const d = ctxOf(setFormula(ECP_BASE, '做完率', '(做完几题 * 100).round() + "%"'))
    expect(cellOf(d, d.recs.find((x) => x.name.startsWith('第3讲'))!, 'formula.做完率').text).toBe('50%')
  })
  it('筛选里读不懂的一句：照以前筛行时不算，告诉界面', () => {
    const src = ECP_BASE.replace('        - 状态 != "学完"', '        - 状态 != "学完"\n        - nosuch(状态)')
    const r = queryView(ctxOf(src), 4)
    expect(names(r.rows)).toEqual(['第3讲', '第4讲', '第5讲', '第7讲'])
    expect(r.errors[0]).toMatch(/^「nosuch\(状态\)」没有「nosuch\(\)」这个函数/)
  })
})

describe('分组、状态的组、列、右栏、公式框', () => {
  const ctx = ctxOf()
  it('状态的组：文件里写了、组里没有的值放进第一组；颜色照组', () => {
    const c = ctxOf(ECP_BASE, { [P('第0讲 预习')]: '---\n状态: 放弃\n---\n' })
    expect(statusGroups(c, '状态')).toEqual([
      { name: '待开始', options: ['未开始', '放弃'] },
      { name: '进行中', options: ['在学'] },
      { name: '完成', options: ['学完'] },
    ])
    expect([statusTone(c, '状态', '在学'), statusTone(c, '状态', '学完'), statusTone(c, '状态', '没有')]).toEqual([1, 2, -1])
  })
  it('按别的列分组：数字按大小、勾选分是 / 否、关联一条可以在几组里；降序', () => {
    expect(groupRows(ctx, ctx.recs, '节数').map((g) => [g.label, g.rows.length])).toEqual([
      ['2', 1],
      ['3', 4],
      ['4', 3],
      ['没填', 0],
    ])
    expect(groupRows(ctx, ctx.recs, '节数', true).map((g) => g.label)).toEqual(['4', '3', '2', '没填'])
    expect(groupRows(ctx, ctx.recs, '练习').map((g) => [g.label, names(g.rows)]).slice(0, 3)).toEqual([
      ['练习 1.1', ['第1讲']],
      ['练习 2.1', ['第2讲']],
      ['练习 2.2', ['第2讲']],
    ])
  })
  it('列：类型（设过的照设的，没设的按值猜），算出来的', () => {
    expect(allColumns(ctx).map((c) => [c.id, c.type])).toEqual([
      ['file.name', 'title'],
      ['状态', 'status'],
      ['日期', 'date'],
      ['已看', 'number'],
      ['节数', 'number'],
      ['练习', 'relation'],
      ['做完几题', 'rollup'],
      ['formula.进度', 'formula'],
    ])
    expect(columnInfo(ctx, 'formula.进度')).toEqual({ id: 'formula.进度', label: '进度', type: 'formula', computed: true })
  })
  it('右栏一条：视图里的列在前，再是这一篇开头别的属性；公式、汇总写算出来的', () => {
    const f = recordFields(ctx, P('第3讲 生产'), 0)
    expect(f.map((x) => [x.col.label, x.cell.text, !!x.col.computed])).toEqual([
      ['状态', '在学', false],
      ['日期', '2026-11-17', false],
      ['进度', '50%', true],
      ['练习', '练习 3.1, 练习 3.2', false],
      ['做完几题', '1/2', true],
      ['已看', '2', false],
      ['节数', '4', false],
    ])
  })
  it('公式框：常用例子按这个库的列给；查写法用这个库的列名；前 4 条当场算', () => {
    expect(formulaExamples(ctx)).toEqual([
      { label: '进度百分比', expr: '(已看 / 节数 * 100).round() + "%"' },
      { label: '还差多少', expr: '节数 - 已看' },
      { label: '完成了吗', expr: 'if(已看 >= 节数, "完成", "还差 " + (节数 - 已看))' },
      { label: '离日期还有几天', expr: 'if(日期.isEmpty(), "", 日期 - today())' },
    ])
    expect(checkFormula('看过 / 节数', formulaScope(ctx))).toEqual({ ok: false, error: '认不出「看过」：没有这一列，也不是能用的函数', at: 0 })
    expect(checkFormula('if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")', formulaScope(ctx))).toEqual({ ok: true })
    expect(previewFormula(ctx, 'if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")', ctx.recs.slice(0, 4)).map((x) => x.cell.text)).toEqual(['学完', '学完', '还差 2 节', '还差 2 节'])
  })
  it('日历拖到另一天：带的钟点留着', () => {
    expect(dateMoved('2026-11-24', '2026-11-25')).toBe('2026-11-25')
    expect(dateMoved('2026-11-24 10:00', '2026-11-25')).toBe('2026-11-25 10:00')
  })
})
