import { describe, expect, it } from 'vitest'
import { pageOfText } from '../src/shared/refs'
import { alignOffsets, balanced, counterpart, cut, needsMd, parseSenses, senseable, toMd } from '../src/shared/senses'

const SRC = 'If you increase the learning rate too much, the loss will start to diverge [1]. Could you tell me why the new model converges faster on the small dataset?'
const TR = '学习率调得太大，损失就会开始发散[1]。你能说说为什么新模型在小数据集上收敛更快吗？'
const RAW = {
  sentences: [
    [
      { en: 'If you increase the learning rate too much,', zh: '学习率调得太大，' },
      { en: 'the loss will start to diverge [1].', zh: '损失就会开始发散[1]。' }
    ],
    [
      { en: 'Could you tell me', zh: '你能说说' },
      { en: 'why the new model converges faster', zh: ['为什么新模型', '收敛更快'] },
      { en: 'on the small dataset?', zh: '在小数据集上' }
    ]
  ]
}
const text = (s: string, r: [number, number]): string => s.slice(r[0], r[1])

describe('意群：把模型给的片段定位成不丢字的切分', () => {
  it('两句各自成一行，原文和译文都整段覆盖、一个字不丢', () => {
    const s = parseSenses(RAW, SRC, TR)
    expect(s).toHaveLength(2)
    expect(s.map((x) => text(SRC, x.en)).join('')).toBe(SRC)
    expect(s.map((x) => text(TR, x.zh)).join('')).toBe(TR)
    expect(text(SRC, s[0].en)).toBe('If you increase the learning rate too much, the loss will start to diverge [1]. ')
    expect(text(TR, s[1].zh)).toBe('你能说说为什么新模型在小数据集上收敛更快吗？')
  })

  it('语序不同：一块原文对译文里隔开的两段', () => {
    const c = parseSenses(RAW, SRC, TR)[1].chunks[1]
    expect(text(SRC, c.en)).toBe('why the new model converges faster')
    expect(c.zh.map((z) => text(TR, z))).toEqual(['为什么新模型', '收敛更快'])
  })

  it('模型把隔开的两段拼成了一段：按译文里找得到的最长片段拆开', () => {
    const raw = { sentences: [[{ en: 'Could you tell me', zh: '你能说说' }, { en: 'why the new model converges faster', zh: '为什么新模型收敛更快' }, { en: 'on the small dataset?', zh: '在小数据集上' }]] }
    const src = SRC.slice(SRC.indexOf('Could'))
    const tr = TR.slice(TR.indexOf('你能'))
    expect(parseSenses(raw, src, tr)[0].chunks[1].zh.map((z) => text(tr, z))).toEqual(['为什么新模型', '收敛更快'])
  })

  it('模型改了空白、漏了几个字：照样定位，漏的字留在那一句里不上色', () => {
    const src = 'The energy and delay\nassociated with this transfer are high. This bottleneck is known as the memory wall.'
    const tr = '与这种传输相关的能量和延迟很高。这一瓶颈被称为内存墙。'
    const raw = { sentences: [[{ en: 'The energy and delay associated with this transfer', zh: '与这种传输相关的能量和延迟' }, { en: 'are high.', zh: '很高。' }], [{ en: 'is known as the memory wall.', zh: '被称为内存墙。' }]] }
    const s = parseSenses(raw, src, tr)
    expect(s).toHaveLength(2)
    expect(text(src, s[0].chunks[0].en)).toBe('The energy and delay\nassociated with this transfer')
    // 「This bottleneck 」模型没给：归到前一句的末尾，不丢
    expect(s.map((x) => text(src, x.en)).join('')).toBe(src)
    expect(text(src, s[0].en).endsWith('This bottleneck ')).toBe(true)
  })

  it('原文里找不到的块丢掉；译文里找不到的块留着但没有对应', () => {
    const raw = { sentences: [[{ en: 'not in the text', zh: '学习率' }, { en: 'If you increase the learning rate too much,', zh: '译文里没有这几个字' }, { en: 'the loss will start to diverge [1].', zh: '损失就会开始发散[1]。' }]] }
    const s = parseSenses(raw, SRC, TR)
    expect(s[0].chunks.map((c) => c.zh.length)).toEqual([0, 1])
  })

  it('译文把两句的先后换了：并成一句', () => {
    const src = 'A comes first. B comes second.'
    const tr = '乙排第二。甲排第一。'
    const raw = { sentences: [[{ en: 'A comes first.', zh: '甲排第一。' }], [{ en: 'B comes second.', zh: '乙排第二。' }]] }
    const s = parseSenses(raw, src, tr)
    expect(s).toHaveLength(1)
    expect(s[0].en).toEqual([0, src.length])
    expect(s[0].zh).toEqual([0, tr.length])
    expect(s[0].chunks).toHaveLength(2)
  })

  it('重复的词：后面句子的块取译文里靠后的那一处', () => {
    const src = 'The model is small. The model is fast.'
    const tr = '模型很小。模型很快。'
    const raw = { sentences: [[{ en: 'The model', zh: '模型' }, { en: 'is small.', zh: '很小。' }], [{ en: 'The model', zh: '模型' }, { en: 'is fast.', zh: '很快。' }]] }
    const s = parseSenses(raw, src, tr)
    expect(s).toHaveLength(2)
    expect(s[1].chunks[0].zh).toEqual([[5, 7]])
    expect(text(tr, s[1].zh)).toBe('模型很快。')
  })

  it('句子切在公式中间：并成一句', () => {
    const src = 'We set $a = b. c$ here. Then it converges.'
    const tr = '这里取 $a = b. c$。然后它收敛。'
    const raw = { sentences: [[{ en: 'We set $a = b.', zh: '这里取' }], [{ en: 'c$ here.', zh: '$a = b. c$。' }], [{ en: 'Then it converges.', zh: '然后它收敛。' }]] }
    const s = parseSenses(raw, src, tr)
    expect(s.map((x) => text(src, x.en))).toEqual(['We set $a = b. c$ here. ', 'Then it converges.'])
  })

  it('译文那一句前面的开引号、开括号跟着这一句走', () => {
    const src = 'He left. She said yes.'
    const tr = '他走了。“她答应了。”'
    const raw = { sentences: [[{ en: 'He left.', zh: '他走了。' }], [{ en: 'She said yes.', zh: '她答应了。' }]] }
    expect(text(tr, parseSenses(raw, src, tr)[1].zh)).toBe('“她答应了。”')
  })

  it('答非所问、一块都没对上：返回空', () => {
    expect(parseSenses({ sentences: [[{ en: 'nothing here', zh: '没有' }]] }, SRC, TR)).toEqual([])
    expect(parseSenses({ oops: 1 }, SRC, TR)).toEqual([])
    expect(parseSenses(null, SRC, TR)).toEqual([])
  })
})

