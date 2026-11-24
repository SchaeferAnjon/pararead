import { describe, expect, it } from 'vitest'
import { deviceCopyName, mergeParagraphs, splitParagraphs, splitSentences } from '../src'
import { PARA_CASES } from './para-cases'

// 两台设备同时改一篇，Git 同步时按段合并（原型 07-手机版/proto-merge.html）：不同段各留各的；同一句两边都改了，
// 原文用 keep 那边的，另一边另存副本。Mac 和手机用同一份规矩（Swift 那份 apps/apple/CanvasCore 用同一批样例对照）

describe('按段合并', () => {
  it('切段、切句首尾相接是原文', () => {
    for (const c of PARA_CASES) for (const t of [c.base, c.local, c.remote]) expect(splitParagraphs(t).join('')).toBe(t)
    expect(splitSentences('落地。取车！对面？\n晚上「好」。尾巴')).toEqual(['落地。', '取车！', '对面？', '\n', '晚上「好」。', '尾巴'])
  })

  it('改的是不同段：两边都留下，没有副本', () => {
    const c = PARA_CASES[0]!
    const r = mergeParagraphs(c.base, c.local, c.remote, 'remote')
    expect(r.copy).toBeNull()
    expect(r.text).toContain('记得带驾照')
    expect(r.text).toContain('可以在湖里潜水')
  })

  it('同一句两边都改了：原文用 keep 那边，副本用另一边，别处合好的两份都有', () => {
    const c = PARA_CASES[1]!
    const r = mergeParagraphs(c.base, c.local, c.remote, 'remote')
    expect(r.conflicts).toHaveLength(1)
    expect(r.text).toBe(c.remote)
    expect(r.copy).toBe(c.local)
    const l = mergeParagraphs(c.base, c.local, c.remote, 'local')
    expect(l.text).toBe(c.local)
    expect(l.copy).toBe(c.remote)
  })

  it('一边挪了一段、另一边改了这段的字：挪到新位置、字也是改过的', () => {
    const c = PARA_CASES[2]!
    const r = mergeParagraphs(c.base, c.local, c.remote, 'remote')
    expect(r.copy).toBeNull()
    expect(r.text).toContain('辛格维利尔国家公园：两块大陆板块中间的裂缝。\n\n黑沙滩 Vík，风大，离浪远一点。玄武岩柱很好拍。\n')
    expect(r.text.match(/黑沙滩/g)).toHaveLength(1)
  })

  it('同一段改了不同的句子：按句合并', () => {
    const c = PARA_CASES[3]!
    expect(mergeParagraphs(c.base, c.local, c.remote, 'remote')).toEqual({ text: '落地先去租四驱车。取车点在航站楼对面。晚上去泡蓝湖温泉。\n', copy: null, conflicts: [] })
  })

  it('两边都在文末加了一段：都留下，keep 那边在前', () => {
    const c = PARA_CASES[4]!
    expect(mergeParagraphs(c.base, c.local, c.remote, 'remote').text).toBe('第一段。\n\nMac 加的。\n\niPhone 加的。\n')
  })

  it('frontmatter 里两边各改一行：合得了', () => {
    const c = PARA_CASES[5]!
    expect(mergeParagraphs(c.base, c.local, c.remote, 'remote')).toEqual({ text: '---\n类型: 书摘\n课程: ecpc\n---\n# 题目\n', copy: null, conflicts: [] })
  })

  it('一边删了一段、另一边改了它：算冲突，keep 那边删了，副本里留着改过的', () => {
    const c = PARA_CASES[6]!
    const r = mergeParagraphs(c.base, c.local, c.remote, 'remote')
    expect(r.conflicts).toHaveLength(1)
    expect(r.text).toBe('甲。\n\n丙。\n')
    expect(r.copy).toBe('甲。\n\n乙改了。\n\n丙。\n')
  })

  it('快路：一边没改用另一边，原样', () => {
    expect(mergeParagraphs('a', 'a', 'b', 'local').text).toBe('b')
    expect(mergeParagraphs('a', 'b', 'a', 'remote').text).toBe('b')
    expect(mergeParagraphs('', '新写的\n', '', 'remote')).toEqual({ text: '新写的\n', copy: null, conflicts: [] })
  })

  it('副本的名字', () => {
    expect(deviceCopyName('冰岛旅游.md', 'iPhone')).toBe('冰岛旅游（iPhone 上的一版）.md')
    expect(deviceCopyName('冰岛旅游.md', 'iPad', 2)).toBe('冰岛旅游（iPad 上的一版 2）.md')
    expect(deviceCopyName('第 3 页.drawing', 'iPad')).toBe('第 3 页（iPad 上的一版）.drawing')
    expect(deviceCopyName('README', 'iPad')).toBe('README（iPad 上的一版）')
  })
})
