import { describe, expect, it } from 'vitest'
import { parseBaseDoc, setPropDef } from '../src/base-doc'
import { baseContext, type BaseRecord } from '../src/base-rows'
import { type FileWrite, fixRelationIssue, moveToDay, relationIssues, setRelation, toggleRelation, undoWrites, writeCell } from '../src/base-write'
import { readPropList, setPropList } from '../src/props'
import { ECP_BASE, EXERCISES, LECTURES, records } from './base-samples'
import { lineDiff } from './line-diff'

const P = (n: string) => `课程/ecp/课程计划/${n}.md`
const X = (n: string) => `课程/ecp/练习/${n}.md`

/** 一个小库：改完把写的几篇存回去（像主进程那样），再读一遍 */
function vault(files: Record<string, string> = { ...LECTURES, ...EXERCISES }, src = ECP_BASE) {
  const disk = { ...files }
  const ctx = () => baseContext(parseBaseDoc(src), records(disk) as BaseRecord[], { today: '2026-11-22' })
  const apply = (ws: FileWrite[]) => {
    for (const w of ws) {
      expect(disk[w.path], `${w.path} 写之前被别处改过`).toBe(w.before)
      disk[w.path] = w.after
    }
  }
  return { disk, ctx, apply }
}

describe('拖看板卡、拖日历：只换那一篇开头的那一行', () => {
  it('第5讲从未开始拖到在学：只换「状态:」一行', () => {
    const v = vault()
    const ws = writeCell(v.ctx(), P('第5讲 博弈初步'), '状态', '在学')
    expect(ws.map((w) => w.path)).toEqual([P('第5讲 博弈初步')])
    expect(lineDiff(ws[0]!.before, ws[0]!.after)).toEqual({ removed: ['状态: 未开始'], added: ['状态: 在学'] })
    expect(writeCell(v.ctx(), P('第3讲 生产'), '状态', '在学')).toEqual([])
  })
  it('日历：第4讲 24 → 25 只换「日期:」；拖回没排日子的拿掉这一行；没排日子的拖进 27 日加一行', () => {
    const v = vault()
    const move = moveToDay(v.ctx(), P('第4讲 市场结构'), '日期', '2026-11-25')
    expect(lineDiff(move[0]!.before, move[0]!.after)).toEqual({ removed: ['日期: 2026-11-24'], added: ['日期: 2026-11-25'] })
    const clear = moveToDay(v.ctx(), P('第4讲 市场结构'), '日期', null)
    expect(lineDiff(clear[0]!.before, clear[0]!.after)).toEqual({ removed: ['日期: 2026-11-24'], added: [] })
    const put = moveToDay(v.ctx(), P('第7讲 外部性'), '日期', '2026-11-27')
    expect(lineDiff(put[0]!.before, put[0]!.after)).toEqual({ removed: [], added: ['日期: 2026-11-27'] })
  })
  it('格子里改数字、勾选、多选；公式、汇总、名字不写', () => {
    const v = vault({ ...LECTURES, ...EXERCISES, [P('第9讲 加课')]: '---\n标签: [复习]\n---\n' })
    expect(lineDiff(LECTURES[P('第3讲 生产')]!, writeCell(v.ctx(), P('第3讲 生产'), '已看', '3')[0]!.after)).toEqual({ removed: ['已看: 2'], added: ['已看: 3'] })
    expect(writeCell(v.ctx(), X('练习 3.2'), '做完', true)).toEqual([])
    expect(lineDiff('---\n标签: [复习]\n---\n', writeCell(v.ctx(), P('第9讲 加课'), '标签', ['复习', '考试 重点'])[0]!.after)).toEqual({ removed: ['标签: [复习]'], added: ['标签: [复习, 考试 重点]'] })
    expect(writeCell(v.ctx(), P('第3讲 生产'), 'formula.进度', '1')).toEqual([])
    expect(writeCell(v.ctx(), P('第3讲 生产'), '做完几题', '1')).toEqual([])
    expect(writeCell(v.ctx(), P('第3讲 生产'), 'file.name', '改名')).toEqual([])
  })
})

