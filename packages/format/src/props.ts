/**
 * 文件的属性：md 开头 frontmatter 里一行一个的 `键: 值`（类型、课程、第几讲、来源、日期……）。
 * 只认简单的一行键值；列表（links:）、多行的值不算属性，原样留着。
 * 改一个属性只动它那一行；没有 frontmatter 时新建一段。
 * 数据库的多选、关联是一串的值（readPropList / setPropList，在文件最后）。
 */
import { listOf } from './base-types'
import { flowItem, flowParts, scalarValue, stripComment } from './base-yaml'

export interface Prop {
  key: string
  value: string
}

const FM = /^---\n([\s\S]*?\n)?---(?:\n|$)/
const LINE = /^([^\s:#\-][^:\n]*?):[ \t]*(.*?)[ \t]*$/

/** 软件自己用的键，不当属性给人看（bookId：微信读书书摘认书的记号，CN-123） */
export const HIDDEN_KEYS = new Set(['type', 'links', 'color', 'icon', 'created', 'updated', 'source', 'draft', 'AI填的', '白板样式', '导图布局', '导图配色', '导图骨架', '导图联系线', 'import-id', 'bookId'])

/** 以前写在 type 里的类型（微信读书同步写过 type: weread）：读的时候当这个「类型」，设类型时就地换掉那一行（CN-131） */
const LEGACY_TYPES: Record<string, string> = { weread: '书摘' }

function unquote(v: string): string {
  const m = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v)
  return m ? m[1]!.replace(/\\"/g, '"') : v
}

/** 值里有 YAML 会读歪的东西就加引号 */
function quote(v: string): string {
  return /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|^$|\s$/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v
}

/** 全部一行键值，按文件里的顺序（含软件自己用的键） */
export function readProps(text: string): Prop[] {
  const m = FM.exec(text)
  if (!m) return []
  const out: Prop[] = []
  const lines = (m[1] ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = LINE.exec(lines[i]!)
    if (!l) continue
    // 值是空的、下一行缩进：是列表或多行，不算
    if (l[2] === '' && /^\s+\S/.test(lines[i + 1] ?? '')) continue
    out.push({ key: l[1]!, value: unquote(l[2]!) })
  }
  return out
}

export function prop(text: string, key: string): string | undefined {
  return readProps(text).find((p) => p.key === key)?.value
}

/** 这篇的「类型」：写在「类型」里的；没有时认旧的 type: weread（书摘） */
export function fileType(text: string): string | undefined {
  const t = prop(text, 'type') ?? ''
  return prop(text, '类型') || (Object.hasOwn(LEGACY_TYPES, t) ? LEGACY_TYPES[t] : undefined)
}

/** 设一个属性；value 是 undefined 时删掉。值没变时原文不变 */
/**
 * opts.raw：值原样写（数据库多选的「[a, b]」是 YAML 一行的列表，不能加引号变成字）。
 * 原来这个键是好几行的值（「标签:」下面一行行「  - a」）：换掉、删掉时连那几行一起
 */
export function setProp(text: string, key: string, value: string | undefined, opts: { raw?: boolean } = {}): string {
  if (!/^[^\s:#\-][^:\n]*$/.test(key)) throw new Error(`属性名不对：${key}`)
  const v = value === undefined ? undefined : value.replace(/\s*\n\s*/g, ' ').trim()
  const out = (x: string) => (opts.raw ? x : quote(x))
  const m = FM.exec(text)
  if (!m) {
    if (v === undefined) return text
    return `---\n${key}: ${out(v)}\n---\n` + text
  }
  const body = m[1] ?? ''
  const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n')
  let i = lines.findIndex((l) => LINE.exec(l)?.[1] === key)
  // 设「类型」而文件里只有旧的 type: weread：就地换掉那一行（一个文件只有一个类型字段，CN-131）
  if (i === -1 && key === '类型') {
    const old = lines.findIndex((l) => {
      const x = LINE.exec(l)
      return x?.[1] === 'type' && Object.hasOwn(LEGACY_TYPES, unquote(x[2]!))
    })
    if (old !== -1) {
      if (v === undefined) lines.splice(old, 1)
      else lines[old] = `${key}: ${quote(v)}`
      const close = m[0].endsWith('\n') ? '---\n' : '---'
      return `---\n${lines.map((l) => l + '\n').join('')}${close}` + text.slice(m[0].length)
    }
  }
  if (i !== -1) {
    // 下面接着的缩进行（多行的值、一行行的列表）
    let n = 1
    while (i + n < lines.length && /^\s+\S/.test(lines[i + n]!)) n++
    if (v !== undefined && n === 1 && unquote(LINE.exec(lines[i]!)![2]!) === v) return text
    if (v === undefined) lines.splice(i, n)
    else lines.splice(i, n, `${key}: ${out(v)}`)
  } else {
    if (v === undefined) return text
    lines.push(`${key}: ${out(v)}`)
  }
  const rest = text.slice(m[0].length)
  const close = m[0].endsWith('\n') ? '---\n' : '---'
  return `---\n${lines.map((l) => l + '\n').join('')}${close}` + rest
}

/** 属性改名（数据库改列名，每一条都改）：只换那一行的键，值（连同下面几行）原样；新名字已经有了就不改 */
export function renameProp(text: string, from: string, to: string): string {
  if (!/^[^\s:#\-][^:\n]*$/.test(to)) throw new Error(`属性名不对：${to}`)
  const m = FM.exec(text)
  if (!m || from === to) return text
  const body = m[1] ?? ''
  const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n')
  if (lines.some((l) => LINE.exec(l)?.[1] === to)) return text
  const i = lines.findIndex((l) => LINE.exec(l)?.[1] === from)
  if (i === -1) return text
  lines[i] = to + lines[i]!.slice(lines[i]!.indexOf(':'))
  const close = m[0].endsWith('\n') ? '---\n' : '---'
  return `---\n${lines.map((l) => l + '\n').join('')}${close}` + text.slice(m[0].length)
}

// ---------- AI 填的属性：记在 AI填的 这一行（逗号隔开），用户改过的就去掉 ----------

export const AI_KEY = 'AI填的'

export function aiFilled(text: string): string[] {
  return (prop(text, AI_KEY) ?? '')
    .split(/[,，]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 用户改了一个属性：设值，并且它不再算 AI 填的 */
export function setPropByUser(text: string, key: string, value: string | undefined): string {
  let out = setProp(text, key, value)
  const ai = aiFilled(out)
  if (ai.includes(key)) {
    const left = ai.filter((k) => k !== key)
    out = setProp(out, AI_KEY, left.length ? left.join(', ') : undefined)
  }
  return out
}

// ---------------------------------------------------------------- 一串的值（数据库的多选、关联：练习: ["[[练习 3.1]]", "[[练习 3.2]]"]）

/** 一项的值是一串：一行的 [a, "b"]，或者下面一行行的「  - a」；写成一个字的也算一串（「a, b」照多选的老写法拆开）；没有这一项返回 null */
export function readPropList(text: string, key: string): string[] | null {
  const m = FM.exec(text)
  if (!m) return null
  const lines = (m[1] ?? '').split('\n')
  const i = lines.findIndex((l) => LINE.exec(l)?.[1] === key)
  if (i === -1) return null
  const v = stripComment(LINE.exec(lines[i]!)![2]!)
  if (v !== '') return listValue(v)
  const out: string[] = []
  for (let k = i + 1; k < lines.length && /^\s+\S/.test(lines[k]!); k++) {
    const x = blockItem(lines[k]!)
    if (x !== null) out.push(x)
  }
  return out
}

/** 开头所有一行的值和一串的值（数据库读一条记录用）：props 同 readProps；lists 是值为一串的那几项 */
export function readFields(text: string): { props: Record<string, string>; lists: Record<string, string[]> } {
  const props: Record<string, string> = {}
  const lists: Record<string, string[]> = {}
  for (const p of readProps(text)) if (!Object.hasOwn(props, p.key)) props[p.key] = p.value
  const m = FM.exec(text)
  if (!m) return { props, lists }
  const lines = (m[1] ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = LINE.exec(lines[i]!)
    if (!l || Object.hasOwn(lists, l[1]!)) continue
    const v = stripComment(l[2]!)
    if (v.startsWith('[')) lists[l[1]!] = listValue(v)
    else if (v === '' && /^\s+-(\s|$)/.test(lines[i + 1] ?? '')) lists[l[1]!] = readPropList(text, l[1]!) ?? []
  }
  return { props, lists }
}

const blockItem = (l: string): string | null => {
  const x = /^\s+-(?:\s+(.*))?$/.exec(l)
  return x ? scalarValue(stripComment(x[1] ?? '')) : null
}

function listValue(v: string): string[] {
  const t = v.trim()
  if (t.startsWith('[')) {
    const parts = flowParts(t)
    return parts ? parts.map((x) => x.value).filter((x) => x !== '') : listOf(t)
  }
  if (/^["']/.test(t)) return [scalarValue(t)]
  return listOf(t)
}

/**
 * 设一串的值（关联两边写、多选）：原来是一行一项的照一行一项写，原来是 [a, b] 的照一行写；没变的项照原来的写法一个字不动，
 * 新的项该加引号的加（双链写成 "[[练习 3.2]]"）。items 空了连这一项拿掉（原来没有这一项时，加上再去掉回到原样）
 */
export function setPropList(text: string, key: string, items: string[]): string {
  if (!/^[^\s:#\-][^:\n]*$/.test(key)) throw new Error(`属性名不对：${key}`)
  const flow = (xs: string[]) => '[' + xs.map(flowItem).join(', ') + ']'
  const m = FM.exec(text)
  if (!m) return items.length ? `---\n${key}: ${flow(items)}\n---\n` + text : text
  const body = m[1] ?? ''
  const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n')
  const close = m[0].endsWith('\n') ? '---\n' : '---'
  const rebuild = () => `---\n${lines.map((l) => l + '\n').join('')}${close}` + text.slice(m[0].length)
  const i = lines.findIndex((l) => LINE.exec(l)?.[1] === key)
  if (i === -1) {
    if (!items.length) return text
    lines.push(`${key}: ${flow(items)}`)
    return rebuild()
  }
  let n = 1
  while (i + n < lines.length && /^\s+\S/.test(lines[i + n]!)) n++
  if (!items.length) {
    lines.splice(i, n)
    return rebuild()
  }
  const head = lines[i]!
  const v = LINE.exec(head)![2]!
  const old = lines.slice(i, i + n)
  let next: string[]
  if (stripComment(v) === '' && n > 1) {
    // 一行一项：没变的项那一行原样，新的照第一项的缩进加在后面
    const olds = old.slice(1).map((l) => ({ l, v: blockItem(l) }))
    const indent = /^(\s+)-/.exec(olds.find((o) => o.v !== null)?.l ?? '')?.[1] ?? '  '
    const used = new Set<number>()
    next = [
      head,
      ...items.map((x) => {
        const k = olds.findIndex((o, j) => !used.has(j) && o.v === x)
        if (k === -1) return `${indent}- ${flowItem(x)}`
        used.add(k)
        return olds[k]!.l
      }),
    ]
  } else {
    // 一行的 [a, b]（或者只写了一个）：没变的项照原来的写法，行尾注释留着
    let at = head.indexOf(':') + 1
    while (head[at] === ' ' || head[at] === '\t') at++
    const rest = head.slice(at)
    const val = stripComment(rest)
    const parts = flowParts(val) ?? (val ? [{ raw: val, value: scalarValue(val) }] : [])
    const used = new Set<number>()
    const out = items.map((x) => {
      const k = parts.findIndex((p, j) => !used.has(j) && p.value === x)
      if (k === -1) return flowItem(x)
      used.add(k)
      return parts[k]!.raw
    })
    const prefix = head.slice(0, at)
    next = [(/\s$/.test(prefix) ? prefix : prefix + ' ') + '[' + out.join(', ') + ']' + rest.slice(val.length)]
  }
  if (next.join('\n') === old.join('\n')) return text
  lines.splice(i, n, ...next)
  return rebuild()
}
