import { describe, expect, it } from 'vitest'
import {
  addInk,
  darkInk,
  decodePoints,
  deleteInk,
  encodePoints,
  fmt2,
  inkCardId,
  inkGroups,
  inkId,
  inkPathOf,
  pdfInkPathOf,
  inkStrokes,
  mergeInk,
  mergeVaultText,
  moveInk,
  parseInk,
  printInk,
  recolorInk,
  resetLayout,
  splitDoc,
  splitInk,
  inkLineage,
  unplaceUnit,
  placeUnit,
} from '../src'
import { eraseCase, INK_CARD_DOC, INK_DOC, INK_EMPTY, INK_HAND, INK_MERGE_CASES, INK_PDF_DOC, INK_PDF_MERGE_CASES, rng, synthStroke } from './ink-cases'
import { lineDiff } from './line-diff'

// 白板笔迹层（方案 B，2026-11-25 用户定）：一笔一行字，挂在白板的附件文件夹里。规矩见 packages/format/src/ink.ts 开头

const lines = (s: string) => s.split('\n')
/** 两份字哪几行不一样（按行号对齐，行数一样时用） */
const changedLines = (a: string, b: string) => {
  const x = lines(a)
  const y = lines(b)
  return x.map((l, i) => (l === y[i] ? null : i)).filter((i) => i !== null)
}

describe('笔迹文件在哪', () => {
  it('在这篇白板自己的附件文件夹里，叫 笔迹.ink', () => {
    expect(inkPathOf('项目/study project 2/组会与沟通/11.24 组会准备.md')).toBe('附件/项目/study project 2/组会与沟通/11.24 组会准备/笔迹.ink')
    expect(inkPathOf('白板.md')).toBe('附件/白板/笔迹.ink')
  })
})