describe('关联两边都写：勾一下改两篇各一行，一次撤回', () => {
  it('第4讲勾上练习 3.2：第4讲的「练习」一行，练习 3.2 的「所属讲」加一项（原来一行一项的照一行一项）', () => {
    const v = vault()
    const ws = toggleRelation(v.ctx(), P('第4讲 市场结构'), '练习', '练习 3.2')
    expect(ws.map((w) => w.path)).toEqual([P('第4讲 市场结构'), X('练习 3.2')])
    expect(lineDiff(ws[0]!.before, ws[0]!.after)).toEqual({ removed: ['练习: ["[[练习 4.1]]"]'], added: ['练习: ["[[练习 4.1]]", "[[练习 3.2]]"]'] })
    expect(lineDiff(ws[1]!.before, ws[1]!.after)).toEqual({ removed: [], added: ['  - "[[第4讲 市场结构]]"'] })
    v.apply(ws)
    expect(readPropList(v.disk[X('练习 3.2')]!, '所属讲')).toEqual(['[[第3讲 生产]]', '[[第4讲 市场结构]]'])
    // 再勾一下去掉：两篇回到原样，一个字节不差
    v.apply(toggleRelation(v.ctx(), P('第4讲 市场结构'), '练习', '练习 3.2'))
    expect(v.disk[P('第4讲 市场结构')]).toBe(LECTURES[P('第4讲 市场结构')])
    expect(v.disk[X('练习 3.2')]).toBe(EXERCISES[X('练习 3.2')])
  })
  it('撤回：两篇一起换回去', () => {
    const v = vault()
    const ws = toggleRelation(v.ctx(), P('第6讲 信息不对称'), '练习', '练习 5.1')
    expect(lineDiff(ws[0]!.before, ws[0]!.after)).toEqual({ removed: [], added: ['练习: ["[[练习 5.1]]"]'] })
    expect(lineDiff(ws[1]!.before, ws[1]!.after)).toEqual({ removed: ['所属讲: ["[[第5讲 博弈初步]]"]'], added: ['所属讲: ["[[第5讲 博弈初步]]", "[[第6讲 信息不对称]]"]'] })
    v.apply(ws)
    v.apply(undoWrites(ws))
    expect(v.disk).toEqual({ ...LECTURES, ...EXERCISES })
  })
  it('一次改成一串（关联选择点完）：加的、去的那边各改各的；只写这边（不写两边）时只改这一篇', () => {
    const v = vault()
    const ws = setRelation(v.ctx(), P('第3讲 生产'), '练习', ['练习 3.1', '练习 4.1'])
    expect(ws.map((w) => w.path)).toEqual([P('第3讲 生产'), X('练习 4.1'), X('练习 3.2')])
    expect(lineDiff(ws[2]!.before, ws[2]!.after)).toEqual({ removed: ['所属讲:', '  - "[[第3讲 生产]]"'], added: [] })
    const one = vault(undefined, setPropDef(ECP_BASE, '练习', { type: 'relation', to: '课程/ecp/练习', twoWay: null }))
    expect(toggleRelation(one.ctx(), P('第4讲 市场结构'), '练习', '练习 3.2').map((w) => w.path)).toEqual([P('第4讲 市场结构')])
  })
  it('同一个数据库里互相关联（相关的讲）：两边是同一列，连上自己也只写一次', () => {
    const src = setPropDef(ECP_BASE, '相关', { type: 'relation', to: '课程/ecp/课程计划', twoWay: '相关' })
    const v = vault(undefined, src)
    const ws = toggleRelation(v.ctx(), P('第3讲 生产'), '相关', '第4讲 市场结构')
    expect(ws.map((w) => [w.path, lineDiff(w.before, w.after).added])).toEqual([
      [P('第3讲 生产'), ['相关: ["[[第4讲 市场结构]]"]']],
      [P('第4讲 市场结构'), ['相关: ["[[第3讲 生产]]"]']],
    ])
    const self = toggleRelation(v.ctx(), P('第3讲 生产'), '相关', '第3讲 生产')
    expect(self.map((w) => [w.path, lineDiff(w.before, w.after).added])).toEqual([[P('第3讲 生产'), ['相关: ["[[第3讲 生产]]"]']]])
  })
})

