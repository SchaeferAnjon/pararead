// AI 对话写进笔记的新写法（ai-note.ts，design/ai-note-switch）：普通文档的一问一个小标题、一块 AI 回答，只往后加；
// 旧写法不转，两种都读得回来；同一处再问时新写法接在旧那段后面，旧的一字节不变。
import { describe, expect, it } from 'vitest'
import { decodeNote, splitDoc } from '../src'
import { FIXTURES } from './fixtures'
import { type NoteAsk, appendAsk, askColumns, askUnits, hasAsk, insertAfterAsk, insertSide, newReadingNote, pastAsk, parseChatLink, parseReadingNote, pdfSrc, removeAsk, renderAsk, renderSection, setCalloutWords, EN_CALLOUT_WORDS, ZH_CALLOUT_WORDS, webSrc, withDerived, chatLink } from '../src'

const PDF = '课程/ecpc/Lecture05.pdf'
const NOTE = '课程/ecpc/Lecture05 笔记.md'
const KEY = `read:${PDF}`

const main = (msg: number, q: string, a: string, o: Partial<NoteAsk> = {}): NoteAsk => ({ key: KEY, msg, th: 'Lecture05-p28-1', q, a, by: 'Claude Code · Opus 5.5', src: pdfSrc(NOTE, PDF, 28, [0.06, 0.3, 0.89, 0.6]), ...o })
const side = (msg: number, q: string, a: string, of: number, quote = '把水位减掉一个门槛的量', parent = '给我讲解一下'): NoteAsk => ({ key: KEY, msg, th: 'Lecture05-p28-1', q, a, by: 'Claude Code · Opus 5.5', side: { quote, parent, of } })

const FIRST = main(12, '给我讲解一下', '这一页讲 LIF……\n\n- 漏\n- 积', { crop: { path: '附件/Lecture05/p28-1.png', w: 268 } })

describe('写成的样子', () => {
  it('小标题是问的原话，框的图、来源一行、一块 AI 回答带回到对话的链接', () => {
    expect(renderAsk(FIRST, NOTE)).toBe(
      [
        '### 给我讲解一下',
        '',
        '![我框的|268](../../附件/Lecture05/p28-1.png)',
        '',
        '—— [第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6)',
        '',
        `> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](${chatLink(KEY, 12, 'Lecture05-p28-1')})`,
        '> 这一页讲 LIF……',
        '>',
        '> - 漏',
        '> - 积',
        '',
      ].join('\n'),
    )
  })
  it('旁支：#### 旁支：问的那句，引用那一句和在哪一问的回答里，旁支回答', () => {
    const md = renderAsk(side(14, '为什么减掉门槛，而不是清零？', '减掉门槛（soft reset）……', 12), NOTE)
    expect(md).toContain('#### 旁支：为什么减掉门槛，而不是清零？\n\n> 把水位减掉一个门槛的量\n> —— 在「给我讲解一下」的回答里\n\n> [!ai] 旁支回答 · ')
  })
  it('选字问：引用那一句，来源写在引用里；几行的问题第一行做标题', () => {
    const md = renderAsk(main(3, '这句什么意思\n和上一页有什么关系', '答', { quote: 'the potential is reduced by the threshold', src: pdfSrc(NOTE, PDF, 28) }), NOTE)
    expect(md.split('\n').slice(0, 6)).toEqual(['### 这句什么意思', '', '和上一页有什么关系', '', '> the potential is reduced by the threshold', '> —— [第 28 页](Lecture05.pdf#page=28)'])
  })
  it('链接里带那一处的名字，认得回来；没有的照旧认', () => {
    expect(parseChatLink(chatLink('read:a (1).pdf', 3, 'a-p1-1'))).toEqual({ key: 'read:a (1).pdf', msg: 3, th: 'a-p1-1' })
    expect(parseChatLink(chatLink('file:x.md', 7))).toEqual({ key: 'file:x.md', msg: 7 })
  })
})

