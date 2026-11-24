/**
 * AI 往文档里新加的内容一律包成 [!ai] 块（task-dtc34）：补包（这一轮结束对比改过的 md）、插进文档、「标成 AI 写的」「变成我的字」、「改过」。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  aiBlock,
  aiCallout,
  calloutWords,
  parseChatLink,
  aiBlockAt,
  aiWroteHead,
  blockKeys,
  chatLink,
  EN_CALLOUT_WORDS,
  isEdited,
  markEdited,
  parseAiCalloutHead,
  setCalloutWords,
  unwrapAiBlock,
  wrapInsert,
  wrapNewBlocks,
  wrapRange,
  ZH_CALLOUT_WORDS,
} from '../src'

const BY = { by: 'Claude Code · Opus 5.5' }

/** 照用户截图那篇书摘（img1）：第一章三段引文，AI 在文末加了「## 评价」和两段 */
const BOOK = `---
类型: 书摘
作者: 哈珀·李
---
# 杀死一只知更鸟（同名电影原著）

## 第一章

> 我哥哥杰姆快满十三岁的时候，胳膊肘遭受了一次严重的骨折。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)

> 等过了一些年，日子长到足够让当事人回首往事时，我们有时候会谈论导致他受伤的那些过往事件。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)
`
const REVIEW = `
## 评价

开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说"过了一些年"兄妹俩回头谈起它。

"事情就开始了"这一句把源头指向迪尔和怪人拉德利，先抛一个悬念。
`

afterEach(() => setCalloutWords(ZH_CALLOUT_WORDS))

