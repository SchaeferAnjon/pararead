import { describe, expect, it } from 'vitest'
import { cleanOutline, cleanSentences, fillOutline, plainText, ruleCheck, splitPunct, texEscape, toLatex, wordSegments } from '../src/shared/draft'
import { citeNums, edgeLine, findQuote, layoutGraph, mentions, refNumber, splitCell, squash, titleMarks } from '../src/shared/matrix'

// 一篇假论文：三页正文，最后一页是参考文献表
const pages = [
  'Abstract—In-memory computing reduces data movement. We present SIMPLER, a mapping\ntool that executes the whole func-\ntion in a single row.',
  'II. BACKGROUND\nMAGIC [12] performs a NOR gate in one cycle without altering the inputs. Kvatinsky et al. showed that MAGIC can be cascaded. Earlier stateful logic [3]–[5] overwrites one of its inputs, as noted in [4, 12].',
  'VI. RESULTS\nSince all rows execute in parallel, throughput improves over SIMPLE for every benchmark. This work does not address multiplication.\nREFERENCES\n[3] J. Borghetti et al., “‘Memristive’ switches enable ‘stateful’ logic operations via material implication,” Nature, 2010.\n[12] S. Kvatinsky et al., “MAGIC—Memristor-aided logic,” IEEE TCAS-II, vol. 61, 2014.'
]

describe('原文定位', () => {
  it('不管换行、断字、大小写都能找到原句在哪一页', () => {
    expect(findQuote(pages, 'We present SIMPLER, a mapping tool that executes the whole function in a single row.')).toBe(1)
    expect(findQuote(pages, 'Since all rows execute in parallel, throughput improves over SIMPLE for every benchmark.')).toBe(3)
    expect(findQuote(pages, 'A sentence that the paper never says about anything.')).toBeNull()
    expect(findQuote(pages, 'short')).toBeNull()
  })
  it('连字（ﬁ）按普通字母算', () => {
    expect(squash('efﬁcient')).toBe('efficient')
  })
  it('引用号展开', () => {
    expect(citeNums('as in [3]–[5] and [4, 12]').sort((a, b) => a - b)).toEqual([3, 4, 5, 12])
    expect(citeNums('see [2-4]')).toEqual([2, 3, 4])
    expect(citeNums('no cites here')).toEqual([])
  })
})

describe('一篇论文提到另一篇的句子', () => {
  it('在参考文献表里按题目找到编号', () => {
    expect(refNumber(pages, 'MAGIC—Memristor-Aided Logic')).toBe(12)
    expect(refNumber(pages, '‘Memristive’ switches enable ‘stateful’ logic operations')).toBe(3)
    expect(refNumber(pages, 'A paper that is not cited')).toBeNull()
  })
  it('题目里认得出的词', () => {
    expect(titleMarks('MAGIC—Memristor-Aided Logic')).toContain('MAGIC')
    expect(titleMarks('MultPIM: Fast Stateful Multiplication for Processing-in-Memory')).toEqual(['MultPIM'])
    expect(titleMarks('IEEE Survey of things')).toEqual([])
  })
  it('按编号、作者、缩写找句子，参考文献表里的不算，编号命中的排前面', () => {
    const m = mentions(pages, { title: 'MAGIC—Memristor-Aided Logic', authors: ['Shahar Kvatinsky', 'Dmitry Belousov'] })
    expect(m.map((x) => x.page)).toEqual([2, 2, 2])
    expect(m[0].text).toContain('MAGIC [12] performs')
    expect(m.some((x) => x.text.startsWith('Kvatinsky et al.'))).toBe(true)
    expect(m.some((x) => x.text.includes('IEEE TCAS-II'))).toBe(false)
    expect(mentions(pages, { title: 'Memristive switches enable stateful logic', authors: ['Julien Borghetti'] }).map((x) => x.text.slice(0, 22))).toEqual(['Earlier stateful logic'])
  })
})

describe('关系图', () => {
  it('按年份分栏，同一年上下排', () => {
    const g = layoutGraph([
      { id: 'a', year: 2010 },
      { id: 'b', year: 2014 },
      { id: 'c', year: 2020 },
      { id: 'd', year: 2020 }
    ])
    expect(g.years.map((y) => y.year)).toEqual([2010, 2014, 2020])
    expect(g.pos.a[0]).toBeLessThan(g.pos.b[0])
    expect(g.pos.c[0]).toBe(g.pos.d[0])
    expect(g.pos.c[1]).toBeLessThan(g.pos.d[1])
    // 单独一篇的那栏放在中间
    expect(g.pos.a[1]).toBe((g.height - 58) / 2)
  })
  it('连线从框边出发，到框边结束', () => {
    const [x1, y1, x2, y2] = edgeLine([300, 0], [0, 0], 190, 58)
    expect([x1, y1, x2, y2]).toEqual([300, 29, 190, 29])
  })
})