describe('意群：切成要画的片段', () => {
  it('块和块之间的字分开，块带编号', () => {
    const s = parseSenses(RAW, SRC, TR)[1]
    const en = cut(SRC, s.en, s.chunks.map((c, k) => ({ span: c.en, k })))
    expect(en).toEqual([
      { text: 'Could you tell me', k: 0 },
      { text: ' ', k: null },
      { text: 'why the new model converges faster', k: 1 },
      { text: ' ', k: null },
      { text: 'on the small dataset?', k: 2 }
    ])
    const zh = cut(TR, s.zh, s.chunks.flatMap((c, k) => c.zh.map((z) => ({ span: z, k }))))
    expect(zh.map((p) => [p.text, p.k])).toEqual([['你能说说', 0], ['为什么新模型', 1], ['在小数据集上', 2], ['收敛更快', 1], ['吗？', null]])
    expect(zh.map((p) => p.text).join('')).toBe(text(TR, s.zh))
  })

  it('块切在公式、加粗中间：和后面的并在一起，不上色', () => {
    const md = 'where $N(i)$ denotes **the neighborhood** of node'
    const p = cut(md, [0, md.length], [{ span: [0, 9], k: 0 }, { span: [9, 30], k: 1 }, { span: [30, md.length], k: 2 }])
    expect(p.map((x) => x.text).join('')).toBe(md)
    expect(p.every((x) => balanced(x.text))).toBe(true)
    expect(p[0]).toEqual({ text: 'where $N(i)$ denotes **the neighborhood** of node', k: null })
  })
})

describe('意群：哪些要交给 Markdown、哪些段不做', () => {
  it('成对的记号', () => {
    expect(balanced('plain words, and [12] too')).toBe(true)
    expect(balanced('a $x_i$ b')).toBe(true)
    expect(balanced('a $x_i')).toBe(false)
    expect(balanced('cost \\$5 only')).toBe(true)
    expect(balanced('H<sub>2</sub>O')).toBe(true)
    expect(balanced('H<sub>2')).toBe(false)
    expect(balanced('see [the site](https://example.com)')).toBe(true)
    expect(balanced('the site](https://example.com)')).toBe(false)
  })

  it('有记号的才交给 Markdown', () => {
    expect(needsMd('the loss will start to diverge [1].')).toBe(false)
    expect(needsMd('where $N(i)$ denotes')).toBe(true)
    expect(needsMd('H<sub>2</sub>O')).toBe(true)
  })

  it('只做一整段的普通文字', () => {
    expect(senseable('The complexity of modern traffic has made driver stress a pervasive threat.')).toBe(true)
    expect(senseable('Too short.')).toBe(false)
    expect(senseable('First paragraph long enough to count here.\n\nSecond paragraph.')).toBe(false)
    expect(senseable('- a list item that is long enough to pass the length check')).toBe(false)
    expect(senseable('1) a numbered item that is long enough to pass the length check')).toBe(false)
  })
})

