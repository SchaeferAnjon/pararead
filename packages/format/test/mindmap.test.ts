import { describe, expect, it } from 'vitest'
import {
  addParent,
  aiFilled,
  anyUnfolded,
  breadthFirst,
  countNodes,
  decodeNote,
  foldAll,
  HIDDEN_KEYS,
  insertAt,
  isMindmap,
  MAP_LAYOUT_KEY,
  mapLayoutOf,
  mindmapList,
  moveAmong,
  moveBeside,
  moveTo,
  newNode,
  nodeAt,
  parseMindmap,
  pathKey,
  prop,
  readProps,
  removeAt,
  removeOne,
  serializeMindmap,
  setFold,
  setProp,
  setPropByUser,
  setText,
  unfoldAll,
  withMapLayout,
  withMindmap,
  type MapNode,
  addFloating,
  addSpan,
  detachTopic,
  mapPaletteOf,
  mapRelsOf,
  mapSegments,
  mapShown,
  mapSkeletonOf,
  mindmapOpml,
  nextMapId,
  pathOfId,
  setAttrs,
  setNote,
  settle,
  spansOf,
  withIds,
  withMapPalette,
  withMapRels,
  withMapSkeleton,
  moveMany,
} from '../src'
import { FIXTURES } from './fixtures'

const MAP = `---
type: board
白板样式: 导图
类型: 导图
课程: 线性代数
AI填的: 类型, 课程
---
# 导图 11-15 21:40

![原照片](../附件/导图/2026-11-15-2140.jpg)

- 线性映射 <!-- box=0.36,0.42,0.26,0.12 -->
  - 定义
    - T(u+v)=T(u)+T(v)
    - T(cv)=cT(v)

  - 核与像
    - 秩-零化渡定理 <!-- box=0.6,0.8,0.2,0.06 unsure guesses="秩-零化度定理|秩-零化渡定理" -->

<!-- card id=a1 x=900 y=60 w=280 -->
- [ ] 这是普通卡片里的待办，不算导图
`

const texts = (l: MapNode[]): unknown => l.map((n) => (n.children.length ? [n.text, texts(n.children)] : n.text))

describe('导图：读', () => {
  it('认出白板样式', () => {
    expect(isMindmap(MAP)).toBe(true)
    expect(isMindmap('---\ntype: board\n---\n')).toBe(false)
  })

  it('读成树，卡片里的列表不算，注释读成框和拿不准', () => {
    const d = parseMindmap(MAP)
    expect(texts(d.roots)).toEqual([['线性映射', [['定义', ['T(u+v)=T(u)+T(v)', 'T(cv)=cT(v)']], ['核与像', ['秩-零化渡定理']]]]])
    expect(d.roots[0]!.box).toEqual([0.36, 0.42, 0.26, 0.12])
    const k = nodeAt(d.roots, [0, 1, 0])!
    expect(k.unsure).toBe(true)
    expect(k.guesses).toEqual(['秩-零化度定理', '秩-零化渡定理'])
    expect(countNodes(d.roots)).toEqual({ all: 6, unsure: 1 })
  })

  it('不认识的注释留在字里', () => {
    const d = parseMindmap('- 甲 <!-- 随手写的 -->\n')
    expect(d.roots[0]!.text).toBe('甲 <!-- 随手写的 -->')
  })

  it('星号、加号、tab 缩进都认；续行是这个主题的备注（第二批：不再并进主题的字）', () => {
    const d = parseMindmap('* 根\n\t+ 子一\n\t  接着写\n\t+ 子二\n')
    expect(texts(d.roots)).toEqual([['根', ['子一', '子二']]])
    expect(d.roots[0]!.children[0]!.note).toBe('接着写')
  })
})

describe('导图：打开再保存一个字节都不变', () => {
  const samples = [
    MAP,
    '- 只有一行',
    '- 没有结尾换行\n  - 子',
    '# 标题\n\n- 根\n  - 子\n\n\n正文段落\n',
    '* 根\n\t+ 子一\n\t  续行\n\n\t+ 子二\n',
    '没有列表的一篇\n',
    // 第一批（task-wuv05）：收起写在行尾注释里、布局写在属性里
    MAP.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 左右\n').replace('  - 定义\n', '  - 定义 <!-- fold -->\n').replace('<!-- box=0.36,0.42,0.26,0.12 -->', '<!-- box=0.36,0.42,0.26,0.12 fold -->'),
    '---\n白板样式: 导图\n导图布局: 向下\n---\n- 根 <!--fold-->\n\t- 子 <!-- 随手写的 --> <!-- fold -->\n\t\t- 孙\n  - 收着但没孩子 <!-- fold -->\n',
  ]
  for (const s of samples)
    it(JSON.stringify(s.slice(0, 20)), () => {
      expect(serializeMindmap(parseMindmap(s))).toBe(s)
      expect(withMindmap(s, parseMindmap(s).roots)).toBe(s)
    })
  for (const [name, bytes] of Object.entries(FIXTURES))
    it(name, () => {
      const { text } = decodeNote(bytes)
      expect(serializeMindmap(parseMindmap(text))).toBe(text)
    })
})

