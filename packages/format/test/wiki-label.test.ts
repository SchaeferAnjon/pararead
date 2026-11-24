import { describe, expect, it } from 'vitest'
import { imageEmbed, pickEmbed, wikiLabel, wikiShown } from '../src/wiki-label'

describe('![[图.png]] 指的是库里哪个文件', () => {
  const paths = ['附件/极光.png', '写作/附件/极光.png', '子/路径/冰洞.png', '写作/看图.md', '根.png']
  it('相对这篇、库根目录、按名字找（同一个文件夹里的先，短的先）', () => {
    expect(pickEmbed(paths, '写作/看图.md', '附件/极光.png')).toBe('写作/附件/极光.png')
    expect(pickEmbed(paths, '写作/看图.md', '子/路径/冰洞.png')).toBe('子/路径/冰洞.png')
    expect(pickEmbed(paths, '写作/看图.md', '极光.png')).toBe('写作/附件/极光.png')
    expect(pickEmbed(paths, '别处/a.md', '极光.png')).toBe('附件/极光.png')
    expect(pickEmbed(paths, '写作/看图.md', '路径/冰洞.png')).toBe('子/路径/冰洞.png')
    expect(pickEmbed(paths, '写作/看图.md', '根.png')).toBe('根.png')
    expect(pickEmbed(paths, '写作/看图.md', '没有.png')).toBeNull()
  })
})

describe('双链露出来的字', () => {
  it('路径只露最后一截，别名露别名，.md 不露，#标题留着', () => {
    expect(wikiLabel('课程/ecp/第五讲')).toBe('第五讲')
    expect(wikiLabel('课程/ecp/第六讲|下一讲')).toBe('下一讲')
    expect(wikiLabel('笔记')).toBe('笔记')
    expect(wikiLabel('a/笔记.md')).toBe('笔记')
    expect(wikiLabel('a/笔记#第二节')).toBe('笔记#第二节')
    expect(wikiLabel('a/b|')).toBe('b')
    expect(wikiLabel('Lecture05.pdf')).toBe('Lecture05.pdf')
    expect(wikiLabel('#只有标题')).toBe('#只有标题')
  })
  it('起止落在原文里', () => {
    const inner = '课程/ecp/第六讲|下一讲'
    const r = wikiShown(inner)
    expect(inner.slice(r.from, r.to)).toBe('下一讲')
    expect(wikiShown('a/b/c')).toEqual({ from: 4, to: 5 })
  })
})

describe('Obsidian 写法的图片', () => {
  it('单独一行的 ![[图.png]]、带宽、带路径', () => {
    expect(imageEmbed('![[极光.png]]')).toEqual({ target: '极光.png', alt: '' })
    expect(imageEmbed('![[极光.png|300]]')).toEqual({ target: '极光.png', alt: '300' })
    expect(imageEmbed('![[子/路径/冰洞.JPG]]  ')).toEqual({ target: '子/路径/冰洞.JPG', alt: '' })
  })
  it('不是图的嵌入、行里还有别的字：不算', () => {
    expect(imageEmbed('![[Lecture05.pdf#page=3]]')).toBeNull()
    expect(imageEmbed('![[笔记]]')).toBeNull()
    expect(imageEmbed('看 ![[极光.png]]')).toBeNull()
  })
})
