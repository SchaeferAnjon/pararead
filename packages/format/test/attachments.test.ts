import { describe, expect, it } from 'vitest'
import { attachmentDir, imageRefs, linkedPaths, planOldImages, relinkMovedNote } from '../src/attachments'

describe('附件按文档分文件夹（CN-40 A）', () => {
  it('附件文件夹是 附件/<笔记路径去掉 .md>', () => {
    expect(attachmentDir('未命名 3.md')).toBe('附件/未命名 3')
    expect(attachmentDir('课程/ecp/Lecture05 笔记.md')).toBe('附件/课程/ecp/Lecture05 笔记')
  })

  it('改名：自己附件文件夹里的图换到新文件夹，别的链接不动', () => {
    const text = '# a\n\n![](附件/未命名%203/截图%201.png)\n\n![旧图](附件/image-1.png)\n\n[网](https://a.cn/x)\n'
    const out = relinkMovedNote(text, '未命名 3.md', '冰岛.md', { from: '附件/未命名 3', to: '附件/冰岛' })
    expect(out).toBe('# a\n\n![](附件/冰岛/截图%201.png)\n\n![旧图](附件/image-1.png)\n\n[网](https://a.cn/x)\n')
  })

  it('换文件夹：自己的附件跟着走，断掉的相对链接按新位置重算', () => {
    const text = '![](附件/a/截图%201.png)\n![](附件/image-1.png "t")\n[另一篇](b.md)\n'
    const out = relinkMovedNote(text, 'a.md', '课程/a.md', { from: '附件/a', to: '附件/课程/a' })
    expect(out).toBe('![](../附件/课程/a/截图%201.png)\n![](../附件/image-1.png "t")\n[另一篇](../b.md)\n')
  })

  it('没有要改的：原样返回（打开再保存不变）', () => {
    const text = '![x](附件/a/1.png)\n[[双链]]\n'
    expect(relinkMovedNote(text, 'a.md', 'a.md')).toBe(text)
  })
})

describe('老图挪进各篇自己的附件文件夹（梦游）', () => {
  const files = ['附件/image-1.png', '附件/image-2.png', '附件/image-12.png', '附件/image-30.png', '附件/image-40.png', '附件/课程/ecp/Lecture05 笔记/截图 1.png', '附件/说明.txt']
  const L5 = '# Lecture05 笔记\n\n![](../../附件/image-1.png)\n\n## 为什么要先看符号\n\n看图 ![第 2 张](../../附件/image-2.png "图二") 和 ![共用](../../附件/image-12.png)\n'
  const L4 = '# Lecture04 笔记\n\n![](../../附件/image-12.png)\n'
  const inbox = '速记 ![](../附件/image-40.png)\n'
  const notes = [
    { path: '课程/ecp/Lecture05 笔记.md', text: L5 },
    { path: '课程/ecp/Lecture04 笔记.md', text: L4 },
    { path: '收件箱/速记.md', text: inbox },
  ]
  it('只有一篇在用的挪进那篇的文件夹、不改名；共用的、没人用的、收件箱里的留原处；子文件夹里的和不是图的不算', () => {
    const p = planOldImages(notes, files, { hold: (n) => n.startsWith('收件箱/') })
    expect(p.moves).toEqual([
      { from: '附件/image-1.png', to: '附件/课程/ecp/Lecture05 笔记/image-1.png', note: '课程/ecp/Lecture05 笔记.md', section: 'Lecture05 笔记' },
      { from: '附件/image-2.png', to: '附件/课程/ecp/Lecture05 笔记/image-2.png', note: '课程/ecp/Lecture05 笔记.md', section: '为什么要先看符号' },
    ])
    expect(p.kept).toEqual([
      { path: '附件/image-12.png', why: 'shared', notes: ['课程/ecp/Lecture04 笔记.md', '课程/ecp/Lecture05 笔记.md'] },
      { path: '附件/image-30.png', why: 'unused', notes: [] },
      { path: '附件/image-40.png', why: 'inbox', notes: ['收件箱/速记.md'] },
    ])
  })
  it('链接跟着改（保留说明和标题），别的字一个不动；改过的再算一遍没有要挪的', () => {
    const p = planOldImages(notes, files, { hold: (n) => n.startsWith('收件箱/') })
    expect(p.edits).toHaveLength(1)
    const e = p.edits[0]!
    expect(e.text).toBe(L5.replace('](../../附件/image-1.png)', '](../../附件/课程/ecp/Lecture05%20笔记/image-1.png)').replace('](../../附件/image-2.png "图二")', '](../../附件/课程/ecp/Lecture05%20笔记/image-2.png "图二")'))
    expect(e.links.map((l) => l.after)).toEqual(['![](../../附件/课程/ecp/Lecture05%20笔记/image-1.png)', '![第 2 张](../../附件/课程/ecp/Lecture05%20笔记/image-2.png "图二")'])
    const after = files.filter((f) => !p.moves.some((m) => m.from === f)).concat(p.moves.map((m) => m.to))
    expect(planOldImages([{ path: e.note, text: e.text }, notes[1]!], after).moves).toEqual([])
  })
  it('那篇的文件夹里已有同名的：留原处', () => {
    const p = planOldImages([{ path: 'a.md', text: '![](附件/image-1.png)' }], ['附件/image-1.png', '附件/a/image-1.png'])
    expect(p.moves).toEqual([])
    expect(p.kept).toEqual([{ path: '附件/image-1.png', why: 'clash', notes: ['a.md'] }])
  })
})