describe('段落', () => {
  const ids = ['p1', 'p2', 'p3']
  const cells = new Set(['p1:m', 'p2:r', 'p3:l', 'rel:x'])
  it('引用只认表里的编号，出处只认表里的格子，句子里的 [n] 去掉', () => {
    const { sentences, dropped } = cleanSentences(
      [
        { t: 'MAGIC 一步完成 NOR [2]。', cites: [2], src: ['p2:r', 'zz:q'] },
        { t: '有人编了一篇。', cites: [7], src: [] },
        { t: '', cites: [1] }
      ],
      ids,
      cells
    )
    expect(sentences).toEqual([
      { t: 'MAGIC 一步完成 NOR。', cites: ['p2'], src: ['p2:r'] },
      { t: '有人编了一篇。', cites: [], src: [] }
    ])
    expect(dropped).toBe(1)
  })
  it('提纲只留表里的格子', () => {
    expect(cleanOutline([{ h: '起点', cells: ['p1:m', 'nope'] }, { h: '', cells: [] }], cells)).toEqual([{ h: '起点', cells: ['p1:m'] }])
  })
  it('模型漏掉的格子补进提纲：先按要点里的简称，再按同一篇，最后放最后一条', () => {
    const name: Record<string, string> = { p1: 'IMPLY', p2: 'MAGIC', p3: 'SIMPLER' }
    const paperOf = (id: string): string[] => (id === 'rel:x' ? ['p3', 'p2'] : [id.split(':')[0]])
    const out = fillOutline(
      [{ h: 'MAGIC 一步完成 NOR', cells: [] }, { h: '单行映射', cells: ['p3:m'] }, { h: '还有待验证', cells: [] }],
      ['p2:m', 'p3:r', 'p1:l', 'p3:m'],
      (id) => paperOf(id).map((p) => name[p]),
      paperOf
    )
    expect(out.map((x) => x.cells)).toEqual([['p2:m'], ['p3:m', 'p3:r'], ['p1:l']])
    expect(fillOutline([], ['p1:m'], () => [], () => [])).toEqual([])
  })
  it('规则查证：没出处是推断，引了出处之外的论文要标', () => {
    expect(ruleCheck({ t: 'x', cites: [], src: [] })).toEqual({ ok: false, why: 'nosrc' })
    expect(ruleCheck({ t: 'x', cites: ['p3'], src: ['p1:m'] })).toEqual({ ok: false, why: 'stray' })
    expect(ruleCheck({ t: 'x', cites: ['p1'], src: ['p1:m'] })).toBeNull()
    expect(ruleCheck({ t: 'x', cites: ['p1', 'p2'], src: ['rel:x'] })).toBeNull()
  })
  it('句末标点拆出来', () => {
    expect(splitPunct('吞吐提高。')).toEqual(['吞吐提高', '。'])
    expect(splitPunct('cut by 40%.')).toEqual(['cut by 40%', '.'])
    expect(splitPunct('没有标点')).toEqual(['没有标点', ''])
  })
  const sents = [
    { t: 'IMPLY overwrites an input.', cites: ['p1'], src: ['p1:m'] },
    { t: 'All of these need 100% exact results.', cites: [], src: [] },
    { t: 'MAGIC & SIMPLER fix it_now.', cites: ['p2', 'p3'], src: ['p2:r'] }
  ]
  it('Word：文字和引用交替，引用在句末标点前', () => {
    expect(wordSegments(sents, 'en')).toEqual([
      { text: 'IMPLY overwrites an input ' },
      { cite: ['p1'] },
      { text: '. All of these need 100% exact results. MAGIC & SIMPLER fix it_now ' },
      { cite: ['p2', 'p3'] },
      { text: '.' }
    ])
    expect(wordSegments([{ t: '吞吐提高', cites: ['p3'], src: [] }], 'zh')).toEqual([{ text: '吞吐提高' }, { cite: ['p3'] }, { text: '。' }])
  })
  it('LaTeX：\\cite{key} 用 ~ 连着，特殊字符转义', () => {
    const keys: Record<string, string> = { p1: 'borghetti2010memristive', p2: 'kvatinsky2014magic', p3: 'benhur2020simpler' }
    expect(toLatex(sents, (id) => keys[id], 'en')).toBe(
      'IMPLY overwrites an input~\\cite{borghetti2010memristive}. All of these need 100\\% exact results. MAGIC \\& SIMPLER fix it\\_now~\\cite{kvatinsky2014magic,benhur2020simpler}.'
    )
    expect(texEscape('a\\b ^ ~ $x$ #1 {y}')).toBe('a\\textbackslash{}b \\textasciicircum{} \\textasciitilde{} \\$x\\$ \\#1 \\{y\\}')
    expect(toLatex([{ t: '近似加法把周期减少约 40%。', cites: ['p3'], src: [] }], (id) => keys[id], 'zh')).toBe('近似加法把周期减少约 40\\%~\\cite{benhur2020simpler}。')
  })
  it('纯文本里引用写成表里的行号', () => {
    expect(plainText(sents.slice(2), (id) => ids.indexOf(id) + 1, 'en')).toBe('MAGIC & SIMPLER fix it_now [2, 3].')
  })
  it('格子编号拆开：论文 id 里可能有冒号以外的任何字符', () => {
    expect(splitCell('0X-K_dl:m')).toEqual({ paperId: '0X-K_dl', col: 'm' })
  })
})