describe('补包：这一轮 AI 改完的一篇', () => {
  it('img1 那种：文末新加「## 评价」和两段，标题留在外面、两段包成一个 AI 块，原来的字一个字节不动', () => {
    const after = BOOK + REVIEW
    const r = wrapNewBlocks(BOOK, after, { ...BY, link: chatLink('note:阅读/杀死一只知更鸟.md', 12) })
    expect(r.wrapped).toBe(1)
    expect(r.text.startsWith(BOOK)).toBe(true)
    expect(r.text.slice(BOOK.length)).toBe(
      '\n## 评价\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5 · [回到 AI 对话](canvas-notes://chat?key=note%3A%E9%98%85%E8%AF%BB%2F%E6%9D%80%E6%AD%BB%E4%B8%80%E5%8F%AA%E7%9F%A5%E6%9B%B4%E9%B8%9F.md&msg=12)\n> 开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说"过了一些年"兄妹俩回头谈起它。\n>\n> "事情就开始了"这一句把源头指向迪尔和怪人拉德利，先抛一个悬念。\n',
    )
  })

  it('AI 已经自己包好了：不再包', () => {
    const after = BOOK + '\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 一段评价。\n'
    expect(wrapNewBlocks(BOOK, after, BY)).toEqual({ text: after, wrapped: 0 })
  })

  it('AI 改了用户原有的一段（接着写了半句、换了几个字）：不包，那是「改」', () => {
    const before = '# 周记\n\n这周主要在赶第5讲的作业。\n\n周三开始每天早上跑步。\n'
    const after = '# 周记\n\n这周主要在赶第5讲的作业，注意力机制那部分花了两个晚上。\n\n周三开始每天早上跑步。\n'
    expect(wrapNewBlocks(before, after, BY).wrapped).toBe(0)
    const reworded = '# 周记\n\n这周主要都在赶第五讲的作业。\n\n周三开始每天早上跑步。\n'
    expect(wrapNewBlocks(before, reworded, BY).wrapped).toBe(0)
    // 短句改几个字（两个字一组比只有 0.44 像）：一段换一段，照样是「改」
    expect(wrapNewBlocks('# 随手记\n\n一段字。\n', '# 随手记\n\n一段改过的字。\n', BY).wrapped).toBe(0)
  })

  it('改了一段、又在后面加了一段：只包新加的那段', () => {
    const before = '# 周记\n\n这周主要在赶第5讲的作业。\n\n周三开始跑步。\n'
    const after = '# 周记\n\n这周主要在赶第5讲的作业，很累。\n\n下周要把论文计划第一节写完，并约导师见一面。\n\n周三开始跑步。\n'
    const r = wrapNewBlocks(before, after, BY)
    expect(r.text).toBe('# 周记\n\n这周主要在赶第5讲的作业，很累。\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 下周要把论文计划第一节写完，并约导师见一面。\n\n周三开始跑步。\n')
  })

  it('整篇换掉、和原来不像：新的段落都包（标题照旧留外面）', () => {
    const before = '# 计划\n\n去冰岛。\n'
    const after = '# 计划\n\n去冰岛。\n\n## 第一天\n\n到雷克雅未克，租车。\n\n- 买电话卡\n- 换钱\n'
    expect(wrapNewBlocks(before, after, BY).text).toBe(
      '# 计划\n\n去冰岛。\n\n## 第一天\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 到雷克雅未克，租车。\n>\n> - 买电话卡\n> - 换钱\n',
    )
  })

  it('代码块、表格、公式块留在外面，前后的段落各包一块', () => {
    const before = '# 笔记\n\n原来的一段。\n'
    const after = '# 笔记\n\n原来的一段。\n\n先看代码：\n\n```python\nprint(1)\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\n就这样。\n'
    const r = wrapNewBlocks(before, after, BY)
    expect(r.wrapped).toBe(2)
    expect(r.text).toContain('> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 先看代码：\n\n```python\nprint(1)\n```')
    expect(r.text).toContain('$$\nx^2\n$$\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 就这样。\n')
  })

  it('新建的整篇、没改的、旧写法白板不包', () => {
    expect(wrapNewBlocks('', '# 新的\n\n一段。\n', BY).wrapped).toBe(0)
    expect(wrapNewBlocks(BOOK, BOOK, BY).wrapped).toBe(0)
    const board = '<!-- card id=a x=1 y=2 in=c w=200 -->\n卡\n'
    expect(wrapNewBlocks(board, board + '\n<!-- card id=b x=1 y=2 in=c w=200 -->\n新卡\n', BY).wrapped).toBe(0)
  })

  it('原有的引用里 AI 新加一段引用：套一层（> > ）', () => {
    const r = wrapNewBlocks('# a\n\n一段。\n', '# a\n\n一段。\n\n> 引一句别人的话。\n', BY)
    expect(r.text).toBe('# a\n\n一段。\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> > 引一句别人的话。\n')
  })

  it('挪了位置的块、排整齐只改了位置行的不包；白板看法里 AI 加的卡，位置行留在框外面', () => {
    const before = '# 计划\n\n## 这周\n\n买票。\n\n## 下周\n\n订酒店。\n'
    const moved = '# 计划\n\n## 这周\n\n买票。\n\n订酒店。\n\n## 下周\n'
    expect(wrapNewBlocks(before, moved, BY).wrapped).toBe(0)
    const placed = '# 计划\n\n## 这周\n\n<!-- card id=a1 x=40 y=80 -->\n买票。\n\n## 下周\n\n订酒店。\n'
    expect(wrapNewBlocks(before, placed, BY).wrapped).toBe(0)
    const card = before + '\n<!-- card id=k9 x=300 y=40 -->\n记得带转换插头。\n'
    expect(wrapNewBlocks(before, card, BY).text).toBe(before + '\n<!-- card id=k9 x=300 y=40 -->\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 记得带转换插头。\n')
  })

  it('白板（type: board）上一段一张卡：AI 加的几张卡各包各的，不并成一张；同一串列表还在一起', () => {
    const before = '---\ntype: board\n---\n# 旅行\n\n出发前先定住处\n'
    const after = before + '\n订机票\n\n订租车\n\n## 自测题\n\n1. 第一题\n2. 第二题\n'
    expect(wrapNewBlocks(before, after, BY).text).toBe(
      before +
        '\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 订机票\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 订租车\n\n## 自测题\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 1. 第一题\n> 2. 第二题\n',
    )
    expect(wrapInsert('一段。\n\n两段。', BY, true)).toBe('> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 一段。\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 两段。')
  })

  it('img2 那种：末尾新加「## 自测题」、编了号的十道题、「### 答案」和答案：标题留外面，题和答案各包一块', () => {
    const before = '# 学习笔记：动手学深度学习\n\n教材：《动手学深度学习》，PyTorch 版。\n'
    const qs = Array.from({ length: 10 }, (_, i) => `${i + 1}. 第 ${i + 1} 题？`).join('\n')
    const as = Array.from({ length: 10 }, (_, i) => `${i + 1}. 第 ${i + 1} 题的答案。`).join('\n')
    const after = `${before}\n## 自测题（第 1 章 – 2.3）\n\n${qs}\n\n### 答案\n\n${as}\n`
    const r = wrapNewBlocks(before, after, BY)
    expect(r.wrapped).toBe(2)
    expect(r.text).toContain('## 自测题（第 1 章 – 2.3）\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 1. 第 1 题？\n> 2. 第 2 题？')
    expect(r.text).toContain('### 答案\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 1. 第 1 题的答案。')
  })

  it('这一轮里用户自己在同一篇打的整段（skip 认出来的）不包', () => {
    const before = '# a\n\n第一段。\n'
    const after = '# a\n\n第一段。\n\n我自己刚打的一段。\n\nAI 加的一段。\n'
    const mine = blockKeys('# a\n\n第一段。\n\n我自己刚打的一段。\n')
    expect(wrapNewBlocks(before, after, BY, (k) => mine.has(k)).text).toBe('# a\n\n第一段。\n\n我自己刚打的一段。\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> AI 加的一段。\n')
  })

  it('中间插入：只动新加的那一截', () => {
    const before = '# a\n\n第一段。\n\n第三段。\n'
    const after = '# a\n\n第一段。\n\n第二段，AI 写的。\n\n第三段。\n'
    expect(wrapNewBlocks(before, after, BY).text).toBe('# a\n\n第一段。\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 第二段，AI 写的。\n\n第三段。\n')
  })
})

