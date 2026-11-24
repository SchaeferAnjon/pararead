/**
 * AI 讲解提示块头一行跟库语言（task-zojmg）：中文库照旧，英文库写「AI explanation (v2) · … · Saw page 5」；
 * 读的时候两种都认（一个库里两种都可能有：英文界面建的库、中文库里贴进来的英文笔记）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { aiCallout, aiCalloutHead, EN_CALLOUT_WORDS, isSummaryHead, parseAiCalloutHead, setCalloutWords, summaryCallout, ZH_CALLOUT_WORDS } from '../src'

afterEach(() => setCalloutWords(ZH_CALLOUT_WORDS))

describe('AI 讲解头跟库语言', () => {
  it('默认中文，和以前一字不差', () => {
    expect(aiCalloutHead({ version: 2, by: 'Claude Code · Opus 5.5', seen: ZH_CALLOUT_WORDS.seenPage(5) })).toBe('AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页')
    expect(summaryCallout('一段总结', 'Claude Code')).toBe('> [!ai] AI 总结 · Claude Code\n> 一段总结')
  })

  it('英文库写英文', () => {
    setCalloutWords(EN_CALLOUT_WORDS)
    const w = EN_CALLOUT_WORDS
    expect(aiCalloutHead({ version: 2, by: 'Claude Code · Opus 5.5', seen: w.seenPage(5) })).toBe('AI explanation (v2) · Claude Code · Opus 5.5 · Saw page 5')
    expect(aiCallout({ text: 'Answer.', seen: w.seenFrame('00:06', { from: '00:00', to: '00:36' }) })).toBe('> [!ai] AI explanation · Saw the frame at 00:06 and subtitles 00:00–00:36\n> Answer.')
    expect(summaryCallout('A summary', 'Claude Code')).toBe('> [!ai] AI summary · Claude Code\n> A summary')
  })

  it('两种都认：版本、看了什么、哪一家、是不是总结', () => {
    expect(parseAiCalloutHead('AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页')).toEqual({ version: 2, by: 'Claude Code · Opus 5.5', seen: '看了第 5 页' })
    expect(parseAiCalloutHead('AI explanation (v3) · Codex · GPT-5 · Saw page 5')).toEqual({ version: 3, by: 'Codex · GPT-5', seen: 'Saw page 5' })
    expect(isSummaryHead('> [!ai] AI 总结 · Claude Code')).toBe(true)
    expect(isSummaryHead('> [!ai] AI summary · Claude Code')).toBe(true)
    expect(isSummaryHead('> [!ai] AI explanation · Claude Code')).toBe(false)
  })
})
