import { describe, expect, it } from 'vitest'
import { addSection, appendPlaced, detailsHead, duplicateUnit, findUnitAgain, insertInColumn, linksOf, linkUnits, moveColumn, moveUnit, placeColumn, placeUnit, removeColumn, removeUnit, renameColumn, resetLayout, splitDoc, unitKeys, unlink, unplaceUnit } from '../src/doc-board'

export const LECTURE = `# Lecture05 笔记

读 PDF 时记的。

## 这一讲讲什么

这一讲从为什么要专用硬件讲起。

### 九层结构

- 上三层是软件
- 下三层是电路

## 第 3 页 · 计算栈的九层结构

> [!question] 我的疑惑
> 九层是哪九层？

> [!success] 讲通的讲法（第 1 版）
> 从应用到物理。

## 第 5 页 · 加速器为何又快又省

> [!question] 我的疑惑
> 为什么省电？

## 用代码验证

各跑一遍：

\`\`\`python
print(1)
\`\`\`

***

| 方法 | 时间 |
|---|---|
| CPU | 3s |
`

export const TRAVEL = `# 冰岛十天环岛

## 出发前

还没订完的：

- [ ] 租车
- [x] 机票

![黑沙滩](附件/a.png)

![冰川](附件/b.png)

> 冰岛的天气五分钟一变。
—— [旅行杂志](https://example.com)

## 路线

<!-- video video=youtube:abc -->
![雷克雅未克](附件/v.jpg)
[雷克雅未克](https://www.youtube.com/watch?v=abc)
频道 · 08:55

<!-- moment video=youtube:abc t=12 -->
![00:12](附件/m.jpg)
[▶ 00:12 · 雷克雅未克](https://www.youtube.com/watch?v=abc&t=12s)
> **00:12 第一站**

第一天：雷克雅未克。
`

const cardsOf = (t: string) => splitDoc(t).columns.map((c) => [c.title, c.cards.map((u) => u.kind)])