describe('选中一边、另一边跟着亮：源文字的位置和画出来的位置换算', () => {
  // md 里 [a, b) 这一截画出来是什么字
  const shown = (md: string, text: string, a: number, b: number): string => {
    const m = alignOffsets(md, text)
    return text.slice(m[a], m[b])
  }

  it('普通文字：两边一样，位置一一对应', () => {
    const md = 'All models are evaluated using standard implementations.'
    expect(alignOffsets(md, md)).toEqual([...md, ''].map((_, i) => i))
  })

  it('列表号、加粗这些记号画出来没有：后面的字照样对得上', () => {
    const md = '1. **Experimental Setup** and Fairness: All models are evaluated.'
    const text = 'Experimental Setup and Fairness: All models are evaluated.'
    const a = md.indexOf('All models')
    expect(shown(md, text, a, md.length)).toBe('All models are evaluated.')
    expect(shown(md, text, md.indexOf('Experimental'), md.indexOf(' and'))).toBe('Experimental Setup')
  })

  it('公式：KaTeX 画出来的字比源文字多（带着一份 LaTeX 原文），公式后面的字照样对得上', () => {
    const md = 'The attention weights $\\alpha_{ij}$ are derived from (1), and the features $\\mathbf{h}_i$ are updated.'
    const text = 'The attention weights αij\\alpha_{ij}αij\u200b are derived from (1), and the features hi\\mathbf{h}_ihi\u200b are updated.'
    expect(shown(md, text, 0, md.indexOf(' $'))).toBe('The attention weights')
    expect(shown(md, text, md.indexOf('are derived'), md.indexOf(', and'))).toBe('are derived from (1)')
    expect(shown(md, text, md.indexOf('are updated'), md.length)).toBe('are updated.')
    // 包着公式的一截：从公式前的字到公式后的字都在里面
    const part = shown(md, text, md.indexOf('the features'), md.length)
    expect(part.startsWith('the features')).toBe(true)
    expect(part.endsWith('are updated.')).toBe(true)
  })

  it('换行和空格算同一种空白；位置表只增不减', () => {
    const md = 'first line\nsecond  line'
    const text = 'first line second  line'
    const m = alignOffsets(md, text)
    expect(shown(md, text, md.indexOf('second'), md.length)).toBe('second  line')
    expect(m.every((v, i) => i === 0 || v >= m[i - 1])).toBe(true)
  })

  it('画出来的位置换回源文字的位置', () => {
    const md = '1. **Setup**: All models are evaluated.'
    const text = 'Setup: All models are evaluated.'
    const m = alignOffsets(md, text)
    const a = toMd(m, text.indexOf('All'))
    const b = toMd(m, text.indexOf(' are'))
    expect(md.slice(a, b)).toBe('All models')
  })

  it('选中原文的一截：对面是重叠到的那几块的译文，挨着的并成一段', () => {
    const s = parseSenses(RAW, SRC, TR)
    const a = SRC.indexOf('the loss')
    const b = SRC.indexOf('Could you tell me') + 'Could you tell me'.length
    expect(counterpart(s, 'en', a, b).map((z) => text(TR, z))).toEqual(['损失就会开始发散[1]。你能说说'])
    // 只沾到下一块一个字的不算
    expect(counterpart(s, 'en', a, SRC.indexOf('Could') + 1).map((z) => text(TR, z))).toEqual(['损失就会开始发散[1]。'])
  })

  it('选中译文的一截：对面是原文里对应的块；语序不同的那一块，选它的任意一段都算', () => {
    const s = parseSenses(RAW, SRC, TR)
    const a = TR.indexOf('收敛更快')
    expect(counterpart(s, 'zh', a, a + 4).map((z) => text(SRC, z))).toEqual(['why the new model converges faster'])
    const c = TR.indexOf('学习率')
    expect(counterpart(s, 'zh', c, c + 3).map((z) => text(SRC, z))).toEqual(['If you increase the learning rate too much,'])
    expect(counterpart(s, 'zh', TR.length - 1, TR.length)).toEqual([])
  })
})

describe('对照模式的标注补页码', () => {
  const pages = ['Title page. Abstract—In-memory processing can improve latency.', 'I. INTRODUCTION A basic assumption that has guided computer archi-\ntects in the design of systems.', 'II. Related work and more text here.']
  it('按摘的字找到它在第几页，断行、连字符、大小写不影响', () => {
    expect(pageOfText(pages, 'assumption that has guided computer architects')).toBe(2)
    expect(pageOfText(pages, 'In-memory processing can improve')).toBe(1)
  })
  it('摘的是译文、或者太短、或者原文里没有：没有页码', () => {
    expect(pageOfText(pages, '指导计算机体系结构设计师的一个基本假设')).toBeNull()
    expect(pageOfText(pages, 'the')).toBeNull()
    expect(pageOfText(pages, 'this sentence is not in the paper at all')).toBeNull()
  })
})
