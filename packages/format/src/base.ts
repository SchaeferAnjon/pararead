/**
 * 数据库（CN-19 A；2026-11-18 照 Notion 做全；2026-11-22 第三批：多个视图、看板 / 日历 / 画廊、状态 / 关联 / 汇总、公式）：
 * 文档里一个 ```base 代码块，数据是一个文件夹里的 md，每条一篇，属性在 frontmatter（HANDOFF 第 4 节）。
 *
 * 第三批的写法和算法分在几个文件（都不依赖 Electron 和 Node，手机版照着移植）：
 *   base-doc.ts    块的写法：读成 BaseDoc（多个视图、每个视图自己的筛选 / 排序 / 分组、状态 / 关联 / 汇总、公式），改法只换动到的那几行
 *   base-filter.ts 筛选：一层嵌套的且 / 或、条件 ↔ 一句表达式、面板上的条件和小标签
 *   base-expr.ts   公式和筛选的写法（同一种）：读、查、算，写错给一句中文
 *   base-rows.ts   算行：筛选、排序、分组、日历、每一格的值（公式、汇总、关联）
 *   base-write.ts  改一条：拖卡、拖日期、改格子、关联两边写（返回要写的文件，提交由主进程做）
 *   base-yaml.ts   块里那一小块 YAML 的读和「只换那几行」
 *   base-types.ts  共用的类型和菜单
 *
 * 这个文件是第二批的表头（BaseTable）在用的那一套：只看第一个视图（view 参数可以指别的），筛选写在最外层。
 * 改列、排序、列宽、计算这些现在都转给 base-doc.ts 的按视图改法（以前在有几个视图时会改到别的视图上）；
 * 「全部 / 任一」的筛选（setBaseFilters）照旧写最外层。
 */
import { dropBaseColumn, renameBaseColumn, setPropDef, setViewColSize, setViewOrder, setViewSort, setViewSummary } from './base-doc'
import { type BaseCond, condExpr, condText, isRelDay, parseCond } from './base-filter'
import { COL_TYPES, type ColType, listOf } from './base-types'
import { parseYaml, plain, type Y } from './base-yaml'
import { readProps } from './props'
import { SUMMARY_MENU, type SummaryId, type SumKind, summarizeText } from './base-sums'

export * from './base-types'
export * from './base-expr'
export * from './base-filter'
export * from './base-doc'
export * from './base-rows'
export * from './base-write'
export * from './base-ai'
export * from './base-sums'

/** 读 YAML 成普通的值（缩进的映射、列表、一行的 [a, b]、带引号的字） */
export function parseYamlLite(src: string): Y {
  return plain(parseYaml(src).root)
}

