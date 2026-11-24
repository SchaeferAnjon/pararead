import { describe, expect, it } from 'vitest'
import { decodeNote, encodeNote, parseReadingNote, upsertSection } from '../src'
import { FIXTURES } from './fixtures'

describe('读 PDF 的笔记（一篇长文档）读回来再写回去不变', () => {
  it('每一段（新格式、旧格式）原样写回，文件一个字节都不变；自己写的那段不算', () => {
    const name = 'Lecture05 笔记.md'
    const { text } = decodeNote(FIXTURES[name]!)
    const sections = parseReadingNote(text, name)
    expect(sections.map((s) => [s.page, !!s.qas])).toEqual([
      [28, true],
      [30, false],
    ])
    let md = text
    for (const s of sections) md = upsertSection(md, s, name)
    expect(md).toBe(text)
  })
})

// 规矩 1：一篇笔记打开、什么都不改、保存，文件一个字节都不变。
describe('打开再保存文件不变', () => {
  for (const [name, bytes] of Object.entries(FIXTURES)) {
    it(name, () => {
      const { text, meta } = decodeNote(bytes)
      if (meta.readOnly) {
        // 只读打开的文件（坏字节）软件不写回，所以也不会改坏
        expect(() => encodeNote(text, meta)).toThrow()
        return
      }
      expect(Buffer.from(encodeNote(text, meta)).equals(Buffer.from(bytes))).toBe(true)
    })
  }

  it('编辑器里只有 \\n，CRLF 写回时还原', () => {
    const { text, meta } = decodeNote(FIXTURES['crlf.md']!)
    expect(text).not.toContain('\r')
    expect(meta.eol).toBe('\r\n')
    const edited = text.replace('第一段', '第一段改了')
    expect(new TextDecoder().decode(encodeNote(edited, meta))).toBe('# Windows 换行\r\n\r\n第一段改了\r\n第二段\r\n')
  })

  it('混用换行：改了一行的字，其他行的换行照旧', () => {
    const { text, meta } = decodeNote(FIXTURES['mixed-eol.md']!)
    const edited = text.replace('这一行是 LF', '这一行是 LF，改了')
    expect(new TextDecoder().decode(encodeNote(edited, meta))).toBe('混用换行\r\n这一行是 LF，改了\n这一行是 CRLF\r\n')
  })

  it('BOM 保留', () => {
    const { text, meta } = decodeNote(FIXTURES['bom.md']!)
    expect(text.startsWith('#')).toBe(true)
    expect(meta.bom).toBe(true)
  })

  it('混用换行标出来，坏字节和单独的 \\r 只读', () => {
    expect(decodeNote(FIXTURES['mixed-eol.md']!).meta.mixedEol).toBe(true)
    expect(decodeNote(FIXTURES['invalid-utf8.md']!).meta.readOnly).toBe(true)
    expect(decodeNote(FIXTURES['lone-cr.md']!).meta.readOnly).toBe(true)
    expect(decodeNote(FIXTURES['html-and-tables.md']!).meta.mixedEol).toBe(true)
    expect(decodeNote(FIXTURES['plain.md']!).meta.readOnly).toBe(false)
  })
})
