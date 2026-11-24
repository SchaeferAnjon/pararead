/**
 * 数据库算行：数据源文件夹里的每一篇是一条，按视图筛选、排序、分组（看板按状态分列、日历按日期排）；
 * 每一格的值：开头的属性、公式、汇总（顺着关联去数）、关联（连到那边哪几篇）。
 *
 * 纯函数，不读文件：调用的人把数据源文件夹（和关联连到的文件夹，relatedFolders）里的笔记给进来（路径和字）。
 * 只看不写：这里算出来的东西不写进任何一篇笔记（打开再保存不变第 1、3 条）；改一格见 base-write.ts。
 */
import { aiStoredType } from './base-ai'
import { type BaseDoc, type BaseSort, type BaseView, effectiveFilter, type GroupPeriod, type PropDef, relatedFolders } from './base-doc'
import { dateOf, evalExpr, ExprFail, type ExprEnv, type FormulaScope, isDateV, linkLabel, localDay, parseExpr, sortCmp, truthy, type Val, valCmp, valText } from './base-expr'
import { type BaseFilter, type FilterItem, isGroup, itemExpr } from './base-filter'
import { colType, DEFAULT_STATUS_GROUPS, type FieldType, listOf, type StatusGroup } from './base-types'
import { HIDDEN_KEYS, readFields } from './props'

/** 给进来的一篇笔记 */
export interface BaseRecord {
  path: string
  text: string
}

/** 读好的一条记录 */
export interface BaseRec {
  path: string
  /** 名字：文件名去掉 .md */
  name: string
  folder: string
  text: string
  /** 开头一行的值（同 readProps，去了引号） */
  props: Record<string, string>
  /** 值是一串的那几项（多选、关联） */
  lists: Record<string, string[]>
}

/** 关联列连着的一篇：path 是 null 时那边没有这一篇（对不上） */
export interface RelLink {
  /** 文件里写的样子：[[练习 3.1]] */
  raw: string
  /** 那一篇的名字 */
  name: string
  path: string | null
}

/** 一格 */
export interface Cell {
  value: Val
  /** 给人看的字（日期是 2026-11-17，界面上自己写成 11月17日） */
  text: string
  /** 公式算不出、汇总顺着的不是关联列：一句话（格子里空着，悬停看这句） */
  error?: string
  /** 汇总「勾了几个 / 共几个」：小进度条 */
  progress?: [number, number]
  /** 关联列：连到那边哪几篇 */
  links?: RelLink[]
  /** 算出来的（公式、汇总）：不能改，右栏写「算出来的」 */
  computed?: boolean
}

export interface BaseCtx {
  doc: BaseDoc
  /** 今天 2026-11-22（算 today()、最近 N 天） */
  today: string
  /** 数据源文件夹里的每一条 */
  recs: BaseRec[]
  /** 关联连到的文件夹 → 那里的每一篇 */
  related: Map<string, BaseRec[]>
  /** 每一列的类型：设过的照设的，没设的按值猜；公式列是 formula.X → formula，名字列 file.name → title */
  types: Record<string, FieldType>
  memo: Map<BaseRec, Map<string, Cell>>
}

const NUM = /^-?\d+(?:\.\d+)?$/
const nameOf = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const inFolder = (p: string, f: string) => /\.md$/i.test(p) && (f === '' || p.startsWith(f + '/'))

export function recOf(r: BaseRecord): BaseRec {
  const { props, lists } = readFields(r.text)
  return { path: r.path, name: nameOf(r.path), folder: dirOf(r.path), text: r.text, props, lists }
}

/**
 * 算行之前先读一遍：records 是数据源文件夹里的笔记（多给了别的文件夹的也行，按数据源挑）；
 * opts.related：关联连到的文件夹里的笔记（文件夹 → 笔记）；opts.today：今天（测试时给定）
 */
