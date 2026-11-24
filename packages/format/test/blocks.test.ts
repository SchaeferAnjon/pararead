import { describe, expect, it } from 'vitest'
import {
  contentBlocks,
  convertMdBlock,
  decodeNote,
  duplicateMdBlock,
  findBlocks,
  insertMdBlockAfter,
  moveMdBlock,
  nearestBlock,
  parseTable,
  plainOf,
  relativeLink,
  removeMdBlock,
  resolveLink,
  shiftMdBlock,
  tableMarkdown,
  toggleTask,
} from '../src'
import { FIXTURES, OLD_BOARDS } from './fixtures'

const kinds = (text: string) => findBlocks(text).map((b) => b.kind)
const texts = (text: string) => findBlocks(text).map((b) => text.slice(b.from, b.to))

describe('找块', () => {
  it('段落、标题、列表项、引用、代码、表格、分隔线、图片各是一块', () => {
    const md = [
      '# 标题',
      '',
      '第一段第一行',
      '第一段第二行',
      '',
      '- 苹果',
      '- 香蕉',
      '  接着写的一行',
      '  - 子项',
      '- [ ] 待办',
      '1. 有序',
      '',
      '> 引文',
      '> —— [来源](https://x.com)',
      '',
      '```js',
      'const a = 1',
      '',
      'const b = 2',
      '```',
      '',
      '| a | b |',
      '| --- | :-: |',
      '| 1 | 2 |',
      '',
      '---',
      '',
      '![猫](附件/猫.png)',
      '',
      '<details>',
      '折叠',
      '</details>',
      '',
    ].join('\n')
    const bs = findBlocks(md)
    expect(bs.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'list',
      'list',
      'quote',
      'code',
      'table',
      'hr',
      'image',
      'html',
    ])
    expect(texts(md)[2]).toBe('- 苹果')
    expect(texts(md)[3]).toBe('- 香蕉\n  接着写的一行\n  - 子项')
    expect(bs.slice(2, 6).map((b) => b.list)).toEqual(['bullet', 'bullet', 'task', 'ordered'])
    expect(texts(md)[7]).toBe('```js\nconst a = 1\n\nconst b = 2\n```')
    expect(bs[0]!.level).toBe(1)
  })

  it('setext 标题、段落后面紧跟的列表、松散列表、没闭合的代码块', () => {
    expect(kinds('标题\n===\n\n正文')).toEqual(['heading', 'paragraph'])
    expect(findBlocks('标题\n---\n')[0]!.level).toBe(2)
    expect(texts('要买：\n- 苹果\n- 梨')).toEqual(['要买：', '- 苹果', '- 梨'])
    expect(texts('- 一\n\n  一的第二段\n\n- 二')).toEqual(['- 一\n\n  一的第二段', '- 二'])
    expect(texts('```\n没闭合\n\n')).toEqual(['```\n没闭合'])
  })

  it('白板文件：frontmatter 一块，卡片注释和它的正文是一块（和 parseBoard 一样）', () => {
    const board = OLD_BOARDS['旧样本.md']!
    const bs = findBlocks(board)
    expect(bs.map((b) => b.kind)).toEqual(['frontmatter', 'heading', 'card', 'card', 'column', 'card'])
    const t = texts(board)
    expect(t[0]).toBe('---\ntype: board\nlinks:\n  - a1 -> a2\n---')
    expect(t[2]).toBe('<!-- card id=a1 x=120 y=300 w=280 color=yellow -->\n> 冰洞只在冬天开放，要跟向导进去\n> —— [Ice caves](https://example.com/ice)')
    expect(t[4]).toBe('<!-- column id=c1 x=800 y=80 w=280 title="要订的" -->')
    expect(t[5]!.startsWith('<!-- card id=a4 in=c1 -->\n- [ ] 车')).toBe(true)
  })

  it('画控件用的块：卡片正文也拆开，卡片里的表格认得出来', () => {
    const md = '# 白板\n\n<!-- card id=a1 -->\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- card id=a2 -->\n![图](x.png)\n'
    expect(contentBlocks(md).map((b) => b.kind)).toEqual(['heading', 'html', 'table', 'html', 'image'])
    // 新写法（2026-11-21）：只记编号的一行只管后面那一块，和它算一块
    expect(findBlocks(md).map((b) => b.kind)).toEqual(['heading', 'table', 'image'])
    // 旧写法（卡上写着 in= / w=）：注释和它下面到下一条注释的字是一块
    const old = '# 白板\n\n<!-- card id=a1 x=1 y=2 w=280 -->\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- card id=a2 x=3 y=4 w=280 -->\n![图](x.png)\n'
    expect(findBlocks(old).map((b) => b.kind)).toEqual(['heading', 'card', 'card'])
  })

  it('新写法的白板（2026-11-21）：位置行、编号行、列位置行只管后面那一块，和它一起算一块；后面的段落各是各的', () => {
    const t = '---\ntype: board\n---\n# 白板\n\n<!-- card id=d1 x=10 y=20 -->\n甲\n\n乙\n\n<!-- column id=c1 x=300 y=64 -->\n## 列\n\n<!-- card id=k1 -->\n- [ ] 丙\n'
    expect(kinds(t)).toEqual(['frontmatter', 'heading', 'paragraph', 'paragraph', 'heading', 'list'])
    expect(texts(t)[2]).toBe('<!-- card id=d1 x=10 y=20 -->\n甲')
    expect(texts(t)[3]).toBe('乙')
    expect(texts(t)[4]).toBe('<!-- column id=c1 x=300 y=64 -->\n## 列')
    expect(texts(t)[5]).toBe('<!-- card id=k1 -->\n- [ ] 丙')
    expect(contentBlocks(t).map((b) => b.kind)).toEqual(['frontmatter', 'heading', 'html', 'paragraph', 'paragraph', 'html', 'heading', 'html', 'list'])
    // 挪「甲」那一块：位置行跟着走
    const r = moveMdBlock(t, 2, 4)!
    expect(r.text).toContain('乙\n\n<!-- card id=d1 x=10 y=20 -->\n甲\n\n<!-- column id=c1')
  })

  it('分栏注释成一块；没配对的注释当段落', () => {
    expect(kinds('<!-- columns widths=50,50 -->\n左\n<!-- col -->\n右\n<!-- /columns -->\n\n后面')).toEqual(['columns', 'paragraph'])
    expect(kinds('<!-- 没闭合\n还是段落\n\n下一段')).toEqual(['paragraph', 'paragraph'])
  })

  it('每个样本：块按顺序、互不重叠、块外只有空白', () => {
    for (const [name, bytes] of Object.entries(FIXTURES)) {
      const { text } = decodeNote(bytes)
      const bs = findBlocks(text)
      let pos = 0
      for (const b of bs) {
        expect(b.from, name).toBeGreaterThanOrEqual(pos)
        expect(text.slice(pos, b.from).trim(), name).toBe('')
        expect(b.to, name).toBeGreaterThanOrEqual(b.from)
        pos = b.to
      }
      expect(text.slice(pos).trim(), name).toBe('')
    }
  })

  it('落在空行里取下面一块', () => {
    const md = '一\n\n\n二'
    expect(nearestBlock(findBlocks(md), 2)).toBe(1)
    expect(nearestBlock(findBlocks(md), 0)).toBe(0)
  })
})