describe('文档切到白板：分卡（方向 A）', () => {
  it('Lecture05 笔记：名字不成卡；开头一组没有列头；## 是列，### 是小标题；问过 AI 一处一列；冒号那句带上代码块；分隔线是空隙', () => {
    const b = splitDoc(LECTURE)
    expect(b.title).toBe('Lecture05 笔记')
    expect(cardsOf(LECTURE)).toEqual([
      [null, ['text']],
      ['这一讲讲什么', ['text', 'list']],
      ['第 3 页 · 计算栈的九层结构', ['ask']],
      ['第 5 页 · 加速器为何又快又省', ['ask']],
      ['用代码验证', ['code', 'gap', 'table']],
    ])
    expect(b.columns[1]!.cards[1]!.sub).toBe('九层结构')
    expect(b.columns[4]!.cards[0]!.text).toBe('各跑一遍：\n\n```python\nprint(1)\n```')
    expect(b.columns[2]!).toMatchObject({ ask: true, page: 3 })
    // 以前的格式（没有身份注释）：整节一张，列头是标题那一行
    expect(b.columns[2]!.cards[0]!.ask).toEqual({ part: 'old', head: '## 第 3 页 · 计算栈的九层结构' })
    expect(b.columns[2]!.cards[0]!.text.startsWith('> [!question] 我的疑惑')).toBe(true)
  })

  it('旅行稿：冒号那句带上待办；连着的图合成图集；视频后面的时刻挂在视频卡下面', () => {
    expect(cardsOf(TRAVEL)).toEqual([
      ['出发前', ['todo', 'images', 'quote']],
      ['路线', ['video', 'text']],
    ])
    const video = splitDoc(TRAVEL).columns[1]!.cards[0]!
    expect(video.moments).toHaveLength(1)
    expect(video.moments![0]!.text.startsWith('<!-- moment video=youtube:abc t=12 -->')).toBe(true)
  })

  it('套着的折叠块（外层两行写法套内层）：外层整块一张卡，不露出外层的 HTML', () => {
    const doc = '# 折叠丁\n\n<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>\n\n后面一段。\n'
    const cols = splitDoc(doc).columns
    const units = cols.flatMap((c) => c.cards)
    expect(units.map((u) => u.kind)).toEqual(['details', 'text'])
    expect(units[0]!.text).toBe('<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>')
  })

  it('折叠块 <details> 到 </details> 整块一张卡，不拆成标签、正文、收尾三张；不配对的照普通块', () => {
    const doc = '# 冰岛\n\n## 问过 AI\n\n> [!warning] 注意\n> 买保险。\n\n<details><summary>没讲通 · 第 1 版</summary>\n\n旧讲法：钉胎像钉鞋。\n\n### 里面的小标题\n\n- 一\n- 二\n\n</details>\n\n后面一段。\n'
    expect(cardsOf(doc)).toEqual([['问过 AI', ['callout', 'details', 'text']]])
    const d = splitDoc(doc).columns[0]!.cards[1]!
    expect(d.text.startsWith('<details><summary>没讲通 · 第 1 版</summary>')).toBe(true)
    expect(d.text.endsWith('</details>')).toBe(true)
    expect(d.sub).toBeUndefined()
    // 没有 </details>：开头那行照 html 块，后面照常分卡
    expect(cardsOf('# 冰岛\n\n## 甲\n\n<details><summary>半截</summary>\n\n正文。\n')).toEqual([['甲', ['details', 'text']]])
  })

  it('斜杠插入的折叠块（空的、写了字的）和读 PDF 写的「没讲通 · 第 N 版」都是整块一张卡', () => {
    const slashEmpty = '<details><summary>收起的内容</summary>\n\n\n\n</details>'
    const slashFilled = '<details><summary>收起的内容</summary>\n\n第一段。\n\n- 一条\n- 两条\n\n</details>'
    const failed = '<details><summary>没讲通 · 第 2 版：用公式推，没听懂</summary>\n\n先写 Ax = λx，再移项……\n\n</details>'
    for (const block of [slashEmpty, slashFilled, failed]) {
      const doc = `# 笔记\n\n## 一节\n\n前面一段。\n\n${block}\n\n后面一段。\n`
      expect(cardsOf(doc)).toEqual([['一节', ['text', 'details', 'text']]])
      expect(splitDoc(doc).columns[0]!.cards[1]!.text).toBe(block)
    }
  })

  it('两行写的 <details>（下一行 <summary>）也是一张卡；</details> 下一行紧贴着写的字单独一张卡（文档里也画在折叠块外面）', () => {
    const doc = '# 预算\n\n## 一节\n\n<details>\n<summary>旧的预算</summary>\n\nY\n\n</details>\n收尾一段。\n'
    expect(cardsOf(doc)).toEqual([['一节', ['details', 'text']]])
    const [d, t] = splitDoc(doc).columns[0]!.cards
    expect(d!.text).toBe('<details>\n<summary>旧的预算</summary>\n\nY\n\n</details>')
    expect(t!.text).toBe('收尾一段。')
  })

  it('<details> 和 <summary> 中间空一行、<summary> 写成好几行：也是一张折叠卡（第 4 轮）', () => {
    for (const head of ['<details>\n\n<summary>旧的预算</summary>', '<details>\n<summary>\n旧的预算\n</summary>', '<details><summary>旧的\n预算</summary>']) {
      const doc = `# 预算\n\n## 一节\n\n${head}\n\nY\n\n</details>\n\n收尾一段。\n`
      expect(cardsOf(doc)).toEqual([['一节', ['details', 'text']]])
      expect(splitDoc(doc).columns[0]!.cards[0]!.text).toBe(`${head}\n\nY\n\n</details>`)
    }
  })

  it('detailsHead：认一行、两行、中间空行、多行 summary；标题里有空行、summary 不在开头的不认', () => {
    const at = (t: string) => detailsHead(t.split('\n'), 0)
    expect(at('<details><summary>甲</summary>')).toEqual({ title: '甲', open: false, lines: 1 })
    expect(at('<details open>\n<summary>乙</summary>')).toEqual({ title: '乙', open: true, lines: 2 })
    expect(at('<details>\n\n<summary>丙</summary>\n\n正文')).toEqual({ title: '丙', open: false, lines: 3 })
    expect(at('<details>\n<summary>\n  丁 丁\n</summary>\n正文')).toEqual({ title: '丁 丁', open: false, lines: 4 })
    expect(at('<details><summary>戊\n续</summary>')).toEqual({ title: '戊 续', open: false, lines: 2 })
    expect(at('<details>\n<summary>己\n\n正文</summary>')).toBeNull()
    expect(at('<details>\n正文\n<summary>庚</summary>')).toBeNull()
    expect(at('<details>\n\n正文')).toBeNull()
  })

  it('富内容：$$ 公式（连着的几段合成一张）、单独一行的 ![[…]] 和 [[…]] 各是一种卡；书摘提示块是素材卡，后面的「我的评价」跟着它', () => {
    const t = `# 富内容

## 一

![[Lecture05.pdf#page=3]]

$$
I = \\frac{a}{b}
$$

$$
P = \\min(\\pi, \\beta I)
$$

[[冰岛自驾]]

[[Lecture05 可视化|加速器为何又快又省]]

![[我的疑惑]]

> [!quote] [《在冰岛开车》 · 第二章 天气](weread://book/1)
> 在冰岛，天气不是闲聊的话题。

> 冰洞每年的形状都不一样。
—— [《在冰岛开车》 · 第五章 冰洞](https://weread.qq.com/web/reader/1)

我的评价：所以要跟向导进。

> [!note] 这讲的主线
> 加速器省电。

<!-- 别的软件留下的注释 -->

公式如下：

$$
E = mc^2
$$
`
    const b = splitDoc(t)
    expect(b.columns[0]!.cards.map((u) => u.kind)).toEqual(['embed', 'math', 'link', 'link', 'embed', 'quote', 'quote', 'callout', 'math'])
    const [, math, , , , , quote2, , lead] = b.columns[0]!.cards
    expect(math!.text).toBe('$$\nI = \\frac{a}{b}\n$$\n\n$$\nP = \\min(\\pi, \\beta I)\n$$')
    expect(quote2!.text.endsWith('我的评价：所以要跟向导进。')).toBe(true)
    // 冒号那句带着公式：卡的种类按公式算，开头那句单独记下来
    expect(lead!.text.slice(0, lead!.lead)).toBe('公式如下：')
    expect(b.total).toBe(9)
  })

  it('微信读书同步来的书摘：引文下面挂着的「微信读书的想法：」「我的评价：」（一段接一段）和引文一张卡，挪的时候一起走；没挂在引文下面的段落、不带冒号的「微信读书的想法」不算', () => {
    const t = [
      '---',
      '类型: 书摘',
      'bookId: 3300064831',
      '---',
      '# 趣说明朝276年',
      '',
      '## 3 作死小能手朱高煦',
      '',
      '> 接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征。',
      '',
      '微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。',
      '',
      '我的评价：先动手的人说了算。',
      '',
      '> 见面后，叔侄俩开聊。',
      '',
      '微信读书的想法 不带冒号的不算',
      '',
      '我自己的想法：这一家子打架都这么接地气',
      '',
      '## 4 来自亲爹的愤怒',
      '',
      '> 永乐皇帝朱棣去世以后，他的大儿子朱高炽当了皇帝。',
      '',
      '**我的评价**：加粗的标签也认',
      '',
    ].join('\n')
    const b = splitDoc(t)
    expect(cardsOf(t)).toEqual([
      ['3 作死小能手朱高煦', ['quote', 'quote', 'text', 'text']],
      ['4 来自亲爹的愤怒', ['quote']],
    ])
    const first = b.columns[0]!.cards[0]!
    expect(first.text).toBe('> 接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征。\n\n微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。\n\n我的评价：先动手的人说了算。')
    expect(b.columns[1]!.cards[0]!.text.endsWith('**我的评价**：加粗的标签也认')).toBe(true)
    // 挪进下一章：引文和挂着的两段一起走，别的字一个不动
    const out = moveUnit(t, first, b.columns[1]!, null)
    expect(out.length).toBe(t.length)
    expect(out).toContain('## 4 来自亲爹的愤怒\n\n> 永乐皇帝朱棣去世以后，他的大儿子朱高炽当了皇帝。\n\n**我的评价**：加粗的标签也认\n\n> 接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征。\n\n微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。\n\n我的评价：先动手的人说了算。\n')
    expect(cardsOf(out)).toEqual([
      ['3 作死小能手朱高煦', ['quote', 'text', 'text']],
      ['4 来自亲爹的愤怒', ['quote', 'quote']],
    ])
  })

  it('问过 AI 的一节用 [!ai] 写讲通的讲法（新写法）也是问答卡', () => {
    const t = '# 笔记\n\n## 第 5 页 · 旋转矩阵\n[第 5 页](a.pdf#page=5) · 10:20\n\n> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 5 页\n> 先看图。\n\n[完整对话 · 1 轮](../c.md)\n'
    expect(cardsOf(t)).toEqual([['第 5 页 · 旋转矩阵', ['ask']]])
  })

  it('用 # 分节的文档：# 就是列', () => {
    expect(cardsOf('# 一\n\n甲\n\n# 二\n\n乙\n')).toEqual([
      ['一', ['text']],
      ['二', ['text']],
    ])
  })

  it('336 段的长文档：12 节每节 28 段，切得出、一张不漏', () => {
    const long = '# 全学期\n\n' + Array.from({ length: 12 }, (_, s) => `## 第 ${s + 1} 讲\n\n` + Array.from({ length: 28 }, (_, p) => `第 ${s + 1} 讲第 ${p + 1} 段。`).join('\n\n')).join('\n\n') + '\n'
    const b = splitDoc(long)
    expect(b.columns).toHaveLength(12)
    expect(b.total).toBe(336)
    expect(b.columns.every((c) => c.cards.length === 28)).toBe(true)
  })
})