describe('导图：改', () => {
  const roots = () => parseMindmap(MAP).roots

  it('改一个节点的字只动那一行，拿不准跟着去掉', () => {
    const out = withMindmap(MAP, setText(roots(), [0, 1, 0], '秩-零化度定理'))
    const before = MAP.split('\n')
    const after = out.split('\n')
    const changed = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null)
    expect(changed).toEqual([before.findIndex((l) => l.includes('秩-零化渡定理'))])
    expect(out).toContain('    - 秩-零化度定理 <!-- box=0.6,0.8,0.2,0.06 -->\n')
  })

  it('加孩子、删节点', () => {
    let r = insertAt(roots(), [0, 0], 2, newNode('线性'))
    expect(texts(nodeAt(r, [0, 0])!.children)).toEqual(['T(u+v)=T(u)+T(v)', 'T(cv)=cT(v)', '线性'])
    let out = withMindmap(MAP, r)
    expect(out).toContain('    - T(cv)=cT(v)\n    - 线性\n\n  - 核与像')
    r = removeAt(r, [0, 1])
    out = withMindmap(MAP, r)
    expect(out).not.toContain('核与像')
    expect(out).toContain('    - 线性\n\n<!-- card id=a1')
  })

  it('挪到别的节点下面：层级变了的整枝重写', () => {
    const m = moveTo(roots(), [0, 0], [0, 1])!
    expect(pathKey(m.path)).toBe('0.0.1')
    const out = withMindmap(MAP, m.roots)
    expect(out).toContain('  - 核与像\n    - 秩-零化渡定理')
    expect(out).toContain('    - 定义\n      - T(u+v)=T(u)+T(v)\n      - T(cv)=cT(v)\n')
    // 不能挪进自己下面
    expect(moveTo(roots(), [0], [0, 1])).toBeNull()
  })

  it('一层一层的顺序', () => {
    expect(breadthFirst(roots()).map(pathKey)).toEqual(['0', '0.0', '0.1', '0.0.0', '0.0.1', '0.1.0'])
  })

  it('没有列表时插在卡片前面', () => {
    const t = '---\ntype: board\n---\n# 白板\n\n<!-- card id=a1 x=0 y=0 w=280 -->\n卡\n'
    const out = withMindmap(t, [{ text: '根', children: [newNode('子')] }])
    expect(out).toBe('---\ntype: board\n---\n# 白板\n\n- 根\n  - 子\n\n<!-- card id=a1 x=0 y=0 w=280 -->\n卡\n')
    expect(serializeMindmap(parseMindmap(out))).toBe(out)
  })

  it('新建的列表', () => {
    expect(mindmapList([{ text: '中心', box: [0.1, 0.2, 0.3, 0.4], children: [{ text: '甲\n乙', unsure: true, guesses: ['甲乙'], children: [] }] }])).toBe(
      '- 中心 <!-- box=0.1,0.2,0.3,0.4 -->\n  - 甲 乙 <!-- unsure guesses="甲乙" -->\n',
    )
  })
})

describe('属性', () => {
  it('读一行键值，跳过列表', () => {
    expect(readProps(MAP).map((p) => p.key)).toEqual(['type', '白板样式', '类型', '课程', 'AI填的'])
    expect(readProps('---\ntype: board\nlinks:\n  - a -> b\n课程: 线性代数\n---\n').map((p) => p.key)).toEqual(['type', '课程'])
    expect(prop(MAP, '课程')).toBe('线性代数')
  })

  it('改一个只动那一行；没变不动；没有 frontmatter 就建', () => {
    expect(setProp(MAP, '课程', '线性代数')).toBe(MAP)
    const out = setProp(MAP, '课程', '概率论')
    expect(out).toBe(MAP.replace('课程: 线性代数', '课程: 概率论'))
    expect(setProp(MAP, '第几讲', '3')).toContain('AI填的: 类型, 课程\n第几讲: 3\n---\n')
    expect(setProp('正文\n', '类型', '笔记')).toBe('---\n类型: 笔记\n---\n正文\n')
    expect(setProp(MAP, '课程', undefined)).not.toContain('课程:')
    expect(setProp('正文\n', '课程', undefined)).toBe('正文\n')
  })

  it('有冒号的值加引号，读回来一样', () => {
    const out = setProp(MAP, '来源', 'http://x: y')
    expect(out).toContain('来源: "http://x: y"')
    expect(prop(out, '来源')).toBe('http://x: y')
  })

  it('用户改过的属性不再算 AI 填的', () => {
    expect(aiFilled(MAP)).toEqual(['类型', '课程'])
    const out = setPropByUser(MAP, '课程', '概率论')
    expect(aiFilled(out)).toEqual(['类型'])
    expect(aiFilled(setPropByUser(out, '类型', '笔记'))).toEqual([])
    expect(setPropByUser(out, '类型', '笔记')).not.toContain('AI填的')
  })
})

// ---------- 第一批（task-wuv05，设计页 15-思维导图）：收起写进文件、布局记在属性里、加减挪的几样只动那几行 ----------

