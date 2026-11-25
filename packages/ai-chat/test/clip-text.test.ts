import { describe, expect, it } from 'vitest'
import { clipText } from '../src/paste'

/** 剪贴板：text/plain 和几张图的文件名 */
const dt = (text: string, names: string[] = ['image.png']) => ({ getData: (t: string) => (t === 'text/plain' ? text : ''), files: names.map((name) => ({ name })) }) as unknown as DataTransfer

describe('clipText：字和图一起粘时贴不贴字', () => {
  it('微信多条聊天记录（字 + 一张渲染图）：贴字，换行统一成 \\n', () => {
    expect(clipText(dt('张三 10:02\r\n明天几点开会？\r\n李四 10:05\r\n下午两点'))).toBe('张三 10:02\n明天几点开会？\n李四 10:05\n下午两点')
  })
  it('没有字、只有空白：贴图', () => {
    expect(clipText(dt(''))).toBe('')
    expect(clipText(dt(' \n '))).toBe('')
  })
  it('字只是图的文件名（访达里拷的图，一张或几张，带不带路径）：贴图', () => {
    expect(clipText(dt('截图.png', ['截图.png']))).toBe('')
    expect(clipText(dt('a.png\nb.jpg', ['a.png', 'b.jpg']))).toBe('')
    expect(clipText(dt('/Users/x/Desktop/a.png', ['a.png']))).toBe('')
  })
  it('字只是一个网址（浏览器「拷贝图像」）：贴图；网址加别的字是字', () => {
    expect(clipText(dt('https://example.com/a.png'))).toBe('')
    expect(clipText(dt('看这个 https://example.com/a.png'))).toBe('看这个 https://example.com/a.png')
  })
})