describe('读 PDF 上写的：组行带 pg（设计页 159）', () => {
  it('文件在 附件/<PDF 名>/笔迹.ink（和读 PDF 截图同一个文件夹，不带 PDF 所在的文件夹）', () => {
    expect(pdfInkPathOf('项目/study project 2/论文/YitingWei/YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC.pdf')).toBe('附件/YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC/笔迹.ink')
    expect(pdfInkPathOf('课程/ecp/Lecture05.pdf')).toBe('附件/Lecture05/笔迹.ink')
  })

  it('读出 pg，打开再保存一字不差；pg 写成 0、字、小数的组行认不出、原样留着', () => {
    const d = parseInk(INK_PDF_DOC)
    expect(printInk(d)).toBe(INK_PDF_DOC)
    const g = inkGroups(d)
    expect(g.get('79wxybrw')).toEqual({ id: '79wxybrw', on: null, pg: 1, x: 302, y: 154, t: null })
    expect(g.get('n0000001')!.pg).toBe(3)
    expect(['bad00001', 'bad00002', 'bad00003'].some((k) => g.has(k))).toBe(false)
    expect(d.lines.filter((l) => l.kind === 'other')).toHaveLength(4)
    // moved 行是认不出的行
    expect(d.lines[1]).toEqual({ kind: 'other', raw: '{"moved":"附件/手写/C72/第 1 页.drawing","sha":"a7fe7b8f8c48","pg":1}' })
  })

  it('改过的组行照固定写法写：g、on、pg、x、y、t；白板的组行没有 pg 照旧', () => {
    const d = moveInk(parseInk(INK_PDF_DOC), ['s0000004'], 10, -4.5, { now: 1764093000000 })
    expect(printInk(d).split('\n')[5]).toBe('{"g":"n0000001","pg":3,"x":81.6,"y":249.8,"t":1764093000000}')
    expect(printInk(addInk(parseInk(INK_EMPTY), { id: 'aaaabbbb', on: null, x: 1, y: 2, t: null }, []))).toBe('{"ink":1}\n{"g":"aaaabbbb","x":1,"y":2}\n')
  })

  it('只挪一组里的一笔：拆出来的新组带着原来的 pg，只改这几行', () => {
    const before = INK_PDF_DOC
    const after = printInk(moveInk(parseInk(before), ['hbcq54ts'], 5, -3, { now: 1764092000000, newId: () => 'splitg01' }))
    expect(inkGroups(parseInk(after)).get('splitg01')).toEqual({ id: 'splitg01', on: null, pg: 1, x: 307, y: 151, t: 1764092000000 })
    expect(lineDiff(before, after).removed).toHaveLength(1)
  })

  it('两台设备在不同页各写了一组、一边挪一组另一边改色：都留下，pg 不丢', () => {
    const [a, b, c, e, d] = INK_PDF_MERGE_CASES
    // 擦断（from）和装饰行（贴纸）和组行 pg 合在一起：三样都留
    for (const k of ['local', 'remote'] as const) {
      const t = mergeInk(e!.base, e!.local, e!.remote, k).text
      const ss = inkStrokes(parseInk(t))
      expect(ss.some((s) => s.id === 'hbcq54ts')).toBe(false)
      expect(ss.filter((s) => s.from === 'hbcq54ts').map((s) => s.id).sort()).toEqual(['pdfc0001', 'pdfc0002'])
      expect(t).toContain('{"sticker":"s9pdf001"')
      expect(inkGroups(parseInk(t)).get('79wxybrw')!.pg).toBe(1)
    }
    const r = parseInk(mergeInk(a!.base, a!.local, a!.remote, 'remote').text)
    expect(inkGroups(r).get('macg0101')!.pg).toBe(2)
    expect(inkGroups(r).get('ipdg0101')!.pg).toBe(5)
    const r2 = parseInk(mergeInk(b!.base, b!.local, b!.remote, 'local').text)
    expect(inkGroups(r2).get('79wxybrw')).toMatchObject({ pg: 1, x: 320, y: 170 })
    expect(inkStrokes(r2).find((s) => s.id === 's0000004')!.c).toBe('#d64545')
    // 两边迁出来一模一样：moved 行、组、笔都只有一份；另一边多写的一笔也在
    const t3 = mergeInk(c!.base, c!.local, c!.remote, 'local').text
    expect(t3.match(/"moved":"附件\/手写\/C72\/第 2 页.drawing"/g)).toHaveLength(1)
    expect(inkStrokes(parseInk(t3)).filter((s) => s.id === 'olds0001')).toHaveLength(1)
    expect(inkStrokes(parseInk(t3)).some((s) => s.id === 'ipds0102')).toBe(true)
    const r4 = parseInk(mergeInk(d!.base, d!.local, d!.remote, 'remote').text)
    expect(inkGroups(r4).get('splitg01')!.pg).toBe(1)
    expect(inkStrokes(r4).some((s) => s.id === 'ipds0103')).toBe(true)
  })
})

