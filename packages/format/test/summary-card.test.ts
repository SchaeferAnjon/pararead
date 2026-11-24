/**
 * 「AI 总结的」卡写成 `> [!ai] AI 总结 · …` 提示块（task-5yp97，用户看图选「选法 1」：这样能选一句开旁支）。
 * 以前存的（编号行 `<!-- card id=… ai=日期 -->` 后面一段普通的字）第一次打开时一次转好：只转那一张卡，别的一个字不动；
 * 转完再按新写法读，它是一张 AI 卡、旁支挂得上；再转一次不变（打开再保存不变那条规矩：转换只做一次）。
 */
import { describe, expect, test } from 'vitest'
import { aiCallout, convertBoard, convertSummaryCards, docAiBlocks, isSummaryHead, needsSummaryConvert, sideInsert, splitDoc, summaryCallout } from '../src'
import { OLD_BOARDS } from './fixtures'

const OLD = [
  '---',
  'type: board',
  '---',
  '# 注意力白板',
  '',
  '<!-- card id=s1 ai=2026-11-21 -->',
  '这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，',
  '最后用权重把 V 加起来。',
  '',
  '我自己写的一段，不是总结。',
  '',
  '## 讲解',
  '',
  '先拿 Q 和每个 K 做点积，得到「该看谁」的分数。',
  '',
].join('\n')

