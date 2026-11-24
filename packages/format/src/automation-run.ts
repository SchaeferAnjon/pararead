/**
 * 自动化跑起来要的纯函数（写法见 automation.ts）：什么时候该跑（定时、到了某一列的日子、一条改了什么）、
 * 模板里的 {{名字}}、给人看的一句「当……如果……就……」、把一句话交给 AI 填成规则、每次一行的记录。
 * 读写文件、问 AI、提交、发通知在主进程（apps/notes/src/main/automation.ts）。不依赖 Electron 和 Node，手机版照着移植。
 */
import type { AutoRule, AutoStep, AutoWhen } from './automation'
import { AUTO_LOG_DIR, AUTO_STEPS, ruleOf, yOf } from './automation'
import { filterText } from './base-filter'
import type { FieldType } from './base-types'
import { parseYaml } from './base-yaml'
import { HIDDEN_KEYS, readFields } from './props'

// ---------------------------------------------------------------- 钟点、星期

const p2 = (n: number) => String(n).padStart(2, '0')
/** 2026-11-22 */
export const dayText = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** 2026-11-22T21:00:00（本地时间，记录、补跑用） */
export const stampText = (d: Date) => `${dayText(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`

/** 「21:00」「9:00」「9点」「晚上 9 点」→ 一天里第几分钟；认不出是 null */
export function minuteOf(at: string): number | null {
  const t = at.trim()
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t) ?? /^(\d{1,2})\s*点(?:\s*(\d{1,2})\s*分?|半)?$/.exec(t)
  if (m) {
    const h = Number(m[1])
    const mi = t.endsWith('半') ? 30 : Number(m[2] ?? 0)
    return h < 24 && mi < 60 ? h * 60 + mi : null
  }
  const pm = /^(下午|晚上|傍晚)\s*(\d{1,2})(?::(\d{2}))?\s*点?/.exec(t)
  if (pm) {
    const h = Number(pm[2]) % 12 + 12
    return h * 60 + Number(pm[3] ?? 0)
  }
  return null
}

const WEEKDAY: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
/** 「日」「周日」「星期天」「sun」「7」→ 0..6（周日是 0）；认不出是 null */
export function weekdayOf(day: string): number | null {
  const t = day.trim().toLowerCase().replace(/^(周|星期|礼拜)/, '')
  if (/^[0-7]$/.test(t)) return Number(t) % 7
  return WEEKDAY[t] ?? WEEKDAY[t.slice(0, 3)] ?? null
}

/** 这一天合不合定时的「哪天」：每天都合；每周看星期几（不写是周一）；每月看几号（last 是最后一天，不写是 1 号；31 号在小月是最后一天） */
function dayFits(w: Extract<AutoWhen, { on: 'every' }>, d: Date): boolean {
  if (w.every === 'day') return true
  if (w.every === 'week') return d.getDay() === (weekdayOf(w.day ?? '一') ?? 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const want = (w.day ?? '1').trim().toLowerCase()
  if (want === 'last' || want === '最后一天' || want === '月底') return d.getDate() === last
  const n = Number(want.replace(/[号日]$/, ''))
  return Number.isInteger(n) && n >= 1 ? d.getDate() === Math.min(n, last) : false
}

/** 定时在 (from, to] 里该跑的那几次（最多看 400 天；补跑只要最后一次） */
export function slotsIn(w: Extract<AutoWhen, { on: 'every' }>, from: Date, to: Date): Date[] {
  const min = minuteOf(w.at) ?? 9 * 60
  const out: Date[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let k = 0; k < 400 && d.getTime() <= to.getTime(); k++, d.setDate(d.getDate() + 1)) {
    if (!dayFits(w, d)) continue
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(min / 60), min % 60)
    if (at.getTime() > from.getTime() && at.getTime() <= to.getTime()) out.push(at)
  }
  return out
}

/** 下一次（设置页「下次 11月23日 20:00」）：now 之后最近的一次，400 天里没有是 null */
export function nextSlot(w: Extract<AutoWhen, { on: 'every' }>, now: Date): Date | null {
  return slotsIn(w, now, new Date(now.getTime() + 400 * 864e5))[0] ?? null
}

