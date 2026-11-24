/**
 * 哪段字算公式（LaTeX）：文档编辑器、白板卡片、文档切成的白板、AI 回答、读 PDF 笔记、导出给 Anki 都用这一个认法（task-o48fa）。
 * 照常见的 Markdown 写法（pandoc 的 tex_math_dollars，Obsidian、Typora 一样）：
 * - 行内 `$…$`：开头的 `$` 后面紧跟不是空格的字，结尾的 `$` 前面紧挨着不是空格的字、后面不跟数字；里面不跨行、不含没转义的 `$`。
 *   所以「$5 和 $6」「一杯 $5，两杯 $10」是钱数不是公式；
 * - 行内 `\(…\)`；一行中间的 `$$…$$`、`\[…\]` 也认（排成行内的样子）；
 * - 单独成行的 `$$…$$`、`\[…\]`：一行写完，或开头一行、结尾一行夹着几行（中间不许有空行，免得一个落单的 `$$` 吞掉后面整篇）；
 *   引文、提示块里的也认（每行前面同样的「> 」，剪藏进来的 `> $$ … > $$`，task-6cxtc）；
 * - `\$` 是普通的美元符号；代码块、行内代码、HTML 注释、文件开头的属性里的都不算。
 * 只认位置，不排版、不改字（排版在界面里用 KaTeX）。
 */

export interface MathSpan {
  /** 整段（连两头的记号）在文字里的 [from, to) */
  from: number
  to: number
  /** 两头记号的长度（`$` 1，`$$`、`\(`、`\[` 2） */
  open: number
  close: number
  /** 记号里面的 LaTeX（去掉两头空白） */
  tex: string
  /** `$$`、`\[`：按单独一行的公式排（displayMode） */
  display: boolean
  /** 单独占一行或几行（前后没有别的字）：画成居中的一整块 */
  block: boolean
  /** 引文里单独成行的：每行行首的「> 」（`from` 在它后面，中间几行的照样在 [from, to) 里，`tex` 里去掉了） */
  quote?: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/

/** pos 前面紧挨着几个反斜杠是单数（这个字被转义了） */
function escaped(s: string, pos: number): boolean {
  let n = 0
  for (let i = pos - 1; i >= 0 && s[i] === '\\'; i--) n++
  return n % 2 === 1
}

const space = (c: string | undefined) => c === undefined || /\s/.test(c)

/** 一行里不算公式的几段：行内代码（反引号数一样的一对）、HTML 注释 */
function masked(line: string): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < line.length; ) {
    if (line[i] === '`' && !escaped(line, i)) {
      let n = 1
      while (line[i + n] === '`') n++
      const run = '`'.repeat(n)
      let j = line.indexOf(run, i + n)
      while (j !== -1 && (line[j + n] === '`' || line[j - 1] === '`')) j = line.indexOf(run, j + 1)
      if (j === -1) {
        i += n
        continue
      }
      out.push([i, j + n])
      i = j + n
    } else if (line.startsWith('<!--', i)) {
      const j = line.indexOf('-->', i + 4)
      const end = j === -1 ? line.length : j + 3
      out.push([i, end])
      i = end
    } else i++
  }
  return out
}

/** 从 from 起找下一个没转义的 close（不跨 limit） */
function findClose(s: string, close: string, from: number, limit: number): number {
  for (let j = s.indexOf(close, from); j !== -1 && j + close.length <= limit; j = s.indexOf(close, j + 1)) if (!escaped(s, j)) return j
  return -1
}

/**
 * 一行里的行内公式（位置相对这一行）。block：这一行只有这一个公式（前后只有空白）时标出来。
 * 白板卡片、AI 回答的 md-render 按行调这个
 */
export function inlineMath(line: string): MathSpan[] {
  const out: MathSpan[] = []
  const skip = masked(line)
  let k = 0
  for (let i = 0; i < line.length; ) {
    while (k < skip.length && skip[k]![1] <= i) k++
    if (k < skip.length && skip[k]![0] <= i) {
      i = skip[k]![1]
      continue
    }
    const limit = k < skip.length ? skip[k]![0] : line.length
    const c = line[i]
    if (c === '\\') {
      const n = line[i + 1]
      if ((n === '(' || n === '[') && !escaped(line, i)) {
        const close = n === '(' ? '\\)' : '\\]'
        const j = findClose(line, close, i + 2, limit)
        const tex = j === -1 ? '' : line.slice(i + 2, j).trim()
        if (tex) {
          out.push({ from: i, to: j + 2, open: 2, close: 2, tex, display: n === '[', block: false })
          i = j + 2
          continue
        }
      }
      i += 2
      continue
    }
    if (c !== '$') {
      i++
      continue
    }
    if (line[i + 1] === '$') {
      const j = findClose(line, '$$', i + 2, limit)
      const tex = j === -1 ? '' : line.slice(i + 2, j).trim()
      if (tex) {
        out.push({ from: i, to: j + 2, open: 2, close: 2, tex, display: true, block: false })
        i = j + 2
      } else i += 2
      continue
    }
    // $…$：开头后面不是空白，结尾前面不是空白、后面不是数字；中间没有没转义的 $
    const j = space(line[i + 1]) ? -1 : findClose(line, '$', i + 1, limit)
    if (j !== -1 && !space(line[j - 1]) && !/[0-9]/.test(line[j + 1] ?? '')) {
      out.push({ from: i, to: j + 1, open: 1, close: 1, tex: line.slice(i + 1, j), display: false, block: false })
      i = j + 1
    } else i++
  }
  if (out.length === 1 && !line.slice(0, out[0]!.from).trim() && !line.slice(out[0]!.to).trim() && out[0]!.display) out[0]!.block = true
  return out
}

