/**
 * 数据库的公式和筛选是同一种写法（2026-11-22 用户定「公式直接用列名写，和筛选同一种写法」，借 Obsidian Bases 的写法）：
 *
 *   (已看 / 节数 * 100).round() + "%"            节数 - 已看
 *   if(已看 >= 节数, "学完", "还差 " + (节数 - 已看) + " 节")
 *   if(日期.isEmpty(), "", 日期 - today())        日期 <= today() + "7d"
 *   状态 != "学完"    作者.contains("明")    !练习.isEmpty()    file.inFolder("课程/ecp")
 *
 * 列名直接写；名字里有空格、横杠、数字开头的写 note["列 名"]；笔记名是 file.name（公式里也能写「名字」）；
 * 别的公式写名字或 formula.进度。运算：+ - * / %，== != > >= < <=，&& || !，括号。
 * 日期减日期是差几天；日期加减 "7d"（d 天、w 周、M 月、y 年，也认「7天」）是往后往前几天；字和别的相加是接在一起。
 * 中文输入法打出来的（，）“”≥ ≤ ≠ × ÷ 也认。
 *
 * 写错了给一句中文说哪里错（parseExpr / checkFormula 返回，不抛）；算的时候类型不对（拿字去乘）给空值和一句话（evalExpr 返回）。
 * 不依赖 Electron 和 Node。
 */

// ---------------------------------------------------------------- 值

/** 日期：date 是 2026-11-22；带钟点的记在 time */
export interface DateV {
  date: string
  time?: string
}
export type Val = null | boolean | number | string | DateV | Val[]

export const isDateV = (v: Val): v is DateV => typeof v === 'object' && v !== null && !Array.isArray(v)

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?$/

/** 字是不是日期（2026-11-22，带不带钟点） */
export function dateOf(s: string): DateV | null {
  const m = DATE_RE.exec(s.trim())
  if (!m) return null
  return m[2] ? { date: m[1]!, time: m[2] } : { date: m[1]! }
}

const NUM_RE = /^-?\d+(?:\.\d+)?$/

/** 双链 [[练习/练习 3.1|三点一]] 给人看的样子：有别名用别名，不然是最后一段名字 */
export function linkLabel(s: string): string {
  const m = /^\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(s.trim())
  if (!m) return s
  if (m[2]) return m[2]
  return m[1]!.split('/').pop()!.replace(/\.md$/i, '')
}

/** 数字给人看：整数照写，小数最多两位（照原型） */
export function numText(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 100) / 100)
}

/** 算出来的值给人看的样子：空是空，是 / 否，数字最多两位小数，日期 2026-11-22，列表用顿号以外的「, 」隔开、双链只露名字 */
export function valText(v: Val): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (typeof v === 'number') return numText(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? linkLabel(x) : valText(x))).join(', ')
  return v.time ? `${v.date} ${v.time}` : v.date
}

/** 值是什么样的（界面画格子用） */
export function valKind(v: Val): 'empty' | 'check' | 'number' | 'text' | 'date' | 'list' {
  if (v === null || v === '') return 'empty'
  if (typeof v === 'boolean') return 'check'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return 'text'
  if (Array.isArray(v)) return 'list'
  return 'date'
}

const blank = (v: Val) => v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/** 算不算「真」：空、0、否、空列表算假 */
export const truthy = (v: Val): boolean => (v === null ? false : typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v !== '' : Array.isArray(v) ? v.length > 0 : true)

// ---------------------------------------------------------------- 日期和时长

/** "7d" "2w" "1M" "1y" "7 days" "7天" "2周" "1个月" "1年" → 几个什么；不是时长返回 null */
export function durationOf(s: string): { n: number; unit: 'd' | 'w' | 'M' | 'y' } | null {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*(d|days?|天|日|w|weeks?|周|星期|M|months?|个月|月|y|years?|年)\s*$/.exec(s)
  if (!m) return null
  const u = m[2]!
  const unit = /^(d|days?|天|日)$/.test(u) ? 'd' : /^(w|weeks?|周|星期)$/.test(u) ? 'w' : /^(M|months?|个月|月)$/.test(u) ? 'M' : 'y'
  return { n: Number(m[1]), unit }
}

const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)

/** 日期往后挪几天 / 周 / 月 / 年（月底挪一个月落在下个月最后一天） */
export function shiftDate(d: string, n: number, unit: 'd' | 'w' | 'M' | 'y'): string {
  if (unit === 'd' || unit === 'w') return ymd(utc(d) + Math.round(n * (unit === 'w' ? 7 : 1)) * 864e5)
  const y = Number(d.slice(0, 4))
  const mo = Number(d.slice(5, 7)) - 1
  const day = Number(d.slice(8, 10))
  const months = Math.round(unit === 'M' ? n : n * 12)
  const target = new Date(Date.UTC(y, mo + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return ymd(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last)))
}

/** a 比 b 晚几天 */
export const dayDiff = (a: string, b: string) => Math.round((utc(a) - utc(b)) / 864e5)

