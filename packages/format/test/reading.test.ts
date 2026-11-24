import { describe, expect, it } from 'vitest'
import {
  type AskSection,
  blockHash,
  blocksText,
  conversationMd,
  courseOf,
  documentBlocks,
  formatPdfAnchor,
  itemsToLines,
  lectureOf,
  newReadingNote,
  notePathFor,
  pageBlocks,
  parsePdfAnchor,
  parseReadingNote,
  readProps,
  aiFilled,
  renderSection,
  upsertSection,
  type PdfTextItem,
  doubtsNote,
  groupDoubts,
  type DoubtItem,
} from '../src'

describe('PDF 链接', () => {
  it('页码和框的位置写进链接，读回来一样', () => {
    const href = formatPdfAnchor({ file: '课程/线性代数/第3讲 线性映射.pdf', page: 5, rect: [0.05, 0.2912, 0.52, 0.36] })
    expect(href).toBe('课程/线性代数/第3讲%20线性映射.pdf#page=5&rect=0.05,0.291,0.52,0.36')
    expect(parsePdfAnchor(href)).toEqual({ file: '课程/线性代数/第3讲 线性映射.pdf', page: 5, rect: [0.05, 0.291, 0.52, 0.36] })
  })
  it('只有页码、没有 rect 也认；不是 PDF、页码不对的不认', () => {
    expect(parsePdfAnchor('a.pdf#page=3')).toEqual({ file: 'a.pdf', page: 3 })
    expect(parsePdfAnchor('a.pdf')).toEqual({ file: 'a.pdf', page: 1 })
    expect(parsePdfAnchor('a.md#page=3')).toBeNull()
    expect(parsePdfAnchor('a.pdf#page=0')).toBeNull()
    expect(parsePdfAnchor('a.pdf#page=x')).toBeNull()
  })
  it('框超出页面的部分夹回来', () => {
    expect(parsePdfAnchor('a.pdf#page=1&rect=-0.1,0.5,2,0.8')?.rect).toEqual([0, 0.5, 1, 0.5])
  })
})

describe('笔记放哪、属性', () => {
  it('同一个文件夹里的「… 笔记.md」', () => {
    expect(notePathFor('课程/线性代数/第3讲 线性映射.pdf')).toBe('课程/线性代数/第3讲 线性映射 笔记.md')
    expect(notePathFor('a.pdf')).toBe('a 笔记.md')
  })
  it('课程和讲次从路径和文件名来', () => {
    expect(courseOf('课程/线性代数/第3讲 线性映射.pdf')).toBe('线性代数')
    expect(courseOf('收件箱/x.pdf')).toBeUndefined()
    expect(lectureOf('第 12 讲 特征值.pdf')).toBe(12)
    expect(lectureOf('Lecture 3 - Linear Maps.pdf')).toBe(3)
    expect(lectureOf('L04 notes.pdf')).toBe(4)
    expect(lectureOf('随便.pdf')).toBeUndefined()
  })
  it('新笔记开头有属性（和导图、课程首页同一套键，课程和第几讲记成 AI 填的）和标题', () => {
    const md = newReadingNote('课程/线性代数/第3讲 线性映射.pdf', new Date(2026, 10, 15))
    expect(md).toBe('---\n类型: 笔记\n课程: 线性代数\n第几讲: 3\n来源: "[[第3讲 线性映射.pdf]]"\n日期: 2026-11-15\nAI填的: 课程, 第几讲\n---\n\n# 第3讲 线性映射 笔记\n')
    expect(readProps(md).map((p) => [p.key, p.value])).toContainEqual(['来源', '[[第3讲 线性映射.pdf]]'])
    expect(aiFilled(md)).toEqual(['课程', '第几讲'])
    expect(newReadingNote('收件箱/讲义.pdf', new Date(2026, 10, 15))).toBe('---\n类型: 笔记\n来源: "[[讲义.pdf]]"\n日期: 2026-11-15\n---\n\n# 讲义 笔记\n')
  })
})

const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'

