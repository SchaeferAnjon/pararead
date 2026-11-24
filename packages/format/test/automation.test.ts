/**
 * 自动化的写法（automation.ts）和跑起来要的纯函数（automation-run.ts）。
 * 打开再保存不变：读不改字，原样写回一个字不变；开关只换 on: false 一行，改一步只换那一步，加一条接在最后。
 */
import { describe, expect, it } from 'vitest'
import {
  type AutoRule,
  type ButtonDef,
  baseBlocks,
  defaultLibRules,
  flowScalar,
  flowText,
  libDoc,
  parseAutomations,
  parseFlow,
  parseLibrary,
  removeAutomation,
  removeLibRule,
  replaceBaseBlock,
  setAutomation,
  setButton,
  setLibRule,
  toggleAutomation,
  toggleLibRule,
} from '../src/automation'
import {
  autoAsk,
  autoParse,
  baseWhere,
  checkRule,
  dateFireAt,
  fieldChanges,
  fillTemplate,
  isoWeekOf,
  logLine,
  logPathOf,
  minuteOf,
  nextSlot,
  parseLog,
  parseWhere,
  rowVars,
  ruleSentence,
  ruleStats,
  slotsIn,
  timeVars,
  undoneIds,
  weekdayOf,
  whenFits,
  type AutoLogEntry,
  type AutoScope,
} from '../src/automation-run'
import { parseBaseDoc, setPropDef, setViewSort } from '../src/base-doc'
import { ACCOUNT_BASE, ACCOUNT_DOC, HAND_AUTO_BASE, LIB_DOC } from './automation-samples'
import { lineDiff } from './line-diff'

const local = (s: string) => new Date(s)

describe('一行的 {…}、[…]', () => {
  it('读：映射、列表、套着的、圆括号和引号里的逗号不拆', () => {
    expect(parseFlow('{added: true}')).toEqual({ added: 'true' })
    expect(parseFlow('[{added: true}, {changed: 分类, to: 报销}]')).toEqual([{ added: 'true' }, { changed: '分类', to: '报销' }])
    expect(parseFlow('{copy: [名字, 金额, 分类, 收支], set: {日期: today()}}')).toEqual({ copy: ['名字', '金额', '分类', '收支'], set: { 日期: 'today()' } })
    expect(parseFlow('{every: month, day: last, at: "21:00"}')).toEqual({ every: 'month', day: 'last', at: '21:00' })
    expect(parseFlow('{and: [收支 == "支出", 金额 > 500]}')).toEqual({ and: ['收支 == "支出"', '金额 > 500'] })
    expect(parseFlow('{x: if(a == "1, 2", b, ""), y: \'it\'\'s\'}')).toEqual({ x: 'if(a == "1, 2", b, "")', y: "it's" })
    expect(parseFlow('{a: 1')).toBeNull()
    expect(parseFlow('{a: 1} x')).toBeNull()
  })
  it('写：会读歪的加引号，钟点加引号，读回来一样', () => {
    expect(flowScalar('21:00')).toBe('"21:00"')
    expect(flowScalar('{{年}}-W{{周}}')).toBe('"{{年}}-W{{周}}"')
    expect(flowScalar('today()')).toBe('today()')
    expect(flowScalar('a, b')).toBe('"a, b"')
    const y = { newNote: { folder: '周记', name: '{{年}}-W{{周}}', template: '周记/模板.md', ifExists: 'keep' } }
    expect(flowText(y.newNote)).toBe('{folder: 周记, name: "{{年}}-W{{周}}", template: 周记/模板.md, ifExists: keep}')
    expect(parseFlow(flowText(y))).toEqual(y)
  })
})

