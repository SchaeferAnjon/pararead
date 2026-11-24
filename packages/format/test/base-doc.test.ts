import { describe, expect, it } from 'vitest'
import {
  addView,
  dropBaseColumn,
  duplicateView,
  effectiveFilter,
  moveView,
  parseBaseDoc,
  relatedFolders,
  removeView,
  renameBaseColumn,
  renameBaseFormula,
  renameView,
  setFormula,
  setPropDef,
  setViewColSize,
  setViewDate,
  setViewFilter,
  setViewGroup,
  setViewImage,
  setViewOrder,
  setViewSort,
  setViewSummary,
  setViewType,
} from '../src/base-doc'
import { type BaseFilter, filterText, relDay } from '../src/base-filter'
import { ECP_BASE, HAND_BASE, ODD_BASE, OLD_BASE, OLD_OR_BASE } from './base-samples'
import { lineDiff } from './line-diff'

const NOT_DONE: BaseFilter = {
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

describe('读设计页那一块：五个视图、嵌套筛选、状态 / 关联 / 汇总、公式', () => {
  const doc = parseBaseDoc(ECP_BASE)
  it('数据源、公式、三种属性', () => {
    expect(doc.folder).toBe('课程/ecp/课程计划')
    expect(doc.shared).toBeNull()
    expect(doc.formulas).toEqual({ 进度: '(已看 / 节数 * 100).round() + "%"' })
    expect(doc.props).toEqual({
      状态: {
        type: 'status',
        groups: [
          { name: '待开始', options: ['未开始'] },
          { name: '进行中', options: ['在学'] },
          { name: '完成', options: ['学完'] },
        ],
      },
      练习: { type: 'relation', to: '课程/ecp/练习', twoWay: '所属讲' },
      做完几题: { type: 'rollup', via: '练习', prop: '做完', calc: 'checked/all' },
    })
    expect(relatedFolders(doc)).toEqual(['课程/ecp/练习'])
  })
  it('每个视图自己的看法、列、筛选、排序、分组、日期', () => {
    expect(doc.views.map((v) => [v.name, v.kind])).toEqual([
      ['全部', 'table'],
      ['看板', 'kanban'],
      ['日历', 'calendar'],
      ['画廊', 'cards'],
      ['没学完的', 'table'],
    ])
    expect(doc.views[0]!.columns).toEqual(['file.name', '状态', '日期', 'formula.进度', '练习', '做完几题'])
    expect(doc.views[1]!.groupBy).toEqual({ prop: '状态', desc: false })
    expect(doc.views[2]!.date).toBe('日期')
    expect(doc.views[3]!.image).toBeNull()
    expect(doc.views[4]!.filter).toEqual(NOT_DONE)
    expect(doc.views[4]!.sort).toEqual([{ prop: '日期', desc: false }])
    expect(effectiveFilter(doc, 4)).toEqual(NOT_DONE)
    expect(filterText(effectiveFilter(doc, 4)!, (c) => (c === '状态' ? 'status' : 'date'))).toBe('状态 不是 学完 且 （日期 早于 7天后 或 日期 为空）')
    expect(effectiveFilter(doc, 0)).toBeNull()
  })
})

describe('打开再保存不变：把读到的原样写回去，一个字节都不变', () => {
  for (const [name, src] of Object.entries({ 设计页那一块: ECP_BASE, 以前的写法: OLD_BASE, 以前的任一: OLD_OR_BASE, 手改过的: HAND_BASE, 带注释和别的写法: ODD_BASE })) {
    it(name, () => {
      const doc = parseBaseDoc(src)
      doc.views.forEach((v, i) => {
        expect(setViewFilter(src, i, effectiveFilter(doc, i)), `${v.name} 筛选`).toBe(src)
        expect(setViewSort(src, i, v.sort), `${v.name} 排序`).toBe(src)
        if (v.groupBy) expect(setViewGroup(src, i, v.groupBy), `${v.name} 分组`).toBe(src)
        expect(setViewOrder(src, i, v.columns), `${v.name} 列`).toBe(src)
        expect(renameView(src, i, v.name), `${v.name} 名字`).toBe(src)
        expect(setViewDate(src, i, v.date), `${v.name} 日期`).toBe(src)
        expect(setViewImage(src, i, v.image), `${v.name} 封面`).toBe(src)
        for (const [c, w] of Object.entries(v.sizes)) expect(setViewColSize(src, i, c, w)).toBe(src)
        for (const [c, s] of Object.entries(v.summaries)) expect(setViewSummary(src, i, c, s)).toBe(src)
      })
      for (const [k, f] of Object.entries(doc.formulas)) expect(setFormula(src, k, f), `公式 ${k}`).toBe(src)
      for (const [k, d] of Object.entries(doc.props)) expect(setPropDef(src, k, d), `列 ${k}`).toBe(src)
    })
  }
})

describe('只换那几行：每种改法 diff 只有动到的那几行', () => {
  const diff = (out: string) => lineDiff(ECP_BASE, out)
  it('视图改名只换 name 一行', () => {
    expect(diff(renameView(ECP_BASE, 4, '没看完的'))).toEqual({ removed: ['    name: 没学完的'], added: ['    name: 没看完的'] })
  })
  it('换排序方向只换 direction 一行；加一个排序只加两行', () => {
    expect(diff(setViewSort(ECP_BASE, 4, [{ prop: '日期', desc: true }]))).toEqual({ removed: ['        direction: ASC'], added: ['        direction: DESC'] })
    const two = setViewSort(ECP_BASE, 4, [
      { prop: '日期', desc: false },
      { prop: '状态', desc: true },
    ])
    expect(diff(two)).toEqual({ removed: [], added: ['      - property: 状态', '        direction: DESC'] })
  })
  it('筛选「改了就存」：给「全部」加一条，只加在这个视图里；别的视图一个字不动', () => {
    const out = setViewFilter(ECP_BASE, 0, { conj: 'and', items: [{ prop: '状态', op: '==', value: '在学' }] })
    expect(diff(out)).toEqual({ removed: [], added: ['    filters:', '      and:', '        - 状态 == "在学"'] })
    expect(parseBaseDoc(out).views[0]!.filter).toEqual({ conj: 'and', items: [{ prop: '状态', op: '==', value: '在学' }] })
    expect(out.indexOf('    filters:')).toBeGreaterThan(out.indexOf('      - 做完几题'))
  })
  it('组里改一句只换那一句；拿掉一组只拿掉那几行；去掉筛选拿掉整块', () => {
    const changed: BaseFilter = { conj: 'and', items: [NOT_DONE.items[0]!, { conj: 'or', items: [{ prop: '日期', op: '<=', value: relDay(30) }, { prop: '日期', op: 'empty', value: '' }] }] }
    expect(diff(setViewFilter(ECP_BASE, 4, changed))).toEqual({ removed: ['            - 日期 <= today() + "7d"'], added: ['            - 日期 <= today() + "30d"'] })
    expect(diff(setViewFilter(ECP_BASE, 4, { conj: 'and', items: [NOT_DONE.items[0]!] }))).toEqual({ removed: ['        - or:', '            - 日期 <= today() + "7d"', '            - 日期.isEmpty()'], added: [] })
    expect(diff(setViewFilter(ECP_BASE, 4, { conj: 'or', items: NOT_DONE.items }))).toEqual({ removed: ['      and:'], added: ['      or:'] })
    expect(diff(setViewFilter(ECP_BASE, 4, null)).removed).toEqual(['    filters:', '      and:', '        - 状态 != "学完"', '        - or:', '            - 日期 <= today() + "7d"', '            - 日期.isEmpty()'])
  })
  it('分组、日期、封面、看法', () => {
    expect(diff(setViewGroup(ECP_BASE, 1, { prop: '状态', desc: true }))).toEqual({ removed: ['      direction: ASC'], added: ['      direction: DESC'] })
    expect(diff(setViewGroup(ECP_BASE, 0, { prop: '状态', desc: false }))).toEqual({ removed: [], added: ['    groupBy:', '      property: 状态', '      direction: ASC'] })
    expect(diff(setViewGroup(ECP_BASE, 1, null))).toEqual({ removed: ['    groupBy:', '      property: 状态', '      direction: ASC'], added: [] })
    expect(diff(setViewDate(ECP_BASE, 2, '截止'))).toEqual({ removed: ['    date: 日期'], added: ['    date: 截止'] })
    expect(diff(setViewImage(ECP_BASE, 3, 'none'))).toEqual({ removed: [], added: ['    image: none'] })
    expect(diff(setViewType(ECP_BASE, 3, 'kanban', { groupBy: '状态' }))).toEqual({ removed: ['  - type: cards'], added: ['  - type: kanban', '    groupBy:', '      property: 状态', '      direction: ASC'] })
    expect(diff(setViewType(ECP_BASE, 0, 'calendar', { date: '日期' }))).toEqual({ removed: ['  - type: table'], added: ['  - type: calendar', '    date: 日期'] })
  })
  it('加一个视图加在最后、名字不重；复制紧跟在后面；删一个只拿掉那一段；换顺序', () => {
    const added = addView(ECP_BASE, { type: 'calendar', date: '日期', columns: ['file.name', '状态', '日期'] })
    expect(diff(added)).toEqual({ removed: [], added: ['  - type: calendar', '    name: 日历 2', '    order:', '      - file.name', '      - 状态', '      - 日期', '    date: 日期'] })
    expect(added.endsWith('    date: 日期')).toBe(true)
    const dup = duplicateView(ECP_BASE, 1)
    expect(parseBaseDoc(dup).views.map((v) => v.name)).toEqual(['全部', '看板', '看板 2', '日历', '画廊', '没学完的'])
    expect(diff(dup)).toEqual({ removed: [], added: ['  - type: kanban', '    name: 看板 2', '    groupBy:', '      property: 状态', '      direction: ASC'] })
    expect(diff(removeView(ECP_BASE, 2))).toEqual({ removed: ['  - type: calendar', '    name: 日历', '    date: 日期'], added: [] })
    expect(removeView('views:\n  - type: table\n    name: 只有一个', 0)).toBe('views:\n  - type: table\n    name: 只有一个')
    expect(parseBaseDoc(moveView(ECP_BASE, 4, 0)).views.map((v) => v.name)).toEqual(['没学完的', '全部', '看板', '日历', '画廊'])
    expect(parseBaseDoc(moveView(ECP_BASE, 0, 4)).views.map((v) => v.name)).toEqual(['看板', '日历', '画廊', '没学完的', '全部'])
  })
  it('公式：加一条只加一行；拿掉最后一条连 formulas 一起拿掉', () => {
    expect(diff(setFormula(ECP_BASE, '还差几节', '节数 - 已看'))).toEqual({ removed: [], added: ['  还差几节: 节数 - 已看'] })
    expect(diff(setFormula(ECP_BASE, '进度', null))).toEqual({ removed: ['formulas:', '  进度: (已看 / 节数 * 100).round() + "%"'], added: [] })
    expect(diff(setFormula(ECP_BASE, '学完了吗', 'if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")')).added).toEqual(['  学完了吗: if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")'])
    expect(diff(setFormula(ECP_BASE, '前缀', '"第" + 节数')).added).toEqual(['  前缀: \'"第" + 节数\''])
    expect(parseBaseDoc(setFormula(ECP_BASE, '前缀', '"第" + 节数')).formulas.前缀).toBe('"第" + 节数')
  })
  it('列的设置：状态加一个选项只换那一组；关联不写两边只拿掉 twoWay；新的一列加在 properties 最后', () => {
    const groups = [
      { name: '待开始', options: ['未开始'] },
      { name: '进行中', options: ['在学', '复习'] },
      { name: '完成', options: ['学完'] },
    ]
    expect(diff(setPropDef(ECP_BASE, '状态', { type: 'status', groups }))).toEqual({ removed: ['      进行中: [在学]'], added: ['      进行中: [在学, 复习]'] })
    expect(diff(setPropDef(ECP_BASE, '练习', { type: 'relation', to: '课程/ecp/练习', twoWay: null }))).toEqual({ removed: ['    twoWay: 所属讲'], added: [] })
    expect(diff(setPropDef(ECP_BASE, '做完几题', { type: 'rollup', via: '练习', prop: '做完', calc: 'count' }))).toEqual({ removed: ['    calc: checked/all'], added: ['    calc: count'] })
    expect(diff(setPropDef(ECP_BASE, '难度', { type: 'select' }))).toEqual({ removed: [], added: ['  难度:', '    type: select'] })
    const rel = setPropDef(ECP_BASE, '参考书', { type: 'relation', to: '阅读/书单', twoWay: '课程计划' })
    expect(diff(rel).added).toEqual(['  参考书:', '    type: relation', '    to: 阅读/书单', '    twoWay: 课程计划'])
    expect(parseBaseDoc(rel).props.参考书).toEqual({ type: 'relation', to: '阅读/书单', twoWay: '课程计划' })
    // 选项换成状态：type 换掉、groups 加上
    const st = setPropDef(setPropDef(ECP_BASE, '难度', { type: 'select' }), '难度', { type: 'status', groups })
    expect(parseBaseDoc(st).props.难度).toEqual({ type: 'status', groups })
    expect(setPropDef(setPropDef(ECP_BASE, '难度', { type: 'select' }), '难度', null)).toBe(ECP_BASE)
  })
  it('列改名：每个视图的列、排序、日期、筛选、汇总顺着的关联一起换，只动写着它的那几行', () => {
    const out = renameBaseColumn(ECP_BASE, '日期', '上课日')
    const d = diff(out)
    expect(d.removed.every((l) => l.includes('日期'))).toBe(true)
    expect(d.added.every((l) => l.includes('上课日'))).toBe(true)
    expect(d.removed.length).toBe(6)
    const doc = parseBaseDoc(out)
    expect(doc.views[2]!.date).toBe('上课日')
    expect(doc.views[4]!.sort).toEqual([{ prop: '上课日', desc: false }])
    expect(filterText(doc.views[4]!.filter!, () => 'date')).toBe('状态 不是 学完 且 （上课日 早于 7天后 或 上课日 为空）')
    const rel = parseBaseDoc(renameBaseColumn(ECP_BASE, '练习', '习题'))
    expect(rel.props.习题).toEqual({ type: 'relation', to: '课程/ecp/练习', twoWay: '所属讲' })
    expect(rel.props.做完几题).toEqual({ type: 'rollup', via: '习题', prop: '做完', calc: 'checked/all' })
    expect(rel.views[0]!.columns).toContain('习题')
    const f = parseBaseDoc(renameBaseColumn(setFormula(ECP_BASE, '还差几节', '节数 - 已看'), '节数', '总节数'))
    expect(f.formulas).toEqual({ 进度: '(已看 / 总节数 * 100).round() + "%"', 还差几节: '总节数 - 已看' })
  })
  it('公式改名：formulas 的键、视图里的 formula.旧名、别的公式里用到的', () => {
    const src = setFormula(ECP_BASE, '进度条', 'formula.进度 + "▮"')
    const out = renameBaseFormula(src, '进度', '完成度')
    const doc = parseBaseDoc(out)
    expect(doc.formulas).toEqual({ 完成度: '(已看 / 节数 * 100).round() + "%"', 进度条: 'formula.完成度 + "▮"' })
    expect(doc.views[0]!.columns).toContain('formula.完成度')
    expect(doc.views[4]!.columns).toContain('formula.完成度')
  })
  it('删一列：列、排序、日历的日期、用到它的筛选、设置都拿掉；公式列连公式一起删', () => {
    const doc = parseBaseDoc(dropBaseColumn(ECP_BASE, '日期'))
    expect(doc.views[0]!.columns).toEqual(['file.name', '状态', 'formula.进度', '练习', '做完几题'])
    expect(doc.views[2]!.date).toBeNull()
    expect(doc.views[4]!.sort).toEqual([])
    expect(doc.views[4]!.filter).toEqual({ conj: 'and', items: [{ prop: '状态', op: '!=', value: '学完' }] })
    const st = parseBaseDoc(dropBaseColumn(ECP_BASE, '状态'))
    expect(st.props.状态).toBeUndefined()
    expect(st.views[1]!.groupBy).toBeNull()
    const fx = parseBaseDoc(dropBaseColumn(ECP_BASE, 'formula.进度'))
    expect(fx.formulas).toEqual({})
    expect(fx.views[0]!.columns).toEqual(['file.name', '状态', '日期', '练习', '做完几题'])
  })
  it('列宽、表底计算：每个视图自己的', () => {
    expect(diff(setViewColSize(ECP_BASE, 2, '名字', 180))).toEqual({ removed: [], added: ['    columnSize:', '      名字: 180'] })
    expect(diff(setViewSummary(ECP_BASE, 0, '日期', 'Earliest'))).toEqual({ removed: [], added: ['    summaries:', '      日期: Earliest'] })
  })
})

describe('以前的写法：筛选在最外层（只有一个视图时表头上改的）', () => {
  it('读：那几条算所有视图都满足，视图上看到的是合在一起的', () => {
    const doc = parseBaseDoc(OLD_BASE)
    expect(doc.folder).toBe('读书/书单')
    expect(doc.shared).toEqual({ conj: 'and', items: [{ prop: '状态', op: '!=', value: '放弃' }, { prop: '评分', op: '>=', value: '8' }] })
    expect(effectiveFilter(doc, 0)).toEqual(doc.shared)
    expect(doc.props).toEqual({ 标签: { type: 'multi' } })
    expect(parseBaseDoc(OLD_OR_BASE).shared).toEqual({ conj: 'or', items: [{ prop: '状态', op: '==', value: '在读' }, { prop: '读完', op: 'days', value: '7' }] })
  })
  it('第一次在视图上改筛选：最外层只留数据源，条件挪进这个视图；别的视图也带上（照旧满足）', () => {
    const doc = parseBaseDoc(OLD_BASE)
    const next: BaseFilter = { conj: 'and', items: [...doc.shared!.items, { prop: '作者', op: 'contains', value: '明' }] }
    const out = setViewFilter(OLD_BASE, 0, next)
    expect(lineDiff(OLD_BASE, out)).toEqual({
      removed: ['    - 状态 != "放弃"', '    - 评分 >= 8'],
      added: ['    filters:', '      and:', '        - 状态 != "放弃"', '        - 评分 >= 8', '        - 作者.contains("明")'],
    })
    const after = parseBaseDoc(out)
    expect(after.shared).toBeNull()
    expect(after.folder).toBe('读书/书单')
    expect(effectiveFilter(after, 0)).toEqual(next)
    // 两个视图的老块：另一个视图也带上原来的条件
    const two = addView(OLD_BASE, { type: 'kanban', groupBy: '状态' })
    const moved = parseBaseDoc(setViewFilter(two, 1, null))
    expect(moved.views[0]!.filter).toEqual(doc.shared)
    expect(moved.views[1]!.filter).toBeNull()
  })
})

describe('手改过的块：四格缩进、不缩进的列表、注释、认不出的键都留着', () => {
  it('读得对', () => {
    const doc = parseBaseDoc(HAND_BASE)
    expect(doc.folder).toBe('读书/书单')
    expect(doc.formulas).toEqual({ 读了几天: 'if(读完.isEmpty(), "", 读完 - 开始)', '备 注': '"《" + file.name + "》"' })
    expect(doc.views[0]!.name).toBe('在读 #1')
    expect(doc.views[0]!.columns).toEqual(['file.name', '作者', '评 分'])
    expect(doc.views[0]!.filter).toEqual({ conj: 'or', items: [{ prop: '状态', op: '==', value: '在读' }, { prop: '读完', op: 'notempty', value: '' }, { raw: 'file.hasTag("书")' }] })
    expect(doc.views[1]!.kind).toBe('cards')
    expect(doc.views[1]!.image).toBe('none')
  })
  it('改一个视图：缩进照四格，注释、认不出的键、一行的列表照旧', () => {
    const out = setViewSort(HAND_BASE, 0, [{ prop: '作者', desc: false }])
    expect(lineDiff(HAND_BASE, out)).toEqual({ removed: [], added: ['      sort:', '      - property: 作者', '        direction: ASC'] })
    const cols = setViewOrder(HAND_BASE, 0, ['file.name', '评 分'])
    expect(lineDiff(HAND_BASE, cols)).toEqual({ removed: ['      order: [file.name, 作者, "评 分"]'], added: ['      order: [file.name, "评 分"]'] })
    const f = setViewFilter(HAND_BASE, 0, { conj: 'or', items: [{ prop: '状态', op: '==', value: '在读' }, { raw: 'file.hasTag("书")' }] })
    expect(lineDiff(HAND_BASE, f)).toEqual({ removed: ["          - '!读完.isEmpty()'"], added: [] })
    expect(parseBaseDoc(renameView(HAND_BASE, 1, '书的封面')).views[1]!.name).toBe('书的封面')
    expect(lineDiff(HAND_BASE, renameView(HAND_BASE, 0, '在读 #2'))).toEqual({ removed: ["      name: '在读 #1'"], added: ["      name: '在读 #2'"] })
  })
  it('认不出的看法（别的软件的 list）当表格画，type 照写；not 组、套两层的筛选读得出、面板上不改', () => {
    const doc = parseBaseDoc(ODD_BASE)
    expect(doc.folder).toBe('项目/住宿')
    expect(doc.views[0]!.groupBy).toEqual({ prop: '城市', desc: false })
    expect(doc.views[0]!.filter?.conj).toBe('not')
    expect(doc.views[1]).toMatchObject({ type: 'list', kind: 'table', name: '别的软件的看法' })
    expect(lineDiff(ODD_BASE, setViewGroup(ODD_BASE, 0, { prop: '国家', desc: false }))).toEqual({ removed: ['    groupBy: 城市   # 一个字的写法'], added: ['    groupBy: 国家   # 一个字的写法'] })
  })
})

describe('没写 views 的块、空块', () => {
  it('读成一个「表格」；改它时先把 views 写出来', () => {
    const src = 'filters:\n  and:\n    - file.inFolder("x")'
    expect(parseBaseDoc(src).views.map((v) => v.name)).toEqual(['表格'])
    expect(setViewSort(src, 0, [{ prop: '日期', desc: false }])).toBe(src + '\nviews:\n  - type: table\n    name: 表格\n    sort:\n      - property: 日期\n        direction: ASC')
    expect(addView('', { type: 'kanban', groupBy: '状态' })).toBe('views:\n  - type: table\n    name: 表格\n  - type: kanban\n    name: 看板\n    groupBy:\n      property: 状态\n      direction: ASC')
    expect(parseBaseDoc('').views).toHaveLength(1)
  })
})