describe('文档切到白板：写回', () => {
  it('拖进别的列：文档里这段也挪进那一节，别的字一个不动', () => {
    const b = splitDoc(TRAVEL)
    const quote = b.columns[0]!.cards[2]!
    const out = moveUnit(TRAVEL, quote, b.columns[1]!, null)
    expect(out).toBe(TRAVEL.replace('> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n\n', '') + '\n> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n')
    expect(cardsOf(out)).toEqual([
      ['出发前', ['todo', 'images']],
      ['路线', ['video', 'text', 'quote']],
    ])
    // 同一列里往上挪：插到这张前面
    const b2 = splitDoc(TRAVEL)
    const up = moveUnit(TRAVEL, b2.columns[0]!.cards[2]!, b2.columns[0]!, b2.columns[0]!.cards[0]!)
    expect(cardsOf(up)[0]).toEqual(['出发前', ['quote', 'todo', 'images']])
    expect(up.length).toBe(TRAVEL.length)
  })

  it('「问过 AI」那一列不能往里放', () => {
    const b = splitDoc(LECTURE)
    expect(() => moveUnit(LECTURE, b.columns[1]!.cards[0]!, b.columns[2]!, null)).toThrow('问过 AI')
  })

  it('拖到空白处：只在这段前面多一行位置，正文顺序不变；它在白板上单独摆，记得在哪一节；再拖改坐标；摆回原样去掉', () => {
    const b = splitDoc(TRAVEL)
    const out = placeUnit(TRAVEL, b.columns[0]!.cards[2]!, 900, 120.4)
    expect(out).toBe(TRAVEL.replace('> 冰岛的天气', '<!-- card id=d1 x=900 y=120 -->\n> 冰岛的天气'))
    const p = splitDoc(out)
    expect(p.columns[0]!.cards.map((u) => u.kind)).toEqual(['todo', 'images'])
    expect(p.placed).toHaveLength(1)
    expect(p.placed[0]).toMatchObject({ kind: 'quote', section: '出发前', place: { id: 'd1', x: 900, y: 120 } })
    const moved = placeUnit(out, p.placed[0]!, 40, 60)
    expect(moved).toBe(TRAVEL.replace('> 冰岛的天气', '<!-- card id=d1 x=40 y=60 -->\n> 冰岛的天气'))
    expect(unplaceUnit(moved, splitDoc(moved).placed[0]!)).toBe(TRAVEL)
    expect(resetLayout(moved)).toBe(TRAVEL)
    // 拖出来的卡再拖进列：位置行一起拿掉，正文挪过去
    const back = moveUnit(moved, splitDoc(moved).placed[0]!, splitDoc(moved).columns[1]!, null)
    expect(back).not.toContain('<!-- card')
    expect(cardsOf(back)[1]).toEqual(['路线', ['video', 'text', 'quote']])
  })

  it('工具板、收件箱拖上来的新卡：放进列就插进那一节的落点，放在空白处就加在文末带一行位置；新列是新的一节；改列名只改标题那行', () => {
    const b = splitDoc(TRAVEL)
    // 放进「出发前」这一节、引文前面
    const a = insertInColumn(TRAVEL, b.columns[0]!, b.columns[0]!.cards[2]!, '- [ ] 换钱')
    expect(a).toBe(TRAVEL.replace('> 冰岛的天气', '- [ ] 换钱\n\n> 冰岛的天气'))
    // 放在这一节末尾
    const end = insertInColumn(TRAVEL, b.columns[1]!, null, '新的一段')
    expect(end).toBe(TRAVEL.replace(/\n$/, '') + '\n\n新的一段\n')
    expect(() => insertInColumn(LECTURE, splitDoc(LECTURE).columns[2]!, null, 'x')).toThrow('问过 AI')
    // 空白处：文末，一行位置只管它
    const placed = appendPlaced(TRAVEL, '记得带转换插头', 320.6, 40)
    expect(placed).toBe(TRAVEL + '\n<!-- card id=d1 x=321 y=40 -->\n记得带转换插头\n')
    const p = splitDoc(placed)
    expect(p.placed.map((u) => [u.text, u.section])).toEqual([['记得带转换插头', '路线']])
    expect(p.columns[1]!.cards.map((u) => u.kind)).toEqual(['video', 'text'])
    // 新的一列：插在「路线」前面；没给就在文末；级别跟着文档
    const col = addSection(TRAVEL, '新的列', b.columns[1]!, b.level)
    expect(splitDoc(col).columns.map((c) => c.title)).toEqual(['出发前', '新的列', '路线'])
    expect(col).toBe(TRAVEL.replace('## 路线', '## 新的列\n\n## 路线'))
    expect(splitDoc(addSection(TRAVEL, '预算', null, 2)).columns.map((c) => c.title)).toEqual(['出发前', '路线', '预算'])
    expect(splitDoc('# 一\n\n甲\n\n# 二\n\n乙\n').level).toBe(1)
    // 改列名：只换标题那行的字
    expect(renameColumn(TRAVEL, b.columns[1]!, '怎么走')).toBe(TRAVEL.replace('## 路线', '## 怎么走'))
    // 空的不写
    expect(insertInColumn(TRAVEL, b.columns[0]!, null, '  \n')).toBe(TRAVEL)
    expect(appendPlaced(TRAVEL, '', 1, 1)).toBe(TRAVEL)
  })

  it('文档里的位置行只管后面那一张卡（后面的段落不会被吞进去）', () => {
    const t = '## 一\n\n<!-- card id=d1 x=10 y=20 -->\n甲\n\n乙\n'
    const b = splitDoc(t)
    expect(b.placed.map((u) => u.text)).toEqual(['甲'])
    expect(b.columns[0]!.cards.map((u) => u.text)).toEqual(['乙'])
  })
})

