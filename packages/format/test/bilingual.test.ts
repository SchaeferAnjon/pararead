import { describe, expect, it } from 'vitest'
import { aiCallout, parseAiCalloutHead, splitAiBody, type AskSection, biKind, pageBlocks, bilingualNote, isFormula, parseReadingNote, prop, renderSection, translatable, upsertSection, webBiNotePath } from '../src'

describe('公式和图不翻译', () => {
  it('认得出公式', () => {
    expect(isFormula('R(θ) = cos θ −sin θ sin θ cos θ')).toBe(true)
    expect(isFormula('θ = 90°: R = 0 −1 1 0')).toBe(true)
    expect(isFormula('T(x) = A x, A = [ T(e₁) T(e₂) ]')).toBe(true)
    expect(isFormula('x′ = x cos θ − y sin θ')).toBe(true)
  })
  it('正文、标题不算公式', () => {
    expect(isFormula('Check: column 1 of R(θ) is the rotated e₁, column 2 the rotated e₂.')).toBe(false)
    expect(isFormula('Rotate the plane counter-clockwise by an angle θ about the origin:')).toBe(false)
    expect(isFormula('Linear maps and matrices')).toBe(false)
    expect(isFormula('把平面绕原点逆时针旋转 θ 角')).toBe(false)
    expect(isFormula('')).toBe(false)
  })
  it('图、公式不送去翻；只有页码的短行也不送', () => {
    const blocks = [
      { kind: 'heading' as const, text: 'Example 3.4 Rotation' },
      { kind: 'text' as const, text: 'Rotate the plane by θ:' },
      { kind: 'text' as const, text: 'R(θ) = cos θ −sin θ' },
      { kind: 'image' as const, text: '' },
      { kind: 'text' as const, text: '5 / 10' },
    ]
    expect(blocks.map(biKind)).toEqual(['heading', 'text', 'formula', 'figure', 'text'])
    expect(translatable(blocks).map((b) => b.text)).toEqual(['Example 3.4 Rotation', 'Rotate the plane by θ:'])
  })
})

describe('不拍扁一格一格的表（CN-31）', () => {
  it('一格一格的短标签不拼成一句：行之间留换行，标成 stack', () => {
    const labels = ['Applications', 'Frameworks', 'Compilers', 'Operating System', 'Hardware']
    const items = labels.map((str, i) => ({ str, x: 600, y: 120 + i * 18, w: 120, h: 13 }))
    const blocks = pageBlocks({ width: 960, height: 540, items }, 1, 13)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe(labels.join('\n'))
    expect(blocks[0]!.stack).toBe(true)
    expect(biKind(blocks[0]!)).toBe('figure')
    expect(translatable(blocks)).toHaveLength(0)
    // 正常折行的一段不算
    const prose = ['Physics-inspired learning combines models', 'with data to build surrogates that run', 'fast and stay close to the equations.'].map((str, i) => ({ str, x: 60, y: 120 + i * 18, w: 400, h: 13 }))
    const p = pageBlocks({ width: 960, height: 540, items: prose }, 1, 13)
    expect(p[0]!.stack).toBeUndefined()
    expect(biKind(p[0]!)).toBe('text')
  })
})

describe('存成双语笔记', () => {
  it('网页的笔记进收件箱，名字里不能有的字换掉', () => {
    expect(webBiNotePath('Rotation matrix - Wikipedia: a/b')).toBe('收件箱/Rotation matrix - Wikipedia a b 双语.md')
  })
  it('网页：来源是网址，头上回到网页', () => {
    const md = bilingualNote({
      note: '收件箱/Rotation matrix 双语.md',
      source: { url: 'https://en.wikipedia.org/wiki/Rotation_matrix', title: 'Rotation matrix' },
      pages: [{ blocks: [{ kind: 'text', text: 'In linear algebra', tr: '在线性代数里' }] }],
    })
    expect(prop(md, '来源')).toBe('https://en.wikipedia.org/wiki/Rotation_matrix')
    expect(md).toContain('[回到网页](https://en.wikipedia.org/wiki/Rotation_matrix)')
    expect(md).toContain('# Rotation matrix 双语')
  })
})

