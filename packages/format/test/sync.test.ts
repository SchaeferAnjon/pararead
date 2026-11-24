import { describe, expect, it } from 'vitest'
import { applyChanges, clockStamp, conflictCopyName, merge3, merge3Fine, reconcile, textChanges } from '../src'

// 规矩 2：正在编辑时外部改动进来，正在打的字不丢；冲突的那一版另存一份冲突副本。
describe('外部改动不丢正在打的字', () => {
  const base = '# 旅行\n\n第一段。\n\n第二段。\n\n第三段。\n'

  it('本地没改：直接换成磁盘的', () => {
    const remote = base.replace('第三段', '第三段（同步来的）')
    expect(reconcile(base, base, remote)).toEqual({ kind: 'update', text: remote, merged: false })
  })

  it('两边改的不是一处：合并，两边的字都在', () => {
    const local = base.replace('第一段。', '第一段。正在打的字')
    const remote = base.replace('第三段。', '第三段。AI 补的一句')
    const r = reconcile(base, local, remote)
    expect(r.kind).toBe('update')
    if (r.kind !== 'update') return
    expect(r.text).toContain('正在打的字')
    expect(r.text).toContain('AI 补的一句')
  })

  it('外部在开头插了几行，本地在后面打字：合并', () => {
    const local = base + '新写的一段\n'
    const remote = '---\ntags: [旅行]\n---\n' + base
    const r = reconcile(base, local, remote)
    expect(r).toEqual({ kind: 'update', text: '---\ntags: [旅行]\n---\n' + base + '新写的一段\n', merged: true })
  })

  it('两边改了同一行：本地不动，磁盘那版另存', () => {
    const local = base.replace('第二段。', '第二段，我在改')
    const remote = base.replace('第二段。', '第二段，同步改的')
    expect(reconcile(base, local, remote)).toEqual({ kind: 'conflict', conflictText: remote, text: local })
  })

  it('两边改了同一段、外面还改了别的段：同一段留我的，外面别处改的照样合进来（以前只进冲突副本），磁盘那版另存', () => {
    const local = base.replace('第二段。', '第二段，我在改')
    const remote = base.replace('第二段。', '第二段，同步改的').replace('第一段。', '第一段，外面也改了。')
    expect(reconcile(base, local, remote)).toEqual({ kind: 'conflict', conflictText: remote, text: local.replace('第一段。', '第一段，外面也改了。') })
  })

  it('磁盘没变、或者变得和本地一样：什么都不做', () => {
    const local = base + 'x'
    expect(reconcile(base, local, base)).toEqual({ kind: 'none' })
    expect(reconcile(base, local, local)).toEqual({ kind: 'none' })
  })

  it('两边做了同样的改动不算冲突', () => {
    const both = base.replace('第二段。', '一样的改动')
    const local = both + '本地多打的\n'
    expect(merge3(base, local, both)).toEqual({ text: local, conflict: false })
  })

  it('冲突副本的名字：时间和另存的「没存上的字 14-03」同一写法', () => {
    const d = new Date(2026, 10, 15, 14, 3)
    expect(conflictCopyName('旅行.md', d)).toBe('旅行（冲突 2026-11-15 14-03）.md')
    expect(conflictCopyName('旅行.md', d, 2)).toBe('旅行（冲突 2026-11-15 14-03 2）.md')
  })

  it('文件名里的时间：时-分两位，中间一横（文件名里不用冒号，也不用点）', () => {
    expect(clockStamp(new Date(2026, 10, 15, 9, 5))).toBe('09-05')
    expect(clockStamp(new Date(2026, 10, 15, 18, 20))).toBe('18-20')
  })
})

