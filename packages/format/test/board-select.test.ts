import { describe, expect, it } from 'vitest'
import { linksOf, mergeUnits, moveUnits, placeUnits, removeUnits, replaceUnits, splitDoc, splitMerged, unitKeys } from '../src/doc-board'

/**
 * 白板框选以后一起改（task-5ryf9，17-白板框选 方向 A）：几张卡一起挪进一列、一起摆、一起删、合成一张（字不改、前面一行注释）、
 * 挪进新白板（原处换成一行链接）。每一样都只动这几段和它们的位置行，别的字一个不动。
 */
const B = `---
type: board
links:
  - d1 -> k1
---
# 线代

<!-- card id=d1 x=120 y=420 -->
导图卡。

## 前言

任何一种计算技术要想发挥最大的影响力。

<!-- card id=k1 -->
书里说，要真正用好深度学习。

## 全书结构

全书分三部分。

## 章节阅读顺序

主线：4 之后分成两路。

<!-- card id=d2 x=760 y=520 -->
范数：向量有多大。

<!-- card id=d3 x=1070 y=405 -->
矩阵-矩阵乘法 AB。
`

const cardOf = (text: string, s: string) => {
  const b = splitDoc(text)
  const u = [...b.columns.flatMap((c) => c.cards), ...b.placed].find((x) => x.text.includes(s))
  if (!u) throw new Error('没有这张：' + s)
  return u
}
const colOf = (text: string, title: string) => splitDoc(text).columns.find((c) => c.title === title)!

describe('几张卡一起挪进一列（moveUnits）', () => {
  it('按文档里的先后挪进那一节末尾，位置行去掉（连线一头留编号行），别的字不动', () => {
    const units = [cardOf(B, '范数'), cardOf(B, '导图卡'), cardOf(B, '书里说')]
    const out = moveUnits(B, units, colOf(B, '全书结构'), null)
    expect(out).toContain('## 全书结构\n\n全书分三部分。\n\n<!-- card id=d1 -->\n导图卡。\n\n<!-- card id=k1 -->\n书里说，要真正用好深度学习。\n\n范数：向量有多大。\n\n## 章节阅读顺序')
    expect(out).not.toContain('x=120')
    expect(out).not.toContain('x=760')
    // 没挪的照旧
    expect(out).toContain('<!-- card id=d3 x=1070 y=405 -->\n矩阵-矩阵乘法 AB。\n')
    expect(out.startsWith('---\ntype: board\nlinks:\n  - d1 -> k1\n---\n# 线代\n\n## 前言\n\n任何一种计算技术要想发挥最大的影响力。\n\n## 全书结构')).toBe(true)
    expect(splitDoc(out).columns.find((c) => c.title === '全书结构')!.cards.map((u) => u.text)).toEqual(['全书分三部分。', '导图卡。', '书里说，要真正用好深度学习。', '范数：向量有多大。'])
  })

  it('插到一张卡前面；那张卡自己也在挪的那几张里：插到它后面第一张不挪的前面', () => {
    const units = [cardOf(B, '矩阵-矩阵'), cardOf(B, '任何一种')]
    const out = moveUnits(B, units, colOf(B, '章节阅读顺序'), cardOf(B, '主线'))
    expect(out).toContain('## 章节阅读顺序\n\n任何一种计算技术要想发挥最大的影响力。\n\n矩阵-矩阵乘法 AB。\n\n主线：4 之后分成两路。')
    const same = moveUnits(B, [cardOf(B, '主线'), cardOf(B, '范数')], colOf(B, '章节阅读顺序'), cardOf(B, '主线'))
    expect(splitDoc(same).columns.find((c) => c.title === '章节阅读顺序')!.cards.map((u) => u.text)).toEqual(['主线：4 之后分成两路。', '范数：向量有多大。'])
  })

  it('「问过 AI」那一列不收', () => {
    const ask = '## 第 3 页 · 九层\n\n> [!question] 我的疑惑\n> 为什么\n\n## 别的\n\n甲\n'
    const b = splitDoc(ask)
    expect(() => moveUnits(ask, [b.columns[1]!.cards[0]!], b.columns[0]!, null)).toThrow()
  })
})

