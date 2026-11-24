// 梦游 Wiki 化（task-h7oy8，设计页 24-梦游底层 W.1、W.5）：B 那头的段、节、块编号、标题改名
import { describe, expect, it } from 'vitest'
import { addBlockId, anchorLines, blockText, findHeading, headingKey, headingParts, headingRenames, newBlockId, onlyBlockIdsAdded, outline, relinkHeading } from '../src'

const B = `---
tags: [课]
---
# 解剖02-练胸

开头一段。

## 九、动作评述④：双杠臂屈伸（多关节） 52:56

双杠臂屈伸是多关节动作。
第二行接着。

- 上斜哑铃卧推（辅助）：角度 30 度。
  下面缩进的一行算这一项。
- 双杠臂屈伸：退阶用辅助机。 ^dida-1

> 海德堡注脚：1689 年法军攻破城堡。
> 英文那一半。

| 动作 | 组 |
| --- | --- |
^tbl1

\`\`\`
## 代码里的不算标题
\`\`\`
`

describe('outline', () => {
  it('标题、段、列表项一项一段、引用一段、表格一段，代码块不算；行尾已有的块编号认出来', () => {
    const { headings, passages } = outline(B)
    expect(headings.map((h) => h.text)).toEqual(['解剖02-练胸', '九、动作评述④：双杠臂屈伸（多关节） 52:56'])
    expect(passages.map((p) => [p.kind, p.line, p.end, p.heading, p.id ?? ''])).toEqual([
      ['para', 5, 5, 0, ''],
      ['para', 9, 10, 1, ''],
      ['item', 12, 13, 1, ''],
      ['item', 14, 14, 1, 'dida-1'],
      ['quote', 16, 17, 1, ''],
      ['table', 19, 20, 1, 'tbl1'],
    ])
  })
})

describe('标题', () => {
  it('不管空白、标点、全角半角比；能认的几截', () => {
    expect(headingKey('九、动作评述④：双杠臂屈伸（多关节） 52:56')).toBe(headingKey('九 动作评述④ 双杠臂屈伸(多关节)52：56'))
    expect(findHeading(B, '九 动作评述④ 双杠臂屈伸(多关节)52:56')).toBe(7)
    expect(findHeading(B, '上一级#九、动作评述④：双杠臂屈伸（多关节） 52:56')).toBe(7)
    expect(findHeading(B, '没有这一节')).toBe(-1)
    expect(headingParts('九、动作评述④：双杠臂屈伸（多关节） 52:56')).toEqual(['动作评述', '双杠臂屈伸', '多关节'])
  })
  it('⌘点 [[B#标题]] 时标题少了空格、标点不一样也跳得到', () => {
    expect(anchorLines(B, { heading: '九、动作评述④:双杠臂屈伸(多关节)52:56' })).toEqual({ from: 8, to: 11 })
  })
  it('改名：同一个位置的标题字变了才算；增删标题不猜', () => {
    const after = B.replace('## 九、动作评述④：双杠臂屈伸（多关节） 52:56', '## 九、双杠臂屈伸')
    expect(headingRenames(B, after)).toEqual([['九、动作评述④：双杠臂屈伸（多关节） 52:56', '九、双杠臂屈伸']])
    expect(headingRenames(B, B.replace('开头一段。', '## 新加的\n\n开头一段。'))).toEqual([])
    expect(headingRenames(B, B)).toEqual([])
  })
  it('全库里指着旧标题的链接换成新标题：别名、嵌入、多级锚点、自己里的 [[#旧]]；块链接、别的篇不动', () => {
    const names = new Set(['解剖02-练胸', '课/解剖02-练胸'])
    const a = '练了[[解剖02-练胸#九、动作评述④：双杠臂屈伸（多关节） 52:56|双杠臂屈伸]]，见 ![[课/解剖02-练胸#九 动作评述④ 双杠臂屈伸(多关节) 52:56]]、[[解剖02-练胸#^abc123|一段]]、[[别的#九、动作评述④：双杠臂屈伸（多关节） 52:56]]'
    expect(relinkHeading(a, names, '九、动作评述④：双杠臂屈伸（多关节） 52:56', '九、双杠臂屈伸')).toBe(
      '练了[[解剖02-练胸#九、双杠臂屈伸|双杠臂屈伸]]，见 ![[课/解剖02-练胸#九、双杠臂屈伸]]、[[解剖02-练胸#^abc123|一段]]、[[别的#九、动作评述④：双杠臂屈伸（多关节） 52:56]]',
    )
    expect(relinkHeading('[[#旧标题]] 和 [[解剖02-练胸#一#旧标题]]', names, '旧标题', '新标题', true)).toBe('[[#新标题]] 和 [[解剖02-练胸#一#新标题]]')
    expect(relinkHeading('[[#旧标题]]', names, '旧标题', '新标题', false)).toBe('[[#旧标题]]')
  })
})

describe('块编号', () => {
  it('加在那一段最后一行行尾；别的字不动；已经有的不再加；收下前核对只多了块编号', () => {
    const id = newBlockId(B, () => 0.5)
    expect(id).toMatch(/^[a-z][a-z0-9]{5}$/)
    const after = addBlockId(B, 17, id)
    expect(after.split('\n')[17]).toBe(`> 英文那一半。 ^${id}`)
    expect(onlyBlockIdsAdded(B, after)).toBe(true)
    expect(addBlockId(B, 14, 'zzzzzz')).toBe(B)
    expect(onlyBlockIdsAdded(B, after.replace('开头一段', '开头两段'))).toBe(false)
    expect(onlyBlockIdsAdded('a  \nb', 'a  ^abcdef\nb')).toBe(true)
    expect(onlyBlockIdsAdded('a\nb', 'a^abcdef\nb')).toBe(false)
    expect(blockText(after, id)).toEqual({ line: 16, end: 17, text: '> 海德堡注脚：1689 年法军攻破城堡。\n> 英文那一半。' })
    expect(blockText(B, 'dida-1')!.text).toBe('- 双杠臂屈伸：退阶用辅助机。')
  })
})
