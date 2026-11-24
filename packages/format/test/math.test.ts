import { describe, expect, it } from 'vitest'
import { findMath, inlineMath, mapMath, mathBlockAt } from '../src/math'
import { MATH_DOC } from './fixtures'

/** MATH_DOC 里行内的公式：截图里的 33 个 + 一行中间的 $$…$$、\(…\) + 写错的两个 */
const MATH_INLINE_COUNT = 37

/** 认出来的公式：[原文, LaTeX, 单独成行吗] */
const found = (text: string) => findMath(text).map((s) => [text.slice(s.from, s.to), s.tex, s.block] as const)
const texes = (text: string) => findMath(text).map((s) => s.tex)

/** 照 task-o48fa 截图（d2l 的数学符号表）写的一段 */
export const D2L = `## 数字

- $x$：标量
- $\\mathbf{x}$：向量
- $\\mathbf{X}$：矩阵
- $\\mathsf{X}$：张量
- $\\mathbf{I}$：单位矩阵
- $x_i$, $\\mathbf{x}_i$：向量 $\\mathbf{x}$ 第 $i$ 个元素
- $x_{ij}$, $\\mathbf{X}_{ij}$：矩阵 $\\mathbf{X}$ 第 $i$ 行第 $j$ 列的元素

## 集合论

- $\\mathcal{X}$：集合
- $\\mathbb{Z}$：整数集合
- $\\mathbb{R}$：实数集合
- $\\mathbb{R}^n$：$n$ 维实数向量集合
- $\\mathbb{R}^{a\\times b}$：包含 $a$ 行和 $b$ 列的实数矩阵集合
- $\\mathcal{A}\\cup\\mathcal{B}$：集合 $\\mathcal{A}$ 和 $\\mathcal{B}$ 的并集
- $\\mathcal{A}\\cap\\mathcal{B}$：集合 $\\mathcal{A}$ 和 $\\mathcal{B}$ 的交集
- $\\mathcal{A}\\setminus\\mathcal{B}$：集合 $\\mathcal{A}$ 与集合 $\\mathcal{B}$ 相减，$\\mathcal{B}$ 关于 $\\mathcal{A}$ 的相对补集
`

describe('行内 $…$（截图里的每一种写法）', () => {
  it('d2l 符号表：每个 $…$ 都认成公式，一个不多一个不少', () => {
    const got = texes(D2L)
    expect(got).toEqual([
      'x',
      '\\mathbf{x}',
      '\\mathbf{X}',
      '\\mathsf{X}',
      '\\mathbf{I}',
      'x_i',
      '\\mathbf{x}_i',
      '\\mathbf{x}',
      'i',
      'x_{ij}',
      '\\mathbf{X}_{ij}',
      '\\mathbf{X}',
      'i',
      'j',
      '\\mathcal{X}',
      '\\mathbb{Z}',
      '\\mathbb{R}',
      '\\mathbb{R}^n',
      'n',
      '\\mathbb{R}^{a\\times b}',
      'a',
      'b',
      '\\mathcal{A}\\cup\\mathcal{B}',
      '\\mathcal{A}',
      '\\mathcal{B}',
      '\\mathcal{A}\\cap\\mathcal{B}',
      '\\mathcal{A}',
      '\\mathcal{B}',
      '\\mathcal{A}\\setminus\\mathcal{B}',
      '\\mathcal{A}',
      '\\mathcal{B}',
      '\\mathcal{B}',
      '\\mathcal{A}',
    ])
    // 每一段原文两头都是 $，一个也不是单独成行的
    for (const s of findMath(D2L)) {
      expect(D2L[s.from]).toBe('$')
      expect(D2L[s.to - 1]).toBe('$')
      expect(s.block).toBe(false)
      expect(s.display).toBe(false)
    }
  })

  it('紧挨着汉字、标点、逗号的都认', () => {
    expect(texes('门槛$V_{th}$就发，（$y$）、$a$,$b$。')).toEqual(['V_{th}', 'y', 'a', 'b'])
  })

  it('两个公式紧挨着（删掉中间的「, 」）：还是两个', () => {
    expect(texes('$x_i$$\\mathbf{x}_i$')).toEqual(['x_i', '\\mathbf{x}_i'])
  })

  it('\\(…\\) 也是行内公式', () => {
    expect(found('设 \\(x^2\\) 是平方')).toEqual([['\\(x^2\\)', 'x^2', false]])
  })
})

