// 契约测试：ParaRead 写的配对笔记，画布笔记照样认对（ParaRead 写、画布笔记读）。
// 样本一律由 ParaRead 的写法函数（src/shared/pairedNote.ts）生成，不手写；读的一边是画布笔记读这篇用的 @cn/format。
// 放在 apps/pararead/test/：画布笔记根上的 pnpm test（vitest 认 apps/*/test/**）和 ParaRead 自己的 pnpm test 都跑，
// 谁改了 @cn/format 的写法或读法，ParaRead 那头当场红。
import { cropGaps, doubtItems, notePathFor, parseReadingNote, renderSection, threadName, upsertSection } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { annotationSection, chatSections, writeSections } from '../src/shared/pairedNote'
import type { Annotation, ChatMessage } from '../src/shared/types'

const PDF = '课程/ecp/2026_C72_BST-GATNet_driver_stress_EMBC.pdf'
const NOTE = notePathFor(PDF)
const at = (hh: number, mm: number) => new Date(2026, 10, 23, hh, mm).getTime()

const ann = (o: Partial<Annotation>): Annotation => ({
  id: 'kX3-a_9Qz1',
  paperId: 'p1',
  mode: 'pdf',
  color: 'red',
  style: 'underline',
  label: 'confused',
  labelStatus: null,
  explain: null,
  text: 'a Bi-LSTM is introduced as a temporal refinement layer',
  note: '',
  page: 2,
  rects: [[0.51, 0.635, 0.437, 0.033]],
  blockId: null,
  blockHash: null,
  start: null,
  end: null,
  section: '',
  createdAt: at(16, 44),
  updatedAt: at(16, 44),
  ...o,
})

const msg = (id: string, role: 'user' | 'assistant', content: string, o: Partial<ChatMessage> = {}): ChatMessage => ({ id, paperId: 'p1', role, content, quote: null, image: null, createdAt: at(15, 26), ...o })

const confused = ann({
  explain: {
    versions: [{ focus: 'Bi-LSTM 为什么放在注意力后面', raw: '<one>先抓各路信号之间的关系，再顺着时间把结果理一遍。</one>', at: at(16, 45) }],
    misses: 0,
    chat: [{ q: '那去掉 Bi-LSTM 会怎样？', a: '时间上前后几秒的变化就看不到了。', at: at(16, 47) }],
  },
})
const doubt = ann({ id: 'Zz9-doubt1', label: 'doubt', labelStatus: 'dismissed', mode: 'reflow', rects: null, page: 3, text: 'implicit fully-connected topology', note: '全连接真的比稀疏好吗', createdAt: at(16, 50) })
const plainHighlight = ann({ id: 'noLabel', label: null })
const noPage = ann({ id: 'noPage', page: null })
const chat = [
  msg('m1', 'user', '这篇论文一句话讲了什么？'),
  msg('m2', 'assistant', '用图注意力加双向 LSTM 从可穿戴信号判断司机压力。\n\n## 方法\n三路信号各成一个结点。'),
  msg('m3', 'user', '这个数据集多大？', { quote: 'we selected the AffectiveROAD dataset [14]' }),
  msg('m4', 'assistant', '13 次驾驶，每次约 1 小时。\n\n接着问：采样率多少？|怎么标注压力？'),
  msg('m5', 'user', '还有别的数据集吗？'),
  msg('m6', 'assistant', '文中只用了这一个。'),
  msg('m7', 'user', '出错的这一问不写'),
  msg('m8', 'assistant', '', { error: '网络断了' }),
]
const pageOf = (q: string) => (q.includes('AffectiveROAD') ? 2 : null)

function sample(): string {
  const sections = [annotationSection(PDF, confused)!, annotationSection(PDF, doubt)!, ...chatSections(PDF, chat, pageOf)]
  return writeSections(null, PDF, NOTE, sections, new Date(at(17, 0)))
}