/** 「到了某一列的日子」：这一条那一列的值（2026-11-30、2026-11-30 14:00）该在几点跑；没有日子是 null */
export function dateFireAt(w: Extract<AutoWhen, { on: 'date' }>, value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(value.trim().replace(/^"|"$/g, ''))
  if (!m) return null
  const own = m[4] !== undefined ? Number(m[4]) * 60 + Number(m[5]) : null
  const min = w.at ? (minuteOf(w.at) ?? 9 * 60) : !w.before && own !== null ? own : 9 * 60
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - (w.before ?? 0), Math.floor(min / 60), min % 60)
}

// ---------------------------------------------------------------- 一条改了什么

/** 开头一串的每一列（一串的连成「a、b」）：比改之前、之后用；软件自己的键（AI填的、type…）不算 */
export function fieldValues(text: string): Record<string, string> {
  const { props, lists } = readFields(text)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(props)) if (!HIDDEN_KEYS.has(k)) out[k] = v
  for (const [k, v] of Object.entries(lists)) if (!HIDDEN_KEYS.has(k)) out[k] = v.join('、')
  return out
}

/** 改之前、之后开头那一串：哪几列变了（from、to 是给人看的值，没有是空字） */
export function fieldChanges(before: string, after: string): Record<string, { from: string; to: string }> {
  const a = fieldValues(before)
  const b = fieldValues(after)
  const out: Record<string, { from: string; to: string }> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] ?? '') !== (b[k] ?? '')) out[k] = { from: a[k] ?? '', to: b[k] ?? '' }
  return out
}

/** 一条数据库记录发生的事 */
export type RowEvent = { kind: 'added'; path: string } | { kind: 'changed'; path: string; changes: Record<string, { from: string; to: string }> }

const colName = (c: string) => c.replace(/^note\./, '')
/** 一个值是不是「改成了 to」：一样，或者一串里有它 */
const becomes = (v: string, to: string) => v.trim() === to.trim() || v.split('、').map((x) => x.trim()).includes(to.trim())

/** 这件事合不合这个「当」：合就给一句为什么（记录里「因为什么」），不合是 null */
export function whenFits(w: AutoWhen, ev: RowEvent, name: string): string | null {
  if (w.on === 'added') return ev.kind === 'added' ? `新加了「${name}」` : null
  if (w.on !== 'changed' || ev.kind !== 'changed') return null
  const c = ev.changes[colName(w.prop)]
  if (!c) return null
  if (w.to === undefined) return `「${name}」的「${colName(w.prop)}」改成了「${c.to}」`
  return becomes(c.to, w.to) && !becomes(c.from, w.to) ? `「${name}」的「${colName(w.prop)}」改成了「${w.to}」` : null
}

// ---------------------------------------------------------------- 模板里的 {{…}}