describe('插进文档、标成 AI 写的、变成我的字、改过', () => {
  it('插进去的一段：能包的包上，标题留外面，已经是 [!ai] 的不动', () => {
    expect(wrapInsert('## 评价\n\n一段。\n\n第二段。', BY)).toBe('## 评价\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 一段。\n>\n> 第二段。')
    const done = '> [!ai] AI 写的 · Codex\n> 一段。'
    expect(wrapInsert(done, BY)).toBe(done)
  })

  it('标成 AI 写的：选中碰到的几段包成「AI 写的 · 补标」，标题留外面；光标在一段里就包那一段', () => {
    const t = BOOK + REVIEW
    const from = t.indexOf('## 评价')
    const r = wrapRange(t, from, t.length)
    expect(r.wrapped).toBe(1)
    expect(r.text).toContain('## 评价\n\n> [!ai] AI 写的 · 补标\n> 开篇很克制')
    expect(r.text.startsWith(BOOK)).toBe(true)
    const at = t.indexOf('事情就开始了')
    expect(wrapRange(t, at, at).text).toContain('回头谈起它。\n\n> [!ai] AI 写的 · 补标\n> "事情就开始了"')
  })

  it('变成我的字：去掉框、正文去掉一层「> 」；aiBlockAt 找到光标所在的那块', () => {
    const block = aiBlock('一段。\n\n> 引文\n- 列表', BY)
    expect(unwrapAiBlock(block)).toBe('一段。\n\n> 引文\n- 列表')
    const t = `# a\n\n${block}\n\n后面。\n`
    const at = t.indexOf('列表')
    const b = aiBlockAt(t, at)!
    expect(t.slice(b.from, b.to)).toBe(block)
    expect(aiBlockAt(t, t.indexOf('后面'))).toBeNull()
  })

  it('改过：头上加一次「改过」，放在「回到对话」前面；读头一行时链接、改过、补标不算模型', () => {
    const h = `> [!ai] ${aiWroteHead({ ...BY, link: chatLink('k', 3) })}`
    expect(markEdited(h)).toBe('> [!ai] AI 写的 · Claude Code · Opus 5.5 · 改过 · [回到 AI 对话](canvas-notes://chat?key=k&msg=3)')
    expect(markEdited(markEdited(h))).toBe(markEdited(h))
    expect(markEdited('> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页')).toBe('> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页 · 改过')
    expect(isEdited(markEdited(h))).toBe(true)
    expect(parseAiCalloutHead('AI 写的 · Claude Code · Opus 5.5 · 改过 · [回到 AI 对话](canvas-notes://chat?key=k&msg=3)')).toEqual({ by: 'Claude Code · Opus 5.5' })
    expect(parseAiCalloutHead('AI 写的 · 补标')).toEqual({})
  })

  it('英文库写英文的说法', () => {
    setCalloutWords(EN_CALLOUT_WORDS)
    expect(aiBlock('One.', { by: 'Codex', link: 'canvas-notes://chat?key=k&msg=1' })).toBe('> [!ai] Written by AI · Codex · [Back to AI chat](canvas-notes://chat?key=k&msg=1)\n> One.')
    expect(aiBlock('One.', { marked: true })).toBe('> [!ai] Written by AI · marked by you\n> One.')
    expect(markEdited('> [!ai] Written by AI · Codex')).toBe('> [!ai] Written by AI · Codex · edited')
  })

  it('AI 对话的回答插进文档（task-83vl3）也是这一块：头一个词「AI 回答」；和 aiCallout 同一套写法；链接认得回来', () => {
    const link = chatLink('file:学习笔记.md', 7)
    const b = aiBlock('一段回答。\n\n| a | b |\n| - | - |', { label: calloutWords().answer, ...BY, link })
    expect(b).toBe(`> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](${link})\n> 一段回答。\n>\n> | a | b |\n> | - | - |`)
    expect(b).toBe(aiCallout({ label: 'AI 回答', by: 'Claude Code · Opus 5.5', seen: `[回到 AI 对话](${link})`, text: '一段回答。\n\n| a | b |\n| - | - |' }))
    expect(parseChatLink(link)).toEqual({ key: 'file:学习笔记.md', msg: 7 })
    expect(parseChatLink('https://x.y')).toBeNull()
  })

  it('链接里的括号转掉，md 链接不断', () => {
    expect(chatLink('note:课程/a (1).md', 2)).toBe('canvas-notes://chat?key=note%3A%E8%AF%BE%E7%A8%8B%2Fa%20%281%29.md&msg=2')
  })
})