describe('几张卡一起摆到空白处（placeUnits）', () => {
  it('每张一行位置：已有的改坐标，列里的前面多一行（编号不重），正文顺序不变', () => {
    const out = placeUnits(B, [
      { unit: cardOf(B, '范数'), x: 120, y: 520 },
      { unit: cardOf(B, '全书分三部分'), x: 120.4, y: 700 },
      { unit: cardOf(B, '导图卡'), x: 120, y: 420 },
    ])
    expect(out).toContain('<!-- card id=d2 x=120 y=520 -->\n范数')
    expect(out).toContain('## 全书结构\n\n<!-- card id=d4 x=120 y=700 -->\n全书分三部分。')
    expect(out).toContain('<!-- card id=d1 x=120 y=420 -->\n导图卡。')
    expect(splitDoc(out).placed.map((u) => [u.place!.id, u.place!.x, u.place!.y])).toEqual([
      ['d1', 120, 420],
      ['d4', 120, 700],
      ['d2', 120, 520],
      ['d3', 1070, 405],
    ])
    // 只改了位置行：去掉位置行以后和原文一样
    const strip = (t: string) => t.replace(/^<!-- card [^\n]*-->\n/gm, '')
    expect(strip(out)).toBe(strip(B))
  })
})

describe('几张卡一起删（removeUnits）', () => {
  it('这几段连位置行、编号行一起删，连着它们的线也去掉；删的是最后一段时文末留一个换行', () => {
    const out = removeUnits(B, [cardOf(B, '书里说'), cardOf(B, '矩阵-矩阵'), cardOf(B, '导图卡')])
    expect(out).not.toContain('书里说')
    expect(out).not.toContain('矩阵-矩阵')
    expect(out).not.toContain('导图卡')
    expect(linksOf(out)).toEqual([])
    expect(out.endsWith('<!-- card id=d2 x=760 y=520 -->\n范数：向量有多大。\n')).toBe(true)
    expect(out).toContain('# 线代\n\n## 前言\n\n任何一种计算技术要想发挥最大的影响力。\n\n## 全书结构')
  })
})

