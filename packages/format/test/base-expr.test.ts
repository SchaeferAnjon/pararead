import { describe, expect, it } from 'vitest'
import { checkFormula, durationOf, evalExpr, type ExprEnv, exprRef, exprRefs, parseExpr, renameRef, shiftDate, sortCmp, type Val, valEq, valText } from '../src/base-expr'

/** 一篇笔记的值（第3讲：已看 2、节数 4、日期 11月17日），今天 2026-11-22 */
function env(vals: Record<string, Val>, formulas: Record<string, string> = {}): ExprEnv {
  const e: ExprEnv = {
    get: (name, how) => {
      if (how !== 'note' && Object.hasOwn(formulas, name)) return run(formulas[name]!, e).value
      if (how === 'formula') return null
      return Object.hasOwn(vals, name) ? vals[name]! : null
    },
    file: { name: '第3讲 生产', path: '课程/ecp/课程计划/第3讲 生产.md', folder: '课程/ecp/课程计划', tags: ['经济'] },
    today: '2026-11-22',
  }
  return e
}
const run = (src: string, e: ExprEnv) => evalExpr(parseExpr(src), e)
const L3 = { 已看: 2, 节数: 4, 日期: { date: '2026-11-17' }, 状态: '在学', 练习: ['[[练习 3.1]]', '[[练习 3.2]]'] }
const text = (src: string, vals: Record<string, Val> = L3, f?: Record<string, string>) => valText(run(src, env(vals, f)).value)

describe('公式：写列名，和筛选同一种写法（设计页「常用」那四条）', () => {
  it('进度百分比、还差几节、学完了吗、离上课还有几天', () => {
    expect(text('(已看 / 节数 * 100).round() + "%"')).toBe('50%')
    expect(text('节数 - 已看')).toBe('2')
    expect(text('if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")')).toBe('还差 2 节')
    expect(text('if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")', { 已看: 3, 节数: 3 })).toBe('学完')
    // 第4讲 11月24日：还有 2 天；第7讲没排日子：空
    expect(text('if(日期.isEmpty(), "", 日期 - today())', { 日期: { date: '2026-11-24' } })).toBe('2')
    expect(text('if(日期.isEmpty(), "", 日期 - today())', { 日期: null })).toBe('')
  })

  it('四则、取余、小数最多两位、比较、且或非、if 只算选中的那一边', () => {
    expect(text('1 + 2 * 3 - 4 / 2')).toBe('5')
    expect(text('7 % 3')).toBe('1')
    expect(text('10 / 3')).toBe('3.33')
    expect(text('已看 > 1 && !(节数 < 4) || false')).toBe('是')
    expect(text('-已看 + 1')).toBe('-1')
    expect(text('if(节数 == 0, "没课", 已看 / 节数)', { 已看: 1, 节数: 0 })).toBe('没课')
    expect(text('round(2.345, 2)')).toBe('2.35')
    expect(text('(1 / 3).toFixed(1)')).toBe('0.3')
    expect(text('min(3, 节数, 9)')).toBe('3')
    expect(text('max(日期, date("2026-12-01"))')).toBe('2026-12-01')
  })

  it('字：接起来、长度、包含（不分大小写）、列表包含其中一项', () => {
    expect(text('状态 + "中"')).toBe('在学中')
    expect(text('"第" + 3 + "讲"')).toBe('第3讲')
    expect(text('状态.length')).toBe('2')
    expect(text('"Hello".lower().contains("ell")')).toBe('是')
    expect(text('练习.contains("练习 3.2")')).toBe('是')
    expect(text('练习.length')).toBe('2')
    expect(text('练习')).toBe('练习 3.1, 练习 3.2')
    expect(text('file.name + " · " + file.folder')).toBe('第3讲 生产 · 课程/ecp/课程计划')
    expect(text('file.inFolder("课程/ecp") && file.hasTag("#经济")')).toBe('是')
  })

  it('日期：减日期是差几天；加减 "7d" "2w" "1M" "1y" 和几天；月底挪一个月落在下个月最后一天', () => {
    expect(text('today() + "7d"')).toBe('2026-11-29')
    expect(text('today() - "2w"')).toBe('2026-11-08')
    expect(text('date("2026-01-31") + "1M"')).toBe('2026-02-28')
    expect(text('today() + "1y"')).toBe('2027-11-22')
    expect(text('日期 + 3')).toBe('2026-11-20')
    expect(text('today() - 日期')).toBe('5')
    expect(text('日期.month + "月" + 日期.day + "日"')).toBe('11月17日')
    expect(shiftDate('2024-02-29', 1, 'y')).toBe('2025-02-28')
    expect(durationOf('7天')).toEqual({ n: 7, unit: 'd' })
    expect(durationOf('7 days')).toEqual({ n: 7, unit: 'd' })
    expect(durationOf('七天')).toBeNull()
  })

  it('空的值：算术给空、接字当空字、比较不成立', () => {
    expect(run('已看 / 节数', env({ 已看: 1, 节数: null })).value).toBeNull()
    expect(text('(已看 / 节数 * 100).round() + "%"', { 已看: 1, 节数: null })).toBe('%')
    expect(text('已看 > 0', { 已看: null })).toBe('否')
    expect(text('已看 == ""', { 已看: null })).toBe('是')
  })

  it('中文输入法打的括号、逗号、引号、≥ 也认', () => {
    expect(text('if（已看 ≥ 节数，“学完”，“没学完”）')).toBe('没学完')
    expect(text('节数 × 2 ÷ 4')).toBe('2')
  })
})