const BLOCK_OPEN = /^(\s*)(\$\$|\\\[)(.*)$/

/**
 * 从第 i 行开始的单独成行的公式：`$$` 或 `\[` 开头的一行，到 `$$` / `\]` 结尾的一行（可以是同一行），中间没有空行。
 * 返回最后一行是第几行、去掉两头记号的 LaTeX；不是就是 null
 */
export function mathBlockAt(lines: readonly string[], i: number): { end: number; tex: string; indent: number } | null {
  const m = BLOCK_OPEN.exec(lines[i] ?? '')
  if (!m) return null
  const close = m[2] === '$$' ? '$$' : '\\]'
  const ends = (s: string) => {
    const t = s.trimEnd()
    return t.endsWith(close) && !escaped(t, t.length - close.length)
  }
  const first = m[3]!
  // 一行写完：$$…$$（中间不能再有 $$，「$$a$$ 和 $$b$$」是一行里的两个行内公式）
  if (ends(first) && first.trimEnd().length >= close.length) {
    const tex = first.trimEnd().slice(0, -close.length)
    if (tex.includes(close) || !tex.trim()) return null
    return { end: i, tex: tex.trim(), indent: m[1]!.length }
  }
  if (first.includes(close)) return null
  const body = [first]
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k]!
    if (!l.trim()) return null
    if (ends(l)) {
      const last = l.trimEnd().slice(0, -close.length)
      if (last.includes(close)) return null
      body.push(last)
      const tex = body.join('\n').trim()
      return tex ? { end: k, tex, indent: m[1]!.length } : null
    }
    if (l.includes(close)) return null
    body.push(l)
  }
  return null
}

/** 行首的引文记号（「> 」「> > 」，一层前面最多 3 个空格） */
const QUOTE_MARK = /^(?: {0,3}>[ \t]?)+/
const quoteOf = (line: string) => QUOTE_MARK.exec(line)?.[0] ?? ''
/** 引文的层数（「> > 」两层）：同一段引文要层数一样 */
const depth = (q: string) => q.replace(/[^>]/g, '').length

/** 整篇里的公式（位置相对整篇），按先后排好 */
export function findMath(text: string): MathSpan[] {
  const out: MathSpan[] = []
  const fm = FRONTMATTER.exec(text)
  let pos = fm ? fm[0].length : 0
  const lines = text.slice(pos).split('\n')
  const starts: number[] = []
  for (const l of lines) {
    starts.push(pos)
    pos += l.length + 1
  }
  let fence: string | null = null
  /** 代码块开在第几层引文里（引文断了代码块也跟着断，不吞掉引文外面的） */
  let fenceDepth = 0
  let comment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const q = quoteOf(line)
    const body = line.slice(q.length)
    if (fence && fenceDepth > 0 && depth(q) !== fenceDepth) fence = null
    const f = FENCE.exec(body)
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && !body.slice(f[0].length).trim()) fence = null
      continue
    }
    if (f) {
      fence = f[1]!
      fenceDepth = depth(q)
      continue
    }
    // 跨行的 HTML 注释（白板的位置行都在一行里；这里管的是手写的多行注释）
    if (comment) {
      if (line.includes('-->')) comment = false
      continue
    }
    if (/^\s*<!--/.test(line) && !line.includes('-->')) {
      comment = true
      continue
    }
    // 引文里的：同一层引文接着的几行去掉「> 」再认
    let b: ReturnType<typeof mathBlockAt> = null
    if (!q) b = mathBlockAt(lines, i)
    else if (BLOCK_OPEN.test(body)) {
      const quoted: string[] = []
      for (let k = i; k < lines.length; k++) {
        const qk = quoteOf(lines[k]!)
        if (!qk || depth(qk) !== depth(q)) break
        quoted.push(lines[k]!.slice(qk.length))
      }
      b = mathBlockAt(quoted, 0)
    }
    if (b) {
      const end = q ? i + b.end : b.end
      const from = starts[i]! + q.length + b.indent
      const lastLine = lines[end]!.trimEnd()
      const to = starts[end]! + lastLine.length
      out.push({ from, to, open: 2, close: 2, tex: b.tex, display: true, block: true, ...(q ? { quote: q } : {}) })
      i = end
      continue
    }
    for (const s of inlineMath(line)) out.push({ ...s, from: starts[i]! + s.from, to: starts[i]! + s.to })
  }
  return out
}

/** 把文字里的公式换成别的写法（导出给 Anki：`\(…\)`、`\[…\]`），别的字交给 rest 处理 */
export function mapMath(text: string, math: (s: MathSpan) => string, rest: (t: string) => string = (t) => t): string {
  let out = ''
  let last = 0
  for (const s of findMath(text)) {
    const m = math(s)
    out += rest(text.slice(last, s.from)) + (s.quote ? m.replace(/\n/g, `\n${s.quote}`) : m)
    last = s.to
  }
  return out + rest(text.slice(last))
}
