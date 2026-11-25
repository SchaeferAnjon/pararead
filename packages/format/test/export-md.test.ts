import { describe, expect, it } from 'vitest'
import { exportMarkdown } from '../src/export-md'

const files = ['写作/竞赛调研.md', '写作/别的.md', '附件/写作/竞赛调研/截图 1.png', '附件/写作/竞赛调研/图(2).jpg', '资料/报告.pdf', '图库/logo.png', '其他/截图 1.png']
const note = '写作/竞赛调研.md'

describe('导出为 Markdown', () => {
  it('库里的图拷进附件/，链接改成相对路径', () => {
    const r = exportMarkdown('# 竞赛调研\n\n![截图](../附件/写作/竞赛调研/截图%201.png)\n![[logo.png]]\n![[图(2).jpg|300]]\n', note, files)
    expect(r.text).toBe('# 竞赛调研\n\n![截图](附件/截图%201.png)\n![logo](附件/logo.png)\n![图(2)](附件/图%282%29.jpg)\n')
    expect(r.copies).toEqual([
      { from: '附件/写作/竞赛调研/截图 1.png', to: '附件/截图 1.png' },
      { from: '图库/logo.png', to: '附件/logo.png' },
      { from: '附件/写作/竞赛调研/图(2).jpg', to: '附件/图(2).jpg' },
    ])
  })
  it('重名的第二份叫「名字 2」，同一个文件只拷一次', () => {
    const r = exportMarkdown('![a](../附件/写作/竞赛调研/截图%201.png) ![b](../其他/截图%201.png) ![c](<../附件/写作/竞赛调研/截图 1.png>)', note, files)
    expect(r.text).toBe('![a](附件/截图%201.png) ![b](附件/截图%201%202.png) ![c](附件/截图%201.png)')
    expect(r.copies.map((c) => c.to)).toEqual(['附件/截图 1.png', '附件/截图 1 2.png'])
  })
  it('双链只留字，指向 PDF 的拷过去', () => {
    const r = exportMarkdown('看[[别的]]、[[别的|那篇]]、[[别的#第二节]]、[[#开头]]、[[没有这篇]]、[[报告.pdf#page=3|第 3 页]]、[那篇](别的.md)', note, files)
    expect(r.text).toBe('看别的、那篇、别的 › 第二节、开头、没有这篇、[第 3 页](附件/报告.pdf#page=3)、那篇')
    expect(r.copies).toEqual([{ from: '资料/报告.pdf', to: '附件/报告.pdf' }])
  })
  it('网址、找不到的链接、代码里的字不动；去掉白板位置行和块编号', () => {
    const src = '---\ntype: doc\n---\n<!-- card id=a1 x=10 y=20 -->\n一段 ^abc12\n[网](https://x.com/a.png) ![没有](nope.png) `[[别的]]`\n```\n![[logo.png]]\n<!-- card id=a2 -->\n```\n'
    expect(exportMarkdown(src, note, files).text).toBe('---\ntype: doc\n---\n一段\n[网](https://x.com/a.png) ![没有](nope.png) `[[别的]]`\n```\n![[logo.png]]\n<!-- card id=a2 -->\n```\n')
  })
})