describe('一篇笔记里用到的图（属性里列附件、删笔记连图一起删）', () => {
  const note = '课程/ecp/Lecture05 笔记.md'
  const text = [
    '---',
    '封面: ![](附件/不算.png)',
    '---',
    '# Lecture05 笔记',
    '',
    '开头一段 ![](../../附件/课程/ecp/Lecture05%20笔记/截图%201.png)',
    '',
    '## 为什么要先看符号',
    '',
    '![柱状](<../../附件/课程/ecp/Lecture05 笔记/截图 2.png>) 和 ![同一张](../../附件/课程/ecp/Lecture05%20笔记/截图%201.png)',
    '```',
    '![代码里的](不算.png)',
    '```',
    '![网图](https://a.cn/x.png) [讲义](Lecture05.pdf#page=3) ![](../../附件/板书.jpg "标题")',
  ].join('\n')
  it('按出现的先后，同一张只算一次；写出在哪一节（标题前面写第几段）和在原文里的位置；网址、代码块、属性里的不算', () => {
    const refs = imageRefs(text, note)
    expect(refs.map((r) => [r.path, r.where])).toEqual([
      ['附件/课程/ecp/Lecture05 笔记/截图 1.png', '第 1 段'],
      ['附件/课程/ecp/Lecture05 笔记/截图 2.png', '为什么要先看符号'],
      ['附件/板书.jpg', '为什么要先看符号'],
    ])
    expect(text.slice(refs[1]!.offset, refs[1]!.offset + 4)).toBe('![柱状')
  })
  it('all：同一张用了几处列几处（附件弹层里点图一处一处跳）；[!ai] 块里、脚注里的图也认', () => {
    const refs = imageRefs(text, note, true).filter((r) => r.path.endsWith('截图 1.png'))
    expect(refs.map((r) => text.slice(r.offset, r.offset + 5))).toEqual(['![](.', '![同一张'])
    const paired = '# x 笔记\n\n## 第 2 页\n\n![我框的|268](附件/x/p2-1.png)\n\n> [!ai] AI 讲解\n> 看这张：\n> ![](附件/x/p2-1.png)\n\n[^p2-1-1]: ![粘贴的图|180](附件/x/p2-1.png)\n'
    const all = imageRefs(paired, 'x 笔记.md', true)
    expect(all.map((r) => paired.slice(r.offset).split('\n')[0])).toEqual(['![我框的|268](附件/x/p2-1.png)', '![](附件/x/p2-1.png)', '![粘贴的图|180](附件/x/p2-1.png)'])
  })
  it('所有相对链接（图和普通链接，宁多不少）：去掉 #页码', () => {
    expect([...linkedPaths(text, note)].sort()).toEqual(['课程/ecp/Lecture05.pdf', '课程/ecp/不算.png', '附件/板书.jpg', '附件/课程/ecp/Lecture05 笔记/截图 1.png', '附件/课程/ecp/Lecture05 笔记/截图 2.png', '课程/ecp/附件/不算.png'].sort())
  })
})