describe('读写一字不差（打开再保存不变）', () => {
  it('程序写的、手改的、空的、没有文件的：读进来原样写回', () => {
    for (const t of [INK_DOC, INK_HAND, INK_EMPTY, '', '{"ink":1}', '\n\n', 'x\r\ny']) expect(printInk(parseInk(t))).toBe(t)
  })

  it('认得出组行、笔画行；认不出的行原样留着、不算笔', () => {
    const d = parseInk(INK_DOC)
    expect(d.lines.map((l) => l.kind)).toEqual(['head', 'group', 'stroke', 'stroke', 'stroke', 'group', 'stroke', 'other'])
    const g = inkGroups(d)
    expect(g.get('k2m9q4ta')).toEqual({ id: 'k2m9q4ta', on: null, x: 1240, y: 380.5, t: null })
    expect(g.get('p7x0c3vd')).toEqual({ id: 'p7x0c3vd', on: 'a3', x: 12, y: 40, t: 1764050000000 })
    const s = inkStrokes(d)
    expect(s.map((x) => [x.id, x.g, x.pen, x.c, x.seed])).toEqual([
      ['r8f2k1zq', 'k2m9q4ta', 'pen', '#1d2421', 3270201521],
      ['x0c3vd7p', 'k2m9q4ta', 'pen', '#2459c6', 118],
      ['m4n5b6v7', 'k2m9q4ta', 'marker', '#ffd84d', null],
      ['q1w2e3r4', 'p7x0c3vd', 'pencil', '#12805a', 42],
    ])
  })

  it('手改的写法：键的顺序随便、转义、\\r\\n、重复的键、点列坏了的行', () => {
    const d = parseInk(INK_HAND)
    expect(d.lines.map((l) => l.kind)).toEqual(['head', 'group', 'stroke', 'stroke', 'other'])
    const s = inkStrokes(d)
    expect(s[0]!.id).toBe('bb')
    expect(s[0]!.pen).toBe('pen')
    expect(decodePoints(s[1]!.p)).toBeNull()
    expect(inkGroups(d).get('aa')!.x).toBe(-3.25)
  })

  it('改了一笔：只有那一行变，认不出的键原样跟在后面', () => {
    const d = parseInk(INK_DOC)
    const out = printInk(recolorInk(d, ['q1w2e3r4'], '#2459c6', { now: 1764059999999 }))
    expect(changedLines(INK_DOC, out)).toEqual([6])
    expect(lines(out)[6]).toMatch(/^\{"id":"q1w2e3r4","g":"p7x0c3vd","pen":"pencil","c":"#2459c6","seed":42,"t":1764059999999,"p":"[^"]+","by":\{"device":"iPad"\}\}$/)
  })
})

describe('点列', () => {
  it('写成差分整数、解开回来：精度 0.01 点、力 0.001、时间毫秒', () => {
    const r = rng(7)
    for (const o of [{}, { tilt: true }, { shape: true }]) {
      const pts = synthStroke(r, 100.004, -20.006, 40, o)
      const p = encodePoints(pts)
      const back = decodePoints(p)!
      expect(back).toHaveLength(40)
      back.forEach((b, i) => {
        expect(Math.abs(b.x - pts[i]!.x)).toBeLessThanOrEqual(0.005 + 1e-9)
        expect(Math.abs(b.y - pts[i]!.y)).toBeLessThanOrEqual(0.005 + 1e-9)
        expect(Math.abs(b.f - pts[i]!.f)).toBeLessThanOrEqual(0.0005 + 1e-9)
      })
      expect(encodePoints(back)).toBe(p)
      const n = p.split(';')[0]!.split(',').length
      expect(n).toBe('shape' in o ? 9 : 'tilt' in o ? 7 : 5)
    }
  })

  it('取整是 floor(v×倍数+0.5)：负的 .5 往上取', () => {
    expect(encodePoints([{ x: -0.005, y: 0.005, w: 1, f: 0.0005, t: 0.0005, az: 0, al: Math.PI / 2, h: 1, o: 1 }])).toBe('0,1,100,1,1')
    expect(fmt2(-0.005)).toBe('0')
    expect(fmt2(-0.015)).toBe('-0.01')
    expect(fmt2(1240)).toBe('1240')
    expect(fmt2(380.5)).toBe('380.5')
    expect(fmt2(12.05)).toBe('12.05')
    expect(fmt2(-3.2)).toBe('-3.2')
  })

  it('编号是 8 个 [0-9a-z]', () => {
    const r = rng(1)
    const ids = new Set(Array.from({ length: 1000 }, () => inkId(r)))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{8}$/)
  })
})

