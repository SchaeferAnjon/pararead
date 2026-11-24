/**
 * 表底计算（照 Notion 的 Calculate，2026-11-22 数据库第三批「表底合计」）：每个视图每一列选一种算法，写进视图的 summaries
 * （名字照旧借 Obsidian：Sum、Average……，多出来的 Count、PercentFilled、PercentEmpty、SumShare、PercentChecked）。
 * 分组时每组按同一种算法出小计（写在组头，组收起时也在）；「求和，组里画占比」在组头画这组占全部几成。
 *
 * 公式列、汇总列照算出来的值算（cellOf），按值的样子归到数字 / 日期 / 勾选；别的列照列的类型。
 * 只看不写：这里算的不写进任何一篇。
 */
import { dateOf, isDateV, linkLabel, numText, type Val } from './base-expr'
import { type BaseCtx, type BaseRec, cellOf, colTypeOf } from './base-rows'
import { listOf } from './base-types'

export type SummaryId =
  | 'Count'
  | 'Filled'
  | 'Empty'
  | 'Unique'
  | 'PercentFilled'
  | 'PercentEmpty'
  | 'Sum'
  | 'SumShare'
  | 'Average'
  | 'Median'
  | 'Min'
  | 'Max'
  | 'Range'
  | 'Earliest'
  | 'Latest'
  | 'Checked'
  | 'Unchecked'
  | 'PercentChecked'

/** 一列按哪一种算：数字（数字列、算出数字的公式和汇总）、日期、勾选、别的（文字、选项、多选、关联……） */
export type SumKind = 'number' | 'date' | 'check' | 'other'

/** 每种列都有的计数类（照原型的先后） */
const COUNTS: SummaryId[] = ['Count', 'Filled', 'Empty', 'Unique', 'PercentFilled', 'PercentEmpty']

/** 点表底一格出的菜单：每段一组（「不算」在最上面，界面自己画） */
export const SUMMARY_MENU: Record<SumKind, SummaryId[][]> = {
  number: [['Sum', 'SumShare', 'Average', 'Median', 'Min', 'Max', 'Range'], COUNTS],
  date: [['Earliest', 'Latest', 'Range'], COUNTS],
  check: [['Checked', 'Unchecked', 'PercentChecked'], ['Count']],
  other: [COUNTS],
}

const ALL_IDS = new Set<string>(Object.values(SUMMARY_MENU).flat(2))
/** 文件里写的是不是认得的算法（大小写照 Obsidian；认不出的界面上照写原字、不算） */
export const isSummaryId = (id: string): id is SummaryId => ALL_IDS.has(id)

/** 算出来的一格：text 是给测试、给别的地方用的字（32、88%、3210、2026-11-18、2天）；num 是数（占比条、排序用）；kind 告诉界面怎么写 */
export interface Summary {
  text: string
  num: number | null
  kind: 'count' | 'percent' | 'number' | 'date' | 'days' | 'none'
}

const NONE: Summary = { text: '', num: null, kind: 'none' }
const NUM = /^-?\d+(?:\.\d+)?$/

const blank = (v: Val) => v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
const numOf = (v: Val): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && NUM.test(v.trim()) ? Number(v) : null)
const dayOf = (v: Val): string | null => (isDateV(v) ? v.date : typeof v === 'string' ? (dateOf(v)?.date ?? null) : null)
const keyOf = (v: Val): string[] => (Array.isArray(v) ? v.flatMap(keyOf) : isDateV(v) ? [v.date] : typeof v === 'string' ? [linkLabel(v.trim())] : [String(v)])
const n = (x: number, kind: Summary['kind'] = 'number'): Summary => ({ text: numText(x), num: x, kind })
const pct = (a: number, all: number): Summary => (all ? { text: `${Math.round((a / all) * 100)}%`, num: Math.round((a / all) * 100), kind: 'percent' } : NONE)

