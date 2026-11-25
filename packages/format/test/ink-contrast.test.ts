// 墨水对比度（2026-11-25 用户看了 143「可以」，红 #9f2323、蓝 #1e4aa4）：十套主题 × 红 / 蓝 / 橙 / 黑 × 白板底 / 卡片底 / 便签底。
// 深色主题照 PencilKit 反亮度（darkInk）算实际画出来的颜色。主题的底色读 packages/design/src/themes.css；
// 便签纸色取自白板装饰的 NOTE_PAPER（ink-decor.ts，Mac 的 decor.css 和 iPad 的 DecorPaint 都照它），每色三档都算、取最低。
// 低于 3:1 的列在 LOW 里，变了这条测试就红，提醒重新看。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { darkInk, INK_COLORS, inkColor, NOTE_PAPER } from '../src'

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

const css = readFileSync(join(__dirname, '../../design/src/themes.css'), 'utf8')
const SKINS = [...css.matchAll(/\[data-skin='(\w+)'\] \{([^}]*)\}/g)].map((m) => ({
  id: m[1]!,
  dark: /color-scheme: dark/.test(m[2]!),
  board: /--board: (#[0-9a-f]{6})/.exec(m[2]!)![1]!,
  card: /--card: (#[0-9a-f]{6})/.exec(m[2]!)![1]!,
}))

const PAPER_LIGHT = Object.values(NOTE_PAPER).flatMap((p) => p.light)
const PAPER_DARK = Object.values(NOTE_PAPER).flatMap((p) => p.dark)

const INKS: Record<string, string> = { 黑: INK_COLORS[0], 蓝: INK_COLORS[1], 红: INK_COLORS[2], 橙: INK_COLORS[4] }

/** 每套主题、每种墨水在三种底上的对比度（便签取 18 种纸色里最低的） */
export function inkContrastTable() {
  return SKINS.flatMap((s) =>
    Object.entries(INKS).map(([name, c]) => {
      const drawn = s.dark ? darkInk(c) : c
      return {
        skin: s.id,
        tone: s.dark ? '深' : '浅',
        ink: name,
        drawn,
        board: ratio(drawn, s.board),
        card: ratio(drawn, s.card),
        note: Math.min(...(s.dark ? PAPER_DARK : PAPER_LIGHT).map((p) => ratio(drawn, p))),
      }
    }),
  )
}

describe('墨水对比度（十套主题 × 白板底 / 卡片底 / 便签底）', () => {
  const table = inkContrastTable()
  const r2 = (v: number) => Math.round(v * 100) / 100

  it('色板是新值；文件里的旧红旧蓝照新值画（文件不动）', () => {
    expect(INKS).toEqual({ 黑: '#1d2421', 蓝: '#1e4aa4', 红: '#9f2323', 橙: '#e08a00' })
    expect(inkColor('#d64545')).toBe('#9f2323')
    expect(inkColor('#2459C6')).toBe('#1e4aa4')
    expect(inkColor('#d6454580')).toBe('#9f232380')
    expect(inkColor('#12805a')).toBe('#12805a')
  })

  it('红、蓝在十套主题的白板底和卡片底上都不低于 3:1（深色按 PencilKit 反亮度画出来的颜色算）', () => {
    for (const row of table.filter((x) => x.ink === '红' || x.ink === '蓝')) {
      expect(row.board, `${row.skin} ${row.ink} 白板`).toBeGreaterThanOrEqual(3)
      expect(row.card, `${row.skin} ${row.ink} 卡片`).toBeGreaterThanOrEqual(3)
    }
  })

  it('低于 3:1 的（变了就重新看）', () => {
    const low = table.flatMap((x) =>
      (['board', 'card', 'note'] as const).filter((k) => x[k] < 3).map((k) => `${x.skin}${x.tone} ${x.ink} ${{ board: '白板', card: '卡片', note: '便签' }[k]} ${r2(x[k])}`),
    )
    expect(low).toEqual([
      'mint浅 橙 白板 2.5',
      'mint浅 橙 卡片 2.69',
      'mint浅 橙 便签 1.64',
      'sky浅 橙 白板 2.49',
      'sky浅 橙 卡片 2.69',
      'sky浅 橙 便签 1.64',
      'sakura浅 橙 白板 2.51',
      'sakura浅 橙 卡片 2.69',
      'sakura浅 橙 便签 1.64',
      'lilac浅 橙 白板 2.47',
      'lilac浅 橙 卡片 2.69',
      'lilac浅 橙 便签 1.64',
      'stone浅 橙 白板 2.62',
      'stone浅 橙 卡片 2.69',
      'stone浅 橙 便签 1.64',
      'pine深 蓝 便签 2.14',
      'pine深 红 便签 2.1',
      'petrol深 蓝 便签 2.14',
      'petrol深 红 便签 2.1',
      'cocoa深 蓝 便签 2.14',
      'cocoa深 红 便签 2.1',
      'ink深 蓝 便签 2.14',
      'ink深 红 便签 2.1',
      'graphite深 蓝 便签 2.14',
      'graphite深 红 便签 2.1',
    ])
  })
})