/** ISO 周（周一开始，含 1 月 4 日那一周是第 1 周）：年、第几周、周一、周日 */
export function isoWeekOf(d: Date): { year: number; week: number; monday: Date; sunday: Date } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const year = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7)
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (((d.getDay() + 6) % 7)))
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { year, week, monday, sunday }
}

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`

/** 时间的几个词：年、周（两位）、周一、周日（11月16日）、今天、月、日 */
export function timeVars(now: Date): Record<string, string> {
  const w = isoWeekOf(now)
  return { 年: String(w.year), 周: p2(w.week), 周一: md(w.monday), 周日: md(w.sunday), 今天: dayText(now), 月: p2(now.getMonth() + 1), 日: p2(now.getDate()) }
}

/** 一条记录的每一列（名字是文件名） */
export function rowVars(path: string, text: string): Record<string, string> {
  return { ...fieldValues(text), 名字: path.split('/').pop()!.replace(/\.md$/i, '') }
}

/** {{名字}} {{金额}} {{年}}-W{{周}} 换成值；没有的词换成空字 */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, k: string) => vars[k] ?? vars[colName(k)] ?? '')
}

// ---------------------------------------------------------------- 给人看的一句

const quoteV = (s: string) => s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1')
const EVERY_DAY: Record<string, string> = { last: '最后一天', 最后一天: '最后一天', 月底: '最后一天' }

/** 「当」的一样：新加一条、「金额」改了、「分类」改成「报销」、到了「日期」那天 9:00、每周日 21:00 */
export function whenLabel(w: AutoWhen): string {
  if (w.on === 'added') return '新加一条'
  if (w.on === 'changed') return w.to === undefined ? `「${colName(w.prop)}」改了` : `「${colName(w.prop)}」改成「${w.to}」`
  if (w.on === 'date') return `到了「${colName(w.prop)}」那天${w.before ? `前 ${w.before} 天` : ''} ${w.at ?? '9:00'}`
  if (w.every === 'day') return `每天 ${w.at}`
  if (w.every === 'week') {
    const d = weekdayOf(w.day ?? '一')
    return `每周${'日一二三四五六'[d ?? 1]} ${w.at}`
  }
  const day = (w.day ?? '1').trim().toLowerCase()
  return `每月${EVERY_DAY[day] ?? day.replace(/[号日]$/, '') + '号'} ${w.at}`
}

/** 「就」的一步 */
export function stepLabel(st: AutoStep): string {
  switch (st.do) {
    case 'set':
      return Object.entries(st.values)
        .map(([k, v]) => `把「${k}」改成「${v}」`)
        .join('，')
    case 'newRow':
      return '新建一条'
    case 'ai':
      return st.ai === 'cell' ? `AI 写「${st.prop ?? ''}」这一格` : st.ai === 'note' ? 'AI 新建一篇笔记并关联' : `AI 写摘要（读${st.rows ? '合条件的几条' : '这一条'}）`
    case 'todo':
      return `加一条待办「${quoteV(st.text)}」`
    case 'notify':
      return `发通知「${quoteV(st.text)}」`
    case 'command':
      return `运行 ${st.command}`
    case 'newNote':
      return `新建「${st.folder ? st.folder + '/' : ''}${quoteV(st.name)}」`
    case 'tidyInbox':
      return '整理收件箱'
    case 'ask':
      return '先问一句'
    case 'open':
      return '在右栏打开它'
    case 'unknown':
      return `认不出的一步「${st.key}」`
  }
}

/** 一条规则写成一句：当 新加一条 · 如果 分类 为空 · 就 AI 写「分类」这一格 */
export function ruleSentence(r: AutoRule, typeOf: (col: string) => FieldType = () => 'text'): string {
  const when = r.when.length ? r.when.map(whenLabel).join('，或 ') : '还没选'
  const cond = r.if && r.if.items.length ? ` · 如果 ${filterText(r.if, typeOf)}` : ''
  return `当 ${when}${cond} · 就 ${r.do.length ? r.do.map(stepLabel).join('，再 ') : '还没加'}`
}

// ---------------------------------------------------------------- 检查

export interface AutoScope {
  /** base：数据库里的；library：库里的（自动化.md）；button：按钮列 */
  kind: 'base' | 'library' | 'button'
  /** 数据库的列（名字、类型、单选的选项）；库里的规则没有 */
  columns: { name: string; type: FieldType; options?: string[] }[]
  /** 同一处已有的规则名（新建时查重） */
  names?: string[]
}

/** 一条规则有什么问题（存之前、AI 填完都查一遍）：空的是没问题 */
export function checkRule(r: AutoRule, scope: AutoScope): string[] {
  const out: string[] = []
  const has = (c: string) => colName(c) === 'file.name' || colName(c) === '名字' || scope.columns.some((x) => x.name === colName(c))
  const col = (c: string | undefined, what: string) => {
    if (scope.kind === 'library') return
    if (!c) out.push(`${what}没写是哪一列`)
    else if (!has(c)) out.push(`没有「${colName(c)}」这一列`)
  }
  if (!r.name.trim()) out.push('规则要有个名字')
  if (scope.names?.includes(r.name)) out.push(`已经有一条叫「${r.name}」`)
  if (scope.kind !== 'button' && !r.when.length) out.push('「当」还没选')
  for (const w of r.when) {
    if (scope.kind === 'library' && w.on !== 'every') out.push(`库里的规则只能定时（「${whenLabel(w)}」要写在数据库里）`)
    if (w.on === 'changed') col(w.prop, '「某一列改了」')
    if (w.on === 'date') {
      col(w.prop, '「到了某一列的日子」')
      const t = scope.columns.find((x) => x.name === colName(w.prop))?.type
      if (t && t !== 'date') out.push(`「${colName(w.prop)}」不是日期列`)
    }
    if ((w.on === 'every' || w.on === 'date') && w.at !== undefined && minuteOf(w.at) === null) out.push(`「${w.at}」认不出是几点`)
    if (w.on === 'every' && w.every === 'week' && w.day && weekdayOf(w.day) === null) out.push(`「${w.day}」认不出是星期几`)
  }
  if (!r.do.length) out.push('「就」还没加一步')
  for (const st of r.do) {
    const info = AUTO_STEPS.find((x) => x.kind === st.do && (!x.ai || (st.do === 'ai' && x.ai === st.ai)))
    if (st.do === 'unknown') out.push(stepLabel(st))
    else if (info?.only === 'button' && scope.kind !== 'button') out.push(`「${info.label}」只给按钮用`)
    else if (info?.only === 'library' && scope.kind !== 'library') out.push(`「${info.label}」只在库里的规则里用`)
    if (scope.kind === 'library' && (st.do === 'set' || st.do === 'newRow' || (st.do === 'ai' && st.ai !== 'summary'))) out.push(`「${stepLabel(st)}」要写在数据库里`)
    if (st.do === 'set') for (const k of Object.keys(st.values)) col(k, '「改这一条的某一列」')
    if (st.do === 'ai' && (st.ai === 'cell' || st.ai === 'note')) col(st.prop, `「${stepLabel(st)}」`)
    if (st.do === 'ai' && !st.prompt.trim() && st.ai !== 'summary') out.push(`「${stepLabel(st)}」要写要求`)
    if ((st.do === 'todo' || st.do === 'notify') && !st.text.trim()) out.push(`「${stepLabel(st)}」没写字`)
    if (st.do === 'command' && !/^\/\S/.test(st.command)) out.push(`命令要写成「/命令名」`)
    if (st.do === 'newNote' && (!st.folder || !st.name)) out.push('「新建一篇」要写放在哪、叫什么')
  }
  return [...new Set(out)]
}

// ---------------------------------------------------------------- 一句话 → 规则（方向 B「先说一句」）

/** 交给 AI 的话：头一行「命令：自动化规则」（假 AI 认这个） */
export function autoAsk(sentence: string, scope: AutoScope, today: string): { system: string; prompt: string } {
  const cols = scope.columns.map((c) => `- ${c.name}（${c.type}${c.options?.length ? `：${c.options.slice(0, 12).join('、')}` : ''}）`).join('\n')
  const where =
    scope.kind === 'library'
      ? '这条规则是库里的（不属于哪个数据库）：「当」只能定时，「就」能用 newNote、command、notify、todo、tidyInbox、ai: summary。'
      : `这条规则属于一个数据库，每一条记录是一篇笔记，列有：\n${cols || '（还没有列）'}\n名字列写「名字」。`
  return {
    system: '你把用户说的一句「当……就……」填成画布笔记的一条自动化规则。只用下面给的写法，只回一个 ```yaml 代码块，不解释。',
    prompt: `命令：自动化规则
今天：${today}
${where}

写法（YAML，一条规则是列表里的一项）：
- name: 短名字（四到八个字）
  when: 当，下面选一种，几种写成 [a, b]
    {added: true} 新加一条 · {changed: 列} 某一列改了 · {changed: 列, to: 值} 改成某个值
    {date: 日期列, before: 天数, at: "9:00"} 到了某一列的日子 · {every: day|week|month, day: 日|一…六|15|last, at: "21:00"} 定时
  if: 如果（可以不写），和数据库筛选同一种写法：分类.isEmpty()、收支 == "支出"、金额 > 500；几句写 {and: [a, b]}
  missed: once（定时的才写：Mac 关着错过了下次打开补跑一次）
  do: 就，一步一项：
    - set: {列: 值}
    - newRow: {copy: [列, 列], set: {列: 值}}
    - ai: cell / prop: 列 / prompt: 要求          （AI 写这一格）
    - ai: note / prop: 关联列 / prompt: 要求       （AI 新建一篇笔记并关联）
    - ai: summary / rows: 筛选 / prompt: 要求 / folder: 放哪   （AI 写摘要）
    - todo: 待办的字，可用 {{列名}} / file: 放进哪篇 / date: 下周一 9:00
    - notify: 通知的字，可用 {{列名}}
    - command: /存过的命令名
用户说「提醒我」：到点要响的写成 todo（带 date），马上告诉的写成 notify。只用上面有的列，不编列名。

用户说的：
${sentence.trim()}`,
  }
}