export function baseContext(doc: BaseDoc, records: BaseRecord[], opts: { related?: Record<string, BaseRecord[]>; today?: Date | string } = {}): BaseCtx {
  const today = typeof opts.today === 'string' ? opts.today : localDay(opts.today ?? new Date())
  const recs = doc.folder === null ? [] : records.filter((r) => inFolder(r.path, doc.folder!)).map(recOf)
  const related = new Map<string, BaseRec[]>()
  for (const f of relatedFolders(doc)) related.set(f, f === doc.folder ? recs : (opts.related?.[f] ?? records).filter((r) => inFolder(r.path, f)).map(recOf))
  const types: Record<string, FieldType> = { 'file.name': 'title' }
  const seen: string[] = []
  for (const r of recs) for (const k of [...Object.keys(r.props), ...Object.keys(r.lists)]) if (!HIDDEN_KEYS.has(k) && !seen.includes(k)) seen.push(k)
  for (const k of seen) types[k] = recs.some((r) => Object.hasOwn(r.lists, k)) ? 'multi' : colType(recs.map((r) => r.props[k] ?? ''))
  for (const [k, d] of Object.entries(doc.props)) types[k] = d.type === 'ai' ? aiStoredType(d) : d.type
  for (const k of Object.keys(doc.formulas)) types['formula.' + k] = 'formula'
  return { doc, today, recs, related, types, memo: new Map() }
}

/** 一列（视图 order 里写的 id）的类型 */
export function colTypeOf(ctx: BaseCtx, col: string): FieldType {
  if (col === 'file.name' || col === 'file.basename') return 'title'
  if (col.startsWith('formula.')) return 'formula'
  const key = col.replace(/^note\./, '')
  const d = ctx.doc.props[key]
  if (d?.type === 'ai') return aiStoredType(d)
  return d?.type ?? ctx.types[key] ?? (Object.hasOwn(ctx.doc.formulas, key) ? 'formula' : 'text')
}

// ---------------------------------------------------------------- 一格的值

/** 开头一行的字按列的类型变成值 */
function typed(raw: string, t: FieldType): Val {
  const s = raw.trim()
  if (s === '') return t === 'check' ? false : null
  switch (t) {
    case 'number':
      return NUM.test(s) ? Number(s) : s
    case 'check':
      return /^(true|yes|on)$/i.test(s) ? true : /^(false|no|off)$/i.test(s) ? false : s
    case 'date':
      return dateOf(s) ?? s
    case 'multi':
    case 'relation':
      return listOf(s)
    case 'text':
    case 'select':
    case 'status':
    case 'url':
    case 'title':
      return s
  }
  return guess(s)
}

/** 不知道类型的（关联那边的属性）：按样子猜 */
function guess(s: string): Val {
  if (s === '') return null
  if (NUM.test(s)) return Number(s)
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s)
  const d = dateOf(s)
  if (d) return d
  if (/^\[.*\]$/.test(s)) return listOf(s)
  return s
}

/** 一条记录开头这一项的值 */
export function fieldValue(ctx: BaseCtx, rec: BaseRec, key: string): Val {
  const t: FieldType | undefined = ctx.types[key]
  const list = rec.lists[key]
  const raw = rec.props[key]
  if (t === 'multi' || t === 'relation') return list ?? (raw !== undefined ? listOf(raw) : [])
  if (raw === undefined) return list ?? (t === 'check' ? false : null)
  return t ? typed(raw, t) : guess(raw)
}

/** 关联那边的一篇（不在这个数据库里，类型按样子猜） */
const otherValue = (rec: BaseRec, key: string): Val => (key === 'file.name' ? rec.name : rec.lists[key] ?? (rec.props[key] !== undefined ? guess(rec.props[key]!) : null))