describe('不是公式的', () => {
  it('钱数：「$5 和 $6」「一杯 $5，两杯 $10」「US$5 and US$6」', () => {
    expect(findMath('$5 和 $6')).toEqual([])
    expect(findMath('一杯 $5，两杯 $10，三杯 $15。')).toEqual([])
    expect(findMath('US$5 and US$6')).toEqual([])
    expect(findMath('花了 $5.50，找回 $0.5')).toEqual([])
  })

  it('$ 后面紧跟空格、结尾 $ 前面是空格的不算；结尾 $ 后面紧跟数字的不算', () => {
    expect(findMath('$ x$')).toEqual([])
    expect(findMath('$x $')).toEqual([])
    expect(findMath('$x$5')).toEqual([])
    expect(texes('$x$ 5')).toEqual(['x'])
  })

  it('\\$ 是普通的美元符号', () => {
    expect(findMath('价格 \\$5 到 \\$6$')).toEqual([])
    expect(findMath('\\$x\\$')).toEqual([])
    // 转义的反斜杠后面的 $ 照常算
    expect(texes('\\\\$x$')).toEqual(['x'])
    // 公式里面的 \$ 不当结尾
    expect(texes('$\\$5$')).toEqual(['\\$5'])
  })

  it('行内代码、代码块里的 $ 不算', () => {
    expect(findMath('`echo $HOME` 和 `$x$`')).toEqual([])
    expect(findMath('``a ` $x$ ``')).toEqual([])
    expect(findMath('```sh\necho $x$\n$$\n```\n')).toEqual([])
    expect(findMath('~~~\n$x$\n~~~\n\n后面 $y$')).toHaveLength(1)
    // 代码块后面的照常认
    expect(texes('```\n$a$\n```\n$b$')).toEqual(['b'])
  })

  it('属性、HTML 注释里的不算', () => {
    expect(findMath('---\ntitle: $x$\n---\n正文')).toEqual([])
    expect(findMath('<!-- card id=a title="$x$" -->\n正文')).toEqual([])
    expect(findMath('<!--\n$x$\n-->\n$y$').map((s) => s.tex)).toEqual(['y'])
  })

  it('没配上的半截、空的', () => {
    expect(findMath('还没写完的 $x')).toEqual([])
    expect(findMath('$$')).toEqual([])
    expect(findMath('$$ $$')).toEqual([])
    expect(findMath('\\(\\)')).toEqual([])
    expect(findMath('$$\nV = IR')).toEqual([])
  })
})

describe('单独成行的 $$…$$、\\[…\\]', () => {
  it('一行写完、上下两行夹着、\\[…\\]', () => {
    const text = '前面\n\n$$V(t) = V_0 e^{-t/\\tau}$$\n\n$$\n\\sum_{i=1}^{n} w_i x_i\n$$\n\n\\[\na^2+b^2=c^2\n\\]\n'
    expect(found(text)).toEqual([
      ['$$V(t) = V_0 e^{-t/\\tau}$$', 'V(t) = V_0 e^{-t/\\tau}', true],
      ['$$\n\\sum_{i=1}^{n} w_i x_i\n$$', '\\sum_{i=1}^{n} w_i x_i', true],
      ['\\[\na^2+b^2=c^2\n\\]', 'a^2+b^2=c^2', true],
    ])
    expect(findMath(text).every((s) => s.display)).toBe(true)
  })

  it('开头一行带字、结尾一行带字；前面有缩进（列表里）', () => {
    expect(found('$$a =\nb + c$$')).toEqual([['$$a =\nb + c$$', 'a =\nb + c', true]])
    expect(found('- 项\n\n  $$\n  x\n  $$')).toEqual([['$$\n  x\n  $$', 'x', true]])
  })

  it('中间有空行、没有结尾：不算（一个落单的 $$ 不吞掉后面整篇）', () => {
    expect(findMath('$$\na\n\nb\n$$')).toEqual([])
    expect(mathBlockAt(['$$', 'a'], 0)).toBeNull()
  })

  it('一行中间的 $$…$$、一行里两个 $$…$$：行内的', () => {
    expect(found('看 $$x$$ 这个')).toEqual([['$$x$$', 'x', false]])
    expect(found('$$a$$ 和 $$b$$')).toEqual([
      ['$$a$$', 'a', false],
      ['$$b$$', 'b', false],
    ])
  })

  it('inlineMath：一行只有一个 $$…$$ 时标成单独成行', () => {
    expect(inlineMath('  $$x$$  ')[0]!.block).toBe(true)
    expect(inlineMath('$x$')[0]!.block).toBe(false)
  })
})

