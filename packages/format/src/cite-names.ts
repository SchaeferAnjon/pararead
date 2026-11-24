/**
 * AI 回答里没写成链接、但提到了库里东西的地方（task-3e53q，设计页「二、a」后半，用户 2026-11-23 定「先按推荐做，设置里能关」）。
 * 只是兜底：系统提示已经让 AI 写成 [字](路径)，这里认它漏写的。两种：
 * - 写了路径（命令行的习惯）：`课程/小论文计划.md`、/Users/…/库/课程/小论文计划.md、课程/小论文计划.md:42、…#L42。
 *   库里找得到的认成链接；写的是库里的绝对路径、或带文件夹的路径却找不到，也认成链接（卡上照实说「库里没找到这一篇」，不静默丢）。
 * - 光写了笔记名 / PDF 名（「按名字认」，设置里能关）。防认错：
 *   只认整个名字（中文 3 个字以上、英文 4 个字母以上，英文前后不能紧挨字母数字）；库里同名只有一篇才认；
 *   这一轮 AI 读过、搜到过的文件优先认，没碰过的只在《》「」“”"" 包着时认；常见名不认（还有用户在设置里加的）；
 *   这段对话里点过「不是这篇」的名字不认；一条回答里同一个名字只认第一次。
 *   代码、公式、已经是链接的、标题里的不认：调用的地方只把正文里的字交过来。
 * 纯函数，不碰 DOM、不依赖 Electron（iPad 版照着移植）。
 */
import { type CiteCtx, citeOf, citeOfWiki, colonLines } from './cite'

/** 太常见、认了多半是错的名字（比大小写）；用户在设置里加的接在后面 */
// 真库里撞名的就是这类：3 篇「第一条」、2 篇「未命名」、旁支里的「计划」（2026-11-23 数的）
export const COMMON_NAMES: readonly string[] = ['笔记', '计划', '待办', '日记', '收件箱', '首页', '草稿', '未命名', '无标题', '新笔记', '新建笔记', '第一条', '第二条', '第三条', '摘要', '总结', '学习笔记', '读书笔记', 'README', 'index', 'notes', 'note', 'todo', 'inbox', 'draft', 'untitled', 'home', 'test', 'plan', 'summary']

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const WORD = /[A-Za-z0-9_]/

/** 够不够长：带中日韩字的数字（去掉空白和标点）3 个以上，不带的数英文字母 4 个以上 */
export function longEnough(name: string): boolean {
  if (CJK.test(name)) return [...name.replace(/[\s\p{P}\p{S}]/gu, '')].length >= 3
  return (name.match(/[A-Za-z]/g) ?? []).length >= 4
}

interface Entry {
  low: string
  path: string
  /** 带扩展名的整个文件名（「J52 SAGE.pdf」「第3讲 笔记.md」）：写的是文件名，按路径认（不看设置、不用包着） */
  file: boolean
}

/**
 * 库里能按名字认的：笔记名（不带 .md）、PDF 名（不带 .pdf），和带扩展名的整个文件名（带空格的文件名在正文里切不出路径，靠它认）；
 * 同名的、太短的、常见的去掉
 */
export interface NameIndex {
  /** 名字（小写）一个字一个字排成的树：从回答里某个字往下走，走过的每个名字都是在这里开头的（几千篇的库、几万字的回答也只走名字那么长） */
  root: Node
  /** 路径里带空格的文件（小写），按最后一个空格或 / 后面那截分：正文里切到「2/小论文计划.md」时，只有这里有对得上的才往左找 */
  spaced: ReadonlyMap<string, readonly string[]>
}

interface Node {
  kids: Map<string, Node>
  entry?: Entry
}

export function nameIndex(files: readonly string[], common: readonly string[] = []): NameIndex {
  const skip = new Set([...COMMON_NAMES, ...common].map((x) => x.trim().toLowerCase()).filter(Boolean))
  const all = new Map<string, Entry[]>()
  const add = (name: string, path: string, file: boolean) => {
    const low = name.toLowerCase()
    const list = all.get(low) ?? []
    if (!list.some((e) => e.path === path)) list.push({ low, path, file })
    all.set(low, list)
  }
  for (const f of files) {
    const base = f.slice(f.lastIndexOf('/') + 1)
    if (!/\.(md|pdf)$/i.test(base)) continue
    add(base, f, true)
    add(base.replace(/\.(md|pdf)$/i, ''), f, false)
  }
  const spaced = new Map<string, string[]>()
  for (const f of files) {
    if (!f.includes(' ')) continue
    const low = f.toLowerCase()
    // 按最后一个空格后面那截分（正文里切到的就是这一截：「SAGE.pdf」「小论文计划.md」）
    const base = low.slice(Math.max(low.lastIndexOf('/'), low.lastIndexOf(' ')) + 1)
    spaced.set(base, [...(spaced.get(base) ?? []), low])
  }
  const root: Node = { kids: new Map() }
  for (const [low, list] of all) {
    // 同名不猜
    if (list.length !== 1 || skip.has(low.replace(/\.(md|pdf)$/i, '')) || !longEnough(low)) continue
    let n = root
    for (const ch of low) {
      let k = n.kids.get(ch)
      if (!k) n.kids.set(ch, (k = { kids: new Map() }))
      n = k
    }
    n.entry = list[0]!
  }
  return { root, spaced }
}