describe('textChanges：只动改了的地方', () => {
  it('改动落在光标后面时，光标前的文字不在改动范围里', () => {
    const a = '第一行正在打\n第二行\n第三行\n'
    const b = '第一行正在打\n第二行\n第三行改了\n'
    const cs = textChanges(a, b)
    expect(cs).toEqual([{ from: a.indexOf('\n第三行') + 4, to: a.indexOf('\n第三行') + 4, insert: '改了' }])
  })

  it('删掉结尾的空行、在结尾加行', () => {
    for (const [a, b] of [
      ['x\n\n\n', 'x\nyy\n\n'],
      ['a\n\n', 'a\n'],
      ['a\n', 'a\n\n\nb'],
      ['', 'a\nb'],
      ['a\nb', ''],
      ['a', 'a\n'],
    ]) expect(applyChanges(a!, textChanges(a!, b!)), JSON.stringify([a, b])).toBe(b)
  })

  it('随机文字：按改动应用后得到目标', () => {
    for (const start of [7, 11, 12345, 99991])
      fuzz(start)
  })

  function fuzz(start: number) {
    let seed = start
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
    const pieces = ['甲', '乙', 'a', 'b', '\n', '\n\n', ' ', '。']
    const gen = () => Array.from({ length: rnd(30) }, () => pieces[rnd(pieces.length)]).join('')
    for (let i = 0; i < 3000; i++) {
      const a = gen()
      const b = rnd(2) ? gen() : a.slice(0, rnd(a.length + 1)) + gen() + a.slice(rnd(a.length + 1))
      const cs = textChanges(a, b)
      expect(applyChanges(a, cs), JSON.stringify({ a, b, cs })).toBe(b)
      for (let k = 1; k < cs.length; k++) expect(cs[k]!.from).toBeGreaterThanOrEqual(cs[k - 1]!.to)
    }
  }
})

describe('merge3Fine：同一行两边改的不是同一处，按字合并', () => {
  const base = '# 笔记\n\n![](../../附件/课程/ecp/Lecture05%20笔记/image-1.png)\n\n下面一段。\n'
  it('一边在行尾接着打字、一边把链接改回去：两样都留下', () => {
    const local = base.replace('image-1.png)', 'image-1.png) 图：这是比较静态的示意')
    const remote = base.replace('课程/ecp/Lecture05%20笔记/', '')
    expect(merge3Fine(base, local, remote)).toEqual({ text: '# 笔记\n\n![](../../附件/image-1.png) 图：这是比较静态的示意\n\n下面一段。\n', conflict: false })
  })
  it('两边改的是同一处：冲突，text 是 local 原样', () => {
    const local = base.replace('![](', '![示意图](')
    const remote = base.replace('![](../../附件/课程/ecp/Lecture05%20笔记/', '![a](../../附件/')
    expect(merge3Fine(base, local, remote)).toEqual({ text: local, conflict: true })
  })
  it('按行合得了的照按行合（不进按字那一步）', () => {
    expect(merge3Fine('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n')).toEqual({ text: 'A\nb\nC\n', conflict: false })
  })
})

describe('两边都只往末尾加了字（第 6 轮）：两边的都留下，编辑器里的在前，不算冲突', () => {
  const base = '---\ncreated: 2026-11-14 21:20\n---\n极光要看太阳风和云量。维克附近光污染少。\n'
  const link = base + '\n相关：[[极光预报]]\n'
  it('用户在末尾空行上打了一句（没回车）、梦游在末尾补一行双链', () => {
    const local = base + '维克的黑沙滩也能看。'
    const want = base + '维克的黑沙滩也能看。\n相关：[[极光预报]]\n'
    expect(merge3Fine(base, local, link)).toEqual({ text: want, conflict: false })
    expect(reconcile(base, local, link)).toEqual({ kind: 'update', text: want, merged: true })
  })
  it('两边各在末尾加一整行', () => {
    expect(merge3Fine('a\nb\n', 'a\nb\n本地\n', 'a\nb\n外面\n')).toEqual({ text: 'a\nb\n本地\n外面\n', conflict: false })
    expect(reconcile('a\nb\n', 'a\nb\n本地\n', 'a\nb\n外面\n')).toEqual({ kind: 'update', text: 'a\nb\n本地\n外面\n', merged: true })
  })
  it('用户在最后一行行尾接着打、外面在末尾另起一行', () => {
    expect(reconcile('a\nb', 'a\nb接着打', 'a\nb\n外面加的\n')).toEqual({ kind: 'update', text: 'a\nb接着打\n外面加的\n', merged: true })
  })
  it('两边都在最后一行行尾接着打：还是冲突（分不清谁该在前）', () => {
    expect(merge3Fine('a\nb', 'a\nb本地', 'a\nb外面')).toEqual({ text: 'a\nb本地', conflict: true })
  })
  it('不在末尾的同一处照旧算冲突', () => {
    expect(merge3Fine('a\nb\nc\n', 'a\nb\n本地\nc\n', 'a\nb\n外面\nc\n')).toEqual({ text: 'a\nb\n本地\nc\n', conflict: true })
  })
})