describe('改哪几行', () => {
  const now = 1764100000000
  it('挪一整组：只改组那一行', () => {
    const out = printInk(moveInk(parseInk(INK_DOC), ['r8f2k1zq', 'x0c3vd7p', 'm4n5b6v7'], 30, -12.5, { now }))
    expect(changedLines(INK_DOC, out)).toEqual([1])
    expect(lines(out)[1]).toBe(`{"g":"k2m9q4ta","x":1270,"y":368,"t":${now}}`)
  })

  it('只挪一组里的一笔：这一笔换进新组（原点挪过去），加一行组行，点不动', () => {
    const before = parseInk(INK_DOC)
    const out = printInk(moveInk(before, ['x0c3vd7p'], 10, 10, { now, newId: () => 'newgroup' }))
    const d = lineDiff(INK_DOC, out)
    expect(d.removed).toEqual([lines(INK_DOC)[3]])
    expect(d.added).toEqual([`{"g":"newgroup","x":1250,"y":390.5,"t":${now}}`, lines(INK_DOC)[3]!.replace('"g":"k2m9q4ta"', '"g":"newgroup"').replace('"seed":118,', `"seed":118,"t":${now},`)])
    const s = inkStrokes(parseInk(out)).find((x) => x.id === 'x0c3vd7p')!
    expect(s.p).toBe(inkStrokes(before).find((x) => x.id === 'x0c3vd7p')!.p)
  })

  it('挪挂在卡上的组：还挂着，相对卡的位置跟着变', () => {
    const out = printInk(moveInk(parseInk(INK_DOC), ['q1w2e3r4'], 5, 6, { now }))
    expect(changedLines(INK_DOC, out)).toEqual([5])
    expect(lines(out)[5]).toBe(`{"g":"p7x0c3vd","on":"a3","x":17,"y":46,"t":${now}}`)
  })

  it('改色：只改那几笔的行，已经是这个颜色的不动', () => {
    const out = printInk(recolorInk(parseInk(INK_DOC), ['r8f2k1zq', 'x0c3vd7p'], '#2459c6', { now }))
    expect(changedLines(INK_DOC, out)).toEqual([2])
  })

  it('删：删那几笔的行，组里没笔了组行也删', () => {
    const one = printInk(deleteInk(parseInk(INK_DOC), ['m4n5b6v7']))
    expect(lineDiff(INK_DOC, one)).toEqual({ removed: [lines(INK_DOC)[4]], added: [] })
    const all = printInk(deleteInk(parseInk(INK_DOC), ['q1w2e3r4']))
    expect(lineDiff(INK_DOC, all)).toEqual({ removed: [lines(INK_DOC)[5], lines(INK_DOC)[6]], added: [] })
  })

  it('加一组：加在最后；没有文件时先有头一行', () => {
    const g = { id: 'aaaabbbb', on: null, x: 10, y: 20.256, t: null }
    const s = { id: 'ccccdddd', g: 'aaaabbbb', pen: 'pen', c: '#1d2421', seed: 9, t: null, from: null, p: '0,0,250,500,0' }
    expect(printInk(addInk(parseInk(''), g, [s]))).toBe('{"ink":1}\n{"g":"aaaabbbb","x":10,"y":20.26}\n{"id":"ccccdddd","g":"aaaabbbb","pen":"pen","c":"#1d2421","seed":9,"p":"0,0,250,500,0"}\n')
    const out = printInk(addInk(parseInk(INK_DOC), g, [s]))
    expect(out.startsWith(INK_DOC)).toBe(true)
  })
})