/** 从 low 的第 i 个字开头的名字，长的在前 */
function namesAt(index: NameIndex, low: string, i: number): Entry[] {
  const out: Entry[] = []
  let n: Node | undefined = index.root
  for (let j = i; j < low.length && n; j++) {
    n = n.kids.get(low[j]!)
    if (n?.entry) out.push(n.entry)
  }
  return out.reverse()
}

/** 一条回答认的时候要的 */
export interface CiteRun {
  /** 认路径用（库根、库里所有文件） */
  ctx: CiteCtx
  index: NameIndex
  /** 按名字认（设置里能关；关了路径、整个文件名照样认） */
  names: boolean
  /** 这一轮 AI 读过、搜到过的文件（库里的相对路径） */
  touched: ReadonlySet<string>
  /** 这段对话里点过「不是这篇」的名字（小写） */
  rejected: ReadonlySet<string>
  /** 这一条回答里已经认过的名字（小写）：同一个名字只认第一次。调用的地方一条回答给一个，这里往里加 */
  seen: Set<string>
}

/** 为什么认成链接：path 写的是路径；touched 这一轮读过、搜到过；quoted 名字用书名号、引号包着 */
export type AutoWhy = 'path' | 'touched' | 'quoted'

export interface AutoCite {
  from: number
  to: number
  /** 写进 data-href 的：写的路径原样（点的时候 citeOf 再认一遍），按名字认的是库里的路径 */
  href: string
  why: AutoWhy
  /** 按名字认的：认的那个名字（「不是这篇」记它） */
  name?: string
}

const QUOTES: Record<string, string> = { '《': '》', '「': '」', '“': '”', '"': '"', '『': '』' }

