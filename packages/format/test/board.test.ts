import { describe, expect, it } from 'vitest'
import {
  appendBlock,
  attr,
  content,
  decodeNote,
  fmValue,
  looseParagraphs,
  moveBlock,
  newBlock,
  parseBoard,
  parseLinks,
  placeLoose,
  serializeBoard,
  withAttrs,
  withContent,
  withLinks,
} from '../src'
import { FIXTURES, OLD_BOARDS } from './fixtures'

/** 以前的白板写法（列、卡的排版在注释里）：导图白板、撤回了转写法的白板还用它 */
const BOARD = OLD_BOARDS['旧样本.md']!

describe('白板读写：不改就一个字节都不变', () => {
  for (const [name, bytes] of Object.entries(FIXTURES)) {
    it(name, () => {
      const { text } = decodeNote(bytes)
      expect(serializeBoard(parseBoard(text))).toBe(text)
    })
  }

  it('认出卡片、列、连线；写坏的注释当普通文字', () => {
    const d = parseBoard(BOARD)
    expect(d.blocks.map((b) => [b.kind, attr(b, 'id')])).toEqual([
      ['card', 'a1'],
      ['card', 'a2'],
      ['column', 'c1'],
      ['card', 'a4'],
    ])
    expect(attr(d.blocks[2]!, 'title')).toBe('要订的')
    expect(parseLinks(d)).toEqual([{ from: 'a1', to: 'a2' }])
    // 「没有配对的注释」和分栏注释都在最后一张卡的正文里
    expect(d.blocks[3]!.body).toContain('<!-- card id=a3 没有配对的注释')
    expect(d.blocks[3]!.body).toContain('<!-- columns widths=40,30,30 -->')
    expect(fmValue(BOARD, 'type')).toBe('board')
  })
})

describe('改一张卡只动它自己', () => {
  it('挪位置：只改那一行注释', () => {
    const d = parseBoard(BOARD)
    const moved = { ...d, blocks: d.blocks.map((b, i) => (i === 0 ? withAttrs(b, { x: 200, y: 340 }) : b)) }
    const out = serializeBoard(moved)
    expect(out).toBe(BOARD.replace('<!-- card id=a1 x=120 y=300 w=280 color=yellow -->', '<!-- card id=a1 x=200 y=340 w=280 color=yellow -->'))
    // 值没变就不重写
    expect(withAttrs(d.blocks[0]!, { x: 120 })).toBe(d.blocks[0])
  })

  it('改正文：结尾空行照旧', () => {
    const d = parseBoard(BOARD)
    const b = withContent(d.blocks[1]!, '住处订好了。')
    expect(content(b)).toBe('住处订好了。')
    expect(b.body).toMatch(/\n\n$/)
    expect(serializeBoard({ ...d, blocks: d.blocks.map((x, i) => (i === 1 ? b : x)) })).toBe(
      BOARD.replace('2.27 和 2.28 的住处还没订。', '住处订好了。'),
    )
  })

  it('属性值有空格时加引号', () => {
    const b = withAttrs(parseBoard(BOARD).blocks[2]!, { title: '要 订 的' })
    expect(b.comment).toBe('<!-- column id=c1 x=800 y=80 w=280 title="要 订 的" -->\n')
  })
})

describe('连线', () => {
  it('加一条：只改 links 那几行', () => {
    const d = parseBoard(BOARD)
    const out = serializeBoard(withLinks(d, [...parseLinks(d), { from: 'a2', to: 'a4' }]))
    expect(out).toBe(BOARD.replace('  - a1 -> a2\n', '  - a1 -> a2\n  - a2 -> a4\n'))
  })

  it('删光：links 键也去掉；没有 frontmatter 时新建一个', () => {
    const d = parseBoard(BOARD)
    expect(serializeBoard(withLinks(d, []))).toBe(BOARD.replace('links:\n  - a1 -> a2\n', ''))
    const plain = parseBoard('# 白板\n')
    expect(serializeBoard(withLinks(plain, [{ from: 'x', to: 'y' }]))).toBe('---\nlinks:\n  - x -> y\n---\n# 白板\n')
  })

  it('frontmatter 里没有 links 时加在结尾 --- 前，其他键不动', () => {
    const d = parseBoard('---\ntype: board\ncolor: #4A7FA7\n---\n# 白板\n')
    expect(serializeBoard(withLinks(d, [{ from: 'a', to: 'b' }]))).toBe(
      '---\ntype: board\ncolor: #4A7FA7\nlinks:\n  - a -> b\n---\n# 白板\n',
    )
  })
})

describe('新卡、未整理、排序', () => {
  it('普通文档当白板看：段落都在未整理里，标题不算', () => {
    const d = parseBoard('# 所思所想\n\n第一段\n第一段第二行\n\n第二段\n')
    expect(looseParagraphs(d).map((l) => l.text)).toEqual(['第一段\n第一段第二行', '第二段'])
  })

  it('把一段放上白板：从 head 拿走，变成最后一张卡', () => {
    const d = parseBoard('# 所思所想\n\n第一段\n\n第二段\n')
    const out = serializeBoard(placeLoose(d, looseParagraphs(d)[0]!, { id: 'k1', x: 10, y: 20 }))
    expect(out).toBe('# 所思所想\n\n第二段\n\n<!-- card id=k1 x=10 y=20 -->\n第一段\n\n')
    const d2 = parseBoard(out)
    expect(looseParagraphs(d2).map((l) => l.text)).toEqual(['第二段'])
    expect(content(d2.blocks[0]!)).toBe('第一段')
  })

  it('加新卡：上一块没有空行结尾时补一个', () => {
    const d = parseBoard('<!-- card id=a -->\n甲')
    const out = serializeBoard(appendBlock(d, newBlock('card', { id: 'b', x: 1, y: 2 }, '乙')))
    expect(out).toBe('<!-- card id=a -->\n甲\n\n<!-- card id=b x=1 y=2 -->\n乙\n\n')
    expect(parseBoard(out).blocks.map(content)).toEqual(['甲', '乙'])
  })

  it('挪进列里：块换到列后面', () => {
    const d = parseBoard(BOARD)
    const moved = moveBlock(d, 0, 3)
    expect(moved.blocks.map((b) => attr(b, 'id'))).toEqual(['a2', 'c1', 'a1', 'a4'])
    expect(parseBoard(serializeBoard(moved)).blocks.map((b) => attr(b, 'id'))).toEqual(['a2', 'c1', 'a1', 'a4'])
  })
})