const sec = (over: Partial<AskSection> = {}): AskSection => ({
  id: '.canvas-notes/对话/第3讲 线性映射-p5-1.md',
  file: '课程/线性代数/第3讲 线性映射.pdf',
  page: 5,
  rect: [0.05, 0.29, 0.52, 0.36],
  title: '旋转矩阵每个数从哪来',
  time: '10:20',
  crop: '附件/第3讲 线性映射/p5-1.png',
  figures: [{ path: '附件/第3讲 线性映射/p5-1-fig.png', caption: '第 5 页 · 单位圆上的 e₁、e₂' }],
  doubts: ['整块没看懂：旋转矩阵的四个数是怎么来的', '还是不懂 −sin θ 为什么在右上角'],
  good: '换个看法，先别看公式，看图。\n\n把整张方格纸钉住原点。',
  goodVersion: 2,
  points: ['R(θ) 第 1 列 = (cos θ, sin θ)', 'e₂ 转完往左偏，所以是 −sin θ'],
  failed: [{ version: 1, line: '用第 4 页「列 = 基向量去哪」套公式', text: '用你在第 4 页弄懂的那条……' }],
  rounds: 2,
  links: ['第4讲 特征值#旋转矩阵没有实特征值'],
  ...over,
})

describe('笔记一段', () => {
  it('写出来的样子', () => {
    expect(renderSection(sec(), NOTE)).toBe(
      [
        '## 第 5 页 · 旋转矩阵每个数从哪来',
        '[第 5 页](第3讲%20线性映射.pdf#page=5&rect=0.05,0.29,0.52,0.36) · 10:20',
        '',
        '![我框的](../../附件/第3讲%20线性映射/p5-1.png)',
        '',
        '![第 5 页 · 单位圆上的 e₁、e₂](../../附件/第3讲%20线性映射/p5-1-fig.png)',
        '',
        '> [!question] 我的疑惑',
        '> 整块没看懂：旋转矩阵的四个数是怎么来的',
        '> 还是不懂 −sin θ 为什么在右上角',
        '',
        '> [!ai] AI 讲解（第 2 版） · 看了第 5 页',
        '> 换个看法，先别看公式，看图。',
        '>',
        '> 把整张方格纸钉住原点。',
        '>',
        '> - R(θ) 第 1 列 = (cos θ, sin θ)',
        '> - e₂ 转完往左偏，所以是 −sin θ',
        '',
        '<details><summary>没讲通 · 第 1 版：用第 4 页「列 = 基向量去哪」套公式</summary>',
        '',
        '用你在第 4 页弄懂的那条……',
        '',
        '</details>',
        '',
        '[完整对话 · 2 轮](../../.canvas-notes/对话/第3讲%20线性映射-p5-1.md) · [[第4讲 特征值#旋转矩阵没有实特征值]]',
        '',
      ].join('\n'),
    )
  })

  it('AI 讲的放进 [!ai] 提示块，头上写哪家哪个模型、看了什么；读回来一样（CN-76）', () => {
    const s = sec({ by: 'Claude Code · Opus 5.5' })
    const md = renderSection(s, NOTE)
    expect(md).toContain('> [!ai] AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页\n> 换个看法')
    expect(parseReadingNote(newReadingNote('课程/线性代数/第3讲 线性映射.pdf') + '\n' + md, NOTE)).toEqual([s])
  })

  it('以前写的 [!success] 讲通的讲法 + 块外要点照样读得回来', () => {
    const old = renderSection(sec(), NOTE).replace(
      '> [!ai] AI 讲解（第 2 版） · 看了第 5 页\n> 换个看法，先别看公式，看图。\n>\n> 把整张方格纸钉住原点。\n>\n> - R(θ) 第 1 列 = (cos θ, sin θ)\n> - e₂ 转完往左偏，所以是 −sin θ',
      '> [!success] 讲通的讲法（第 2 版）\n> 换个看法，先别看公式，看图。\n>\n> 把整张方格纸钉住原点。\n\n- R(θ) 第 1 列 = (cos θ, sin θ)\n- e₂ 转完往左偏，所以是 −sin θ',
    )
    expect(old).toContain('[!success]')
    expect(parseReadingNote(newReadingNote('课程/线性代数/第3讲 线性映射.pdf') + '\n' + old, NOTE)).toEqual([sec()])
  })

  it('写出来再读回来一样', () => {
    const md = newReadingNote('课程/线性代数/第3讲 线性映射.pdf') + '\n' + renderSection(sec(), NOTE)
    expect(parseReadingNote(md, NOTE)).toEqual([sec()])
  })

  it('整页问的没有 rect、没换过讲法、没有图也能读回来', () => {
    const s = sec({ rect: undefined, crop: undefined, figures: [], goodVersion: undefined, failed: [], links: [], time: undefined })
    delete s.rect
    delete s.goodVersion
    delete s.time
    delete s.crop
    expect(parseReadingNote(renderSection(s, NOTE), NOTE)).toEqual([s])
  })

  it('同一处接着问：整段换掉，别的段和用户自己写的字不动', () => {
    let md = newReadingNote('课程/线性代数/第3讲 线性映射.pdf')
    md = upsertSection(md, sec(), NOTE)
    md += '\n## 我自己记的\n\n考试要考。\n'
    const p2 = sec({ id: '.canvas-notes/对话/第3讲 线性映射-p2-1.md', page: 2, title: '线性映射两条' })
    md = upsertSection(md, p2, NOTE)
    const p9 = sec({ id: '.canvas-notes/对话/第3讲 线性映射-p9-1.md', page: 9, title: '第九页' })
    md = upsertSection(md, p9, NOTE)
    // 按页排：第 2 页插在第 5 页前面；第 9 页没有更大的页，放在最后
    expect(parseReadingNote(md, NOTE).map((s) => s.page)).toEqual([2, 5, 9])
    const again = sec({ rounds: 3, doubts: ['新的疑惑'] })
    const md2 = upsertSection(md, again, NOTE)
    expect(parseReadingNote(md2, NOTE).map((s) => [s.page, s.rounds, s.doubts[0]])).toEqual([
      [2, 2, '整块没看懂：旋转矩阵的四个数是怎么来的'],
      [5, 3, '新的疑惑'],
      [9, 2, '整块没看懂：旋转矩阵的四个数是怎么来的'],
    ])
    expect(md2).toContain('## 我自己记的\n\n考试要考。\n')
    expect(md2.startsWith('---\n类型: 笔记')).toBe(true)
    // 再写一次一模一样的，文件不变
    expect(upsertSection(md2, again, NOTE)).toBe(md2)
  })

  it('用户手改过的段落也尽量读：没有完整对话链接的段不算', () => {
    const md = '# x\n\n## 第 3 页 · 手写的\n\n随便写写\n'
    expect(parseReadingNote(md, NOTE)).toEqual([])
  })

  it('链接相对笔记：同文件夹、上几层、文件名里有括号都能读回库里的路径', () => {
    const s = sec({ crop: '附件/第3讲 线性映射 (2)/p5-1.png', figures: [], id: '.canvas-notes/对话/x-p5-1.md' })
    const md = renderSection(s, NOTE)
    expect(md).toContain('![我框的](../../附件/第3讲%20线性映射%20%282%29/p5-1.png)')
    expect(parseReadingNote(md, NOTE)[0]).toMatchObject({ crop: '附件/第3讲 线性映射 (2)/p5-1.png', file: '课程/线性代数/第3讲 线性映射.pdf', id: '.canvas-notes/对话/x-p5-1.md' })
    // 笔记在库根目录
    const top = renderSection(sec({ file: 'a.pdf', crop: '附件/a/p1.png', figures: [] }), 'a 笔记.md')
    expect(top).toContain('](a.pdf#page=5')
    expect(top).toContain('![我框的](附件/a/p1.png)')
  })

  it('「问这一页」附的是整页（没有框）：图的说明写「整页」，读回来还是这一段的截图，再写一样', () => {
    const s = sec({ rect: undefined, figures: [] })
    const md = renderSection(s, NOTE)
    expect(md).toContain('![整页](../../附件/第3讲%20线性映射/p5-1.png)')
    expect(md).not.toContain('我框的')
    const back = parseReadingNote(md, NOTE)[0]!
    expect(back.crop).toBe('附件/第3讲 线性映射/p5-1.png')
    expect(back.figures).toEqual([])
    expect(renderSection(back, NOTE)).toBe(md)
    const convo = conversationMd(s.id, s.file, 5, undefined, [{ role: 'user', text: '给我讲解一下这一页', image: s.crop! }])
    expect(convo).toContain('![整页](../../附件/第3讲%20线性映射/p5-1.png)')
  })

  it('标题和说明里的换行、方括号不破坏结构', () => {
    const s = sec({ title: '第一行\n第二行', figures: [{ path: 'a.png', caption: '图 [1]' }], failed: [] })
    const back = parseReadingNote(renderSection(s, NOTE), NOTE)[0]!
    expect(back.title).toBe('第一行 第二行')
    expect(back.figures).toEqual([{ path: 'a.png', caption: '图 1' }])
  })
})

