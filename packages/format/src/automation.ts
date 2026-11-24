/**
 * 自动化的写法（2026-11-22 数据库第三批「当……就……」，设计页 14-数据库第三批/automations「存进 md 的样子」）。
 * 不预置具体规则：软件只认这套写法（当 + 如果 + 就），规则都由用户自己建；软件自带的只有周记、梦游、定时整理收件箱。
 *
 * 数据库的规则写在那篇文档 ```base 块的最后一段 automations；库里的（周记、整理收件箱）写在 `.canvas-notes/自动化.md`
 * 的一个 ```yaml 代码块里，同一种写法（那里最外层就是一串规则）：
 *
 *   automations:
 *     - name: 自动猜分类
 *       on: false                         关掉不删（不写是开着）
 *       when: {added: true}               当：新加一条
 *       if: 分类.isEmpty()                如果：可以不写，和筛选同一种写法（一句，或 {and: [a, b]}、{or: […]}）
 *       do:                               就：一步步做
 *         - ai: cell
 *           prop: 分类
 *           prompt: 照名字猜是哪一类，只从已有的分类里选
 *     - name: 月底写账单摘要
 *       when: {every: month, day: last, at: "21:00"}
 *       missed: once                      Mac 关着错过了：下次打开补跑一次（once，不写也是）；skip 跳过、记一行
 *       do:
 *         - ai: summary
 *           rows: 日期.month == today().month
 *           folder: 生活/记账/账单摘要
 *
 * 当（when，一个或一串 [a, b]，任一样发生就跑）：
 *   {added: true}                         新加一条
 *   {changed: 列}                         某一列改了
 *   {changed: 列, to: 值}                 某一列改成某个值
 *   {date: 日期列, before: 1, at: "9:00"} 到了某一列的日子（提前几天、几点；不写是当天 9:00）
 *   {every: day | week | month, day: 日 | 15 | last, at: "21:00"}  定时（每天、每周几、每月几号 / 最后一天）
 * 就（do，一步一项）：
 *   - set: {分类: 报销}                                   改这一条的某一列
 *   - newRow: {copy: [名字, 金额], set: {日期: today()}}  新建一条（照这一条抄几列、设几列）
 *   - ai: cell / note / summary（prop、prompt、folder、rows、name、use: 家/模型/想多久）  AI 写这一格 / 新建一篇笔记并关联 / 写摘要
 *   - todo: 交报销单：{{名字}} {{金额}}（file、date: 下周一 9:00）  加一条待办（到点提醒交给画布今日）
 *   - notify: 这笔有点大：{{名字}} {{金额}}                发通知
 *   - command: /整理成通顺笔记（reads: [...]）            运行一条存过的命令
 *   - newNote: {folder: 周记, name: "{{年}}-W{{周}}", template: 周记/模板.md, ifExists: keep}  新建一篇（库里的规则用）
 *   - tidyInbox: true                                     整理收件箱（库里的规则用）
 *   - ask: 真的要再记一笔吗？  /  - open: true            只给按钮：先问一句、在右栏打开它
 * 按钮列是 properties 里 `type: button` 的一列，`do:` 和上面同一套。
 *
 * 打开再保存不变：读不改字；改一条只换那一条的那几行（开关只换 `on: false` 一行，一步没变就原样留着），
 * 别的规则、认不出的键、注释原样；改了和原来一样就一个字不动。测试：test/automation.test.ts。
 */
import { type BaseCond, type BaseFilter, filterFromYaml, isGroup, itemExpr, type RawCond, sameItem } from './base-filter'
import { entryOf, insertLine, mapOf, pad, parseYaml, prefixOf, removeEntry, setBlock, setList, setScalar, type Y, YamlEdit, yamlKey, yamlScalar, type YMap, type YNode, type YSeq } from './base-yaml'

// ---------------------------------------------------------------- 类型

/** 当：什么时候跑 */
export type AutoWhen =
  | { on: 'added' }
  | { on: 'changed'; prop: string; to?: string }
  | { on: 'date'; prop: string; before?: number; at?: string }
  | { on: 'every'; every: 'day' | 'week' | 'month'; day?: string; at: string }

export type AutoAiMode = 'cell' | 'note' | 'summary'

/** 就：一步 */
export type AutoStep =
  | { do: 'set'; values: Record<string, string> }
  | { do: 'newRow'; copy?: string[]; set?: Record<string, string>; name?: string }
  | { do: 'ai'; ai: AutoAiMode; prompt: string; prop?: string; folder?: string; rows?: string; name?: string; use?: string }
  | { do: 'todo'; text: string; file?: string; date?: string }
  | { do: 'notify'; text: string }
  | { do: 'command'; command: string; reads?: string[] }
  | { do: 'newNote'; folder: string; name: string; template?: string; ifExists?: 'keep' | 'new' }
  | { do: 'tidyInbox' }
  | { do: 'ask'; text: string }
  | { do: 'open'; target?: string }
  /** 认不出的一步：原样留着，跑到它时报错停下 */
  | { do: 'unknown'; key: string; raw: Y }