describe('挪块', () => {
  const md = '# 标题\n\n第一段\n\n第二段\n\n第三段\n'

  it('往下挪、往上挪、挪到最前和最后；其他地方一个字节都不变', () => {
    expect(moveMdBlock(md, 1, 3)!.text).toBe('# 标题\n\n第二段\n\n第一段\n\n第三段\n')
    expect(moveMdBlock(md, 3, 1)!.text).toBe('# 标题\n\n第三段\n\n第一段\n\n第二段\n')
    expect(moveMdBlock(md, 3, 0)!.text).toBe('第三段\n\n# 标题\n\n第一段\n\n第二段\n')
    expect(moveMdBlock(md, 0, 4)!.text).toBe('第一段\n\n第二段\n\n第三段\n\n# 标题\n')
    // 挪到原地：不改
    expect(moveMdBlock(md, 1, 1)).toBeNull()
    expect(moveMdBlock(md, 1, 2)).toBeNull()
  })

  it('返回挪过去的块在新文字里的位置', () => {
    const r = moveMdBlock(md, 1, 4)!
    expect(r.text.slice(r.at, r.at + 3)).toBe('第一段')
  })

  it('块之间保持一个空行：原来没空行、多个空行的地方，挪过去也是一个空行', () => {
    const m = '# 标题\n正文紧贴着标题\n\n\n\n远处一段'
    expect(moveMdBlock(m, 2, 1)!.text).toBe('# 标题\n\n远处一段\n\n正文紧贴着标题')
  })

  it('同一个紧凑列表里挪列表项：不加空行；挪出列表加空行', () => {
    const list = '要买：\n- 苹果\n- 香蕉\n- 梨\n\n后面一段\n'
    expect(moveMdBlock(list, 1, 4)!.text).toBe('要买：\n- 香蕉\n- 梨\n- 苹果\n\n后面一段\n')
    expect(shiftMdBlock(list, 3, -1)!.text).toBe('要买：\n- 苹果\n- 梨\n- 香蕉\n\n后面一段\n')
    expect(moveMdBlock(list, 3, 5)!.text).toBe('要买：\n- 苹果\n- 香蕉\n\n后面一段\n\n- 梨\n')
    // 段落挪进列表中间：前后各一个空行，不会粘成列表项的续行
    expect(moveMdBlock(list, 4, 2)!.text).toBe('要买：\n- 苹果\n\n后面一段\n\n- 香蕉\n- 梨\n')
  })

  it('列表最后一项挪走后，后面的段落不会粘到列表上', () => {
    const list = '- 一\n- 二\n\n段落'
    expect(moveMdBlock(list, 1, 0)!.text).toBe('- 二\n- 一\n\n段落')
    expect(removeMdBlock(list, 1)!.text).toBe('- 一\n\n段落')
  })

  it('frontmatter 不能挪，别的块也挪不到它前面', () => {
    const board = OLD_BOARDS['旧样本.md']!
    expect(moveMdBlock(board, 0, 3)).toBeNull()
    expect(moveMdBlock(board, 2, 0)).toBeNull()
    const r = moveMdBlock(board, 1, 3)!
    // 标题挪到第一张卡后面；frontmatter 原样
    expect(r.text.startsWith('---\ntype: board\nlinks:\n  - a1 -> a2\n---\n<!-- card id=a1')).toBe(true)
    expect(r.text).toContain('—— [Ice caves](https://example.com/ice)\n\n# 冰岛自驾\n\n<!-- card id=a2')
  })

  it('挪卡片：注释和正文一起走，白板读出来的卡片还是那几张', () => {
    const board = OLD_BOARDS['旧样本.md']!
    const r = moveMdBlock(board, 3, 2)!
    const ids = findBlocks(r.text)
      .filter((b) => b.kind === 'card')
      .map((b) => /id=(\w+)/.exec(r.text.slice(b.from, b.to))![1])
    expect(ids).toEqual(['a2', 'a1', 'a4'])
    expect(r.text).toContain('<!-- card id=a2 x=460 y=300 w=280 -->\n2.27 和 2.28 的住处还没订。\n\n<!-- card id=a1')
  })

  it('挪一圈回来，文字和原来一样', () => {
    const a = moveMdBlock(md, 1, 3)!
    const b = moveMdBlock(a.text, 2, 1)!
    expect(b.text).toBe(md)
  })

  it('最后没有换行的文件', () => {
    expect(moveMdBlock('一\n\n二', 1, 0)!.text).toBe('二\n\n一')
  })
})