describe('读：设计页记账那一块', () => {
  const rules = parseAutomations(ACCOUNT_BASE)
  it('三条规则：当、如果、就', () => {
    expect(rules.map((r) => r.name)).toEqual(['自动猜分类', '交报销单', '月底写账单摘要'])
    expect(rules[0]).toEqual({
      name: '自动猜分类',
      on: true,
      when: [{ on: 'added' }],
      if: { conj: 'and', items: [{ prop: '分类', op: 'empty', value: '' }] },
      missed: null,
      do: [{ do: 'ai', ai: 'cell', prop: '分类', prompt: '照名字猜是哪一类，只从已有的分类里选' }],
    })
    expect(rules[1]!.when).toEqual([{ on: 'changed', prop: '分类', to: '报销' }])
    expect(rules[1]!.do).toEqual([{ do: 'todo', text: '交报销单：{{名字}} {{金额}}', file: '生活/待办.md', date: '下周一 9:00' }])
    expect(rules[2]!.when).toEqual([{ on: 'every', every: 'month', day: 'last', at: '21:00' }])
    expect(rules[2]!.missed).toBe('once')
    expect(rules[2]!.do).toEqual([{ do: 'ai', ai: 'summary', prompt: '', rows: '日期.month == today().month', folder: '生活/记账/账单摘要' }])
  })
  it('按钮列是 properties 里 type: button 的一列，do 和自动化同一套', () => {
    const doc = parseBaseDoc(ACCOUNT_BASE)
    expect(doc.props['再记一笔']).toEqual({
      type: 'button',
      do: [{ do: 'newRow', copy: ['名字', '金额', '分类', '收支'], set: { 日期: 'today()' } }, { do: 'open' }],
    })
  })
  it('手改过的：几种「当」并在一起、多句的「如果」、关掉的、认不出的一步原样留着', () => {
    const [big, due] = parseAutomations(HAND_AUTO_BASE)
    expect(big!.when).toEqual([{ on: 'added' }, { on: 'changed', prop: '金额' }])
    expect(big!.if).toEqual({ conj: 'and', items: [{ prop: '收支', op: '==', value: '支出' }, { prop: '金额', op: '>', value: '500' }] })
    expect(big!.do[1]).toEqual({ do: 'unknown', key: 'webhook', raw: { webhook: 'https://example.invalid/hook' } })
    expect(due!.on).toBe(false)
    expect(due!.when).toEqual([{ on: 'date', prop: '截止', before: 1, at: '9:00' }])
    expect(due!.do[0]).toEqual({ do: 'todo', text: '{{名字}} 明天到期', date: '明天 9:00' })
  })
})