/** 这台电脑上的今天（不是 UTC 的今天） */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ---------------------------------------------------------------- 读

interface Tok {
  t: 'num' | 'str' | 'id' | 'op' | 'end'
  v: string
  at: number
  end: number
}

/** 中文输入法打出来的记号当英文的用 */
const WIDE: Record<string, string> = { '（': '(', '）': ')', '，': ',', '≥': '>=', '≤': '<=', '≠': '!=', '×': '*', '÷': '/', '＋': '+', '－': '-', '＝': '==', '！': '!', '＞': '>', '＜': '<', '［': '[', '］': ']', '．': '.' }
const OPS = ['==', '!=', '>=', '<=', '&&', '||', '=', '>', '<', '+', '-', '*', '/', '%', '!', '(', ')', '[', ']', ',', '.']
const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' }

/** 第几个字（按看得见的字数，从 1 开始） */
const nth = (src: string, at: number) => [...src.slice(0, at)].length + 1

class ExprError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message)
  }
}

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const id = /[\p{L}_$][\p{L}\p{N}_$]*/uy
  const num = /\d+(?:\.\d+)?/y
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (QUOTES[c]) {
      const close = QUOTES[c]!
      let j = i + 1
      let buf = ''
      while (j < src.length && src[j] !== close) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1]!
          buf += e === 'n' ? '\n' : e === 't' ? '\t' : e
          j += 2
          continue
        }
        buf += src[j]
        j++
      }
      if (j >= src.length) throw new ExprError(`第${nth(src, i)}个字起的引号没有收尾，少了「${close}」`, i)
      out.push({ t: 'str', v: buf, at: i, end: j + 1 })
      i = j + 1
      continue
    }
    num.lastIndex = i
    const n = num.exec(src)
    if (n) {
      out.push({ t: 'num', v: n[0], at: i, end: i + n[0].length })
      i += n[0].length
      continue
    }
    id.lastIndex = i
    const w = id.exec(src)
    if (w) {
      out.push({ t: 'id', v: w[0], at: i, end: i + w[0].length })
      i += w[0].length
      continue
    }
    if (WIDE[c]) {
      out.push({ t: 'op', v: WIDE[c]!, at: i, end: i + 1 })
      i++
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      out.push({ t: 'op', v: op === '=' ? '==' : op, at: i, end: i + op.length })
      i += op.length
      continue
    }
    throw new ExprError(`第${nth(src, i)}个字「${[...src.slice(i)][0]}」看不懂`, i)
  }
  out.push({ t: 'end', v: '', at: src.length, end: src.length })
  return out
}

export type Ast =
  | { k: 'lit'; v: Val; at: number; end: number }
  | { k: 'name'; name: string; at: number; end: number }
  | { k: 'note'; name: string; at: number; end: number }
  | { k: 'formula'; name: string; at: number; end: number }
  | { k: 'file'; field: string; at: number; end: number }
  | { k: 'filecall'; m: string; args: Ast[]; at: number; end: number }
  | { k: 'call'; f: string; args: Ast[]; at: number; end: number }
  | { k: 'method'; m: string; target: Ast; args: Ast[]; at: number; end: number }
  | { k: 'index'; target: Ast; index: Ast; at: number; end: number }
  | { k: 'list'; items: Ast[]; at: number; end: number }
  | { k: 'un'; op: '!' | '-' | '+'; a: Ast; at: number; end: number }
  | { k: 'bin'; op: string; a: Ast; b: Ast; at: number; end: number }

/** 能用的函数：几样参数、写法（写错时告诉人怎么写） */
export const FUNCS: Record<string, { min: number; max: number; usage: string; tip: string }> = {
  if: { min: 2, max: 3, usage: 'if(条件, 是的时候, 不是的时候)', tip: '条件成立给第二样，不成立给第三样' },
  today: { min: 0, max: 0, usage: 'today()', tip: '今天' },
  now: { min: 0, max: 0, usage: 'now()', tip: '现在（按今天算）' },
  date: { min: 1, max: 1, usage: 'date("2026-11-22")', tip: '把字当日期' },
  number: { min: 1, max: 1, usage: 'number(字)', tip: '把字当数' },
  min: { min: 1, max: 99, usage: 'min(a, b)', tip: '最小的（数或日期）' },
  max: { min: 1, max: 99, usage: 'max(a, b)', tip: '最大的（数或日期）' },
  abs: { min: 1, max: 1, usage: 'abs(数)', tip: '去掉负号' },
  round: { min: 1, max: 2, usage: 'round(数, 几位小数)', tip: '四舍五入' },
  floor: { min: 1, max: 1, usage: 'floor(数)', tip: '往下取整' },
  ceil: { min: 1, max: 1, usage: 'ceil(数)', tip: '往上取整' },
}

