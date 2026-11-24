/**
 * ```base 块里那一小块 YAML：读成带行号的树，改的时候只换动到的那几行（打开再保存不变、只改动到的那几行）。
 *
 * 认：缩进的映射和列表、「- 键: 值」开头的映射、一行的 [a, b]、带引号的字（"…" 里反斜杠转义、'…' 里 '' 是一个 '）、
 * 行尾注释（引号里的 # 不算）、| 和 > 的多行字、接着下一行写的长字、四个空格缩进、「键:」下面不缩进的列表。
 * 别的写法（锚点、标签、{a: b}）当普通字原样留着，读不懂的行跳过、不丢。
 *
 * 改法都是「换掉某几行」：一项没变就一个字不动，变了的那一项按旁边的缩进写；整块里别的行、注释、认不出的键原样留着。
 */

export type YNode = YMap | YSeq | YScalar | YFlow

/** 一个值：value 是去掉引号以后的字，raw 是文件里写的样子 */
export interface YScalar {
  kind: 'scalar'
  value: string
  raw: string
  line: number
  col: number
  end: number
}

/** 一行写完的列表 [a, "b", [c]] */
export interface YFlow {
  kind: 'flow'
  items: (YScalar | YFlow)[]
  raw: string
  line: number
  col: number
  end: number
}

/**
 * 映射里的一项。line：键那一行；col：键从第几个字开始；end：这一项（连同下面的值、跟着它更深缩进的注释）到哪一行为止（不含）；
 * lead：紧贴在上面的注释从哪一行开始（拿掉这一项时一起拿掉）
 */
export interface YEntry {
  key: string
  raw: string
  line: number
  col: number
  value: YNode | null
  end: number
  lead: number
}

export interface YMap {
  kind: 'map'
  col: number
  entries: YEntry[]
  line: number
  end: number
}

/** 列表里的一项：col 是「-」在第几个字 */
export interface YItem {
  line: number
  col: number
  value: YNode | null
  end: number
  lead: number
}

export interface YSeq {
  kind: 'seq'
  col: number
  items: YItem[]
  line: number
  end: number
}

/** 读成普通的值：字、列表、映射（同名的键认第一个） */
export type Y = string | Y[] | { [k: string]: Y }

const isDash = (t: string) => /^-(?:[ \t]|$)/.test(t)

/** 去掉行尾注释（# 前面是空白、不在引号里），再去掉行尾空白 */
export function stripComment(line: string): string {
  let q: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (q) {
      if (q === '"' && c === '\\') {
        i++
        continue
      }
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      continue
    }
    if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return line.slice(0, i).replace(/\s+$/, '')
  }
  return line.replace(/\s+$/, '')
}

const KEY_DQ = /^"((?:[^"\\]|\\.)*)"[ \t]*:(?:[ \t]+|$)/
const KEY_SQ = /^'((?:[^']|'')*)'[ \t]*:(?:[ \t]+|$)/
const KEY_PLAIN = /^([^\s"'#\-[\]{},&*!|>%@`?][^"']*?)[ \t]*:(?:[ \t]+|$)/

/** 一行（从 col 起）是不是「键: …」：键、文件里写的键、值从第几个字开始 */
export function keyOf(t: string): { key: string; raw: string; len: number } | null {
  const d = KEY_DQ.exec(t)
  if (d) return { key: unescapeDq(d[1]!), raw: t.slice(0, t.indexOf(':', d[1]!.length + 1)).trimEnd(), len: d[0].length }
  const s = KEY_SQ.exec(t)
  if (s) return { key: s[1]!.replace(/''/g, "'"), raw: t.slice(0, t.indexOf(':', s[1]!.length + 1)).trimEnd(), len: s[0].length }
  const m = KEY_PLAIN.exec(t)
  if (m) return { key: m[1]!.trim(), raw: m[1]!.trim(), len: m[0].length }
  return null
}

function unescapeDq(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_a, c: string) => {
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
    return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === '0' ? '\0' : c
  })
}

