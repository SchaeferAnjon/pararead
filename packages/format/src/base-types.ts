/**
 * 数据库（```base 块）几个文件共用的小东西：列的类型、几种看法、加一列的菜单、多选的值。
 * 写法见 base-doc.ts 开头；算行、算格子见 base-rows.ts；公式和筛选的写法见 base-expr.ts。
 * 不依赖 Electron 和 Node（手机版照着移植）。
 */

/** 存在每一篇开头的列的类型（照 Notion 挑的常用几种）：文字、数字、选项（单选）、多选、日期、勾选、链接 */
export type ColType = 'text' | 'number' | 'date' | 'check' | 'select' | 'multi' | 'url'

export const COL_TYPES: { type: ColType; label: string }[] = [
  { type: 'text', label: '文字' },
  { type: 'number', label: '数字' },
  { type: 'select', label: '选项' },
  { type: 'multi', label: '多选' },
  { type: 'date', label: '日期' },
  { type: 'check', label: '勾选' },
  { type: 'url', label: '链接' },
]

/** 一列在界面上算哪一种：上面七种存着的，加上状态（分三组）、关联、汇总、公式；名字列（就是文件名）是 title */
export type FieldType = ColType | 'status' | 'relation' | 'rollup' | 'formula' | 'title' | 'button'

/** 四种看法。写进 base 块的 type 就是这几个词；画廊写 cards（以前的写法 gallery 也认） */
export type ViewType = 'table' | 'kanban' | 'calendar' | 'cards'

/** 视图标签条、「加一个视图」菜单用：名字和 Codicons 图标（照原型） */
export const VIEW_TYPES: { type: ViewType; label: string; icon: string }[] = [
  { type: 'table', label: '表格', icon: 'table' },
  { type: 'kanban', label: '看板', icon: 'project' },
  { type: 'calendar', label: '日历', icon: 'calendar' },
  { type: 'cards', label: '画廊', icon: 'preview' },
]

/** 写在文件里的 type 当哪种看法画：gallery 当画廊，认不出的（别的软件的 list、map）当表格 */
export function viewKind(type: string): ViewType {
  const t = type.trim().toLowerCase()
  if (t === 'kanban' || t === 'board') return 'kanban'
  if (t === 'calendar') return 'calendar'
  if (t === 'cards' || t === 'gallery') return 'cards'
  return 'table'
}

/** 「加一列」的菜单分三组（照原型）：基本、连起来（关联、汇总）、算出来（公式） */
export const ADD_COLUMN: { group: string; items: { type: FieldType; label: string; icon: string }[] }[] = [
  {
    group: '基本',
    items: [
      { type: 'text', label: '文字', icon: 'symbol-string' },
      { type: 'number', label: '数字', icon: 'symbol-numeric' },
      { type: 'select', label: '选项', icon: 'arrow-circle-down' },
      { type: 'multi', label: '多选', icon: 'list-unordered' },
      { type: 'status', label: '状态', icon: 'issues' },
      { type: 'date', label: '日期', icon: 'calendar' },
      { type: 'check', label: '勾选', icon: 'check' },
      { type: 'url', label: '链接', icon: 'link' },
    ],
  },
  {
    group: '连起来',
    items: [
      { type: 'relation', label: '关联', icon: 'references' },
      { type: 'rollup', label: '汇总', icon: 'symbol-operator' },
    ],
  },
  { group: '算出来', items: [{ type: 'formula', label: '公式', icon: 'symbol-method' }] },
]

/** 状态的三组（照 Notion：待开始、进行中、完成）。groups 没写时用这一份 */
export interface StatusGroup {
  name: string
  options: string[]
}
export const DEFAULT_STATUS_GROUPS: StatusGroup[] = [
  { name: '待开始', options: ['未开始'] },
  { name: '进行中', options: ['进行中'] },
  { name: '完成', options: ['完成'] },
]

/** 汇总算什么（照原型的菜单）：几个、勾了几个、勾了几个 / 共几个、求和、平均、最早、最晚 */
export type RollupCalc = 'count' | 'checked' | 'checked/all' | 'sum' | 'average' | 'earliest' | 'latest'
export const ROLLUP_CALCS: { calc: RollupCalc; label: string }[] = [
  { calc: 'count', label: '几个' },
  { calc: 'checked', label: '勾了几个' },
  { calc: 'checked/all', label: '勾了几个 / 共几个' },
  { calc: 'sum', label: '求和' },
  { calc: 'average', label: '平均' },
  { calc: 'earliest', label: '最早' },
  { calc: 'latest', label: '最晚' },
]

/** 一行 [a, "b, c", 'd'] 里的每一项（带逗号、方括号的用引号包着）；不是方括号的也认「a, b」 */
export function listOf(v: string): string[] {
  const t = v.trim()
  if (!t) return []
  if (!/^\[.*\]$/s.test(t)) return t.split(',').map(unq).filter(Boolean)
  const out: string[] = []
  const s = t.slice(1, -1)
  let i = 0
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++
    if (i >= s.length) break
    const q = s[i]
    if (q === '"' || q === "'") {
      let j = i + 1
      let buf = ''
      while (j < s.length && s[j] !== q) {
        if (q === '"' && s[j] === '\\' && j + 1 < s.length) {
          buf += s[j + 1]
          j += 2
          continue
        }
        if (q === "'" && s[j] === "'" && s[j + 1] === "'") {
          buf += "'"
          j += 2
          continue
        }
        buf += s[j]
        j++
      }
      out.push(buf)
      i = j + 1
      continue
    }
    if (q === '[') {
      // 没加引号的 [[双链]]：YAML 读成套着的列表，这里当一项「[[双链]]」
      let depth = 0
      let j = i
      for (; j < s.length; j++) {
        if (s[j] === '[') depth++
        else if (s[j] === ']' && --depth === 0) break
      }
      out.push(s.slice(i, j + 1).trim())
      i = j + 1
      continue
    }
    let j = i
    while (j < s.length && s[j] !== ',') j++
    const x = s.slice(i, j).trim()
    if (x) out.push(x)
    i = j + 1
  }
  return out
}

const unq = (x: string) => x.trim().replace(/^["']|["']$/g, '')

/** 一项要不要加引号（写进一行的 [a, b] 里） */
const flowNeedsQuote = (x: string) => x === '' || /[,[\]{}"'#:&*!|>%@`]|^\s|\s$/.test(x)

/** 多选、关联写回去的样子：[a, b]；带逗号、方括号、引号的值加双引号（双链 [[x]] 写成 "[[x]]"） */
export function listText(items: string[]): string {
  return '[' + items.map((x) => (flowNeedsQuote(x) ? `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : x)).join(', ') + ']'
}

/** 列的类型：没选过类型的列按这一列的值都长什么样猜 */
export function colType(values: string[]): ColType {
  const v = values.filter((x) => x.trim() !== '')
  if (!v.length) return 'text'
  if (v.every((x) => /^(true|false)$/i.test(x))) return 'check'
  if (v.every((x) => /^-?\d+(\.\d+)?$/.test(x))) return 'number'
  if (v.every((x) => /^\d{4}-\d{2}-\d{2}/.test(x))) return 'date'
  if (v.every((x) => /^https?:\/\/\S+$/.test(x))) return 'url'
  if (v.every((x) => /^\[.*\]$/.test(x.trim()))) return 'multi'
  if (new Set(v).size <= Math.max(3, v.length / 2) && v.every((x) => x.length <= 12)) return 'select'
  return 'text'
}