const B1 = `---
type: board
白板样式: 导图
类型: 导图
课程: 线性代数
---
# 导图 11-22 17∶51

![原照片](../附件/导图/2026-11-22-1751.jpg)

- 线性映射 <!-- box=0.402,0.436,0.197,0.095 -->
  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->
    - T(u+v)=T(u)+T(v) <!-- box=0.075,0.074,0.232,0.066 -->
    - T(cv)=cT(v)
    - 先加再映射，和先映射再加，结果一样；数乘也一样
  - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->
    - 列 = 基向量的像
    - 复合 = 矩阵相乘
  - 核与像
    - ker T 映到 0
    - im T 所有的像
    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 unsure guesses="秩-零化度定理|秩-零化渡定理" -->
  - 例子
    - 旋转
    - 投影
    - 求导 d/dx
`

/** 两段字逐行比，变了的行号（行数一样时） */
const changedLines = (a: string, b: string) => {
  const x = a.split('\n')
  const y = b.split('\n')
  expect(y.length).toBe(x.length)
  return x.map((l, i) => (l === y[i] ? null : i)).filter((i) => i !== null)
}
const lineNo = (text: string, s: string) => text.split('\n').findIndex((l) => l.includes(s))
const r1 = () => parseMindmap(B1).roots

describe('导图：收起写进文件（fold）', () => {
  it('认得 fold：和框写在一个注释里、单独一个注释都认，字里不露注释', () => {
    const t = B1.replace('  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->', '  - 定义 <!-- box=0.233,0.211,0.091,0.082 fold -->').replace('  - 例子\n', '  - 例子 <!-- fold -->\n')
    const d = parseMindmap(t)
    const def = nodeAt(d.roots, [0, 0])!
    expect(def.text).toBe('定义')
    expect(def.fold).toBe(true)
    expect(def.box).toEqual([0.233, 0.211, 0.091, 0.082])
    const ex = nodeAt(d.roots, [0, 3])!
    expect(ex.text).toBe('例子')
    expect(ex.fold).toBe(true)
    expect(nodeAt(d.roots, [0, 1])!.fold).toBeFalsy()
    // 打开再保存一个字节都不变
    expect(serializeMindmap(d)).toBe(t)
  })

  it('自己写的注释后面跟着 fold：认最后那一个注释，前面的照旧是字', () => {
    const d = parseMindmap('- 甲 <!-- 随手写的 --> <!-- fold -->\n  - 乙\n')
    expect(d.roots[0]!.text).toBe('甲 <!-- 随手写的 -->')
    expect(d.roots[0]!.fold).toBe(true)
  })

  it('收起只动那一行：有注释的在注释里加 fold，没注释的加 <!-- fold -->；展开回到原样', () => {
    let out = withMindmap(B1, setFold(r1(), [0, 0], true))
    expect(changedLines(B1, out)).toEqual([lineNo(B1, '- 定义')])
    expect(out).toContain('  - 定义 <!-- box=0.233,0.211,0.091,0.082 fold -->\n')
    out = withMindmap(out, setFold(parseMindmap(out).roots, [0, 3], true))
    expect(changedLines(B1, out)).toEqual([lineNo(B1, '- 定义'), lineNo(B1, '- 例子')])
    expect(out).toContain('  - 例子 <!-- fold -->\n')
    // 读回来还收着（关了再开）
    expect(nodeAt(parseMindmap(out).roots, [0, 3])!.fold).toBe(true)
    // 展开：这两行回到原样
    let back = withMindmap(out, setFold(parseMindmap(out).roots, [0, 3], false))
    back = withMindmap(back, setFold(parseMindmap(back).roots, [0, 0], false))
    expect(back).toBe(B1)
  })

  it('拿不准、猜的写法、行尾空格都留着；没有孩子的不收', () => {
    const t = '- 根\n  - 甲 <!-- unsure guesses="a|b" -->\n    - 子\n  - 乙   \n    - 子\n  - 丙\n'
    let out = withMindmap(t, setFold(parseMindmap(t).roots, [0, 0], true))
    expect(out).toContain('  - 甲 <!-- unsure guesses="a|b" fold -->\n')
    out = withMindmap(out, setFold(parseMindmap(out).roots, [0, 1], true))
    expect(out).toContain('  - 乙    <!-- fold -->\n')
    expect(withMindmap(out, setFold(parseMindmap(out).roots, [0, 2], true))).toBe(out)
    let back = withMindmap(out, setFold(parseMindmap(out).roots, [0, 1], false))
    back = withMindmap(back, setFold(parseMindmap(back).roots, [0, 0], false))
    expect(back).toBe(t)
  })

  it('收起到第一层：第一层往下有孩子的都收起；全部展开回到原样', () => {
    const out = withMindmap(B1, foldAll(r1()))
    expect(changedLines(B1, out)).toEqual(['- 定义', '- 矩阵表示', '- 核与像', '- 例子'].map((s) => lineNo(B1, s)))
    expect(out).toContain('  - 核与像 <!-- fold -->\n')
    const d = parseMindmap(out)
    expect(d.roots[0]!.fold).toBeFalsy()
    expect(d.roots[0]!.children.every((n) => n.fold)).toBe(true)
    expect(anyUnfolded(d.roots)).toBe(false)
    expect(anyUnfolded(r1())).toBe(true)
    expect(withMindmap(out, unfoldAll(d.roots))).toBe(B1)
  })

  it('收着的节点改了字：整行重写，fold 照样写上', () => {
    const out = withMindmap(B1, setFold(r1(), [0, 2], true))
    const re = withMindmap(out, setText(parseMindmap(out).roots, [0, 2], '核和像'))
    expect(re).toContain('  - 核和像 <!-- fold -->\n')
    expect(changedLines(B1, re)).toEqual([lineNo(B1, '- 核与像')])
  })
})