export type AutoStepKind = AutoStep['do']

export interface AutoRule {
  name: string
  /** false：关掉了（写 on: false），不删 */
  on: boolean
  when: AutoWhen[]
  /** 如果：和筛选同一种写法；null 是不写（总是跑） */
  if: BaseFilter | null
  /** Mac 关着错过了：once 下次打开补跑一次，skip 跳过记一行；null 是没写（当 once） */
  missed: 'once' | 'skip' | null
  do: AutoStep[]
}

/** 按钮列（properties 里 type: button 的一列） */
export interface ButtonDef {
  type: 'button'
  do: AutoStep[]
}

/** 每种「当」「就」叫什么（界面、记录、AI 填规则共用；照设计页） */
export const AUTO_WHENS: { on: AutoWhen['on'] | 'set'; label: string; icon: string; desc: string }[] = [
  { on: 'added', label: '新加一条', icon: 'add', desc: '数据库里多了一篇' },
  { on: 'changed', label: '某一列改了', icon: 'edit', desc: '任何人、在哪改的都算（手机上改的同步过来也算）' },
  { on: 'set', label: '某一列改成某个值', icon: 'arrow-circle-down', desc: '比如「分类」改成「报销」' },
  { on: 'date', label: '到了某一列的日子', icon: 'calendar', desc: '按日期列，能提前几天、定几点' },
  { on: 'every', label: '定时', icon: 'clockface', desc: '每天、每周几、每月几号' },
]

export const AUTO_STEPS: { kind: AutoStepKind; ai?: AutoAiMode; label: string; icon: string; group: string; only?: 'button' | 'library' }[] = [
  { kind: 'set', label: '改这一条的某一列', icon: 'edit', group: '改数据' },
  { kind: 'newRow', label: '新建一条', icon: 'add', group: '改数据' },
  { kind: 'ai', ai: 'cell', label: 'AI 写这一格', icon: 'sparkle', group: 'AI（和 AI 列一套）' },
  { kind: 'ai', ai: 'note', label: 'AI 新建一篇笔记并关联', icon: 'sparkle', group: 'AI（和 AI 列一套）' },
  { kind: 'ai', ai: 'summary', label: 'AI 写摘要', icon: 'sparkle', group: 'AI（和 AI 列一套）' },
  { kind: 'todo', label: '加一条待办或提醒', icon: 'tasklist', group: '告诉我' },
  { kind: 'notify', label: '发通知', icon: 'bell', group: '告诉我' },
  { kind: 'command', label: '运行一条存过的命令', icon: 'terminal', group: '命令' },
  { kind: 'newNote', label: '新建一篇', icon: 'new-file', group: '库里', only: 'library' },
  { kind: 'tidyInbox', label: '整理收件箱', icon: 'inbox', group: '库里', only: 'library' },
  { kind: 'ask', label: '先问一句', icon: 'comment', group: '只给按钮', only: 'button' },
  { kind: 'open', label: '在右栏打开它', icon: 'layout-sidebar-right', group: '只给按钮', only: 'button' },
]

/** 规则里的键的先后 */
const RULE_KEYS = ['name', 'on', 'when', 'if', 'missed', 'do'] as const
/** 一步里认的第一个键（决定是哪一步） */
const STEP_KEYS = ['set', 'newRow', 'ai', 'todo', 'notify', 'command', 'newNote', 'tidyInbox', 'ask', 'open'] as const
/** 库里的规则放在哪 */
export const AUTO_LIB_PATH = '.canvas-notes/自动化.md'
/** 每次跑一行的记录放在哪个文件夹（一个月一份 2026-11.jsonl） */
export const AUTO_LOG_DIR = '.canvas-notes/自动化记录'

// ---------------------------------------------------------------- 一行的 {a: b, c: [d, e]}

/**
 * 读一行写完的映射、列表：{added: true}、[{added: true}, {changed: 分类, to: 报销}]、{copy: [名字, 金额], set: {日期: today()}}。
 * 没加引号的字读到这一层的逗号、括号为止（圆括号、引号里的逗号不算：if(收支 == "收入", 金额, "") 是一个字）。读不懂返回 null
 */