/** 能用的方法（写在值后面：日期.isEmpty()）；prop：不带括号也认（.length） */
export const METHODS: Record<string, { min: number; max: number; usage: string; prop?: boolean }> = {
  isEmpty: { min: 0, max: 0, usage: '.isEmpty()', prop: true },
  contains: { min: 1, max: 1, usage: '.contains("字")' },
  startsWith: { min: 1, max: 1, usage: '.startsWith("字")' },
  endsWith: { min: 1, max: 1, usage: '.endsWith("字")' },
  lower: { min: 0, max: 0, usage: '.lower()', prop: true },
  upper: { min: 0, max: 0, usage: '.upper()', prop: true },
  trim: { min: 0, max: 0, usage: '.trim()', prop: true },
  round: { min: 0, max: 1, usage: '.round()', prop: true },
  floor: { min: 0, max: 0, usage: '.floor()', prop: true },
  ceil: { min: 0, max: 0, usage: '.ceil()', prop: true },
  abs: { min: 0, max: 0, usage: '.abs()', prop: true },
  toFixed: { min: 1, max: 1, usage: '.toFixed(2)' },
  length: { min: 0, max: 0, usage: '.length', prop: true },
  year: { min: 0, max: 0, usage: '.year', prop: true },
  month: { min: 0, max: 0, usage: '.month', prop: true },
  day: { min: 0, max: 0, usage: '.day', prop: true },
  join: { min: 0, max: 1, usage: '.join(", ")', prop: true },
}

const FILE_FIELDS = ['name', 'basename', 'path', 'folder', 'ext']
const FILE_CALLS: Record<string, { min: number; max: number; usage: string }> = {
  inFolder: { min: 1, max: 1, usage: 'file.inFolder("文件夹")' },
  hasTag: { min: 1, max: 1, usage: 'file.hasTag("标签")' },
}

const listFuncs = () => Object.keys(FUNCS).map((f) => `${f}()`).join('、')
const listMethods = () => ['.round()', '.length', '.isEmpty()', '.contains()', '.toFixed()', '.lower()'].join('、')

class Parser {
  p = 0
  constructor(
    readonly src: string,
    readonly t: Tok[],
  ) {}
  peek() {
    return this.t[this.p]!
  }
  is(v: string) {
    const x = this.t[this.p]!
    return x.t === 'op' && x.v === v
  }
  eat(v: string) {
    if (this.is(v)) {
      this.p++
      return true
    }
    return false
  }
  need(v: string, what: string) {
    if (this.eat(v)) return
    const x = this.peek()
    if (x.t === 'end') throw new ExprError(`${what}少了「${v}」`, x.at)
    throw new ExprError(`第${nth(this.src, x.at)}个字「${x.v}」前面少了「${v}」`, x.at)
  }
  bad(x: Tok): never {
    if (x.t === 'end') throw new ExprError('公式没写完', x.at)
    throw new ExprError(`「${x.v}」放在这里看不懂`, x.at)
  }

