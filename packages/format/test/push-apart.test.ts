import { describe, expect, it } from 'vitest'
import { BOARD_COL_GAP, BOARD_COL_W, pushApart } from '../src/doc-board'

const at = (m: Map<string, number>) => Object.fromEntries(m)

describe('pushApart：列加宽以后原来按 276 摆的位置画的时候推开', () => {
  it('原来并排的三列（隔 298）推成隔 422，不写文件', () => {
    expect(at(pushApart([{ id: 'a', x: 0 }, { id: 'b', x: 298 }, { id: 'c', x: 596 }]))).toEqual({ a: 0, b: BOARD_COL_W + BOARD_COL_GAP, c: 2 * (BOARD_COL_W + BOARD_COL_GAP) })
  })
  it('原来空得更开的只留最多 22 的空隙；够宽不叠的不动', () => {
    expect(at(pushApart([{ id: 'a', x: 0 }, { id: 'b', x: 340 }, { id: 'c', x: 2000 }]))).toEqual({ a: 0, b: 422, c: 2000 })
  })
  it('上下摞着的（x 差不到 276）跟着左边那个一起推', () => {
    const m = pushApart([{ id: 'a', x: 0 }, { id: 'b', x: 300 }, { id: 'b2', x: 320 }])
    expect(m.get('b')).toBe(422)
    expect(m.get('b2')).toBe(442)
  })
  it('照新宽摆过的再算一次不变（推开的结果写回文件以后不再推）', () => {
    const once = pushApart([{ id: 'a', x: 0 }, { id: 'b', x: 298 }, { id: 'c', x: 596 }, { id: 'd', x: 610 }])
    const again = pushApart([...once].map(([id, x]) => ({ id, x })))
    expect(at(again)).toEqual(at(once))
  })
  it('左边那个被推过来压上了，右边原来不叠的也让开', () => {
    // b 被 a 推到 422，右边 c 在 800：b 画到 822，c 要让到 844
    expect(pushApart([{ id: 'a', x: 0 }, { id: 'b', x: 300 }, { id: 'c', x: 800 }]).get('c')).toBe(844)
  })
})
