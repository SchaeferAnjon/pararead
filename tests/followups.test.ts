import { describe, expect, it } from 'vitest'
import { splitFollowups } from '../src/shared/followups'

describe('splitFollowups', () => {
  it('拆出末尾的接着问', () => {
    expect(splitFollowups('正文第一段\n\n接着问：CU 怎么算？| 和 SIMPLE 比慢多少？｜能用在 IMPLY 上吗？')).toEqual({
      body: '正文第一段',
      follow: ['CU 怎么算？', '和 SIMPLE 比慢多少？', '能用在 IMPLY 上吗？']
    })
  })
  it('模型加粗或用英文冒号也认', () => {
    expect(splitFollowups('答\n**接着问**: a | b').follow).toEqual(['a', 'b'])
  })
  it('没有就原样返回', () => {
    expect(splitFollowups('只有回答')).toEqual({ body: '只有回答', follow: [] })
  })
})