/** 一个值的字（去引号）：整段是 "…" 或 '…' 才去；引号后面还有别的字（YAML 不认的写法）就当普通字 */
export function scalarValue(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"')) {
    const close = closeOf(t, 0, '"')
    if (close === t.length - 1) return unescapeDq(t.slice(1, -1))
  } else if (t.startsWith("'")) {
    const close = closeOf(t, 0, "'")
    if (close === t.length - 1) return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

/** 从 at（开头的引号）起找配对的收尾引号；没有返回 -1 */
function closeOf(s: string, at: number, q: string): number {
  for (let i = at + 1; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") {
        i++
        continue
      }
      return i
    }
  }
  return -1
}

/** 一行的 [a, b] 拆成项（套着的 [x] 也认）；拆不开（方括号没配对）返回 null */
function flowItems(s: string, line: number, col: number): { items: (YScalar | YFlow)[]; len: number } | null {
  const items: (YScalar | YFlow)[] = []
  let i = 1
  const sc = (raw: string, at: number): YScalar => ({ kind: 'scalar', value: scalarValue(raw), raw: raw.trim(), line, col: col + at, end: line + 1 })
  for (;;) {
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (i >= s.length) return null
    if (s[i] === ']') return { items, len: i + 1 }
    const start = i
    if (s[i] === '[') {
      const sub = flowItems(s.slice(i), line, col + i)
      if (!sub) return null
      items.push({ kind: 'flow', items: sub.items, raw: s.slice(i, i + sub.len), line, col: col + i, end: line + 1 })
      i += sub.len
    } else if (s[i] === '"' || s[i] === "'") {
      const close = closeOf(s, i, s[i]!)
      if (close === -1) return null
      items.push(sc(s.slice(start, close + 1), start))
      i = close + 1
    } else {
      while (i < s.length && s[i] !== ',' && s[i] !== ']') i++
      items.push(sc(s.slice(start, i), start))
    }
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (s[i] === ',') i++
    else if (s[i] === ']') return { items, len: i + 1 }
    else return null
  }
}

/** 一行的 [a, "b", [c]] 拆成每一项：raw 是文件里写的样子，value 是去引号以后的字（没加引号的 [c] 照写）；不是一行的列表返回 null */
export function flowParts(s: string): { raw: string; value: string }[] | null {
  const t = s.trim()
  if (!t.startsWith('[')) return null
  const f = flowItems(t, 0, 0)
  if (!f || t.slice(f.len).trim() !== '') return null
  return f.items.map((x) => ({ raw: x.raw, value: x.kind === 'scalar' ? x.value : x.raw }))
}

class Parser {
  readonly n: number
  readonly body: string[]
  readonly ind: number[]
  readonly kind: ('blank' | 'comment' | 'content')[]
  constructor(readonly lines: string[]) {
    this.n = lines.length
    this.body = lines.map(stripComment)
    this.ind = lines.map((l) => l.length - l.trimStart().length)
    this.kind = lines.map((l) => {
      const t = l.trim()
      return t === '' ? 'blank' : t.startsWith('#') ? 'comment' : 'content'
    })
  }

  /** i 起第一行有内容的行 */
  next(i: number): number {
    while (i < this.n && this.kind[i] !== 'content') i++
    return i
  }

  /** 跟在一项后面、缩进比它深的注释算它的 */
  own(end: number, col: number): number {
    while (end < this.n && this.kind[end] === 'comment' && this.ind[end]! > col) end++
    return end
  }

  /** 紧贴在 j 上面、缩进不比 col 浅的注释从哪一行起（不越过 floor） */
  lead(j: number, col: number, floor: number): number {
    let k = j
    while (k - 1 >= floor && this.kind[k - 1] === 'comment' && this.ind[k - 1]! >= col) k--
    return k
  }

  parse(): YNode | null {
    const i = this.next(0)
    if (i >= this.n) return null
    return this.node(i, this.ind[i]!, -1, 0)
  }