describe('两台设备都改了：按编号三方合并，不出副本', () => {
  const get = (name: string) => INK_MERGE_CASES.find((c) => c.name === name)!
  it('两边都在文末各写了一组：都留下，keep 那边的在前，每一行都是原来的那一行', () => {
    const c = get('两边都在文末各写了一组')
    const r = mergeInk(c.base, c.local, c.remote, 'remote')
    expect(r.text).toBe(c.remote + c.local.slice(c.base.length))
    expect(mergeInk(c.base, c.local, c.remote, 'local').text).toBe(c.local + c.remote.slice(c.base.length))
    expect(r.clashes).toBe(0)
  })

  it('一边挪一组、另一边改了另一笔的色：两样都在', () => {
    const c = get('一边挪一组、另一边改色另一笔')
    const r = mergeInk(c.base, c.local, c.remote, 'remote').text
    expect(inkGroups(parseInk(r)).get('k2m9q4ta')!.x).toBe(1300)
    expect(inkStrokes(parseInk(r)).find((s) => s.id === 'q1w2e3r4')!.c).toBe('#d64545')
  })

  it('同一笔两边都改了：取 t 大的（后改的），不管 keep 哪边；t 一样取 keep 那边', () => {
    const c = get('同一笔两边都改了色：取后改的')
    for (const k of ['local', 'remote'] as const) {
      const r = mergeInk(c.base, c.local, c.remote, k)
      expect(inkStrokes(parseInk(r.text))[0]!.c).toBe('#2459c6')
      expect(r.clashes).toBe(1)
    }
    const t = get('同一笔两边都改了、时间一样：取 keep 那边')
    expect(inkStrokes(parseInk(mergeInk(t.base, t.local, t.remote, 'remote').text))[0]!.c).toBe('#e08a00')
    expect(inkStrokes(parseInk(mergeInk(t.base, t.local, t.remote, 'local').text))[0]!.c).toBe('#2459c6')
  })

  it('一边删了、一边改了：留改过的', () => {
    const c = get('一边删了一笔、一边改了它的色：留改过的')
    const r = mergeInk(c.base, c.local, c.remote, 'local').text
    expect(inkStrokes(parseInk(r)).find((s) => s.id === 'x0c3vd7p')!.c).toBe('#12805a')
  })

  it('一边删了整组、另一边往这组里加了一笔：新的那笔和组行留下，删掉的那几笔照删', () => {
    const c = get('一边删了整组、另一边往这组里加了一笔：组行留下')
    for (const k of ['local', 'remote'] as const) {
      const d = parseInk(mergeInk(c.base, c.local, c.remote, k).text)
      expect(inkGroups(d).has('k2m9q4ta')).toBe(true)
      expect(inkStrokes(d).map((s) => s.id)).toEqual(['q1w2e3r4', 'ipds0009'])
    }
  })

  it('两边都删了同一笔、一边在原处加了一笔：新的那笔插在原处', () => {
    const c = get('两边都删了同一笔、一边还在中间加了一笔')
    const r = mergeInk(c.base, c.local, c.remote, 'local').text
    expect(inkStrokes(parseInk(r)).map((s) => s.id)).toEqual(['r8f2k1zq', 'x0c3vd7p', 'ipds0003', 'q1w2e3r4'])
  })

  it('从没有文件到两边都写了：一个头一行，两边的笔都在', () => {
    const c = get('从没有文件到两边都写了')
    const r = mergeInk(c.base, c.local, c.remote, 'remote').text
    expect(r.match(/"ink"/g)).toHaveLength(1)
    expect(inkStrokes(parseInk(r)).map((s) => s.id)).toEqual(['ipds0004', 'macs0002'])
  })

  it('同步时的入口：.ink 按笔迹合、md 按段合、别的交回 null（照旧出副本）', () => {
    const c = get('两边都在文末各写了一组')
    expect(mergeVaultText('附件/白板/笔迹.ink', c.base, c.local, c.remote, 'remote')).toEqual({ text: mergeInk(c.base, c.local, c.remote, 'remote').text, copy: null, conflicts: [] })
    expect(mergeVaultText('白板.md', 'a\n', 'b\n', 'a\n', 'remote')!.text).toBe('b\n')
    expect(mergeVaultText('附件/手写/x/手写-1.drawing', '', 'a', 'b', 'remote')).toBeNull()
  })

  it('合出来的每一行都是某一边原来的那一行（擦断后另一边改了那一笔的除外）', () => {
    for (const c of INK_MERGE_CASES.filter((x) => !/另一边(改了|把它挪进)|改了原来那一笔|又擦断了其中一段/.test(x.name))) {
      for (const k of ['local', 'remote'] as const) {
        const all = new Set([...lines(c.base), ...lines(c.local), ...lines(c.remote)])
        for (const l of lines(mergeInk(c.base, c.local, c.remote, k).text)) expect(all.has(l), `${c.name}：${l.slice(0, 60)}`).toBe(true)
      }
    }
  })
})