describe('在网页、HTML 上问的那段', () => {
  const base: AskSection = {
    id: '.canvas-notes/对话/网页-1.md',
    file: '',
    page: 5,
    title: '旋转公式和课件是一回事',
    time: '10:20',
    figures: [],
    doubts: ['这段和课件第 5 页什么关系'],
    good: '同一件事，写法不同。',
    points: [],
    failed: [],
    rounds: 1,
    links: [],
    web: { url: 'https://en.wikipedia.org/wiki/Rotation_matrix_(math)', label: 'en.wikipedia.org' },
  }
  it('链接那行写域名和网址，读回来一样（括号不破坏 md 链接）', () => {
    const note = '课程/线性代数/第3讲 线性映射 笔记.md'
    const md = renderSection(base, note)
    expect(md).toContain('## 第 5 页 · 旋转公式和课件是一回事')
    expect(md).toContain('[en.wikipedia.org](https://en.wikipedia.org/wiki/Rotation_matrix_%28math%29) · 10:20')
    const back = parseReadingNote(md, note)[0]!
    expect(back.web).toEqual(base.web)
    expect(back.page).toBe(5)
    expect(back.time).toBe('10:20')
    expect(back.good).toBe('同一件事，写法不同。')
  })
  it('没有 PDF 时标题不写页码；库里的 HTML 写相对链接', () => {
    const note = '收件箱/网页笔记.md'
    const s: AskSection = { ...base, page: 0, web: { url: '课程/线性代数/旋转矩阵.html', label: '旋转矩阵.html' } }
    const md = upsertSection('# 网页笔记\n', s, note)
    expect(md).toContain('## 旋转公式和课件是一回事\n[旋转矩阵.html](../课程/线性代数/旋转矩阵.html) · 10:20')
    const back = parseReadingNote(md, note)[0]!
    expect(back.page).toBe(0)
    expect(back.web).toEqual(s.web)
  })
  it('视频问答块「接着问」的：来源写「▶ 00:06 · 视频名」、AI 那块写「看了 00:06 这一帧」，不写成网页；读回来一样', () => {
    const note = '看视频的笔记.md'
    const s: AskSection = { ...base, page: 0, web: { url: 'https://www.youtube.com/watch?v=abc&t=6s', label: '▶ 00:06 · Linear transformations', t: 6 } }
    const md = upsertSection('# 看视频的笔记\n', s, note)
    expect(md).toContain('## 旋转公式和课件是一回事\n[▶ 00:06 · Linear transformations](https://www.youtube.com/watch?v=abc&t=6s) · 10:20')
    expect(md).toContain('> [!ai] AI 讲解 · 看了 00:06 这一帧')
    expect(md).not.toContain('看了网页这一段')
    expect(parseReadingNote(md, note)[0]!.web).toEqual(s.web)
  })
})

describe('AI 回答的提示块（CN-76）', () => {
  it('写成 [!ai] 提示块：头上引擎、模型、看了什么；读回来一样，回答里自己的列表留在回答里', () => {
    const md = aiCallout({ by: 'Claude Code · Opus 5.5', seen: '看了 00:06 这一帧', text: '先看两个箭头。\n\n- 回答里的列表', points: ['要点一', '要点二'] })
    expect(md).toBe('> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧\n> 先看两个箭头。\n>\n> - 回答里的列表\n>\n> - 要点一\n> - 要点二')
    expect(parseAiCalloutHead('AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页')).toEqual({ version: 2, by: 'Claude Code · Opus 5.5', seen: '看了第 5 页' })
    const body = md.split('\n').slice(1).map((l) => l.replace(/^>\s?/, ''))
    expect(splitAiBody(body)).toEqual({ text: '先看两个箭头。\n\n- 回答里的列表', points: ['要点一', '要点二'] })
  })
})