describe('两边对不上（外面改了一边）：说一句，点一下补上', () => {
  it('那边少了、这边少了、连着的那一篇没有', () => {
    const v = vault({
      ...LECTURES,
      ...EXERCISES,
      [X('练习 3.2')]: '---\n做完: false\n---\n',
      [X('练习 4.1')]: '---\n做完: false\n所属讲: ["[[第4讲 市场结构]]", "[[第3讲 生产]]"]\n---\n',
      [P('第8讲 复习')]: LECTURES[P('第8讲 复习')]!.replace('节数: 2\n', '节数: 2\n练习: ["[[练习 9.9]]"]\n'),
    })
    const issues = relationIssues(v.ctx())
    expect(issues.map((i) => [i.kind, i.message])).toEqual([
      ['missing-back', '「练习 3.2」的「所属讲」里少了「第3讲 生产」'],
      ['dangling', '「第8讲 复习」的「练习」连着「练习 9.9」，那边没有这一篇'],
      ['missing-forward', '「第3讲 生产」的「练习」里少了「练习 4.1」'],
    ])
    const fixes = issues.map((i) => fixRelationIssue(v.ctx(), i))
    expect(fixes.map((ws) => ws.map((w) => [w.path, lineDiff(w.before, w.after)]))).toEqual([
      [[X('练习 3.2'), { removed: [], added: ['所属讲: ["[[第3讲 生产]]"]'] }]],
      [[P('第8讲 复习'), { removed: ['练习: ["[[练习 9.9]]"]'], added: [] }]],
      [[P('第3讲 生产'), { removed: ['练习: ["[[练习 3.1]]", "[[练习 3.2]]"]'], added: ['练习: ["[[练习 3.1]]", "[[练习 3.2]]", "[[练习 4.1]]"]'] }]],
    ])
    for (const ws of fixes) v.apply(ws)
    expect(relationIssues(v.ctx())).toEqual([])
  })
})

describe('开头一串的值：读、写（照原来的写法）', () => {
  it('一行的 [a, b]、一行一项、一个字、没有', () => {
    expect(readPropList('---\n练习: ["[[a]]", \'b, c\', d]  # 注释\n---\n', '练习')).toEqual(['[[a]]', 'b, c', 'd'])
    expect(readPropList('---\n所属讲:\n  - "[[第3讲]]"\n  - 第4讲  # 手写的\n---\n', '所属讲')).toEqual(['[[第3讲]]', '第4讲'])
    expect(readPropList('---\n练习: "[[a]]"\n---\n', '练习')).toEqual(['[[a]]'])
    expect(readPropList('---\n标签: 温泉, 海边\n---\n', '标签')).toEqual(['温泉', '海边'])
    expect(readPropList('---\n状态: 在学\n---\n', '练习')).toBeNull()
  })
  it('写：没变的项照原样（单引号、注释），新的加引号；空了拿掉这一项', () => {
    const t = "---\n练习: ['[[a]]', b]  # 注释\n---\n正文\n"
    expect(setPropList(t, '练习', ['[[a]]', 'b', '[[c]]'])).toBe("---\n练习: ['[[a]]', b, \"[[c]]\"]  # 注释\n---\n正文\n")
    expect(setPropList(t, '练习', ['[[a]]', 'b'])).toBe(t)
    expect(setPropList(t, '练习', [])).toBe('---\n---\n正文\n')
    expect(setPropList('---\n练习:\n---\n', '练习', ['[[a]]'])).toBe('---\n练习: ["[[a]]"]\n---\n')
    expect(setPropList('正文\n', '练习', ['[[a]]'])).toBe('---\n练习: ["[[a]]"]\n---\n正文\n')
    const block = '---\n所属讲:\n    - "[[第3讲]]"   # 第一项\n做完: true\n---\n'
    expect(setPropList(block, '所属讲', ['[[第3讲]]', '[[第4讲]]'])).toBe('---\n所属讲:\n    - "[[第3讲]]"   # 第一项\n    - "[[第4讲]]"\n做完: true\n---\n')
  })
})
