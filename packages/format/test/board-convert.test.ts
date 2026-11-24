/**
 * 旧白板（type: board，用 <!-- column -->、<!-- card in=… --> 注释存列）一次转成「## 列名」写法（2026-11-21 方向 A）。
 * 转完：字一个不丢、空白处的卡还在原处、列名就是标题、连线和 AI 总结的卡留着编号；新写法再打开不再转。
 */
import { describe, expect, it } from 'vitest'
import { boardThumb, convertBoard, hasOldLayout, linksOf, needsConvert, OLD_OFFSET, splitDoc } from '../src'
import { OLD_BOARDS } from './fixtures'

/**
 * 一篇里所有「字」：去掉排版注释行、空行（旧写法列注释里的列名算一行字），标题去掉 # 号、整行加粗去掉 **（卡里的标题改成加粗），每行去掉首尾空白；
 * AI 总结的卡转成提示块（task-5yp97）：多出来的「> [!ai] AI 总结」那一行不算字，每行前面的「> 」去掉再比
 */
function words(text: string): string[] {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .split('\n')
    .map((l) => {
      const t = /^<!--\s*column\s[^\n]*\btitle=(?:"([^"]*)"|(\S+))[^\n]*-->\s*$/.exec(l)
      return t ? (t[1] ?? t[2]!) : l
    })
    .filter((l) => !/^<!--\s*(card|column)\s[^\n]*-->\s*$/.test(l) && !/^>\s*\[!ai\] AI 总结$/.test(l) && l.trim() !== '' && l.trim() !== '>')
    .map((l) => l.replace(/^>\s?/, '').replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim())
    .sort()
}

