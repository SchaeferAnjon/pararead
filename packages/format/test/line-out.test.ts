import { describe, expect, it } from 'vitest'
import { applyLineOut, lineMarkLength, standaloneLine } from '../src/line-out'

const out = (text: string, n: number, mark?: number) => {
  const r = standaloneLine(text, n, mark)
  return { text: applyLineOut(text, r), at: r.at }
}

describe('一行变成独立的一段（拿掉记号连同空行一起改，task-axoxy）', () => {
  it('列表中间的空项：上面补一道缝，它自己是一个空块（一串空行第一行是缝、后面每行一个空块），列表拆成两段', () => {
    const r = out('- 一\n- \n- 二\n', 2)
    expect(r.text).toBe('- 一\n\n\n- 二\n')
    expect(r.at).toBe('- 一\n\n'.length)
  })

  it('列表最后的空项：这一行拿掉，列表和下一块之间多一个空块', () => {
    expect(out('- 一\n- \n\n尾。\n', 2).text).toBe('- 一\n\n\n尾。\n')
  })

  it('空项下面紧挨着标题：下面再补一行（标题前最后那个空行算标题上方的留白）', () => {
    expect(out('- 一\n- \n## 题\n', 2).text).toBe('- 一\n\n\n\n## 题\n')
  })

  it('后面没有别的块了：这一行拿掉，交给编辑器在文末新起一行（trailing）', () => {
    expect(out('- 一\n- ', 2).text).toBe('- 一')
    expect(standaloneLine('- 一\n- \n', 2).trailing).toBe(true)
    expect(out('- 一\n- \n', 2).text).toBe('- 一\n')
  })

  it('有字的列表项、待办：字留着，上下空行', () => {
    expect(out('- 一\n- 二\n- 三\n', 2).text).toBe('- 一\n\n二\n\n- 三\n')
    expect(out('- [ ] 办一\n- [x] 办二\n', 2).text).toBe('- [ ] 办一\n\n办二\n')
  })

  it('编号列表：后面同一层的从 1 重新数，套着的子项不动', () => {
    expect(out('1. 一\n2. 二\n3. 三\n   - 子\n4. 四\n\n尾\n', 2).text).toBe('1. 一\n\n二\n\n1. 三\n   - 子\n2. 四\n\n尾\n')
    expect(out('1) 一\n2) 二\n3) 三\n', 2).text).toBe('1) 一\n\n二\n\n1) 三\n')
  })

  it('标题、引用：去掉记号，两边原来就是空行的不补', () => {
    expect(out('上\n\n## 小标题\n\n下\n', 3).text).toBe('上\n\n小标题\n\n下\n')
    expect(out('> 引一\n> 引二\n', 1).text).toBe('引一\n\n> 引二\n')
  })

  it('给了记号长度就照它（编辑器按语法树认的）', () => {
    expect(out('> - 一\n', 1, 4).text).toBe('一\n')
  })

  it('记号长度', () => {
    expect(lineMarkLength('- [ ] 办')).toBe(6)
    expect(lineMarkLength('  1. 一')).toBe(5)
    expect(lineMarkLength('> > 引')).toBe(4)
    expect(lineMarkLength('### 标')).toBe(4)
    expect(lineMarkLength('正文')).toBe(0)
  })
})