/** 纯文字里像路径的一截：可以带 / 或 ~ 开头，最后一节是 .md / .pdf，后面可以跟 :42、#L42、#page=4 这些（路径里不许有空白和中文标点） */
const PATH_IN_TEXT = /(?:~\/|\/)?(?:[^\s/()（）[\]<>「」《》“”"'`，。；：、！？]+\/)*[^\s/()（）[\]<>「」《》“”"'`，。；：、！？]+\.(?:md|pdf)(?::L?\d+(?:-L?\d+)?(?::\d+)?|#(?:L\d+(?:-L?\d+)?|page=\d+(?:&rect=[\d.,]+)?|\^[\w-]+))?(?![A-Za-z0-9])/giu

/** 写的这个路径在库里找得到（笔记、PDF、别的文件） */
const found = (written: string, ctx: CiteCtx) => {
  const k = citeOf(written, ctx).kind
  return k === 'note' || k === 'pdf' || k === 'file'
}

/** 写的这一整段就是库里那个文件（不是按文件名兜底找到的）：「cat 课程/x.md」「project 2/x.md」「原文 /Users/…/x.md」不算 */
function exactFound(written: string, ctx: CiteCtx): boolean {
  const c = citeOf(written, ctx)
  if (c.kind !== 'note' && c.kind !== 'pdf' && c.kind !== 'file') return false
  const bare = (colonLines(written)?.path ?? written).replace(/#.*$/, '').toLowerCase()
  const p = c.path.toLowerCase()
  return bare === p || ((bare.startsWith('/') || bare.startsWith('~')) && bare.endsWith('/' + p))
}

/** 往左数几个词（文件夹名里带空格：「课程/study project 2/小论文计划.md」）：碰到这些字、换行就停 */
const STOP = /[\n*`()（）[\]<>「」《》“”"'，。；：、！？]/

/**
 * 写的一个路径（不带链接）认不认：库里找得到的认；找不到时，写的是库里的绝对路径（~/… 也算）或带文件夹的相对路径
 * （一看就是指库里某一篇）也认，卡上照实说没找到；光一个文件名找不到的、库外的不认
 */
export function pathCite(written: string, ctx: CiteCtx): boolean {
  const w = written.trim()
  const c = citeOf(w, ctx)
  if (c.kind === 'note' || c.kind === 'pdf' || c.kind === 'file') return true
  // 库外的绝对路径是 outside；missing 的绝对路径一定在库里
  if (c.kind !== 'missing') return false
  const bare = (colonLines(w)?.path ?? w).replace(/#.*$/, '')
  return bare.startsWith('/') || bare.startsWith('~') || (bare.includes('/') && !bare.startsWith('..'))
}

/** 中日韩字和英文的边界：英文名字前后不能紧挨字母数字（「Plan」不认「Planning」里那截） */
function bounded(text: string, from: number, to: number, name: string): boolean {
  if (WORD.test(name[0]!) && WORD.test(text[from - 1] ?? '')) return false
  if (WORD.test(name[name.length - 1]!) && WORD.test(text[to] ?? '')) return false
  // 路径的一截（「课程/小论文计划」「小论文计划.md」）交给认路径的那一步
  if (text[from - 1] === '/' || text[to] === '/' || (text[to] === '.' && /^[A-Za-z]/.test(text[to + 1] ?? ''))) return false
  return true
}

/** 一段正文里的字（不含代码、公式、链接、标题）里认出来的，按先后 */
export function findAutoCites(text: string, run: CiteRun): AutoCite[] {
  const out: AutoCite[] = []
  // 先认路径
  const taken: [number, number][] = []
  for (const m of text.matchAll(PATH_IN_TEXT)) {
    let from = m.index!
    const to = from + m[0].length
    // 路径里有空格（正文里切到的是「2/小论文计划.md」）：往左一个词一个词加上，整段是库里那个文件的取最长的
    const bareLow = (colonLines(m[0])?.path ?? m[0]).replace(/#.*$/, '').toLowerCase()
    const tail = bareLow.slice(bareLow.lastIndexOf('/') + 1)
    if (!/^[/~]/.test(m[0]) && run.index.spaced.get(tail)?.some((p) => p.endsWith(bareLow) && p.length > bareLow.length)) {
      let best = -1
      for (let p = from - 1, words = 0; p >= 0 && words < 6 && from - p < 120; p--) {
        const ch = text[p]!
        if (STOP.test(ch)) break
        if (ch !== ' ') continue
        words++
        const start = p + 1
        if (start < from && /^\S/.test(text.slice(start, from)) && exactFound(text.slice(start, to), run.ctx)) best = start
        // 一个词前面再挨着一个词：接着往左
      }
      // 行首那个词
      let p0 = from
      while (p0 > 0 && !STOP.test(text[p0 - 1]!) && from - p0 < 120) p0--
      if (p0 < from && text[p0] !== ' ' && (best === -1 || p0 < best) && text.slice(p0, from).includes(' ') && exactFound(text.slice(p0, to), run.ctx)) best = p0
      if (best !== -1) from = best
    }
    if (from === m.index! && !pathCite(m[0], run.ctx)) {
      // 中文里不空格：「在小论文计划.md里」认成了「在小论文计划.md」。前面的汉字一个个去掉，找得到的那个才算
      let k = 1
      while (k < m[0].length && CJK.test(m[0][k - 1]!) && !found(m[0].slice(k), run.ctx)) k++
      if (k >= m[0].length || !CJK.test(m[0][k - 1]!)) continue
      from += k
    }
    out.push({ from, to, href: text.slice(from, to), why: 'path' })
    taken.push([from, to])
  }
  {
    const low = text.toLowerCase()
    for (let i = 0; i < text.length; i++) {
      if (taken.some(([a, b]) => i >= a && i < b)) continue
      for (const e of namesAt(run.index, low, i)) {
        const to = i + e.low.length
        if (taken.some(([a, b]) => a < to && b > i) || !bounded(text, i, to, e.low)) continue
        if (e.file) {
          out.push({ from: i, to, href: e.path, why: 'path' })
          i = to - 1
          break
        }
        // 最长的那个名字占着这个地方：认不认都不再试短的（不认名字的一半）
        if (!run.names || run.rejected.has(e.low) || run.seen.has(e.low)) break
        const close = QUOTES[text[i - 1] ?? '']
        const why: AutoWhy | null = run.touched.has(e.path) ? 'touched' : close && text[to] === close ? 'quoted' : null
        if (!why) break
        run.seen.add(e.low)
        out.push({ from: i, to, href: e.path, why, name: text.slice(i, to) })
        i = to - 1
        break
      }
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

/**
 * AI 自己写成链接的那一篇：名字记进 seen，这条回答后面光写它名字的不再认（真 Claude Code 写了
 * 「[SAGE 读书笔记](…)」，下一行「只有标题「SAGE 读书笔记」」又被认成一个链接，多余）
 */
export function linkedSeen(link: { href?: string; wiki?: string }, run: CiteRun) {
  const c = link.wiki !== undefined ? citeOfWiki(link.wiki, run.ctx) : citeOf(link.href ?? '', run.ctx)
  if (c.kind !== 'note' && c.kind !== 'pdf') return
  const base = c.path.slice(c.path.lastIndexOf('/') + 1).toLowerCase()
  run.seen.add(base.replace(/\.(md|pdf)$/i, ''))
  run.seen.add(base)
}

/**
 * 一整段行内代码（`课程/小论文计划.md`、`/Users/…/x.md:42`）是不是库里的一个路径：是就整段认成链接（样子还是代码）。
 * 代码里的名字不按名字认
 */
export function codeCite(code: string, ctx: CiteCtx): string | null {
  const w = code.trim()
  if (!w || w.includes('\n') || !/\.(md|pdf)(?::L?\d+(?:-L?\d+)?(?::\d+)?|#\S*)?$/i.test(w)) return null
  // 带空格的（「课程/study project 2/x.md」）只认整段就是库里那个文件的：「cat 课程/x.md」（按文件名也找得到）这种命令不算
  if (/\s/.test(w)) return exactFound(w, ctx) ? w : null
  return pathCite(w, ctx) ? w : null
}
