/**
 * AI 回答里的引用（task-3e53q）：回答里写的 [字](链接)、[[双链]] 指的是库里的哪样东西、到哪一行 / 哪一段 / 哪一页，
 * AI 对话、旁支、讲解卡、白板卡里点它（预览卡、⌘点打开）都按这里认。
 * 认法：
 * - 网址（http、https）原样；带 #:~:text= 的是网页里的一段；
 * - canvas-notes://chat?… 是「回到 AI 对话」；canvas-notes://commit/<提交号> 是历史里的一次提交；
 * - 库里的文件：先按写的地方（base，这篇笔记所在的文件夹）认，再按库根目录认（AI 的工作目录是库根目录，它写的路径多半相对库根），
 *   绝对路径、~/…、file:// 在库里的去掉库的那截（/private/tmp 和 /tmp 算一处）；没写 .md 的补上；都找不到按文件名在全库找（只有一篇同名的才算）；
 * - # 后面：PDF 的 page=N&rect=…；笔记的 L12、L12-L20（行号从文件第一行数起，和 AI 读文件时看到的一样）、^块号、标题；
 *   命令行常写的「路径:42」「路径:42-50」「路径:42:7」（行:列）也认成几行。
 * 纯函数，不碰 DOM、不依赖 Electron（iPad 版照着移植）。
 */
import { headingKey, outline } from './passages'
import { attr, content, parseBoard } from './board'
import { resolveLink } from './blocks'
import { splitDoc, unitId } from './doc-board'
import { parsePdfAnchor, type Rect } from './pdf-link'

/** 笔记里的哪一处：几行（1 起，含 frontmatter）、某个标题下、某个块（^id） */
export type CiteAnchor = { line: number; end: number } | { heading: string } | { block: string }

export type Cite =
  | { kind: 'note'; path: string; anchor?: CiteAnchor }
  /** page：链接里写了第几页才有（光一个 PDF 不翻页，开在上次看到的地方） */
  | { kind: 'pdf'; path: string; page?: number; rect?: Rect; text?: string }
  /** 别的库里文件（HTML、图片……）：按类型开 */
  | { kind: 'file'; path: string }
  | { kind: 'web'; url: string }
  | { kind: 'chat'; key: string; msg: number }
  /** 历史里的一次提交（canvas-notes://commit/3f9a2c1）：⌘点开对比标签看这次改动 */
  | { kind: 'commit'; hash: string }

/** 认不出时为什么（预览卡上照实说） */
export type CiteMiss = { kind: 'missing'; label: string } | { kind: 'outside'; path: string }

