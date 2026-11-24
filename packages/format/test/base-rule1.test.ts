/**
 * 规矩 1「打开再保存文件不变」在数据库第三批的四条（设计页）：
 * 1. 只看不写：打开、切视图、点开一条、展开、翻月、组收起都不碰文件；
 * 2. 只换那几行：拖卡、拖日期、勾关联、存视图只换那几行，别的视图、认不出的键、注释原样；
 * 3. 算出来的不落盘：公式、汇总、进度不写进任何一篇；
 * 4. 样本库里每种新写法各一篇，打开再保存逐字节一样；拖卡、拖日期、勾关联以后 diff 只有那几行。
 */
import { describe, expect, it } from 'vitest'
import { effectiveFilter, parseBaseDoc, setFormula, setPropDef, setViewDate, setViewFilter, setViewGroup, setViewImage, setViewOrder, setViewSort, setViewSummary, renameView } from '../src/base-doc'
import { allColumns, baseContext, cellOf, queryView, recordFields } from '../src/base-rows'
import { type FileWrite, moveToDay, toggleRelation, writeCell } from '../src/base-write'
import { decodeNote, encodeNote } from '../src/encoding'
import { ECP_DOC, EXERCISES, LECTURES } from './base-samples'
import { FIXTURES } from './fixtures'
import { lineDiff } from './line-diff'