describe('认回来', () => {
  it('写的每一样都读得回来（图、宽、来源、引用、材料、几行的问题、旁支）', () => {
    const asks: NoteAsk[] = [
      FIRST,
      main(20, '①和②哪个对\n说说理由', '①', { th: 'Lecture05-p28-2', quote: '选的字', mats: [{ kind: 'quote', text: '一段', src: 'AI的回答 · 第28页' }, { kind: 'image', path: '附件/Lecture05/p28-2-ab.png', src: '粘贴的图' }] }),
      side(14, '为什么减掉门槛？', '减掉门槛……', 12),
    ]
    for (const a of asks) {
      const u = askUnits(renderAsk(a, NOTE), NOTE)
      expect(u).toHaveLength(1)
      const { side: s, ...rest } = u[0]!.ask
      const { side: s0, ...want } = a
      expect(rest).toEqual(want)
      if (s0) expect(s).toEqual({ quote: s0.quote, parent: s0.parent })
    }
  })
  it('没带「回到 AI 对话」链接的小标题是用户自己写的，不算', () => {
    expect(askUnits('## 我的想法\n\n### 小结\n\n> [!ai] AI 写的 · Claude Code\n> 一段\n', NOTE)).toEqual([])
    expect(askUnits('### 问\n\n自己写的字\n', NOTE)).toEqual([])
  })
  it('英文库写的也认', () => {
    setCalloutWords(EN_CALLOUT_WORDS)
    try {
      const md = renderAsk(side(14, 'Why?', 'Because.', 12, 'the quote', 'Explain'), NOTE)
      expect(md).toContain('#### Side: Why?\n\n> the quote\n> —— in the answer to “Explain”\n\n> [!ai] Side answer · ')
      expect(askUnits(md, NOTE)[0]!.ask).toMatchObject({ q: 'Why?', a: 'Because.', side: { quote: 'the quote', parent: 'Explain' } })
    } finally {
      setCalloutWords(ZH_CALLOUT_WORDS)
    }
  })
})