  node(i: number, col: number, parent: number, floor: number): YNode {
    const t = this.body[i]!.slice(col)
    if (isDash(t)) return this.seq(i, col, floor)
    if (keyOf(t)) return this.map(i, col, floor)
    return this.scalar(i, col, parent)
  }

  seq(i: number, col: number, floor: number): YSeq {
    const items: YItem[] = []
    let j = i
    let prevEnd = floor
    for (let first = true; ; first = false) {
      if (!first) {
        j = this.next(j)
        if (j >= this.n || this.ind[j] !== col || !isDash(this.body[j]!.slice(col))) break
      }
      const lead = first ? Math.max(this.lead(j, col, floor), floor) : this.lead(j, col, prevEnd)
      const after = this.body[j]!.slice(col + 1)
      const ccol = col + 1 + (after.length - after.trimStart().length)
      let value: YNode | null = null
      let end = j + 1
      if (after.trim() === '') {
        const k = this.next(j + 1)
        if (k < this.n && this.ind[k]! > col) {
          value = this.node(k, this.ind[k]!, col, j + 1)
          end = value.end
        }
      } else {
        value = this.node(j, ccol, col, j)
        end = value.end
      }
      end = this.own(end, col)
      items.push({ line: j, col, value, end, lead })
      j = end
      prevEnd = end
    }
    return { kind: 'seq', col, items, line: i, end: items.length ? items[items.length - 1]!.end : i + 1 }
  }

  map(i: number, col: number, floor: number): YMap {
    const entries: YEntry[] = []
    let j = i
    let prevEnd = floor
    for (let first = true; ; first = false) {
      if (!first) {
        j = this.next(j)
        if (j >= this.n || this.ind[j] !== col) break
      }
      const t = this.body[j]!.slice(col)
      const k = keyOf(t)
      if (!k) {
        if (first) break
        // 这一层里认不出的一行（坏掉的写法）：跳过，后面的照读
        j++
        continue
      }
      // 第一个键：和「-」同一行时上面的注释归那一项；单独一行时上面紧贴的注释归它
      const lead = first ? (this.ind[j] === col ? this.lead(j, col, floor) : j) : this.lead(j, col, prevEnd)
      const rest = t.slice(k.len)
      let value: YNode | null = null
      let end = j + 1
      if (rest.trim() !== '') {
        value = this.scalar(j, col + k.len, col)
        end = value.end
      } else {
        const q = this.next(j + 1)
        if (q < this.n && this.ind[q]! > col) {
          value = this.node(q, this.ind[q]!, col, j + 1)
          end = value.end
        } else if (q < this.n && this.ind[q] === col && isDash(this.body[q]!.slice(col))) {
          value = this.seq(q, col, j + 1)
          end = value.end
        }
      }
      end = this.own(end, col)
      entries.push({ key: k.key, raw: k.raw, line: j, col, value, end, lead })
      j = end
      prevEnd = end
    }
    return { kind: 'map', col, entries, line: i, end: entries.length ? entries[entries.length - 1]!.end : i + 1 }
  }

