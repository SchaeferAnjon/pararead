import { describe, expect, it } from 'vitest'
import { convertMdBlocks, duplicateMdBlocks, findBlocks, indentMdBlocks, moveMdBlocks, removeMdBlocks, replaceMdBlocks, selectedMarkdown } from '../src'

/**
 * 文档里选好几块一起改（task-5ryf9，17-白板框选 方向 A 的文档操作条）：一起拖、删、复制一份、转成、缩进、整理后换掉。
 * 只动选中的那几块和它们之间的空白，别处一个字节不变；一次改完（编辑器里一步撤回）。
 */
const DOC = `# 2.3 线性代数

教材：《动手学深度学习》，PyTorch 版。

## 2.3 线性代数

矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。

> 矩阵-矩阵乘法可以简单地称为矩阵乘法。

范数：向量有多大。

- 范数非负
- 三角不等式
- 按常数缩放

我的疑问：为什么常用 L2？
`
const blocks = findBlocks(DOC)
const at = (s: string) => blocks.findIndex((b) => DOC.slice(b.from, b.to).includes(s))

describe('几块一起拖（moveMdBlocks）', () => {
  it('挪到别处：按原来的先后挨着放，和邻居之间一个空行；别处不动', () => {
    const e = moveMdBlocks(DOC, [at('范数非负'), at('三角不等式'), at('按常数缩放')], at('教材'), blocks)!
    expect(e.text).toBe(`# 2.3 线性代数

- 范数非负
- 三角不等式
- 按常数缩放

教材：《动手学深度学习》，PyTorch 版。

## 2.3 线性代数

矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。

> 矩阵-矩阵乘法可以简单地称为矩阵乘法。

范数：向量有多大。

我的疑问：为什么常用 L2？
`)
    expect(e.text.slice(e.at, e.at + 6)).toBe('- 范数非负')
  })

  it('不挨着的几块挪到最后；落点在选中的几块中间时等于不动', () => {
    const e = moveMdBlocks(DOC, [at('教材'), at('范数：')], blocks.length, blocks)!
    expect(e.text.endsWith('我的疑问：为什么常用 L2？\n\n教材：《动手学深度学习》，PyTorch 版。\n\n范数：向量有多大。\n')).toBe(true)
    expect(e.text.startsWith('# 2.3 线性代数\n\n## 2.3 线性代数')).toBe(true)
    expect(moveMdBlocks(DOC, [at('三角不等式'), at('按常数缩放')], at('按常数缩放'), blocks)).toBeNull()
  })
})

describe('几块一起删、复制一份、拿出 md（removeMdBlocks、duplicateMdBlocks、selectedMarkdown）', () => {
  it('删掉几块：两边留一个空行，光标落在删掉的地方', () => {
    const e = removeMdBlocks(DOC, [at('矩阵-矩阵乘法 AB'), at('> 矩阵'), at('范数：')], blocks)!
    expect(e.text).toBe(`# 2.3 线性代数

教材：《动手学深度学习》，PyTorch 版。

## 2.3 线性代数

- 范数非负
- 三角不等式
- 按常数缩放

我的疑问：为什么常用 L2？
`)
  })

  it('复制一份：最后一块下面多一样的几块（按原来的先后）', () => {
    const e = duplicateMdBlocks(DOC, [at('> 矩阵'), at('范数：')], blocks)!
    expect(e.text).toContain('> 矩阵-矩阵乘法可以简单地称为矩阵乘法。\n\n范数：向量有多大。\n\n> 矩阵-矩阵乘法可以简单地称为矩阵乘法。\n\n范数：向量有多大。\n\n- 范数非负')
  })

  it('复制出去的 md：几块原文，中间一个空行；列表项还是紧凑的一个列表', () => {
    expect(selectedMarkdown(DOC, [at('范数：'), at('范数非负'), at('三角不等式')], blocks)).toBe('范数：向量有多大。\n\n- 范数非负\n- 三角不等式')
  })
})