describe('只往后加', () => {
  const place = { heading: '第 28 页 · LIF Neuron', page: 28 }
  it('空笔记：新起一节「第 28 页 · …」；同一条回答再加一次不变', () => {
    const md0 = newReadingNote(PDF, new Date(2026, 10, 24))
    const md1 = appendAsk(md0, NOTE, FIRST, place)
    expect(md1.startsWith(md0)).toBe(true)
    expect(md1.slice(md0.length)).toBe('\n## 第 28 页 · LIF Neuron\n\n' + renderAsk(FIRST, NOTE))
    expect(appendAsk(md1, NOTE, FIRST, place)).toBe(md1)
    expect(hasAsk(md1, KEY, 12)).toBe(true)
  })
  it('同一页接着问接在这一节末尾；旁支插在它那一问和那一问已有的旁支后面；别的页按页码插', () => {
    let md = appendAsk(newReadingNote(PDF), NOTE, FIRST, place)
    md = appendAsk(md, NOTE, main(16, '那 τ 变大会怎样？', 'τ 是漏水的快慢。'), place)
    md = appendAsk(md, NOTE, side(14, '为什么减掉门槛？', '减掉门槛……', 12), place)
    md = appendAsk(md, NOTE, side(18, '那清零呢？', '清零……', 12, '清零'), place)
    md = appendAsk(md, NOTE, main(30, '第 5 页这句', '答', { th: 'Lecture05-p5-1', src: pdfSrc(NOTE, PDF, 5) }), { heading: '第 5 页', page: 5 })
    md = appendAsk(md, NOTE, main(31, '第 40 页', '答', { th: 'Lecture05-p40-1', src: pdfSrc(NOTE, PDF, 40) }), { heading: '第 40 页', page: 40 })
    const heads = md.split('\n').filter((l) => /^#{2,4} /.test(l))
    expect(heads).toEqual(['## 第 5 页', '### 第 5 页这句', '## 第 28 页 · LIF Neuron', '### 给我讲解一下', '#### 旁支：为什么减掉门槛？', '#### 旁支：那清零呢？', '### 那 τ 变大会怎样？', '## 第 40 页', '### 第 40 页'])
    // 块与块之间一个空行，没有连着的三个换行
    expect(md).not.toMatch(/\n\n\n/)
  })
  it('用户在笔记里改的字（回答里改的、后面补的）加新的一问时一个字不动', () => {
    let md = appendAsk(newReadingNote(PDF), NOTE, FIRST, place)
    md = md.replace('> 这一页讲 LIF……', '> 这一页讲 LIF（我补了一句）……') + '\n我自己的体会。\n'
    const next = appendAsk(md, NOTE, main(16, '再问', '答'), place)
    expect(next.startsWith(md.replace(/\n+$/, ''))).toBe(true)
    expect(next).toContain('我自己的体会。\n\n### 再问')
  })
  it('旧写法那一段（ParaRead 写的看不懂、画布笔记旧的一段）后面接新写法，旧的一字节不变', () => {
    const old = withDerived({
      id: '.canvas-notes/对话/Lecture05-p28-1.md',
      file: PDF,
      page: 28,
      rect: [0.06, 0.3, 0.89, 0.6],
      title: 'LIF 神经元',
      time: '20:21',
      figures: [],
      doubts: [],
      good: '',
      points: [],
      failed: [],
      rounds: 0,
      links: [],
      qas: [{ q: '看不懂：「the potential is reduced」 <!-- hl=kX3-a_9Qz1 -->', a: '先抓关系。', sides: [] }],
      recap: '一句小结',
    })
    const later = withDerived({ ...old, id: '.canvas-notes/对话/Lecture05-p30-1.md', page: 30, title: '后面' })
    const md0 = newReadingNote(PDF) + '\n' + renderSection(old, NOTE) + '\n' + renderSection(later, NOTE)
    const oldPart = renderSection(old, NOTE)
    const md1 = appendAsk(md0, NOTE, main(40, '接着问', '接着答'), { heading: '第 28 页 · LIF 神经元', page: 28, after: old.id })
    expect(md1).toContain(oldPart + '\n## 第 28 页 · LIF 神经元\n\n### 接着问')
    expect(md1.indexOf('### 接着问')).toBeLessThan(md1.indexOf('## 第 30 页'))
    // 再问一句：接在同一个新节里，不再新起一节
    const md2 = appendAsk(md1, NOTE, main(41, '再问', '再答'), { heading: '第 28 页 · LIF 神经元', page: 28, after: old.id })
    expect(md2.match(/^## 第 28 页/gm)).toHaveLength(2)
    expect(md2.indexOf('### 再问')).toBeLessThan(md2.indexOf('## 第 30 页'))
    // 两种都读得回来：旧的一段、新的一处（同一处，旧的在前）
    const secs = parseReadingNote(md2, NOTE)
    expect(secs.map((s) => [s.id, !!s.doc])).toEqual([
      [old.id, false],
      [old.id, true],
      [later.id, false],
    ])
    expect(secs[1]!.qas!.map((q) => q.q)).toEqual(['接着问', '再问'])
    expect(secs[0]).toEqual(parseReadingNote(md0, NOTE)[0])
  })
  it('按节写的一篇（没开东西时收件箱那篇）里网页的一问：一个网页一节（标题是网页标题），来源是回到那一段的链接', () => {
    const n = '收件箱/读书 · AI 笔记.md'
    const url = 'https://zh.d2l.ai/chapter_cnn/why-conv.html#:~:text=首先'
    const a: NoteAsk = { key: 'read:web:https://zh.d2l.ai/chapter_cnn/why-conv.html', msg: 2, th: 'web-1', q: '讲解一下', a: '卷积……', quote: '首先，多层感知机的输入', src: webSrc(n, '6.1 从全连接层到卷积 ↩', url) }
    const md = appendAsk('# 读书 · AI 笔记\n', n, a, { heading: '6.1. 从全连接层到卷积 — 动手学深度学习' })
    expect(md).toContain('## 6.1. 从全连接层到卷积 — 动手学深度学习\n\n### 讲解一下\n\n> 首先，多层感知机的输入\n> —— [6.1 从全连接层到卷积 ↩](https://zh.d2l.ai/chapter_cnn/why-conv.html#:~:text=首先)')
    const s = parseReadingNote(md, n)[0]!
    expect(s.web).toEqual({ label: '6.1 从全连接层到卷积 ↩', url })
    expect(s.page).toBe(0)
    const md2 = appendAsk(md, n, { ...a, msg: 4, q: '再问' }, { heading: '6.1. 从全连接层到卷积 — 动手学深度学习' })
    expect(md2.match(/^## /gm)).toHaveLength(1)
  })
})

describe('写进剪藏那篇本身（网页、视频、文档，2026-11-24 偏好「剪藏和AI笔记同一篇」）', () => {
  const CLIP = '课程/学习笔记：动手学深度学习.md'
  const WKEY = 'read:web:https://zh.d2l.ai/chapter_convolutional-neural-networks/conv-layer.html'
  const href = 'https://zh.d2l.ai/chapter_convolutional-neural-networks/conv-layer.html#:~:text=%E6%B3%A8%E6%84%8F'
  const ask: NoteAsk = {
    key: WKEY,
    msg: 7,
    th: 'web-1',
    q: '①这部分看不懂是说什么',
    a: '引文①说的是：卷积核不能伸出图像边界。',
    by: 'Claude Code · Opus 5.5',
    mats: [
      { kind: 'quote', text: '注意，输出大小略小于输入大小。', src: '6.2.1 互相关运算 · 动手学深度学习 ↩', href },
      { kind: 'image', path: '附件/学习笔记：动手学深度学习/0f3a9c1d.png', src: '6.2.1 互相关运算' },
    ],
  }
  it('问的那句做小标题，引的那段带编号和回到网页那段的来源，图，再是 AI 回答框；读回来引文、来源、图都在', () => {
    const md = renderAsk(ask, CLIP)
    expect(md).toBe(
      [
        '### ①这部分看不懂是说什么',
        '',
        '> ① 注意，输出大小略小于输入大小。',
        `> —— [6.2.1 互相关运算 · 动手学深度学习 ↩](${href})`,
        '',
        '![6.2.1 互相关运算|180](../附件/学习笔记：动手学深度学习/0f3a9c1d.png)',
        '',
        `> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](${chatLink(WKEY, 7, 'web-1')})`,
        '> 引文①说的是：卷积核不能伸出图像边界。',
        '',
      ].join('\n'),
    )
    const doc = `# 学习笔记\n\n> 剪的一段\n> —— [6.2.1 互相关运算 · 动手学深度学习](${href})\n\n我自己打的字。\n\n${md}\n后面又打的字。\n`
    const [u] = askUnits(doc, CLIP)
    expect(u!.ask.q).toBe('①这部分看不懂是说什么')
    expect(u!.ask.quote).toBeUndefined()
    expect(u!.ask.mats).toEqual(ask.mats)
    // 撤回只拿掉这一问，剪藏、自己打的字留着
    expect(removeAsk(doc, WKEY, 7)).toBe(`# 学习笔记\n\n> 剪的一段\n> —— [6.2.1 互相关运算 · 动手学深度学习](${href})\n\n我自己打的字。\n\n后面又打的字。\n`)
  })
  it('旁支接在它那一问（和已有的旁支）的回答框后面，后面自己打的字不动；找不到那一问是 null；记过的原样', () => {
    const doc = `# 学习笔记\n\n${renderAsk(ask, CLIP)}\n后面又打的字。\n`
    const s1: NoteAsk = { key: WKEY, msg: 9, th: 'web-1', q: '为什么不能伸出去？', a: '因为外面没有像素。', side: { quote: '不能伸出图像边界', parent: ask.q, of: 7 } }
    const one = insertSide(doc, CLIP, s1)!
    expect(one.endsWith(`${renderAsk(s1, CLIP)}\n后面又打的字。\n`)).toBe(true)
    const s2: NoteAsk = { ...s1, msg: 11, q: '那补零呢？', side: { quote: '', of: 7 } }
    const two = insertSide(one, CLIP, s2)!
    expect(two.indexOf('那补零呢？')).toBeGreaterThan(two.indexOf('为什么不能伸出去？'))
    expect(two.indexOf('那补零呢？')).toBeLessThan(two.indexOf('后面又打的字。'))
    expect(insertSide(two, CLIP, s2)).toBe(two)
    expect(insertSide(doc, CLIP, { ...s1, side: { quote: 'x', of: 99 } })).toBeNull()
  })
  it('光标停在一问末尾（刚记进去）再插：挪到这一问和它的旁支（新写法的、问框的 `> [!side]` 块）后面；不在一问里原样', () => {
    const s1: NoteAsk = { key: WKEY, msg: 9, th: 'web-1', q: '为什么不能伸出去？', a: '因为外面没有像素。', side: { quote: '不能伸出图像边界', parent: ask.q, of: 7 } }
    const head = `# 学习笔记\n\n我先写的一句。\n\n`
    const qa = renderAsk(ask, CLIP)
    const doc = `${head}${qa}\n${renderAsk(s1, CLIP)}\n后面又打的字。\n`
    const afterSide = doc.indexOf('\n后面又打的字。') - 1
    expect(pastAsk(doc, head.length + qa.length)).toBe(afterSide)
    expect(pastAsk(doc, head.length + 3)).toBe(afterSide)
    expect(pastAsk(doc, 4)).toBe(4)
    expect(pastAsk(doc, doc.indexOf('后面又打的字。') + 2)).toBe(doc.indexOf('后面又打的字。') + 2)
    // 问框写的旁支：AI 块下面空一行一块 `> [!side]`
    const box = `${head}${qa}\n> [!side] 为什么是组合？\n> > 任何向量\n>\n> #### 旁支的回答\n\n后面。\n`
    expect(pastAsk(box, head.length + qa.length - 1)).toBe(box.indexOf('\n\n后面。') )
  })
})

describe('拿掉（撤回）', () => {
  const place = { heading: '第 28 页 · LIF Neuron', page: 28 }
  it('主对话一问连它的旁支一起拿掉，后面别的问留着；拿空的那一节连标题拿掉', () => {
    const md0 = newReadingNote(PDF)
    let md = appendAsk(md0, NOTE, FIRST, place)
    md = appendAsk(md, NOTE, side(14, '为什么？', '因为', 12), place)
    const withTwo = appendAsk(md, NOTE, main(16, '再问', '答'), place)
    const one = removeAsk(withTwo, KEY, 12)
    expect(one.split('\n').filter((l) => l.startsWith('#'))).toEqual(['# Lecture05 笔记', '## 第 28 页 · LIF Neuron', '### 再问'])
    expect(removeAsk(one, KEY, 16)).toBe(md0)
    expect(removeAsk(withTwo, KEY, 999)).toBe(withTwo)
  })
  it('只拿掉旁支那一问；用户补在 AI 块后面的字留着', () => {
    let md = appendAsk(newReadingNote(PDF), NOTE, FIRST, place)
    const before = md
    md = appendAsk(md, NOTE, side(14, '为什么？', '因为', 12), place)
    expect(removeAsk(md, KEY, 14)).toBe(before)
    const mine = md.replace(/\n$/, '') + '\n\n我补的一句。\n'
    expect(removeAsk(mine, KEY, 14)).toContain('我补的一句。')
    expect(removeAsk(mine, KEY, 14)).not.toContain('旁支')
  })
})

describe('样例笔记（rule1 也拿它们打开再保存）', () => {
  it('ParaRead 的看不懂那段（旧）+ 接着问的新写法：两种都读得回来，改过的回答照文件里的字', () => {
    const name = '课程/ecp/2026_C72_BST-GATNet 新写法 笔记.md'
    const { text } = decodeNote(FIXTURES['2026_C72_BST-GATNet 新写法 笔记.md']!)
    const secs = parseReadingNote(text, name)
    expect(secs.map((s) => [s.id, s.page, !!s.doc])).toEqual([
      ['.canvas-notes/对话/2026_C72_BST-GATNet-p2-5.md', 2, false],
      ['.canvas-notes/对话/2026_C72_BST-GATNet-p2-5.md', 2, true],
      ['.canvas-notes/对话/2026_C72_BST-GATNet-p3-1.md', 3, true],
    ])
    const s1 = secs[1]!
    expect(s1.file).toBe('课程/ecp/2026_C72_BST-GATNet.pdf')
    expect(s1.qas![0]!.a).toContain('（我补：看表 3）')
    expect(s1.qas![0]!.sides).toEqual([{ quote: '看表 3', turns: [{ q: 'F1 是什么？', a: '精确率和召回率的调和平均。', ref: { key: 'read:课程/ecp/2026_C72_BST-GATNet.pdf', msg: 14 } }] }])
    const s2 = secs[2]!
    expect(s2).toMatchObject({ crop: '附件/2026_C72_BST-GATNet/p3-1.png', cropW: 268, rect: [0.1, 0.2, 0.5, 0.3], by: 'Codex · GPT-5.5' })
    expect(s2.qas![0]!.q).toBe('①和②哪个更好\n说说理由')
    expect(s2.qas![0]!.mats).toEqual([
      { kind: 'quote', text: '一段', src: 'AI的回答 · 第3页' },
      { kind: 'image', path: '附件/2026_C72_BST-GATNet/p3-1-ab12cd34.png', src: '粘贴的图' },
    ])
    // 撤回旁支：用户补的那句留着
    const out = removeAsk(text, 'read:课程/ecp/2026_C72_BST-GATNet.pdf', 14)
    expect(out).not.toContain('#### 旁支')
    expect(out).toContain('我自己补一句：F1 越高越好。')
  })
})

describe('白板看法：一问一列', () => {
  it('一页的几问并排、旁支排在它那一问那一列、用户补的字成一张卡；节里第一问前面自己的字是 lead', () => {
    const place = { heading: '第 28 页 · LIF Neuron', page: 28 }
    let md = appendAsk(newReadingNote(PDF), NOTE, FIRST, place)
    md = appendAsk(md, NOTE, side(14, '为什么？', '因为', 12), place)
    md = appendAsk(md, NOTE, main(16, '那 τ 变大会怎样？', 'τ 是漏水的快慢。'), place)
    md = md.replace('## 第 28 页 · LIF Neuron\n\n', '## 第 28 页 · LIF Neuron\n\n我先写一句。\n\n').replace(/\n$/, '\n\n我补的。\n')
    const from = md.indexOf('## 第 28 页')
    const { lead, columns } = askColumns(md, from, md.length, NOTE)
    expect(md.slice(lead!.from, lead!.to)).toBe('我先写一句。')
    expect(columns.map((c) => [c.title, c.page, c.cards.map((x) => x.part)])).toEqual([
      ['给我讲解一下', 28, ['top', 'qa', 'side']],
      ['那 τ 变大会怎样？', 28, ['top', 'qa', 'more']],
    ])
    const [top, qa, sd] = columns[0]!.cards
    expect(md.slice(top!.from, top!.to)).toBe('![我框的|268](../../附件/Lecture05/p28-1.png)\n\n—— [第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6)')
    expect(md.slice(qa!.from, qa!.to)).toMatch(/^> \[!ai\] AI 回答[\s\S]*> - 积$/)
    expect(md.slice(sd!.from, sd!.to)).toMatch(/^#### 旁支：为什么？[\s\S]*> 因为$/)
    expect(md.slice(columns[1]!.cards[2]!.from, columns[1]!.cards[2]!.to)).toBe('我补的。')
    expect(md.slice(columns[0]!.head.from, columns[0]!.head.to)).toBe('### 给我讲解一下')
  })
})

describe('白板（splitDoc）：新写法一问一列，旧写法那段照旧一处一列', () => {
  it('样例：看不懂那段一列、接着问的一列（旁支在里面）、第 3 页一列；列头「第 N 页 · 问的那句」，不能拖进、不能改名', () => {
    const { text } = decodeNote(FIXTURES['2026_C72_BST-GATNet 新写法 笔记.md']!)
    const b = splitDoc(text)
    const asks = b.columns.filter((c) => c.ask)
    expect(asks.map((c) => [c.title, c.cards.map((u) => u.ask?.part)])).toEqual([
      ['第 2 页 · 看不懂：Bi-LSTM 为什么放在注意力后面', ['top', 'qa', 'marks']],
      ['第 2 页 · 那去掉 Bi-LSTM 会怎样？', ['top', 'qa', 'side', 'more']],
      ['第 3 页 · ①和②哪个更好', ['top', 'qa']],
    ])
    expect(asks[1]!.head).toBeNull()
    // 卡的字都是原文里的那一截，切过去一个字节不写
    for (const c of asks) for (const u of c.cards) expect(text.slice(u.from, u.to)).toBe(u.text)
    expect(asks[1]!.cards[3]!.text).toBe('我自己补一句：F1 越高越好。')
  })
})

describe('可视化挂在那一处最后一问后面', () => {
  it('插在最后一问的 AI 块后面（它的旁支之前），再插一次不重复；没有这一处原样返回', () => {
    const at = { heading: '第 28 页 · LIF Neuron', page: 28 }
    let md = appendAsk(newReadingNote(PDF), NOTE, FIRST, at)
    md = appendAsk(md, NOTE, main(30, '那 τ 变大会怎样？', 'τ 越大漏得越慢'), at)
    md = appendAsk(md, NOTE, side(34, '漏得慢是什么意思？', '记得久', 30), at)
    const line = '![可视化 · LIF 水桶](LIF%20水桶.html)'
    const out = insertAfterAsk(md, NOTE, 'Lecture05-p28-1', line)
    expect(out).toContain('> τ 越大漏得越慢\n\n' + line + '\n\n#### 旁支：漏得慢是什么意思？')
    expect(out.replace(line + '\n\n', '')).toBe(md)
    expect(insertAfterAsk(out, NOTE, 'Lecture05-p28-1', line)).toBe(out)
    expect(insertAfterAsk(md, NOTE, 'Lecture05-p9-1', line)).toBe(md)
    expect(askUnits(out, NOTE).map((u) => u.ask.msg)).toEqual([12, 30, 34])
    // 最后一问在文末：接在文末
    const tail = insertAfterAsk(appendAsk(newReadingNote(PDF), NOTE, FIRST, at), NOTE, 'Lecture05-p28-1', line)
    expect(tail.endsWith('> - 积\n\n' + line + '\n')).toBe(true)
  })
})
