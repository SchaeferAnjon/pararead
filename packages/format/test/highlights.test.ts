import { describe, expect, it } from 'vitest'
import {
  addKind,
  type AskSection,
  confusedAsk,
  confusedOf,
  confusedQ,
  confusedTitle,
  countKindIn,
  DEFAULT_KINDS,
  doubtItems,
  highlightsOf,
  hlLine,
  keepConfused,
  kindsJson,
  newReadingNote,
  nextHlId,
  openConfused,
  parseKinds,
  parseReadingNote,
  plainQ,
  removeHighlight,
  renameKindIn,
  upsertHighlight,
  upsertSection,
} from '../src'

const NOTE = '课程/study project 2/BST 笔记.md'
const PDF = '课程/study project 2/BST.pdf'

/** 设计 20-pararead联动「写进笔记的样子」那一段，一字不差 */
const SAMPLE = `---
类型: 笔记
来源: "[[BST.pdf]]"
---
# BST 笔记

## 第 2 页 · 划的线
- ==we selected the AffectiveROAD dataset [14],== · 重点 · [第 2 页](BST.pdf#page=2&rect=0.192,0.498,0.318,0.018) <!-- cn:hl=p2-h1 k=key -->
- ==EDA and TEMP (4 Hz), BVP (64 Hz), ACC (32 Hz), and HR (1 Hz)== · 想引用 · [第 2 页](BST.pdf#page=2&rect=0.08,0.724,0.428,0.033) <!-- cn:hl=p2-h3 k=cite -->
- ==implicit fully-connected topology== · 定义 · [第 2 页](BST.pdf#page=2&rect=0.619,0.755,0.24,0.018) <!-- cn:hl=p2-h4 k=def -->

## 第 2 页 · 看不懂：Bi-LSTM 为什么放在注意力后面
[第 2 页](BST.pdf#page=2&rect=0.51,0.635,0.437,0.033) · 16:44 <!-- cn:thread=BST-p2-5 -->

> [!question] 看不懂
> ==a Bi-LSTM is introduced as a temporal refinement layer== <!-- cn:hl=p2-h6 k=confused -->
`

