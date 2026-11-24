/**
 * 数据库的筛选：一行一条，第二行起选「且 / 或」；「加一组」在里面另算且 / 或（只套一层，和 Notion 一样）。
 * 写进 base 块是视图自己的 filters，and 里套 or，每一条是一句筛选表达式（写法见 base-expr.ts）：
 *
 *     filters:
 *       and:
 *         - 状态 != "学完"
 *         - or:
 *             - 日期 <= today() + "7d"
 *             - 日期.isEmpty()
 *
 * 筛选面板能改的那几种句子读成 BaseCond（哪一列、什么条件、值），别的句子原样留着（raw），照样算、写回时一个字不动。
 * 日期的值除了 2026-11-24 还能是「今天 / 7天后 / 7天前」：写成 today()、today() + "7d"、today() - "7d"。
 */
import { type Ast, exprRef, parseExpr } from './base-expr'
import type { ColType, FieldType } from './base-types'
import type { Y } from './base-yaml'

/**
 * 条件：== != > >= < <=，包含 / 不包含，为空 / 不为空，最近 N 天（以前的写法 x >= today() - "7d"）。
 * 日期比较的值可以是相对今天的：today()、today() + "7d"、today() - "30d"
 */
export type BaseOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'notcontains' | 'empty' | 'notempty' | 'days'

export interface BaseCond {
  /** 哪一列：属性名、file.name（名字）、formula.进度（公式） */
  prop: string
  op: BaseOp
  value: string
}

/** 认不出的一句：原样留着，照样算（写法对的话），写回时一个字不动 */
export interface RawCond {
  raw: string
}

/** 一组：conj 是「全部满足」and / 「满足任一」or（Obsidian 的 not「都不满足」也认，面板上不改） */
export interface BaseFilter {
  conj: 'and' | 'or' | 'not'
  items: FilterItem[]
}

export type FilterItem = BaseCond | RawCond | BaseFilter

export const isGroup = (x: FilterItem): x is BaseFilter => 'items' in x
export const isRaw = (x: FilterItem): x is RawCond => 'raw' in x

// ---------------------------------------------------------------- 一句 ↔ 条件

const REL = /^today\(\)(?: ([+-]) "(\d+)([dwMy])")?$/

/** 值是不是「相对今天」：today()、today() + "7d" */
export const isRelDay = (v: string) => REL.test(v)

/** 相对今天的值：0 → today()，7 → today() + "7d"，-7 → today() - "7d" */
export function relDay(n: number, unit: 'd' | 'w' | 'M' | 'y' = 'd'): string {
  if (!n) return 'today()'
  return `today() ${n > 0 ? '+' : '-'} "${Math.abs(Math.round(n))}${unit}"`
}

/** 日期值给人看：今天、7天后、7天前、2周后、1个月后、1年后；具体日子照写 */
export function dayLabel(v: string): string {
  const m = REL.exec(v)
  if (!m) return v
  if (!m[1]) return '今天'
  const unit = { d: '天', w: '周', M: '个月', y: '年' }[m[3] as 'd' | 'w' | 'M' | 'y']
  return `${m[2]}${unit}${m[1] === '+' ? '后' : '前'}`
}

const propOf = (n: Ast): string | null => {
  if (n.k === 'name') return n.name === 'file' || n.name === 'note' || n.name === 'formula' ? null : n.name
  if (n.k === 'note') return n.name
  if (n.k === 'formula') return 'formula.' + n.name
  if (n.k === 'file' && (n.field === 'name' || n.field === 'basename')) return 'file.name'
  return null
}

/** 比较右边的值：字、数（照写的样子）、是 / 否、today() 和 today() ± "7d" */
function valueOf(n: Ast, src: string): string | null {
  if (n.k === 'lit') {
    if (typeof n.v === 'string') return n.v
    if (typeof n.v === 'number') return src.slice(n.at, n.end).trim()
    if (typeof n.v === 'boolean') return String(n.v)
    return null
  }
  if (n.k === 'call' && (n.f === 'today' || n.f === 'now') && !n.args.length) return 'today()'
  if (n.k === 'un' && n.op === '-' && n.a.k === 'lit' && typeof n.a.v === 'number') return '-' + src.slice(n.a.at, n.a.end).trim()
  if (n.k === 'bin' && (n.op === '+' || n.op === '-') && n.a.k === 'call' && (n.a.f === 'today' || n.a.f === 'now') && !n.a.args.length && n.b.k === 'lit' && typeof n.b.v === 'string') {
    const m = /^\s*(\d+)\s*(d|days?|w|weeks?|M|months?|y|years?)\s*$/.exec(n.b.v)
    if (!m) return null
    const unit = m[2]!.startsWith('d') ? 'd' : m[2]!.startsWith('w') ? 'w' : m[2]!.startsWith('M') || m[2]!.startsWith('month') ? 'M' : 'y'
    return `today() ${n.op} "${m[1]}${unit}"`
  }
  return null
}