  /** 一个值从 (i, col) 起；下面缩进比 parent 深的行是接着写的（长字、多行的 [ ]、"…"、| >） */
  scalar(i: number, col: number, parent: number): YScalar | YFlow {
    const raw = this.body[i]!.slice(col)
    const t = raw.trim()
    const more = (from: number) => {
      const out: number[] = []
      for (let k = from; k < this.n; k++) {
        if (this.kind[k] === 'blank') continue
        if (this.kind[k] === 'comment' && this.ind[k]! > parent) continue
        if (this.ind[k]! <= parent) break
        out.push(k)
      }
      return out
    }
    if (/^[|>][-+0-9]*$/.test(t)) {
      // 多行字：下面缩进更深的行（中间的空行也算），按第一行的缩进去掉
      let end = i + 1
      const body: string[] = []
      let base = -1
      for (let k = i + 1; k < this.n; k++) {
        if (this.lines[k]!.trim() === '') {
          body.push('')
          continue
        }
        if (this.ind[k]! <= parent) break
        if (base === -1) base = this.ind[k]!
        body.push(this.lines[k]!.slice(Math.min(base, this.ind[k]!)))
        end = k + 1
      }
      while (body.length && body[body.length - 1] === '') body.pop()
      const value = t.startsWith('|') ? body.join('\n') : body.join(' ').replace(/ {2,}/g, ' ')
      return { kind: 'scalar', value, raw: t, line: i, col, end }
    }
    if (t.startsWith('[')) {
      let text = t
      let end = i + 1
      let f = flowItems(text, i, col)
      if (!f) {
        for (const k of more(i + 1)) {
          text += ' ' + this.body[k]!.trim()
          end = k + 1
          f = flowItems(text, i, col)
          if (f) break
        }
      }
      if (f && text.slice(f.len).trim() === '') return { kind: 'flow', items: f.items, raw: text, line: i, col, end }
    }
    if ((t.startsWith('"') || t.startsWith("'")) && closeOf(t, 0, t[0]!) === -1) {
      // 引号里的字写到了下面几行：接起来（YAML 的折行：换行变一个空格）
      let text = t
      let end = i + 1
      for (const k of more(i + 1)) {
        text += ' ' + this.lines[k]!.trim()
        end = k + 1
        if (closeOf(text, 0, t[0]!) !== -1) break
      }
      return { kind: 'scalar', value: scalarValue(text), raw: text, line: i, col, end }
    }
    // 普通的字：下面缩进更深的行接在后面（中间一个空格）
    let text = t
    let end = i + 1
    for (const k of more(i + 1)) {
      if (this.ind[k]! <= parent) break
      text += ' ' + this.body[k]!.trim()
      end = k + 1
    }
    return { kind: 'scalar', value: end === i + 1 ? scalarValue(t) : text, raw: t, line: i, col, end }
  }
}

/** 读整块：每一行和树（空的、全是注释的块 root 是 null） */
export function parseYaml(src: string): { lines: string[]; root: YNode | null } {
  const lines = src.split('\n')
  return { lines, root: new Parser(lines).parse() }
}

/** 树 → 普通的值 */
export function plain(n: YNode | null | undefined): Y {
  if (!n) return ''
  if (n.kind === 'scalar') return n.value
  if (n.kind === 'flow') return n.items.map(plain)
  if (n.kind === 'seq') return n.items.map((it) => plain(it.value))
  const out: { [k: string]: Y } = {}
  for (const e of n.entries) if (!Object.hasOwn(out, e.key)) out[e.key] = plain(e.value)
  return out
}

/** 映射里键是 key 的那一项（同名的认第一个）；norm：比之前先把键换一下（去掉 note. 之类） */
export function entryOf(m: YNode | null | undefined, key: string, norm: (k: string) => string = (k) => k): YEntry | null {
  if (!m || m.kind !== 'map') return null
  return m.entries.find((e) => norm(e.key) === key) ?? null
}

// ---------------------------------------------------------------- 写