describe('写：打开再保存不变、只换那几行', () => {
  for (const [name, src] of [
    ['记账', ACCOUNT_BASE],
    ['手改过的', HAND_AUTO_BASE],
  ] as [string, string][]) {
    it(`${name}：每一条原样写回一个字不变；按钮列原样写回不变`, () => {
      const rules = parseAutomations(src)
      let out = src
      rules.forEach((r, i) => (out = setAutomation(out, i, r)))
      expect(out).toBe(src)
      for (const [k, d] of Object.entries(parseBaseDoc(src).props)) out = setPropDef(out, k, d)
      expect(out).toBe(src)
    })
  }
  it('开关只换那一条的 on: false 一行；打开回到原样', () => {
    const off = toggleAutomation(ACCOUNT_BASE, 1, false)
    expect(lineDiff(ACCOUNT_BASE, off)).toEqual({ removed: [], added: ['    on: false'] })
    expect(off).toContain('  - name: 交报销单\n    on: false\n    when:')
    expect(parseAutomations(off)[1]!.on).toBe(false)
    expect(toggleAutomation(off, 1, true)).toBe(ACCOUNT_BASE)
    // 手改过的那条本来关着：打开只拿掉那一行，注释、认不出的键都在
    const on = toggleAutomation(HAND_AUTO_BASE, 1, true)
    expect(lineDiff(HAND_AUTO_BASE, on)).toEqual({ removed: ['      on: false'], added: [] })
  })
  it('改一步只换那一步那一行；别的规则、按钮、视图不动', () => {
    const r = parseAutomations(ACCOUNT_BASE)[0]!
    const next = setAutomation(ACCOUNT_BASE, 0, { ...r, do: [{ ...(r.do[0] as Extract<AutoRule['do'][number], { do: 'ai' }>), prompt: '照名字猜分类' }] })
    expect(lineDiff(ACCOUNT_BASE, next)).toEqual({ removed: ['        prompt: 照名字猜是哪一类，只从已有的分类里选'], added: ['        prompt: 照名字猜分类'] })
  })
  it('改「当」「如果」：只换那一行；手改的行尾注释、认不出的 color 留着', () => {
    const [big] = parseAutomations(HAND_AUTO_BASE)
    const next = setAutomation(HAND_AUTO_BASE, 0, { ...big!, if: { conj: 'and', items: [{ prop: '金额', op: '>', value: '1000' }] } })
    expect(lineDiff(HAND_AUTO_BASE, next)).toEqual({ removed: ['      if: {and: [收支 == "支出", 金额 > 500]}'], added: ['      if: 金额 > 1000'] })
    const w = setAutomation(HAND_AUTO_BASE, 0, { ...big!, when: [{ on: 'added' }] })
    expect(lineDiff(HAND_AUTO_BASE, w)).toEqual({ removed: ['      when: [{added: true}, {changed: 金额}]   # 新加或者改了金额'], added: ['      when: {added: true}   # 新加或者改了金额'] })
    expect(w).toContain('color: red')
    expect(w).toContain('webhook: https://example.invalid/hook')
  })
  it('加一条接在最后（照设计页的样子），删掉回到原样；删光连 automations: 一起拿掉', () => {
    const rule: AutoRule = {
      name: '大额支出提醒',
      on: true,
      when: [{ on: 'added' }, { on: 'changed', prop: '金额' }],
      if: { conj: 'and', items: [{ prop: '收支', op: '==', value: '支出' }, { prop: '金额', op: '>', value: '500' }] },
      missed: null,
      do: [{ do: 'notify', text: '这笔有点大：{{名字}} {{金额}}' }],
    }
    const added = setAutomation(ACCOUNT_BASE, null, rule)
    expect(added).toBe(
      ACCOUNT_BASE +
        '\n  - name: 大额支出提醒\n    when: [{added: true}, {changed: 金额}]\n    if: {and: [收支 == "支出", 金额 > 500]}\n    do:\n      - notify: 这笔有点大：{{名字}} {{金额}}',
    )
    expect(parseAutomations(added)[3]).toEqual(rule)
    expect(removeAutomation(added, 3)).toBe(ACCOUNT_BASE)
    let src = ACCOUNT_BASE
    for (let i = 2; i >= 0; i--) src = removeAutomation(src, i)
    expect(src).not.toContain('automations')
    expect(src).toBe(ACCOUNT_BASE.slice(0, ACCOUNT_BASE.indexOf('\nautomations:')))
  })
  it('还没有 automations 的块：加在最后一段；以后加视图、列的类型插在它前面', () => {
    const src = 'filters:\n  and:\n    - file.inFolder("书")\nviews:\n  - type: table\n    name: 表格'
    const r: AutoRule = { name: '读完了', on: true, when: [{ on: 'changed', prop: '状态', to: '读完' }], if: null, missed: null, do: [{ do: 'set', values: { 读完: 'today()' } }] }
    const out = setAutomation(src, null, r)
    expect(out).toBe(src + '\nautomations:\n  - name: 读完了\n    when: {changed: 状态, to: 读完}\n    do:\n      - set: {读完: today()}')
    const typed = setPropDef(out, '状态', { type: 'select' })
    expect(typed.indexOf('properties:')).toBeLessThan(typed.indexOf('automations:'))
    const bare = setPropDef('filters:\n  and:\n    - file.inFolder("书")\n' + out.slice(out.indexOf('automations:')), '状态', { type: 'select' })
    expect(bare.indexOf('properties:')).toBeLessThan(bare.indexOf('automations:'))
    const viewed = setViewSort('filters:\n  and:\n    - file.inFolder("书")\n' + out.slice(out.indexOf('automations:')), 0, [{ prop: '日期', desc: false }])
    expect(viewed.indexOf('views:')).toBeLessThan(viewed.indexOf('automations:'))
  })
  it('按钮列：新加一列、改一步、拿掉', () => {
    const src = 'filters:\n  and:\n    - file.inFolder("生活/账目")\nviews:\n  - type: table\n    name: 表格'
    const out = setButton(src, '交了', [{ do: 'set', values: { 分类: '已报销' } }, { do: 'notify', text: '交了 {{名字}}' }])
    expect(out).toBe('filters:\n  and:\n    - file.inFolder("生活/账目")\nproperties:\n  交了:\n    type: button\n    do:\n      - set: {分类: 已报销}\n      - notify: 交了 {{名字}}\nviews:\n  - type: table\n    name: 表格')
    expect(parseBaseDoc(out).props['交了']).toEqual({ type: 'button', do: [{ do: 'set', values: { 分类: '已报销' } }, { do: 'notify', text: '交了 {{名字}}' }] })
    const changed = setButton(out, '交了', [{ do: 'set', values: { 分类: '已报销' } }, { do: 'ask', text: '真的交了吗？' }])
    expect(lineDiff(out, changed)).toEqual({ removed: ['      - notify: 交了 {{名字}}'], added: ['      - ask: 真的交了吗？'] })
    expect(setButton(out, '交了', null)).toBe(src)
    expect(setButton(ACCOUNT_BASE, '再记一笔', (parseBaseDoc(ACCOUNT_BASE).props['再记一笔'] as ButtonDef).do)).toBe(ACCOUNT_BASE)
  })
})