const enc = (s: string) => new TextEncoder().encode(s)
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/** 一篇里每个 ```base 块换成 fn 算出来的（和编辑器里改块一样：只换块中间那几行） */
function eachBlock(text: string, fn: (src: string) => string): string {
  return text.replace(/^(```|~~~)base[ \t]*\n([\s\S]*?)^\1[ \t]*$/gm, (all, fence: string, body: string) => {
    const src = body.replace(/\n$/, '')
    const next = fn(src)
    return next === src ? all : all.replace(body, next + '\n')
  })
}

/** 把读到的原样写回去：每个视图的筛选、排序、分组、列、名字、日期、封面，每条公式、每一列的设置 */
function writeBack(src: string): string {
  const doc = parseBaseDoc(src)
  let out = src
  doc.views.forEach((v, i) => {
    out = setViewFilter(out, i, effectiveFilter(doc, i))
    out = setViewSort(out, i, v.sort)
    if (v.groupBy) out = setViewGroup(out, i, v.groupBy)
    out = setViewOrder(out, i, v.columns)
    out = renameView(out, i, v.name)
    out = setViewDate(out, i, v.date)
    out = setViewImage(out, i, v.image)
    for (const [c, id] of Object.entries(v.summaries)) out = setViewSummary(out, i, c, id)
  })
  for (const [k, f] of Object.entries(doc.formulas)) out = setFormula(out, k, f)
  for (const [k, d] of Object.entries(doc.props)) out = setPropDef(out, k, d)
  return out
}

describe('打开再保存不变：样本里每一篇带数据库块的', () => {
  const withBase = Object.entries(FIXTURES).filter(([, b]) => new TextDecoder().decode(b).includes('```base'))
  it('样本里有九篇（设计页、第二批的老块、手改过的 CRLF、别的写法、AI 列、表底合计、记账自动化、手改过的自动化、白板上的数据库卡）', () => {
    expect(withBase.map(([n]) => n)).toEqual(['数据库 课程计划.md', '数据库 以前的写法.md', '数据库 手改过的.md', '数据库 别的写法.md', '数据库 AI 列.md', '数据库 表底合计.md', '数据库 记账自动化.md', '数据库 手改过的自动化.md', 'board.md'])
  })
  for (const [name, bytes] of withBase) {
    it(name, () => {
      const { text, meta } = decodeNote(bytes)
      const out = eachBlock(text, writeBack)
      expect(out).toBe(text)
      expect(same(encodeNote(out, meta), bytes)).toBe(true)
    })
  }
})

describe('样本库：打开、切视图、点开一条都不写；拖卡、拖日期、勾关联以后 diff 只有那几行', () => {
  const files: Record<string, string> = { '课程/ecp/ecp 课程计划.md': ECP_DOC, ...LECTURES, ...EXERCISES }
  const bytes: Record<string, Uint8Array> = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, enc(t)]))

  /** 像软件那样：读字（decodeNote）、读块、算每个视图和每一格、右栏打开每一条 */
  function open(disk: Record<string, Uint8Array>) {
    const texts = Object.fromEntries(Object.entries(disk).map(([p, b]) => [p, decodeNote(b)]))
    const src = /```base\n([\s\S]*?)\n```/.exec(texts['课程/ecp/ecp 课程计划.md']!.text)![1]!
    const records = Object.entries(texts).map(([path, d]) => ({ path, text: d.text }))
    const ctx = baseContext(parseBaseDoc(src), records, { today: '2026-11-22' })
    return { texts, ctx }
  }

  it('只看不写：五个视图都算一遍、每一格、右栏每一条，存回去每个文件一个字节不变；算出来的不在任何一篇里', () => {
    const { texts, ctx } = open(bytes)
    for (let i = 0; i < ctx.doc.views.length; i++) queryView(ctx, i)
    for (const r of ctx.recs) {
      for (const c of allColumns(ctx)) cellOf(ctx, r, c.id)
      recordFields(ctx, r.path, 0)
    }
    for (const [p, d] of Object.entries(texts)) expect(same(encodeNote(d.text, d.meta), bytes[p]!), p).toBe(true)
    for (const t of Object.values(files)) expect(t).not.toMatch(/^(进度|做完几题):/m)
  })

  it('拖卡到同一列、拖到同一天、勾上已经连着的：什么都不写', () => {
    const { ctx } = open(bytes)
    expect(writeCell(ctx, '课程/ecp/课程计划/第3讲 生产.md', '状态', '在学')).toEqual([])
    expect(moveToDay(ctx, '课程/ecp/课程计划/第3讲 生产.md', '日期', '2026-11-17')).toEqual([])
    expect(toggleRelation(ctx, '课程/ecp/课程计划/第3讲 生产.md', '练习', '练习 3.1', true)).toEqual([])
  })

  it('拖卡、拖日期、勾关联：只改那几篇的那几行，别的文件一个字节不变', () => {
    const disk: Record<string, Uint8Array> = { ...bytes }
    const apply = (ws: FileWrite[]) => {
      const { texts } = open(disk)
      for (const w of ws) {
        expect(texts[w.path]!.text).toBe(w.before)
        disk[w.path] = encodeNote(w.after, texts[w.path]!.meta)
      }
    }
    apply(writeCell(open(disk).ctx, '课程/ecp/课程计划/第5讲 博弈初步.md', '状态', '在学'))
    apply(moveToDay(open(disk).ctx, '课程/ecp/课程计划/第4讲 市场结构.md', '日期', '2026-11-25'))
    apply(moveToDay(open(disk).ctx, '课程/ecp/课程计划/第7讲 外部性.md', '日期', '2026-11-27'))
    apply(toggleRelation(open(disk).ctx, '课程/ecp/课程计划/第4讲 市场结构.md', '练习', '练习 3.2'))
    const dec = (b: Uint8Array) => new TextDecoder().decode(b)
    const changed = Object.keys(disk).filter((p) => !same(disk[p]!, bytes[p]!))
    expect(changed.sort()).toEqual(['课程/ecp/练习/练习 3.2.md', '课程/ecp/课程计划/第4讲 市场结构.md', '课程/ecp/课程计划/第5讲 博弈初步.md', '课程/ecp/课程计划/第7讲 外部性.md'])
    expect(Object.fromEntries(changed.sort().map((p) => [p, lineDiff(dec(bytes[p]!), dec(disk[p]!))]))).toEqual({
      '课程/ecp/练习/练习 3.2.md': { removed: [], added: ['  - "[[第4讲 市场结构]]"'] },
      '课程/ecp/课程计划/第4讲 市场结构.md': { removed: ['日期: 2026-11-24', '练习: ["[[练习 4.1]]"]'], added: ['日期: 2026-11-25', '练习: ["[[练习 4.1]]", "[[练习 3.2]]"]'] },
      '课程/ecp/课程计划/第5讲 博弈初步.md': { removed: ['状态: 未开始'], added: ['状态: 在学'] },
      '课程/ecp/课程计划/第7讲 外部性.md': { removed: [], added: ['日期: 2026-11-27'] },
    })
    // 看板上第5讲到了「在学」那一列，日历上第7讲在 27 日；文档（base 块）一个字节没动
    const { ctx } = open(disk)
    expect(queryView(ctx, 1).groups![1]!.rows.map((r) => r.name)).toEqual(['第3讲 生产', '第4讲 市场结构', '第5讲 博弈初步'])
    expect(queryView(ctx, 2).days!['2026-11-27']!.map((r) => r.name)).toEqual(['第7讲 外部性'])
    expect(same(disk['课程/ecp/ecp 课程计划.md']!, bytes['课程/ecp/ecp 课程计划.md']!)).toBe(true)
  })
})