/** 一个值写成 YAML 的样子：普通的字不加引号；会被读歪的加单引号（有换行、反斜杠的加双引号） */
export function yamlScalar(s: string): string {
  if (/[\n\r\t\\]/.test(s) || /[\u0000-\u001f]/.test(s)) return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'
  if (s === '' || /^\s|\s$/.test(s) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: | #|:$/.test(s)) return `'${s.replace(/'/g, "''")}'`
  return s
}

/** YAML 里的键：有冒号、引号、开头是记号这些就用双引号包起来；中间的空格不用 */
export function yamlKey(k: string): string {
  return /^[^\s:#'"{}[\],&*!|>%@`?-][^:#'"{}[\],]*$/.test(k) && !/\s$/.test(k) ? k : `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 一行的列表里的一项 */
export function flowItem(s: string): string {
  return s === '' || /[,[\]{}"'#:&*!|>%@`]|^\s|\s$/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s
}

export const pad = (n: number) => ' '.repeat(Math.max(0, n))

/** 几行整体挪 delta 格缩进（往左挪时只去掉空格） */
export function shiftLines(lines: string[], delta: number): string[] {
  if (!delta) return lines
  return lines.map((l) => {
    if (l.trim() === '') return l
    if (delta > 0) return pad(delta) + l
    const have = l.length - l.trimStart().length
    return l.slice(Math.min(have, -delta))
  })
}

/**
 * 一块 YAML 的改法：拿着每一行，改完一处重新读一遍树（块都很小）。
 * 所有改法只换动到的那几行；没变就一个字不动。
 */
export class YamlEdit {
  lines: string[]
  private tree: YNode | null | undefined
  private unit: number | undefined
  constructor(src: string) {
    this.lines = src.split('\n')
  }
  get root(): YNode | null {
    if (this.tree === undefined) this.tree = new Parser(this.lines).parse()
    return this.tree
  }
  text(): string {
    return this.lines.join('\n')
  }
  splice(from: number, to: number, insert: string[]) {
    this.lines.splice(from, to - from, ...insert)
    this.tree = undefined
  }
  /** 这一块一层缩进几格：看已有的键和下一层差多少（多数是 2，手改过的可能是 4） */
  get step(): number {
    if (this.unit !== undefined) return this.unit
    let best = 0
    const walk = (n: YNode | null, col: number) => {
      if (!n) return
      if (n.kind === 'map') {
        for (const e of n.entries) {
          if (e.value && (e.value.kind === 'map' || e.value.kind === 'seq') && e.value.line > e.line && e.value.col > e.col) {
            const d = e.value.col - e.col
            if (!best || d < best) best = d
          }
          walk(e.value, e.col)
        }
      } else if (n.kind === 'seq') for (const it of n.items) walk(it.value, it.col)
      void col
    }
    walk(this.root, 0)
    this.unit = best || 2
    return this.unit
  }
  /** 「键:」下面的列表是缩进一层写（多数），还是和键对齐（手改的 YAML 常见） */
  get flushSeq(): boolean {
    let flush = 0
    let nested = 0
    const walk = (n: YNode | null) => {
      if (!n) return
      if (n.kind === 'map')
        for (const e of n.entries) {
          if (e.value?.kind === 'seq' && e.value.line > e.line) {
            if (e.value.col === e.col) flush++
            else nested++
          }
          walk(e.value)
        }
      else if (n.kind === 'seq') for (const it of n.items) walk(it.value)
    }
    walk(this.root)
    return flush > nested
  }
  /** 键下面一层列表的「-」放第几格 */
  dashCol(keyCol: number): number {
    return this.flushSeq ? keyCol : keyCol + this.step
  }
}

/** 这一行从开头到 col 的那一段（缩进，或者「  - 」这样带着列表记号的开头） */
export const prefixOf = (e: YamlEdit, line: number, col: number) => e.lines[line]!.slice(0, col)

/** 一项是不是和列表记号「-」写在同一行（列表里映射的第一个键） */
const onDash = (e: YamlEdit, en: YEntry) => /-\s*$/.test(prefixOf(e, en.line, en.col))

/**
 * 映射里插一个新键的地方：照 order 的先后（排在后面的键前面），order 里没有的放最后；
 * 不插在和「-」同一行的第一个键前面
 */
export function insertLine(e: YamlEdit, m: YMap, key: string, order?: readonly string[]): number {
  if (order) {
    const rank = (k: string) => {
      const r = order.indexOf(k)
      return r === -1 ? Infinity : r
    }
    const mine = rank(key)
    if (mine !== Infinity) {
      for (const en of m.entries) {
        if (rank(en.key) > mine) {
          if (en === m.entries[0] && onDash(e, en)) return en.end
          return en.lead
        }
      }
    }
  }
  return m.end
}

/** 映射里设一个键的值（一行的字）；value 是 null 时拿掉这个键（连同贴在上面的注释）。只动这一行（或这一项那几行） */
export function setScalar(e: YamlEdit, getMap: () => YMap | null, key: string, value: string | null, opts: { order?: readonly string[]; norm?: (k: string) => string } = {}): void {
  const m = getMap()
  if (!m) return
  const en = entryOf(m, key, opts.norm)
  if (value === null) {
    if (en) removeEntry(e, m, en)
    return
  }
  const text = yamlScalar(value)
  if (en) {
    const v = en.value
    if (v && v.kind === 'scalar' && v.line === en.line && v.end === en.line + 1) {
      if (v.value === value) return
      const line = e.lines[en.line]!
      const body = stripComment(line)
      const at = v.col
      const tail = line.slice(body.length)
      e.splice(en.line, en.line + 1, [line.slice(0, at) + text + tail])
      return
    }
    if (!v && en.end === en.line + 1) {
      const line = e.lines[en.line]!
      const body = stripComment(line)
      e.splice(en.line, en.line + 1, [body + ' ' + text + line.slice(body.length)])
      return
    }
    e.splice(en.line, en.end, [prefixOf(e, en.line, en.col) + `${en.raw}: ${text}`])
    return
  }
  const at = insertLine(e, m, key, opts.order)
  e.splice(at, at, [pad(m.col) + `${yamlKey(key)}: ${text}`])
}

/**
 * 映射里设一个键，值是下面几行（body 已经按 col 缩进好，col = 这个键下一层从第几格起）；body 是 null 时拿掉这个键。
 * 写出来和原来一样就不动
 */
export function setBlock(e: YamlEdit, getMap: () => YMap | null, key: string, body: ((childCol: number) => string[]) | null, opts: { order?: readonly string[]; norm?: (k: string) => string } = {}): void {
  const m = getMap()
  if (!m) return
  const en = entryOf(m, key, opts.norm)
  if (body === null) {
    if (en) removeEntry(e, m, en)
    return
  }
  if (en) {
    const old = e.lines.slice(en.line, en.end)
    // 键那一行：值原来写在同一行（一行的字、[a, b]）就只留「键:」，不然原样（行尾注释留着）
    const head = en.value && en.value.line === en.line ? prefixOf(e, en.line, en.col) + `${en.raw}:` : e.lines[en.line]!
    const next = [head, ...body(en.col)]
    if (next.join('\n') === old.join('\n')) return
    e.splice(en.line, en.end, next)
    return
  }
  const at = insertLine(e, m, key, opts.order)
  e.splice(at, at, [pad(m.col) + `${yamlKey(key)}:`, ...body(m.col)])
}

/** 拿掉映射里的一项（连同贴在上面的注释）；它是和「-」同一行的第一个键时，下一个键挪上去接着「-」 */
export function removeEntry(e: YamlEdit, m: YMap, en: YEntry): void {
  if (en === m.entries[0] && onDash(e, en)) {
    const next = m.entries[1]
    const prefix = prefixOf(e, en.line, en.col)
    if (!next) {
      e.splice(en.line, en.end, [prefix.replace(/\s+$/, '')])
      return
    }
    const first = e.lines[next.line]!
    e.splice(en.line, next.line + 1, [prefix + first.slice(next.col)])
    return
  }
  e.splice(en.lead, en.end, [])
}

/** 键改名：只换这一行的键 */
export function renameKey(e: YamlEdit, en: YEntry, to: string): void {
  const line = e.lines[en.line]!
  const k = yamlKey(to)
  if (en.raw === k) return
  e.splice(en.line, en.line + 1, [line.slice(0, en.col) + k + line.slice(en.col + en.raw.length)])
}

/** 映射里那个映射（键是 key）；没有、或者值不是映射返回 null */
export function mapOf(m: YNode | null | undefined, key: string, norm?: (k: string) => string): YMap | null {
  const v = entryOf(m, key, norm)?.value
  return v && v.kind === 'map' ? v : null
}

/**
 * 两层的键：getParent 那个映射里 outer 下面设 key（列宽 columnSize、表底计算 summaries、formulas 这种）。
 * 没有 outer 就连 outer 一起写；value 是 null 时拿掉，outer 空了一起拿掉
 */
export function setNested(
  e: YamlEdit,
  getParent: () => YMap | null,
  outer: string,
  key: string,
  value: string | null,
  opts: { order?: readonly string[]; norm?: (k: string) => string; keyNorm?: (k: string) => string } = {},
): void {
  const p = getParent()
  if (!p) return
  if (!mapOf(p, outer, opts.norm)) {
    if (value === null) return
    setBlock(e, getParent, outer, (col) => [pad(col + e.step) + `${yamlKey(key)}: ${yamlScalar(value)}`], { order: opts.order, norm: opts.norm })
    return
  }
  setScalar(e, () => mapOf(getParent(), outer, opts.norm), key, value, { norm: opts.keyNorm })
  if (value === null) dropIfEmpty(e, getParent, outer, opts.norm)
}

/** 映射空了（没有键了）：连它的键一起拿掉 */
export function dropIfEmpty(e: YamlEdit, getParent: () => YMap | null, key: string, norm?: (k: string) => string): void {
  const p = getParent()
  const en = entryOf(p, key, norm)
  if (!p || !en) return
  const v = en.value
  const empty = !v || (v.kind === 'map' && v.entries.length === 0) || (v.kind === 'seq' && v.items.length === 0)
  if (empty && e.lines.slice(en.line + 1, en.end).every((l) => l.trim() === '' || l.trim().startsWith('#'))) removeEntry(e, p, en)
}

/**
 * 把 key 下面的列表换成 items：和原来一样的那几项原样留着（连引号、注释），只换变了的、加新的、去掉没了的。
 * same：新的一项和原来的一项（读成普通的值）是不是同一样；emit：新的一项写成几行（「-」在 dash 那一格）。
 * 原来是一行的 [a, b] 而且每项都是字：照旧写成一行。items 空了拿掉这个键
 */
export function setList<T>(
  e: YamlEdit,
  getMap: () => YMap | null,
  key: string,
  items: T[],
  o: { same(item: T, old: Y): boolean; emit(item: T, dash: number, step: number): string[]; flow?(item: T): string | null; order?: readonly string[]; norm?: (k: string) => string },
): void {
  const m = getMap()
  if (!m) return
  const en = entryOf(m, key, o.norm)
  if (!items.length) {
    if (en) removeEntry(e, m, en)
    return
  }
  const v = en?.value ?? null
  if (en && v?.kind === 'flow' && o.flow) {
    const used = new Set<number>()
    const parts: string[] = []
    let ok = true
    for (const it of items) {
      const k = v.items.findIndex((x, i) => !used.has(i) && o.same(it, plain(x)))
      if (k !== -1) {
        used.add(k)
        parts.push(v.items[k]!.raw)
        continue
      }
      const f = o.flow(it)
      if (f === null) {
        ok = false
        break
      }
      parts.push(f)
    }
    if (ok) {
      const line = e.lines[en.line]!
      const body = stripComment(line)
      const next = line.slice(0, v.col) + '[' + parts.join(', ') + ']' + line.slice(body.length)
      if (en.end === en.line + 1 && next === line) return
      e.splice(en.line, v.end, [next])
      return
    }
  }
  const seq = v?.kind === 'seq' ? v : null
  const dash = seq ? seq.col : e.dashCol(en ? en.col : m.col)
  const used = new Set<number>()
  const body: string[] = []
  for (const it of items) {
    const k = seq ? seq.items.findIndex((x, i) => !used.has(i) && o.same(it, plain(x.value))) : -1
    if (k !== -1) {
      used.add(k)
      const old = seq!.items[k]!
      body.push(...shiftLines(e.lines.slice(old.lead, old.end), dash - old.col))
    } else body.push(...o.emit(it, dash, e.step))
  }
  setBlock(e, getMap, key, () => body, { order: o.order, norm: o.norm })
}