export function parseFlow(src: string): Y | null {
  const s = src.trim()
  let i = 0
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++
  }
  const fail = (): never => {
    throw new FlowError()
  }
  const quoted = (): string => {
    const q = s[i]!
    let out = ''
    i++
    while (i < s.length) {
      const c = s[i]!
      if (q === '"' && c === '\\') {
        const n = s[i + 1] ?? ''
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n
        i += 2
        continue
      }
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        i++
        return out
      }
      out += c
      i++
    }
    return fail()
  }
  /** 没加引号的字：读到这一层的 , ] }（key：再加上「: 」） */
  const plainText = (key: boolean): string => {
    const start = i
    let depth = 0
    let q: string | null = null
    while (i < s.length) {
      const c = s[i]!
      if (q) {
        if (c === '\\' && q === '"') i++
        else if (c === q) q = null
        i++
        continue
      }
      if (c === '"' || c === "'") q = c
      else if (c === '(') depth++
      else if (c === ')') depth = Math.max(0, depth - 1)
      else if (depth === 0 && (c === ',' || c === ']' || c === '}')) break
      else if (depth === 0 && key && c === ':' && (i + 1 >= s.length || /[\s,}]/.test(s[i + 1]!))) break
      i++
    }
    return s.slice(start, i).trim()
  }
  const value = (): Y => {
    ws()
    const c = s[i]
    if (c === '{') return map()
    if (c === '[') return seq()
    if (c === '"' || c === "'") {
      const v = quoted()
      ws()
      return v
    }
    return plainText(false)
  }
  const map = (): Y => {
    const out: { [k: string]: Y } = {}
    i++
    ws()
    if (s[i] === '}') {
      i++
      return out
    }
    for (;;) {
      ws()
      const key = s[i] === '"' || s[i] === "'" ? quoted() : plainText(true)
      ws()
      let v: Y = ''
      if (s[i] === ':') {
        i++
        ws()
        if (s[i] !== ',' && s[i] !== '}') v = value()
      }
      if (!Object.hasOwn(out, key)) out[key] = v
      ws()
      if (s[i] === ',') {
        i++
        continue
      }
      if (s[i] === '}') {
        i++
        return out
      }
      return fail()
    }
  }
  const seq = (): Y => {
    const out: Y[] = []
    i++
    ws()
    if (s[i] === ']') {
      i++
      return out
    }
    for (;;) {
      out.push(value())
      ws()
      if (s[i] === ',') {
        i++
        continue
      }
      if (s[i] === ']') {
        i++
        return out
      }
      return fail()
    }
  }
  try {
    const v = value()
    ws()
    return i === s.length ? v : null
  } catch (e) {
    if (e instanceof FlowError) return null
    throw e
  }
}

class FlowError extends Error {}

/** 一行的列表、映射里的一个字：会被读歪的加双引号（钟点 "21:00" 也加，照设计页） */
export function flowScalar(s: string): string {
  const q = () => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  if (s === '' || /^\s|\s$/.test(s) || /^[[\]{}"'&*!|>%@`#,?]/.test(s) || /^\d{1,2}:\d{2}$/.test(s) || /[\n\t]/.test(s) || / #|: |:$/.test(s)) return q()
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth <= 0 && /[,[\]{}]/.test(c)) return q()
  }
  return quote || depth !== 0 ? q() : s
}

/** 写成一行：{a: b, c: [d, e]} */
export function flowText(y: Y): string {
  if (typeof y === 'string') return flowScalar(y)
  if (Array.isArray(y)) return `[${y.map(flowText).join(', ')}]`
  return `{${Object.entries(y)
    .map(([k, v]) => `${flowKey(k)}: ${flowText(v)}`)
    .join(', ')}}`
}