describe('白板就是这篇文档（2026-11-21 方向 A）：编号行、列的位置、连线、删卡、复制、挪列', () => {
  const B = `---
type: board
links:
  - d1 -> k1
---
# 冰岛

<!-- card id=d1 x=400 y=80 -->
空白处的一张。

## 出发前

**装备**
- [ ] 防水外套
- [x] 手套

<!-- card id=k1 ai=2026-11-21 -->
连线那一头，也是 AI 总结的。

<!-- column id=c7 x=900 y=300 -->
## 住哪

维克两晚。
`
  it('认得出：只记编号的一行（卡还在列里）、列的位置行、一段字下面紧跟着的待办是一张卡', () => {
    const b = splitDoc(B)
    expect(b.placed.map((u) => [u.place!.id, u.text])).toEqual([['d1', '空白处的一张。']])
    const go = b.columns.find((c) => c.title === '出发前')!
    expect(go.cards.map((u) => u.kind)).toEqual(['todo', 'text'])
    expect(go.cards[0]!.lead).toBe('**装备**'.length)
    expect(go.cards[1]!.tag).toMatchObject({ id: 'k1' })
    expect(go.cards[1]!.attrs).toEqual({ ai: '2026-11-21' })
    const stay = b.columns.find((c) => c.title === '住哪')!
    expect(stay.place).toMatchObject({ id: 'c7', x: 900, y: 300 })
    expect(stay.cards.map((u) => u.text)).toEqual(['维克两晚。'])
    // 卡的名字：有编号用编号，没有用字的签名（字不变名字不变）
    const keys = unitKeys(b)
    expect(keys.get(b.placed[0]!)).toBe('d1')
    expect(keys.get(go.cards[1]!)).toBe('k1')
    expect(keys.get(go.cards[0]!)).toMatch(/^k[0-9a-z]{5}$/)
    const moved = moveUnit(B, go.cards[0]!, stay, null)
    const again = splitDoc(moved)
    expect(unitKeys(again).get(again.columns.find((c) => c.title === '住哪')!.cards[1]!)).toBe(keys.get(go.cards[0]!))
  })

  it('连线的一头拖进列：位置行换成只记编号的一行；编号行的卡拖到空白处：编号不变；摆回原样留下编号行、去掉列的位置', () => {
    const b = splitDoc(B)
    const into = moveUnit(B, b.placed[0]!, b.columns.find((c) => c.title === '住哪')!, null)
    expect(into).toContain('维克两晚。\n\n<!-- card id=d1 -->\n空白处的一张。\n')
    expect(into).not.toContain('x=400')
    const k1 = b.columns.find((c) => c.title === '出发前')!.cards[1]!
    const out = placeUnit(B, k1, 30, 40)
    expect(out).toContain('<!-- card id=k1 x=30 y=40 ai=2026-11-21 -->\n连线那一头')
    expect(splitDoc(out).placed.map((u) => u.place!.id)).toEqual(['d1', 'k1'])
    const reset = resetLayout(out)
    expect(reset).toContain('<!-- card id=d1 -->\n空白处的一张。')
    expect(reset).toContain('<!-- card id=k1 ai=2026-11-21 -->\n连线那一头')
    expect(reset).not.toContain('<!-- column')
    expect(splitDoc(reset).placed).toEqual([])
    // 不是连线一头、也没有别的属性的：位置行整行去掉
    const one = '## 一\n\n<!-- card id=d3 x=1 y=2 -->\n甲\n'
    expect(unplaceUnit(one, splitDoc(one).placed[0]!)).toBe('## 一\n\n甲\n')
  })

  it('删一张卡：这段连编号行一起删，连着它的线也去掉；复制一份：紧跟在后面，空白处的换新编号错开 24', () => {
    const b = splitDoc(B)
    const k1 = b.columns.find((c) => c.title === '出发前')!.cards[1]!
    const gone = removeUnit(B, k1)
    expect(gone).not.toContain('连线那一头')
    expect(gone).not.toContain('k1')
    expect(linksOf(gone)).toEqual([])
    expect(gone).not.toContain('links:')
    expect(splitDoc(gone).columns.find((c) => c.title === '出发前')!.cards).toHaveLength(1)
    const dup = duplicateUnit(B, b.placed[0]!)
    expect(dup).toContain('<!-- card id=d1 x=400 y=80 -->\n空白处的一张。\n\n<!-- card id=d2 x=424 y=104 -->\n空白处的一张。\n\n## 出发前')
    const dup2 = duplicateUnit(B, b.columns.find((c) => c.title === '住哪')!.cards[0]!)
    expect(dup2.endsWith('维克两晚。\n\n维克两晚。\n')).toBe(true)
  })

  it('连线：没编号的卡前面加一行只记编号的，frontmatter 里多一条；去掉一条线；没有 frontmatter 就加一个', () => {
    const b = splitDoc(B)
    const todo = b.columns.find((c) => c.title === '出发前')!.cards[0]!
    const stay = b.columns.find((c) => c.title === '住哪')!.cards[0]!
    const r = linkUnits(B, todo, stay)
    expect(r.text).toContain(`<!-- card id=${r.from} -->\n**装备**`)
    expect(r.text).toContain(`<!-- card id=${r.to} -->\n维克两晚。`)
    expect(linksOf(r.text)).toEqual([
      { from: 'd1', to: 'k1' },
      { from: r.from, to: r.to },
    ])
    expect(r.from).not.toBe(r.to)
    expect(splitDoc(r.text).columns.find((c) => c.title === '出发前')!.cards[0]!.kind).toBe('todo')
    expect(linksOf(unlink(r.text, 'd1', 'k1'))).toEqual([{ from: r.from, to: r.to }])
    const plain = '## 一\n\n甲\n\n乙\n'
    const p = splitDoc(plain)
    const l = linkUnits(plain, p.columns[0]!.cards[0]!, p.columns[0]!.cards[1]!)
    expect(l.text).toBe(`---\nlinks:\n  - ${l.from} -> ${l.to}\n---\n## 一\n\n<!-- card id=${l.from} -->\n甲\n\n<!-- card id=${l.to} -->\n乙\n`)
  })

  it('列：摆到空白处多一行列的位置；拖回一排里插在别的列前面，位置行去掉；删除列只删标题那一行，卡并进上一节', () => {
    const b = splitDoc(B)
    const go = b.columns.find((c) => c.title === '出发前')!
    const stay = b.columns.find((c) => c.title === '住哪')!
    expect(placeColumn(B, go, 120.4, 600)).toContain('<!-- column id=c1 x=120 y=600 -->\n## 出发前')
    expect(placeColumn(B, stay, 10, 20)).toContain('<!-- column id=c7 x=10 y=20 -->\n## 住哪')
    // 住哪拖到出发前前面：整节挪过去，位置行去掉
    const moved = moveColumn(B, stay, go)
    expect(splitDoc(moved).columns.map((c) => [c.title, !!c.place])).toEqual([
      [null, false],
      ['住哪', false],
      ['出发前', false],
    ])
    expect(moved).not.toContain('<!-- column')
    expect(moved).toContain('## 住哪\n\n维克两晚。\n\n## 出发前')
    // 删除「住哪」这一列：标题和位置行去掉，「维克两晚。」并进「出发前」
    const removed = removeColumn(B, stay)
    expect(removed).not.toContain('住哪')
    expect(removed).not.toContain('<!-- column')
    expect(splitDoc(removed).columns.find((c) => c.title === '出发前')!.cards.map((u) => u.text)).toContain('维克两晚。')
  })
})