describe('擦断一截（iPad 橡皮涂抹）：旧笔删、剩下的几段是新笔', () => {
  const now = 1764100000000
  const get = (name: string) => INK_MERGE_CASES.find((c) => c.name === name)!
  const ids = (t: string) => inkStrokes(parseInk(t)).map((s) => s.id)
  const pts = (t: string, id: string) => decodePoints(inkStrokes(parseInk(t)).find((s) => s.id === id)!.p)!

  it('一笔擦成两段：删那一行、在原处加两行，别的行一个字节不动；点是原来那几个点', () => {
    const out = eraseCase(INK_DOC, 'r8f2k1zq', [[0, 8], [14, 24]], ['piece001', 'piece002'], now)
    const d = lineDiff(INK_DOC, out)
    expect(d.removed).toEqual([lines(INK_DOC)[2]])
    expect(d.added).toHaveLength(2)
    expect(ids(out)).toEqual(['piece001', 'piece002', 'x0c3vd7p', 'm4n5b6v7', 'q1w2e3r4'])
    const [a, b] = inkStrokes(parseInk(out))
    expect(a).toMatchObject({ g: 'k2m9q4ta', pen: 'pen', c: '#1d2421', seed: 3270201521, t: now, from: 'r8f2k1zq' })
    expect(b!.from).toBe('r8f2k1zq')
    const all = pts(INK_DOC, 'r8f2k1zq')
    expect(pts(out, 'piece001').map((p) => [p.x, p.y])).toEqual(all.slice(0, 8).map((p) => [p.x, p.y]))
    expect(pts(out, 'piece002').map((p) => [p.x, p.y])).toEqual(all.slice(14).map((p) => [p.x, p.y]))
    // 打开再保存不变
    expect(printInk(parseInk(out))).toBe(out)
  })

  it('认不出的键照抄；擦光了就是删（组里没笔了组行也删）', () => {
    const out = eraseCase(INK_DOC, 'q1w2e3r4', [[0, 5]], ['piece003'], now)
    expect(out).toContain('"from":"q1w2e3r4","p":')
    expect(out).toContain(',"by":{"device":"iPad"}}')
    const gone = printInk(splitInk(parseInk(INK_DOC), 'q1w2e3r4', [[]], { now }))
    expect(gone).toBe(printInk(deleteInk(parseInk(INK_DOC), ['q1w2e3r4'])))
  })

  it('擦断出来的一段再擦断：from 是一串（最近的在前，最多 16 个）', () => {
    const once = eraseCase(INK_DOC, 'r8f2k1zq', [[0, 8], [14, 24]], ['piece001', 'piece002'], now)
    const twice = eraseCase(once, 'piece002', [[0, 3], [6, 10]], ['piece004', 'piece005'], now + 1)
    expect(inkStrokes(parseInk(twice)).find((s) => s.id === 'piece004')!.from).toBe('piece002 r8f2k1zq')
    const long = Array.from({ length: 20 }, (_, i) => `a${i}`).join(' ')
    expect(inkLineage({ id: 'x', from: long }).split(' ')).toHaveLength(16)
  })

  it('一边擦断、另一边没动：留擦剩的两段，另一边加的笔也在', () => {
    const c = get('一边擦断一笔、另一边没动它：留擦剩的两段')
    for (const k of ['local', 'remote'] as const) {
      const r = mergeInk(c.base, c.local, c.remote, k)
      expect(ids(r.text)).toEqual(['ipdc0001', 'ipdc0002', 'x0c3vd7p', 'm4n5b6v7', 'q1w2e3r4', 'macs0010'].filter(Boolean).sort((a, b) => ids(r.text).indexOf(a) - ids(r.text).indexOf(b)))
      expect(ids(r.text)).not.toContain('r8f2k1zq')
      expect(ids(r.text)).toContain('macs0010')
      expect(r.clashes).toBe(0)
    }
  })

  it('一边擦断、另一边改了色：原来那笔不回来，两段换成改的色', () => {
    const c = get('一边擦断一笔、另一边改了它的色：它不回来，两段换成改的色')
    for (const k of ['local', 'remote'] as const) {
      const r = mergeInk(c.base, c.local, c.remote, k)
      const ss = inkStrokes(parseInk(r.text))
      expect(ss.map((s) => s.id)).toEqual(['ipdc0001', 'ipdc0002', 'x0c3vd7p', 'm4n5b6v7', 'q1w2e3r4'])
      expect(ss.slice(0, 2).map((s) => s.c)).toEqual(['#2459c6', '#2459c6'])
      expect(ss[0]!.t).toBe(1764095000500)
      expect(r.clashes).toBe(1)
    }
  })

  it('一边擦断、另一边把这一笔挪进了新组：两段跟进新组（挪的位置不丢）', () => {
    const c = get('一边擦断一笔、另一边把它挪进了新组：两段跟进新组')
    for (const k of ['local', 'remote'] as const) {
      const d = parseInk(mergeInk(c.base, c.local, c.remote, k).text)
      expect(inkStrokes(d).filter((s) => s.from === 'r8f2k1zq').map((s) => s.g)).toEqual(['macmvg01', 'macmvg01'])
      expect(inkGroups(d).get('macmvg01')).toMatchObject({ x: 1270, y: 390.5 })
      expect(ids(printInk(d))).not.toContain('r8f2k1zq')
    }
  })

  it('两边都擦断了同一笔：只留一边的几段（后擦的；一样取 keep 那边），不会叠在一起', () => {
    const c = get('两边擦断同一笔不同的地方：留后擦的那边')
    for (const k of ['local', 'remote'] as const) {
      const r = mergeInk(c.base, c.local, c.remote, k)
      expect(ids(r.text).slice(0, 2)).toEqual(['macc0001', 'macc0002'])
      expect(ids(r.text)).not.toContain('ipdc0001')
      expect(r.clashes).toBe(1)
    }
    const t = get('两边擦断同一笔、时间一样：留 keep 那边')
    expect(ids(mergeInk(t.base, t.local, t.remote, 'local').text)[0]).toBe('macc0003')
    expect(ids(mergeInk(t.base, t.local, t.remote, 'remote').text).slice(0, 2)).toEqual(['ipdc0001', 'ipdc0002'])
  })

  it('擦断两次的、另一边改了原来那一笔：认得出一串里的那一笔，剩下的三段都换色', () => {
    const c = get('擦断出来的一段又擦断了、另一边改了原来那一笔的色')
    const ss = inkStrokes(parseInk(mergeInk(c.base, c.local, c.remote, 'remote').text))
    expect(ss.slice(0, 3).map((s) => [s.id, s.c])).toEqual([['ipdc0001', '#d64545'], ['ipdc0003', '#d64545'], ['ipdc0004', '#d64545']])
    expect(ss.map((s) => s.id)).not.toContain('r8f2k1zq')
  })

  it('一边擦断、另一边整笔删了：留擦剩的（删和改一样，留改的那边）', () => {
    const c = get('一边擦断一笔、另一边整笔删了：留擦剩的几段')
    expect(ids(mergeInk(c.base, c.local, c.remote, 'local').text).slice(0, 2)).toEqual(['ipdc0001', 'ipdc0002'])
  })

  it('同步过的那一段又擦断、另一边改了它的色', () => {
    const c = get('擦断的那两段已经同步过、一边又擦断了其中一段')
    const ss = inkStrokes(parseInk(mergeInk(c.base, c.local, c.remote, 'local').text))
    expect(ss.slice(0, 3).map((s) => [s.id, s.c])).toEqual([['ipdc0005', '#12805a'], ['ipdc0006', '#12805a'], ['ipdc0002', '#1d2421']])
  })

  it('别的行种类（以后加的贴纸、胶带这些，读不懂的行）合并时原样留着', () => {
    const base = INK_DOC
    const local = base + '{"sticker":"s1","x":10,"y":20}\n'
    const remote = eraseCase(base, 'r8f2k1zq', [[0, 8]], ['ipdc0009'], now)
    for (const k of ['local', 'remote'] as const) expect(mergeInk(base, local, remote, k).text).toContain('{"sticker":"s1","x":10,"y":20}\n')
  })
})