describe('删块、复制、加一块', () => {
  it('删中间一块，两边留一个空行', () => {
    expect(removeMdBlock('一\n\n二\n\n三\n', 1)!.text).toBe('一\n\n三\n')
    expect(removeMdBlock('一\n\n二\n', 0)!.text).toBe('二\n')
    expect(removeMdBlock('一\n\n二\n', 1)!.text).toBe('一\n')
    expect(removeMdBlock('只有一段\n', 0)!.text).toBe('\n')
  })

  it('复制一份放在后面；列表项复制后还在同一个列表里', () => {
    expect(duplicateMdBlock('一\n\n二\n', 0)!.text).toBe('一\n\n一\n\n二\n')
    expect(duplicateMdBlock('- a\n- b\n', 0)!.text).toBe('- a\n- a\n- b\n')
    expect(duplicateMdBlock('- a\n- b\n', 1)!.text).toBe('- a\n- b\n- b\n')
  })

  it('在某块后面加一块', () => {
    const r = insertMdBlockAfter('一\n\n二\n', 0, '/')
    expect(r.text).toBe('一\n\n/\n\n二\n')
    expect(r.text[r.at]).toBe('/')
    expect(insertMdBlockAfter('', -1, '/').text).toBe('/')
  })
})

describe('转换', () => {
  const t = (md: string, target: Parameters<typeof convertMdBlock>[2], i = 0) => convertMdBlock(md, i, target)!.text

  it('段落 ↔ 标题 ↔ 待办 ↔ 引用 ↔ 代码', () => {
    expect(t('一段话\n', 'h1')).toBe('# 一段话\n')
    expect(t('## 小标题\n', 'paragraph')).toBe('小标题\n')
    expect(t('## 小标题\n', 'h3')).toBe('### 小标题\n')
    expect(t('一段话\n', 'todo')).toBe('- [ ] 一段话\n')
    expect(t('- [x] 做完了\n', 'paragraph')).toBe('做完了\n')
    expect(t('1. 有序\n', 'quote')).toBe('> 有序\n')
    expect(t('> 第一行\n> 第二行\n', 'paragraph')).toBe('第一行\n第二行\n')
    expect(t('两行\n的段落\n', 'h2')).toBe('## 两行 的段落\n')
    expect(t('代码\n', 'code')).toBe('```\n代码\n```\n')
    expect(t('```js\nlet a\n```\n', 'paragraph')).toBe('let a\n')
    expect(t('标题\n===\n', 'paragraph')).toBe('标题\n')
  })

  it('紧凑列表里的一项转成正文：前后补空行，不粘成续行', () => {
    expect(t('- 一\n- 二\n- 三\n', 'paragraph', 1)).toBe('- 一\n\n二\n\n- 三\n')
    expect(t('- 一\n- 二\n', 'todo', 1)).toBe('- 一\n- [ ] 二\n')
  })

  it('表格、分隔线、卡片不能转换', () => {
    expect(convertMdBlock('---\n', 0, 'h1')).toBeNull()
    expect(convertMdBlock('| a |\n| - |\n', 0, 'h1')).toBeNull()
  })

  it('plainOf 去掉记号', () => {
    const md = '- [ ] 买菜\n  记得带袋子'
    expect(plainOf(md, findBlocks(md)[0]!)).toBe('买菜\n记得带袋子')
  })
})