describe('公式卡（task-o48fa：和文档编辑器同一个认法）', () => {
  it('\\[…\\] 单独一段也是公式卡；一段字里夹着行内 $x$、写着钱数 $$5 的不是', () => {
    const b = splitDoc('# 公式\n\n## 一节\n\n\\[\na^2+b^2=c^2\n\\]\n\n向量 $\\mathbf{x}$ 的第 $i$ 个元素\n\n$$5 买了 $$6 的\n')
    expect(b.columns[0]!.cards.map((u) => u.kind)).toEqual(['math', 'text', 'text'])
  })
})

describe('白板上就地改着一张卡时外面改了这篇：找回正在改的那一段（findUnitAgain）', () => {
  const BASE = '# 外改\n\n## 一\n\n开头一段。\n\n外面加的一段。\n\n## 二\n\n第二段卡片。\n'
  const unitOf = (text: string, t: string) => splitDoc(text).columns.flatMap((c) => c.cards).find((u) => u.text === t)!

  it('外面改的是别处（前面、后面）：字一个没变，找到的是它在新全文里的位置', () => {
    const u = unitOf(BASE, '外面加的一段。')
    const before = BASE.replace('开头一段。', '开头一段，前面多了几个字。')
    expect(findUnitAgain(u, BASE, before)).toMatchObject({ same: true, unit: { text: '外面加的一段。', from: u.from + 8 } })
    const after = BASE.replace('第二段卡片。', '第二段卡片（手机）。')
    expect(findUnitAgain(u, BASE, after)).toMatchObject({ same: true, unit: { from: u.from } })
  })

  it('外面改了这一段：不是 same，找到改过的那段；外面同时改了别处也不认错', () => {
    const u = unitOf(BASE, '外面加的一段。')
    const now = BASE.replace('外面加的一段。', '外面加的一段，手机上又补了半句。').replace('第二段卡片。', '第二段卡片（手机）。')
    expect(findUnitAgain(u, BASE, now)).toMatchObject({ same: false, unit: { text: '外面加的一段，手机上又补了半句。' } })
  })

  it('外面把这一段删了（同时改了前面一段）：gone，位置在原来那里（后面那一节前面），不认成前面那段', () => {
    const u = unitOf(BASE, '外面加的一段。')
    const now = BASE.replace('外面加的一段。\n\n', '').replace('开头一段。', '开头一段（外面）。')
    const r = findUnitAgain(u, BASE, now)
    expect('gone' in r).toBe(true)
    if ('gone' in r) expect(now.slice(r.gone).startsWith('## 二')).toBe(true)
  })

  it('空白处的卡外面只挪了位置：字没变，same；前面又多了一段一样的字，还是按位置认空白处那张', () => {
    const placed = '## 一\n\n待办\n\n<!-- card id=d1 x=10 y=20 -->\n待办\n'
    const u = splitDoc(placed).placed[0]!
    const moved = placed.replace('x=10 y=20', 'x=300 y=400')
    expect(findUnitAgain(u, placed, moved)).toMatchObject({ same: true, unit: { text: '待办', place: { x: 300, y: 400 } } })
    const more = moved.replace('## 一\n\n', '## 一\n\n待办\n\n')
    expect(findUnitAgain(u, placed, more)).toMatchObject({ same: true, unit: { place: { id: 'd1' } } })
  })
})