describe('完整对话', () => {
  it('一问一答写成 md，带回到 PDF 的链接', () => {
    const md = conversationMd('.canvas-notes/对话/第3讲 线性映射-p5-1.md', '课程/线性代数/第3讲 线性映射.pdf', 5, [0.1, 0.2, 0.3, 0.4], [
      { role: 'user', text: '给我讲解一下', time: '10:20', image: '附件/第3讲 线性映射/p5-1.png' },
      { role: 'ai', text: '旋转矩阵……', time: '10:20' },
    ])
    expect(md).toContain('# 第3讲 线性映射 · 第 5 页 · 完整对话')
    expect(md).toContain('[回到第 5 页](../../课程/线性代数/第3讲%20线性映射.pdf#page=5&rect=0.1,0.2,0.3,0.4)')
    expect(md).toContain('### 我 · 10:20\n\n![我框的](../../附件/第3讲%20线性映射/p5-1.png)\n\n给我讲解一下')
    expect(md).toContain('### AI · 10:20\n\n旋转矩阵……')
  })
})

/** 造一行字：每个字一项，字宽 = 字号 × 0.5 */
function line(text: string, x: number, y: number, h = 10): PdfTextItem[] {
  return [{ str: text, x, y, w: text.length * h * 0.5, h }]
}

