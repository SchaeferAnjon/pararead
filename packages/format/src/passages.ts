/**
 * 一篇 md 切成「段」和「节」（梦游 Wiki 化，task-h7oy8，设计页 24-梦游底层 W.1、W.5）：
 * 梦游把 A 里提到的东西链到 B 的整篇、某一节（[[B#标题]]）或某一段（[[B#^块编号]]），这里管 B 那一头：
 * - outline：标题有哪些、每一段从哪行到哪行、在哪个标题下面、行尾有没有块编号；
 * - 块编号（B1）：没有标题的那一段在行尾加 ` ^xxxxxx`，只加在最后一行行尾，别的字一个不动；收下前核对只多了块编号；
 * - 标题比较不管空白和标点（headingKey），标题改名时全库指着旧标题的 [[B#旧标题]] 跟着改（headingRenames、relinkHeading）。
 * 纯函数，不碰文件。
 */

export interface Heading {
  /** 第几行（0 起） */
  line: number
  level: number
  /** 去掉 # 和末尾 # 的标题字 */
  text: string
}

export interface Passage {
  /** 第一行、最后一行（0 起，含）；块编号加在 end 那一行行尾 */
  line: number
  end: number
  kind: 'para' | 'item' | 'quote' | 'table'
  /** 在哪个标题下面（headings 里的序号），在第一个标题前是 -1 */
  heading: number
  /** 原文（几行连起来） */
  text: string
  /** 行尾已有的块编号（不带 ^） */
  id?: string
}