describe('AI 讲解下面挂着的旁支（task-4edsc）', () => {
  it('[!side] 和上面那块 [!ai] 讲解是一张卡；别的引用、提示块照旧各是各的', () => {
    const t = '## 讲\n\n> [!ai] AI 讲解 · Claude Code\n> 一句话。\n\n> [!side] 问\n> > 一句话。\n>\n> 答\n\n> [!side] 接着问\n>\n> 又答\n\n> 一段引文\n'
    const units = splitDoc(t).columns[0]!.cards
    expect(units.map((u) => u.kind)).toEqual(['callout', 'quote'])
    expect(units[0]!.text).toBe('> [!ai] AI 讲解 · Claude Code\n> 一句话。\n\n> [!side] 问\n> > 一句话。\n>\n> 答\n\n> [!side] 接着问\n>\n> 又答')
    // 没有 [!ai] 在前面的 [!side]（读 PDF 笔记里挂在回答后面的）不并
    expect(splitDoc('## 讲\n\n回答\n\n> [!side] 问\n>\n> 答\n').columns[0]!.cards.map((u) => u.kind)).toEqual(['text', 'callout'])
  })
})

/** 混排的一篇（2026-11-24 用户批的「切白板的样子」，7b、7c）：开头自己的字、两处网页剪藏、两问新写法、自己打的字、一条旁支 */
const MIXED = `# 卷积

## 读书

先看 6.1 再看 6.2。

> 首先，多层感知机的输入是二维图像。
—— [6.1.2 多层感知机的限制 · 动手学深度学习](https://zh.d2l.ai/why-conv.html#:~:text=a)

### ①这部分看不懂

> ① 四阶权重张量
> —— [6.1.2 多层感知机的限制 · 动手学深度学习](https://zh.d2l.ai/why-conv.html#:~:text=b)

![我框的|180](附件/卷积/截图%201.png)

> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=file%3Aa.md&msg=1)
> 每个隐藏像素都连每个输入像素。

我的理解：参数太多。

> 6.1.2.1. 平移不变性
—— [6.1.2.1 平移不变性 · 动手学深度学习](https://zh.d2l.ai/why-conv.html#:~:text=c)

> 严格来说，卷积层是个错误的叫法。
—— [6.2.1. 互相关运算 — 动手学深度学习 2.0.0 documentation](https://zh.d2l.ai/conv-layer.html)

### 为什么输出变小了

> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=file%3Aa.md&msg=2)
> 核不能伸出边界。

#### 旁支：补零呢？

> 不能伸出边界
> —— 在「为什么输出变小了」的回答里

> [!ai] 旁支回答 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=file%3Aa.md&msg=3)
> 补零以后一样大。

最后补一句。

## 别的

一段。
`