/** 认 AI 回的规则：```yaml 块（或整段）里第一条；读不出、问题太大（没有当、没有就）给一句错 */
export function autoParse(answer: string, scope: AutoScope): { rule: AutoRule; problems: string[] } | { error: string } {
  const fence = /```(?:ya?ml)?[ \t]*\n([\s\S]*?)```/.exec(answer)
  const src = (fence ? fence[1]! : answer).replace(/\t/g, '  ').trimEnd()
  const root = parseYaml(src).root
  const y = root?.kind === 'seq' ? yOf(root.items[0]?.value) : root?.kind === 'map' ? yOf(root) : null
  if (!y || typeof y !== 'object' || Array.isArray(y)) return { error: 'AI 这次没填出规则，换个说法再试一次' }
  const rule = ruleOf(y)
  if (!rule.when.length && scope.kind !== 'button') return { error: 'AI 没认出「当什么时候」，说清楚一点再试一次' }
  if (!rule.do.length) return { error: 'AI 没认出「就做什么」，说清楚一点再试一次' }
  return { rule, problems: checkRule(rule, { ...scope, names: undefined }) }
}

// ---------------------------------------------------------------- 记录（.canvas-notes/自动化记录/2026-11.jsonl，一次一行）

/** 规则在哪：lib 是库里的（自动化.md），别的是「文档路径#第几个 base 块」 */
export type AutoWhere = string
export const LIB_WHERE: AutoWhere = 'lib'
export const baseWhere = (doc: string, block = 0): AutoWhere => `${doc}#${block}`
export function parseWhere(w: AutoWhere): { doc: string; block: number } | null {
  const m = /^(.+\.md)#(\d+)$/i.exec(w)
  return m ? { doc: m[1]!, block: Number(m[2]) } : null
}

