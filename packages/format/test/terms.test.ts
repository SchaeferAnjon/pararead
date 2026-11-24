// 算得上证据的词（task-eler2）：停用词、高频虚词、序数词、数字不算，中英文都一样
import { describe, expect, it } from 'vitest'
import { dupShingles, dupTokens, hanBigrams, isEnStop, termCounts, termRuns } from '../src'

const words = (md: string) => termRuns(md).map((r) => (r.kind === 'word' ? r.term : r.text))

describe('笔记里算得上证据的词', () => {
  it('英文：停用词、序数词（second、first、21st）、数字、the second-largest 里的 second 都不算；复数并成单数', () => {
    expect(words('In the second half of last year, the second was phone numbers.')).toEqual(['phone'])
    expect(words('Gullfoss is the second-largest waterfall; Glymur the second-tallest waterfalls in 2010, 21st.')).toEqual(['gullfoss', 'waterfall', 'glymur', 'waterfall'])
    expect(isEnStop('First')).toBe(true)
    expect(isEnStop('Twelfth')).toBe(true)
    expect(isEnStop('Anthropic')).toBe(false)
    expect(isEnStop('glass')).toBe(false)
  })

  it('中文：第三方、第一次、第 3 页这类序数，我们、相关、时候这类高频词，的、了、是这类虚字都断开不算', () => {
    expect(words('请第三方验房')).toEqual(['验房'])
    expect(words('第一次去健身房，我们一个时候相关的')).toEqual(['去健身房'])
    expect(words('看第 3 页的公式')).toEqual(['公式'])
    expect(words('特朗普回到白宫')).toEqual(['特朗普回', '白宫'])
    expect(hanBigrams('特朗普')).toEqual(['特朗', '朗普'])
  })

  it('frontmatter、网址、图片、数字不算；链接只留文字', () => {
    expect(words('---\nsource: https://x.y\ncreated: 2026-11-20\n---\n看 [极光预报](a.md) ![图](b.png) https://road.is 1330 公里')).toEqual(['极光预报', '公里'])
  })

  it('词频：英文一个词、中文两个字一片', () => {
    expect([...termCounts('Feynman, Feynman! 遗忘曲线')]).toEqual([
      ['feynman', 2],
      ['遗忘', 1],
      ['忘曲', 1],
      ['曲线', 1],
    ])
  })

  it('找重复的切片：英文按词、中文按字，两篇不相干的英文不再因为都有 the、ion 这些字母片而像', () => {
    expect(dupTokens('The second-largest waterfall in Iceland')).toEqual(['waterfall', 'iceland'])
    expect(dupTokens('冰洞只在冬天开放')).toEqual(['冰', '洞', '只', '在', '冬', '天', '开', '放'])
    expect([...dupShingles('冰岛自驾')]).toEqual(['冰 岛 自', '岛 自 驾'])
    const a = dupShingles('Most of the time the hotel has a kettle, so bring tea and the second pair of shoes.')
    const b = dupShingles('Most of the time nothing much happens on the third day, which is normal for the starter.')
    expect([...a].filter((s) => b.has(s))).toEqual([])
  })
})