describe('划线写法（ParaRead 联动）', () => {
  it('读回来：三条划的线 + 一处看不懂，页码、框、路径都对', () => {
    const hs = highlightsOf(SAMPLE, NOTE)
    expect(hs.map((h) => [h.id, h.key, h.page, h.name])).toEqual([
      ['p2-h1', 'key', 2, '重点'],
      ['p2-h3', 'cite', 2, '想引用'],
      ['p2-h4', 'def', 2, '定义'],
      ['p2-h6', 'confused', 2, '看不懂'],
    ])
    expect(hs[0]!.file).toBe(PDF)
    expect(hs[0]!.rect).toEqual([0.192, 0.498, 0.318, 0.018])
    expect(hs[2]!.text).toBe('implicit fully-connected topology')
    expect(hs[3]).toMatchObject({ thread: '.canvas-notes/对话/BST-p2-5.md', asked: false, understood: false, rect: [0.51, 0.635, 0.437, 0.033] })
    expect(openConfused(hs)).toHaveLength(1)
  })

  it('往返：每一条照读回来的写回去、问题段照读回来的写回去，一个字节都不变', () => {
    let md = SAMPLE
    const names = Object.fromEntries(DEFAULT_KINDS.map((k) => [k.key, k.name]))
    for (const h of highlightsOf(SAMPLE, NOTE).filter((x) => x.key !== 'confused')) md = upsertHighlight(md, h, NOTE, names[h.key]!)
    for (const s of parseReadingNote(md, NOTE)) md = upsertSection(md, s, NOTE)
    expect(md).toBe(SAMPLE)
  })

  it('新的一条接在这一页那一段最后；没有那一页就新起一段，排在后面几页前面', () => {
    const h = { id: nextHlId(SAMPLE, 2), key: 'key', text: 'The dataset comprises 13\ndistinct  driving sessions', page: 2, rect: [0.1, 0.2, 0.3, 0.04] as [number, number, number, number], file: PDF }
    expect(h.id).toBe('p2-h7')
    const md = upsertHighlight(SAMPLE, h, NOTE, '重点')
    expect(md).toContain('<!-- cn:hl=p2-h4 k=def -->\n- ==The dataset comprises 13 distinct driving sessions== · 重点 · [第 2 页](BST.pdf#page=2&rect=0.1,0.2,0.3,0.04) <!-- cn:hl=p2-h7 k=key -->\n\n## 第 2 页 · 看不懂')
    const p1 = upsertHighlight(md, { id: 'p1-h1', key: 'cite', text: 'BST-GATNet', page: 1, file: PDF }, NOTE, '想引用')
    expect(p1).toContain('# BST 笔记\n\n## 第 1 页 · 划的线\n- ==BST-GATNet== · 想引用 · [第 1 页](BST.pdf#page=1) <!-- cn:hl=p1-h1 k=cite -->\n\n## 第 2 页 · 划的线')
    const p9 = upsertHighlight(md, { id: 'p9-h1', key: 'key', text: 'x', page: 9, file: PDF }, NOTE, '重点')
    expect(p9.endsWith('k=confused -->\n\n## 第 9 页 · 划的线\n- ==x== · 重点 · [第 9 页](BST.pdf#page=9) <!-- cn:hl=p9-h1 k=key -->\n')).toBe(true)
    // 删掉：只删那一行；那一段删空了连标题一起去掉，回到原样
    expect(removeHighlight(p1, 'p1-h1', NOTE)).toBe(md)
    expect(removeHighlight(md, 'p2-h7', NOTE)).toBe(SAMPLE)
  })

  it('改含义：同一个身份整行换掉', () => {
    const h = highlightsOf(SAMPLE, NOTE)[0]!
    const md = upsertHighlight(SAMPLE, { ...h, key: 'cite' }, NOTE, '想引用')
    expect(md.split('\n').filter((l) => l.includes('cn:hl=p2-h1'))).toEqual(['- ==we selected the AffectiveROAD dataset [14],== · 想引用 · [第 2 页](BST.pdf#page=2&rect=0.192,0.498,0.318,0.018) <!-- cn:hl=p2-h1 k=cite -->'])
  })

  it('原文里的 == 和换行不弄坏这一行', () => {
    const line = hlLine({ id: 'p3-h1', key: 'key', text: ' a == b\n c ==', page: 3, file: PDF }, NOTE, '重·点')
    expect(line).toBe('- ==a = b c== · 重 点 · [第 3 页](BST.pdf#page=3) <!-- cn:hl=p3-h1 k=key -->')
  })

  it('改名：只换这个键那几行的名字，问题段、别的字不动', () => {
    const r = renameKindIn(SAMPLE, 'key', '要点', NOTE)
    expect(r.n).toBe(1)
    expect(r.text).toBe(SAMPLE.replace('[14],== · 重点 ·', '[14],== · 要点 ·'))
    expect(countKindIn(SAMPLE, 'confused', NOTE)).toBe(1)
  })

  it('看不懂：问题段的问题、问 AI 以后换回原来那一问、出卡不算没回答的', () => {
    const q = confusedQ({ id: 'p2-h6', text: 'a Bi-LSTM is introduced' })
    expect(q).toBe('看不懂\n==a Bi-LSTM is introduced== <!-- cn:hl=p2-h6 k=confused -->')
    expect(confusedOf(q)).toEqual({ id: 'p2-h6', text: 'a Bi-LSTM is introduced', name: '看不懂' })
    expect(plainQ(q)).toBe('看不懂：a Bi-LSTM is introduced')
    expect(confusedTitle('x'.repeat(40))).toBe(`看不懂：${'x'.repeat(28)}…`)
    const sec = parseReadingNote(SAMPLE, NOTE)[0]!
    expect(sec.qas).toEqual([{ q: '看不懂\n==a Bi-LSTM is introduced as a temporal refinement layer== <!-- cn:hl=p2-h6 k=confused -->', a: '', sides: [] }])
    // 没回答的不出卡、不算问过
    expect(doubtItems(PDF, sec)).toEqual([])
    const asked = keepConfused(sec, [{ q: confusedAsk('a Bi-LSTM is introduced as a temporal refinement layer'), a: '分两步看。', sides: [] }])
    expect(asked).toEqual([{ q: sec.qas![0]!.q, a: '分两步看。', sides: [] }])
    const after: AskSection = { ...sec, qas: asked }
    const md = upsertSection(SAMPLE, after, NOTE)
    expect(md.endsWith('> [!question] 看不懂\n> ==a Bi-LSTM is introduced as a temporal refinement layer== <!-- cn:hl=p2-h6 k=confused -->\n\n分两步看。\n')).toBe(true)
    const hs = highlightsOf(md, NOTE)
    expect(hs[3]).toMatchObject({ key: 'confused', asked: true })
    expect(openConfused(hs)).toHaveLength(0)
    expect(doubtItems(PDF, parseReadingNote(md, NOTE)[0]!).map((d) => d.section.doubts[0])).toEqual(['看不懂：a Bi-LSTM is introduced as a temporal refinement layer'])
    // 直接在那一段里接着问别的：看不懂那一问留在最前面
    expect(keepConfused(sec, [{ q: '还有别的', a: 'x', sides: [] }]).map((x) => x.q)).toEqual([sec.qas![0]!.q, '还有别的'])
  })

  it('新笔记里第一条划线：属性、标题后面起一段', () => {
    const md = upsertHighlight(newReadingNote(PDF, new Date(2026, 10, 23)), { id: 'p1-h1', key: 'key', text: 'abc', page: 1, file: PDF }, NOTE, '重点')
    expect(md.endsWith('# BST 笔记\n\n## 第 1 页 · 划的线\n- ==abc== · 重点 · [第 1 页](BST.pdf#page=1) <!-- cn:hl=p1-h1 k=key -->\n')).toBe(true)
  })
})

describe('含义表', () => {
  it('没有、坏了是默认四种；读回来再写一个字不差；少了看不懂补上', () => {
    expect(parseKinds(null)).toEqual(DEFAULT_KINDS)
    expect(parseKinds('{bad')).toEqual(DEFAULT_KINDS)
    const text = kindsJson(DEFAULT_KINDS)
    expect(kindsJson(parseKinds(text))).toBe(text)
    expect(parseKinds(JSON.stringify({ kinds: [{ key: 'key', name: '要点', color: 'yellow' }] })).map((k) => k.key)).toEqual(['key', 'confused'])
  })
  it('加一种：挑还没用的颜色', () => {
    const k = addKind(DEFAULT_KINDS, '方法')
    expect(k[4]).toEqual({ key: 'c1', name: '方法', color: 'orange' })
  })
})