describe('ParaRead 写的配对笔记，画布笔记认得对', () => {
  it('没打标签、没有页码的标注不写', () => {
    expect(annotationSection(PDF, plainHighlight)).toBeNull()
    expect(annotationSection(PDF, noPage)).toBeNull()
  })

  it('标题截在英文词中间时退到前一个空格', () => {
    const t = annotationSection(PDF, ann({ id: 'long', text: 'The dominant sequence transduction models are based on complex recurrent networks' }))!.title
    expect(t).toBe('看不懂：The dominant sequence transduction…')
  })

  it('每一处都读回同一个身份、页码、框的位置、原文和问答', () => {
    const got = parseReadingNote(sample(), NOTE)
    expect(got.map((s) => [threadName(s.id), s.page, s.title])).toEqual([
      ['2026_C72_BST-GATNet_driver_stress_EMBC-p1-pr-m1', 1, '这篇论文一句话讲了什么？'],
      ['2026_C72_BST-GATNet_driver_stress_EMBC-p2-pr-kX3a9Qz1', 2, '看不懂：Bi-LSTM 为什么放在注意力后面'],
      ['2026_C72_BST-GATNet_driver_stress_EMBC-p2-pr-m3', 2, '这个数据集多大？'],
      ['2026_C72_BST-GATNet_driver_stress_EMBC-p3-pr-Zz9doubt1', 3, '有质疑：全连接真的比稀疏好吗'],
    ])
    const c = got[1]!
    expect(c.file).toBe(PDF)
    expect(c.rect).toEqual([0.51, 0.635, 0.437, 0.033])
    expect(c.time).toBe('16:44')
    // 原文写在问题块里（头一行是标签），不另起引用块：不算选字问，画布笔记会照框补「我框的」截图
    expect(c.quote).toBeUndefined()
    // cropGaps 也列出问整篇的那段（没摘录、没框）；画布笔记只给有框的补图，它不补
    expect(cropGaps(sample(), NOTE).map((g) => threadName(g.id))).toEqual(['2026_C72_BST-GATNet_driver_stress_EMBC-p1-pr-m1', '2026_C72_BST-GATNet_driver_stress_EMBC-p2-pr-kX3a9Qz1', '2026_C72_BST-GATNet_driver_stress_EMBC-p3-pr-Zz9doubt1'])
    expect(c.qas?.map((q) => [q.q, q.a])).toEqual([
      ['看不懂\na Bi-LSTM is introduced as a temporal refinement layer', '先抓各路信号之间的关系，再顺着时间把结果理一遍。'],
      ['那去掉 Bi-LSTM 会怎样？', '时间上前后几秒的变化就看不到了。'],
    ])
    // 小结：处理到哪了加回答的第一句
    expect(c.recap).toBe('先抓各路信号之间的关系，再顺着时间把结果理一遍。')
    // 对照模式的标注没有 PDF 上的框：整页链接；标题、问题里有自己写的话
    expect(got[3]!.rect).toBeUndefined()
    expect(got[3]!.qas?.[0]?.q).toBe('有质疑\nimplicit fully-connected topology\n全连接真的比稀疏好吗')
    expect(got[3]!.recap).toBe('质疑不成立')
    // AI 问答：带摘录的开新段，没带的并进上一段；回答里的 ## 降级，不把一段切开；出错的那一问没写
    expect(got[0]!.qas?.map((q) => q.q)).toEqual(['这篇论文一句话讲了什么？'])
    expect(got[0]!.qas?.[0]?.a).toContain('### 方法')
    expect(got[2]!.quote).toBe('we selected the AffectiveROAD dataset [14]')
    expect(got[2]!.qas?.map((q) => q.q)).toEqual(['这个数据集多大？', '还有别的数据集吗？'])
    expect(sample()).not.toContain('出错的这一问不写')
    // 回答末尾 ParaRead 界面上的「接着问」建议不进笔记
    expect(got[2]!.qas?.[0]?.a).toBe('13 次驾驶，每次约 1 小时。')
  })

  it('画布笔记的疑惑清单、出卡按问数：4 处 6 问', () => {
    const items = parseReadingNote(sample(), NOTE).flatMap((s) => doubtItems(PDF, s))
    expect(items).toHaveLength(6)
    expect(new Set(items.map((i) => i.id)).size).toBe(6)
  })

  it('画布笔记把读回来的一段原样写回去，一个字节不变（打开再保存不变）', () => {
    const md = sample()
    let again = md
    for (const s of parseReadingNote(md, NOTE)) again = upsertSection(again, s, NOTE)
    expect(again).toBe(md)
    for (const s of parseReadingNote(md, NOTE)) expect(md).toContain(renderSection(s, NOTE))
  })

  it('同样的内容再写一次不变；讲解换了一版只换那一段，用户另起标题写的和画布笔记自己记的段原样留着', () => {
    const cnOwn = [
      '## 第 2 页 · 切窗口：30 秒、步长 15 秒',
      '[第 2 页](2026_C72_BST-GATNet_driver_stress_EMBC.pdf#page=2&rect=0.5,0.341,0.444,0.141) · 17:41 <!-- cn:thread=2026_C72_BST-GATNet_driver_stress_EMBC-p2-1 -->',
      '',
      '> [!question] 为什么是 30 秒',
      '',
      '窗口太短看不出压力的变化。',
      '',
    ].join('\n')
    const md = sample().replace(/\n*$/, '\n\n## 我自己的想法\n\n我自己的一句话。\n\n') + cnOwn
    const sections = [annotationSection(PDF, confused)!, annotationSection(PDF, doubt)!, ...chatSections(PDF, chat, pageOf)]
    expect(writeSections(md, PDF, NOTE, sections)).toBe(md)
    const newer = { ...confused, explain: { ...confused.explain!, versions: [...confused.explain!.versions, { focus: 'Bi-LSTM 为什么放在注意力后面', raw: '<one>换个讲法。</one>', at: at(17, 5) }] } }
    const next = writeSections(md, PDF, NOTE, [annotationSection(PDF, newer)!])
    expect(next).toContain('换个讲法。')
    expect(next).not.toContain('先抓各路信号之间的关系')
    expect(next).toContain('我自己的一句话。')
    expect(next).toContain(cnOwn)
    expect(parseReadingNote(next, NOTE)).toHaveLength(5)
  })
})