describe('待办、表格、路径', () => {
  it('勾选只改 [ ] 里那一个字', () => {
    expect(toggleTask('- [ ] 车')).toBe('- [x] 车')
    expect(toggleTask('  - [X] 车')).toBe('  - [ ] 车')
    expect(toggleTask('1. [ ] 车')).toBe('1. [x] 车')
    expect(toggleTask('- 不是待办')).toBe('- 不是待办')
  })

  it('3×3 表格', () => {
    const md = tableMarkdown(3, 3)
    expect(md).toBe('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|    |    |    |\n|    |    |    |')
    expect(findBlocks(md).map((b) => b.kind)).toEqual(['table'])
  })

  it('表格拆成单元格，位置对得上原文', () => {
    const md = '前面\n\n| 名字 | 数量 |\n| :-- | --: |\n| 苹果 | 3 |\n|  | 带\\|竖线 |\n'
    const b = findBlocks(md)[1]!
    const p = parseTable(md, b)
    expect(p.head.map((c) => c.text)).toEqual(['名字', '数量'])
    expect(p.align).toEqual(['left', 'right'])
    expect(p.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['苹果', '3'],
      ['', '带\\|竖线'],
    ])
    for (const c of [...p.head, ...p.rows.flat()]) expect(md.slice(c.from, c.to)).toBe(c.text)
  })

  it('相对链接来回转', () => {
    expect(relativeLink('笔记.md', '附件/猫.png')).toBe('附件/猫.png')
    expect(relativeLink('素材/旅行/冰岛.md', '附件/猫 咪.png')).toBe('../../附件/猫%20咪.png')
    expect(resolveLink('素材/旅行/冰岛.md', '../../附件/猫%20咪.png')).toBe('附件/猫 咪.png')
    expect(resolveLink('笔记.md', 'https://x.com/a.png')).toBeNull()
    expect(resolveLink('笔记.md', '../外面.png')).toBeNull()
  })
})