describe('库里的 .canvas-notes/自动化.md', () => {
  it('没有这个文件：软件自带的周记（关着、周日 20:00）和整理收件箱（关着），设置里打开才跑', () => {
    const r = parseLibrary(null)
    expect(r.map((x) => [x.name, x.on])).toEqual([
      ['周记', false],
      ['整理收件箱', false],
    ])
    expect(parseLibrary(libDoc(defaultLibRules()))).toEqual(defaultLibRules())
  })
  it('设计页那一段：读得出、原样写回不变；开关只换一行', () => {
    const rules = parseLibrary(LIB_DOC)
    expect(rules[0]!.do[0]).toEqual({ do: 'newNote', folder: '周记', name: '{{年}}-W{{周}}', template: '周记/模板.md', ifExists: 'keep' })
    let out = LIB_DOC
    rules.forEach((r, i) => (out = setLibRule(out, i, r)))
    expect(out).toBe(LIB_DOC)
    const off = toggleLibRule(LIB_DOC, 0, false)
    expect(lineDiff(LIB_DOC, off)).toEqual({ removed: [], added: ['  on: false'] })
    expect(toggleLibRule(off, 0, true)).toBe(LIB_DOC)
  })
  it('还没有文件时改一条：照自带的建出来再改；加一条、删一条', () => {
    const md = toggleLibRule(null, 1, true)
    expect(parseLibrary(md).map((r) => r.on)).toEqual([false, true])
    const r: AutoRule = { name: '每天提醒记账', on: true, when: [{ on: 'every', every: 'day', at: '21:30' }], if: null, missed: 'skip', do: [{ do: 'todo', text: '记今天的账', file: '生活/待办.md', date: '今天 21:30' }] }
    const added = setLibRule(md, null, r)
    expect(parseLibrary(added)[2]).toEqual(r)
    expect(removeLibRule(added, 2)).toBe(md)
  })
})

