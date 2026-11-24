import { describe, expect, it } from 'vitest'
import { folderMap, remapLinks, resolveLink } from '../src'

const map = folderMap('课程/ecp', '课程/ECP 经济学')

describe('文件夹改名后链接跟着改', () => {
  it('别处指进这个文件夹的相对链接换成新路径，锚点留着', () => {
    const t = '# 复习\n\n看 [第5讲](课程/ecp/Lecture05.pdf#page=3) 和 ![图](课程/ecp/图%201.png)\n'
    const out = remapLinks(t, '复习.md', '复习.md', map)
    expect(out).toBe('# 复习\n\n看 [第5讲](课程/ECP%20经济学/Lecture05.pdf#page=3) 和 ![图](课程/ECP%20经济学/图%201.png)\n')
    // 改完以后从这篇点得开
    expect(resolveLink('复习.md', '课程/ECP%20经济学/Lecture05.pdf')).toBe('课程/ECP 经济学/Lecture05.pdf')
  })

  it('从别的深度用 ../ 指进来的也改', () => {
    const t = '[笔记](../../课程/ecp/笔记.md)'
    expect(remapLinks(t, '.canvas-notes/对话/a.md', '.canvas-notes/对话/a.md', map)).toBe('[笔记](../../课程/ECP%20经济学/笔记.md)')
  })

  it('文件夹里面的笔记：指向里面的、指向外面的都还对，一个字不动', () => {
    const t = '[讲义](Lecture05.pdf#page=5) ![框](../../附件/Lecture05/p5-1.png) [对话](../../.canvas-notes/对话/x.md)'
    expect(remapLinks(t, '课程/ecp/笔记.md', '课程/ECP 经济学/笔记.md', map)).toBe(t)
  })

  it('这篇自己挪到别的深度：指向外面的按新位置重算', () => {
    expect(remapLinks('![图](../附件/a.png)', '课程/a.md', '课程/ecp/a.md', () => null)).toBe('![图](../../附件/a.png)')
  })

  it('网址、页内锚点、绝对路径、没挪的、只写名字的双链都不动', () => {
    const t = '[网](https://x.com/课程/ecp/a) [上面](#标题) [根](/课程/ecp/a.md) [别的](课程/线代/a.md) [[ecp 笔记]]'
    expect(remapLinks(t, '复习.md', '复习.md', map)).toBe(t)
  })

  it('带路径的双链换前缀', () => {
    const t = '[[课程/ecp/笔记]] [[课程/ecp/讲义.pdf|讲义]] [[课程/ecp/笔记#小结]] [[笔记]] [[课程/ecpx/笔记]]'
    expect(remapLinks(t, '复习.md', '复习.md', map)).toBe('[[课程/ECP 经济学/笔记]] [[课程/ECP 经济学/讲义.pdf|讲义]] [[课程/ECP 经济学/笔记#小结]] [[笔记]] [[课程/ecpx/笔记]]')
  })

  it('数据库代码块的数据源文件夹（file.inFolder）跟着换；代码块外面、别的文件夹不动', () => {
    const base = (f: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + f + '")\nviews:\n  - type: table\n```'
    expect(remapLinks(`# 表\n\n${base('课程/ecp')}\n`, '表.md', '表.md', map)).toBe(`# 表\n\n${base('课程/ECP 经济学')}\n`)
    expect(remapLinks(base('课程/ecp/讲义'), '表.md', '表.md', map)).toBe(base('课程/ECP 经济学/讲义'))
    expect(remapLinks("```base\nfilters: file.inFolder('课程/ecp')\n```", '表.md', '表.md', map)).toBe("```base\nfilters: file.inFolder('课程/ECP 经济学')\n```")
    const untouched = `${base('课程/ecpx')}\n\n正文里写 file.inFolder("课程/ecp") 不算\n\n\`\`\`js\nfile.inFolder("课程/ecp")\n\`\`\``
    expect(remapLinks(untouched, '表.md', '表.md', map)).toBe(untouched)
  })

  it('数据库关联列连到的文件夹（properties 里的 to:）也跟着换；只换那一行，引号、注释照旧', () => {
    const base = (f: string, g: string) => '```base\nfilters:\n  and:\n    - file.inFolder("课程/计划")\nproperties:\n  练习:\n    type: relation\n    to: ' + f + '   # 那边\n    twoWay: 所属讲\n  别的:\n    type: relation\n    to: "' + g + '"\nviews:\n  - type: table\n```'
    expect(remapLinks(base('课程/ecp/练习', '课程/ecp'), '表.md', '表.md', map)).toBe(base('课程/ECP 经济学/练习', '课程/ECP 经济学'))
    // 别的文件夹、视图里的键、代码块外面的 to: 不动
    const other = base('课程/ecpx/练习', '阅读/书单') + '\n\nto: 课程/ecp\n'
    expect(remapLinks(other, '表.md', '表.md', map)).toBe(other)
  })

  it('folderMap 只认整段文件夹名', () => {
    expect(map('课程/ecp')).toBe('课程/ECP 经济学')
    expect(map('课程/ecp/a.md')).toBe('课程/ECP 经济学/a.md')
    expect(map('课程/ecpx/a.md')).toBeNull()
  })
})