describe('合成一张（mergeUnits）：字一个不改，挪到第一张那里，前面一行注释记几段是一张', () => {
  it('第一张在空白处：合成的卡摆在它的位置；几段按原来的先后挨着；线改连到合成的这张', () => {
    const units = [cardOf(B, '范数'), cardOf(B, '书里说'), cardOf(B, '导图卡')]
    const r = mergeUnits(B, units)
    expect(r.id).toBe('d1')
    expect(r.text).toContain('<!-- card id=d1 x=120 y=420 merge=3 -->\n导图卡。\n\n书里说，要真正用好深度学习。\n\n范数：向量有多大。\n\n## 前言')
    expect(r.text).not.toContain('k1')
    expect(r.text).not.toContain('id=d2')
    // 线的两头都成了这一张：自己连自己的线去掉
    expect(linksOf(r.text)).toEqual([])
    const b = splitDoc(r.text)
    const m = b.placed.find((u) => u.place!.id === 'd1')!
    expect(m.parts?.map((p) => p.text)).toEqual(['导图卡。', '书里说，要真正用好深度学习。', '范数：向量有多大。'])
    expect(m.text).toBe('导图卡。\n\n书里说，要真正用好深度学习。\n\n范数：向量有多大。')
    // 一共几张：合成的算一张
    expect(b.total).toBe(splitDoc(B).total - 2)
    expect(unitKeys(b).get(m)).toBe('d1')
    // 再切一次一个字节不变（切过去只看不写）
    expect(splitDoc(r.text)).toEqual(b)
  })

  it('第一张在列里：合成的卡在那一列原来的地方，前面一行只记编号（带 merge）；两张合成的再合成，几段数加起来', () => {
    const r = mergeUnits(B, [cardOf(B, '全书分三部分'), cardOf(B, '主线')])
    expect(r.text).toContain(`## 全书结构\n\n<!-- card id=${r.id} merge=2 -->\n全书分三部分。\n\n主线：4 之后分成两路。\n\n## 章节阅读顺序\n\n<!-- card id=d2`)
    const col = splitDoc(r.text).columns.find((c) => c.title === '全书结构')!
    expect(col.cards).toHaveLength(1)
    expect(col.cards[0]!.parts).toHaveLength(2)
    expect(splitDoc(r.text).columns.find((c) => c.title === '章节阅读顺序')!.cards).toHaveLength(0)
    const again = mergeUnits(r.text, [cardOf(r.text, '全书分三部分'), cardOf(r.text, '任何一种')])
    expect(again.text).toContain(`<!-- card id=${again.id} merge=3 -->\n任何一种计算技术要想发挥最大的影响力。\n\n全书分三部分。\n\n主线：4 之后分成两路。`)
    expect(splitDoc(again.text).columns.find((c) => c.title === '前言')!.cards[0]!.parts).toHaveLength(3)
  })

  it('注释记的段数比后面有的多：到这一节末尾为止，不吞下一节；碰到标题、分隔线、自己有位置行的卡也停', () => {
    const t = '## 一\n\n<!-- card id=m1 merge=5 -->\n甲\n\n乙\n\n## 二\n\n丙\n'
    const b = splitDoc(t)
    expect(b.columns[0]!.cards[0]!.parts?.map((p) => p.text)).toEqual(['甲', '乙'])
    expect(b.columns[1]!.cards.map((u) => u.text)).toEqual(['丙'])
    const t2 = '## 一\n\n<!-- card id=m1 merge=3 -->\n甲\n\n***\n\n乙\n\n<!-- card id=d9 x=1 y=2 -->\n丙\n'
    const b2 = splitDoc(t2)
    expect(b2.columns[0]!.cards[0]!.parts).toBeUndefined()
    expect(b2.columns[0]!.cards.map((u) => u.text)).toEqual(['甲', '***', '乙'])
    expect(b2.placed.map((u) => u.text)).toEqual(['丙'])
  })

  it('拆开：去掉 merge，几段各是各的卡；空白处的第一张留着位置，后面几张各自错开 24 摆在旁边', () => {
    const r = mergeUnits(B, [cardOf(B, '导图卡'), cardOf(B, '书里说')])
    const back = splitMerged(r.text, cardOf(r.text, '导图卡'))
    expect(back).toContain('<!-- card id=d1 x=120 y=420 -->\n导图卡。\n\n<!-- card id=d4 x=144 y=444 -->\n书里说，要真正用好深度学习。')
    expect(splitDoc(back).placed.map((u) => u.text)).toEqual(['导图卡。', '书里说，要真正用好深度学习。', '范数：向量有多大。', '矩阵-矩阵乘法 AB。'])
    const inCol = mergeUnits(B, [cardOf(B, '全书分三部分'), cardOf(B, '主线')])
    const back2 = splitMerged(inCol.text, cardOf(inCol.text, '全书分三部分'))
    expect(back2).toContain('## 全书结构\n\n全书分三部分。\n\n主线：4 之后分成两路。\n\n## 章节阅读顺序')
  })
})

describe('换成一段（replaceUnits）：挪进新白板时原处换成一行链接', () => {
  it('第一张在空白处：链接带它的位置行；别的几段删掉，连着它们的线也去掉', () => {
    const out = replaceUnits(B, [cardOf(B, '导图卡'), cardOf(B, '范数'), cardOf(B, '书里说')], '[[新的白板]]')
    expect(out).toContain('# 线代\n\n<!-- card id=d1 x=120 y=420 -->\n[[新的白板]]\n\n## 前言')
    expect(out).not.toContain('导图卡')
    expect(out).not.toContain('书里说')
    expect(out).not.toContain('范数')
    expect(linksOf(out)).toEqual([])
    const inCol = replaceUnits(B, [cardOf(B, '全书分三部分')], '[[子白板]]')
    expect(inCol).toContain('## 全书结构\n\n[[子白板]]\n\n## 章节阅读顺序')
  })
})