// 对照、译文看法里框了一块问的（2026-11-23，设计页 51）：页码和框照原 PDF，截图照截的那边，译文那张图注「我框的 · 译文」、文件名加 .zh
describe('对照看法里框选问的，写进配对笔记', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo='
  const box = (side: 'src' | 'tr' | 'both') => ({ page: 9, rect: [0.0451, 0.3302, 0.7801, 0.1403] as [number, number, number, number], side, src: side === 'tr' ? null : PNG, tr: side === 'src' ? null : PNG })
  const ask = (id: string, side: 'src' | 'tr' | 'both') => [msg(id, 'user', 'HDC 为什么要这么高的维度？', { image: PNG, box: box(side) }), msg(`${id}a`, 'assistant', '维度 D 越高，随机向量越接近正交。', { createdAt: at(15, 27) })]
  const write = (side: 'src' | 'tr' | 'both') => writeSections(null, PDF, NOTE, chatSections(PDF, ask(`bx${side}`, side), () => null))

  it('只带译文：一张「我框的 · 译文」，.zh 文件；页码链接指原 PDF 第 9 页那块', () => {
    const md = write('tr')
    expect(md).toContain('[第 9 页](2026_C72_BST-GATNet_driver_stress_EMBC.pdf#page=9&rect=0.045,0.33,0.78,0.14)')
    expect(md).toMatch(/!\[我框的 · 译文\]\(\.\.\/\.\.\/附件\/2026_C72_BST-GATNet_driver_stress_EMBC\/p9-pr-bxtr\.zh\.png\)/)
    expect(md).not.toMatch(/!\[我框的\]\(/)
    const [s] = parseReadingNote(md, NOTE)
    expect(s.page).toBe(9)
    expect(s.crop).toBe('附件/2026_C72_BST-GATNet_driver_stress_EMBC/p9-pr-bxtr.zh.png')
    expect(s.cropSide).toBe('tr')
    expect(s.qas?.[0].q).toBe('HDC 为什么要这么高的维度？')
    expect(cropGaps(md, NOTE)).toEqual([])
  })
  it('两边都带：原文那张在前、译文那张在后', () => {
    const md = write('both')
    const a = md.indexOf('![我框的](')
    const b = md.indexOf('![我框的 · 译文](')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    const [s] = parseReadingNote(md, NOTE)
    expect(s.crop).toMatch(/p9-pr-bxboth\.png$/)
    expect(s.cropTr).toMatch(/p9-pr-bxboth\.zh\.png$/)
    expect(s.cropSide).toBeUndefined()
  })
  it('只带原文：和原文看法里框的一样写「我框的」', () => {
    const md = write('src')
    expect(md).toMatch(/!\[我框的\]\(\.\.\/\.\.\/附件\/2026_C72_BST-GATNet_driver_stress_EMBC\/p9-pr-bxsrc\.png\)/)
    expect(md).not.toContain('译文')
  })
  it('三种读回来再写回去，一个字节不变', () => {
    for (const side of ['src', 'tr', 'both'] as const) {
      const md = write(side)
      let again = md
      for (const s of parseReadingNote(md, NOTE)) again = upsertSection(again, s, NOTE)
      expect(again).toBe(md)
    }
  })
})