const FM = /^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const FENCE = /^\s*(```|~~~)/
const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^ {0,1}(?:[-*+]|\d+[.)])\s/
const ID_AT_END = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/
const ID_LINE = /^\s*\^([A-Za-z0-9-]+)\s*$/

/** 属性占了几行（没有属性是 0） */
export function frontLines(text: string): number {
  const m = FM.exec(text)
  return m ? m[0].split('\n').length - 1 : 0
}

/** 一篇的标题和段：空行分段；列表顶格的每一项一段（下面缩进的算进去）；引用块一段；表格一段；代码块、注释、只有嵌入的行不算段 */
export function outline(text: string): { headings: Heading[]; passages: Passage[] } {
  const lines = text.split('\n')
  const headings: Heading[] = []
  const passages: Passage[] = []
  let fence = false
  let cur: Passage | null = null
  const close = () => {
    if (cur) {
      cur.text = lines.slice(cur.line, cur.end + 1).join('\n')
      const id = ID_AT_END.exec(lines[cur.end]!)
      if (id && cur.kind !== 'table') cur.id = id[1]
      passages.push(cur)
    }
    cur = null
  }
  const open = (i: number, kind: Passage['kind']) => {
    close()
    cur = { line: i, end: i, kind, heading: headings.length - 1, text: '' }
  }
  for (let i = frontLines(text); i < lines.length; i++) {
    const l = lines[i]!
    if (FENCE.test(l)) {
      close()
      fence = !fence
      continue
    }
    if (fence) continue
    const h = HEAD.exec(l)
    if (h) {
      close()
      headings.push({ line: i, level: h[1]!.length, text: h[2]!.trim() })
      continue
    }
    if (!l.trim()) {
      close()
      continue
    }
    // Obsidian 给表格、整个列表编号的写法：顶格单独一行 ^id，记在上一段上
    const idLine = ID_LINE.exec(l)
    if (idLine) {
      const last = (cur ?? passages[passages.length - 1]) as Passage | undefined
      if (cur) close()
      if (last && last.end === i - 1) last.id = idLine[1]
      continue
    }
    if (/^\s*<!--/.test(l) || /^\s*!\[\[[^\]]*\]\]\s*$/.test(l)) {
      close()
      continue
    }
    const kind: Passage['kind'] = /^\s*>/.test(l) ? 'quote' : /^\s*\|/.test(l) ? 'table' : ITEM.test(l) ? 'item' : 'para'
    const c = cur as Passage | null
    if (!c) open(i, kind)
    else if (kind === 'item' || (c.kind !== kind && !(c.kind === 'item' && /^\s/.test(l)))) open(i, kind)
    else c.end = i
  }
  close()
  return { headings, passages }
}

/** 比标题用：不管大小写、空白、标点（「九、双杠臂屈伸（多关节） 52:56」和「九 双杠臂屈伸(多关节)52:56」算同一个） */
export function headingKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** [[B#一#二]] 的锚点取最后一截 */
export const lastAnchor = (anchor: string) => anchor.split('#').pop()!.trim()

/** 这篇里叫 name 的标题在第几行（先比原字，再按 headingKey 比）；没有是 -1 */
export function findHeading(text: string, name: string): number {
  const { headings } = outline(text)
  const want = lastAnchor(name).replace(/\s+/g, ' ').toLowerCase()
  const exact = headings.find((h) => h.text.replace(/\s+/g, ' ').toLowerCase() === want)
  if (exact) return exact.line
  const k = headingKey(want)
  if (!k) return -1
  return headings.find((h) => headingKey(h.text) === k)?.line ?? -1
}

/** 标题里能单独认的几截（「九、动作评述④：双杠臂屈伸（多关节） 52:56」→ 动作评述、双杠臂屈伸、多关节）：中文至少 3 个字、英文至少 5 个字母 */
export function headingParts(text: string): string[] {
  const out = new Set<string>()
  for (const part of text.split(/[\s\p{P}\p{S}\p{N}]+/u)) {
    const han = (part.match(/\p{Script=Han}/gu) ?? []).length
    if (han >= 3 || (han === 0 && part.replace(/[^a-z]/gi, '').length >= 5)) out.add(part)
  }
  return [...out]
}

/** 行尾的 ^块编号 */
export function blockIdOf(line: string): string | null {
  return ID_AT_END.exec(line)?.[1] ?? null
}

/** 这篇里没有用过的新块编号（6 位小写字母和数字，第一位是字母；rand 给测试用） */
export function newBlockId(text: string, rand: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz'
  const all = abc + '0123456789'
  for (;;) {
    let id = abc[Math.floor(rand() * 26)]!
    for (let i = 0; i < 5; i++) id += all[Math.floor(rand() * 36)]!
    if (!text.includes('^' + id)) return id
  }
}

/** 第 line 行行尾加块编号（行尾本来有空白就不再加空格）；那一行已经有块编号时不动，返回原文 */
export function addBlockId(text: string, line: number, id: string): string {
  const lines = text.split('\n')
  const l = lines[line]
  if (l === undefined || blockIdOf(l.replace(/\r$/, ''))) return text
  const cr = l.endsWith('\r') ? '\r' : ''
  const body = cr ? l.slice(0, -1) : l
  lines[line] = body + (/\s$/.test(body) ? '' : ' ') + '^' + id + cr
  return lines.join('\n')
}

/** 改前改后只差几处行尾的块编号（梦游收下前核对：B 那篇别的字一个没动） */
export function onlyBlockIdsAdded(before: string, after: string): boolean {
  if (before === after) return true
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    const x = a[i]!.replace(/\r$/, '')
    const y = b[i]!.replace(/\r$/, '')
    if (!y.startsWith(x) || blockIdOf(x)) return false
    const add = y.slice(x.length)
    if (!/^ ?\^[a-z][a-z0-9]{5}$/.test(add) || (!add.startsWith(' ') && !/\s$/.test(x))) return false
  }
  return true
}

/**
 * 存盘前后标题改了名：标题个数、各自级别不变，同一个位置上的字变了、旧字在新的里面已经没有了，才算改名（删了、加了标题不猜）。
 * 返回 [旧标题, 新标题]
 */
export function headingRenames(before: string, after: string): [string, string][] {
  const a = outline(before).headings
  const b = outline(after).headings
  if (a.length !== b.length || !a.length) return []
  const now = new Set(b.map((h) => headingKey(h.text)))
  const out: [string, string][] = []
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.level !== b[i]!.level) return []
    const ka = headingKey(a[i]!.text)
    if (ka === headingKey(b[i]!.text) || !ka || !headingKey(b[i]!.text)) continue
    if (now.has(ka)) continue
    out.push([a[i]!.text, b[i]!.text])
  }
  return out
}

/**
 * 一篇里指着 B 某个旧标题的链接换成新标题：[[B#旧|字]]、![[B#旧]]、[[B#上一级#旧]]（只换最后一截）；self 是 B 自己时 [[#旧]] 也换。
 * names：能指着 B 的写法（小写、不带 .md：名字、路径、别名）
 */
export function relinkHeading(text: string, names: ReadonlySet<string>, from: string, to: string, self = false): string {
  const k = headingKey(from)
  if (!k || /[[\]|#^]/.test(to)) return text
  return text.replace(/(!?\[\[)([^\]|#\n]*)#([^\]|\n]+)((?:\|[^\]\n]*)?\]\])/g, (m, open: string, name: string, anchor: string, tail: string) => {
    const n = name.trim().replace(/\.md$/i, '').toLowerCase()
    if (n ? !names.has(n) : !self) return m
    if (anchor.startsWith('^')) return m
    const parts = anchor.split('#')
    if (headingKey(parts[parts.length - 1]!) !== k) return m
    parts[parts.length - 1] = to
    return `${open}${name}#${parts.join('#')}${tail}`
  })
}

/** 一段的那几行（嵌一段 ![[B#^id]] 时画它）：块编号所在那一段（列表项、引用块、普通段），去掉行尾的块编号；没有是 null */
export function blockText(text: string, id: string): { line: number; end: number; text: string } | null {
  const p = outline(text).passages.find((x) => x.id === id)
  if (!p) return null
  const lines = p.text.split('\n')
  lines[lines.length - 1] = lines[lines.length - 1]!.replace(/\s*\^[A-Za-z0-9-]+\s*$/, '')
  return { line: p.line, end: p.end, text: lines.join('\n') }
}