/** 双链里写的是哪一篇：[[练习/练习 3.1|三点一]] → 练习/练习 3.1；没加引号读成 [x] 的也认 */
export function linkTarget(raw: string): string {
  let t = raw.trim()
  const m = /^\[\[([^\]|#^]*)/.exec(t) ?? /^\[([^\]|#^]*)\]$/.exec(t)
  if (m) t = m[1]!
  return t.trim().replace(/\.md$/i, '')
}

function findRec(pool: BaseRec[], target: string): BaseRec | null {
  if (!target) return null
  if (target.includes('/')) {
    const hit = pool.find((r) => r.path.replace(/\.md$/i, '') === target || r.path.replace(/\.md$/i, '').endsWith('/' + target))
    if (hit) return hit
  }
  const name = target.split('/').pop()!
  return pool.find((r) => r.name === name) ?? pool.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null
}

/** 关联列这一条连着那边哪几篇 */
export function relationLinks(ctx: BaseCtx, rec: BaseRec, prop: string): RelLink[] {
  const def = ctx.doc.props[prop]
  const pool = def?.type === 'relation' ? (ctx.related.get(def.to) ?? []) : []
  const v = fieldValue(ctx, rec, prop)
  const items = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []
  return items.map((raw) => {
    const hit = findRec(pool, linkTarget(raw))
    return { raw, name: hit?.name ?? linkTarget(raw).split('/').pop()!, path: hit?.path ?? null }
  })
}

/** 那边的一篇被这个数据库里哪几条连着（关联选择里写「也在第几讲」） */
export function linkedFrom(ctx: BaseCtx, prop: string, targetPath: string): BaseRec[] {
  return ctx.recs.filter((r) => relationLinks(ctx, r, prop).some((l) => l.path === targetPath))
}

/** 关联列能连哪几篇（那边文件夹里的每一篇，按名字排） */
export function relationChoices(ctx: BaseCtx, prop: string): BaseRec[] {
  const def = ctx.doc.props[prop]
  if (def?.type !== 'relation') return []
  return [...(ctx.related.get(def.to) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
}

function relationCell(ctx: BaseCtx, rec: BaseRec, prop: string): Cell {
  const links = relationLinks(ctx, rec, prop)
  return { value: links.map((l) => l.raw), text: links.map((l) => l.name).join(', '), links }
}

/** 汇总：顺着关联列去数那边每一篇的某一列 */
function rollupCell(ctx: BaseCtx, rec: BaseRec, name: string): Cell {
  const def = ctx.doc.props[name] as Extract<PropDef, { type: 'rollup' }>
  const via = ctx.doc.props[def.via]
  if (via?.type !== 'relation') return { value: null, text: '', error: `「${name}」顺着的「${def.via}」不是关联列`, computed: true }
  const targets = relationLinks(ctx, rec, def.via)
    .map((l) => (l.path ? (ctx.related.get(via.to) ?? []).find((r) => r.path === l.path) : null))
    .filter((r): r is BaseRec => !!r)
  const vals = targets.map((t) => otherValue(t, def.prop))
  const nums = vals.flatMap((v) => (typeof v === 'number' ? [v] : typeof v === 'string' && NUM.test(v) ? [Number(v)] : []))
  const out = (value: Val, extra: Partial<Cell> = {}): Cell => ({ value, text: valText(value), computed: true, ...extra })
  switch (def.calc) {
    case 'count':
      return out(targets.length)
    case 'checked':
      return out(vals.filter((v) => v === true).length)
    case 'checked/all': {
      const c = vals.filter((v) => v === true).length
      const all = targets.length
      return all ? { value: c / all, text: `${c}/${all}`, progress: [c, all], computed: true } : { value: null, text: '', computed: true }
    }
    case 'sum':
      return out(nums.length ? nums.reduce((a, b) => a + b, 0) : null)
    case 'average':
      return out(nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null)
    case 'earliest':
    case 'latest': {
      let best: Val = null
      for (const v of vals) {
        if (v === null || v === '' || Array.isArray(v)) continue
        const c = best === null ? null : valCmp(v, best)
        if (best === null || (c !== null && (def.calc === 'earliest' ? c < 0 : c > 0))) best = v
      }
      return out(best)
    }
  }
}

function formulaCell(ctx: BaseCtx, rec: BaseRec, name: string, stack: string[]): Cell {
  const src = ctx.doc.formulas[name]
  if (src === undefined) return { value: null, text: '', error: `没有叫「${name}」的公式`, computed: true }
  const r = evalExpr(parseExpr(src), envOf(ctx, rec, [...stack, name]))
  return { value: r.value, text: valText(r.value), ...(r.error ? { error: r.error } : {}), computed: true }
}

/** 算公式、筛选时这一条的值从哪来：直接写的名字先认公式，再认汇总、关联、开头的属性；「名字」是文件名 */
function envOf(ctx: BaseCtx, rec: BaseRec, stack: string[]): ExprEnv {
  return {
    get(name, how) {
      if (how === 'note') return fieldValue(ctx, rec, name)
      if (how === 'formula' || Object.hasOwn(ctx.doc.formulas, name)) {
        if (!Object.hasOwn(ctx.doc.formulas, name)) return null
        if (stack.includes(name)) {
          const by = stack[stack.length - 1]!
          throw new ExprFail(by === name ? `「${name}」用到了它自己，算不出来` : `「${by}」和「${name}」互相用到，算不出来`)
        }
        const c = formulaCell(ctx, rec, name, stack)
        if (c.error) throw new ExprFail(c.error)
        return c.value
      }
      const def = ctx.doc.props[name]
      if (def?.type === 'rollup') return rollupCell(ctx, rec, name).value
      if (name === '名字' && !def && !Object.hasOwn(rec.props, name)) return rec.name
      return fieldValue(ctx, rec, name)
    },
    file: { name: rec.name, path: rec.path, folder: rec.folder, tags: (rec.lists.tags ?? listOf(rec.props.tags ?? '')).map(String) },
    today: ctx.today,
  }
}

/** 一格（col 是视图 order 里写的：file.name、formula.进度、属性名、note.属性名）；算过的记着 */
export function cellOf(ctx: BaseCtx, rec: BaseRec, col: string): Cell {
  let m = ctx.memo.get(rec)
  if (!m) ctx.memo.set(rec, (m = new Map()))
  const hit = m.get(col)
  if (hit) return hit
  const c = computeCell(ctx, rec, col)
  m.set(col, c)
  return c
}

function computeCell(ctx: BaseCtx, rec: BaseRec, col: string): Cell {
  if (col === 'file.name' || col === 'file.basename') return { value: rec.name, text: rec.name }
  if (col === 'file.path') return { value: rec.path, text: rec.path }
  if (col === 'file.folder') return { value: rec.folder, text: rec.folder }
  if (col.startsWith('formula.')) return formulaCell(ctx, rec, col.slice(8), [])
  const key = col.replace(/^note\./, '')
  const def = ctx.doc.props[key]
  if (!col.startsWith('note.')) {
    if (def?.type === 'rollup') return rollupCell(ctx, rec, key)
    if (def?.type === 'relation') return relationCell(ctx, rec, key)
    if (!def && !Object.hasOwn(ctx.types, key) && Object.hasOwn(ctx.doc.formulas, key)) return formulaCell(ctx, rec, key, [])
  }
  const v = fieldValue(ctx, rec, key)
  return { value: v, text: valText(v) }
}

// ---------------------------------------------------------------- 筛选、排序、分组

function itemHolds(ctx: BaseCtx, rec: BaseRec, x: FilterItem, errors: Set<string>): boolean {
  if (isGroup(x)) return groupHolds(ctx, rec, x, errors)
  const src = itemExpr(x)
  const p = parseExpr(src)
  if (!p.ok) {
    // 读不懂的一句：照以前，筛行时不算（原样留在文件里）
    errors.add(`「${src}」${p.error}`)
    return true
  }
  const r = evalExpr(p, envOf(ctx, rec, []))
  if (r.error) {
    errors.add(`「${src}」${r.error}`)
    return false
  }
  return truthy(r.value)
}

function groupHolds(ctx: BaseCtx, rec: BaseRec, f: BaseFilter, errors: Set<string>): boolean {
  if (!f.items.length) return true
  if (f.conj === 'or') return f.items.some((x) => itemHolds(ctx, rec, x, errors))
  if (f.conj === 'not') return !f.items.some((x) => itemHolds(ctx, rec, x, errors))
  return f.items.every((x) => itemHolds(ctx, rec, x, errors))
}

/** 这一条满不满足一个筛选（面板上「留下 N 条」、新建的一条在不在当前筛选里） */
export function recordHolds(ctx: BaseCtx, rec: BaseRec, f: BaseFilter | null): boolean {
  return !f || groupHolds(ctx, rec, f, new Set())
}

/** 按 sort 排（空的总在最后），一样的按名字（第2讲在第10讲前面） */
export function sortRecs(ctx: BaseCtx, recs: BaseRec[], sort: BaseSort[]): BaseRec[] {
  return [...recs].sort((a, b) => {
    for (const s of sort) {
      const d = sortCmp(cellOf(ctx, a, s.prop).value, cellOf(ctx, b, s.prop).value, s.desc)
      if (d) return d
    }
    return a.name.localeCompare(b.name, 'zh', { numeric: true })
  })
}

/** 一组：看板的一列、表格 / 画廊分组的一段 */
export interface RowGroup {
  /** 这一组的值（文件里写的样子，拖进来就改成它）；空的那一组是 '' */
  key: string
  label: string
  /** 状态在哪一组：0 待开始、1 进行中、2 完成（画圆点的颜色）；不是状态是 -1 */
  tone: number
  rows: BaseRec[]
  /** 日期列按月、按周分的一组：哪一年、几月（1–12）或第几周（ISO 周）、从哪天起（界面照这个写「11月」「第47周」） */
  period?: { by: GroupPeriod; year: number; num: number; start: string; thisYear: boolean }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 这一天在哪个 ISO 周：周一起，那一周的周四在哪一年就算哪一年（2026-11-22 → 2026 年第 47 周，周一 11-16） */
export function isoWeek(day: string): { year: number; week: number; start: string } {
  const d = new Date(day.slice(0, 10) + 'T00:00:00Z')
  const wd = (d.getUTCDay() + 6) % 7
  const mon = new Date(d.getTime() - wd * 86400000)
  const thu = new Date(mon.getTime() + 3 * 86400000)
  const year = thu.getUTCFullYear()
  const ordinal = Math.round((thu.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1
  return { year, week: Math.floor((ordinal - 1) / 7) + 1, start: mon.toISOString().slice(0, 10) }
}

/** 日期列按月 / 按周分组：组的键 2026-11、2026-W47；名字今年的写「11月」「第47周」，别的年份带上年 */
function periodGroups(ctx: BaseCtx, rows: BaseRec[], prop: string, by: GroupPeriod, desc: boolean): RowGroup[] {
  const byKey = new Map<string, RowGroup>()
  const empty: RowGroup = { key: '', label: '没填', tone: -1, rows: [] }
  const thisYear = Number(ctx.today.slice(0, 4))
  for (const r of rows) {
    const v = cellOf(ctx, r, prop).value
    const day = isDateV(v) ? v.date : typeof v === 'string' ? (dateOf(v)?.date ?? null) : null
    if (!day) {
      empty.rows.push(r)
      continue
    }
    let key: string
    let period: NonNullable<RowGroup['period']>
    if (by === 'month') {
      const year = Number(day.slice(0, 4))
      const num = Number(day.slice(5, 7))
      key = day.slice(0, 7)
      period = { by, year, num, start: key + '-01', thisYear: year === thisYear }
    } else {
      const w = isoWeek(day)
      key = `${w.year}-W${pad2(w.week)}`
      period = { by, year: w.year, num: w.week, start: w.start, thisYear: w.year === thisYear }
    }
    let g = byKey.get(key)
    if (!g) {
      const yearText = period.thisYear ? '' : `${period.year}年`
      byKey.set(key, (g = { key, label: yearText + (by === 'month' ? `${period.num}月` : `第${period.num}周`), tone: -1, rows: [], period }))
    }
    g.rows.push(r)
  }
  const sorted = [...byKey.values()].sort((a, b) => (desc ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)))
  return [...sorted, empty]
}

/** 状态的几组和每组的选项：设过的照设的（没设用 待开始 / 进行中 / 完成）；文件里写了、组里没有的值放进第一组 */
export function statusGroups(ctx: BaseCtx, prop: string): StatusGroup[] {
  const def = ctx.doc.props[prop]
  const groups = (def?.type === 'status' ? def.groups : DEFAULT_STATUS_GROUPS).map((g) => ({ name: g.name, options: [...g.options] }))
  if (!groups.length) groups.push({ name: '待开始', options: [] })
  const known = new Set(groups.flatMap((g) => g.options))
  for (const r of ctx.recs) {
    const v = (r.props[prop] ?? '').trim()
    if (v && !known.has(v)) {
      known.add(v)
      groups[0]!.options.push(v)
    }
  }
  return groups
}

/** 状态值在哪一组（画圆点颜色）：不在任何一组是 -1 */
export function statusTone(ctx: BaseCtx, prop: string, value: string): number {
  return statusGroups(ctx, prop).findIndex((g) => g.options.includes(value))
}

/**
 * 按一列分组：状态按选项（组的先后），勾选分是 / 否，多选、关联一条可以在几组里，别的按值；最后是「没填」。
 * by：日期列按月、按周分（组按时间排，desc 是新的在前）
 */
export function groupRows(ctx: BaseCtx, rows: BaseRec[], prop: string, desc = false, by?: GroupPeriod): RowGroup[] {
  if (by) return periodGroups(ctx, rows, prop, by, desc)
  const t = colTypeOf(ctx, prop)
  if (t === 'status') {
    const groups: RowGroup[] = statusGroups(ctx, prop).flatMap((g, tone) => g.options.map((o) => ({ key: o, label: o, tone, rows: [] as BaseRec[] })))
    const empty: RowGroup = { key: '', label: '没填', tone: -1, rows: [] }
    for (const r of rows) {
      const v = (r.props[prop] ?? '').trim()
      ;(groups.find((g) => g.key === v) ?? empty).rows.push(r)
    }
    return [...(desc ? groups.reverse() : groups), empty]
  }
  if (t === 'check') {
    const yes: RowGroup = { key: 'true', label: '是', tone: -1, rows: [] }
    const no: RowGroup = { key: 'false', label: '否', tone: -1, rows: [] }
    for (const r of rows) (cellOf(ctx, r, prop).value === true ? yes : no).rows.push(r)
    return desc ? [no, yes] : [yes, no]
  }
  const many = t === 'multi' || t === 'relation'
  const byKey = new Map<string, { group: RowGroup; value: Val }>()
  const empty: RowGroup = { key: '', label: '没填', tone: -1, rows: [] }
  for (const r of rows) {
    const c = cellOf(ctx, r, prop)
    const vals: { key: string; label: string; value: Val }[] = many
      ? (c.links ?? (Array.isArray(c.value) ? c.value : []).map((x) => ({ raw: String(x), name: linkLabel(String(x)) }))).map((x) => ({ key: x.raw, label: x.name, value: x.name }))
      : c.value === null || c.value === '' || (Array.isArray(c.value) && !c.value.length)
        ? []
        : [{ key: c.text, label: c.text, value: c.value }]
    if (!vals.length) empty.rows.push(r)
    for (const v of vals) {
      let g = byKey.get(v.key)
      if (!g) byKey.set(v.key, (g = { group: { key: v.key, label: v.label, tone: -1, rows: [] }, value: v.value }))
      if (!g.group.rows.includes(r)) g.group.rows.push(r)
    }
  }
  const sorted = [...byKey.values()].sort((a, b) => sortCmp(a.value, b.value, desc)).map((x) => x.group)
  return [...sorted, empty]
}

/** 一个视图算出来的样子 */
export interface ViewResult {
  view: BaseView
  /** 筛完、排好的每一条 */
  rows: BaseRec[]
  /** 数据源里一共几条、筛掉了几条（块头「4 条 · 筛掉 4 条」） */
  total: number
  hidden: number
  /** 按哪一列分组（看板没写 groupBy 时是第一个状态列）；没分组是 null */
  groupProp: string | null
  groups: RowGroup[] | null
  /** 日历按哪一列（没写 date 时是第一个日期列）、每天有哪几条、没排日子的 */
  dateProp: string | null
  days: Record<string, BaseRec[]> | null
  undated: BaseRec[] | null
  /** 筛选里读不懂、算不出的句子（读不懂的筛行时不算） */
  errors: string[]
}

/** 看板没写分组时按哪一列：第一个状态列，没有就第一个选项列 */
export function defaultGroupProp(ctx: BaseCtx): string | null {
  return Object.entries(ctx.doc.props).find(([, d]) => d.type === 'status')?.[0] ?? Object.keys(ctx.types).find((k) => ctx.types[k] === 'status' || ctx.types[k] === 'select') ?? null
}

/** 日历没写 date 时按哪一列：第一个日期列 */
export function defaultDateProp(ctx: BaseCtx): string | null {
  return Object.keys(ctx.types).find((k) => ctx.types[k] === 'date') ?? null
}

/** 算一个视图：筛选（所有视图都满足的 + 这个视图自己的）、排序、分组、日历 */
export function queryView(ctx: BaseCtx, i: number): ViewResult {
  const doc = ctx.doc
  const at = doc.views[i] ? i : 0
  const view = doc.views[at]!
  const errors = new Set<string>()
  const f = effectiveFilter(doc, at)
  const rows = sortRecs(
    ctx,
    ctx.recs.filter((r) => !f || groupHolds(ctx, r, f, errors)),
    view.sort,
  )
  const groupProp = view.groupBy?.prop ?? (view.kind === 'kanban' ? defaultGroupProp(ctx) : null)
  const groups = groupProp && view.kind !== 'calendar' ? groupRows(ctx, rows, groupProp, view.groupBy?.desc ?? false, view.kind === 'kanban' ? undefined : view.groupBy?.by) : null
  let dateProp: string | null = null
  let days: Record<string, BaseRec[]> | null = null
  let undated: BaseRec[] | null = null
  if (view.kind === 'calendar') {
    dateProp = view.date ?? defaultDateProp(ctx)
    days = {}
    undated = []
    for (const r of rows) {
      const v = dateProp ? cellOf(ctx, r, dateProp).value : null
      if (v !== null && isDateV(v)) (days[v.date] ??= []).push(r)
      else undated.push(r)
    }
  }
  return { view, rows, total: ctx.recs.length, hidden: ctx.recs.length - rows.length, groupProp, groups, dateProp, days, undated, errors: [...errors] }
}

// ---------------------------------------------------------------- 列、右栏、公式框

/** 一列的说法 */
export interface ColumnInfo {
  /** 视图 order 里写的 */
  id: string
  /** 给人看的名字：名字、进度、状态 */
  label: string
  type: FieldType
  /** 算出来的（公式、汇总）：不能改 */
  computed: boolean
}

export function columnInfo(ctx: BaseCtx, id: string): ColumnInfo {
  const type = colTypeOf(ctx, id)
  const label = id === 'file.name' || id === 'file.basename' ? '名字' : id.replace(/^(note|formula)\./, '')
  return { id, label, type, computed: type === 'formula' || type === 'rollup' }
}

/** 这个数据库所有的列：名字、开头出现过的属性（软件自己用的键不算）、设过的列（关联、汇总、状态）、公式 */
export function allColumns(ctx: BaseCtx): ColumnInfo[] {
  const ids = ['file.name', ...Object.keys(ctx.types).filter((k) => k !== 'file.name' && !k.startsWith('formula.'))]
  for (const k of Object.keys(ctx.doc.props)) if (!ids.includes(k)) ids.push(k)
  for (const k of Object.keys(ctx.doc.formulas)) ids.push('formula.' + k)
  return ids.map((id) => columnInfo(ctx, id))
}

/** 右栏打开一条：属性在上（视图里的列在前，然后是这一篇开头别的属性、设过的列、公式），每一项带值 */
export function recordFields(ctx: BaseCtx, path: string, view?: number): { col: ColumnInfo; cell: Cell }[] {
  const rec = ctx.recs.find((r) => r.path === path)
  if (!rec) return []
  const ids: string[] = []
  const add = (id: string) => {
    const k = id.replace(/^note\./, '')
    if (id === 'file.name' || ids.includes(id) || ids.includes(k) || HIDDEN_KEYS.has(k)) return
    ids.push(id)
  }
  if (view !== undefined) for (const c of ctx.doc.views[view]?.columns ?? []) add(c)
  for (const k of [...Object.keys(rec.props), ...Object.keys(rec.lists)]) add(k)
  for (const k of Object.keys(ctx.doc.props)) add(k)
  for (const k of Object.keys(ctx.doc.formulas)) add('formula.' + k)
  return ids.map((id) => ({ col: columnInfo(ctx, id), cell: cellOf(ctx, rec, id) }))
}

/** 公式框查写法用：这个数据库的列名和公式 */
export function formulaScope(ctx: BaseCtx): FormulaScope {
  return { columns: allColumns(ctx).filter((c) => c.type !== 'formula').map((c) => c.label), formulas: ctx.doc.formulas }
}

/** 公式框「常用」：按这个数据库有的数字列、日期列给几条（没有就少给） */
export function formulaExamples(ctx: BaseCtx): { label: string; expr: string }[] {
  const ref = (n: string) => (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(n) ? n : `note["${n.replace(/"/g, '\\"')}"]`)
  const nums = allColumns(ctx).filter((c) => c.type === 'number').map((c) => ref(c.label))
  const dates = allColumns(ctx).filter((c) => c.type === 'date').map((c) => ref(c.label))
  const out: { label: string; expr: string }[] = []
  if (nums.length >= 2) {
    const [a, b] = nums as [string, string]
    out.push({ label: '进度百分比', expr: `(${a} / ${b} * 100).round() + "%"` })
    out.push({ label: '还差多少', expr: `${b} - ${a}` })
    out.push({ label: '完成了吗', expr: `if(${a} >= ${b}, "完成", "还差 " + (${b} - ${a}))` })
  }
  if (dates.length) out.push({ label: `离${dates[0]}还有几天`, expr: `if(${dates[0]}.isEmpty(), "", ${dates[0]} - today())` })
  return out
}

/** 预览一条公式（公式框「前 4 条算出来」）：不用先存进 base 块 */
export function previewFormula(ctx: BaseCtx, src: string, recs: BaseRec[]): { rec: BaseRec; cell: Cell }[] {
  const p = parseExpr(src)
  return recs.map((rec) => {
    const r = evalExpr(p, envOf(ctx, rec, []))
    return { rec, cell: { value: r.value, text: valText(r.value), ...(r.error ? { error: r.error } : {}), computed: true } }
  })
}

// ---------------------------------------------------------------- 画廊、日历

/** 画廊的封面：正文里第一张图（![](…)、![[图.png]]、<img src>）写的地址；没有图返回 null（界面露前几行字） */
export function coverOf(text: string): string | null {
  const body = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  let fence: string | null = null
  for (const line of body.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1]!
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence) continue
    const hits = [/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(line), /!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp|svg|heic|bmp|avif))(?:[|#][^\]]*)?\]\]/i.exec(line), /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(line)]
      .filter((m): m is RegExpExecArray => !!m)
      .sort((a, b) => a.index - b.index)
    if (hits.length) return hits[0]![1]!.trim()
  }
  return null
}

/** 日历上拖到另一天：换成那一天，原来带的钟点留着（2026-11-24 10:00 → 2026-11-25 10:00） */
export function dateMoved(old: string, day: string): string {
  const m = /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2}(?::\d{2})?)$/.exec(old.trim())
  return m ? day + m[1] : day
}

/**
 * 画廊卡片没图时露的前几行（2026-11-22 用户定「没图露前几行字」）：正文去掉开头属性、标题行、代码块、图、行尾块编号和记号，
 * 一行一行留着（界面按行画、几行以后截掉）；长了截到 max 个字加省略号
 */
export function previewOf(text: string, max = 140): string {
  const body = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  const out: string[] = []
  let fence: string | null = null
  for (const raw of body.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(raw)
    if (f) {
      if (!fence) fence = f[1]!
      else if (raw.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence || /^\s*#{1,6}\s/.test(raw)) continue
    const line = raw
      .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi, '')
      .replace(/^\s*(?:>\s*)+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*|__|==|~~|`/g, '')
      .replace(/\s\^[\w-]+\s*$/, '')
      .trim()
    if (line) out.push(line)
  }
  const s = out.join('\n')
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : s
}

/**
 * 看板卡片、画廊卡片上露哪几列（名字另画）：视图自己写了列就照它（去掉名字和分组那一列）；
 * 没写（看板、画廊默认只有名字）照第一个写了列的表格视图，去掉名字、分组那一列和关联列（顺着关联的汇总留着）；
 * 画廊只露状态 / 选项和日期（原型「● 学完 · 11月10日」）
 */
export function cardColumns(ctx: BaseCtx, i: number, groupProp: string | null): string[] {
  const view = ctx.doc.views[i] ?? ctx.doc.views[0]!
  const key = (c: string) => c.replace(/^note\./, '')
  const skip = (c: string) => c === 'file.name' || c === 'file.basename' || (groupProp !== null && key(c) === groupProp)
  if (view.columns.some((c) => c !== 'file.name' && c !== 'file.basename')) return view.columns.filter((c) => !skip(c))
  const table = ctx.doc.views.find((v) => v.kind === 'table' && v.columns.length > 1)
  const from = table ? table.columns : allColumns(ctx).map((c) => c.id)
  const cols = from.filter((c) => !skip(c) && colTypeOf(ctx, key(c)) !== 'relation')
  if (view.kind !== 'cards') return cols
  return cols.filter((c) => ['status', 'select', 'date'].includes(colTypeOf(ctx, key(c))))
}