/** 旧白板里列的标题（注释里的 title） */
const oldTitles = (t: string) => [...t.matchAll(/<!--\s*column\s[^>]*title=(?:"([^"]*)"|(\S+))[^>]*-->/g)].map((m) => m[1] ?? m[2])

describe('旧白板认得出来', () => {
  it('有列注释、卡上写着 in= 或 w= 的是旧写法；新写法的位置行、编号行、列位置行不算；导图不转', () => {
    for (const [name, t] of Object.entries(OLD_BOARDS)) {
      expect(hasOldLayout(t), name).toBe(true)
      expect(needsConvert(t), name).toBe(true)
    }
    expect(hasOldLayout('---\ntype: board\n---\n## 一\n\n<!-- card id=d1 x=10 y=20 -->\n甲\n\n<!-- column id=c1 x=300 y=64 -->\n## 二\n\n<!-- card id=a2 ai=2026-11-20 -->\n乙\n')).toBe(false)
    // 空白板、普通文档：没什么要转
    expect(needsConvert('---\ntype: board\n---\n# 未命名白板\n')).toBe(false)
    expect(needsConvert('# 普通文档\n\n<!-- card id=a1 x=1 y=2 w=280 -->\n一段\n')).toBe(false)
    // 导图白板照旧
    expect(needsConvert('---\ntype: board\n白板样式: 导图\n---\n# 导图\n\n<!-- card id=a1 x=1 y=2 w=280 -->\n一段\n')).toBe(false)
    // 代码块里的注释不算
    expect(hasOldLayout('---\ntype: board\n---\n```\n<!-- card id=a1 in=c1 -->\n```\n')).toBe(false)
  })
})

describe('旧白板转成「## 列名」写法', () => {
  for (const [name, old] of Object.entries(OLD_BOARDS)) {
    it(`${name}：字一个不丢、frontmatter 不动、转完不再算旧写法`, () => {
      const r = convertBoard(old)
      expect(words(r.text)).toEqual(words(old))
      expect(r.text.startsWith(/^---\n[\s\S]*?\n---\n/.exec(old)![0])).toBe(true)
      expect(hasOldLayout(r.text)).toBe(false)
      expect(needsConvert(r.text)).toBe(false)
      // 列：每一列都是一节，标题就是列名
      const b = splitDoc(r.text)
      const titles = b.columns.filter((c) => c.head).map((c) => c.title)
      expect([...titles].sort()).toEqual([...oldTitles(old).map((t) => t || '新的列')].sort())
      expect(r.columns).toBe(titles.length)
      // 文末一个换行
      expect(r.text.endsWith('\n') && !r.text.endsWith('\n\n')).toBe(true)
    })
  }

  it('冰岛自驾：空白处的卡留在原处（坐标换到新画布上），列在空白处的卡旁边也留在原处；连线、AI 总结的卡留编号；卡里的标题降成 ####', () => {
    const old = OLD_BOARDS['冰岛自驾.md']!
    const r = convertBoard(old)
    const b = splitDoc(r.text)
    const at = (id: string) => b.placed.find((u) => u.place?.id === id)?.place
    // 空白处的卡：坐标 = 旧坐标 + 工具板和顶上让出的差（96 → 92，0 → 64）
    expect(at('k1')).toMatchObject({ x: 40 + OLD_OFFSET.x, y: 20 + OLD_OFFSET.y })
    expect(at('k2')).toMatchObject({ x: 360 + OLD_OFFSET.x, y: 20 + OLD_OFFSET.y })
    expect(at('k3')).toMatchObject({ x: 40 + OLD_OFFSET.x, y: 260 + OLD_OFFSET.y })
    // 待办卡：标题和待办一张卡；书摘和挂着的评价一张卡
    expect(b.placed.find((u) => u.place?.id === 'k1')!.kind).toBe('todo')
    expect(b.placed.find((u) => u.place?.id === 'k2')!.kind).toBe('quote')
    expect(b.placed.find((u) => u.place?.id === 'k2')!.text).toContain('我的评价')
    // AI 总结的卡：位置行上留着 ai=
    expect(b.placed.find((u) => u.place?.id === 'k5')!.attrs).toMatchObject({ ai: '2026-11-19' })
    // 一张卡里两段：一段一张，第二段排在第一段下面
    const k9 = at('k9')!
    const second = b.placed.find((u) => u.text === '第二段：保险要买全。')!
    expect(second.place!.x).toBe(k9.x)
    expect(second.place!.y).toBeGreaterThan(k9.y + 40)
    // 列有位置（白板上有空白处的卡）
    const col = (t: string) => b.columns.find((c) => c.title === t)!
    expect(col('住哪').place).toMatchObject({ id: 'c1', x: 1040 + OLD_OFFSET.x, y: 20 + OLD_OFFSET.y })
    expect(col('剪藏').place).toMatchObject({ id: 'c2', x: 1380 + OLD_OFFSET.x })
    // 列里的卡紧跟在列名下面，旧的注释行去掉；卡里的 ## 改成加粗的一行（不然会变成一列），和下面那段一张卡
    expect(col('住哪').cards.map((u) => u.text)).toEqual(['南岸在维克住两晚。', '**东边**\n霍芬一晚，米湖两晚。'])
    expect(r.text).not.toMatch(/in=c\d/)
    expect(col('剪藏').cards.map((u) => u.kind)).toEqual(['embed'])
    // 开头没放进卡片的那句：列、卡都摆在原处时，一排的最左一组会从左上角排起、和它们叠在一起，所以它也摆到一边：
    // 所有东西的右边再空 40，从顶上排起（空白处的一张卡，新编号）
    const loose = b.placed.find((u) => u.text === '还没想好放哪的一句：极光要看 KP 指数。')!
    expect(loose.place).toMatchObject({ id: 'd1', y: OLD_OFFSET.y })
    for (const u of b.placed) if (u !== loose) expect(loose.place!.x).toBeGreaterThanOrEqual(u.place!.x + 276 + 40)
    for (const c of b.columns) if (c.place) expect(loose.place!.x).toBeGreaterThanOrEqual(c.place.x + 276 + 40)
    expect(b.columns.filter((c) => !c.head).flatMap((c) => c.cards.filter((u) => u.kind !== 'gap'))).toEqual([])
    // 名字那行还在最前面
    expect(r.text).toMatch(/^---\n[\s\S]*?\n---\n# 冰岛自驾\n\n<!-- card id=d1 x=\d+ y=64 -->\n还没想好放哪的一句/)
    // 连线照旧：两头都还在
    expect(linksOf(r.text)).toEqual([{ from: 'k1', to: 'k2' }])
  })

  it('列从 x=0 摆起、旁边有一张空白处的卡：开头那段不留在一排里（不然和摆在原处的列叠在一起），摆到右边', () => {
    const old = '---\ntype: board\ncolor: #4A7FA7\n---\n写作计划。\n\n<!-- column id=c1 x=0 y=0 w=300 title=十一月 -->\n<!-- card id=k1 in=c1 -->\n第一张\n\n<!-- card id=k2 x=700 y=300 w=280 -->\n散着的一张\n'
    const r = convertBoard(old)
    expect(r.text).toBe(
      '---\ntype: board\ncolor: #4A7FA7\n---\n<!-- card id=d1 x=1024 y=64 -->\n写作计划。\n\n<!-- card id=k2 x=704 y=364 -->\n散着的一张\n\n<!-- column id=c1 x=4 y=64 -->\n## 十一月\n\n第一张\n',
    )
    const b = splitDoc(r.text)
    expect(b.columns.filter((c) => !c.head).flatMap((c) => c.cards)).toEqual([])
    // 列在一排、没有空白处的卡时开头那段照旧在最左一组
    const row = convertBoard('---\ntype: board\n---\n写作计划。\n\n<!-- column id=c1 x=0 y=0 w=300 title=十一月 -->\n<!-- card id=k1 in=c1 -->\n第一张\n')
    expect(row.text).toBe('---\ntype: board\n---\n写作计划。\n\n## 十一月\n\n第一张\n')
  })

  it('读书计划：列在一排、白板上没有空白处的卡：列不留位置，按从左到右排成节', () => {
    const r = convertBoard(OLD_BOARDS['读书计划.md']!)
    expect(r.text).toBe('---\ntype: board\n---\n# 读书计划\n\n## 在读\n\n在冰岛开车\n\n思考，快与慢\n\n## 读完\n\n趣说明朝276年\n')
  })

  it('先做后做：列不在一排时留位置；列按从左到右排；连线两头的列里的卡留一行编号', () => {
    const r = convertBoard(OLD_BOARDS['先做后做.md']!)
    expect(r.text).toBe(
      '---\ntype: board\nlinks:\n  - m1 -> m2\n---\n<!-- column id=c1 x=84 y=144 -->\n## 先做\n\n<!-- card id=m1 -->\n第一件事\n\n<!-- column id=c2 x=504 y=464 -->\n## 后来\n\n<!-- card id=m2 -->\n第二件事\n',
    )
    const b = splitDoc(r.text)
    expect(b.columns.map((c) => [c.title, c.cards.map((u) => [u.tag?.id, u.text])])).toEqual([
      ['先做', [['m1', '第一件事']]],
      ['后来', [['m2', '第二件事']]],
    ])
    expect(b.placed).toEqual([])
  })

  it('样本 board.md（旧版）：列里的卡、空白处的卡、分栏和没配对的注释都留着', () => {
    const r = convertBoard(OLD_BOARDS['旧样本.md']!)
    expect(r.text).toContain('<!-- columns widths=40,30,30 -->')
    expect(r.text).toContain('<!-- card id=a3 没有配对的注释也要原样留着')
    const b = splitDoc(r.text)
    expect(b.columns.find((c) => c.title === '要订的')!.cards[0]!.kind).toBe('todo')
    expect(b.placed.map((u) => u.place!.id).sort()).toEqual(['a1', 'a2'])
  })

  it('缩略图：新写法按列和空白处的卡算，卡片数一张不漏', () => {
    const r = convertBoard(OLD_BOARDS['冰岛自驾.md']!)
    const t = boardThumb(r.text)
    expect(t.cards).toBe(splitDoc(r.text).total)
    expect(t.thumb.filter((x) => x.k === 'l')).toHaveLength(2)
    expect(t.thumb.length).toBeGreaterThan(5)
  })
})
