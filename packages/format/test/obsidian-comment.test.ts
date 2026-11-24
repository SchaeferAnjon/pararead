import { describe, expect, it } from 'vitest'
import { obsidianComments } from '../src/obsidian-comment'

// 从 Obsidian 导入时的 %%注释%%（规格 1.4 的推荐写法，task-4xtbp）：整段的变成收起的提示块「注释」，一行里夹着的原样留着
describe('obsidianComments', () => {
  it('单独一行的 %%…%%：变成收起的提示块', () => {
    expect(obsidianComments('前一段。\n\n%%这句是注释%%\n\n后一段。\n')).toEqual({
      text: '前一段。\n\n> [!note]- 注释\n> 这句是注释\n\n后一段。\n',
      blocks: 1,
      inline: 0,
    })
  })

  it('几行夹着的 %%（开头、结尾单独一行）：每一行进提示块，空行写成「>」', () => {
    expect(obsidianComments('# 第一讲\n\n%%\n先别看这段\n\n回头再补\n%%\n').text).toBe('# 第一讲\n\n> [!note]- 注释\n> 先别看这段\n>\n> 回头再补\n')
  })

  it('第一行开头、最后一行末尾是 %% 的几行：也是整段', () => {
    expect(obsidianComments('%%第一行\n第二行%%\n').text).toBe('> [!note]- 注释\n> 第一行\n> 第二行\n')
  })

  it('紧挨着正文的：前后补空行（不然下一行会并进提示块）', () => {
    expect(obsidianComments('正文一句。\n%%注释%%\n下一句。\n').text).toBe('正文一句。\n\n> [!note]- 注释\n> 注释\n\n下一句。\n')
  })

  it('一行里夹着的：原样留着，数出来', () => {
    const src = '定义 %%行内的注释%% 接着写。\n\n%%a%% 和 %%b%%\n'
    expect(obsidianComments(src)).toEqual({ text: src, blocks: 0, inline: 3 })
  })

  it('代码块、行内代码、属性里的 %% 不算', () => {
    const src = '---\nnote: "%%不是注释%%"\n---\n```\n%%代码%%\n```\n\n`%%也不是%%`\n'
    expect(obsidianComments(src)).toEqual({ text: src, blocks: 0, inline: 0 })
  })

  it('没收尾的 %%：原样（Obsidian 里是到文末都算注释，这里不吞后面的字）', () => {
    const src = '%%没收尾\n后面的字\n'
    expect(obsidianComments(src)).toEqual({ text: src, blocks: 0, inline: 1 })
  })

  it('空的 %%%%：去掉不留空提示块', () => {
    expect(obsidianComments('上\n\n%%%%\n\n下\n').text).toBe('上\n\n\n\n下\n')
  })

  it('没有 %% 的：一个字不改', () => {
    const src = '# 标题\n\n百分之五十 50% 不是注释。\n'
    expect(obsidianComments(src)).toEqual({ text: src, blocks: 0, inline: 0 })
  })
})