describe('公式写错：一句中文说哪里错，不抛', () => {
  const scope = { columns: ['名字', '状态', '日期', '已看', '节数', '练习', '做完几题'], formulas: { 进度: '(已看 / 节数 * 100).round() + "%"' } }
  const err = (src: string, self?: string) => {
    const r = checkFormula(src, scope, self)
    return r.ok ? '' : r.error
  }
  it('认不出的列（设计页那一句）、差一个字的提示是不是', () => {
    expect(err('看过 / 节数')).toBe('认不出「看过」：没有这一列，也不是能用的函数')
    expect(err('结数 - 已看')).toBe('认不出「结数」：没有这一列，也不是能用的函数；是不是「节数」？')
  })
  it('写法错：没有的函数、没有的方法、括号、引号、运算符、空的', () => {
    expect(err('roundup(已看)')).toMatch(/^没有「roundup\(\)」这个函数；能用 if\(\)、today\(\)/)
    expect(err('已看.foo()')).toMatch(/^没有「\.foo\(\)」；能用 \.round\(\)/)
    expect(err('(已看 + 1')).toBe('括号少了「)」')
    expect(err('已看 + 1)')).toBe('第7个字的「)」多了，前面没有配对的「(」')
    expect(err('"还差 + 节数')).toBe('第1个字起的引号没有收尾，少了「"」')
    expect(err('已看 节数')).toBe('「节数」前面少了运算符')
    expect(err('已看 +')).toBe('「+」后面少了东西')
    expect(err('if(已看)')).toBe('「if」的写法是 if(条件, 是的时候, 不是的时候)')
    expect(err('已看 @ 节数')).toBe('第4个字「@」看不懂')
    expect(err('')).toBe('公式是空的')
  })
  it('用到自己、两条公式互相用到', () => {
    expect(err('进度 + 1', '进度')).toBe('「进度」用到了它自己，算不出来')
    const s2 = { ...scope, formulas: { ...scope.formulas, 完成度: '进度 + "!"' } }
    const r = checkFormula('完成度 + 1', s2, '进度')
    expect(r.ok ? '' : r.error).toBe('「进度」和「完成度」互相用到，算不出来')
    expect(checkFormula('进度 + "!"', scope, '完成度').ok).toBe(true)
  })
  it('算的时候类型不对：给空值和一句话，不抛', () => {
    expect(run('状态 * 2', env(L3))).toEqual({ value: null, error: '「状态」是字，不能乘' })
    expect(run('日期 - 状态', env(L3))).toEqual({ value: null, error: '「状态」不是日期也不是几天，不能和日期相减' })
    expect(run('状态.round()', env(L3)).error).toBe('「状态」是字，不能取整')
    expect(run('(已看 +', env(L3))).toEqual({ value: null, error: '「+」后面少了东西' })
  })
  it('公式里用别的公式：直接写名字或 formula.X', () => {
    expect(text('进度 + "!"', L3, { 进度: '(已看 / 节数 * 100).round() + "%"' })).toBe('50%!')
    expect(text('formula.进度', L3, { 进度: '已看 * 10' })).toBe('20')
  })
})

describe('筛选的值怎么比（和以前的筛选一样）', () => {
  it('数字按数、日期按日子、字一个字一个字比；空和空算一样；列表里有一样就算', () => {
    expect(valEq(8, '8')).toBe(true)
    expect(valEq('在读', '在读')).toBe(true)
    expect(valEq('在读', '在读 ')).toBe(false)
    expect(valEq({ date: '2026-11-17' }, '2026-11-17')).toBe(true)
    expect(valEq(null, '')).toBe(true)
    expect(valEq([], null)).toBe(true)
    expect(valEq(['a', 'b'], 'b')).toBe(true)
    expect(valEq(true, 'true')).toBe(true)
  })
  it('排序：空的总在最后，升序降序都是', () => {
    const xs: Val[] = [null, 3, 1, 2]
    expect([...xs].sort((a, b) => sortCmp(a, b))).toEqual([1, 2, 3, null])
    expect([...xs].sort((a, b) => sortCmp(a, b, true))).toEqual([3, 2, 1, null])
  })
})

describe('列名写进公式、改名跟着换', () => {
  it('普通名字照写，有空格、数字开头的写 note["…"]', () => {
    expect(exprRef('已看')).toBe('已看')
    expect(exprRef('入住 日期')).toBe('note["入住 日期"]')
    expect(exprRef('2024年')).toBe('note["2024年"]')
    expect(exprRef('formula.进度')).toBe('formula.进度')
    const p = parseExpr('已看 + note["入住 日期"] + formula.进度')
    expect(p.ok && exprRefs(p.ast)).toEqual({ names: ['已看'], notes: ['入住 日期'], formulas: ['进度'] })
  })
  it('列改名：直接写的名字、note.X、note["X"] 换掉，方法名、字里的不动', () => {
    expect(renameRef('if(已看 >= 节数, "已看完", note.已看 + note["已看"])', '已看', '看了几节')).toBe('if(看了几节 >= 节数, "已看完", note.看了几节 + note["看了几节"])')
    expect(renameRef('x.length + length', 'length', '长度')).toBe('x.length + 长度')
    expect(renameRef('已看 + 1', '已看', '看 过')).toBe('note["看 过"] + 1')
    expect(renameRef('formula.进度 + 进度', '进度', '完成度', 'formula')).toBe('formula.完成度 + 完成度')
  })
})