  all(): Ast {
    if (this.peek().t === 'end') throw new ExprError('公式是空的', 0)
    const e = this.expr()
    const x = this.peek()
    if (x.t !== 'end') {
      if (x.t === 'op' && x.v === ')') throw new ExprError(`第${nth(this.src, x.at)}个字的「)」多了，前面没有配对的「(」`, x.at)
      throw new ExprError(`「${x.v}」前面少了运算符`, x.at)
    }
    return e
  }
  expr(): Ast {
    return this.bin(0)
  }
  /** 一层一层的运算符：|| → && → 比较 → + - → * / % */
  private static LEVELS = [['||'], ['&&'], ['==', '!=', '>=', '<=', '>', '<'], ['+', '-'], ['*', '/', '%']]
  bin(level: number): Ast {
    if (level >= Parser.LEVELS.length) return this.unary()
    let a = this.bin(level + 1)
    for (;;) {
      const x = this.peek()
      if (x.t === 'op' && Parser.LEVELS[level]!.includes(x.v)) {
        this.p++
        if (this.peek().t === 'end') throw new ExprError(`「${x.v}」后面少了东西`, x.at)
        const b = this.bin(level + 1)
        a = { k: 'bin', op: x.v, a, b, at: a.at, end: b.end }
      } else return a
    }
  }
  unary(): Ast {
    const x = this.peek()
    if (x.t === 'op' && (x.v === '!' || x.v === '-' || x.v === '+')) {
      this.p++
      const a = this.unary()
      return { k: 'un', op: x.v as '!' | '-' | '+', a, at: x.at, end: a.end }
    }
    return this.postfix()
  }
  args(name: string, spec: { min: number; max: number; usage: string }, at: number): { args: Ast[]; end: number } {
    const args: Ast[] = []
    if (!this.is(')')) {
      do args.push(this.expr())
      while (this.eat(','))
    }
    const close = this.peek()
    this.need(')', `「${name}(」`)
    if (args.length < spec.min || args.length > spec.max) throw new ExprError(`「${name}」的写法是 ${spec.usage}`, at)
    return { args, end: close.end }
  }
  postfix(): Ast {
    let a = this.primary()
    for (;;) {
      if (this.eat('.')) {
        const m = this.peek()
        if (m.t !== 'id') throw new ExprError(m.t === 'end' ? '点后面要写方法名' : `「.${m.v}」看不懂，点后面要写方法名`, m.at)
        this.p++
        if (a.k === 'name' && (a.name === 'file' || a.name === 'note' || a.name === 'formula') && a.end === m.at - 1) {
          a = this.special(a, m)
          continue
        }
        const spec = METHODS[m.v]
        if (!spec) throw new ExprError(`没有「.${m.v}()」；能用 ${listMethods()}`, m.at)
        if (this.eat('(')) {
          const { args, end } = this.args('.' + m.v, spec, m.at)
          a = { k: 'method', m: m.v, target: a, args, at: a.at, end }
        } else {
          if (spec.min > 0) throw new ExprError(`「.${m.v}」的写法是 ${spec.usage}`, m.at)
          a = { k: 'method', m: m.v, target: a, args: [], at: a.at, end: m.end }
        }
        continue
      }
      if (this.is('[')) {
        const open = this.peek()
        this.p++
        if (a.k === 'name' && (a.name === 'note' || a.name === 'formula')) {
          const s = this.peek()
          if (s.t !== 'str') throw new ExprError(`${a.name}[ ] 里要写带引号的名字，比如 ${a.name}["列 名"]`, s.at)
          this.p++
          const close = this.peek()
          this.need(']', `「${a.name}[」`)
          a = a.name === 'note' ? { k: 'note', name: s.v, at: a.at, end: close.end } : { k: 'formula', name: s.v, at: a.at, end: close.end }
          continue
        }
        const index = this.expr()
        const close = this.peek()
        this.need(']', '「[」')
        a = { k: 'index', target: a, index, at: open.at, end: close.end }
        continue
      }
      return a
    }
  }
  /** file.X、note.X、formula.X */
  special(obj: { name: string; at: number }, m: Tok): Ast {
    if (obj.name === 'note') return { k: 'note', name: m.v, at: obj.at, end: m.end }
    if (obj.name === 'formula') return { k: 'formula', name: m.v, at: obj.at, end: m.end }
    if (this.eat('(')) {
      const spec = FILE_CALLS[m.v]
      if (!spec) throw new ExprError(`没有「file.${m.v}()」；能用 file.inFolder()、file.hasTag()`, m.at)
      const { args, end } = this.args('file.' + m.v, spec, m.at)
      return { k: 'filecall', m: m.v, args, at: obj.at, end }
    }
    if (!FILE_FIELDS.includes(m.v)) throw new ExprError(`没有「file.${m.v}」；能用 file.name、file.path、file.folder`, m.at)
    return { k: 'file', field: m.v, at: obj.at, end: m.end }
  }
  primary(): Ast {
    const x = this.peek()
    this.p++
    if (x.t === 'num') return { k: 'lit', v: Number(x.v), at: x.at, end: x.end }
    if (x.t === 'str') return { k: 'lit', v: x.v, at: x.at, end: x.end }
    if (x.t === 'id') {
      if (this.is('(')) {
        this.p++
        const spec = FUNCS[x.v]
        if (!spec) throw new ExprError(`没有「${x.v}()」这个函数；能用 ${listFuncs()}`, x.at)
        const { args, end } = this.args(x.v, spec, x.at)
        return { k: 'call', f: x.v, args, at: x.at, end }
      }
      if (x.v === 'true' || x.v === 'false') return { k: 'lit', v: x.v === 'true', at: x.at, end: x.end }
      if (x.v === 'null') return { k: 'lit', v: null, at: x.at, end: x.end }
      return { k: 'name', name: x.v, at: x.at, end: x.end }
    }
    if (x.t === 'op' && x.v === '(') {
      if (this.is(')')) throw new ExprError('括号里是空的', x.at)
      const e = this.expr()
      this.need(')', '括号')
      return e
    }
    if (x.t === 'op' && x.v === '[') {
      const items: Ast[] = []
      if (!this.is(']')) {
        do items.push(this.expr())
        while (this.eat(','))
      }
      const close = this.peek()
      this.need(']', '「[」')
      return { k: 'list', items, at: x.at, end: close.end }
    }
    return this.bad(x)
  }
}

/** 读好的一条：ok 时 ast 能拿去算；不 ok 时 error 是一句中文，at 是错在第几个字（从 0 起，按 UTF-16） */
export type Parsed = { ok: true; src: string; ast: Ast } | { ok: false; src: string; error: string; at: number }

const cache = new Map<string, Parsed>()

/** 读一条公式或筛选（读过的记着，同一条不再读） */
export function parseExpr(src: string): Parsed {
  const hit = cache.get(src)
  if (hit) return hit
  let out: Parsed
  try {
    const t = lex(src)
    out = { ok: true, src, ast: new Parser(src, t).all() }
  } catch (e) {
    if (!(e instanceof ExprError)) throw e
    out = { ok: false, src, error: e.message, at: e.at }
  }
  if (cache.size > 2000) cache.clear()
  cache.set(src, out)
  return out
}

