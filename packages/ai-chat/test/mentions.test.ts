import { describe, expect, it } from 'vitest'
import { atQuery, eraseMention, liveMentions, type Mention, mentionRanges, snapOut } from '../src/mentions'

const doc: Mention = { path: '课程/情绪识别调研.md', title: '情绪识别调研', kind: 'doc' }
const pdf: Mention = { path: '读书/情绪.pdf', title: '情绪', kind: 'pdf' }

describe('@ 点名的文档', () => {
  it('认字里的「@标题」：前面是开头或空白，后面不接字母数字；长的优先', () => {
    expect(mentionRanges('看看 @情绪识别调研 写得怎么样', [doc]).map((r) => [r.from, r.to])).toEqual([[3, 10]])
    expect(mentionRanges('看看 @情绪识别调研，写得怎么样', [doc])).toHaveLength(1)
    expect(mentionRanges('看看@情绪识别调研', [doc])).toHaveLength(0)
    expect(mentionRanges('@情绪识别调研究', [doc])).toHaveLength(0)
    // 「@情绪」是「@情绪识别调研」的开头：长的那颗赢，短的只认独立的那段
    expect(mentionRanges('@情绪识别调研 和 @情绪', [pdf, doc]).map((r) => r.m.kind)).toEqual(['doc', 'pdf'])
  })

  it('删掉、改坏了的去掉', () => {
    expect(liveMentions('看看 @情绪识别调', [doc])).toEqual([])
    expect(liveMentions('看看 @情绪识别调研 ', [doc, doc])).toEqual([doc])
  })

  it('光标前面正在打的「@几个字」', () => {
    expect(atQuery('看看 @情', 5)).toEqual({ from: 3, q: '情' })
    expect(atQuery('@', 1)).toEqual({ from: 0, q: '' })
    expect(atQuery('a@b', 3)).toBeNull()
    expect(atQuery('@情 绪', 5)).toBeNull()
  })

  it('退格、Delete 整颗删掉（连后面的空格）', () => {
    const t = '看看 @情绪识别调研 好吗'
    expect(eraseMention(t, [doc], 11, 'back')).toEqual({ text: '看看 好吗', at: 3 })
    expect(eraseMention(t, [doc], 10, 'back')).toEqual({ text: '看看 好吗', at: 3 })
    expect(eraseMention(t, [doc], 3, 'forward')).toEqual({ text: '看看 好吗', at: 3 })
    expect(eraseMention(t, [doc], 3, 'back')).toBeNull()
    expect(eraseMention(t, [doc], 12, 'back')).toBeNull()
  })

  it('光标走进胶囊：往左来的到开头，往右来的到末尾', () => {
    const t = '看看 @情绪识别调研 好吗'
    expect(snapOut(t, [doc], 9, 10)).toBe(3)
    expect(snapOut(t, [doc], 4, 3)).toBe(10)
    expect(snapOut(t, [doc], 11, 12)).toBe(11)
  })
})