describe('导图：布局记在属性里', () => {
  it('没写是向右；左右、向下、鱼骨、时间线认得；不认识的当向右', () => {
    expect(mapLayoutOf(B1)).toBe('right')
    expect(mapLayoutOf(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 左右\n'))).toBe('both')
    expect(mapLayoutOf(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 向下\n'))).toBe('down')
    expect(mapLayoutOf(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 鱼骨\n'))).toBe('fish')
    expect(mapLayoutOf(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 时间线\n'))).toBe('time')
    expect(mapLayoutOf(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 矩阵\n'))).toBe('right')
  })

  it('换布局只动那一行：紧跟在「白板样式: 导图」后面；换回向右就去掉，回到原样', () => {
    const both = withMapLayout(B1, 'both')
    expect(both).toBe(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 左右\n'))
    const down = withMapLayout(both, 'down')
    expect(down).toBe(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 向下\n'))
    expect(changedLines(both, down)).toEqual([lineNo(both, '导图布局')])
    expect(withMapLayout(down, 'right')).toBe(B1)
    expect(withMapLayout(B1, 'right')).toBe(B1)
    // 属性弹层里不列（和「白板样式」一样是软件自己用的）
    expect(HIDDEN_KEYS.has(MAP_LAYOUT_KEY)).toBe(true)
  })
})

describe('导图：第一批的加、挪、删只动那几行', () => {
  it('在前面加同级：新的一行插在它上面，别的行不动', () => {
    const out = withMindmap(B1, insertAt(r1(), [0], 1, newNode('新主题')))
    expect(out).toBe(B1.replace('  - 矩阵表示', '  - 新主题\n  - 矩阵表示'))
  })

  it('加父主题：新的一行，原来那一枝只多一层缩进（注释原样）', () => {
    const r = addParent(r1(), [0, 1], '新主题')!
    expect(pathKey(r.path)).toBe('0.1')
    const out = withMindmap(B1, r.roots)
    expect(out).toBe(
      B1.replace(
        '  - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n    - 列 = 基向量的像\n    - 复合 = 矩阵相乘\n',
        '  - 新主题\n    - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n      - 列 = 基向量的像\n      - 复合 = 矩阵相乘\n',
      ),
    )
    // 中心外面不套
    expect(addParent(r1(), [0], '新主题')).toBeNull()
  })

  it('往上挪、往下挪：整枝的几行换个位置，一个字不改；到头了不挪', () => {
    const up = moveAmong(r1(), [0, 2], -1)!
    expect(pathKey(up.path)).toBe('0.1')
    const out = withMindmap(B1, up.roots)
    const kerPart = '  - 核与像\n    - ker T 映到 0\n    - im T 所有的像\n    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 unsure guesses="秩-零化度定理|秩-零化渡定理" -->\n'
    const matPart = '  - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n    - 列 = 基向量的像\n    - 复合 = 矩阵相乘\n'
    expect(out).toBe(B1.replace(matPart + kerPart, kerPart + matPart))
    const down = moveAmong(parseMindmap(out).roots, [0, 1], 1)!
    expect(withMindmap(out, down.roots)).toBe(B1)
    expect(moveAmong(r1(), [0, 0], -1)).toBeNull()
    expect(moveAmong(r1(), [0, 3], 1)).toBeNull()
    expect(moveAmong(r1(), [0], 1)).toBeNull()
  })

  it('只删这一个：下面的往上提一层（只改缩进，注释原样）', () => {
    const out = withMindmap(B1, removeOne(r1(), [0, 2]))
    expect(out).toBe(B1.replace('  - 核与像\n    - ker T 映到 0\n    - im T 所有的像\n    - 秩-零化度定理', '  - ker T 映到 0\n  - im T 所有的像\n  - 秩-零化度定理'))
    // 叶子：和删掉这一枝一样
    expect(withMindmap(B1, removeOne(r1(), [0, 3, 0]))).toBe(B1.replace('    - 旋转\n', ''))
  })

  it('拖到两个同级中间：同一层换位置、换到别的上级下面都对', () => {
    // 「秩-零化度定理」拖到「ker T 映到 0」上边
    const a = moveBeside(r1(), [0, 2, 2], [0, 2, 0], false)!
    expect(pathKey(a.path)).toBe('0.2.0')
    expect(texts(nodeAt(a.roots, [0, 2])!.children)).toEqual(['秩-零化度定理', 'ker T 映到 0', 'im T 所有的像'])
    // 往后挪：拖到后一个下边
    const b = moveBeside(r1(), [0, 2, 0], [0, 2, 1], true)!
    expect(texts(nodeAt(b.roots, [0, 2])!.children)).toEqual(['im T 所有的像', 'ker T 映到 0', '秩-零化度定理'])
    expect(pathKey(b.path)).toBe('0.2.1')
    // 换到「定义」下面、排在「T(cv)=cT(v)」后面
    const c = moveBeside(r1(), [0, 2, 0], [0, 0, 1], true)!
    expect(pathKey(c.path)).toBe('0.0.2')
    expect(texts(nodeAt(c.roots, [0, 0])!.children)).toEqual(['T(u+v)=T(u)+T(v)', 'T(cv)=cT(v)', 'ker T 映到 0', '先加再映射，和先映射再加，结果一样；数乘也一样'])
    // 换了层级的整枝只改缩进
    const d = moveBeside(r1(), [0, 1], [0, 2, 0], false)!
    const out = withMindmap(B1, d.roots)
    expect(out).toContain('  - 核与像\n    - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n      - 列 = 基向量的像\n      - 复合 = 矩阵相乘\n    - ker T 映到 0\n')
    // 不能拖到自己下面；拖回原处什么都不变
    expect(moveBeside(r1(), [0, 2], [0, 2, 1], true)).toBeNull()
    expect(withMindmap(B1, moveBeside(r1(), [0, 2, 1], [0, 2, 0], true)!.roots)).toBe(B1)
  })

  it('续行（备注）跟着改缩进，读回来还是这个主题的备注', () => {
    const t = '- 根\n  - 甲\n    接着写\n  - 乙\n'
    const r = addParent(parseMindmap(t).roots, [0, 0], '新')!
    const out = withMindmap(t, r.roots)
    expect(out).toBe('- 根\n  - 新\n    - 甲\n      接着写\n  - 乙\n')
    expect(texts(parseMindmap(out).roots)).toEqual([['根', [['新', ['甲']], '乙']]])
    expect(nodeAt(parseMindmap(out).roots, [0, 0, 0])!.note).toBe('接着写')
  })
})

// ---------- 第二批（task-wuv05，设计页 15-思维导图第二批） ----------

/** 第二批原型那一份：备注、外框、概要、图、短编号、浮动主题、配色、骨架、联系线都有 */
const B2 = `---
type: board
白板样式: 导图
导图布局: 左右
导图配色: 彩虹
导图骨架: 线条
导图联系线:
  - k1 -> k2 "求导也能写成矩阵"
  - k3 -> k1 bend=30
类型: 导图
---
# 导图 11-22 17∶51

![原照片](../附件/导图/2026-11-22-1751.jpg)

- 线性映射 <!-- box=0.402,0.436,0.197,0.095 -->
  - 定义 <!-- box=0.233,0.211,0.091,0.082 frame=2 frame-title="都能写成矩阵" -->
    - T(u+v)=T(u)+T(v)
  - 矩阵表示 <!-- fold id=k2 -->
    - 列 = 基向量的像
      第 j 列就是 T(e_j)：把每个基向量的像排成一列一列，矩阵就出来了。
    - 复合 = 矩阵相乘 <!-- sum=2 sum-text="乘法对应复合" -->
    - 详见 [[第3讲 矩阵乘法]]
  - 核与像
    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->
      dim V = dim ker T + dim im T。

      老师说这是这一章最要紧的一条，期末必考。
  - 例子
    - 旋转 ![旋转](../附件/导图/旋转.png) <!-- img-w=88 -->
    - 求导 d/dx <!-- id=k1 -->
- 先记一笔 <!-- at=470,250 id=k3 -->
`
const r2 = () => parseMindmap(B2).roots

describe('导图第二批：读', () => {
  it('续行是备注（多段之间空一行），主题的字不带它；图、外框、概要、短编号、位置都认', () => {
    const r = r2()
    const at = (...p: number[]) => nodeAt(r, p)!
    expect(at(0, 2, 0).text).toBe('秩-零化度定理')
    expect(at(0, 2, 0).note).toBe('dim V = dim ker T + dim im T。\n\n老师说这是这一章最要紧的一条，期末必考。')
    expect(at(0, 1, 0).note).toBe('第 j 列就是 T(e_j)：把每个基向量的像排成一列一列，矩阵就出来了。')
    expect(at(0, 0).frame).toEqual({ n: 2, title: '都能写成矩阵' })
    expect(at(0, 1, 1).sum).toEqual({ n: 2, text: '乘法对应复合' })
    expect(at(0, 3, 0)).toMatchObject({ text: '旋转', img: { alt: '旋转', src: '../附件/导图/旋转.png' }, imgW: 88 })
    expect(at(0, 3, 1).id).toBe('k1')
    expect(at(1)).toMatchObject({ text: '先记一笔', at: [470, 250], id: 'k3' })
    expect(mapPaletteOf(B2)).toBe('rainbow')
    expect(mapSkeletonOf(B2)).toBe('line')
    expect(mapLayoutOf(B2)).toBe('both')
    expect(mapRelsOf(B2)).toEqual([
      { a: 'k1', b: 'k2', label: '求导也能写成矩阵' },
      { a: 'k3', b: 'k1', bend: 30 },
    ])
  })

  it('没写配色、骨架是跟主题、卡片；不认识的也当默认', () => {
    expect(mapPaletteOf(B1)).toBe('theme')
    expect(mapSkeletonOf(B1)).toBe('card')
    expect(mapPaletteOf(B1.replace('白板样式: 导图\n', '白板样式: 导图\n导图配色: 樱花\n'))).toBe('theme')
  })

  it('链接只露名字：[[双链]] 露别名或笔记名，[字](网址) 露字，图不算链接', () => {
    expect(mapShown('详见 [[第3讲 矩阵乘法]]')).toBe('详见 第3讲 矩阵乘法')
    expect(mapShown('看 [[课程/线代/第五讲|第五讲笔记]] 和 [官网](https://example.com/a)')).toBe('看 第五讲笔记 和 官网')
    const segs = mapSegments('详见 [[第3讲 矩阵乘法]] 吧')
    expect(segs.map((x) => [x.text, x.wiki ?? x.url ?? null])).toEqual([
      ['详见 ', null],
      ['第3讲 矩阵乘法', '第3讲 矩阵乘法'],
      [' 吧', null],
    ])
    expect(mapSegments('![图](a.png) 字').every((x) => !x.url)).toBe(true)
  })
})

describe('导图第二批：打开再保存一个字节都不变', () => {
  const samples = [
    B2,
    // 以前的续行（第一批前写的）：现在读成备注，写回去照旧
    '- 根\n  - 子一\n    接着写\n    再写一行\n\n    隔一段\n  - 子二\n',
    // 备注里像列表的一行（写的时候前面加了 \）
    '- 根\n  - 甲\n    \\- 这不是子主题\n',
    // 注释里多空格、怪顺序、只有外框名字
    '- 根\n  - 甲 <!--  at=1,2   id=k9 -->\n  - 乙 <!-- frame-title="只有名字" -->\n',
  ]
  for (const t of samples) {
    it(JSON.stringify(t.slice(0, 40)), () => {
      expect(serializeMindmap(parseMindmap(t))).toBe(t)
      expect(withMindmap(t, parseMindmap(t).roots)).toBe(t)
    })
  }
})

describe('导图第二批：改了只动那几行', () => {
  it('改备注只动那几行续行；去掉备注续行一起去掉；没有备注的加上缩进的一段', () => {
    const r = r2()
    const out = withMindmap(B2, setNote(r, [0, 2, 0], 'dim V = dim ker T + dim im T。\n\n\n期末必考。  '))
    const a = B2.split('\n')
    const b = out.split('\n')
    const at = lineNo(B2, '秩-零化度定理')
    expect(b.slice(0, at + 1)).toEqual(a.slice(0, at + 1))
    expect(b.slice(at + 1, at + 4)).toEqual(['      dim V = dim ker T + dim im T。', '', '      期末必考。'])
    expect(b.slice(at + 4)).toEqual(a.slice(at + 4))
    // 去掉
    const gone = withMindmap(B2, setNote(r, [0, 2, 0], '  \n'))
    expect(gone).toBe(B2.replace('\n      dim V = dim ker T + dim im T。\n\n      老师说这是这一章最要紧的一条，期末必考。', ''))
    // 加上：第二层的主题，备注缩进到第三层
    const add = withMindmap(B1, setNote(r1(), [0, 2, 1], '所有能映到的'))
    expect(add).toBe(B1.replace('    - im T 所有的像\n', '    - im T 所有的像\n      所有能映到的\n'))
  })

  it('备注里像列表的一行前面加 \\，读回来还是备注、不是子主题', () => {
    const out = withMindmap(B1, setNote(r1(), [0, 3], '- 先这样\n  * 再那样'))
    expect(out).toContain('  - 例子\n    \\- 先这样\n      \\* 再那样\n    - 旋转\n')
    const n = nodeAt(parseMindmap(out).roots, [0, 3])!
    expect(n.note).toBe('- 先这样\n  * 再那样')
    expect(n.children.map((c) => c.text)).toEqual(['旋转', '投影', '求导 d/dx'])
  })

  it('挪一枝、换层级：备注跟着走，只改缩进；只删这一个时备注一起删', () => {
    const r = r2()
    // 「秩-零化度定理」（带两段备注）挪到「例子」下面最后
    const m = moveTo(r, [0, 2, 0], [0, 3])!
    const out = withMindmap(B2, m.roots)
    expect(out).toContain('    - 求导 d/dx <!-- id=k1 -->\n    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n      dim V = dim ker T + dim im T。\n\n      老师说这是这一章最要紧的一条，期末必考。\n')
    // 套一层父主题：备注多缩进一层
    const p = addParent(r, [0, 2, 0], '新')!
    expect(withMindmap(B2, p.roots)).toContain('    - 新\n      - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n        dim V = dim ker T + dim im T。\n\n        老师说')
    // 只删这一个：它的备注一起删，下面的往上提
    const one = withMindmap(B2, removeOne(r, [0, 1, 0]))
    expect(one).not.toContain('第 j 列就是')
    expect(one).toContain('  - 矩阵表示 <!-- fold id=k2 -->\n    - 复合 = 矩阵相乘')
  })

  it('外框、概要、图的宽、位置只改那一行的注释，别的字节不动', () => {
    const r = r1()
    // 外框：选「T(cv)=cT(v)」和「T(u+v)=T(u)+T(v)」（顺序乱也行）→ 记在最前面那个上，从它起 2 个
    const f = withMindmap(
      B1,
      addSpan(
        r,
        [
          [0, 0, 1],
          [0, 0, 0],
        ],
        'frame',
        '线性的两条',
      ),
    )
    expect(changedLines(B1, f)).toEqual([lineNo(B1, 'T(u+v)')])
    expect(f).toContain('    - T(u+v)=T(u)+T(v) <!-- box=0.075,0.074,0.232,0.066 frame=2 frame-title="线性的两条" -->\n')
    // 不同枝各一个，中心不框
    const g = addSpan(r, [[0], [0, 0, 0], [0, 0, 2], [0, 3, 1]], 'sum', '一句话')
    expect(nodeAt(g, [0])!.sum).toBeUndefined()
    expect(nodeAt(g, [0, 0, 0])!.sum).toEqual({ n: 3, text: '一句话' })
    expect(nodeAt(g, [0, 3, 1])!.sum).toEqual({ n: 1, text: '一句话' })
    expect(
      spansOf([
        [0, 1, 1],
        [0, 1, 0],
        [0, 2, 2],
      ]),
    ).toEqual([
      { parent: [0, 1], from: 0, n: 2 },
      { parent: [0, 2], from: 2, n: 1 },
    ])
    // 去掉外框：回到原样
    expect(withMindmap(f, setAttrs(parseMindmap(f).roots, [0, 0, 0], { frame: undefined }))).toBe(B1)
    // 改图的宽：只换 img-w 那一截
    const w = withMindmap(B2, setAttrs(r2(), [0, 3, 0], { imgW: 120 }))
    expect(changedLines(B2, w)).toEqual([lineNo(B2, '旋转 ![')])
    expect(w).toContain('    - 旋转 ![旋转](../附件/导图/旋转.png) <!-- img-w=120 -->\n')
  })

  it('挂图：图写在字后面，宽记在注释里；去掉图回到原样', () => {
    const out = withMindmap(B1, setAttrs(r1(), [0, 3, 0], { img: { alt: '旋转', src: '../附件/导图/旋转.png' }, imgW: 88 }))
    expect(out).toContain('    - 旋转 ![旋转](../附件/导图/旋转.png) <!-- img-w=88 -->\n')
    const back = withMindmap(out, setAttrs(parseMindmap(out).roots, [0, 3, 0], { img: undefined, imgW: undefined }))
    expect(back).toBe(B1)
  })

  it('浮动主题：写在大树后面、最外层，记位置；拆出来、挂回去', () => {
    const add = addFloating(r1(), '先记一笔', [470.4, 250.6])
    expect(add.path).toEqual([1])
    expect(withMindmap(B1, add.roots)).toBe(B1 + '- 先记一笔 <!-- at=470,251 -->\n')
    // 树上的拆出来（连同下面的）：放到最外层
    const d = detachTopic(r1(), [0, 1], [300, -120])!
    const dt = withMindmap(B1, d.roots)
    expect(dt.endsWith('- 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 at=300,-120 -->\n  - 列 = 基向量的像\n  - 复合 = 矩阵相乘\n')).toBe(true)
    // 挂回「核与像」下面：位置不记了，缩进跟着
    const back = settle(moveTo(d.roots, d.path, [0, 1]))!
    expect(withMindmap(B1, back.roots)).toContain(
      '  - 核与像\n    - ker T 映到 0\n    - im T 所有的像\n    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 unsure guesses="秩-零化度定理|秩-零化渡定理" -->\n    - 矩阵表示 <!-- box=0.655,0.189,0.159,0.082 -->\n      - 列 = 基向量的像\n',
    )
    expect(detachTopic(r1(), [0], [0, 0])).toBeNull()
  })
})

describe('导图第二批：属性（配色、骨架、联系线）', () => {
  it('配色、骨架各一行，挨着布局写；默认的去掉，回到原样', () => {
    const a = withMapPalette(B1, 'rainbow')
    expect(a).toContain('白板样式: 导图\n导图配色: 彩虹\n类型: 导图\n')
    const b = withMapLayout(a, 'down')
    expect(b).toContain('白板样式: 导图\n导图布局: 向下\n导图配色: 彩虹\n类型: 导图\n')
    const c = withMapSkeleton(b, 'box')
    expect(c).toContain('导图布局: 向下\n导图配色: 彩虹\n导图骨架: 方框\n类型: 导图\n')
    expect(withMapPalette(c, 'rainbow')).toBe(c)
    expect(withMapLayout(withMapSkeleton(withMapPalette(c, 'theme'), 'card'), 'right')).toBe(B1)
  })

  it('联系线：一行一条写在属性里，没变不动；带「: 」的字整条用单引号包住', () => {
    const rels = [{ a: 'k1', b: 'k2', label: '比例: 1' }]
    const out = withMapRels(B1, rels)
    expect(out).toContain(`白板样式: 导图\n导图联系线:\n  - 'k1 -> k2 "比例: 1"'\n类型: 导图\n`)
    expect(mapRelsOf(out)).toEqual(rels)
    expect(withMapRels(out, rels)).toBe(out)
    expect(withMapRels(out, [])).toBe(B1)
    // 改弯度只改那一条
    const bent = withMapRels(B2, [mapRelsOf(B2)[0]!, { a: 'k3', b: 'k1', bend: -12 }])
    expect(changedLines(B2, bent)).toEqual([lineNo(B2, 'k3 -> k1')])
    expect(bent).toContain('  - k3 -> k1 bend=-12\n')
  })

  it('删掉一头的主题：那条联系线一起删，属性里那一行跟着去掉；别的不动', () => {
    const p = pathOfId(r2(), 'k2')!
    expect(p).toEqual([0, 1])
    const out = withMindmap(B2, removeAt(r2(), p))
    expect(mapRelsOf(out)).toEqual([{ a: 'k3', b: 'k1', bend: 30 }])
    expect(out).toContain('导图联系线:\n  - k3 -> k1 bend=30\n类型: 导图\n')
    // 两条都删光：属性去掉
    const all = withMindmap(out, removeAt(parseMindmap(out).roots, [1]))
    expect(all).not.toContain('导图联系线')
  })

  it('短编号：没用过的最小的；给几个主题编上（有的不动）', () => {
    expect(nextMapId(r1())).toBe('k1')
    expect(nextMapId(r2())).toBe('k4')
    const w = withIds(r2(), [
      [0, 3, 1],
      [0, 2, 0],
    ])
    expect(w.ids).toEqual(['k1', 'k4'])
    expect(nodeAt(w.roots, [0, 2, 0])!.id).toBe('k4')
    expect(withMindmap(B2, w.roots)).toContain('    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 id=k4 -->\n      dim V')
  })
})

describe('导图第二批：导出 OPML', () => {
  it('每个主题一行，链接只留字，备注写进 _note', () => {
    const x = mindmapOpml('导图 11-22', r2())
    expect(x).toContain('<title>导图 11-22</title>')
    expect(x).toContain('<outline text="详见 第3讲 矩阵乘法"/>')
    expect(x).toContain('<outline text="秩-零化度定理" _note="dim V = dim ker T + dim im T。&#10;&#10;老师说这是这一章最要紧的一条，期末必考。"/>')
    expect(x).toContain('<outline text="先记一笔"/>')
    expect(x.match(/<outline /g)!.length).toBe(13)
  })
})

describe('导图第二批：选几个一起拖', () => {
  it('几个一起挪到一个主题后面，按原来的先后排在一起；只动那几行', () => {
    // 「T(cv)=cT(v)」和「复合 = 矩阵相乘」一起排到「ker T 映到 0」后面
    const r = moveMany(r1(), [[0, 1, 1], [0, 0, 1]], [0, 2, 0], 'after')!
    expect(r.paths).toEqual([
      [0, 2, 1],
      [0, 2, 2],
    ])
    const out = withMindmap(B1, r.roots)
    expect(out).toContain('    - ker T 映到 0\n    - T(cv)=cT(v)\n    - 复合 = 矩阵相乘\n    - im T 所有的像\n')
    expect(out).not.toContain('    - 先加再映射，和先映射再加，结果一样；数乘也一样\n    - T(cv)')
  })

  it('放进一个主题里排在最后；选中的套在另一个下面的跟着上面那个走；拖到自己下面不行', () => {
    const r = moveMany(r1(), [[0, 1], [0, 1, 0], [0, 3, 2]], [0, 0], 'into')!
    expect(r.paths).toEqual([
      [0, 0, 3],
      [0, 0, 4],
    ])
    const n = nodeAt(r.roots, [0, 0])!
    expect(n.children.map((c) => c.text)).toEqual(['T(u+v)=T(u)+T(v)', 'T(cv)=cT(v)', '先加再映射，和先映射再加，结果一样；数乘也一样', '矩阵表示', '求导 d/dx'])
    expect(n.children[3]!.children.map((c) => c.text)).toEqual(['列 = 基向量的像', '复合 = 矩阵相乘'])
    expect(moveMany(r1(), [[0, 1]], [0, 1, 0], 'into')).toBeNull()
    expect(moveMany(r1(), [[0, 1]], [0], 'after')).toBeNull()
  })

  it('浮动主题一起拖进树里：不再记位置', () => {
    const t = B1 + '- 先记一笔 <!-- at=470,250 -->\n'
    const r = moveMany(parseMindmap(t).roots, [[1]], [0, 3], 'into')!
    expect(withMindmap(t, r.roots)).toBe(B1.replace('    - 求导 d/dx\n', '    - 求导 d/dx\n    - 先记一笔\n'))
  })
})