/** 一条里用到的列（直接写的名字、note.X）和公式（formula.X） */
export function exprRefs(ast: Ast): { names: string[]; notes: string[]; formulas: string[] } {
  const names = new Set<string>()
  const notes = new Set<string>()
  const formulas = new Set<string>()
  const walk = (n: Ast) => {
    switch (n.k) {
      case 'name':
        names.add(n.name)
        return
      case 'note':
        notes.add(n.name)
        return
      case 'formula':
        formulas.add(n.name)
        return
      case 'call':
      case 'filecall':
        n.args.forEach(walk)
        return
      case 'method':
        walk(n.target)
        n.args.forEach(walk)
        return
      case 'index':
        walk(n.target)
        walk(n.index)
        return
      case 'list':
        n.items.forEach(walk)
        return
      case 'un':
        walk(n.a)
        return
      case 'bin':
        walk(n.a)
        walk(n.b)
        return
    }
  }
  walk(ast)
  return { names: [...names], notes: [...notes], formulas: [...formulas] }
}

/** 写进公式里的列名：普通的名字照写，有空格、记号、数字开头的写成 note["列 名"] */
export function exprRef(name: string): string {
  if (name === 'file.name') return 'file.name'
  if (name.startsWith('formula.')) {
    const f = name.slice(8)
    return isIdent(f) ? `formula.${f}` : `formula["${f.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
  }
  return isIdent(name) && !RESERVED.has(name) ? name : `note["${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
}

const RESERVED = new Set(['true', 'false', 'null', 'file', 'note', 'formula'])
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const isIdent = (s: string) => /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(s)

/** 两个字差几个字（找「是不是想写…」） */
function editDistance(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)] as number[])
  for (let j = 1; j <= y.length; j++) d[0]![j] = j
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
  return d[x.length]![y.length]!
}

/** 公式框要知道的：这个数据库有哪些列、哪些公式（查认不认得、有没有绕回自己） */
export interface FormulaScope {
  columns: string[]
  formulas: Record<string, string>
}

/**
 * 查一条公式能不能用：写法对不对、列认不认得、有没有用到自己（绕一圈回来也算）。
 * self：正在写的这条公式叫什么（改名时是新名字）
 */
export function checkFormula(src: string, scope: FormulaScope, self?: string): { ok: true } | { ok: false; error: string; at: number } {
  const p = parseExpr(src)
  if (!p.ok) return p
  const known = new Set([...scope.columns, ...Object.keys(scope.formulas), '名字'])
  const where = (name: string) => {
    let at = -1
    const walk = (n: Ast) => {
      if (at !== -1) return
      if ((n.k === 'name' || n.k === 'formula') && n.name === name) at = n.at
      else if (n.k === 'call' || n.k === 'filecall') n.args.forEach(walk)
      else if (n.k === 'method') (walk(n.target), n.args.forEach(walk))
      else if (n.k === 'index') (walk(n.target), walk(n.index))
      else if (n.k === 'list') n.items.forEach(walk)
      else if (n.k === 'un') walk(n.a)
      else if (n.k === 'bin') (walk(n.a), walk(n.b))
    }
    walk(p.ast)
    return Math.max(0, at)
  }
  const refs = exprRefs(p.ast)
  for (const n of refs.names) {
    if (n === self) return { ok: false, error: `「${self}」用到了它自己，算不出来`, at: where(n) }
    if (known.has(n)) continue
    const near = [...known].find((k) => k !== '名字' && [...n].length >= 2 && editDistance(k, n) === 1)
    return { ok: false, error: `认不出「${n}」：没有这一列，也不是能用的函数${near ? `；是不是「${near}」？` : ''}`, at: where(n) }
  }
  for (const f of refs.formulas) {
    if (f === self) return { ok: false, error: `「${self}」用到了它自己，算不出来`, at: where(f) }
    if (!Object.hasOwn(scope.formulas, f)) return { ok: false, error: `没有叫「${f}」的公式`, at: where(f) }
  }
  if (self) {
    // 绕一圈回来：顺着用到的公式往下找，找到自己就是互相用到
    const depsOf = (s: string): string[] => {
      const q = parseExpr(s)
      if (!q.ok) return []
      const r = exprRefs(q.ast)
      return [...r.names.filter((n) => Object.hasOwn(scope.formulas, n)), ...r.formulas]
    }
    const first = depsOf(src).filter((d) => d !== self)
    for (const start of first) {
      const seen = new Set<string>()
      const stack = [start]
      while (stack.length) {
        const f = stack.pop()!
        if (seen.has(f)) continue
        seen.add(f)
        for (const d of depsOf(scope.formulas[f] ?? '')) {
          if (d === self) return { ok: false, error: `「${self}」和「${start}」互相用到，算不出来`, at: where(start) }
          stack.push(d)
        }
      }
    }
  }
  return { ok: true }
}