describe('混排的一节（7b、7c）', () => {
  it('按「##」一列、按剪藏来源分小列（6.1.2.1 跟着 6.1.2），问的 ### 不切列；问答成组，旁支挂在组里；卡都是原文里的一截', () => {
    const b = splitDoc(MIXED)
    expect(b.columns.map((c) => [c.title, c.slice ? [c.slice.section, c.slice.first] : null, !!c.head])).toEqual([
      ['读书', ['读书', true], true],
      ['6.1.2 多层感知机的限制', ['读书', false], false],
      ['6.2.1 互相关运算', ['读书', false], false],
      ['别的', null, true],
    ])
    const [lead, c1, c2] = b.columns
    expect(lead!.cards.map((u) => u.text)).toEqual(['先看 6.1 再看 6.2。'])
    expect(c1!.cards.map((u) => u.kind + (u.group ? `(${u.group.map((g) => g.ask!.part).join(',')})` : ''))).toEqual(['quote', 'ask(q,qa)', 'text', 'quote'])
    expect(c2!.cards.map((u) => u.kind + (u.group ? `(${u.group.map((g) => g.ask!.part).join(',')})` : ''))).toEqual(['quote', 'ask(q,qa,sideq,qa)', 'text'])
    const g = c1!.cards[1]!
    expect(g.text.startsWith('### ①这部分看不懂')).toBe(true)
    expect(g.group![0]!.text).toBe('### ①这部分看不懂\n\n> ① 四阶权重张量\n> —— [6.1.2 多层感知机的限制 · 动手学深度学习](https://zh.d2l.ai/why-conv.html#:~:text=b)\n\n![我框的|180](附件/卷积/截图%201.png)')
    expect(g.group![1]!.text).toMatch(/^> \[!ai\] AI 回答[\s\S]*每个隐藏像素都连每个输入像素。$/)
    for (const c of b.columns) for (const u of c.cards) {
      expect(MIXED.slice(u.from, u.to)).toBe(u.text)
      for (const x of u.group ?? []) expect(MIXED.slice(x.from, x.to)).toBe(x.text)
    }
    // 拖进小列（null）：插在那一小列最后一张后面；挪整节按整节的末尾
    expect(c1!.end).toBe(c1!.cards[3]!.to)
    const moved = moveColumn(MIXED, lead!, null)
    expect(moved.indexOf('## 别的')).toBeLessThan(moved.indexOf('## 读书'))
    expect(moved.indexOf('最后补一句')).toBeGreaterThan(moved.indexOf('## 读书'))
    // 每张卡（组和组里的）都有名字
    const keys = unitKeys(b)
    expect(keys.size).toBe(b.columns.flatMap((c) => c.cards).reduce((n, u) => n + 1 + (u.group?.length ?? 0), 0))
  })

  it('整组拖到空白处：问的标题前面一行位置，组整个摆出去；切回来去掉那一行就是原文', () => {
    const b = splitDoc(MIXED)
    const g = b.columns[2]!.cards[1]!
    const out = placeUnit(MIXED, g, 900, 40)
    expect(out.replace(/<!-- card id=d1 x=900 y=40 -->\n/, '')).toBe(MIXED)
    const nb = splitDoc(out)
    expect(nb.placed.map((u) => u.group?.map((x) => x.ask!.part))).toEqual([['q', 'qa', 'sideq', 'qa']])
    // 小列里只剩一处来源（6.2.1 的剪藏还在）：照旧分小列
    expect(nb.columns.filter((c) => c.slice).length).toBe(3)
  })

  it('没有问答的一节剪了几处网页：照旧一节一列（小列只给混排的节）；全是问答的配对笔记照旧一问一列', () => {
    const plain = MIXED.replace(/### ①这部分看不懂[\s\S]*?我的理解：参数太多。\n\n/, '').replace(/### 为什么输出变小了[\s\S]*?补零以后一样大。\n\n/, '')
    expect(splitDoc(plain).columns.map((c) => c.title)).toEqual(['读书', '别的'])
  })
})

describe('配对笔记白板：拖进来的卡落在问答一节里（r147）', () => {
  const PAIR = `---
来源: "[[alr.pdf]]"
---

# alr 笔记

## 第 1 页 · Impact of a simultaneous reduction

### gz

> Almost one-third of global fish stocks are currently overfished
> —— [第 1 页](alr.pdf#page=1&rect=0.071,0.652,0.415,0.17)

> [!ai] AI 回答 · Claude Code · [回到 AI 对话](canvas-notes://chat?key=a&msg=1&th=t1)
> 这段讲的是鱼被捞得太狠了。

#### 旁支：翻译成德语

> fully fished：正好捞到 MSY。
> —— 在「用高中生能听懂的方式讲解Almost one-third of global fish stocks are currently overfished … 」的回答里

> [!ai] 旁支回答 · Claude Code · [回到 AI 对话](canvas-notes://chat?key=a&msg=2&th=t1)
> - **fully fished**: genau bis zum MSY befischt.

<!-- card id=d1 x=383 y=2075 -->
![[过度捕鱼]]

## 标题1
`
  it('位置行和嵌入是空白处的一张嵌入卡，不当那一问补的字；那一问照旧一问一列', () => {
    const b = splitDoc(PAIR)
    const ask = b.columns.find((c) => c.ask)!
    expect(ask.cards.map((u) => u.ask?.part)).toEqual(['top', 'qa', 'side'])
    expect(ask.cards.some((u) => u.text.includes('<!-- card'))).toBe(false)
    expect(b.placed).toHaveLength(1)
    expect(b.placed[0]).toMatchObject({ kind: 'embed', text: '![[过度捕鱼]]', place: { id: 'd1', x: 383, y: 2075 } })
  })
  it('拖它：文件只改位置那一行；再拖一篇进来（加在文末）也是空白处的卡', () => {
    const b = splitDoc(PAIR)
    const moved = placeUnit(PAIR, b.placed[0]!, 640, 120)
    expect(moved).toBe(PAIR.replace('<!-- card id=d1 x=383 y=2075 -->', '<!-- card id=d1 x=640 y=120 -->'))
    // 只有问答一节、它在文末：收件箱拖进来的加在这一节的字后面
    const tail = PAIR.slice(0, PAIR.indexOf('## 标题1')).trimEnd() + '\n'
    const two = appendPlaced(tail, '![[另一篇]]', 100, 200)
    const b2 = splitDoc(two)
    expect(b2.placed.map((u) => [u.text, u.place!.id, u.place!.x])).toEqual([['![[过度捕鱼]]', 'd1', 383], ['![[另一篇]]', 'd2', 100]])
    expect(b2.columns.find((c) => c.ask)!.cards.map((u) => u.ask?.part)).toEqual(['top', 'qa', 'side'])
  })
  it('补的字和拖进来的卡挨着：补的字照旧跟着那一问，卡单独出来', () => {
    const t = PAIR.replace('<!-- card id=d1', '我补一句。\n\n<!-- card id=d1')
    const ask = splitDoc(t).columns.find((c) => c.ask)!
    expect(ask.cards.map((u) => [u.ask?.part, u.text])).toEqual([
      ['top', expect.any(String)],
      ['qa', expect.any(String)],
      ['side', expect.any(String)],
      ['more', '我补一句。'],
    ])
    expect(splitDoc(t).placed.map((u) => u.text)).toEqual(['![[过度捕鱼]]'])
  })
  it('问答列里的一张不能单独挪到空白处（不往那一问中间插位置行）', () => {
    const ask = splitDoc(PAIR).columns.find((c) => c.ask)!
    for (const u of ask.cards) expect(() => placeUnit(PAIR, u, 10, 10)).toThrow(/问过 AI/)
  })
})
