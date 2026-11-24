import { describe, expect, it } from 'vitest'
import { splitImageAlt } from '../src'

describe('图片说明里的宽度（Obsidian 写法）', () => {
  it('「我框的|268」：说明是「我框的」，宽 268', () => {
    expect(splitImageAlt('我框的|268')).toEqual({ caption: '我框的', width: 268, size: '|268' })
  })
  it('「图|300x200」：宽高都认', () => {
    expect(splitImageAlt('图|300x200')).toEqual({ caption: '图', width: 300, height: 200, size: '|300x200' })
  })
  it('没写宽度、竖线后面不是数字的照原样', () => {
    expect(splitImageAlt('黑沙滩')).toEqual({ caption: '黑沙滩', size: '' })
    expect(splitImageAlt('a|b')).toEqual({ caption: 'a|b', size: '' })
    expect(splitImageAlt('')).toEqual({ caption: '', size: '' })
  })
  it('只有宽度、没有说明', () => {
    expect(splitImageAlt('|245')).toEqual({ caption: '', width: 245, size: '|245' })
  })
})
