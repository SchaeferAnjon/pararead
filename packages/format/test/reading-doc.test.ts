// 读 PDF 的笔记做成一篇长文档（CN-93、94、95、96）：一段 = 一处问的地方，问题照原话、回答照原文，旁支挂在被问那一问的回答后面，末尾一句小结。
import { describe, expect, it } from 'vitest'
import {
  answerLead,
  type AskSection,
  demoteHeadings,
  doubtItems,
  doubtsNote,
  mergeReadingNotes,
  newReadingNote,
  parseReadingNote,
  renderSection,
  threadName,
  upsertSection,
  withDerived,
} from '../src'

const PDF = '课程/ecpc/Lecture05.pdf'
const NOTE = '课程/ecpc/Lecture05 笔记.md'
const ID = '.canvas-notes/对话/Lecture05-p28-1.md'

const ANSWER = ['**一句话：LIF 神经元就是一个会漏水的水桶。**这一页用三条公式描述最简单的脉冲神经元。', '', '### 第一条：水位怎么变', '', '$$\\tau_m \\frac{dV_m}{dt} = -V_m(t) + I_s(t) + I_b$$', '', '- **−V_m**：桶底有个洞。', '- **I_b**：一直开着的小水龙头。', '', '| 步 | 水位 |', '|---|---|', '| 1 | 0.200 |'].join('\n')
const SIDE_ANSWER = '#### 减掉门槛，不清零\n\n水位冲到 1.3 时，减掉 1 还剩 0.3，下一次更快到门槛。\n\n> 清零就把多出来的扔了。'

/** 一段新格式：主对话问了一句，回答里选一句开了一条旁支、在旁支里接着问了一句；末尾小结 */
const sec = (over: Partial<AskSection> = {}): AskSection =>
  withDerived({
    id: ID,
    file: PDF,
    page: 28,
    rect: [0.06, 0.3, 0.89, 0.6],
    title: 'LIF 神经元的三条公式',
    time: '20:21',
    crop: '附件/Lecture05/p28-1.png',
    cropW: 268,
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: [
      {
        q: '给我讲解一下',
        a: ANSWER,
        sides: [
          {
            quote: '水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量',
            turns: [
              { q: '为什么减掉门槛，而不是清零？', a: SIDE_ANSWER },
              { q: '那门槛是多少？', a: '门槛 V_th 是一个参数，这一页设成 1。' },
            ],
          },
        ],
      },
      { q: '还是不懂', a: '换个方式讲：先别看公式，看图。', sides: [] },
    ],
    recap: 'LIF 用「漏、积、发」三步描述神经元；另问了为什么不清零。',
    ...over,
  })

const MD = [
  '## 第 28 页 · LIF 神经元的三条公式',
  '[第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6) · 20:21 <!-- cn:thread=Lecture05-p28-1 -->',
  '',
  '![我框的|268](../../附件/Lecture05/p28-1.png)',
  '',
  '> [!question] 给我讲解一下',
  '',
  ANSWER,
  '',
  '> [!side] 为什么减掉门槛，而不是清零？',
  '> > 水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量',
  '>',
  '> #### 减掉门槛，不清零',
  '>',
  '> 水位冲到 1.3 时，减掉 1 还剩 0.3，下一次更快到门槛。',
  '>',
  '> > 清零就把多出来的扔了。',
  '',
  '> [!side] 那门槛是多少？',
  '>',
  '> 门槛 V_th 是一个参数，这一页设成 1。',
  '',
  '> [!question] 还是不懂',
  '',
  '换个方式讲：先别看公式，看图。',
  '',
  '> [!recap] LIF 用「漏、积、发」三步描述神经元；另问了为什么不清零。',
  '',
].join('\n')

