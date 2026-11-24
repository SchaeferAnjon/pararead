// 配对笔记每一节带上框的那块（task-yp8l7）：选字问写原文引用块、读得回来；没有图的段列得出来、补图只插一行图。
import { describe, expect, it } from 'vitest'
import { type AskSection, cropGaps, insertCrop, parseReadingNote, renderSection, withDerived } from '../src'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'

const sec = (over: Partial<AskSection> = {}): AskSection =>
  withDerived({
    id: '.canvas-notes/对话/第3讲-p1-1.md',
    file: PDF,
    page: 1,
    rect: [0.1, 0.2, 0.5, 0.1],
    title: '驾驶压力',
    time: '22:27',
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: [{ q: '先把这块翻译成中文，再讲一讲', a: '**翻译**\n这段话是接着上一段说的。', sides: [] }],
    recap: '一句小结',
    ...over,
  })

describe('选字问的原文', () => {
  it('写在第一问上面、是一个引用块，读回来一样', () => {
    const text = renderSection(sec({ quote: 'rather than stress, and interpreting visual cues' }), NOTE)
    expect(text).toContain('<!-- cn:thread=第3讲-p1-1 -->\n\n> rather than stress, and interpreting visual cues\n\n> [!question] 先把这块翻译成中文，再讲一讲\n')
    const back = parseReadingNote(`# 第3讲 笔记\n\n${text}`, NOTE)[0]!
    expect(back.quote).toBe('rather than stress, and interpreting visual cues')
    expect(back.qas![0]!.q).toBe('先把这块翻译成中文，再讲一讲')
    expect(renderSection(back, NOTE)).toBe(text)
  })
  it('有图又有原文时图在上、原文在下', () => {
    const text = renderSection(sec({ crop: '附件/第3讲/p1-1.png', cropW: 300, quote: '原文' }), NOTE)
    expect(text).toContain('![我框的|300](../../附件/第3讲/p1-1.png)\n\n> 原文\n\n> [!question]')
  })
})

describe('补截图', () => {
  const withCrop = renderSection(sec({ id: '.canvas-notes/对话/第3讲-p2-1.md', page: 2, crop: '附件/第3讲/p2-1.png', cropW: 200 }), NOTE)
  const noRect = renderSection(sec({ id: '.canvas-notes/对话/第3讲-p3-1.md', page: 3, rect: undefined }), NOTE)
  const gap = renderSection(sec(), NOTE)
  const old = '## 第 4 页 · 旧的一段\n[第 4 页](第3讲.pdf#page=4&rect=0.1,0.1,0.3,0.3) · 10:20\n> [!question] 我的疑惑\n> 没看懂\n\n[完整对话 · 1 轮](../../.canvas-notes/对话/第3讲-p4-1.md)\n'
  const quoted = renderSection(sec({ id: '.canvas-notes/对话/第3讲-p5-1.md', page: 5, quote: '选字问的原文' }), NOTE)
  const md = `---\n类型: 笔记\n---\n# 第3讲 笔记\n\n我自己写的一段。\n\n${gap}\n${withCrop}\n${noRect}\n${old}\n${quoted}`

  it('列出没有图的段：有框的位置的、没有的；有图的、选字问（写着原文）的不算', () => {
    const g = cropGaps(md, NOTE)
    expect(g.map((x) => [x.page, x.rect?.join(','), x.old])).toEqual([
      [1, '0.1,0.2,0.5,0.1', false],
      [3, undefined, false],
      [4, '0.1,0.1,0.3,0.3', true],
    ])
  })
  it('只在那一段第二行后面插一行图，别的字一个不动；新格式写宽度，以前的格式不写', () => {
    let next = insertCrop(md, NOTE, '.canvas-notes/对话/第3讲-p1-1.md', '附件/第3讲/p1-1.png', 301.4)
    next = insertCrop(next, NOTE, '.canvas-notes/对话/第3讲-p4-1.md', '附件/第3讲/p4-1.png', 180)
    const added = ['\n\n![我框的|301](../../附件/第3讲/p1-1.png)', '\n\n![我框的](../../附件/第3讲/p4-1.png)\n']
    expect(next.length).toBe(md.length + added.join('').length)
    expect(next.replace(added[0]!, '').replace(added[1]!, '')).toBe(md)
    const back = parseReadingNote(next, NOTE)
    expect(back.find((s) => s.page === 1)).toMatchObject({ crop: '附件/第3讲/p1-1.png', cropW: 301 })
    expect(back.find((s) => s.page === 4)!.crop).toBe('附件/第3讲/p4-1.png')
    // 新格式那段：再写回去和插好的一样（打开再保存不变）
    const p1 = back.find((s) => s.page === 1)!
    expect(next).toContain(renderSection(p1, NOTE))
    expect(cropGaps(next, NOTE).map((x) => x.page)).toEqual([3])
  })
  it('已经有图、找不到那段：原样返回', () => {
    expect(insertCrop(md, NOTE, '.canvas-notes/对话/第3讲-p2-1.md', 'x.png')).toBe(md)
    expect(insertCrop(md, NOTE, '.canvas-notes/对话/没有.md', 'x.png')).toBe(md)
  })
})