/** 算一种：vals 是这一列每一条的值（空的也在，算「全部条数」「空着的」要用）；kind 决定「最大减最小」是数还是天数 */
export function summarizeVals(id: string, kind: SumKind, vals: Val[]): Summary {
  const filled = vals.filter((v) => !blank(v))
  const nums = filled.map(numOf).filter((x): x is number => x !== null)
  const days = filled
    .map(dayOf)
    .filter((x): x is string => x !== null)
    .sort()
  const total = nums.reduce((a, b) => a + b, 0)
  const checked = vals.filter((v) => v === true).length
  switch (id) {
    case 'Count':
      return n(vals.length, 'count')
    case 'Filled':
      return n(filled.length)
    case 'Empty':
      return n(vals.length - filled.length)
    case 'Unique':
      return n(new Set(filled.flatMap(keyOf)).size)
    case 'PercentFilled':
      return pct(filled.length, vals.length)
    case 'PercentEmpty':
      return pct(vals.length - filled.length, vals.length)
    case 'Sum':
    case 'SumShare':
      return n(total)
    case 'Average':
      return nums.length ? n(total / nums.length) : NONE
    case 'Median': {
      if (!nums.length) return NONE
      const s = [...nums].sort((a, b) => a - b)
      const m = s.length >> 1
      return n(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2)
    }
    case 'Min':
      return nums.length ? n(Math.min(...nums)) : NONE
    case 'Max':
      return nums.length ? n(Math.max(...nums)) : NONE
    case 'Range': {
      if (kind === 'date') {
        if (!days.length) return NONE
        const d = Math.round((Date.parse(days[days.length - 1]!) - Date.parse(days[0]!)) / 86400000)
        return { text: `${d}天`, num: d, kind: 'days' }
      }
      return nums.length ? n(Math.max(...nums) - Math.min(...nums)) : NONE
    }
    case 'Earliest':
      return days.length ? { text: days[0]!, num: null, kind: 'date' } : NONE
    case 'Latest':
      return days.length ? { text: days[days.length - 1]!, num: null, kind: 'date' } : NONE
    case 'Checked':
      return n(checked)
    case 'Unchecked':
      return n(vals.length - checked)
    case 'PercentChecked':
      return pct(checked, vals.length)
  }
  return NONE
}

/** 这一列按哪一种算：公式、汇总按算出来的值的样子（都是数就是数字……），一个值都没有时公式当别的、汇总当数字 */
export function sumKind(ctx: BaseCtx, col: string, recs: BaseRec[] = ctx.recs): SumKind {
  const t = colTypeOf(ctx, col)
  if (t === 'number') return 'number'
  if (t === 'date') return 'date'
  if (t === 'check') return 'check'
  if (t !== 'formula' && t !== 'rollup') return 'other'
  const vals = recs.map((r) => cellOf(ctx, r, col).value).filter((v) => !blank(v))
  if (!vals.length) return t === 'rollup' ? 'number' : 'other'
  if (vals.every((v) => numOf(v) !== null)) return 'number'
  if (vals.every((v) => dayOf(v) !== null)) return 'date'
  if (vals.every((v) => typeof v === 'boolean')) return 'check'
  return 'other'
}

/** 这几条在这一列上按 id 算（表底用这个视图筛完的每一条，组头用这一组的） */
export function summaryOf(ctx: BaseCtx, recs: BaseRec[], col: string, id: string, kind: SumKind = sumKind(ctx, col)): Summary {
  const t = colTypeOf(ctx, col)
  const vals = recs.map((r) => {
    const v = cellOf(ctx, r, col).value
    // 勾选列没写的当没勾；文件里写成 "true" 的字也认
    if (t === 'check') return v === true || (typeof v === 'string' && /^true$/i.test(v.trim()))
    return v
  })
  return summarizeVals(id, kind, vals)
}

/** 组头占比条：这一组在这一列上的和占全部（all：这个视图筛完的每一条）几成，0–1；全部是 0 时 null */
export function shareOf(ctx: BaseCtx, group: BaseRec[], all: BaseRec[], col: string): number | null {
  const sum = (rs: BaseRec[]) => rs.reduce((a, r) => a + (numOf(cellOf(ctx, r, col).value) ?? 0), 0)
  const whole = sum(all)
  if (!whole) return null
  return Math.min(1, Math.max(0, sum(group) / whole))
}

/** 第二批的表头用的老接口：values 是每一条开头写的字，按列的类型读成值再算 */
export function summarizeText(id: string, type: string, values: string[]): Summary {
  const kind: SumKind = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'check' ? 'check' : 'other'
  const vals: Val[] = values.map((raw) => {
    const s = raw.trim()
    if (type === 'check') return /^true$/i.test(s)
    if (s === '' || s === '[]') return null
    if (type === 'multi') return listOf(s)
    if (type === 'number') return NUM.test(s) ? Number(s) : s
    if (type === 'date') return dateOf(s) ?? s
    return s
  })
  return summarizeVals(id, kind, vals)
}