export interface AutoLogEntry {
  id: string
  /** 几点（本地时间 2026-11-22T21:00:05） */
  t: string
  /** 哪一条：规则名（按钮是列名） */
  rule: string
  where: AutoWhere
  /** 谁让它跑的：auto 自己到点 / 条件满足，missed 补跑，run 点了「现在跑一次」，button 点了按钮，link 深链和命令行 */
  by: 'auto' | 'missed' | 'run' | 'button' | 'link'
  /** 因为什么：「新加了「机场打车」」「每周日 20:00」 */
  why: string
  /** 做了什么，一步一句 */
  did: string[]
  /** 改了哪几个文件（记录自己不算） */
  files: string[]
  /** 那一次的提交号（只发了通知、没改文件是 null） */
  commit: string | null
  ok: boolean
  /** 出错时一句原因（这一条随后停下：写 on: false） */
  error?: string
  /** 能不能撤回（只发了通知的收不回） */
  undoable: boolean
  /** 定时那一次是哪个钟点（两台 Mac 都开着时只跑一次） */
  slot?: string
  /** 哪一条记录（数据库里的规则） */
  path?: string
  /** 撤回那一次：这一行是「撤回了 id」 */
  undo?: string
  /** 跳过了（错过了、选了 skip） */
  skipped?: boolean
}

/** 记录文件：一个月一份 */
export const logPathOf = (d: Date) => `${AUTO_LOG_DIR}/${d.getFullYear()}-${p2(d.getMonth() + 1)}.jsonl`

export const logLine = (e: AutoLogEntry) => JSON.stringify(e)

/** 读记录文件（坏了的行跳过） */
export function parseLog(text: string): AutoLogEntry[] {
  const out: AutoLogEntry[] = []
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    try {
      const e = JSON.parse(l) as AutoLogEntry
      if (e && typeof e.id === 'string' && typeof e.t === 'string' && typeof e.rule === 'string') out.push(e)
    } catch {
      // 半行（同步冲突、写到一半）：跳过这一行，别的照读
    }
  }
  return out
}

/** 撤回过的那几次 */
export const undoneIds = (log: readonly AutoLogEntry[]) => new Set(log.filter((e) => e.undo).map((e) => e.undo!))

/** 一条规则跑过几次、上次几点、最后一次是不是出错（从记录里算，设计页「跑过 12 次 · 上次 11月21日 08:40」） */
export function ruleStats(log: readonly AutoLogEntry[], where: AutoWhere, rule: string): { runs: number; last: string | null; error: string | null } {
  const mine = log.filter((e) => e.where === where && e.rule === rule && !e.undo && !e.skipped)
  const last = mine.reduce<AutoLogEntry | null>((a, b) => (!a || b.t > a.t ? b : a), null)
  return { runs: mine.filter((e) => e.ok).length, last: last?.t ?? null, error: last && !last.ok ? (last.error ?? '出错了') : null }
}

/** 记录的编号：几点 + 4 位 */
export const logId = (d: Date, rand: () => number) => `${stampText(d).replace(/[-:T]/g, '')}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`