describe('笔记一段（新格式）', () => {
  it('写出来的样子：问题条是原话、回答原文、旁支挂在被问那一问后面、末尾小结，身份是行尾注释，我框的写宽度', () => {
    expect(renderSection(sec(), NOTE)).toBe(MD)
  })

  it('读回来一样；再写一次一字不差', () => {
    const md = newReadingNote(PDF) + '\n' + renderSection(sec(), NOTE)
    const back = parseReadingNote(md, NOTE)
    expect(back).toEqual([sec()])
    expect(renderSection(back[0]!, NOTE)).toBe(MD)
  })

  it('同一条旁支的追问不带引用句，读回来还是同一条旁支；两条旁支各是各的', () => {
    const two = sec()
    two.qas![0]!.sides.push({ quote: 'I_b 决定了神经元闲着的时候水位停在哪', turns: [{ q: '为啥需要有这个常开的水龙头？', a: '它是底水位。' }] })
    const back = parseReadingNote(renderSection(withDerived(two), NOTE), NOTE)[0]!
    expect(back.qas![0]!.sides.map((s) => [s.quote, s.turns.map((t) => t.q)])).toEqual([
      ['水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量', ['为什么减掉门槛，而不是清零？', '那门槛是多少？']],
      ['I_b 决定了神经元闲着的时候水位停在哪', ['为啥需要有这个常开的水龙头？']],
    ])
  })

  it('给还没换的地方用的旧字段：疑惑是原话（主问题 + 旁支问题），讲法是第一个回答开头一段，问了几问', () => {
    const s = parseReadingNote(MD, NOTE)[0]!
    expect(s.doubts).toEqual(['给我讲解一下', '为什么减掉门槛，而不是清零？', '那门槛是多少？', '还是不懂'])
    expect(s.good).toBe('**一句话：LIF 神经元就是一个会漏水的水桶。**这一页用三条公式描述最简单的脉冲神经元。')
    expect(s.rounds).toBe(4)
    expect(s.points).toEqual([])
    expect(s.failed).toEqual([])
  })

  it('多段引用的问题：字里的 ①② 写成脚注，定义放在这一段末尾（引文和来源、图）；读回来还是 ①② 和那几块', () => {
    const s = sec({
      qas: [
        {
          q: '①和②说的是一回事吗？',
          a: '是一回事。',
          mats: [
            { kind: 'quote', text: '水位一到门槛就发一个 spike', src: 'AI的回答 · 第28页' },
            { kind: 'image', path: '附件/Lecture05/p28-1-m2.png', src: '粘贴的图' },
          ],
          // 每一问的材料各自从 ① 数（输入框里就是这样）；写进文件时这一段里接着往后编号，不撞
          sides: [{ quote: '是一回事', turns: [{ q: '①为什么？', a: '因为都在说门槛。', mats: [{ kind: 'quote', text: '门槛', src: '《随手记》' }] }] }],
        },
      ],
    })
    const md = renderSection(s, NOTE)
    expect(md).toContain('> [!question] [^p28-1-1]和[^p28-1-2]说的是一回事吗？\n')
    expect(md).toContain('> [!side] [^p28-1-3]为什么？\n')
    expect(md).toContain(
      '> [!recap] LIF 用「漏、积、发」三步描述神经元；另问了为什么不清零。\n\n[^p28-1-1]: 「水位一到门槛就发一个 spike」 AI的回答 · 第28页\n[^p28-1-2]: ![粘贴的图|180](../../附件/Lecture05/p28-1-m2.png)\n[^p28-1-3]: 「门槛」 《随手记》\n',
    )
    const back = parseReadingNote(md, NOTE)[0]!
    expect(back.qas![0]).toEqual(s.qas![0])
    expect(renderSection(back, NOTE)).toBe(md)
  })

  it('材料的编号字里没有了：脚注接在问题后面，读回来再写不变', () => {
    const s = sec({ qas: [{ q: '这是什么？', a: '是门槛。', mats: [{ kind: 'quote', text: '门槛', src: '《随手记》' }], sides: [] }] })
    const md = renderSection(s, NOTE)
    expect(md).toContain('> [!question] 这是什么？[^p28-1-1]\n')
    const back = parseReadingNote(md, NOTE)[0]!
    expect(back.qas![0]!.q).toBe('这是什么？①')
    expect(renderSection(back, NOTE)).toBe(md)
  })

  it('可视化和双链在这一段最后一行；整页问的写「整页」不写宽度；网页上问的第二行是域名', () => {
    const s = sec({ viz: { path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位' }, links: ['第4讲 脉冲网络'] })
    const md = renderSection(s, NOTE)
    expect(md.trimEnd().split('\n').pop()).toBe('[可视化 · LIF 水桶 · 拖着看水位](LIF%20水桶.html) · [[第4讲 脉冲网络]]')
    const back = parseReadingNote(md, NOTE)[0]!
    expect(back.viz).toEqual({ path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位' })
    expect(back.links).toEqual(['第4讲 脉冲网络'])
    expect(renderSection(back, NOTE)).toBe(md)

    const page = sec({ rect: undefined, cropW: undefined })
    delete page.rect
    delete page.cropW
    expect(renderSection(page, NOTE)).toContain('\n![整页](../../附件/Lecture05/p28-1.png)\n')
    expect(parseReadingNote(renderSection(page, NOTE), NOTE)).toEqual([page])

    const web = sec({ id: '.canvas-notes/对话/网页-example.com-p28-1.md', web: { url: 'https://example.com/a (b)', label: 'example.com' } })
    const wmd = renderSection(web, NOTE)
    expect(wmd.split('\n')[1]).toBe('[example.com](https://example.com/a%20%28b%29) · 20:21 <!-- cn:thread=网页-example.com-p28-1 -->')
    expect(parseReadingNote(wmd, NOTE)[0]!.web).toEqual({ url: 'https://example.com/a (b)', label: 'example.com' })
  })

  it('新做的可视化嵌进这一段末尾：单独一段 ![可视化 · 标题](x.html)，双链在它后面；读回来再写一字不差；以前脚上那行链接原样留着（task-m552v）', () => {
    const s = sec({ viz: { path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位', embed: true }, links: ['第4讲 脉冲网络'] })
    const md = renderSection(s, NOTE)
    const tail = md.trimEnd().split('\n')
    expect(tail.slice(-3)).toEqual(['![可视化 · LIF 水桶 · 拖着看水位](LIF%20水桶.html)', '', '[[第4讲 脉冲网络]]'])
    const back = parseReadingNote(md, NOTE)[0]!
    expect(back.viz).toEqual({ path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位', embed: true })
    expect(back.links).toEqual(['第4讲 脉冲网络'])
    expect(back.figures).toEqual(s.figures)
    expect(back.qas![back.qas!.length - 1]!.a).toBe(s.qas![s.qas!.length - 1]!.a)
    expect(renderSection(back, NOTE)).toBe(md)
    // 没有双链、没有小结：嵌入就是最后一段，从最后一个回答末尾剥下来
    const bare = sec({ viz: { path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位', embed: true }, recap: '' })
    const bmd = renderSection(bare, NOTE)
    expect(bmd.trimEnd().split('\n').pop()).toBe('![可视化 · LIF 水桶 · 拖着看水位](LIF%20水桶.html)')
    const bb = parseReadingNote(bmd, NOTE)[0]!
    expect(bb.viz?.embed).toBe(true)
    expect(renderSection(bb, NOTE)).toBe(bmd)
    // 以前的链接：读回来没有 embed，再写还是脚上那一行链接
    const old = renderSection(sec({ viz: { path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位' } }), NOTE)
    const ob = parseReadingNote(old, NOTE)[0]!
    expect(ob.viz).toEqual({ path: '课程/ecpc/LIF 水桶.html', title: 'LIF 水桶 · 拖着看水位' })
    expect(renderSection(ob, NOTE)).toBe(old)
  })

  it('回答里的 ## 标题、代码块里像结构的行不把这一段切开', () => {
    const a = demoteHeadings('# 大标题\n\n## 小标题\n\n```md\n## 代码里的不动\n> [!question] 代码里的\n```\n\n正文')
    expect(a).toBe('### 大标题\n\n#### 小标题\n\n```md\n## 代码里的不动\n> [!question] 代码里的\n```\n\n正文')
    expect(demoteHeadings('### 已经够深\n#### 再深')).toBe('### 已经够深\n#### 再深')
    const s = sec({ qas: [{ q: '讲讲', a, sides: [] }] })
    let md = newReadingNote(PDF)
    md = upsertSection(md, s, NOTE)
    md += '\n## 我自己记的\n\n考试要考。\n'
    const back = parseReadingNote(md, NOTE)
    expect(back.map((x) => x.id)).toEqual([ID])
    expect(back[0]!.qas![0]!.a).toBe(a)
    expect(md).toContain('## 我自己记的\n\n考试要考。\n')
  })

  it('同一处再问（旧格式的那段）：整段换成新格式，别的段和用户自己写的字不动；再写一次一样的文件不变', () => {
    const old = [
      '## 第 28 页 · 旧标题',
      '[第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6) · 20:21',
      '',
      '![我框的](../../附件/Lecture05/p28-1.png)',
      '',
      '> [!question] 我的疑惑',
      '> 整块没看懂：第 28 页框的这块',
      '',
      '> [!ai] AI 讲解 · 看了第 28 页',
      '> 先看图，再看公式。',
      '',
      '[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture05-p28-1.md) · [[第4讲 脉冲网络]]',
      '',
    ].join('\n')
    const other = '## 第 30 页 · 别的\n[第 30 页](Lecture05.pdf#page=30) · 20:30\n\n> [!question] 我的疑惑\n> 第三十页\n\n[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture05-p30-1.md)\n'
    let md = newReadingNote(PDF) + '\n' + old + '\n## 我自己记的\n\n考试要考。\n\n' + other
    // 旧的照旧读得回来
    const before = parseReadingNote(md, NOTE)
    expect(before.map((s) => [s.page, s.doubts[0], s.good, s.qas])).toEqual([
      [28, '整块没看懂：第 28 页框的这块', '先看图，再看公式。', undefined],
      [30, '第三十页', '', undefined],
    ])
    md = upsertSection(md, sec({ links: before[0]!.links }), NOTE)
    const after = parseReadingNote(md, NOTE)
    expect(after.map((s) => [s.page, !!s.qas])).toEqual([
      [28, true],
      [30, false],
    ])
    expect(after[0]!.links).toEqual(['第4讲 脉冲网络'])
    expect(md).not.toContain('旧标题')
    expect(md).toContain('## 我自己记的\n\n考试要考。\n')
    expect(md).toContain(other)
    expect(upsertSection(md, after[0]!, NOTE)).toBe(md)
  })

  it('身份：完整对话的路径 ↔ 行尾注释里的名字', () => {
    expect(threadName(ID)).toBe('Lecture05-p28-1')
    expect(threadName('.canvas-notes/对话/第3讲 线性映射-p5-1.md')).toBe('第3讲 线性映射-p5-1')
  })

  it('回答原文开头一段：跳过标题，取第一段（列表、公式块也算一段）', () => {
    expect(answerLead(ANSWER)).toBe('**一句话：LIF 神经元就是一个会漏水的水桶。**这一页用三条公式描述最简单的脉冲神经元。')
    expect(answerLead(SIDE_ANSWER)).toBe('水位冲到 1.3 时，减掉 1 还剩 0.3，下一次更快到门槛。')
    expect(answerLead('- 第一条\n- 第二条\n\n后面')).toBe('- 第一条\n- 第二条')
    expect(answerLead('')).toBe('')
  })
})

describe('我的疑惑：数和用用户的原话（主问题 + 旁支问题）', () => {
  it('每一问一条：主对话的问题、旁支里的问题各一条，「还是不懂」并进上一问（回答用最后讲的那一版）；第一条的身份就是这一段的', () => {
    const items = doubtItems(PDF, parseReadingNote(MD, NOTE)[0]!, 5)
    expect(items.map((it) => [it.section.doubts, it.section.good, it.quote ?? ''])).toEqual([
      [['给我讲解一下'], '换个方式讲：先别看公式，看图。', ''],
      [['为什么减掉门槛，而不是清零？'], '水位冲到 1.3 时，减掉 1 还剩 0.3，下一次更快到门槛。', '水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量'],
      [['那门槛是多少？'], '门槛 V_th 是一个参数，这一页设成 1。', '水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量'],
    ])
    expect(items[0]!.id).toBe(ID)
    expect(items[1]!.id).toMatch(/^\.canvas-notes\/对话\/Lecture05-p28-1\.md#[0-9a-z]+$/)
    expect(new Set(items.map((i) => i.id)).size).toBe(3)
    expect(items.every((i) => i.pdf === PDF && i.lecture === 5 && i.section.page === 28)).toBe(true)
    // 再问一句，前面几条的身份不变（送过 Anki 的记号还对得上）
    const more = sec()
    more.qas!.push({ q: '那 τ_m 呢？', a: '时间常数。', sides: [] })
    const again = doubtItems(PDF, withDerived(more), 5)
    expect(again.slice(0, 3).map((i) => i.id)).toEqual(items.map((i) => i.id))
    expect(again).toHaveLength(4)
  })

  it('旧格式的一段还是一条（AI 写的疑惑、讲通的讲法）', () => {
    const old = parseReadingNote('## 第 3 页 · 旧\n[第 3 页](Lecture05.pdf#page=3) · 10:00\n\n> [!question] 我的疑惑\n> 整块没看懂\n\n> [!ai] AI 讲解\n> 讲法\n\n[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture05-p3-1.md)\n', NOTE)[0]!
    expect(doubtItems(PDF, old).map((i) => [i.id, i.section.doubts[0], i.section.good])).toEqual([['.canvas-notes/对话/Lecture05-p3-1.md', '整块没看懂', '讲法']])
  })

  it('我的疑惑.md：一问一行（问题是原话），下面一行回答开头一段', () => {
    const items = doubtItems(PDF, parseReadingNote(MD, NOTE)[0]!, 5)
    const md = doubtsNote('课程/ecpc', 'ecpc', items, new Set())
    expect(md).toContain('ecpc · 3 条。')
    expect(md).toContain('- **给我讲解一下** [第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6)\n  换个方式讲：先别看公式，看图。')
    expect(md).toContain('- **为什么减掉门槛，而不是清零？** [第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6)\n  水位冲到 1.3 时')
  })
})

// 老库整理（2026-11-20「一个 PDF 一篇笔记」）：同一份 PDF 的两篇笔记按每段的身份合成一篇
describe('同一份 PDF 两篇笔记合成一篇', () => {
  const other = '课程/ecpc/Lecture05 笔记 2.md'
  const at = (page: number, n: number, qs: string[]) =>
    withDerived({ ...sec(), id: `.canvas-notes/对话/Lecture05-p${page}-${n}.md`, page, title: `第 ${page} 页的小标题`, qas: qs.map((q) => ({ q, a: `${q}的回答。`, sides: [] })), recap: `第 ${page} 页的小结` })

  it('不同的段按页插进第一篇；一样的段不重复；合完每段的身份只出现一次', () => {
    const a = upsertSection(upsertSection(newReadingNote(PDF), at(3, 1, ['问三']), NOTE), at(9, 1, ['问九']), NOTE)
    const b = upsertSection(upsertSection(newReadingNote(PDF), at(5, 1, ['问五']), other), at(9, 1, ['问九']), other)
    const md = mergeReadingNotes(a, b, NOTE, other)
    const secs = parseReadingNote(md, NOTE)
    expect(secs.map((s) => s.page)).toEqual([3, 5, 9])
    expect(new Set(secs.map((s) => s.id)).size).toBe(3)
    // 两边一样的段：不另放「以前的版本」
    expect(md).not.toContain('以前的版本')
    // 链接还是对的（两篇在同一个文件夹）：第 5 页那段指向这份 PDF
    expect(secs[1]!.file).toBe(PDF)
  })

  it('同一处两边都有：留问得多的那段（新的），另一版收进这一段后面的「以前的版本」（去掉身份，不会被当成第二段）', () => {
    const a = upsertSection(newReadingNote(PDF), at(3, 1, ['问三']), NOTE)
    const b = upsertSection(newReadingNote(PDF), at(3, 1, ['问三', '还是不懂']), other)
    const md = mergeReadingNotes(a, b, NOTE, other)
    const secs = parseReadingNote(md, NOTE)
    expect(secs).toHaveLength(1)
    expect(secs[0]!.qas!.map((q) => q.q)).toEqual(['问三', '还是不懂'])
    const i = md.indexOf('## 以前的版本 · 第 3 页 · 第 3 页的小标题')
    expect(i).toBeGreaterThan(md.indexOf('## 第 3 页 · 第 3 页的小标题'))
    expect(md.slice(i)).toContain('> [!question] 问三')
    expect(md.slice(i)).not.toContain('cn:thread=')
    // 再问这一处：整段换掉，「以前的版本」留着
    const again = upsertSection(md, at(3, 1, ['问三', '还是不懂', '第三问']), NOTE)
    expect(parseReadingNote(again, NOTE)[0]!.qas!.map((q) => q.q)).toEqual(['问三', '还是不懂', '第三问'])
    expect(again).toContain('## 以前的版本 · 第 3 页 · 第 3 页的小标题')
    // 问得一样多：留第一篇的
    const c = upsertSection(newReadingNote(PDF), { ...at(3, 1, ['问三']), recap: '另一篇的小结' }, other)
    const kept = mergeReadingNotes(a, c, NOTE, other)
    expect(parseReadingNote(kept, NOTE)[0]!.recap).toBe('第 3 页的小结')
    expect(kept).toContain('> [!recap] 另一篇的小结')
  })

  it('第二篇里自己写的段落（开头的、自己起的 ## 小节）原样搬到最后「从《Lecture05 笔记 2》并进来的」下面', () => {
    const a = upsertSection(newReadingNote(PDF), at(3, 1, ['问三']), NOTE)
    const b = newReadingNote(PDF) + '\n考前要看的几页：3、5、9。\n\n' + renderSection(at(5, 1, ['问五']), other) + '\n## 我自己的总结\n\n注意力就是查表。\n'
    const md = mergeReadingNotes(a, b, NOTE, other)
    const tail = md.slice(md.indexOf('## 从《Lecture05 笔记 2》并进来的'))
    expect(tail).toContain('考前要看的几页：3、5、9。')
    expect(tail).toContain('### 我自己的总结\n\n注意力就是查表。')
    // 属性和「# … 笔记」那一行不搬
    expect(tail).not.toContain('类型:')
    expect(tail).not.toMatch(/^# /m)
    expect(parseReadingNote(md, NOTE).map((s) => s.page)).toEqual([3, 5])
  })
})