describe('「AI 总结的」卡写成 AI 总结块', () => {
  test('新存的总结：头一行「AI 总结 · 哪家 · 哪个模型」，每行前面「> 」、空行「>」', () => {
    expect(summaryCallout('第一句。\n第二句。\n\n第三句。', 'Claude Code · Opus 5.5')).toBe('> [!ai] AI 总结 · Claude Code · Opus 5.5\n> 第一句。\n> 第二句。\n>\n> 第三句。')
    // 不知道是哪家写的（以前存的卡转过来）：只写「AI 总结」，不编
    expect(summaryCallout('一句。')).toBe('> [!ai] AI 总结\n> 一句。')
    // 已经是提示块了：原样
    expect(summaryCallout('> [!ai] AI 总结\n> 一句。')).toBe('> [!ai] AI 总结\n> 一句。')
    // 和 AI 讲解同一个写法，只是头一个词不一样
    expect(aiCallout({ label: 'AI 总结', by: 'Codex', text: '一句。' })).toBe('> [!ai] AI 总结 · Codex\n> 一句。')
    expect(isSummaryHead('> [!ai] AI 总结 · Claude Code · Opus 5.5')).toBe(true)
    expect(isSummaryHead('> [!ai] AI 总结')).toBe(true)
    expect(isSummaryHead('AI 总结 · Codex')).toBe(true)
    expect(isSummaryHead('> [!ai] AI 讲解 · Claude Code · Opus 5.5')).toBe(false)
    expect(isSummaryHead('> [!ai] AI 总结的卡片怎么写')).toBe(false)
  })

  test('以前存的总结卡：只转编号行管着的那一张卡，别的一个字不动；转完是一张 AI 卡、还带着 ai= 日期', () => {
    expect(needsSummaryConvert(OLD)).toBe(true)
    const r = convertSummaryCards(OLD)
    expect(r.cards).toBe(1)
    expect(r.text).toBe(
      OLD.replace(
        '这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，\n最后用权重把 V 加起来。',
        '> [!ai] AI 总结\n> 这块白板讲了注意力的三步：先拿 Q 和每个 K 做点积得到分数，分数除以 √d 再过 softmax 变成权重，\n> 最后用权重把 V 加起来。',
      ),
    )
    const card = splitDoc(r.text).columns[0]!.cards.find((u) => u.attrs?.ai)!
    expect(card.kind).toBe('callout')
    expect(card.attrs).toEqual({ ai: '2026-11-21' })
    expect(splitDoc(r.text).total).toBe(splitDoc(OLD).total)
    // 再转一次不变、不再要转
    expect(needsSummaryConvert(r.text)).toBe(false)
    expect(convertSummaryCards(r.text)).toEqual({ text: r.text, cards: 0 })
  })

  test('转完能开旁支：选总结里的一句，`> [!side]` 挂在总结块后面、我自己写的那段前面', () => {
    const t = convertSummaryCards(OLD).text
    const [b, ...rest] = docAiBlocks(t)
    expect(rest).toEqual([])
    const ins = sideInsert(t, b!, 0, { q: '为什么要除以 √d？', a: 'd 越大，点积的数也越大。' }, '分数除以 √d 再过 softmax 变成权重，')
    const out = t.slice(0, ins.at) + ins.insert + t.slice(ins.at)
    expect(out).toContain('> 最后用权重把 V 加起来。\n\n> [!side] 为什么要除以 √d？\n> > 分数除以 √d 再过 softmax 变成权重，\n>\n> d 越大，点积的数也越大。\n\n我自己写的一段，不是总结。')
    // 白板上旁支和总结还是一张卡
    expect(splitDoc(out).total).toBe(splitDoc(t).total)
  })

  test('拖到空白处的、列里的、列表写的都转；AI 讲解卡（已经是提示块）、没有 ai= 的卡、代码块里的不转；CRLF 照样留着', () => {
    const t = [
      '## 一',
      '',
      '<!-- card id=a1 x=40 y=80 ai=2026-11-20 -->',
      '- 路线定了',
      '- 住宿差两晚',
      '',
      '<!-- card id=a2 ai=2026-11-21 -->',
      '> [!ai] AI 讲解 · Claude Code · Opus 5.5',
      '> 早就是提示块了。',
      '',
      '<!-- card id=a3 -->',
      '连线的一头，不是总结。',
      '',
      '```',
      '<!-- card id=a4 ai=2026-11-21 -->',
      '代码块里的',
      '```',
      '',
    ].join('\n')
    const r = convertSummaryCards(t)
    expect(r.cards).toBe(1)
    expect(r.text).toContain('<!-- card id=a1 x=40 y=80 ai=2026-11-20 -->\n> [!ai] AI 总结\n> - 路线定了\n> - 住宿差两晚\n')
    expect(r.text).toContain('<!-- card id=a2 ai=2026-11-21 -->\n> [!ai] AI 讲解 · Claude Code · Opus 5.5\n> 早就是提示块了。')
    expect(r.text).toContain('<!-- card id=a3 -->\n连线的一头，不是总结。')
    expect(r.text).toContain('```\n<!-- card id=a4 ai=2026-11-21 -->\n代码块里的\n```')
    const crlf = '<!-- card id=s1 ai=2026-11-21 -->\r\n一句。\r\n第二句。\r\n\r\n别的。\r\n'
    expect(convertSummaryCards(crlf).text).toBe('<!-- card id=s1 ai=2026-11-21 -->\r\n> [!ai] AI 总结\r\n> 一句。\r\n> 第二句。\r\n\r\n别的。\r\n')
    // 导图、旧写法的白板不转（旧写法打开时先转白板，那一步把总结卡一起写成提示块）
    expect(needsSummaryConvert('---\ntype: board\n白板样式: 导图\n---\n# 导图\n\n<!-- card id=a1 x=1 y=2 w=280 ai=2026-11-21 -->\n一段\n')).toBe(false)
    expect(needsSummaryConvert('# 普通文档\n\n一段。\n')).toBe(false)
  })

  test('旧写法的白板转写法时，AI 总结的卡整张写成一个 AI 总结块（几段也是一张卡，不拆开），位置、编号、ai= 都留着', () => {
    const old = OLD_BOARDS['冰岛自驾.md']!
    const r = convertBoard(old)
    expect(r.text).toMatch(/<!-- card id=k5 x=\d+ y=\d+ ai=2026-11-19 -->\n> \[!ai\] AI 总结\n> 三句话总结：路线定了，住宿差两晚，装备齐了。\n/)
    const two = '---\ntype: board\n---\n<!-- card id=k5 x=700 y=40 w=300 ai=2026-11-19 -->\n第一句。\n\n第二句。\n\n<!-- card id=k6 x=40 y=40 w=280 -->\n别的卡\n'
    const t = convertBoard(two).text
    expect(t).toContain('<!-- card id=k5 x=704 y=104 ai=2026-11-19 -->\n> [!ai] AI 总结\n> 第一句。\n>\n> 第二句。\n')
    const placed = splitDoc(t).placed
    expect(placed.map((u) => u.place!.id)).toEqual(['k5', 'k6'])
    expect(placed[0]!.kind).toBe('callout')
    expect(needsSummaryConvert(t)).toBe(false)
  })
})