describe('转成（convertMdBlocks）：只改每段开头的记号，字不变', () => {
  it('小标题、标题、列表、编号列表、待办、引用、正文', () => {
    const sel = [at('矩阵-矩阵乘法 AB'), at('范数：')]
    expect(convertMdBlocks(DOC, sel, 'h3', blocks)!.text).toContain('### 矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。\n\n> 矩阵-矩阵乘法可以简单地称为矩阵乘法。\n\n### 范数：向量有多大。')
    expect(convertMdBlocks(DOC, sel, 'h2', blocks)!.text).toContain('## 范数：向量有多大。')
    expect(convertMdBlocks(DOC, sel, 'bullet', blocks)!.text).toContain('- 矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。\n\n> 矩阵')
    expect(convertMdBlocks(DOC, sel, 'ordered', blocks)!.text).toContain('1. 范数：向量有多大。')
    expect(convertMdBlocks(DOC, sel, 'todo', blocks)!.text).toContain('- [ ] 范数：向量有多大。')
    expect(convertMdBlocks(DOC, sel, 'quote', blocks)!.text).toContain('> 范数：向量有多大。')
    const plain = convertMdBlocks(DOC, [at('范数非负'), at('> 矩阵')], 'paragraph', blocks)!.text
    expect(plain).toContain('\n\n矩阵-矩阵乘法可以简单地称为矩阵乘法。\n\n')
    // 紧凑列表里的一项转成正文：前后补空行，不粘成续行
    expect(plain).toContain('范数：向量有多大。\n\n范数非负\n\n- 三角不等式')
  })

  it('提示块：连着的几块包进一个「> [!note]」，不连着的各包一个；块里原来的写法照留', () => {
    const e = convertMdBlocks(DOC, [at('矩阵-矩阵乘法 AB'), at('> 矩阵'), at('我的疑问')], 'callout', blocks)!
    expect(e.text).toContain('## 2.3 线性代数\n\n> [!note]\n> 矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。\n>\n> > 矩阵-矩阵乘法可以简单地称为矩阵乘法。\n\n范数：向量有多大。')
    expect(e.text.endsWith('- 按常数缩放\n\n> [!note]\n> 我的疑问：为什么常用 L2？\n')).toBe(true)
  })

  it('选中的里面有不能转的（表格、分隔线）：跳过它们，别的照转', () => {
    const t = '甲\n\n***\n\n乙\n'
    const bs = findBlocks(t)
    expect(convertMdBlocks(t, [0, 1, 2], 'todo', bs)!.text).toBe('- [ ] 甲\n\n***\n\n- [ ] 乙\n')
  })
})

describe('缩进（indentMdBlocks）：只有列表、待办能缩，正文缩了会变成代码', () => {
  it('列表项每行多两个空格、再按一次少两个；正文、标题不动，数出没动的几块', () => {
    const sel = [at('三角不等式'), at('按常数缩放'), at('范数：')]
    const r = indentMdBlocks(DOC, sel, 1, blocks)
    expect(r.edit!.text).toContain('- 范数非负\n  - 三角不等式\n  - 按常数缩放\n')
    expect(r.changed).toBe(2)
    expect(r.skipped).toBe(1)
    // 缩进以后两项成了「范数非负」下面的子项（和它一块）：选这一块减少缩进，回到原样
    const nb = findBlocks(r.edit!.text)
    const i2 = nb.findIndex((b) => r.edit!.text.slice(b.from, b.to).includes('三角不等式'))
    const back = indentMdBlocks(r.edit!.text, [i2], -1, nb)
    expect(back.edit!.text).toBe(DOC)
    expect(indentMdBlocks(DOC, [at('范数：')], 1, blocks).edit).toBeNull()
  })
})

describe('换掉几块（replaceMdBlocks）：AI 整理这几段后放回第一块的地方', () => {
  it('删掉选中的几块，在第一块那里放进新的 md；别处不动', () => {
    const e = replaceMdBlocks(DOC, [at('范数：'), at('矩阵-矩阵乘法 AB')], '### 矩阵乘法\n\n矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。\n\n### 范数\n\n范数：向量有多大。', blocks)!
    expect(e.text).toBe(`# 2.3 线性代数

教材：《动手学深度学习》，PyTorch 版。

## 2.3 线性代数

### 矩阵乘法

矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积。

### 范数

范数：向量有多大。

> 矩阵-矩阵乘法可以简单地称为矩阵乘法。

- 范数非负
- 三角不等式
- 按常数缩放

我的疑问：为什么常用 L2？
`)
  })
})