describe('一篇里的 base 块', () => {
  it('第几个、从哪到哪；换掉一块只动那一块', () => {
    const doc = ACCOUNT_DOC + '\n```base\nfilters: x\n```\n'
    const bs = baseBlocks(doc)
    expect(bs.map((b) => b.index)).toEqual([0, 1])
    expect(bs[0]!.src).toBe(ACCOUNT_BASE)
    expect(replaceBaseBlock(doc, 1, 'filters: y')).toBe(ACCOUNT_DOC + '\n```base\nfilters: y\n```\n')
    expect(replaceBaseBlock(doc, 0, ACCOUNT_BASE)).toBe(doc)
  })
})

describe('什么时候跑', () => {
  it('钟点、星期几', () => {
    expect(minuteOf('21:00')).toBe(21 * 60)
    expect(minuteOf('9:05')).toBe(9 * 60 + 5)
    expect(minuteOf('晚上 9 点')).toBe(21 * 60)
    expect(minuteOf('25:00')).toBeNull()
    expect([weekdayOf('日'), weekdayOf('周一'), weekdayOf('星期六'), weekdayOf('sun'), weekdayOf('7')]).toEqual([0, 1, 6, 0, 0])
  })
  it('定时：每周日 20:00、每月最后一天 21:00、每天；(from, to] 里的那几次', () => {
    const week = { on: 'every' as const, every: 'week' as const, day: '日', at: '20:00' }
    expect(slotsIn(week, local('2026-11-16T00:00'), local('2026-11-30T23:00')).map((d) => d.toString())).toEqual([local('2026-11-22T20:00').toString(), local('2026-11-29T20:00').toString()])
    expect(slotsIn(week, local('2026-11-22T20:00'), local('2026-11-22T21:00'))).toEqual([])
    const month = { on: 'every' as const, every: 'month' as const, day: 'last', at: '21:00' }
    expect(slotsIn(month, local('2026-01-01T00:00'), local('2026-03-31T22:00')).map((d) => d.getDate())).toEqual([31, 28, 31])
    expect(slotsIn({ on: 'every', every: 'month', day: '31', at: '9:00' }, local('2026-02-01T00:00'), local('2026-02-28T10:00')).map((d) => d.getDate())).toEqual([28])
    expect(slotsIn({ on: 'every', every: 'day', at: '08:00' }, local('2026-11-20T09:00'), local('2026-11-22T09:00'))).toHaveLength(2)
    expect(nextSlot(week, local('2026-11-22T20:30'))!.toString()).toBe(local('2026-11-29T20:00').toString())
  })
  it('到了某一列的日子：提前几天、几点；值里带钟点、不写 at 用那个钟点', () => {
    expect(dateFireAt({ on: 'date', prop: '截止', before: 1, at: '9:00' }, '2026-11-30')!.toString()).toBe(local('2026-11-29T09:00').toString())
    expect(dateFireAt({ on: 'date', prop: '截止' }, '2026-11-30 14:30')!.toString()).toBe(local('2026-11-30T14:30').toString())
    expect(dateFireAt({ on: 'date', prop: '截止' }, '')).toBeNull()
  })
  it('一条改了什么、合不合「当」', () => {
    const before = '---\n分类: 外卖\n金额: 41\nAI填的: [分类]\n---\n正文'
    const after = '---\n分类: 报销\n金额: 41\nAI填的: []\n---\n正文改了'
    expect(fieldChanges(before, after)).toEqual({ 分类: { from: '外卖', to: '报销' } })
    const ev = { kind: 'changed' as const, path: '生活/账目/外卖.md', changes: fieldChanges(before, after) }
    expect(whenFits({ on: 'changed', prop: '分类', to: '报销' }, ev, '外卖')).toBe('「外卖」的「分类」改成了「报销」')
    expect(whenFits({ on: 'changed', prop: '分类' }, ev, '外卖')).toBe('「外卖」的「分类」改成了「报销」')
    expect(whenFits({ on: 'changed', prop: '金额' }, ev, '外卖')).toBeNull()
    expect(whenFits({ on: 'changed', prop: '分类', to: '餐饮' }, ev, '外卖')).toBeNull()
    expect(whenFits({ on: 'added' }, { kind: 'added', path: 'x.md' }, '机场打车')).toBe('新加了「机场打车」')
    expect(whenFits({ on: 'added' }, ev, '外卖')).toBeNull()
  })
})