/** 每种列能选的条件（第二批的表头筛选面板用；第三批的面板用 FILTER_OPS）；value：要不要填值 */
export const BASE_OPS: Record<ColType, { op: BaseCond['op']; label: string; value: boolean }[]> = {
  text: [
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'contains', label: '包含', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  select: [
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'contains', label: '包含', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  number: [
    { op: '==', label: '=', value: true },
    { op: '!=', label: '≠', value: true },
    { op: '>', label: '>', value: true },
    { op: '>=', label: '≥', value: true },
    { op: '<', label: '<', value: true },
    { op: '<=', label: '≤', value: true },
  ],
  date: [
    { op: '<', label: '早于', value: true },
    { op: '>', label: '晚于', value: true },
    { op: 'days', label: '最近 N 天', value: true },
  ],
  check: [{ op: '==', label: '是', value: true }],
  multi: [
    { op: 'contains', label: '包含', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  url: [
    { op: 'contains', label: '包含', value: true },
    { op: '==', label: '是', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
}

/** 第二批表头能改的条件（别的读成「认不出的」原样留着） */
const LEGACY_OPS = new Set<string>(['==', '!=', '>', '>=', '<', '<=', 'contains', 'empty', 'days'])

/** 筛选小标签上的写法（第二批的表头）：「状态 是 在读」「评分 ≥ 8」「读完 最近 7 天」 */
export function condLabel(c: BaseCond, type: ColType): string {
  if (!LEGACY_OPS.has(c.op) || isRelDay(c.value)) return condText(c, type)
  const name = c.prop === 'file.name' ? '名字' : c.prop
  if (type === 'check') return `${name} ${c.value === 'true' ? '是' : '否'}`
  if (c.op === 'days') return `${name} 最近 ${c.value} 天`
  if (c.op === 'empty') return `${name} 为空`
  const label = (BASE_OPS[type].find((o) => o.op === c.op) ?? BASE_OPS.text.find((o) => o.op === c.op) ?? { label: c.op }).label
  return `${name} ${label} ${c.value}`
}

export interface BaseSpec {
  /** 数据源文件夹（库里的相对路径）；没写就是 null */
  folder: string | null
  /** 这几条是「全部满足」（and）还是「任一满足」（or） */
  match: 'and' | 'or'
  conds: BaseCond[]
  /** 认不出的筛选：原样留着，写回时不丢；筛行时不算（软件读不懂） */
  extra: string[]
  /** 筛选写成了嵌套的组合（and 里套 or 之类）：表头上不改，去源文件改 */
  filtersLocked: boolean
  /** 视图名 */
  view: string
  /** 列：file.name 是笔记名，其余是属性名；隐藏的列就是这里没有的 */
  columns: string[]
  sort: { prop: string; desc: boolean }[]
  /** 用户给列选过的类型（properties 里的 type） */
  types: Record<string, ColType>
  /** 拖过的列宽（视图里的 columnSize，同 Obsidian） */
  sizes: Record<string, number>
  /** 表底计算行（视图里的 summaries，名字同 Obsidian：Sum、Average、Min、Max、Median、Range、Earliest、Latest、Checked、Unchecked、Empty、Filled、Unique） */
  summaries: Record<string, string>
}

const asList = (y: Y | undefined): Y[] => (Array.isArray(y) ? y : y === undefined || y === '' ? [] : [y])
const asMap = (y: Y | undefined): { [k: string]: Y } => (y && typeof y === 'object' && !Array.isArray(y) ? y : {})

/** 读块（第二批的表头用）：最外层的筛选、第 view 个视图（默认第一个）的列、排序、列宽、计算 */
export function parseBase(src: string, view = 0): BaseSpec {
  const y = asMap(parseYamlLite(src))
  const f = y.filters
  const fm = asMap(f)
  const keys = Object.keys(fm)
  let match: 'and' | 'or' = keys.length === 1 && keys[0] === 'or' ? 'or' : 'and'
  let list: Y[] = typeof f === 'string' ? [f] : Array.isArray(f) ? f : asList(fm[match])
  // 「任一」又有数据源文件夹时是 and: [inFolder, { or: [...] }]（文件夹始终要满足）
  const orMaps = match === 'and' ? list.filter((x) => Object.keys(asMap(x)).length === 1 && Array.isArray(asMap(x).or)) : []
  if (orMaps.length === 1 && list.filter((x) => typeof x === 'string').every((x) => /^file\.inFolder\(/.test((x as string).trim()))) {
    match = 'or'
    list = [...list.filter((x) => typeof x === 'string'), ...asList(asMap(orMaps[0]).or)]
  }
  // 只认一层 and / or；里面再套组合、或者 and、or 都写了的，表头上不改
  const filtersLocked = keys.length > 1 || (keys.length === 1 && keys[0] !== 'and' && keys[0] !== 'or') || list.some((x) => typeof x !== 'string')
  let folder: string | null = null
  const conds: BaseCond[] = []
  const extra: string[] = []
  for (const r of filtersLocked ? asList(fm.and) : list) {
    if (typeof r !== 'string') continue
    const inF = /^file\.inFolder\(\s*["'](.*)["']\s*\)$/.exec(r.trim())
    if (inF) {
      folder = inF[1]!.replace(/\/+$/, '')
      continue
    }
    if (filtersLocked) continue
    const c = parseCond(r)
    if (c && LEGACY_OPS.has(c.op) && !isRelDay(c.value)) conds.push(c)
    else extra.push(r.trim())
  }
  const v = asMap(asList(y.views)[view])
  const columns = asList(v.order).filter((c): c is string => typeof c === 'string')
  const sort = asList(v.sort)
    .map(asMap)
    .filter((s) => typeof s.property === 'string')
    .map((s) => ({ prop: (s.property as string).replace(/^note\./, ''), desc: String(s.direction ?? '').toUpperCase() === 'DESC' }))
  const types: Record<string, ColType> = {}
  for (const [k, cfg] of Object.entries(asMap(y.properties))) {
    const t = asMap(cfg).type
    if (typeof t === 'string' && COL_TYPES.some((c) => c.type === t)) types[k.replace(/^note\./, '')] = t as ColType
  }
  const sizes: Record<string, number> = {}
  for (const [k, w] of Object.entries(asMap(v.columnSize))) if (typeof w === 'string' && /^\d+$/.test(w)) sizes[k.replace(/^note\./, '')] = Number(w)
  const summaries: Record<string, string> = {}
  for (const [k, f] of Object.entries(asMap(v.summaries))) if (typeof f === 'string' && f) summaries[k.replace(/^note\./, '')] = f
  return { folder, match, conds, extra, filtersLocked, view: typeof v.name === 'string' && v.name ? v.name : '表格', columns: columns.length ? columns : ['file.name'], sort, types, sizes, summaries }
}

/** 一篇 md 里嵌的数据库用哪几个文件夹当数据源（```base 代码块里的 file.inFolder("…")）：那里的 md 是数据库的条目 */
export function baseFoldersIn(text: string): string[] {
  if (!text.includes('```base')) return []
  const out = new Set<string>()
  for (const b of text.matchAll(/^```base[^\n]*\n([\s\S]*?)^```/gm)) for (const m of b[1]!.matchAll(/file\.inFolder\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]!)
  return [...out]
}

/** 新建一个数据库代码块的 YAML */
export function baseYaml(folder: string, columns: string[]): string {
  return ['filters:', '  and:', `    - file.inFolder("${folder}")`, 'views:', '  - type: table', '    name: 表格', '    order:', ...columns.map((c) => `      - ${c}`)].join('\n')
}

/** 排序：按这一列升序 / 降序（只换第 view 个视图 sort 那几行） */
export function setBaseSort(src: string, prop: string, desc: boolean, view = 0): string {
  return setViewSort(src, view, [{ prop, desc }])
}

/** 不排序：拿掉视图里 sort 那几行（没有就原样） */
export function clearBaseSort(src: string, view = 0): string {
  return setViewSort(src, view, [])
}

/** 列：显示哪几列、什么顺序（隐藏一列就是从这里拿掉，Obsidian 也这么存） */
export function setBaseOrder(src: string, columns: string[], view = 0): string {
  return setViewOrder(src, view, columns)
}

/** 列的类型写进 properties（null：拿掉，回到按值猜） */
export function setBaseColType(src: string, prop: string, type: ColType | null): string {
  return setPropDef(src, prop, type ? { type } : null)
}

/** 拖过的列宽写进视图的 columnSize（null：拿掉） */
export function setBaseColSize(src: string, prop: string, px: number | null, view = 0): string {
  return setViewColSize(src, view, prop, px)
}

/** 表底这一列算什么（视图的 summaries，名字同 Obsidian；null：不算） */
export function setBaseSummary(src: string, prop: string, summary: string | null, view = 0): string {
  return setViewSummary(src, view, prop, summary)
}

/** 列改名：每个视图的列、排序、筛选，properties、columnSize、summaries，公式里用到的，旧名都换成新名 */
export function renameBaseProp(src: string, from: string, to: string): string {
  return renameBaseColumn(src, from, to)
}

/** 删掉一列：每个视图的列、排序、筛选，properties、columnSize、summaries 里都拿掉 */
export function dropBaseProp(src: string, prop: string): string {
  return dropBaseColumn(src, prop)
}

/** 表底计算能选的几种（照 Notion「计算」，名字写成 Obsidian Bases 的 summaries）：每种列按 SUMMARY_MENU 的先后，名字照原型 */
export const CALC_LABEL: Record<SummaryId, string> = {
  Count: '全部条数',
  Filled: '有值的',
  Empty: '空着的',
  Unique: '不同的值',
  PercentFilled: '有值的占几成',
  PercentEmpty: '空着的占几成',
  Sum: '求和',
  SumShare: '求和，组里画占比',
  Average: '平均',
  Median: '中位数',
  Min: '最小',
  Max: '最大',
  Range: '最大减最小',
  Earliest: '最早',
  Latest: '最晚',
  Checked: '勾了几条',
  Unchecked: '没勾几条',
  PercentChecked: '勾了的占几成',
}

/** 日期列上换个叫法的（最大减最小 → 跨了几天） */
export const DATE_CALC_LABEL: Partial<Record<SummaryId, string>> = { Range: '跨了几天' }

/** 一种算法在这种列上叫什么（中文原句；界面上 t(名字, { ctx: '数据库' })）；认不出的照写 */
export const calcName = (id: string, kind: SumKind): string => (kind === 'date' ? DATE_CALC_LABEL[id as SummaryId] : undefined) ?? CALC_LABEL[id as SummaryId] ?? id

const kindOfType = (t: ColType): SumKind => (t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'check' ? 'check' : 'other')

/** 第二批的表头用：按列的类型列出能选的几种（日期的 Range 叫「跨了几天」） */
export const SUMMARIES: Record<ColType, { id: SummaryId; label: string }[]> = Object.fromEntries(
  COL_TYPES.map(({ type }) => [type, SUMMARY_MENU[kindOfType(type)].flat().map((id) => ({ id, label: calcName(id, kindOfType(type)) }))]),
) as Record<ColType, { id: SummaryId; label: string }[]>

/** 算表底这一格：values 是这一列每一行的值（原文）。第三批的表照算出来的值算：summaryOf（base-sums.ts） */
export function summarize(id: string, type: ColType, values: string[]): string {
  return summarizeText(id, type, values).text
}

const indentOf = (l: string) => l.length - l.trimStart().length

/** 换掉 start 行开头的一段（到下一个缩进不比它深的行为止） */
function spliceBlock(lines: string[], start: number, block: string[]): string[] {
  const ind = indentOf(lines[start]!)
  let end = start + 1
  while (end < lines.length && (lines[end]!.trim() === '' || indentOf(lines[end]!) > ind)) end++
  return [...lines.slice(0, start), ...block, ...lines.slice(end)]
}

/** YAML 列表里的一行：以 ! 开头、带「: 」「 #」的用单引号包起来 */
const yamlItem = (s: string) => (/^[!&*?|>'"%@`{[]|: | #/.test(s) ? `'${s.replace(/'/g, "''")}'` : s)

/**
 * 筛选（第二批的表头）：「全部 / 任一」+ 这几条，只换最外层 filters 那一段，认不出的原样留着。
 * 数据源文件夹始终要满足：任一（or）时写成 and: [inFolder, { or: [...] }]，读回来也认。
 * 第三批的面板改的是视图自己的筛选：setViewFilter
 */
export function setBaseFilters(src: string, match: 'and' | 'or', conds: BaseCond[]): string {
  const spec = parseBase(src)
  if (spec.filtersLocked) throw new Error('这个数据库的筛选写了嵌套的组合条件，去源文件里改')
  const folder = spec.folder !== null ? [`file.inFolder("${spec.folder}")`] : []
  const items = [...conds.map(condExpr), ...spec.extra]
  let block: string[]
  if (match === 'or' && items.length > 1) {
    block = folder.length
      ? ['filters:', '  and:', ...folder.map((i) => `    - ${yamlItem(i)}`), '    - or:', ...items.map((i) => `        - ${yamlItem(i)}`)]
      : ['filters:', '  or:', ...items.map((i) => `    - ${yamlItem(i)}`)]
  } else {
    const all = [...folder, ...items]
    block = all.length ? ['filters:', '  and:', ...all.map((i) => `    - ${yamlItem(i)}`)] : []
  }
  const lines = src.split('\n')
  const start = lines.findIndex((l) => /^filters:/.test(l))
  if (start === -1) return [...block, ...lines].join('\n')
  return spliceBlock(lines, start, block).join('\n')
}

export interface BaseRow {
  path: string
  name: string
  props: Record<string, string>
}

const num = (s: string) => (s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : null)

/** 比两个值：都是数字按数字比，否则按字（日期 2026-11-02 这种按字比就对） */
function compare(a: string, b: string): number {
  const na = num(a)
  const nb = num(b)
  if (na !== null && nb !== null) return na - nb
  return a.localeCompare(b, 'zh')
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 一行满不满足一条（第二批的表头算行用；today：测试时给定今天）。第三批的算行用 base-rows.ts */
export function condHolds(c: BaseCond, v: string, today = new Date()): boolean {
  switch (c.op) {
    case '==':
      return compare(v, c.value) === 0 && (v === c.value || num(v) !== null)
    case '!=':
      return !(compare(v, c.value) === 0 && (v === c.value || num(v) !== null))
    case '>':
      return v !== '' && compare(v, c.value) > 0
    case '>=':
      return v !== '' && compare(v, c.value) >= 0
    case '<':
      return v !== '' && compare(v, c.value) < 0
    case '<=':
      return v !== '' && compare(v, c.value) <= 0
    case 'contains':
      return v.toLowerCase().includes(c.value.toLowerCase())
    case 'notcontains':
      return !v.toLowerCase().includes(c.value.toLowerCase())
    case 'empty':
      return v.trim() === '' || v.trim() === '[]'
    case 'notempty':
      return !(v.trim() === '' || v.trim() === '[]')
    case 'days': {
      const since = new Date(today)
      since.setDate(since.getDate() - (Number(c.value) || 7))
      return v !== '' && v.slice(0, 10) >= localDate(since)
    }
  }
}

/** 文件夹里的笔记 → 表格的行：按筛选留下、按排序排好（第二批的表头用；纯函数）；hidden：筛掉了几条 */
export function baseRows(spec: BaseSpec, notes: { path: string; text: string }[], today = new Date()): BaseRow[] & { hidden?: number } {
  const inFolder = (p: string) => spec.folder !== null && p.startsWith(spec.folder + '/') && /\.md$/i.test(p)
  const val = (r: BaseRow, p: string) => (p === 'file.name' ? r.name : (r.props[p] ?? ''))
  const all = notes
    .filter((n) => inFolder(n.path))
    .map((n) => ({ path: n.path, name: n.path.split('/').pop()!.replace(/\.md$/i, ''), props: Object.fromEntries(readProps(n.text).map((p) => [p.key, p.value])) }))
  const ok = (r: BaseRow) => {
    if (!spec.conds.length) return true
    const hits = spec.conds.map((c) => condHolds(c, val(r, c.prop), today))
    return spec.match === 'or' ? hits.some(Boolean) : hits.every(Boolean)
  }
  const rows: BaseRow[] & { hidden?: number } = all.filter(ok).sort((a, b) => {
    for (const s of spec.sort) {
      const d = compare(val(a, s.prop), val(b, s.prop))
      if (d) return s.desc ? -d : d
    }
    return a.name.localeCompare(b.name, 'zh')
  })
  rows.hidden = all.length - rows.length
  return rows
}
