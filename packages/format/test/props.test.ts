// 属性的类型（CN-131）：一个文件只有一个类型字段。以前微信读书同步写的 `type: weread` 读成「书摘」；
// 在属性里选类型时就地换掉那一行，不再多写一行「类型: 书摘」。书的编号（bookId）是软件自己用的，不给人看（CN-123）。
import { describe, expect, it } from 'vitest'
import { fileType, HIDDEN_KEYS, readProps, setProp, setPropByUser } from '../src'

const OLD = '---\ntype: weread\ntitle: 思考\nbookId: 900001\nmarks: 3\n---\n# 思考\n'

describe('类型字段', () => {
  it('旧书摘的 type: weread 读成书摘；有「类型」以「类型」为准', () => {
    expect(fileType(OLD)).toBe('书摘')
    expect(fileType('---\ntype: weread\n类型: 笔记\n---\n')).toBe('笔记')
    expect(fileType('---\ntype: board\n---\n')).toBeUndefined()
    expect(fileType('正文\n')).toBeUndefined()
  })
  it('设类型：旧的 type: weread 那一行就地换成「类型: …」，只改这一行；清空就去掉', () => {
    expect(setProp(OLD, '类型', '笔记')).toBe(OLD.replace('type: weread', '类型: 笔记'))
    expect(setPropByUser(OLD, '类型', '书摘')).toBe(OLD.replace('type: weread', '类型: 书摘'))
    expect(setProp(OLD, '类型', undefined)).toBe(OLD.replace('type: weread\n', ''))
    // 已经有「类型」：只改它，不碰别的 type（白板的 type: board 也不动）
    expect(setProp('---\ntype: board\n类型: 笔记\n---\n', '类型', '导图')).toBe('---\ntype: board\n类型: 导图\n---\n')
    expect(setProp('---\ntype: board\n---\n', '类型', '导图')).toBe('---\ntype: board\n类型: 导图\n---\n')
    for (const t of [setProp(OLD, '类型', '笔记'), setPropByUser(OLD, '类型', '书摘')]) expect(readProps(t).filter((p) => p.key === 'type' || p.key === '类型')).toHaveLength(1)
  })
  it('书的编号不给人看', () => {
    expect(HIDDEN_KEYS.has('bookId')).toBe(true)
  })
})