describe('模板、一句话', () => {
  it('ISO 周：2026-11-22 是 2026-W47（11月16日到22日）；跨年的 2027-01-01 是 2026-W53', () => {
    expect(timeVars(local('2026-11-22T20:00'))).toMatchObject({ 年: '2026', 周: '47', 周一: '11月16日', 周日: '11月22日', 今天: '2026-11-22' })
    expect(isoWeekOf(local('2027-01-01T12:00'))).toMatchObject({ year: 2026, week: 53 })
    expect(fillTemplate('{{年}}-W{{周}}', timeVars(local('2026-11-22T20:00')))).toBe('2026-W47')
  })
  it('{{名字}} {{金额}} 换成这一条的值，没有的换成空字', () => {
    const vars = rowVars('生活/账目/外卖.md', '---\n金额: 41\n标签: [a, b]\n---\n')
    expect(fillTemplate('交报销单：{{名字}} {{金额}} {{标签}} {{没有}}', vars)).toBe('交报销单：外卖 41 a、b ')
  })
  it('一条写成一句（照原型）', () => {
    const [guess, reimb, month] = parseAutomations(ACCOUNT_BASE)
    expect(ruleSentence(guess!)).toBe('当 新加一条 · 如果 分类 为空 · 就 AI 写「分类」这一格')
    expect(ruleSentence(reimb!)).toBe('当 「分类」改成「报销」 · 就 加一条待办「交报销单：名字 金额」')
    expect(ruleSentence(month!)).toBe('当 每月最后一天 21:00 · 就 AI 写摘要（读合条件的几条）')
    expect(ruleSentence(parseLibrary(null)[0]!)).toBe('当 每周日 20:00 · 就 新建「周记/{{年}}-W{{周}}」，再 运行 /写这周的周记，再 发通知「这周的周记建好了」，再 加一条待办「写周记 [[新建的那篇]]」'.replace('{{年}}-W{{周}}', '年-W周'))
  })
})

const ACCOUNT_SCOPE: AutoScope = {
  kind: 'base',
  columns: [
    { name: '日期', type: 'date' },
    { name: '金额', type: 'number' },
    { name: '分类', type: 'select', options: ['餐饮', '交通', '报销'] },
    { name: '收支', type: 'select', options: ['收入', '支出'] },
  ],
}

describe('检查一条规则', () => {
  it('设计页三条都没问题；库里自带的没问题', () => {
    for (const r of parseAutomations(ACCOUNT_BASE)) expect(checkRule(r, ACCOUNT_SCOPE), r.name).toEqual([])
    for (const r of defaultLibRules()) expect(checkRule(r, { kind: 'library', columns: [] }), r.name).toEqual([])
  })
  it('没有的列、钟点写错、只给按钮的一步、重名、库里写「新加一条」', () => {
    const bad: AutoRule = { name: '交报销单', on: true, when: [{ on: 'changed', prop: '类别' }, { on: 'every', every: 'day', at: '25:00' }], if: null, missed: null, do: [{ do: 'open' }, { do: 'set', values: { 状态: '好' } }] }
    expect(checkRule(bad, { ...ACCOUNT_SCOPE, names: ['交报销单'] })).toEqual(['已经有一条叫「交报销单」', '没有「类别」这一列', '「25:00」认不出是几点', '「在右栏打开它」只给按钮用', '没有「状态」这一列'])
    expect(checkRule({ ...bad, name: 'x', when: [{ on: 'added' }], do: [{ do: 'notify', text: 'hi' }] }, { kind: 'library', columns: [] })).toEqual(['库里的规则只能定时（「新加一条」要写在数据库里）'])
    const hand = parseAutomations(HAND_AUTO_BASE)[0]!
    expect(checkRule(hand, ACCOUNT_SCOPE)).toEqual(['认不出的一步「webhook」'])
  })
})

