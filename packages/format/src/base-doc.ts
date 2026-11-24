/**
 * 数据库块的写法（2026-11-22 数据库第三批，设计页「存进 md 的完整样子」）。一个 ```base 块记着：
 *
 *   filters:                       数据源：每个视图都满足（file.inFolder 那一条在最外层）
 *     and:
 *       - file.inFolder("课程/ecp/课程计划")
 *   formulas:                      公式：只在这里记怎么算，每篇笔记不动
 *     进度: (已看 / 节数 * 100).round() + "%"
 *   properties:                    列的类型；状态的三组、关联连到哪、汇总怎么算
 *     状态: {type: status, groups: {待开始: [未开始], 进行中: [在学], 完成: [学完]}}
 *     练习: {type: relation, to: 课程/ecp/练习, twoWay: 所属讲}
 *     做完几题: {type: rollup, via: 练习, prop: 做完, calc: checked/all}
 *   views:                         一个视图一段，每个视图有自己的看法、列、筛选、排序、分组
 *     - type: table                table / kanban / calendar / cards
 *       name: 全部
 *       order: [file.name, 状态, 日期, formula.进度, 练习, 做完几题]
 *       filters: {and: [状态 != "学完", {or: [日期 <= today() + "7d", 日期.isEmpty()]}]}
 *       sort: [{property: 日期, direction: ASC}]
 *       groupBy: {property: 状态, direction: ASC}
 *                                  日期列可以按月、按周分组：groupBy: {property: 日期, by: month}（by: week）
 *       date: 日期                  日历按哪一列排
 *       image: none                画廊不要封面（不写：正文第一张图，没图露前几行字）
 *       columnSize: {名字: 200}     列宽；summaries：表底计算（以前就有）
 *
 * 打开再保存不变的四条（设计页）：
 * 1. 只看不写：读（parseBaseDoc）、算行（base-rows.ts）都不改字；当前看哪个视图、组收起、日历翻到哪个月记在本机。
 * 2. 只换那几行：下面每个改法只换动到的那几行（base-yaml.ts），别的视图、认不出的键、注释原样；改了和原来一样就一个字不动。
 * 3. 算出来的不落盘：公式、汇总只记在这里，不写进任何一篇笔记。
 * 4. 自动化测试：test/base-rule1.test.ts。
 *
 * 以前（第二批）的筛选写在最外层 filters 里（只有一个视图）：读的时候那几条算「所有视图都满足」（shared）；
 * 第一次在视图上改筛选时挪进每个视图自己的 filters，最外层只留数据源（setViewFilter）。
 */
import { type AiColDef, aiDefFields, aiDefOf } from './base-ai'
import { buttonDefOf, type ButtonDef, setButton } from './automation'
import { exprRefs, parseExpr, renameRef } from './base-expr'
import { type BaseFilter, type FilterItem, filterFromYaml, isGroup, isRaw, itemExpr, mergeFilters, renameInFilter, sameItem, simplifyFilter } from './base-filter'
import { COL_TYPES, type ColType, DEFAULT_STATUS_GROUPS, listOf, type RollupCalc, ROLLUP_CALCS, type StatusGroup, VIEW_TYPES, viewKind, type ViewType } from './base-types'
import { entryOf, flowItem, mapOf, pad, parseYaml, plain, removeEntry, renameKey, setBlock, setList, setNested, setScalar, shiftLines, type Y, YamlEdit, yamlKey, type YItem, type YMap, type YNode, yamlScalar, type YSeq } from './base-yaml'

/** 一列的设置（properties 里的一项） */
export type PropDef =
  | { type: ColType }
  | { type: 'status'; groups: StatusGroup[] }
  | { type: 'relation'; to: string; twoWay: string | null }
  | { type: 'rollup'; via: string; prop: string; calc: RollupCalc }
  | AiColDef
  | ButtonDef

/** 按哪一列排 / 分组，降序是 desc */
export interface BaseSort {
  prop: string
  desc: boolean
}

/** 日期列分组按什么分：按月（2026-11）、按周（ISO 周，周一起） */
export type GroupPeriod = 'month' | 'week'
export const GROUP_PERIODS: readonly GroupPeriod[] = ['month', 'week']

/** 分组：按哪一列，日期列可以按月、按周（by）；by 写的是认不出的（以后的 year、total）时读成 undefined、文件里原样留着 */
export interface BaseGroup extends BaseSort {
  by?: GroupPeriod
}

export interface BaseView {
  /** 文件里写的 type（认不出的照写）；kind 是当哪种看法画 */
  type: string
  kind: ViewType
  name: string
  /** 显示哪几列、什么顺序（file.name 名字、formula.进度 公式、别的是属性名）；没写是只有名字 */
  columns: string[]
  /** 这个视图自己的筛选 */
  filter: BaseFilter | null
  sort: BaseSort[]
  groupBy: BaseGroup | null
  /** 日历按哪一列排 */
  date: string | null
  /** 画廊的封面：none 不要封面；不写（null）是正文第一张图 */
  image: string | null
  sizes: Record<string, number>
  summaries: Record<string, string>
}