export interface CiteCtx {
  /** 写着这个链接的笔记（库里的路径）；AI 回答没有，给空串 = 库根目录 */
  base: string
  /** 库在这台机器上的绝对路径（认 AI 写的绝对路径） */
  root: string
  /** 库里所有文件（相对库根，/ 分隔） */
  files: readonly string[]
  /** 这台机器的家目录（认 AI 写的 ~/…）；不给就不认 ~ */
  home?: string
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** 库里的文件查表（同一份文件名单只做一次：回答里认路径、按名字认时一条回答要查几十次） */
const tables = new WeakMap<readonly string[], { have: Set<string>; lower: Map<string, string>; byName: Map<string, string[]> }>()
function tableOf(files: readonly string[]) {
  let t = tables.get(files)
  if (!t) {
    const byName = new Map<string, string[]>()
    for (const f of files) {
      const n = baseName(f).toLowerCase()
      byName.set(n, [...(byName.get(n) ?? []), f])
    }
    t = { have: new Set(files), lower: new Map(files.map((f) => [f.toLowerCase(), f])), byName }
    tables.set(files, t)
  }
  return t
}

/** 写着的路径 → 库里在的那个文件；找不到是 null */
function findFile(written: string, ctx: CiteCtx): string | null {
  const { have, lower, byName } = tableOf(ctx.files)
  const tries: string[] = []
  const add = (p: string | null) => {
    if (!p) return
    tries.push(p)
    if (!/\.[a-z0-9]{1,5}$/i.test(baseName(p))) tries.push(p + '.md')
  }
  // 相对写的地方、相对库根（resolveLink 认的是「笔记里的相对链接」：库根那一次假装写在库根的一篇里）
  if (ctx.base) add(resolveLink(ctx.base, written))
  add(resolveLink('_', written))
  for (const t of tries) {
    if (have.has(t)) return t
    const ci = lower.get(t.toLowerCase())
    if (ci) return ci
  }
  // 按文件名全库找：只认唯一的一篇（两篇同名就不猜）
  const name = baseName(tries[0] ?? written).toLowerCase()
  const names = [name, /\.[a-z0-9]{1,5}$/i.test(name) ? '' : name + '.md'].filter(Boolean)
  const same = names.flatMap((n) => byName.get(n) ?? [])
  return same.length === 1 ? same[0]! : null
}

/** # 后面那截（已解码）→ 笔记里的哪一处 */
export function noteAnchorOf(hash: string): CiteAnchor | undefined {
  const h = hash.trim()
  if (!h) return undefined
  const lines = /^L(\d+)(?:\s*[-–~]\s*L?(\d+))?$/i.exec(h)
  if (lines) {
    const a = Number(lines[1])
    const b = lines[2] ? Number(lines[2]) : a
    if (a >= 1) return { line: Math.min(a, b), end: Math.max(a, b) }
  }
  if (h.startsWith('^')) return h.length > 1 ? { block: h.slice(1) } : undefined
  return { heading: h }
}

function fileCite(path: string, hash: string): Cite {
  if (/\.pdf$/i.test(path)) {
    const a = /(^|&)page=\d+(&|$)/.test(hash) ? parsePdfAnchor(`x.pdf#${hash}`) : null
    return { kind: 'pdf', path, ...(a ? { page: a.page } : {}), ...(a?.rect ? { rect: a.rect } : {}), ...(a?.text ? { text: a.text } : {}) }
  }
  if (/\.md$/i.test(path)) {
    const anchor = noteAnchorOf(decode(hash))
    return { kind: 'note', path, ...(anchor ? { anchor } : {}) }
  }
  return { kind: 'file', path }
}

/** macOS 上 /tmp、/var、/etc 是 /private/… 的替身：两种写法算一处 */
const unPrivate = (p: string) => p.replace(/^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/, '')

/** 「路径:42」「路径:42-50」「路径:L42」「路径:42:7」（行:列，命令行和编辑器常这样写）→ 路径、L42-L50；不是这样写的原样 */
export function colonLines(path: string): { path: string; hash: string } | null {
  const m = /^(.+\.[a-z0-9]{1,8}):L?(\d+)(?:(?:\s*[-–~]\s*L?(\d+))|:\d+)?$/i.exec(path)
  if (!m) return null
  return { path: m[1]!, hash: m[3] ? `L${m[2]}-L${m[3]}` : `L${m[2]}` }
}

/** [字](href) 的 href 指的是什么；label 是链接的字（找不到时说） */
export function citeOf(href: string, ctx: CiteCtx, label = ''): Cite | CiteMiss {
  const url = href.trim().replace(/^<(.*)>$/, '$1')
  if (/^https?:\/\//i.test(url)) return { kind: 'web', url }
  const chat = /^canvas-notes:\/\/chat\?key=([^&\s]+)&msg=(\d+)$/.exec(url)
  if (chat) return { kind: 'chat', key: decode(chat[1]!), msg: Number(chat[2]) }
  const commit = /^canvas-notes:\/\/commit\/([0-9a-f]{7,40})\/?$/i.exec(url)
  if (commit) return { kind: 'commit', hash: commit[1]!.toLowerCase() }
  const hashAt = url.indexOf('#')
  let path = hashAt === -1 ? url : url.slice(0, hashAt)
  let hash = hashAt === -1 ? '' : url.slice(hashAt + 1)
  if (/^file:\/\//i.test(path)) path = decode(path.replace(/^file:\/\/(localhost)?/i, ''))
  const colon = hash ? null : colonLines(path)
  if (colon) ({ path, hash } = colon)
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return { kind: 'missing', label: label || url }
  if (path.startsWith('/') || path.startsWith('~')) {
    let p = decode(path)
    const home = ctx.home?.replace(/\/+$/, '')
    if (p === '~' || p.startsWith('~/')) {
      if (!home) return { kind: 'outside', path: p }
      p = home + p.slice(1)
    }
    p = unPrivate(p)
    const root = unPrivate(ctx.root.replace(/\/+$/, ''))
    if (!root || !p.startsWith(root + '/')) return { kind: 'outside', path: p }
    path = p.slice(root.length + 1)
  }
  if (!path) return { kind: 'missing', label: label || url }
  const file = findFile(path, ctx)
  return file ? fileCite(file, hash) : { kind: 'missing', label: label || decode(path) }
}

/** [[双链]] 中间那截（名字#标题|别名）指的是什么：按名字（不带 .md）或路径找，PDF 写全名 */
export function citeOfWiki(inner: string, ctx: CiteCtx): Cite | CiteMiss {
  const bar = inner.indexOf('|')
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
  const hashAt = target.indexOf('#')
  const name = (hashAt === -1 ? target : target.slice(0, hashAt)).trim()
  const hash = hashAt === -1 ? '' : target.slice(hashAt + 1)
  if (!name) return { kind: 'missing', label: inner }
  const low = name.toLowerCase()
  const hit =
    ctx.files.find((f) => f.toLowerCase() === low || f.toLowerCase() === low + '.md') ??
    ctx.files.find((f) => /\.md$/i.test(f) && baseName(f).slice(0, -3).toLowerCase() === low) ??
    ctx.files.find((f) => baseName(f).toLowerCase() === low)
  if (!hit) return { kind: 'missing', label: name }
  // 双链里的 #第4页 / #page=4 不认成页码，PDF 照 parsePdfAnchor 认 page=
  return fileCite(hit, hash)
}

/** 引用到的那几行（1 起，含首尾）；标题：标题那一行到它下面第一段末尾；块：^id 所在的那一段 */
export function anchorLines(text: string, anchor: CiteAnchor): { from: number; to: number } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const n = lines.length
  const blank = (i: number) => !lines[i] || !lines[i]!.trim()
  if ('line' in anchor) {
    if (anchor.line > n) return null
    return { from: anchor.line, to: Math.min(anchor.end, n) }
  }
  /** 第 i 行（0 起）所在那一段的起止（0 起） */
  const para = (i: number) => {
    let a = i
    let b = i
    while (a > 0 && !blank(a - 1)) a--
    while (b < n - 1 && !blank(b + 1)) b++
    return { a, b }
  }
  if ('block' in anchor) {
    // 列表里的一项、引用块：只到那一项（几项之间没有空行时，按空行分段会把整个列表当一段）
    const ps = outline(text.replace(/\r\n/g, '\n')).passages.find((x) => x.id === anchor.block)
    if (ps) return { from: ps.line + 1, to: ps.end + 1 }
    const re = new RegExp(`(^|\\s)\\^${anchor.block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
    const i = lines.findIndex((l) => re.test(l))
    if (i === -1) return null
    const p = para(i)
    return { from: p.a + 1, to: p.b + 1 }
  }
  const want = anchor.heading.replace(/\s+/g, ' ').trim().toLowerCase()
  const headAt = (same: (h: string) => boolean) =>
    lines.findIndex((l) => {
      const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l)
      return !!m && same(m[1]!)
    })
  // 先比原字；没有再不管空白和标点比（标题末尾带「52:56」这种时间戳、全角半角括号不一样时也认，梦游 Wiki 化 W.5）
  let i = headAt((h) => h.replace(/\s+/g, ' ').trim().toLowerCase() === want)
  if (i === -1 && headingKey(want)) i = headAt((h) => headingKey(h) === headingKey(want))
  if (i === -1) return null
  let j = i + 1
  while (j < n && blank(j)) j++
  if (j >= n || /^#{1,6}\s/.test(lines[j]!)) return { from: i + 1, to: i + 1 }
  return { from: i + 1, to: para(j).b + 1 }
}

/**
 * 白板里的一张卡（AI 写的「白板.md#^卡号」）：卡号是位置行、编号行（<!-- card id=c7 … -->）上的 id，
 * 返回那张卡的原文（不带位置行）；这一篇里没有这张卡是 null（那就当普通笔记的 ^块号 认）
 */
export function boardCardOf(text: string, id: string): string | null {
  if (!id || !new RegExp(`<!--\\s*card\\b[^\\n]*\\bid=("?)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1(\\s|-->)`).test(text)) return null
  const board = splitDoc(text)
  const u = [...board.columns.flatMap((c) => c.cards), ...board.placed].find((x) => unitId(x) === id)
  if (u) return u.text.trim()
  const b = parseBoard(text).blocks.find((x) => x.kind === 'card' && attr(x, 'id') === id)
  return b ? content(b).trim() : null
}