describe('一句话 → 规则（方向 B）', () => {
  it('交给 AI 的话：头一行认得出、列和选项都在', () => {
    const q = autoAsk('分类改成报销就提醒我下周一交报销单', ACCOUNT_SCOPE, '2026-11-22')
    expect(q.prompt.split('\n')[0]).toBe('命令：自动化规则')
    expect(q.prompt).toContain('- 分类（select：餐饮、交通、报销）')
    expect(q.prompt).toContain('分类改成报销就提醒我下周一交报销单')
  })
  it('认回答：```yaml 块里一条；没有「当」「就」给一句错；列不对列出问题', () => {
    const ok = autoParse('好的：\n```yaml\n- name: 交报销单\n  when: {changed: 分类, to: 报销}\n  do:\n    - todo: 交报销单：{{名字}} {{金额}}\n      date: 下周一 9:00\n```', ACCOUNT_SCOPE)
    expect(ok).toEqual({ rule: { name: '交报销单', on: true, when: [{ on: 'changed', prop: '分类', to: '报销' }], if: null, missed: null, do: [{ do: 'todo', text: '交报销单：{{名字}} {{金额}}', date: '下周一 9:00' }] }, problems: [] })
    expect(autoParse('我不知道', ACCOUNT_SCOPE)).toEqual({ error: 'AI 这次没填出规则，换个说法再试一次' })
    expect(autoParse('```yaml\n- name: x\n  do:\n    - notify: hi\n```', ACCOUNT_SCOPE)).toEqual({ error: 'AI 没认出「当什么时候」，说清楚一点再试一次' })
    const wrong = autoParse('```yaml\nname: x\nwhen: {changed: 类别}\ndo:\n  - notify: hi\n```', ACCOUNT_SCOPE)
    expect('problems' in wrong && wrong.problems).toEqual(['没有「类别」这一列'])
  })
})

describe('记录', () => {
  const e = (o: Partial<AutoLogEntry>): AutoLogEntry => ({ id: 'a', t: '2026-11-21T08:40:00', rule: '自动猜分类', where: baseWhere('生活/2026 记账.md'), by: 'auto', why: '', did: [], files: [], commit: null, ok: true, undoable: true, ...o })
  it('一月一份；坏行跳过；跑过几次、上次几点、最后一次出错', () => {
    expect(logPathOf(local('2026-11-22T10:00'))).toBe('.canvas-notes/自动化记录/2026-11.jsonl')
    const text = [e({ id: '1' }), e({ id: '2', t: '2026-11-22T09:00:00' }), e({ id: '3', t: '2026-11-22T10:00:00', ok: false, error: 'AI 没答' })].map(logLine).join('\n') + '\n{"半行'
    const log = parseLog(text)
    expect(log.map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(ruleStats(log, baseWhere('生活/2026 记账.md'), '自动猜分类')).toEqual({ runs: 2, last: '2026-11-22T10:00:00', error: 'AI 没答' })
    const undone = [...log, e({ id: '4', t: '2026-11-22T11:00:00', undo: '2' })]
    expect([...undoneIds(undone)]).toEqual(['2'])
    expect(ruleStats(undone, baseWhere('生活/2026 记账.md'), '自动猜分类').runs).toBe(2)
  })
  it('在哪：库里是 lib，数据库是「文档#第几块」', () => {
    expect(parseWhere(baseWhere('生活/2026 记账.md', 1))).toEqual({ doc: '生活/2026 记账.md', block: 1 })
    expect(parseWhere('lib')).toBeNull()
  })
})