/**
 * 列改名、公式改名以后，公式和筛选里用到它的地方跟着换（别的字一个不动）。
 * kind 'column'：直接写的名字和 note.X / note["X"]；'formula'：直接写的名字和 formula.X / formula["X"]
 */
export function renameRef(src: string, from: string, to: string, kind: 'column' | 'formula' = 'column'): string {
  if (from === to) return src
  let toks: Tok[]
  try {
    toks = lex(src)
  } catch {
    return src
  }
  const edits: { at: number; end: number; text: string }[] = []
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!
    if (x.t !== 'id') continue
    const prev = toks[i - 1]
    const next = toks[i + 1]
    const obj = kind === 'column' ? 'note' : 'formula'
    // note.X / formula.X
    if (x.v === obj && next?.t === 'op' && next.v === '.' && toks[i + 2]?.t === 'id' && toks[i + 2]!.v === from) {
      const n = toks[i + 2]!
      edits.push({ at: x.at, end: n.end, text: kind === 'column' ? (isIdent(to) ? `note.${to}` : `note["${esc(to)}"]`) : exprRef('formula.' + to) })
      i += 2
      continue
    }
    // note["X"] / formula["X"]
    if (x.v === obj && next?.t === 'op' && next.v === '[' && toks[i + 2]?.t === 'str' && toks[i + 2]!.v === from && toks[i + 3]?.v === ']') {
      const close = toks[i + 3]!
      edits.push({ at: x.at, end: close.end, text: `${obj}["${esc(to)}"]` })
      i += 3
      continue
    }
    if (x.v !== from) continue
    if (prev?.t === 'op' && prev.v === '.') continue
    if (next?.t === 'op' && next.v === '(') continue
    edits.push({ at: x.at, end: x.end, text: exprRef(to) })
  }
  let out = src
  for (const e of edits.reverse()) out = out.slice(0, e.at) + e.text + out.slice(e.end)
  return out
}

// ---------------------------------------------------------------- 算

/** 算的时候要的东西：一列的值、这一篇是哪个文件、今天 */
export interface ExprEnv {
  /** how：'name' 直接写的名字（先认公式，再认列）；'note' 只认开头的属性；'formula' 只认公式 */
  get(name: string, how: 'name' | 'note' | 'formula'): Val
  file: { name: string; path: string; folder: string; tags?: string[] }
  /** 今天，2026-11-22 */
  today: string
}

/** 算的时候的错（类型不对、互相用到）：evalExpr 接住变成一句话；ExprEnv.get 里也能扔它 */
export class ExprFail extends Error {}

const numOf = (v: Val): number | null => (typeof v === 'number' ? v : typeof v === 'string' && NUM_RE.test(v.trim()) ? Number(v) : null)
const dateLike = (v: Val): DateV | null => (isDateV(v) ? v : typeof v === 'string' ? dateOf(v) : null)

/** 两样值一样不一样：数字按数，日期按日子，字一个字一个字比；空和空字、空列表算一样；列表里有一样的就算一样 */
export function valEq(a: Val, b: Val): boolean {
  if (blank(a) || blank(b)) return blank(a) && blank(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => valEq(x, b[i]!))
  if (Array.isArray(a)) return a.some((x) => valEq(x, b))
  if (Array.isArray(b)) return b.some((x) => valEq(a, x))
  const da = dateLike(a)
  const db = dateLike(b)
  if (da && db && (isDateV(a) || isDateV(b))) return da.date === db.date
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a).toLowerCase() === String(b).toLowerCase()
  const na = numOf(a)
  const nb = numOf(b)
  if (na !== null && nb !== null && (typeof a === 'number' || typeof b === 'number')) return na === nb
  if (isDateV(a) || isDateV(b)) return false
  return a === b
}

/** 比大小：数字按数、日期按日子、字按拼音；比不了（有空的、类型不同）返回 null */
export function valCmp(a: Val, b: Val): number | null {
  if (blank(a) || blank(b) || Array.isArray(a) || Array.isArray(b)) return null
  const da = dateLike(a)
  const db = dateLike(b)
  if (da && db) return da.date < db.date ? -1 : da.date > db.date ? 1 : (da.time ?? '') < (db.time ?? '') ? -1 : (da.time ?? '') > (db.time ?? '') ? 1 : 0
  const na = numOf(a)
  const nb = numOf(b)
  if (na !== null && nb !== null) return na - nb
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'zh', { numeric: true })
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return null
}

/** 排序用：空的总在最后（升序降序都是），别的照 valCmp，比不了的按字 */
export function sortCmp(a: Val, b: Val, desc = false): number {
  const ea = blank(a)
  const eb = blank(b)
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  const c = valCmp(a, b) ?? valText(a).localeCompare(valText(b), 'zh', { numeric: true })
  return desc ? -c : c
}