const flowKey = (k: string) => (/^[^\s:#'"{}[\],&*!|>%@`?-][^:#'"{}[\],]*$/.test(k) && !/\s$/.test(k) ? k : `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)

/** 树里的一个值读成普通的值：一行写的 {…}、[…] 按上面的读法读（base-yaml 的 plain 不认一行的映射） */
export function yOf(n: YNode | null | undefined): Y {
  if (!n) return ''
  if (n.kind === 'scalar' || n.kind === 'flow') {
    const raw = n.raw.trim()
    if (raw.startsWith('{') || (n.kind === 'flow' && raw.startsWith('['))) {
      const f = parseFlow(raw)
      if (f !== null) return f
    }
    if (n.kind === 'flow') return n.items.map((x) => yOf(x))
    return n.value
  }
  if (n.kind === 'seq') return n.items.map((it) => yOf(it.value))
  const out: { [k: string]: Y } = {}
  for (const e of n.entries) if (!Object.hasOwn(out, e.key)) out[e.key] = yOf(e.value)
  return out
}

/** 已经读成普通值、里面还留着一行的 {…} 字的（按钮列从 parseBaseDoc 来）：再读一遍 */
export function unflow(y: Y): Y {
  if (typeof y === 'string') {
    const t = y.trim()
    if (t.startsWith('{')) return parseFlow(t) ?? y
    return y
  }
  if (Array.isArray(y)) return y.map(unflow)
  const out: { [k: string]: Y } = {}
  for (const [k, v] of Object.entries(y)) out[k] = unflow(v)
  return out
}

// ---------------------------------------------------------------- 读

const isMapY = (y: Y | undefined): y is { [k: string]: Y } => !!y && typeof y === 'object' && !Array.isArray(y)
const s = (y: Y | undefined) => (typeof y === 'string' ? y.trim() : '')
const listY = (y: Y | undefined): Y[] => (Array.isArray(y) ? y : y === undefined || y === '' ? [] : [y])
const strMap = (y: Y | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (isMapY(y)) for (const [k, v] of Object.entries(y)) if (typeof v === 'string') out[k] = v.trim()
  return out
}
const strList = (y: Y | undefined): string[] =>
  listY(y)
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
const truthyY = (y: Y | undefined) => /^(true|yes|on|1)$/i.test(s(y))
const numY = (y: Y | undefined): number | undefined => (/^-?\d+$/.test(s(y)) ? Number(s(y)) : undefined)

const EVERY: Record<string, 'day' | 'week' | 'month'> = { day: 'day', daily: 'day', 每天: 'day', week: 'week', weekly: 'week', 每周: 'week', month: 'month', monthly: 'month', 每月: 'month' }

/** 「当」的一项 */
export function whenOf(y: Y): AutoWhen | null {
  if (typeof y === 'string') {
    const t = y.trim()
    if (t === 'added') return { on: 'added' }
    return null
  }
  if (!isMapY(y)) return null
  if ('added' in y && (truthyY(y.added) || s(y.added) === '')) return { on: 'added' }
  if (s(y.changed)) return { on: 'changed', prop: s(y.changed), ...(y.to !== undefined ? { to: s(y.to) } : {}) }
  if (s(y.date)) {
    const before = numY(y.before)
    return { on: 'date', prop: s(y.date), ...(before ? { before } : {}), ...(s(y.at) ? { at: s(y.at) } : {}) }
  }
  if (s(y.every)) {
    const every = EVERY[s(y.every).toLowerCase()]
    if (!every) return null
    return { on: 'every', every, ...(s(y.day) ? { day: s(y.day) } : {}), at: s(y.at) || '09:00' }
  }
  return null
}

/** 一步 */
export function stepOf(y: Y): AutoStep {
  if (typeof y === 'string') {
    const k = y.trim()
    if (k === 'tidyInbox') return { do: 'tidyInbox' }
    if (k === 'open') return { do: 'open' }
    return { do: 'unknown', key: k, raw: y }
  }
  if (!isMapY(y)) return { do: 'unknown', key: '', raw: y }
  const key = STEP_KEYS.find((k) => Object.hasOwn(y, k))
  const v = key ? y[key] : undefined
  switch (key) {
    case 'set':
      return { do: 'set', values: strMap(v) }
    case 'newRow': {
      const m = isMapY(v) ? v : {}
      const copy = strList(m.copy)
      const set = strMap(m.set)
      return { do: 'newRow', ...(copy.length ? { copy } : {}), ...(Object.keys(set).length ? { set } : {}), ...(s(m.name) ? { name: s(m.name) } : {}) }
    }
    case 'ai': {
      const mode = s(v) as AutoAiMode
      if (mode !== 'cell' && mode !== 'note' && mode !== 'summary') return { do: 'unknown', key: 'ai', raw: y }
      const opt = (k: string) => (s(y[k]) ? { [k]: s(y[k]) } : {})
      return { do: 'ai', ai: mode, prompt: s(y.prompt), ...opt('prop'), ...opt('folder'), ...opt('rows'), ...opt('name'), ...opt('use') }
    }
    case 'todo':
      return { do: 'todo', text: s(v), ...(s(y.file) ? { file: s(y.file) } : {}), ...(s(y.date) ? { date: s(y.date) } : {}) }
    case 'notify':
      return { do: 'notify', text: s(v) }
    case 'command': {
      const reads = strList(y.reads)
      return { do: 'command', command: s(v), ...(reads.length ? { reads } : {}) }
    }
    case 'newNote': {
      const m = isMapY(v) ? v : {}
      const ie = s(m.ifExists)
      return { do: 'newNote', folder: s(m.folder), name: s(m.name), ...(s(m.template) ? { template: s(m.template) } : {}), ...(ie === 'keep' || ie === 'new' ? { ifExists: ie } : {}) }
    }
    case 'tidyInbox':
      return { do: 'tidyInbox' }
    case 'ask':
      return { do: 'ask', text: s(v) }
    case 'open':
      return { do: 'open', ...(s(v) && !truthyY(v) ? { target: s(v) } : {}) }
  }
  return { do: 'unknown', key: Object.keys(y)[0] ?? '', raw: y }
}

/** 一条规则（列表里的一项，已经读成普通的值） */
export function ruleOf(y: Y, n = 1): AutoRule {
  const m = isMapY(y) ? y : {}
  const when = listY(m.when)
    .map(whenOf)
    .filter((w): w is AutoWhen => w !== null)
  const missed = s(m.missed)
  return {
    name: s(m.name) || `自动化 ${n}`,
    on: !/^(false|no|off|0)$/i.test(s(m.on)),
    when,
    if: m.if === undefined || m.if === '' ? null : filterFromYaml(m.if),
    missed: missed === 'once' || missed === 'skip' ? missed : null,
    do: listY(m.do).map(stepOf),
  }
}

/** 一串规则（YAML 列表那个节点） */
function rulesOf(seq: YNode | null | undefined): AutoRule[] {
  if (!seq || seq.kind !== 'seq') return []
  return seq.items.map((it, i) => ruleOf(yOf(it.value), i + 1))
}

function rootMapOf(root: YNode | null): YMap | null {
  return root?.kind === 'map' ? root : null
}

/** 一个 ```base 块（中间的 YAML）里的规则 */
export function parseAutomations(src: string): AutoRule[] {
  return rulesOf(entryOf(rootMapOf(parseYaml(src).root), 'automations')?.value)
}

/** 按钮列的设置（parseBaseDoc 读 properties 时调；y 是那一列读成的普通值） */
export function buttonDefOf(y: Y): ButtonDef {
  const m = isMapY(y) ? y : {}
  return { type: 'button', do: listY(unflow(m.do ?? '')).map(stepOf) }
}

// ---------------------------------------------------------------- 写

/** 一步写回去的普通值（写成几行时第一个键是哪一步） */
export function stepY(st: AutoStep): Y {
  switch (st.do) {
    case 'set':
      return { set: st.values }
    case 'newRow': {
      const m: { [k: string]: Y } = {}
      if (st.copy?.length) m.copy = st.copy
      if (st.set && Object.keys(st.set).length) m.set = st.set
      if (st.name) m.name = st.name
      return { newRow: Object.keys(m).length ? m : 'true' }
    }
    case 'ai': {
      const m: { [k: string]: Y } = { ai: st.ai }
      for (const k of ['prop', 'prompt', 'rows', 'folder', 'name', 'use'] as const) if (st[k]) m[k] = st[k]!
      return m
    }
    case 'todo':
      return { todo: st.text, ...(st.file ? { file: st.file } : {}), ...(st.date ? { date: st.date } : {}) }
    case 'notify':
      return { notify: st.text }
    case 'command':
      return { command: st.command, ...(st.reads?.length ? { reads: st.reads } : {}) }
    case 'newNote':
      return { newNote: { folder: st.folder, name: st.name, ...(st.template ? { template: st.template } : {}), ...(st.ifExists ? { ifExists: st.ifExists } : {}) } }
    case 'tidyInbox':
      return { tidyInbox: 'true' }
    case 'ask':
      return { ask: st.text }
    case 'open':
      return { open: st.target ?? 'true' }
    case 'unknown':
      return st.raw
  }
}

/** 一个值写在「键: 」后面：映射、列表写成一行，字照 YAML 的规矩加引号 */
const inlineY = (y: Y) => (typeof y === 'string' ? (y === 'true' ? 'true' : yamlScalar(y)) : flowText(y))

/** 一步写成几行：「-」在 dash 那一格；值是映射的一项（newRow、newNote、set）写成一行，几个键的（ai、todo）第一个键跟着「-」 */
export function stepLines(st: AutoStep, dash: number): string[] {
  const y = stepY(st)
  if (typeof y === 'string' || Array.isArray(y)) return [`${pad(dash)}- ${inlineY(y)}`]
  const entries = Object.entries(y)
  return entries.map(([k, v], i) => `${i === 0 ? pad(dash) + '- ' : pad(dash + 2)}${yamlKey(k)}: ${inlineY(v)}`)
}

/** 「当」写成一行 */
export function whenText(w: AutoWhen[]): string {
  const one = (x: AutoWhen): Y => {
    if (x.on === 'added') return { added: 'true' }
    if (x.on === 'changed') return { changed: x.prop, ...(x.to !== undefined ? { to: x.to } : {}) }
    if (x.on === 'date') return { date: x.prop, ...(x.before ? { before: String(x.before) } : {}), ...(x.at ? { at: x.at } : {}) }
    return { every: x.every, ...(x.day ? { day: x.day } : {}), at: x.at }
  }
  const raw = (y: Y) => flowText(y).replace(/: "true"/g, ': true')
  return w.length === 1 ? raw(one(w[0]!)) : `[${w.map((x) => raw(one(x))).join(', ')}]`
}

/** 「如果」写成一行：一句照写；几句写成 {and: [a, b]}，组套组 */
export function ifText(f: BaseFilter): string {
  if (f.conj === 'and' && f.items.length === 1 && !isGroup(f.items[0]!)) return yamlScalar(itemExpr(f.items[0]! as BaseCond | RawCond))
  const one = (g: BaseFilter): string => `{${g.conj}: [${g.items.map((x) => (isGroup(x) ? one(x) : flowScalar(itemExpr(x)))).join(', ')}]}`
  return one(f)
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameWhen = (a: AutoWhen[], b: AutoWhen[]) => sameJson(a, b)
const sameIf = (a: BaseFilter | null, b: BaseFilter | null) => (!a || !a.items.length ? !b || !b.items.length : !!b && sameItem(a, b))
const sameStep = (a: AutoStep, b: AutoStep) => sameJson(normStep(a), normStep(b))
/** 比两步一不一样：键的先后不算 */
const normStep = (st: AutoStep) => sortKeys(stepY(st))
const sortKeys = (y: Y): Y => (typeof y === 'string' ? y : Array.isArray(y) ? y.map(sortKeys) : Object.fromEntries(Object.keys(y).sort().map((k) => [k, sortKeys(y[k]!)])))

/** 整条规则写成几行（新加一条时用）：「- name:」在 dash 那一格 */
export function ruleLines(r: AutoRule, dash: number, step = 2): string[] {
  const at = pad(dash + 2)
  const out = [`${pad(dash)}- name: ${yamlScalar(r.name)}`]
  if (!r.on) out.push(`${at}on: false`)
  if (r.when.length) out.push(`${at}when: ${whenText(r.when)}`)
  if (r.if && r.if.items.length) out.push(`${at}if: ${ifText(r.if)}`)
  if (r.missed) out.push(`${at}missed: ${r.missed}`)
  out.push(`${at}do:`)
  for (const st of r.do) out.push(...stepLines(st, dash + 2 + step))
  return out
}

/** 一个键的值换成一行写好的字（不加引号）；读回来和原来一样就不动 */
function setRaw(e: YamlEdit, getMap: () => YMap | null, key: string, raw: string | null, same: (old: Y) => boolean) {
  const m = getMap()
  if (!m) return
  const en = entryOf(m, key)
  if (raw === null) {
    if (en) removeEntry(e, m, en)
    return
  }
  if (en && same(yOf(en.value))) return
  if (en) {
    const line = e.lines[en.line]!
    const tail = /\s+#.*$/.exec(line.slice(en.col))?.[0] ?? ''
    e.splice(en.line, en.end, [prefixOf(e, en.line, en.col) + `${en.raw}: ${raw}` + (en.end === en.line + 1 ? tail : '')])
    return
  }
  const at = insertLine(e, m, key, RULE_KEYS)
  e.splice(at, at, [pad(m.col) + `${key}: ${raw}`])
}

/** 改列表里已有的一条：只换变了的键；一步没变的原样留着 */
function editRule(e: YamlEdit, getRule: () => YMap | null, r: AutoRule) {
  setScalar(e, getRule, 'name', r.name, { order: RULE_KEYS })
  setRaw(e, getRule, 'on', r.on ? null : 'false', (old) => /^(false|no|off|0)$/i.test(s(old)))
  setRaw(e, getRule, 'when', r.when.length ? whenText(r.when) : null, (old) => sameWhen(listY(old).map(whenOf).filter((w): w is AutoWhen => w !== null), r.when))
  setRaw(e, getRule, 'if', r.if && r.if.items.length ? ifText(r.if) : null, (old) => sameIf(old === '' ? null : filterFromYaml(old), r.if))
  setRaw(e, getRule, 'missed', r.missed, (old) => s(old) === r.missed)
  if (!entryOf(getRule(), 'do') && !r.do.length) return
  setList(e, getRule, 'do', r.do.length ? r.do : [], {
    same: (st, old) => sameStep(st, stepOf(unflow(old))),
    emit: (st, dash) => stepLines(st, dash),
    order: RULE_KEYS,
  })
  // 一步都没有了：留一个空的 do:（规则还在，只是什么都不做）
  if (!r.do.length && !entryOf(getRule(), 'do')) {
    const m = getRule()
    if (m) e.splice(m.end, m.end, [pad(m.col) + 'do: []'])
  }
}

/** 列表里第 i 条（不在是 null） */
const ruleMap = (seq: YSeq | null, i: number): YMap | null => {
  const v = seq?.items[i]?.value
  return v?.kind === 'map' ? v : null
}

interface SeqHost {
  /** 那一串规则（没有是 null） */
  seq(e: YamlEdit): YSeq | null
  /** 还没有这一串时建出来，返回「-」在第几格 */
  create(e: YamlEdit, lines: (dash: number) => string[]): void
}

function editRules(src: string, host: SeqHost, fn: (e: YamlEdit) => void): string {
  const e = new YamlEdit(src)
  fn(e)
  const out = e.text()
  return out === src ? src : out
}

/** 设第 i 条（null 或超出：加在最后） */
function putRule(src: string, host: SeqHost, i: number | null, r: AutoRule): string {
  return editRules(src, host, (e) => {
    const seq = host.seq(e)
    if (i !== null && ruleMap(seq, i)) {
      editRule(e, () => ruleMap(host.seq(e), i), r)
      return
    }
    if (!seq) {
      host.create(e, (dash) => ruleLines(r, dash, e.step))
      return
    }
    const dash = seq.col
    e.splice(seq.end, seq.end, ruleLines(r, dash, e.step))
  })
}

function dropRule(src: string, host: SeqHost, i: number): string {
  return editRules(src, host, (e) => {
    const seq = host.seq(e)
    const it = seq?.items[i]
    if (!seq || !it) return
    if (seq.items.length === 1) {
      host.create(e, () => [])
      return
    }
    e.splice(it.lead, it.end, [])
  })
}

// ---------------------------------------------------------------- base 块里的 automations

function baseRoot(e: YamlEdit): YMap | null {
  const r = e.root
  if (r?.kind === 'map') return r
  if (r) return null
  let end = e.lines.length
  while (end > 0 && e.lines[end - 1]!.trim() === '') end--
  return { kind: 'map', col: 0, entries: [], line: end, end }
}

const BASE_HOST: SeqHost = {
  seq(e) {
    const v = entryOf(baseRoot(e), 'automations')?.value
    return v?.kind === 'seq' ? v : null
  },
  create(e, lines) {
    const root = () => baseRoot(e)
    const body = lines(e.dashCol(0))
    if (!body.length) {
      setBlock(e, root, 'automations', null)
      return
    }
    // 加在整块最后（设计页：automations 是最后一段）
    const r = root()
    if (!r) return
    const en = entryOf(r, 'automations')
    if (en) {
      e.splice(en.line, en.end, [prefixOf(e, en.line, en.col) + 'automations:', ...body])
      return
    }
    e.splice(r.end, r.end, ['automations:', ...body])
  },
}

/** 设 base 块里第 i 条规则（null：加一条在最后）；只换那一条变了的那几行 */
export const setAutomation = (src: string, i: number | null, r: AutoRule) => putRule(src, BASE_HOST, i, r)
/** 删第 i 条（删了最后一条连 automations: 一起拿掉） */
export const removeAutomation = (src: string, i: number) => dropRule(src, BASE_HOST, i)
/** 开关：只换那一条的 `on: false` 一行 */
export function toggleAutomation(src: string, i: number, on: boolean): string {
  const r = parseAutomations(src)[i]
  return r ? setAutomation(src, i, { ...r, on }) : src
}

/** 按钮列：properties 里这一列写成 type: button + do（null 拿掉这一列的设置）；已有的一步没变的原样留着 */
export function setButton(src: string, name: string, steps: AutoStep[] | null): string {
  const e = new YamlEdit(src)
  const root = () => baseRoot(e)
  const props = () => mapOf(root(), 'properties')
  const mine = () => mapOf(props(), name, (k) => k.replace(/^note\./, ''))
  if (steps === null) {
    const p = props()
    const en = entryOf(p, name, (k) => k.replace(/^note\./, ''))
    if (p && en) removeEntry(e, p, en)
    const r = root()
    const pe = entryOf(r, 'properties')
    if (r && pe && (!pe.value || (pe.value.kind === 'map' && !pe.value.entries.length))) removeEntry(e, r, pe)
  } else if (!props()) {
    const r = root()
    if (!r) return src
    const col = e.step
    const body = [`${pad(col)}${yamlKey(name)}:`, `${pad(col * 2)}type: button`, `${pad(col * 2)}do:`, ...steps.flatMap((st) => stepLines(st, e.dashCol(col * 2)))]
    const views = entryOf(r, 'views')
    const at = views ? views.lead : r.end
    e.splice(at, at, ['properties:', ...body])
  } else if (!mine()) {
    setBlock(e, props, name, (col) => [`${pad(col + e.step)}type: button`, `${pad(col + e.step)}do:`, ...steps.flatMap((st) => stepLines(st, e.dashCol(col + e.step)))])
  } else {
    setScalar(e, mine, 'type', 'button')
    setList(e, mine, 'do', steps, { same: (st, old) => sameStep(st, stepOf(unflow(old))), emit: (st, dash) => stepLines(st, dash) })
  }
  const out = e.text()
  return out === src ? src : out
}

// ---------------------------------------------------------------- 库里的 .canvas-notes/自动化.md

/** 自动化.md 里放规则的那个代码块（```yaml，第一个）：块里的字、在全文里从哪到哪 */
export function libBlock(md: string): { src: string; from: number; to: number } | null {
  const m = /^```(?:ya?ml|automations)[ \t]*\n([\s\S]*?)^```[ \t]*$/m.exec(md)
  if (!m) return null
  const from = m.index + m[0].indexOf('\n') + 1
  return { src: m[1]!.replace(/\n$/, ''), from, to: from + m[1]!.replace(/\n$/, '').length }
}

const LIB_HOST: SeqHost = {
  seq(e) {
    const r = e.root
    return r?.kind === 'seq' ? r : null
  },
  create(e, lines) {
    let end = e.lines.length
    while (end > 0 && e.lines[end - 1]!.trim() === '') end--
    const body = lines(0)
    // 空了：块里留一行注释（整块拿掉了自动化.md 就成了一篇说明）
    e.splice(0, e.lines.length, body.length ? [...e.lines.slice(0, end).filter((l) => l.trim().startsWith('#')), ...body] : ['# 还没有规则'])
  },
}

/** 新建 自动化.md 时的样子（软件自带的周记、整理收件箱；有了这个文件才写，之前照 defaultLibRules 跑） */
export function libDoc(rules: AutoRule[]): string {
  return `# 自动化\n\n库里的「当……就……」：周记、定时整理收件箱，和你自己加的（数据库里的规则写在那个数据库的 base 块最后一段）。\n设置 › 自动化里能开关、改；也能直接改下面这一块，写法见画布笔记的说明。\n\n\`\`\`yaml\n${rules.flatMap((r) => ruleLines(r, 0)).join('\n')}\n\`\`\`\n`
}

/** 库里的规则（没有这个文件是软件自带的那几条） */
export function parseLibrary(md: string | null): AutoRule[] {
  if (md === null) return defaultLibRules()
  const b = libBlock(md)
  return b ? rulesOf(parseYaml(b.src).root) : []
}

function editLib(md: string | null, fn: (src: string) => string): string {
  const base = md ?? libDoc(defaultLibRules())
  const b = libBlock(base)
  if (!b) {
    const src = fn('')
    return base.replace(/\n*$/, '\n\n') + '```yaml\n' + src + '\n```\n'
  }
  const next = fn(b.src)
  return next === b.src ? base : base.slice(0, b.from) + next + base.slice(b.to)
}

/** 库里第 i 条（null：加一条）；md 是 null 时（还没有这个文件）先照自带的建出来 */
export const setLibRule = (md: string | null, i: number | null, r: AutoRule) => editLib(md, (src) => putRule(src, LIB_HOST, i, r))
export const removeLibRule = (md: string | null, i: number) => editLib(md, (src) => dropRule(src, LIB_HOST, i))
export function toggleLibRule(md: string | null, i: number, on: boolean): string {
  const r = parseLibrary(md)[i]
  return r ? setLibRule(md, i, { ...r, on }) : (md ?? '')
}

/**
 * 软件自带的两条（梦游是另一套，在设置 › 梦游；这里不写），默认都关着，用户在设置 › 自动化里打开才跑：
 * 周记周日 20:00（开着的话更新后头一次打开就会补跑，往库里新建一篇、加待办、提交，太突然）；定时整理收件箱每天 22:00
 */
export function defaultLibRules(): AutoRule[] {
  return [
    {
      name: '周记',
      on: false,
      when: [{ on: 'every', every: 'week', day: '日', at: '20:00' }],
      if: null,
      missed: 'once',
      do: [
        { do: 'newNote', folder: '周记', name: '{{年}}-W{{周}}', template: '周记/模板.md', ifExists: 'keep' },
        { do: 'command', command: '/写这周的周记', reads: ['写了剪了', '做完的待办', '梦游报告'] },
        { do: 'notify', text: '这周的周记建好了' },
        { do: 'todo', text: '写周记 [[{{新建的那篇}}]]', file: '周记/待办.md', date: '今天 21:00' },
      ],
    },
    { name: '整理收件箱', on: false, when: [{ on: 'every', every: 'day', at: '22:00' }], if: null, missed: 'skip', do: [{ do: 'tidyInbox' }] },
  ]
}

// ---------------------------------------------------------------- 一篇文档里的 base 块

/** 一篇 md 里每个 ```base 块：第几个、块里的字、在全文里从哪到哪（和 baseFoldersIn 同一个认法） */
export function baseBlocks(text: string): { index: number; src: string; from: number; to: number }[] {
  const out: { index: number; src: string; from: number; to: number }[] = []
  if (!text.includes('```base')) return out
  for (const m of text.matchAll(/^```base[^\n]*\n([\s\S]*?)^```/gm)) {
    const from = m.index! + m[0].indexOf('\n') + 1
    const body = m[1]!.replace(/\n$/, '')
    out.push({ index: out.length, src: body, from, to: from + body.length })
  }
  return out
}

/** 换掉第 index 个 base 块里的字 */
export function replaceBaseBlock(text: string, index: number, src: string): string {
  const b = baseBlocks(text)[index]
  if (!b || b.src === src) return text
  return text.slice(0, b.from) + src + text.slice(b.to)
}