describe('pdf-blocks：文字项拼成段落块', () => {
  it('同一基线的几项拼成一行，间距补空格', () => {
    const lines = itemsToLines([
      { str: 'Linear', x: 50, y: 100, w: 30, h: 10 },
      { str: 'maps', x: 83, y: 100.5, w: 20, h: 10 },
      { str: '下一行', x: 50, y: 114, w: 30, h: 10 },
    ])
    expect(lines.map((l) => l.text)).toEqual(['Linear maps', '下一行'])
  })

  it('大字是标题，行距变大另起一段，块带外框和编号', () => {
    const items = [
      ...line('3.5 Kernel and image', 50, 60, 18),
      ...line('The kernel of T is the set of', 50, 100),
      ...line('vectors sent to zero.', 50, 112),
      ...line('The image is everything T can', 50, 150),
      ...line('reach.', 50, 162),
    ]
    const blocks = pageBlocks({ width: 600, height: 800, items }, 6)
    expect(blocks.map((b) => [b.id, b.kind, b.text])).toEqual([
      ['p6-b1', 'heading', '3.5 Kernel and image'],
      ['p6-b2', 'text', 'The kernel of T is the set of vectors sent to zero.'],
      ['p6-b3', 'text', 'The image is everything T can reach.'],
    ])
    const b2 = blocks[1]!
    expect(b2.x).toBe(50)
    expect(b2.y).toBeCloseTo(90)
    expect(b2.y + b2.h).toBeGreaterThan(112)
  })

  it('两栏的页：左栏读完再读右栏', () => {
    const items = [
      ...line('Left column first line here', 40, 100),
      ...line('left column second line', 40, 112),
      ...line('Right column first line here', 320, 100),
      ...line('right column second line', 320, 112),
    ]
    const blocks = pageBlocks({ width: 600, height: 800, items }, 1)
    expect(blocks.map((b) => b.text)).toEqual(['Left column first line here left column second line', 'Right column first line here right column second line'])
  })

  it('连字符断词接回去；中文换行不补空格', () => {
    const items = [...line('linear trans-', 50, 100), ...line('formation', 50, 112), ...line('线性映射保持加', 50, 150), ...line('法和数乘', 50, 162)]
    const blocks = pageBlocks({ width: 600, height: 800, items }, 1)
    expect(blocks.map((b) => b.text)).toEqual(['linear transformation', '线性映射保持加法和数乘'])
  })

  it('图按位置插进文字中间，太小的图不算', () => {
    const items = [...line('Above the figure', 50, 100), ...line('Below the figure', 50, 400)]
    const images = [
      { x: 60, y: 150, w: 300, h: 200 },
      { x: 10, y: 10, w: 8, h: 8 },
    ]
    const blocks = pageBlocks({ width: 600, height: 800, items, images }, 2)
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'image', 'text'])
    expect(blocksText(blocks)).toBe('Above the figure\n[图 p2-b2]\nBelow the figure')
  })

  it('整份按同一个正文字号判断标题', () => {
    const pages = [
      { width: 600, height: 800, items: [...line('Body text that is long enough', 50, 100), ...line('Body text again and again', 50, 112)] },
      { width: 600, height: 800, items: [...line('Big Title', 50, 60, 16)] },
    ]
    expect(documentBlocks(pages)[1]![0]!.kind).toBe('heading')
  })

  it('段落指纹不管空白', () => {
    expect(blockHash('a b\nc')).toBe(blockHash('abc'))
    expect(blockHash('abc')).not.toBe(blockHash('abd'))
  })
})