/** 算一条（parseExpr 读好的）：不抛错，算不出时 value 是 null、error 是一句中文 */
export function evalExpr(p: Parsed, env: ExprEnv): { value: Val; error?: string } {
  if (!p.ok) return { value: null, error: p.error }
  try {
    return { value: new Evaluator(p.src, env).ev(p.ast) }
  } catch (e) {
    if (e instanceof ExprFail) return { value: null, error: e.message }
    throw e
  }
}

class Evaluator {
  constructor(
    readonly src: string,
    readonly env: ExprEnv,
  ) {}
  /** 报错时怎么说这一样：列就说列名，别的照写的字 */
  desc(n: Ast): string {
    if (n.k === 'name' || n.k === 'note' || n.k === 'formula') return n.name
    return this.src.slice(n.at, n.end).trim()
  }
  num(n: Ast, v: Val, verb: string): number | null {
    if (v === null) return null
    const x = numOf(v)
    if (x === null) {
      const what = typeof v === 'boolean' ? '是 / 否' : isDateV(v) ? '日期' : Array.isArray(v) ? '一串' : '字'
      throw new ExprFail(`「${this.desc(n)}」是${what}，不能${verb}`)
    }
    return x
  }
  ev(n: Ast): Val {
    switch (n.k) {
      case 'lit':
        return n.v
      case 'name':
        return this.env.get(n.name, 'name')
      case 'note':
        return this.env.get(n.name, 'note')
      case 'formula':
        return this.env.get(n.name, 'formula')
      case 'file': {
        const f = this.env.file
        if (n.field === 'name' || n.field === 'basename') return f.name
        if (n.field === 'path') return f.path
        if (n.field === 'folder') return f.folder
        return 'md'
      }
      case 'filecall': {
        const a = valText(this.ev(n.args[0]!))
        if (n.m === 'inFolder') {
          const dir = a.replace(/\/+$/, '')
          return dir === '' || this.env.file.path.startsWith(dir + '/')
        }
        const tag = a.replace(/^#/, '').toLowerCase()
        return (this.env.file.tags ?? []).some((t) => t.replace(/^#/, '').toLowerCase() === tag)
      }
      case 'list':
        return n.items.map((x) => this.ev(x))
      case 'index': {
        const t = this.ev(n.target)
        const i = numOf(this.ev(n.index))
        if (!Array.isArray(t) || i === null) return null
        return t[i < 0 ? t.length + i : i] ?? null
      }
      case 'un': {
        const a = this.ev(n.a)
        if (n.op === '!') return !truthy(a)
        const x = this.num(n.a, a, n.op === '-' ? '取负' : '加正号')
        return x === null ? null : n.op === '-' ? -x : x
      }
      case 'call':
        return this.call(n)
      case 'method':
        return this.method(n)
      case 'bin':
        return this.bin(n)
    }
  }
  call(n: Extract<Ast, { k: 'call' }>): Val {
    const arg = (i: number) => this.ev(n.args[i]!)
    switch (n.f) {
      case 'if':
        return truthy(arg(0)) ? arg(1) : n.args[2] ? arg(2) : null
      case 'today':
      case 'now':
        return { date: this.env.today }
      case 'date': {
        const v = arg(0)
        return isDateV(v) ? v : typeof v === 'string' ? dateOf(v) : null
      }
      case 'number': {
        const v = arg(0)
        return typeof v === 'boolean' ? Number(v) : numOf(v)
      }
      case 'min':
      case 'max': {
        const vs = n.args.flatMap((x) => {
          const v = this.ev(x)
          return Array.isArray(v) ? v : [v]
        })
        let best: Val = null
        for (const v of vs) {
          if (blank(v)) continue
          const c = best === null ? null : valCmp(v, best)
          if (best === null || (c !== null && (n.f === 'min' ? c < 0 : c > 0))) best = isDateV(v) ? v : (numOf(v) ?? v)
        }
        return best
      }
      case 'abs':
      case 'floor':
      case 'ceil':
      case 'round': {
        const x = this.num(n.args[0]!, arg(0), '取整')
        if (x === null) return null
        if (n.f === 'abs') return Math.abs(x)
        if (n.f === 'floor') return Math.floor(x)
        if (n.f === 'ceil') return Math.ceil(x)
        const d = n.args[1] ? (numOf(arg(1)) ?? 0) : 0
        return Math.round(x * 10 ** d) / 10 ** d
      }
    }
    return null
  }
  method(n: Extract<Ast, { k: 'method' }>): Val {
    const v = this.ev(n.target)
    const arg = (i: number) => this.ev(n.args[i]!)
    const text = (x: Val) => valText(x)
    switch (n.m) {
      case 'isEmpty':
        return blank(v)
      case 'contains': {
        const needle = text(arg(0)).toLowerCase()
        if (v === null) return needle === ''
        if (Array.isArray(v)) return v.some((x) => (typeof x === 'string' ? x : text(x)).toLowerCase().includes(needle) || linkLabel(text(x)).toLowerCase() === needle)
        return text(v).toLowerCase().includes(needle)
      }
      case 'startsWith':
        return v !== null && text(v).startsWith(text(arg(0)))
      case 'endsWith':
        return v !== null && text(v).endsWith(text(arg(0)))
      case 'lower':
        return v === null ? null : text(v).toLowerCase()
      case 'upper':
        return v === null ? null : text(v).toUpperCase()
      case 'trim':
        return v === null ? null : text(v).trim()
      case 'length':
        return v === null ? 0 : Array.isArray(v) ? v.length : [...text(v)].length
      case 'join':
        return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? linkLabel(x) : text(x))).join(n.args[0] ? text(arg(0)) : ', ') : v === null ? '' : text(v)
      case 'year':
      case 'month':
      case 'day': {
        const d = dateLike(v)
        if (!d) {
          if (v === null) return null
          throw new ExprFail(`「${this.desc(n.target)}」不是日期，没有 .${n.m}`)
        }
        return Number(n.m === 'year' ? d.date.slice(0, 4) : n.m === 'month' ? d.date.slice(5, 7) : d.date.slice(8, 10))
      }
      case 'toFixed': {
        const x = this.num(n.target, v, '保留小数')
        if (x === null) return null
        const d = Math.max(0, Math.min(10, numOf(arg(0)) ?? 0))
        return x.toFixed(d)
      }
      default: {
        // round / floor / ceil / abs
        const x = this.num(n.target, v, '取整')
        if (x === null) return null
        if (n.m === 'abs') return Math.abs(x)
        if (n.m === 'floor') return Math.floor(x)
        if (n.m === 'ceil') return Math.ceil(x)
        const d = n.args[0] ? (numOf(arg(0)) ?? 0) : 0
        return Math.round(x * 10 ** d) / 10 ** d
      }
    }
  }
  bin(n: Extract<Ast, { k: 'bin' }>): Val {
    if (n.op === '&&') return truthy(this.ev(n.a)) && truthy(this.ev(n.b))
    if (n.op === '||') return truthy(this.ev(n.a)) || truthy(this.ev(n.b))
    const a = this.ev(n.a)
    const b = this.ev(n.b)
    switch (n.op) {
      case '==':
        return valEq(a, b)
      case '!=':
        return !valEq(a, b)
      case '>':
      case '>=':
      case '<':
      case '<=': {
        const c = valCmp(a, b)
        if (c === null) return false
        return n.op === '>' ? c > 0 : n.op === '>=' ? c >= 0 : n.op === '<' ? c < 0 : c <= 0
      }
      case '+':
        return this.plus(n, a, b)
      case '-':
        return this.minus(n, a, b)
    }
    const verb = n.op === '*' ? '乘' : n.op === '/' ? '除' : '取余'
    const x = this.num(n.a, a, verb)
    const y = this.num(n.b, b, verb)
    if (x === null || y === null) return null
    if (n.op === '*') return x * y
    if (y === 0) return null
    return n.op === '/' ? x / y : x % y
  }
  /** 日期挪 by（"7d" 这种时长，或者几天）；挪不了返回 undefined */
  shift(d: DateV, by: Val, sign: 1 | -1): DateV | null | undefined {
    if (by === null) return null
    if (typeof by === 'number') return { date: shiftDate(d.date, sign * by, 'd') }
    if (typeof by === 'string') {
      const du = durationOf(by)
      if (du) return { date: shiftDate(d.date, sign * du.n, du.unit) }
    }
    return undefined
  }
  plus(n: Extract<Ast, { k: 'bin' }>, a: Val, b: Val): Val {
    if (isDateV(a)) {
      const s = this.shift(a, b, 1)
      if (s !== undefined) return s
    }
    if (isDateV(b) && (typeof a === 'number' || (typeof a === 'string' && durationOf(a)))) {
      const s = this.shift(b, a, 1)
      if (s !== undefined) return s
    }
    if (typeof a === 'string' || typeof b === 'string' || isDateV(a) || isDateV(b)) return valText(a) + valText(b)
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
    if (Array.isArray(a) || Array.isArray(b)) return valText(a) + valText(b)
    if (a === null || b === null) return null
    const x = this.num(n.a, a, '加')
    const y = this.num(n.b, b, '加')
    return x === null || y === null ? null : x + y
  }
  minus(n: Extract<Ast, { k: 'bin' }>, a: Val, b: Val): Val {
    if (a === null || b === null) return null
    const da = dateLike(a)
    const db = dateLike(b)
    if (isDateV(a) || isDateV(b)) {
      if (da && db) return dayDiff(da.date, db.date)
      if (isDateV(a)) {
        const s = this.shift(a, b, -1)
        if (s !== undefined) return s
      }
      throw new ExprFail(`「${this.desc(isDateV(a) ? n.b : n.a)}」不是日期也不是几天，不能和日期相减`)
    }
    const x = this.num(n.a, a, '减')
    const y = this.num(n.b, b, '减')
    return x === null || y === null ? null : x - y
  }
}
