/**
 * 「拿掉记号」连同空行一起改（task-axoxy，Fable 5.2 报告整体看法第 3 条）。
 *
 * md 有一条懒续行规矩：紧跟在列表项、引用下面、不带记号的一行还算那一块的（续行）。只删记号不动空行，屏上像是出来了，
 * 文件里没出来（出列表以后接着写的正文成了上一项的续行，换个 md 软件、交给 AI 读就是另一个样子）。
 * 所以一行要变成独立的一段，就是：去掉行首的块记号 + 上下挨着有字的行时各补一个空行；后面接着的编号列表从 1 重新数（列表拆成了两段）。
 * 拿掉记号以后是空行的（出列表）：上面补一道缝，它自己就是一个空块（空行的数法见 apps/notes 的 gap-lines.ts）。
 * 出列表（空项回车、空项退格）、列表项和标题行首退格都走这一个函数。只读文字，不依赖编辑器。
 */

export interface LineOut {
  /** 按原文位置的改动（从前往后、不重叠） */
  changes: { from: number; to: number; insert: string }[]
  /** 这一行看得见的开头在改完的文字里的位置（光标放这里） */
  at: number
  /** 出列表的这一行后面没有别的块了：编辑器在文末新起一行（只在屏上、不写文件） */
  trailing?: boolean
}

/** 行首的块记号：引用（几层）、列表、待办、标题；前面的缩进一起算 */
const MARK = /^(?:[ \t]*(?:>[ \t]?)+|[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?:[ \t]+|$)| {0,3}#{1,6}(?:[ \t]+|$))/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+|$)/

/** 这一行开头块记号的长度（没有是 0） */
export function lineMarkLength(line: string): number {
  return MARK.exec(line)?.[0].length ?? 0
}

/**
 * 第 n 行（从 1 数）变成独立的一段。mark：行首要去掉的长度（编辑器按语法树认的，给了就用它；不给按 lineMarkLength）
 */
export function standaloneLine(text: string, n: number, mark?: number): LineOut {
  const lines = text.split('\n')
  if (n < 1 || n > lines.length) return { changes: [], at: 0 }
  const starts: number[] = []
  let pos = 0
  for (const l of lines) {
    starts.push(pos)
    pos += l.length + 1
  }
  const line = lines[n - 1]!
  const from = starts[n - 1]!
  const m = Math.min(line.length, mark ?? lineMarkLength(line))
  const blank = (k: number) => k >= 1 && k <= lines.length && lines[k - 1]!.trim() === ''
  const changes: LineOut['changes'] = []
  let at: number
  let trailing = false
  if (line.slice(m).trim() !== '') {
    // 有字的一行：上下挨着有字的行时各补一道缝
    const above = n > 1 && !blank(n - 1)
    const below = n < lines.length && !blank(n + 1)
    changes.push({ from, to: from + m, insert: above ? '\n' : '' })
    if (below) changes.push({ from: from + line.length, to: from + line.length, insert: '\n' })
    at = from + (above ? 1 : 0)
  } else {
    // 拿掉记号以后是空的（出列表）：这一行拿掉，在上一块下面多一个空块（一串空行第一行是缝、后面每一行一个空块，Tolaria 的数法；
    // 标题前最后一个空行算标题上方的留白），光标在这个空块里。后面没有别的块了（trailing）：编辑器在文末新起一行（只在屏上）
    let up = n - 1
    while (up >= 1 && blank(up)) up--
    let down = n + 1
    while (down <= lines.length && blank(down)) down++
    if (up < 1) {
      changes.push({ from, to: from + m, insert: '' })
      at = from
    } else {
      const k = down - up - 2
      trailing = down > lines.length || (down === lines.length && lines[down - 1] === '')
      const end = starts[up - 1]! + lines[up - 1]!.length
      // 这一行连同它前面那个换行拿掉（文件最后一行没有后面的换行）
      const cut = { from: from - 1, to: from + line.length }
      const heading = !trailing && HEADING.test(lines[down - 1]!)
      const add = trailing ? 0 : heading && k < 2 ? 3 - k : k === 0 ? 2 : 1
      if (cut.from === end) changes.push({ from: end, to: cut.to, insert: '\n'.repeat(add) })
      else changes.push({ from: end, to: end, insert: '\n'.repeat(add) }, { from: cut.from, to: cut.to, insert: '' })
      at = end + (trailing ? 0 : 2)
    }
  }
  // 拿掉的是编号列表的一项：后面同一层的编号从 1 重新数
  const own = ORDERED.exec(line)
  if (own) {
    const indent = own[1]!.length
    let num = 1
    for (let k = n + 1; k <= lines.length; k++) {
      const l = lines[k - 1]!
      if (l.trim() === '') continue
      const lead = /^[ \t]*/.exec(l)![0].length
      if (lead > indent) continue
      const o = ORDERED.exec(l)
      if (!o || o[1]!.length !== indent) break
      const want = String(num++)
      if (o[2] !== want) changes.push({ from: starts[k - 1]! + indent, to: starts[k - 1]! + indent + o[2]!.length, insert: want })
    }
  }
  const nonEmpty = changes.filter((c) => c.from !== c.to || c.insert !== '')
  return { changes: nonEmpty, at, trailing }
}

/** 把 standaloneLine 的改动用到文字上（测试、不在编辑器里的地方用） */
export function applyLineOut(text: string, out: LineOut): string {
  let s = ''
  let last = 0
  for (const c of out.changes) {
    s += text.slice(last, c.from) + c.insert
    last = c.to
  }
  return s + text.slice(last)
}
