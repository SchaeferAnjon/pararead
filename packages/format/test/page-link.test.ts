// 笔记里「第 3 页」这种链接指哪份 PDF 的哪一页（task-j2vv8：⌘点开出空白「#page=3」标签）
import { describe, expect, it } from 'vitest'
import { notePdfCandidates, pageLinkOf } from '../src/pdf-link'

const NOTE = '课程/线代/第3讲 笔记.md'

describe('pageLinkOf', () => {
  it('光写 #page=3（读 PDF 时 AI 回答里的写法，原样记进了笔记）：是页码链接，PDF 要按笔记找', () => {
    expect(pageLinkOf(NOTE, '#page=3')).toEqual({ file: null, page: 3 })
    expect(pageLinkOf(NOTE, '#page=3&rect=0.1,0.2,0.3,0.4')).toEqual({ file: null, page: 3, rect: [0.1, 0.2, 0.3, 0.4] })
  })
  it('带文件的：按笔记所在文件夹换成库里的路径，# 后面不算进路径', () => {
    expect(pageLinkOf(NOTE, '第3讲.pdf#page=4&rect=0.1,0.2,0.5,0.2')).toEqual({ file: '课程/线代/第3讲.pdf', page: 4, rect: [0.1, 0.2, 0.5, 0.2] })
    expect(pageLinkOf(NOTE, '../%E5%85%B1%E7%94%A8/Lecture%2005.pdf#page=2')).toEqual({ file: '课程/共用/Lecture 05.pdf', page: 2 })
  })
  it('不是 PDF 页码的不管：网址、光一个 PDF、别的 # 锚点、别的文件', () => {
    expect(pageLinkOf(NOTE, 'https://x.com/a.pdf#page=2')).toBeNull()
    expect(pageLinkOf(NOTE, '第3讲.pdf')).toBeNull()
    expect(pageLinkOf(NOTE, '#定义')).toBeNull()
    expect(pageLinkOf(NOTE, '#page=0')).toBeNull()
    expect(pageLinkOf(NOTE, '别的.md#page=2')).toBeNull()
  })
})

describe('notePdfCandidates', () => {
  it('先看属性「来源」，再看「X 笔记.md」旁边的 X.pdf，再看这一处前面、后面的页码链接', () => {
    const text = '---\n来源: "[[第3讲 线性映射.pdf]]"\n---\n# 笔记\n\n[第 2 页](第4讲.pdf#page=2)\n\n细节在[第 3 页](#page=3)。\n\n[第 5 页](../别处/第5讲.pdf#page=5)\n'
    const pos = text.indexOf('细节')
    expect(notePdfCandidates(NOTE, text, pos)).toEqual(['课程/线代/第3讲 线性映射.pdf', '课程/线代/第3讲.pdf', '课程/线代/第4讲.pdf', '课程/别处/第5讲.pdf'])
  })
  it('来源写了路径的照写；不是 PDF 的来源不算；不重复', () => {
    expect(notePdfCandidates(NOTE, '---\n来源: "[[课程/线代/第3讲.pdf|讲义]]"\n---\n', 0)).toEqual(['课程/线代/第3讲.pdf'])
    expect(notePdfCandidates('收件箱/随手.md', '---\n来源: https://x.com\n---\n见[第 2 页](#page=2)', 30)).toEqual([])
  })
})