export interface BaseDoc {
  /** 数据源文件夹（file.inFolder），每条记录是这个文件夹里的一篇 md */
  folder: string | null
  /** 最外层除了数据源的条件（以前的写法）：所有视图都要满足 */
  shared: BaseFilter | null
  formulas: Record<string, string>
  props: Record<string, PropDef>
  /** 至少一个（块里没写 views 时是一个「表格」） */
  views: BaseView[]
}

/** 视图里各个键的先后（新加的键插在该在的地方） */
const VIEW_KEYS = ['type', 'name', 'order', 'filters', 'sort', 'groupBy', 'date', 'image', 'columnSize', 'summaries'] as const
/** 一列设置里软件管的键（别的键，比如 displayName，原样留着） */
const PROP_KEYS = ['type', 'groups', 'prompt', 'output', 'folder', 'to', 'twoWay', 'via', 'prop', 'calc', 'reads', 'newRows', 'ai'] as const
const stripNote = (k: string) => k.replace(/^note\./, '')
const isMap = (y: Y | undefined): y is { [k: string]: Y } => !!y && typeof y === 'object' && !Array.isArray(y)
const str = (y: Y | undefined) => (typeof y === 'string' ? y.trim() : '')
const asList = (y: Y | undefined): Y[] => (Array.isArray(y) ? y : y === undefined || y === '' ? [] : [y])
const IN_FOLDER = /^file\.inFolder\(\s*(["'])(.*)\1\s*\)$/

/** 这种看法默认叫什么：表格、看板、日历、画廊 */
export const viewLabel = (type: string) => VIEW_TYPES.find((v) => v.type === viewKind(type))!.label

// ---------------------------------------------------------------- 读

function calcOf(y: Y | undefined): RollupCalc {
  const t = str(y).toLowerCase().replace(/\s+/g, '')
  if (t === 'checked/all' || t === 'percent' || t === 'percentchecked') return 'checked/all'
  if (t === 'avg') return 'average'
  if (t === 'min') return 'earliest'
  if (t === 'max') return 'latest'
  return (ROLLUP_CALCS.find((c) => c.calc === t)?.calc ?? 'count') as RollupCalc
}

function groupsOf(y: Y | undefined): StatusGroup[] {
  if (!isMap(y) || !Object.keys(y).length) return DEFAULT_STATUS_GROUPS.map((g) => ({ name: g.name, options: [...g.options] }))
  return Object.entries(y).map(([name, v]) => ({ name, options: Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean) : listOf(str(v)) }))
}

function propDefOf(y: Y): PropDef | null {
  if (!isMap(y)) return null
  const t = str(y.type)
  if (COL_TYPES.some((c) => c.type === t)) return { type: t as ColType }
  if (t === 'status') return { type: 'status', groups: groupsOf(y.groups) }
  if (t === 'relation') return { type: 'relation', to: str(y.to).replace(/\/+$/, ''), twoWay: str(y.twoWay) || null }
  if (t === 'rollup') return { type: 'rollup', via: stripNote(str(y.via)), prop: stripNote(str(y.prop)), calc: calcOf(y.calc) }
  if (t === 'ai') return aiDefOf(y)
  if (t === 'button') return buttonDefOf(y)
  return null
}

function sortOf(y: Y | undefined): BaseSort | null {
  if (typeof y === 'string') return y.trim() ? { prop: stripNote(y.trim()), desc: false } : null
  if (!isMap(y) || !str(y.property)) return null
  return { prop: stripNote(str(y.property)), desc: str(y.direction).toUpperCase() === 'DESC' }
}

/** 一行写完的 {property: 日期, by: month, direction: DESC}（只认一层，值里不再套 {} []）；不是这个样子返回 null */
function flowMapOf(s: string): Record<string, string> | null {
  const t = s.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  const body = t.slice(1, -1)
  if (/[{}[\]]/.test(body)) return null
  const out: Record<string, string> = {}
  for (const part of body.split(',')) {
    if (!part.trim()) continue
    const m = /^\s*([^:]+?)\s*:\s*(.*?)\s*$/.exec(part)
    if (!m) return null
    out[m[1]!.replace(/^["']|["']$/g, '')] = m[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}

function groupOf(y: Y | undefined): BaseGroup | null {
  const m = typeof y === 'string' ? flowMapOf(y) : null
  const s = sortOf(m ?? y)
  if (!s) return null
  const by = str((m ?? (isMap(y) ? y : {})).by).toLowerCase()
  return GROUP_PERIODS.includes(by as GroupPeriod) ? { ...s, by: by as GroupPeriod } : s
}

const sameGroup = (a: BaseGroup | null, b: BaseGroup | null) => (!a || !b ? a === b : a.prop === b.prop && a.desc === b.desc && (a.by ?? null) === (b.by ?? null))

function viewOf(y: Y): BaseView {
  const v = isMap(y) ? y : {}
  const type = str(v.type) || 'table'
  const columns = asList(v.order).filter((c): c is string => typeof c === 'string' && c.trim() !== '')
  const sizes: Record<string, number> = {}
  if (isMap(v.columnSize)) for (const [k, w] of Object.entries(v.columnSize)) if (typeof w === 'string' && /^\d+(\.\d+)?$/.test(w)) sizes[stripNote(k)] = Math.round(Number(w))
  const summaries: Record<string, string> = {}
  if (isMap(v.summaries)) for (const [k, f] of Object.entries(v.summaries)) if (typeof f === 'string' && f) summaries[stripNote(k)] = f
  return {
    type,
    kind: viewKind(type),
    name: str(v.name) || viewLabel(type),
    columns: columns.length ? columns : ['file.name'],
    filter: simplifyTop(filterFromYaml(v.filters)),
    sort: asList(v.sort)
      .map(sortOf)
      .filter((s): s is BaseSort => s !== null),
    groupBy: groupOf(v.groupBy),
    date: stripNote(str(v.date)) || null,
    image: str(v.image) || null,
    sizes,
    summaries,
  }
}

/** 空组当没有 */
const simplifyTop = (f: BaseFilter | null) => (f && f.items.length ? f : null)

/** 最外层的筛选拆成数据源文件夹和别的条件 */
function splitSource(top: BaseFilter | null): { folder: string | null; shared: BaseFilter | null; folderItem: FilterItem | null } {
  if (!top) return { folder: null, shared: null, folderItem: null }
  if (top.conj !== 'and') return { folder: null, shared: top, folderItem: null }
  const at = top.items.findIndex((x) => isRaw(x) && IN_FOLDER.test(x.raw.trim()))
  if (at === -1) return { folder: null, shared: simplifyFilter(top), folderItem: null }
  const item = top.items[at]!
  const folder = IN_FOLDER.exec((item as { raw: string }).raw.trim())![2]!.replace(/\/+$/, '')
  return { folder, shared: simplifyFilter({ conj: 'and', items: top.items.filter((_, i) => i !== at) }), folderItem: item }
}

/** 读一个 ```base 块（中间的 YAML）：不抛，读不懂的地方当没写 */
export function parseBaseDoc(src: string): BaseDoc {
  const y = plain(parseYaml(src).root)
  const m = isMap(y) ? y : {}
  const { folder, shared } = splitSource(filterFromYaml(m.filters))
  const formulas: Record<string, string> = {}
  if (isMap(m.formulas)) for (const [k, v] of Object.entries(m.formulas)) if (typeof v === 'string' && v.trim()) formulas[k] = v.trim()
  const props: Record<string, PropDef> = {}
  if (isMap(m.properties))
    for (const [k, v] of Object.entries(m.properties)) {
      if (/^(formula|file)\./.test(k)) continue
      const d = propDefOf(v)
      if (d && !Object.hasOwn(props, stripNote(k))) props[stripNote(k)] = d
    }
  // 和文件里的一段一段对齐（第 i 个视图就是 views 下面第 i 段），写的时候按这个找
  const views = asList(m.views).map((v) => viewOf(isMap(v) ? v : typeof v === 'string' ? { type: v } : {}))
  return { folder, shared, formulas, props, views: views.length ? views : [viewOf({})] }
}

/** 视图上看到、能改的筛选：所有视图都满足的（以前的写法）和这个视图自己的合在一起 */
export function effectiveFilter(doc: BaseDoc, i: number): BaseFilter | null {
  return simplifyFilter(mergeFilters(doc.shared, doc.views[i]?.filter ?? null))
}

/** 起一个不重名的视图名：看板、看板 2、看板 3 */
export function uniqueViewName(doc: BaseDoc, base: string): string {
  const taken = new Set(doc.views.map((v) => v.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** 关联列连到的文件夹（算汇总、认双链要读那几个文件夹） */
export function relatedFolders(doc: BaseDoc): string[] {
  // AI 列新建的笔记放的文件夹也读（格子里写「3 道」和第一题）
  return [...new Set(Object.values(doc.props).flatMap((d) => (d.type === 'relation' && d.to ? [d.to] : d.type === 'ai' && d.output === 'note' && d.folder ? [d.folder] : [])))]
}

// ---------------------------------------------------------------- 写：找到要改的地方

function rootMap(e: YamlEdit): YMap | null {
  const r = e.root
  if (r?.kind === 'map') return r
  if (r) return null
  // 空块（或者只有注释）：从最后一行有字的地方往下写
  let end = e.lines.length
  while (end > 0 && e.lines[end - 1]!.trim() === '') end--
  return { kind: 'map', col: 0, entries: [], line: end, end }
}

/** 最外层新加一个键：照旧加在最后，只是在 automations（自动化，设计页定的最后一段）前面 */
const beforeAuto = (e: YamlEdit, key: string): string[] => [...(rootMap(e)?.entries.map((x) => x.key).filter((k) => k !== 'automations' && k !== key) ?? []), key, 'automations']

function viewsSeq(e: YamlEdit): YSeq | null {
  const v = entryOf(rootMap(e), 'views')?.value
  return v?.kind === 'seq' ? v : null
}

function viewMap(e: YamlEdit, i: number): YMap | null {
  const v = viewsSeq(e)?.items[i]?.value
  return v?.kind === 'map' ? v : null
}

/** 块里没写 views（就一个默认的表格）：要改视图时先写出来 */
function ensureViews(e: YamlEdit) {
  if (viewsSeq(e) || !rootMap(e)) return
  setBlock(e, () => rootMap(e), 'views', (col) => {
    const dash = e.dashCol(col)
    return [`${pad(dash)}- type: table`, `${pad(dash + 2)}name: 表格`]
  }, { order: beforeAuto(e, 'views') })
}

function editText(src: string, fn: (e: YamlEdit) => void): string {
  const e = new YamlEdit(src.trim() === '' ? '' : src)
  if (src.trim() === '') e.lines = []
  fn(e)
  const out = e.text()
  return out === src ? src : out
}

function editView(src: string, i: number, fn: (e: YamlEdit, view: () => YMap | null) => void): string {
  return editText(src, (e) => {
    if (i === 0) ensureViews(e)
    const get = () => viewMap(e, i)
    if (get()) fn(e, get)
  })
}

// ---------------------------------------------------------------- 写：筛选（没变的那几句原样留着）

interface OldItem {
  model: FilterItem
  it: YItem
  sub: OldGroup | null
}
interface OldGroup {
  conj: string
  head: number
  col: number
  items: OldItem[]
}

/** 原来 filters 下面那一块：「and:」那一行、每一句是哪几行（只认「键: 列表」这种写法，别的写法整块重写） */
function oldGroup(node: YNode | null | undefined): OldGroup | null {
  if (!node || node.kind !== 'map' || node.entries.length !== 1) return null
  const en = node.entries[0]!
  if (!['and', 'or', 'not'].includes(en.key) || en.value?.kind !== 'seq') return null
  return {
    conj: en.key,
    head: en.line,
    col: en.col,
    items: en.value.items.map((it) => {
      const y = plain(it.value)
      const model = typeof y === 'string' ? (filterFromYaml(y)?.items[0] ?? { raw: y }) : (filterFromYaml(y) ?? { raw: '' })
      return { model, it, sub: oldGroup(it.value) }
    }),
  }
}

/** 一组写成几行：conjCol 是「and:」这个键在第几格；和原来一样的句子、组原样搬过来 */
function groupLines(e: YamlEdit, g: BaseFilter, conjCol: number, old: OldGroup | null, headPrefix: string | null): string[] {
  const dash = e.flushSeq ? conjCol : conjCol + e.step
  const out: string[] = []
  out.push(headPrefix !== null ? headPrefix + `${g.conj}:` : old && old.conj === g.conj && old.col === conjCol ? e.lines[old.head]! : `${pad(conjCol)}${g.conj}:`)
  const used = new Set<OldItem>()
  const oldSubs = old ? old.items.filter((x) => x.sub) : []
  let subAt = 0
  for (const x of g.items) {
    const same = old?.items.find((o) => !used.has(o) && sameItem(o.model, x))
    if (same) {
      used.add(same)
      out.push(...shiftLines(e.lines.slice(same.it.lead, same.it.end), dash - same.it.col))
      continue
    }
    if (isGroup(x)) {
      // 组里改了一句：组头照写，里面没变的句子照搬
      while (subAt < oldSubs.length && used.has(oldSubs[subAt]!)) subAt++
      const pair = oldSubs[subAt] ?? null
      if (pair) {
        used.add(pair)
        subAt++
      }
      out.push(...groupLines(e, x, dash + 2, pair?.sub ?? null, `${pad(dash)}- `))
      continue
    }
    out.push(`${pad(dash)}- ${yamlScalar(itemExpr(x))}`)
  }
  return out
}

function writeFilter(e: YamlEdit, getMap: () => YMap | null, f: BaseFilter | null, order?: readonly string[]) {
  const m = getMap()
  if (!m) return
  if (!f || !f.items.length) {
    setBlock(e, getMap, 'filters', null)
    return
  }
  const en = entryOf(m, 'filters')
  const old = oldGroup(en?.value)
  const keyCol = en ? en.col : m.col
  setBlock(e, getMap, 'filters', () => groupLines(e, f, keyCol + e.step, old && old.col === keyCol + e.step ? old : null, null), { order })
}

/**
 * 改一个视图的筛选（筛选面板「改了就存」）。f 是面板上看到的整个筛选（effectiveFilter），null 或空组是去掉筛选。
 * 最外层还有以前写的条件时：这次一起挪进每个视图（别的视图照旧满足它们），最外层只留数据源
 */
export function setViewFilter(src: string, i: number, f: BaseFilter | null): string {
  const doc = parseBaseDoc(src)
  if (!doc.views[i]) return src
  const next = f && f.items.length ? f : null
  if (sameItem(effectiveFilter(doc, i), next)) return src
  return editText(src, (e) => {
    if (i === 0) ensureViews(e)
    if (doc.shared) {
      doc.views.forEach((v, j) => j !== i && writeFilter(e, () => viewMap(e, j), simplifyFilter(mergeFilters(doc.shared, v.filter)), VIEW_KEYS))
      const top = filterFromYaml(plain(entryOf(rootMap(e), 'filters')?.value))
      const { folderItem } = splitSource(top)
      writeFilter(e, () => rootMap(e), folderItem ? { conj: 'and', items: [folderItem] } : null)
    }
    writeFilter(e, () => viewMap(e, i), next, VIEW_KEYS)
  })
}

// ---------------------------------------------------------------- 写：视图

/** 排序：照 sort 的先后（空的拿掉 sort），只换变了的那几项 */
export function setViewSort(src: string, i: number, sort: BaseSort[]): string {
  return editView(src, i, (e, get) =>
    setList(e, get, 'sort', sort, {
      same: (s, old) => isMap(old) && stripNote(str(old.property)) === s.prop && (str(old.direction).toUpperCase() === 'DESC') === s.desc,
      emit: (s, dash) => [`${pad(dash)}- property: ${yamlScalar(s.prop)}`, `${pad(dash + 2)}direction: ${s.desc ? 'DESC' : 'ASC'}`],
      order: VIEW_KEYS,
    }),
  )
}

/** 显示哪几列、什么顺序（隐藏一列就是从这里拿掉）；和现在看到的一样（没写 order 时是只有名字）就不动 */
export function setViewOrder(src: string, i: number, columns: string[]): string {
  const v = parseBaseDoc(src).views[i]
  if (!v || v.columns.join('\n') === columns.join('\n')) return src
  return editView(src, i, (e, get) =>
    setList(e, get, 'order', columns, { same: (c, old) => old === c, emit: (c, dash) => [`${pad(dash)}- ${yamlScalar(c)}`], flow: (c) => flowItem(c), order: VIEW_KEYS }),
  )
}

/**
 * 分组（看板按哪一列分列）；null 是不分组。日期列按月、按周写 by（groupBy 写成几行：property、by、direction）。
 * 和现在读到的一样就一个字不动（一行写的 {property: 日期, by: month} 也是）
 */
export function setViewGroup(src: string, i: number, g: BaseGroup | null): string {
  const cur = parseBaseDoc(src).views[i]
  if (!cur || sameGroup(cur.groupBy, g)) return src
  const GROUP_KEYS = ['property', 'by', 'direction']
  return editView(src, i, (e, get) => {
    if (!g) return setBlock(e, get, 'groupBy', null)
    const v = entryOf(get(), 'groupBy')?.value
    if (v?.kind === 'scalar' && !g.desc && !g.by && !flowMapOf(v.raw)) return setScalar(e, get, 'groupBy', g.prop)
    if (v?.kind === 'map') {
      const inner = () => mapOf(get(), 'groupBy')
      setScalar(e, inner, 'property', g.prop, { order: GROUP_KEYS })
      // 认不出的 by（以后的写法）换了列才拿掉
      const oldBy = str(plain(entryOf(inner(), 'by')?.value)).toLowerCase()
      if (g.by || GROUP_PERIODS.includes(oldBy as GroupPeriod) || g.prop !== cur.groupBy?.prop) setScalar(e, inner, 'by', g.by ?? null, { order: GROUP_KEYS })
      if (g.desc || entryOf(inner(), 'direction')) setScalar(e, inner, 'direction', g.desc ? 'DESC' : 'ASC', { order: GROUP_KEYS })
      return
    }
    setBlock(
      e,
      get,
      'groupBy',
      (col) => [`${pad(col + e.step)}property: ${yamlScalar(g.prop)}`, ...(g.by ? [`${pad(col + e.step)}by: ${g.by}`] : []), `${pad(col + e.step)}direction: ${g.desc ? 'DESC' : 'ASC'}`],
      { order: VIEW_KEYS },
    )
  })
}

/** 日历按哪一列排；null 拿掉 */
export function setViewDate(src: string, i: number, prop: string | null): string {
  return editView(src, i, (e, get) => setScalar(e, get, 'date', prop, { order: VIEW_KEYS }))
}

/** 画廊封面：'none' 不要封面，null 用正文第一张图（不写） */
export function setViewImage(src: string, i: number, image: string | null): string {
  return editView(src, i, (e, get) => setScalar(e, get, 'image', image, { order: VIEW_KEYS }))
}

/** 视图改名：只换 name 那一行 */
export function renameView(src: string, i: number, name: string): string {
  const n = name.trim()
  if (!n) return src
  return editView(src, i, (e, get) => setScalar(e, get, 'name', n, { order: VIEW_KEYS }))
}

/** 拖过的列宽（columnSize）；null 拿掉 */
export function setViewColSize(src: string, i: number, col: string, px: number | null): string {
  return editView(src, i, (e, get) => setNested(e, get, 'columnSize', col, px === null ? null : String(Math.round(px)), { order: VIEW_KEYS, keyNorm: stripNote }))
}

/** 表底这一列算什么（summaries，名字同以前：Sum、Average……）；null 不算 */
export function setViewSummary(src: string, i: number, col: string, id: string | null): string {
  return editView(src, i, (e, get) => setNested(e, get, 'summaries', col, id, { order: VIEW_KEYS, keyNorm: stripNote }))
}

/**
 * 换看法（视图菜单「看法」）：只换 type 那一行。换成看板、还没分组时按 opts.groupBy 分列；换成日历、还没写 date 时用 opts.date
 */
export function setViewType(src: string, i: number, type: ViewType, opts: { groupBy?: string; date?: string } = {}): string {
  let out = editView(src, i, (e, get) => setScalar(e, get, 'type', type, { order: VIEW_KEYS }))
  const v = parseBaseDoc(out).views[i]
  if (!v) return out
  if (type === 'kanban' && !v.groupBy && opts.groupBy) out = setViewGroup(out, i, { prop: opts.groupBy, desc: false })
  if (type === 'calendar' && !v.date && opts.date) out = setViewDate(out, i, opts.date)
  return out
}

/** 新加一个视图要写的东西 */
export interface NewView {
  type: ViewType
  /** 不给就是「看板」「看板 2」这样不重名的 */
  name?: string
  columns?: string[]
  groupBy?: string | null
  date?: string | null
  image?: string | null
}

function viewLines(v: NewView & { name: string }, dash: number, step: number): string[] {
  const k = dash + 2
  const out = [`${pad(dash)}- type: ${v.type}`, `${pad(k)}name: ${yamlScalar(v.name)}`]
  if (v.columns?.length) out.push(`${pad(k)}order:`, ...v.columns.map((c) => `${pad(k + step)}- ${yamlScalar(c)}`))
  if (v.groupBy) out.push(`${pad(k)}groupBy:`, `${pad(k + step)}property: ${yamlScalar(v.groupBy)}`, `${pad(k + step)}direction: ASC`)
  if (v.date) out.push(`${pad(k)}date: ${yamlScalar(v.date)}`)
  if (v.image) out.push(`${pad(k)}image: ${yamlScalar(v.image)}`)
  return out
}

/** 最右「+」加一个视图：加在最后一段后面 */
export function addView(src: string, v: NewView): string {
  const doc = parseBaseDoc(src)
  const name = v.name?.trim() || uniqueViewName(doc, viewLabel(v.type))
  return editText(src, (e) => {
    const seq = viewsSeq(e)
    if (!seq) {
      if (!rootMap(e)) return
      // 块里没写 views：先把默认的表格写出来，再加这一个
      ensureViews(e)
    }
    const s = viewsSeq(e)!
    e.splice(s.end, s.end, viewLines({ ...v, name }, s.col, e.step))
  })
}

/** 复制这个视图：紧跟在它后面加一段一模一样的（连注释、认不出的键），名字换成 name（不给是「全部 2」） */
export function duplicateView(src: string, i: number, name?: string): string {
  const doc = parseBaseDoc(src)
  const v = doc.views[i]
  if (!v) return src
  const n = name?.trim() || uniqueViewName(doc, v.name + ' 2')
  const withViews = editText(src, (e) => i === 0 && ensureViews(e))
  const e = new YamlEdit(withViews)
  const it = viewsSeq(e)?.items[i]
  if (!it) return src
  e.splice(it.end, it.end, e.lines.slice(it.line, it.end))
  setScalar(e, () => viewMap(e, i + 1), 'name', n, { order: VIEW_KEYS })
  return e.text()
}

/** 删掉一个视图：只拿掉那一段，数据不动；只剩一个时不删 */
export function removeView(src: string, i: number): string {
  return editText(src, (e) => {
    const s = viewsSeq(e)
    const it = s?.items[i]
    if (!s || !it || s.items.length < 2) return
    e.splice(it.lead, it.end, [])
  })
}

/** 视图换顺序：第 from 个挪到第 to 个的位置 */
export function moveView(src: string, from: number, to: number): string {
  return editText(src, (e) => {
    const s = viewsSeq(e)
    const it = s?.items[from]
    if (!s || !it || from === to || to < 0 || to >= s.items.length) return
    const lines = e.lines.slice(it.lead, it.end)
    e.splice(it.lead, it.end, [])
    const s2 = viewsSeq(e)!
    const at = to >= s2.items.length ? s2.end : s2.items[to]!.lead
    e.splice(at, at, lines)
  })
}

// ---------------------------------------------------------------- 写：公式、列的设置

/** 设一条公式（formulas 里一行）；null 拿掉，formulas 空了一起拿掉 */
export function setFormula(src: string, name: string, expr: string | null): string {
  const n = name.trim()
  if (!n) return src
  return editText(src, (e) => setNested(e, () => rootMap(e), 'formulas', n, expr === null ? null : expr.trim(), { order: beforeAuto(e, 'formulas') }))
}

const flowList = (xs: string[]) => '[' + xs.map(flowItem).join(', ') + ']'

/** 一列设置里软件管的那几个键写成什么（顺序照 PROP_KEYS） */
function defFields(def: PropDef): { key: (typeof PROP_KEYS)[number]; value: string | StatusGroup[] }[] {
  if (def.type === 'button') return [{ key: 'type', value: 'button' }]
  if (def.type === 'ai') return aiDefFields(def) as { key: (typeof PROP_KEYS)[number]; value: string }[]
  const out: { key: (typeof PROP_KEYS)[number]; value: string | StatusGroup[] }[] = [{ key: 'type', value: def.type }]
  if (def.type === 'status') out.push({ key: 'groups', value: def.groups })
  if (def.type === 'relation') {
    out.push({ key: 'to', value: def.to })
    if (def.twoWay) out.push({ key: 'twoWay', value: def.twoWay })
  }
  if (def.type === 'rollup') out.push({ key: 'via', value: def.via }, { key: 'prop', value: def.prop }, { key: 'calc', value: def.calc })
  return out
}

function fieldLines(def: PropDef, col: number, step: number): string[] {
  const out: string[] = []
  for (const f of defFields(def)) {
    if (typeof f.value === 'string') out.push(`${pad(col)}${f.key}: ${yamlScalar(f.value)}`)
    else out.push(`${pad(col)}${f.key}:`, ...f.value.map((g) => `${pad(col + step)}${yamlKey(g.name)}: ${flowList(g.options)}`))
  }
  return out
}

/**
 * 设一列的类型和设置（properties 里这一列）：只换变了的键（状态的一组改了选项只换那一组那一行）；
 * 别的键（displayName 这种）留着。null：拿掉软件管的键，空了连这一列、properties 一起拿掉
 */
export function setPropDef(src: string, name: string, def: PropDef | null): string {
  // 按钮列的 do 是一串动作，写法和自动化同一套（automation.ts）
  if (def?.type === 'button') return setButton(src, name, def.do)
  return editText(src, (e) => {
    const root = () => rootMap(e)
    const props = () => mapOf(root(), 'properties')
    const mine = () => mapOf(props(), name, stripNote)
    if (!def) {
      if (!mine()) return
      for (const k of PROP_KEYS) {
        const m = mine()
        const en = entryOf(m, k)
        if (m && en) removeEntry(e, m, en)
      }
      const p = props()
      const en = entryOf(p, name, stripNote)
      if (p && en && (!en.value || (en.value.kind === 'map' && !en.value.entries.length))) removeEntry(e, p, en)
      const r = root()
      const pe = entryOf(r, 'properties')
      if (r && pe && (!pe.value || (pe.value.kind === 'map' && !pe.value.entries.length))) removeEntry(e, r, pe)
      return
    }
    if (!props()) {
      if (!root()) return
      setBlock(e, root, 'properties', (col) => [`${pad(col + e.step)}${yamlKey(name)}:`, ...fieldLines(def, col + 2 * e.step, e.step)], { order: beforeAuto(e, 'properties') })
      return
    }
    if (!mine()) {
      setBlock(e, props, name, (col) => fieldLines(def, col + e.step, e.step))
      return
    }
    const fields = defFields(def)
    for (const k of PROP_KEYS) {
      const f = fields.find((x) => x.key === k)
      if (!f) {
        const m = mine()
        const en = entryOf(m, k)
        if (m && en) removeEntry(e, m, en)
      } else if (typeof f.value === 'string') setScalar(e, mine, k, f.value, { order: PROP_KEYS })
      else writeGroups(e, mine, f.value)
    }
  })
}

/** 状态的三组：每组一行「待开始: [未开始]」，只换变了的那一组 */
function writeGroups(e: YamlEdit, mine: () => YMap | null, groups: StatusGroup[]) {
  const gm = () => mapOf(mine(), 'groups')
  const cur = gm()
  const lines = (col: number) => groups.map((g) => `${pad(col)}${yamlKey(g.name)}: ${flowList(g.options)}`)
  if (!cur || cur.entries.map((x) => x.key).join('\n') !== groups.map((g) => g.name).join('\n')) {
    setBlock(e, mine, 'groups', (col) => lines(col + e.step), { order: PROP_KEYS })
    return
  }
  for (const g of groups) {
    const en = entryOf(gm(), g.name)!
    const old = plain(en.value)
    const same = Array.isArray(old) ? old.join('\n') === g.options.join('\n') : listOf(String(old)).join('\n') === g.options.join('\n')
    if (same) continue
    const line = e.lines[en.line]!
    e.splice(en.line, en.end, [line.slice(0, en.col) + `${en.raw}: ${flowList(g.options)}`])
  }
}

// ---------------------------------------------------------------- 写：列改名、删列（每个视图、筛选、公式一起）

/** 视图里用到一列的地方换掉（rename 给新名字）或拿掉（rename 是 null） */
function eachViewRef(src: string, col: string, rename: string | null): string {
  let out = src
  const is = (c: string) => c === col || (!col.startsWith('formula.') && c === 'note.' + col)
  const swap = (c: string) => (c.startsWith('note.') ? 'note.' + rename : rename!)
  const n = parseBaseDoc(out).views.length
  for (let i = 0; i < n; i++) {
    const v = parseBaseDoc(out).views[i]!
    const order = v.columns
    if (order.some(is)) out = setViewOrder(out, i, rename === null ? order.filter((c) => !is(c)) : order.map((c) => (is(c) ? swap(c) : c)))
    if (v.sort.some((s) => s.prop === col)) out = setViewSort(out, i, rename === null ? v.sort.filter((s) => s.prop !== col) : v.sort.map((s) => (s.prop === col ? { ...s, prop: rename } : s)))
    if (v.groupBy?.prop === col) out = setViewGroup(out, i, rename === null ? null : { ...v.groupBy, prop: rename })
    if (v.date === col) out = setViewDate(out, i, rename)
    for (const key of ['columnSize', 'summaries'] as const) {
      const e = new YamlEdit(out)
      const m = mapOf(viewMap(e, i), key)
      const en = entryOf(m, col, stripNote)
      if (!m || !en) continue
      if (rename === null) {
        out = key === 'columnSize' ? setViewColSize(out, i, col, null) : setViewSummary(out, i, col, null)
      } else {
        renameKey(e, en, en.key.startsWith('note.') ? 'note.' + rename : rename)
        out = e.text()
      }
    }
    const f = parseBaseDoc(out).views[i]!.filter
    const g = filterRef(f, col, rename)
    if (!sameItem(f, g)) out = editView(out, i, (e, get) => writeFilter(e, get, g, VIEW_KEYS))
  }
  return out
}

/** 筛选里用到这一列的条件：改名或拿掉；原样的句子里用到的也换（拿掉时整句拿掉） */
function filterRef(f: BaseFilter | null, col: string, rename: string | null): BaseFilter | null {
  const formula = col.startsWith('formula.')
  const bare = formula ? col.slice(8) : col
  return simplifyTop(
    renameInFilter(f, (x) => {
      if (isRaw(x)) {
        const p = parseExpr(x.raw)
        if (!p.ok) return x
        const r = exprRefs(p.ast)
        const uses = formula ? r.formulas.includes(bare) || r.names.includes(bare) : r.names.includes(bare) || r.notes.includes(bare)
        if (!uses) return x
        return rename === null ? null : { raw: renameRef(x.raw, bare, formula ? rename.slice(8) : rename, formula ? 'formula' : 'column') }
      }
      if (x.prop !== col) return x
      return rename === null ? null : { ...x, prop: rename }
    }),
  )
}

/** 最外层（以前的写法）的条件里用到这一列的：一样改名或拿掉，数据源那一条不动 */
function sharedRef(src: string, col: string, rename: string | null): string {
  const e = new YamlEdit(src)
  const top = filterFromYaml(plain(entryOf(rootMap(e), 'filters')?.value))
  const next = filterRef(top, col, rename)
  if (sameItem(top, next)) return src
  writeFilter(e, () => rootMap(e), next)
  return e.text()
}

/**
 * 列改名（存着的属性列，或关联、汇总、状态列）：properties 的键、每个视图的列 / 排序 / 分组 / 日期 / 列宽 / 计算 / 筛选、
 * 最外层的条件、公式里写的名字、汇总顺着的关联（via）都跟着换。每一篇笔记里的属性改名由调用的人做（renameProp）
 */
export function renameBaseColumn(src: string, from: string, to: string): string {
  const t = to.trim()
  if (!t || t === from) return src
  if (from.startsWith('formula.')) return renameBaseFormula(src, from.slice(8), t.replace(/^formula\./, ''))
  let out = eachViewRef(src, from, t)
  out = sharedRef(out, from, t)
  out = editText(out, (e) => {
    const p = mapOf(rootMap(e), 'properties')
    const en = entryOf(p, from, stripNote)
    if (en) renameKey(e, en, en.key.startsWith('note.') ? 'note.' + t : t)
  })
  const doc = parseBaseDoc(out)
  for (const [k, d] of Object.entries(doc.props)) if (d.type === 'rollup' && d.via === from) out = setPropDef(out, k, { ...d, via: t })
  for (const [k, f] of Object.entries(doc.formulas)) {
    const g = renameRef(f, from, t, 'column')
    if (g !== f) out = setFormula(out, k, g)
  }
  return out
}

/** 公式改名：formulas 的键、视图里的 formula.旧名、别的公式里用到它的地方 */
export function renameBaseFormula(src: string, from: string, to: string): string {
  const t = to.trim()
  if (!t || t === from) return src
  let out = eachViewRef(src, 'formula.' + from, 'formula.' + t)
  out = sharedRef(out, 'formula.' + from, 'formula.' + t)
  out = editText(out, (e) => {
    const en = entryOf(mapOf(rootMap(e), 'formulas'), from)
    if (en) renameKey(e, en, t)
  })
  for (const [k, f] of Object.entries(parseBaseDoc(out).formulas)) {
    const g = renameRef(f, from, t, 'formula')
    if (g !== f) out = setFormula(out, k, g)
  }
  return out
}

/** 删一列：每个视图里拿掉它（列、排序、分组、日期、列宽、计算、用到它的筛选），properties 里的设置一起拿掉；公式列连公式一起删 */
export function dropBaseColumn(src: string, col: string): string {
  let out = eachViewRef(src, col, null)
  out = sharedRef(out, col, null)
  if (col.startsWith('formula.')) return setFormula(out, col.slice(8), null)
  const e = new YamlEdit(out)
  const p = mapOf(rootMap(e), 'properties')
  const en = entryOf(p, col, stripNote)
  if (p && en) {
    removeEntry(e, p, en)
    const r = rootMap(e)
    const pe = entryOf(r, 'properties')
    if (r && pe && pe.value?.kind === 'map' && !pe.value.entries.length) removeEntry(e, r, pe)
    else if (r && pe && !pe.value) removeEntry(e, r, pe)
  }
  return e.text()
}