describe('挂卡：卡要有编号，那一行带 ink=1', () => {
  const units = () => {
    const b = splitDoc(INK_CARD_DOC)
    return [...b.columns.flatMap((c) => c.cards.filter((u) => u.kind !== 'gap')), ...b.placed]
  }
  it('列里没编号的卡：前面加一行只记编号的；有编号的加 ink=1；空白处的卡位置行加 ink=1', () => {
    const us = units()
    const a = inkCardId(INK_CARD_DOC, us[0]!)
    expect(a.id).toBe('k2')
    expect(lineDiff(INK_CARD_DOC, a.text)).toEqual({ removed: [], added: ['<!-- card id=k2 ink=1 -->'] })
    const b = inkCardId(INK_CARD_DOC, us[1]!)
    expect(b.id).toBe('d2')
    expect(lineDiff(INK_CARD_DOC, b.text)).toEqual({ removed: ['<!-- card id=d2 -->'], added: ['<!-- card id=d2 ink=1 -->'] })
    const placed = us.find((u) => u.place)!
    const c = inkCardId(INK_CARD_DOC, placed)
    expect(lineDiff(INK_CARD_DOC, c.text)).toEqual({ removed: ['<!-- card id=k1 x=900 y=120 color=yellow -->'], added: ['<!-- card id=k1 x=900 y=120 color=yellow ink=1 -->'] })
    // 已经带着的原样
    const again = splitDoc(c.text).placed[0]!
    expect(inkCardId(c.text, again).text).toBe(c.text)
  })

  it('带 ink=1 的卡：摆回原样、拖回列里、再拖出去编号都留着', () => {
    const us = units()
    const a = inkCardId(INK_CARD_DOC, us[0]!)
    const out = resetLayout(a.text)
    expect(out).toContain('<!-- card id=k2 ink=1 -->')
    const placed = inkCardId(INK_CARD_DOC, us.find((u) => u.place)!).text
    const back = unplaceUnit(placed, splitDoc(placed).placed[0]!)
    expect(back).toContain('<!-- card id=k1 color=yellow ink=1 -->')
    const b2 = splitDoc(a.text)
    const k2 = b2.columns.flatMap((c) => c.cards).find((u) => u.tag?.id === 'k2')!
    expect(placeUnit(a.text, k2, 500, 60)).toContain('<!-- card id=k2 x=500 y=60 ink=1 -->')
  })
})

describe('深色主题下的颜色（照 PencilKit 实测）', () => {
  it('亮度反过来、色相饱和度不变', () => {
    // 右边是 macOS PencilKit 在 darkAqua 下画出来的颜色（scratch 量的，2026-11-25）
    const pk: [string, string][] = [
      ['#1d2421', '#dbe2df'],
      ['#2459c6', '#396edb'],
      ['#d64545', '#ba2929'],
      ['#12805a', '#7fedc7'],
      ['#e08a00', '#ffa91f'],
      ['#ffd84d', '#b28b00'],
      ['#9be3b7', '#1c6438'],
      ['#ffb3c7', '#4c0014'],
      ['#000000', '#ffffff'],
      ['#808080', '#7f7f7f'],
      ['#ff0000', '#ff0000'],
      ['#4a4a4a', '#b5b5b5'],
    ]
    for (const [a, b] of pk) expect(darkInk(a)).toBe(b)
    expect(darkInk('#1d242180')).toBe('#dbe2df80')
    expect(darkInk('red')).toBe('red')
  })
})