describe('可视化挂在这一段的脚上', () => {
  it('写成「可视化 · 标题」相对链接，读回来是库里的路径', () => {
    const s = sec({ viz: { path: '课程/线性代数/旋转矩阵.html', title: '旋转矩阵 · 拖动角度看基向量' } })
    const md = renderSection(s, NOTE)
    expect(md).toContain('[完整对话 · 2 轮](../../.canvas-notes/对话/第3讲%20线性映射-p5-1.md) · [可视化 · 旋转矩阵 · 拖动角度看基向量](旋转矩阵.html) · [[第4讲')
    expect(parseReadingNote(md, NOTE)[0]!.viz).toEqual({ path: '课程/线性代数/旋转矩阵.html', title: '旋转矩阵 · 拖动角度看基向量' })
  })
})

describe('可视化嵌进这一段（task-m552v）', () => {
  it('新做的写成单独一段嵌入，不算配图；读回来再写一字不差；以前脚上的链接原样', () => {
    const s = sec({ viz: { path: '课程/线性代数/旋转矩阵.html', title: '旋转矩阵 · 拖动角度看基向量', embed: true } })
    const md = renderSection(s, NOTE)
    expect(md).toContain('[完整对话 · 2 轮](../../.canvas-notes/对话/第3讲%20线性映射-p5-1.md) · [[第4讲')
    expect(md.trimEnd().split('\n').pop()).toBe('![可视化 · 旋转矩阵 · 拖动角度看基向量](旋转矩阵.html)')
    const back = parseReadingNote(md, NOTE)[0]!
    expect(back.viz).toEqual({ path: '课程/线性代数/旋转矩阵.html', title: '旋转矩阵 · 拖动角度看基向量', embed: true })
    expect(back.figures).toEqual(s.figures)
    expect(renderSection(back, NOTE)).toBe(md)
  })
})

describe('我的疑惑', () => {
  const item = (pdf: string, page: number, q: string, lecture?: number): DoubtItem => ({
    id: `${pdf}-${page}`,
    pdf,
    ...(lecture !== undefined ? { lecture } : {}),
    section: sec({ id: `${pdf}-${page}`, file: pdf, page, doubts: [q], good: '讲通的\n讲法' }),
  })
  const items = [
    item('课程/线性代数/第3讲 线性映射.pdf', 5, '旋转矩阵四个数怎么来的', 3),
    item('课程/线性代数/第3讲 线性映射.pdf', 2, '两条为什么缺一不可', 3),
    item('课程/线性代数/第1讲 向量.pdf', 9, '线性无关为什么全部 c = 0', 1),
    item('课程/线性代数/补充讲义.pdf', 1, '附录在讲什么'),
  ]
  it('按讲分组：讲次小的在前，没有讲次的在最后；组里按页排', () => {
    const g = groupDoubts(items)
    expect(g.map((x) => x.title)).toEqual(['第1讲 向量', '第3讲 线性映射', '补充讲义'])
    expect(g[1]!.items.map((i) => i.section.page)).toEqual([2, 5])
  })
  it('我的疑惑.md：属性、每讲一节、问题加粗带回 PDF 的页码链接、讲通的讲法一行、已送的标出来', () => {
    const md = doubtsNote('课程/线性代数', '线性代数', items, new Set(['课程/线性代数/第3讲 线性映射.pdf-5']))
    expect(md.startsWith('---\n类型: 我的疑惑\n课程: 线性代数\n生成: 软件\n---\n\n# 我的疑惑\n\n线性代数 · 4 条。')).toBe(true)
    expect(md).toContain('## 第1讲 向量\n\n- **线性无关为什么全部 c = 0** [第 9 页](第1讲%20向量.pdf#page=9&rect=0.05,0.29,0.52,0.36)\n  讲通的 讲法')
    expect(md).toContain('- **旋转矩阵四个数怎么来的** [第 5 页](第3讲%20线性映射.pdf#page=5&rect=0.05,0.29,0.52,0.36) · 已送 Anki')
  })
})
