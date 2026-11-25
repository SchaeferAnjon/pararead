import { describe, expect, it } from 'vitest'
import {
  addDecor,
  addNote,
  cardStyleOf,
  decorLineText,
  decorPlace,
  deleteDecors,
  inkDecors,
  inkStrokes,
  mergeInk,
  mergeVaultText,
  noteOf,
  parseDecorLine,
  parseInk,
  printInk,
  raiseDecor,
  setCardAttrs,
  setColumnAttrs,
  snapRotation,
  snapTape,
  splitDoc,
  STICKERS,
  tapeAnchor,
  updateDecor,
} from '../src'
import { DECOR_CARD_DOC, DECOR_DOC, DECOR_MERGE_CASES } from './ink-decor-cases'
import { INK_DOC } from './ink-cases'

// 白板装饰（设计页 145，2026-11-25 用户定）：贴纸、胶带存进笔迹文件一样一行，md 一个字不多；规矩见 packages/format/src/ink-decor.ts 开头

describe('装饰行：读', () => {
  const ds = inkDecors(parseInk(DECOR_DOC))
  it('认出四样（胶带两段、贴纸三张里手改的一张也认），坏的两行不认', () => {
    expect(ds.map((d) => `${d.kind}:${d.id}`)).toEqual(['tape:t1aaaaaa', 'tape:t2bbbbbb', 'sticker:s1cccccc', 'sticker:s2dddddd', 'sticker:s3eeeeee'])
  })
  it('挂卡的胶带记 on 和 at，没有 x、y；钉在白板上的记中心', () => {
    expect(ds[0]).toMatchObject({ kind: 'tape', on: 'a3', at: 'tl', pat: 'mint', len: 80, rot: -40, seed: 2, t: null })
    expect(ds[1]).toMatchObject({ kind: 'tape', on: null, at: null, x: 1240, y: 380.25, t: 1764050000000 })
  })
  it('自带贴纸记 k，拖进来的图记 src，认不出的键留着', () => {
    expect(ds[2]).toMatchObject({ kind: 'sticker', k: 'coffee', src: null, on: null, x: 648, y: 50, w: 76, rot: 10 })
    expect(ds[3]).toMatchObject({ kind: 'sticker', k: null, src: '附件/手环.png', on: 'k1', y: -12.5, extra: [['by', '{"device":"iPad"}']] })
  })
  it('笔画、组照旧（装饰行在 ink.ts 里是认不出的行）', () => {
    expect(inkStrokes(parseInk(DECOR_DOC)).length).toBe(inkStrokes(parseInk(INK_DOC)).length)
    expect(parseInk(DECOR_DOC).lines.filter((l) => l.kind === 'other').length).toBe(8)
  })
  it('不是装饰的行不认：笔画、组、头一行、k 和 src 都有、len 不是正数、at 不在八个里、at 没有 on', () => {
    for (const raw of ['{"ink":1}', '{"g":"a","x":1,"y":2}', '{"id":"a","g":"b","p":""}', '{"tape":"a","sticker":"b","pat":"mint","len":3}', '{"tape":"a","on":"k","at":"mid","pat":"mint","len":3}', '{"tape":"a","at":"tl","pat":"mint","len":3}', '{"sticker":"a","w":10}', '{"sticker":"a","k":"star","w":0}', '{"tape":"a","pat":"mint","len":3,"seed":1.5}', 'not json'])
      expect(parseDecorLine(raw), raw).toBeNull()
  })
})

describe('打开再保存不变', () => {
  it('整份原样写回，一个字节不差', () => {
    expect(printInk(parseInk(DECOR_DOC))).toBe(DECOR_DOC)
  })
  it('程序写的装饰行照固定写法再写一遍和原来一样', () => {
    for (const raw of DECOR_DOC.split('\n').slice(-8, -4)) {
      const d = parseDecorLine(raw)!
      expect(decorLineText(d)).toBe(raw)
    }
  })
})