describe('引文里单独成行的 $$…$$（剪藏进来的 > $$ … > $$，task-6cxtc）', () => {
  it('> $$ 开头一行、> $$ 结尾一行夹着：认成单独成行的，LaTeX 去掉每行的「> 」；记下行首的「> 」', () => {
    const text = '> 先看\n> $$\n> \\mathbf{A}=\\begin{bmatrix} a \\\\\n> b \\end{bmatrix} \\tag{2.3.7}\n> $$\n> 后面\n—— [来源](https://x.org)'
    const s = findMath(text)
    expect(s).toHaveLength(1)
    expect(s[0]!.block).toBe(true)
    expect(s[0]!.tex).toBe('\\mathbf{A}=\\begin{bmatrix} a \\\\\nb \\end{bmatrix} \\tag{2.3.7}')
    expect(s[0]!.quote).toBe('> ')
    expect(text.slice(s[0]!.from, s[0]!.to)).toBe('$$\n> \\mathbf{A}=\\begin{bmatrix} a \\\\\n> b \\end{bmatrix} \\tag{2.3.7}\n> $$')
  })

  it('一行写完的 > $$x$$、嵌套的 > > $$；提示块里的也认', () => {
    expect(found('> $$x^2$$')).toEqual([['$$x^2$$', 'x^2', true]])
    expect(found('> > $$\n> > y\n> > $$')).toEqual([['$$\n> > y\n> > $$', 'y', true]])
    expect(found('> [!ai] 讲解一下\n> 看\n> $$\n> z\n> $$')).toEqual([['$$\n> z\n> $$', 'z', true]])
  })

  it('引文断了（下一行没有「> 」、换了层数、中间「>」空行）：不算', () => {
    expect(findMath('> $$\nx\n$$').filter((m) => m.block)).toEqual([])
    expect(findMath('> $$\n> > x\n> $$').filter((m) => m.block)).toEqual([])
    expect(findMath('> $$\n>\n> x\n> $$').filter((m) => m.block)).toEqual([])
  })

  it('引文里的代码块里的 $$ 不算', () => {
    expect(findMath('> ```\n> $$\n> x\n> $$\n> ```')).toEqual([])
    // 引文里没收尾的代码块不吞掉引文外面的
    expect(found('> ```\n> a\n\n$$\ny\n$$')).toEqual([['$$\ny\n$$', 'y', true]])
  })

  it('mapMath：引文里的公式换成别的写法，换行后面补回「> 」', () => {
    expect(mapMath('> $$\n> a\n> b\n> $$', (s) => `\\[${s.tex}\\]`)).toBe('> \\[a\n> b\\]')
  })
})

describe('测试用的那一篇（MATH_DOC，端到端测试也用它）', () => {
  it('行内的、单独成行的各几个；钱数、代码、\\$ 不算；写错的照样认出来（排的时候才知道错）', () => {
    const s = findMath(MATH_DOC)
    expect(s.filter((x) => x.block).map((x) => x.tex)).toEqual(['\\hat{\\mathbf{y}} = \\mathbf{X}\\mathbf{w} + b', "f'(x) = 2x", expect.stringMatching(/^\\mathcal\{L\}/)])
    expect(s.filter((x) => !x.block)).toHaveLength(MATH_INLINE_COUNT)
    expect(s.map((x) => x.tex)).toContain('\\frac{1}{')
    expect(s.map((x) => x.tex)).not.toContain('5，两杯 ')
  })
})

describe('mapMath（导出给 Anki）', () => {
  it('$…$ 换成 \\(…\\)，单独成行的换成 \\[…\\]，钱数和代码照旧', () => {
    const out = mapMath('设 $x$，花 $5，\n\n$$\ny=x^2\n$$\n`$a$`', (s) => (s.display ? `\\[${s.tex}\\]` : `\\(${s.tex}\\)`))
    expect(out).toBe('设 \\(x\\)，花 $5，\n\n\\[y=x^2\\]\n`$a$`')
  })
})