function condFromAst(n: Ast, src: string): BaseCond | null {
  if (n.k === 'un' && n.op === '!' && n.a.k === 'method') {
    const c = condFromAst(n.a, src)
    if (c?.op === 'empty') return { ...c, op: 'notempty' }
    if (c?.op === 'contains') return { ...c, op: 'notcontains' }
    return null
  }
  if (n.k === 'method') {
    const prop = propOf(n.target)
    if (!prop) return null
    if (n.m === 'isEmpty' && !n.args.length) return { prop, op: 'empty', value: '' }
    if (n.m === 'contains' && n.args.length === 1) {
      const v = valueOf(n.args[0]!, src)
      return v === null || v.startsWith('today()') ? null : { prop, op: 'contains', value: v }
    }
    return null
  }
  if (n.k === 'bin' && ['==', '!=', '>', '>=', '<', '<='].includes(n.op)) {
    const prop = propOf(n.a)
    const value = prop ? valueOf(n.b, src) : null
    if (!prop || value === null) return null
    const days = /^today\(\) - "(\d+)d"$/.exec(value)
    if (n.op === '>=' && days) return { prop, op: 'days', value: days[1]! }
    return { prop, op: n.op as BaseOp, value }
  }
  return null
}

// 以前的读法（列名里带 - 这种，新写法要写成 note["a-b"]；以前的表头写出过 a-b == 1）
const PROP = String.raw`(?:note\[\s*"([^"]+)"\s*\]|(?:note\.)?(file\.name|[^\s=!<>.()"'\[\]]+))`
const LIT = String.raw`(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(-?\d+(?:\.\d+)?|true|false))`
const CMP = new RegExp(String.raw`^${PROP}\s*(==|!=|>=|<=|>|<)\s*${LIT}$`)
const CALL = new RegExp(String.raw`^${PROP}\.(contains|isEmpty)\(\s*(?:${LIT})?\s*\)$`)
const identLike = (p: string) => p === 'file.name' || /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(p)
const unescape = (s: string) => s.replace(/\\(["\\])/g, '$1')

/**
 * 一句筛选 → 条件（筛选面板能改的那几种）；别的（两列比、别的函数、套着的括号）返回 null，原样留着。
 *   状态 == "在读" · 评分 >= 8 · 作者.contains("明") · 读完.isEmpty() · !读完.isEmpty() · !作者.contains("明")
 *   日期 <= today() + "7d" · 读完 >= today() - "7d"（最近 7 天） · note["读 完"] > "2026-01-01" · file.name.contains("史")
 */
export function parseCond(expr: string): BaseCond | null {
  const t = expr.trim()
  const p = parseExpr(t)
  if (p.ok) {
    const c = condFromAst(p.ast, t)
    if (c) return c
  }
  const c = CMP.exec(t)
  if (c && !identLike(c[1] ?? c[2]!)) return { prop: c[1] ?? c[2]!, op: c[3] as BaseOp, value: unescape(c[4] ?? c[5] ?? c[6] ?? '') }
  const f = CALL.exec(t)
  if (f && !identLike(f[1] ?? f[2]!)) {
    const prop = f[1] ?? f[2]!
    if (f[3] === 'isEmpty') return { prop, op: 'empty', value: '' }
    return { prop, op: 'contains', value: unescape(f[4] ?? f[5] ?? f[6] ?? '') }
  }
  return null
}

const quoted = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
/** 数字、true / false 不加引号（开头的属性里它们是数字和勾选），别的加 */
const literal = (v: string) => (/^(-?\d+(\.\d+)?|true|false)$/.test(v) ? v : quoted(v))

/** 条件 → 一句筛选（写进 base 块） */
export function condExpr(c: BaseCond): string {
  const p = exprRef(c.prop)
  switch (c.op) {
    case 'contains':
      return `${p}.contains(${quoted(c.value)})`
    case 'notcontains':
      return `!${p}.contains(${quoted(c.value)})`
    case 'empty':
      return `${p}.isEmpty()`
    case 'notempty':
      return `!${p}.isEmpty()`
    case 'days':
      return `${p} >= today() - "${Math.max(1, Math.round(Number(c.value) || 7))}d"`
  }
  return `${p} ${c.op} ${isRelDay(c.value) ? c.value : literal(c.value)}`
}

/** 一条（条件或原样的一句）写成的那一句 */
export const itemExpr = (x: BaseCond | RawCond) => (isRaw(x) ? x.raw : condExpr(x))

// ---------------------------------------------------------------- 面板上的条件、小标签

/** 每种列能选的条件（照原型）；value：要不要填值 */
export const FILTER_OPS: Record<FieldType, { op: BaseOp; label: string; value: boolean }[]> = {
  title: [
    { op: 'contains', label: '包含', value: true },
    { op: '==', label: '是', value: true },
  ],
  text: [
    { op: 'contains', label: '包含', value: true },
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'empty', label: '为空', value: false },
    { op: 'notempty', label: '不为空', value: false },
  ],
  status: [
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  select: [
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'empty', label: '为空', value: false },
    { op: 'notempty', label: '不为空', value: false },
  ],
  multi: [
    { op: 'contains', label: '包含', value: true },
    { op: 'notcontains', label: '不包含', value: true },
    { op: 'empty', label: '为空', value: false },
    { op: 'notempty', label: '不为空', value: false },
  ],
  date: [
    { op: '<=', label: '早于', value: true },
    { op: '>=', label: '晚于', value: true },
    { op: '==', label: '是', value: true },
    { op: 'empty', label: '为空', value: false },
    { op: 'notempty', label: '不为空', value: false },
  ],
  number: [
    { op: '==', label: '=', value: true },
    { op: '!=', label: '≠', value: true },
    { op: '>', label: '>', value: true },
    { op: '>=', label: '≥', value: true },
    { op: '<', label: '<', value: true },
    { op: '<=', label: '≤', value: true },
  ],
  check: [{ op: '==', label: '是', value: true }],
  url: [
    { op: 'contains', label: '包含', value: true },
    { op: '==', label: '是', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  relation: [
    { op: 'notempty', label: '不为空', value: false },
    { op: 'empty', label: '为空', value: false },
    { op: 'contains', label: '包含', value: true },
  ],
  rollup: [
    { op: '==', label: '是', value: true },
    { op: 'contains', label: '包含', value: true },
  ],
  formula: [
    { op: '==', label: '是', value: true },
    { op: 'contains', label: '包含', value: true },
  ],
  // 按钮列没有值，不能筛
  button: [],
}

/** 日期的值能选哪几个（照原型：今天、7天后、30天后，或者挑一天） */
export const DAY_CHOICES: { value: string; label: string }[] = [
  { value: relDay(0), label: '今天' },
  { value: relDay(7), label: '7天后' },
  { value: relDay(30), label: '30天后' },
]

/** 列表里没有的条件（以前写的 < > 最近 N 天）也有个说法 */
const OTHER_OPS: Record<string, string> = { '==': '是', '!=': '不是', '>': '>', '>=': '≥', '<': '<', '<=': '≤', contains: '包含', notcontains: '不包含', empty: '为空', notempty: '不为空', days: '最近 N 天' }
const DATE_OTHER: Record<string, string> = { '<': '早于（不含那天）', '>': '晚于（不含那天）', '!=': '不是' }

/** 这种列这个条件叫什么 */
export function opLabel(op: BaseOp, type: FieldType): string {
  return FILTER_OPS[type]?.find((o) => o.op === op)?.label ?? (type === 'date' ? DATE_OTHER[op] : undefined) ?? OTHER_OPS[op] ?? op
}

/** 列名给人看：file.name 是「名字」，formula.进度 是「进度」 */
export const colLabel = (c: string) => (c === 'file.name' ? '名字' : c.replace(/^(note|formula)\./, ''))

/** 一条的小标签：「状态 不是 学完」「日期 早于 7天后」「日期 为空」「读完 最近 7 天」「在读 否」 */
export function condText(c: BaseCond, type: FieldType): string {
  const name = colLabel(c.prop)
  if (type === 'check' && c.op === '==') return `${name} ${c.value === 'true' ? '是' : '否'}`
  if (c.op === 'days') return `${name} 最近 ${c.value} 天`
  if (c.op === 'empty' || c.op === 'notempty') return `${name} ${opLabel(c.op, type)}`
  return `${name} ${opLabel(c.op, type)} ${isRelDay(c.value) ? dayLabel(c.value) : c.value}`
}

/** 整个筛选的小标签（照原型）：「状态 不是 学完 且 （日期 早于 7天后 或 日期 为空）」 */
export function filterText(f: BaseFilter, typeOf: (col: string) => FieldType): string {
  const one = (x: FilterItem): string => {
    if (isGroup(x)) {
      const inner = x.items.map(one).join(x.conj === 'or' ? ' 或 ' : ' 且 ')
      return x.conj === 'not' ? `不（${inner}）` : `（${inner}）`
    }
    return isRaw(x) ? x.raw : condText(x, typeOf(x.prop))
  }
  const body = f.items.map(one).join(f.conj === 'or' ? ' 或 ' : ' 且 ')
  return f.conj === 'not' ? `不（${body}）` : body
}

/** 一共几条（组里的也数，照原型「筛选 3」） */
export const filterCount = (f: BaseFilter | null): number => (f ? f.items.reduce((n, x) => n + (isGroup(x) ? filterCount(x) : 1), 0) : 0)

/** 面板上能不能改：最外一层且 / 或，里面最多再套一层且 / 或（not、套两层的去「改写法」里改） */
export function filterEditable(f: BaseFilter | null): boolean {
  if (!f) return true
  if (f.conj === 'not') return false
  return f.items.every((x) => !isGroup(x) || (x.conj !== 'not' && x.items.every((y) => !isGroup(y))))
}

/** 两个筛选是不是一样（写回时一样的就不动文件） */
export function sameItem(a: FilterItem | null, b: FilterItem | null): boolean {
  if (!a || !b) return a === b
  if (isGroup(a) || isGroup(b)) return isGroup(a) && isGroup(b) && a.conj === b.conj && a.items.length === b.items.length && a.items.every((x, i) => sameItem(x, b.items[i]!))
  if (isRaw(a) || isRaw(b)) return isRaw(a) && isRaw(b) && a.raw.trim() === b.raw.trim()
  return a.prop === b.prop && a.op === b.op && a.value === b.value
}

/** 两层合成一层（所有视图都要满足的 + 这个视图自己的）：都是「全部满足」时摊平，别的套成组 */
export function mergeFilters(a: BaseFilter | null, b: BaseFilter | null): BaseFilter | null {
  if (!a || !a.items.length) return b
  if (!b || !b.items.length) return a
  const flat = (f: BaseFilter): FilterItem[] => (f.conj === 'and' ? f.items : [f])
  return { conj: 'and', items: [...flat(a), ...flat(b)] }
}

/** 只剩一项的组拆开（「全部满足」里只有一个「任一」组时就是那个组） */
export function simplifyFilter(f: BaseFilter | null): BaseFilter | null {
  if (!f || !f.items.length) return null
  if (f.conj !== 'not' && f.items.length === 1 && isGroup(f.items[0]!)) return simplifyFilter(f.items[0] as BaseFilter)
  return f
}

/** 列改名：条件里的列名、原样的句子里用到它的一起换（renameRef） */
export function renameInFilter(f: BaseFilter | null, map: (x: BaseCond | RawCond) => BaseCond | RawCond | null): BaseFilter | null {
  if (!f) return null
  const items: FilterItem[] = []
  for (const x of f.items) {
    if (isGroup(x)) {
      const g = renameInFilter(x, map)
      if (g && g.items.length) items.push(g)
    } else {
      const y = map(x)
      if (y) items.push(y)
    }
  }
  return { conj: f.conj, items }
}

// ---------------------------------------------------------------- 读 YAML 里的筛选

const asList = (y: Y | undefined): Y[] => (Array.isArray(y) ? y : y === undefined || y === '' ? [] : [y])

/** filters 下面那一块读成一组（一句、一串、and / or / not 都认；几个键并列时全部满足） */
export function filterFromYaml(y: Y | undefined): BaseFilter | null {
  if (y === undefined || y === '') return null
  if (typeof y === 'string') return { conj: 'and', items: [itemFromYaml(y)!] }
  if (Array.isArray(y)) return { conj: 'and', items: y.map(itemFromYaml).filter((x): x is FilterItem => x !== null) }
  const keys = Object.keys(y).filter((k) => k === 'and' || k === 'or' || k === 'not')
  const group = (k: string): BaseFilter => ({ conj: k as BaseFilter['conj'], items: asList(y[k]).map(itemFromYaml).filter((x): x is FilterItem => x !== null) })
  if (keys.length === 1) return group(keys[0]!)
  if (keys.length > 1) return { conj: 'and', items: keys.map(group) }
  return null
}

function itemFromYaml(y: Y): FilterItem | null {
  if (typeof y === 'string') {
    if (!y.trim()) return null
    return parseCond(y) ?? { raw: y.trim() }
  }
  return filterFromYaml(y)
}

/** 以前的列类型名（表头的筛选面板用的 BASE_OPS 还按这七种） */
export type { ColType }