describe('改装饰：只动那一行', () => {
  const doc = parseInk(DECOR_DOC)
  const lines = DECOR_DOC.split('\n')
  it('加一张贴纸加在文末一行', () => {
    const out = printInk(addDecor(doc, { kind: 'sticker', id: 'n1n1n1n1', k: 'star', src: null, on: null, x: 10.123, y: 20, w: 76, rot: -3.5, t: null }))
    expect(out).toBe(DECOR_DOC + '{"sticker":"n1n1n1n1","k":"star","x":10.12,"y":20,"w":76,"rot":-3.5}\n')
  })
  it('没有文件时先加头一行', () => {
    expect(printInk(addDecor(parseInk(''), { kind: 'tape', id: 'n2n2n2n2', on: 'k1', at: 'br', x: 0, y: 0, pat: 'dots', len: 84, rot: -38, seed: 5, t: null }))).toBe('{"ink":1}\n{"tape":"n2n2n2n2","on":"k1","at":"br","pat":"dots","len":84,"rot":-38,"seed":5}\n')
  })
  it('挪贴纸只改它那一行，记上 t；认不出的键留着', () => {
    const out = printInk(updateDecor(doc, 'sticker', 's2dddddd', { x: 130, rot: 0 }, 1764100000000)).split('\n')
    const diff = out.map((l, i) => (l === lines[i] ? null : i)).filter((i) => i !== null)
    expect(diff).toEqual([lines.findIndex((l) => l.includes('s2dddddd'))])
    expect(out[diff[0]!]).toBe('{"sticker":"s2dddddd","src":"附件/手环.png","on":"k1","x":130,"y":-12.5,"w":200,"rot":0,"t":1764100000000,"by":{"device":"iPad"}}')
  })
  it('改成和原来一样：不动', () => {
    expect(updateDecor(doc, 'tape', 't1aaaaaa', { pat: 'mint' }, 5)).toBe(doc)
  })
  it('胶带从卡上撕下来钉到白板上：去掉 on、at，记中心', () => {
    const out = printInk(updateDecor(doc, 'tape', 't1aaaaaa', { on: null, at: null, x: 400, y: 90 }, 7))
    expect(out).toContain('{"tape":"t1aaaaaa","x":400,"y":90,"pat":"mint","len":80,"rot":-40,"seed":2,"t":7}\n')
  })
  it('删一样删那一行', () => {
    const out = printInk(deleteDecors(doc, ['tape:t2bbbbbb', 'sticker:nope']))
    expect(out).toBe(DECOR_DOC.replace(/^\{"tape":"t2bbbbbb".*\n/m, ''))
  })
  it('放到最上面：那一行挪到文末，字不变', () => {
    const out = printInk(raiseDecor(doc, 'sticker', 's1cccccc'))
    const line = lines.find((l) => l.includes('s1cccccc'))!
    expect(out).toBe(DECOR_DOC.replace(line + '\n', '') + line + '\n')
    expect(inkDecors(parseInk(out)).at(-1)!.id).toBe('s1cccccc')
  })
})

describe('两台设备都改了：装饰行按编号三方合并', () => {
  const byName = (n: string) => DECOR_MERGE_CASES.find((c) => c.name === n)!
  it('两边各贴了一样：都留下，keep 那边在前', () => {
    const c = byName('两边各贴了一样')
    const r = mergeInk(c.base, c.local, c.remote, 'local')
    expect(r.text).toBe(c.local + c.remote.slice(c.base.length))
    expect(r.clashes).toBe(0)
  })
  it('一边挪贴纸、另一边换胶带花样：两样都要', () => {
    const c = byName('一边挪贴纸、另一边换胶带花样')
    const ds = inkDecors(parseInk(mergeInk(c.base, c.local, c.remote, 'remote').text))
    expect(ds.find((d) => d.id === 's1cccccc')).toMatchObject({ x: 700 })
    expect(ds.find((d) => d.id === 't2bbbbbb')).toMatchObject({ pat: 'kraft' })
  })
  it('同一张两边都挪了：取 t 大的；t 一样取 keep 那边；不出两张', () => {
    const c = byName('同一张贴纸两边都挪了：取后挪的')
    for (const k of ['local', 'remote'] as const) {
      const r = mergeInk(c.base, c.local, c.remote, k)
      const ds = inkDecors(parseInk(r.text)).filter((d) => d.id === 's1cccccc')
      expect(ds).toHaveLength(1)
      expect(ds[0]).toMatchObject({ x: 700 })
      expect(r.text.match(/s1cccccc/g)).toHaveLength(1)
      expect(r.clashes).toBe(1)
    }
    const s = byName('同一张贴纸两边都挪了、时间一样：取 keep 那边')
    expect(inkDecors(parseInk(mergeInk(s.base, s.local, s.remote, 'local').text)).find((d) => d.id === 's1cccccc')).toMatchObject({ x: 700 })
    expect(inkDecors(parseInk(mergeInk(s.base, s.local, s.remote, 'remote').text)).find((d) => d.id === 's1cccccc')).toMatchObject({ x: 500 })
  })
  it('一边删了、一边挪了：留挪过的', () => {
    const c = byName('一边删了贴纸、另一边挪了它：留挪过的')
    expect(inkDecors(parseInk(mergeInk(c.base, c.local, c.remote, 'local').text)).find((d) => d.id === 's1cccccc')).toMatchObject({ x: 520 })
  })
  it('一边放到最上面、另一边写了一笔：贴纸在最上面，新笔也在', () => {
    const c = byName('一边放到最上面、另一边写了一笔')
    const d = parseInk(mergeInk(c.base, c.local, c.remote, 'local').text)
    expect(inkDecors(d).at(-1)!.id).toBe('s1cccccc')
    expect(inkStrokes(d).some((s) => s.id === 'ipds0005')).toBe(true)
  })
  it('两边都删了同一样：没了', () => {
    const c = byName('两边都删了同一样')
    expect(mergeInk(c.base, c.local, c.remote, 'local').text).not.toContain('t2bbbbbb')
  })
  it('一边橡皮擦断一笔（ink-b2 的 from）、另一边挪了贴纸：擦剩的两段和挪过的贴纸都在，装饰行一样不少', () => {
    const c = byName('一边橡皮擦断一笔、另一边挪了贴纸')
    for (const k of ['local', 'remote'] as const) {
      const d = parseInk(mergeInk(c.base, c.local, c.remote, k).text)
      expect(inkStrokes(d).map((s) => s.id)).toEqual(expect.arrayContaining(['ipdc0101', 'ipdc0102']))
      expect(inkStrokes(d).some((s) => s.id === 'r8f2k1zq')).toBe(false)
      expect(inkDecors(d).map((x) => x.id)).toEqual(['t1aaaaaa', 't2bbbbbb', 's1cccccc', 's2dddddd', 's3eeeeee'])
      expect(inkDecors(d).find((x) => x.id === 's1cccccc')).toMatchObject({ x: 610 })
    }
  })
  it('同步时 .ink 走这一套，不出副本', () => {
    const c = byName('同一张贴纸两边都挪了：取后挪的')
    const r = mergeVaultText('附件/组会/笔迹.ink', c.base, c.local, c.remote, 'remote')!
    expect(r.copy).toBeNull()
    expect(r.text.match(/s1cccccc/g)).toHaveLength(1)
  })
})

describe('胶带吸附、位置', () => {
  const card = { id: 'k1', x: 100, y: 200, w: 400, h: 300 }
  it('八个吸附位：四角斜 40°、四边中点', () => {
    expect(tapeAnchor(card, 'tl')).toEqual({ x: 100, y: 200, rot: -40 })
    expect(tapeAnchor(card, 'br')).toEqual({ x: 500, y: 500, rot: -40 })
    expect(tapeAnchor(card, 't')).toEqual({ x: 300, y: 200, rot: 0 })
    expect(tapeAnchor(card, 'r')).toEqual({ x: 500, y: 350, rot: 90 })
  })
  it('36 以内吸住最近的，远了不吸', () => {
    expect(snapTape([card], 120, 215)).toMatchObject({ on: 'k1', at: 'tl' })
    expect(snapTape([card], 300, 230)).toMatchObject({ on: 'k1', at: 't' })
    expect(snapTape([card], 300, 237)).toBeNull()
    expect(snapTape([card, { id: 'k2', x: 500, y: 200, w: 200, h: 100 }], 500, 200)).toMatchObject({ on: 'k2', at: 'tl' })
  })
  it('挂卡的跟着卡走，卡没了不画', () => {
    const t = inkDecors(parseInk(DECOR_DOC))
    const rect = (id: string) => (id === 'a3' ? { x: 10, y: 20, w: 400, h: 100 } : id === 'k1' ? { x: 1000, y: 0, w: 400, h: 100 } : null)
    expect(decorPlace(t[0]!, rect)).toEqual({ x: 10, y: 20, rot: -40 })
    expect(decorPlace(t[3]!, rect)).toEqual({ x: 1120, y: -12.5, rot: -6 })
    expect(decorPlace(t[3]!, () => null)).toBeNull()
    expect(decorPlace(t[1]!, () => null)).toEqual({ x: 1240, y: 380.25, rot: -18 })
  })
  it('挂在歪着的便签上：位置和角度绕便签中心一起转', () => {
    const t = inkDecors(parseInk(DECOR_DOC))
    const note = (id: string) => (id === 'a3' ? { x: 0, y: 0, w: 200, h: 200, rot: 90 } : null)
    const p = decorPlace(t[0]!, note)!
    expect(p.x).toBeCloseTo(200)
    expect(p.y).toBeCloseTo(0)
    expect(p.rot).toBe(50)
  })
  it('转贴纸靠近 0°、±15°、±90° 吸一下', () => {
    expect(snapRotation(1.5)).toBe(0)
    expect(snapRotation(-16.9)).toBe(-15)
    expect(snapRotation(88)).toBe(90)
    expect(snapRotation(30.04)).toBe(30)
    expect(snapRotation(358)).toBe(0)
  })
  it('自带贴纸 36 张', () => {
    expect(STICKERS).toHaveLength(36)
    expect(new Set(STICKERS).size).toBe(36)
  })
})

describe('卡片样式、便签、列样式写在 md 注释行', () => {
  const b = splitDoc(DECOR_CARD_DOC)
  const [c0, c1, c2] = b.columns
  it('列名下面紧跟的样式行读进列；有 x、y 的不算', () => {
    expect(c0!.attrs).toEqual({ style: 'header', color: '2' })
    expect(c0!.styleLine).toBeDefined()
    expect(c1!.attrs).toBeUndefined()
    expect(c2!.attrs).toBeUndefined()
    // 样式行不成卡
    expect(c0!.cards.map((u) => u.text)).toEqual(['驾驶压力识别 + 图网络。', '情绪识别：E4 手环。'])
  })
  it('卡的 style、color；便签 note、rot', () => {
    expect(cardStyleOf(c0!.cards[1]!.attrs)).toEqual({ style: 'outline', color: 1 })
    expect(cardStyleOf(c0!.cards[0]!.attrs)).toEqual({ style: 'paper', color: null })
    expect(cardStyleOf({ style: 'neon', color: '9' })).toEqual({ style: 'paper', color: null })
    expect(noteOf(b.placed[0]!)).toEqual({ color: 'pink', rot: -2.5, w: 200, h: 200 })
    expect(noteOf(c0!.cards[0]!)).toBeNull()
  })
  it('改卡样式：有注释行改那一行，没有加一行只记编号的', () => {
    const t1 = setCardAttrs(DECOR_CARD_DOC, c0!.cards[1]!, { style: 'header', color: '3' })
    expect(t1).toBe(DECOR_CARD_DOC.replace('<!-- card id=d2 style=outline color=1 -->', '<!-- card id=d2 style=header color=3 -->'))
    const t2 = setCardAttrs(DECOR_CARD_DOC, c0!.cards[0]!, { style: 'glass' })
    expect(t2).toBe(DECOR_CARD_DOC.replace('驾驶压力', '<!-- card id=k1 style=glass -->\n驾驶压力'))
    const t3 = setCardAttrs(DECOR_CARD_DOC, c0!.cards[1]!, { style: null, color: null })
    expect(t3).toBe(DECOR_CARD_DOC.replace('<!-- card id=d2 style=outline color=1 -->', '<!-- card id=d2 -->'))
    // 摆在空白处的卡：位置不变
    const t4 = setCardAttrs(DECOR_CARD_DOC, b.placed[0]!, { note: 'blue' })
    expect(t4).toContain('<!-- card id=n3 x=250 y=498 note=blue rot=-2.5 -->')
    // 和原来一样：一个字节不动
    expect(setCardAttrs(DECOR_CARD_DOC, c0!.cards[1]!, { style: 'outline' })).toBe(DECOR_CARD_DOC)
    expect(setCardAttrs(DECOR_CARD_DOC, c0!.cards[0]!, { style: null })).toBe(DECOR_CARD_DOC)
  })
  it('改列样式：有样式行改那一行，没有加在列名下面，全去掉删整行', () => {
    expect(setColumnAttrs(DECOR_CARD_DOC, c0!, { color: '4' })).toBe(DECOR_CARD_DOC.replace('<!-- column style=header color=2 -->', '<!-- column style=header color=4 -->'))
    expect(setColumnAttrs(DECOR_CARD_DOC, c0!, { style: null, color: null })).toBe(DECOR_CARD_DOC.replace('<!-- column style=header color=2 -->\n', ''))
    const t = setColumnAttrs(DECOR_CARD_DOC, c1!, { style: 'lined' })
    expect(t).toBe(DECOR_CARD_DOC.replace('## 这周\n', '## 这周\n<!-- column style=lined -->\n'))
    expect(splitDoc(t).columns[1]!.attrs).toEqual({ style: 'lined' })
    expect(splitDoc(t).columns[1]!.cards).toHaveLength(1)
  })
  it('新便签：摆在空白处的一张卡，带纸色和角度', () => {
    const t = addNote(DECOR_CARD_DOC, '带半页纸草稿', 600, 300, 'yellow', 2.345)
    expect(t).toBe(DECOR_CARD_DOC + '\n<!-- card id=d1 x=600 y=300 note=yellow rot=2.35 -->\n带半页纸草稿\n')
    expect(noteOf(splitDoc(t).placed.at(-1)!)).toEqual({ color: 'yellow', rot: 2.35, w: 200, h: 200 })
  })
})
