import { describe, expect, it } from 'vitest'
import { isTrStyle, shownTrStyle, TR_STYLES, trStyleYields } from '../src/shared/trStyles'

describe('译文样式和意群下划线', () => {
  it('十二种样式', () => {
    expect(TR_STYLES).toHaveLength(12)
    expect(isTrStyle('marker')).toBe(true)
    expect(isTrStyle('wavy')).toBe(false)
  })

  it('意群下划线开着时，三种下划线和马克笔不画，别的照常', () => {
    for (const s of ['dash', 'solid', 'dot', 'marker'] as const) {
      expect(trStyleYields(s, true, 'underline')).toBe(true)
      expect(shownTrStyle(s, true, 'underline')).toBe('text')
    }
    for (const s of ['text', 'fill', 'line', 'dbox', 'box', 'hl', 'blur', 'fade'] as const) expect(shownTrStyle(s, true, 'underline')).toBe(s)
  })

  it('意群关着或用文字着色时，选哪种画哪种', () => {
    expect(shownTrStyle('dash', false, 'underline')).toBe('dash')
    expect(shownTrStyle('dash', true, 'text')).toBe('dash')
    expect(trStyleYields('marker', true, 'text')).toBe(false)
  })
})
