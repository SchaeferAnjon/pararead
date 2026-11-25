/**
 * 两台设备（Mac 和 iPhone）同时改了一篇，Git 同步时按段合并（task-q4mzb，规则来自用户定的原型 proto-merge.html 和
 * 07-手机版说明里「Git 冲突按段合并」一节）：改的是不同段就各留各的；只有两边改了同一段的同一句，原文用 keep 那边的，
 * 另一边那版另存一篇副本（deviceCopyName），同步照常往下走。
 *
 * 输入是 decodeNote 过的文字（只有 \n）。规矩：
 * 1. 快路：local === remote 用 local；local === base 用 remote；remote === base 用 local（原样，没有副本）。
 * 2. 切段（splitParagraphs）：一段 = 一串连着的非空行 + 后面跟着的空行（空行 = /^[ \t]*$/）；最前面的空行自成一段。
 *    各段首尾相接正好是原文。比较用的键 = 段的文字去掉末尾空白。
 * 3. 挪段（carryMoves）：一边把一段原封不动挪到别处，另一边在原位置一对一改了这段的字：用挪的那边的位置、改的那边的字。
 * 4. 按段的键三方合并（align，diff3 的找法）。两边都改了的一处：键一样就用它；base 那边是空的（两边在同一处各插了段）
 *    都留下、keep 那边在前；段数和 base 一样逐段比（一边没动用另一边，两边都改了才按句合并）；段数不一样整处按句合并。
 * 5. 按句合并（splitSentences）：一句到句末标点（连同后面的右引号括号）或换行为止；同一句两边都改了才算冲突：
 *    原文用 keep 那边的，副本用另一边的，conflicts 记一条。
 * 6. 拼回去：一段后面又接了别的段、它又不是以空行结尾时补成一个空行；文末的空白照三方合并（末尾有没有换行照旧）。
 *
 * 和 node-diff3 的 diff3MergeRegions 只差一处：两处改动只是挨着（一边改第 3 句、一边改第 4 句；一边改最后一段、一边在文末
 * 加一段）不算碰上，各合各的；范围有重叠、插在别人改的范围里面、两边插在同一处才算同一处。
 * 这一份是 iPhone / iPad 原生版的对照：apps/apple/CanvasCore/Sources/CanvasCore/Format/ParaMerge.swift 一比一移植，
 * 改这里要两边一起改（format-fixtures 对照测试会红）。
 */
import { diffIndices } from 'node-diff3'
import { mergeInk } from './ink'

export interface ParaConflict {
  /** base 里这一处的原文（去掉末尾空白） */
  base: string
  /** 原文（text）里这一处：keep 那边的（去掉末尾空白） */
  kept: string
  /** 副本（copy）里这一处：另一边的（去掉末尾空白） */
  other: string
}

export interface ParaMergeResult {
  /** 合好的原文：两边改了同一句的地方用 keep 那一边 */
  text: string
  /** 有冲突时：同样合好、但冲突处用另一边的（另存成副本）；没冲突是 null */
  copy: string | null
  conflicts: ParaConflict[]
}

const BLANK = /^[ \t]*$/
/** 句末标点；后面跟着的右引号、右括号算在这一句里 */
const END = '。！？!?；;…'
const CLOSE = '”’」』）】'

/** 切段：一串连着的非空行 + 后面跟着的空行；最前面的空行自成一段。各段首尾相接正好是原文 */
export function splitParagraphs(text: string): string[] {
  const out: string[] = []
  let start = 0
  let prevBlank = false
  for (let pos = 0; pos < text.length; ) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl
    const blank = BLANK.test(text.slice(pos, lineEnd))
    // 空行后面的第一行字：新的一段从这里开始
    if (!blank && prevBlank) {
      out.push(text.slice(start, pos))
      start = pos
    }
    prevBlank = blank
    pos = nl === -1 ? text.length : nl + 1
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

/** 切句：到句末标点（连同后面的右引号括号）或换行为止，换行算在这一句里。各句首尾相接正好是原文 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    i++
    if (c === '\n') {
      out.push(text.slice(start, i))
      start = i
    } else if (END.includes(c)) {
      while (i < text.length && END.includes(text[i]!)) i++
      while (i < text.length && CLOSE.includes(text[i]!)) i++
      out.push(text.slice(start, i))
      start = i
    }
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

/**
 * 「冰岛旅游.md」+「iPhone」→「冰岛旅游（iPhone 上的一版）.md」；n > 1 时「冰岛旅游（iPhone 上的一版 2）.md」。
 * 笔迹、图片也一样留着后缀：「第 3 页.drawing」→「第 3 页（iPad 上的一版）.drawing」
 */
export function deviceCopyName(fileName: string, device: string, n = 1): string {
  const i = fileName.lastIndexOf('.')
  const dot = i > 0 ? i : fileName.length
  const suffix = n > 1 ? ` ${n}` : ''
  return `${fileName.slice(0, dot)}（${device} 上的一版${suffix}）${fileName.slice(dot)}`
}

// ---------- 三方对齐：diff3 的找法，只是挨着的两处改动不算碰上 ----------

/** 一边相对 base 的一处改动：base 的 [o0, o1) 换成这一边的 [x0, x1)；side 0 是 a，1 是 b */
interface Hunk {
  side: 0 | 1
  o0: number
  o1: number
  x0: number
  x1: number
}

/** 对齐好的一处：base [o0, o1)、a [a0, a1)、b [b0, b1)；who 0 谁都没改、1 只有 a 改、2 只有 b 改、3 两边都改 */
interface Chunk {
  o0: number
  o1: number
  a0: number
  a1: number
  b0: number
  b1: number
  who: 0 | 1 | 2 | 3
}

function hunksOf<T>(o: readonly T[], x: readonly T[], side: 0 | 1): Hunk[] {
  return diffIndices(o, x).map((h) => ({ side, o0: h.buffer1[0], o1: h.buffer1[0] + h.buffer1[1], x0: h.buffer2[0], x1: h.buffer2[0] + h.buffer2[1] }))
}

/** 改动 h 碰上 base 的 [rs, re) 这一处了吗：范围有重叠、插在它里面、两边插在同一处 */
function hits(rs: number, re: number, h: Hunk): boolean {
  if (h.o0 === h.o1) return rs === re ? h.o0 === rs : rs < h.o0 && h.o0 < re
  if (rs === re) return h.o0 < rs && rs < h.o1
  return h.o0 < re && rs < h.o1
}

/** 一边在这一处的范围：和 node-diff3 的 diff3MergeRegions 一样，用这一边的改动在 base 里的头尾推出来 */
function sideRange(group: Hunk[], side: 0 | 1, rs: number, re: number): [number, number] {
  let x0 = Infinity
  let x1 = -Infinity
  let o0 = Infinity
  let o1 = -Infinity
  for (const h of group) {
    if (h.side !== side) continue
    x0 = Math.min(x0, h.x0)
    x1 = Math.max(x1, h.x1)
    o0 = Math.min(o0, h.o0)
    o1 = Math.max(o1, h.o1)
  }
  return [x0 + (rs - o0), x1 + (re - o1)]
}

/** a、o、b 对齐成一处一处（首尾相接盖住三边） */
function align<T>(a: readonly T[], o: readonly T[], b: readonly T[]): Chunk[] {
  const hunks = [...hunksOf(o, a, 0), ...hunksOf(o, b, 1)]
  // 按 base 里的位置排；同一处插入排在改动前面（插在别人改的范围前面不算碰上）
  const ins = (h: Hunk) => (h.o0 === h.o1 ? 0 : 1)
  hunks.sort((x, y) => x.o0 - y.o0 || ins(x) - ins(y))
  const out: Chunk[] = []
  let po = 0
  let pa = 0
  let pb = 0
  for (let k = 0; k < hunks.length; ) {
    const group = [hunks[k++]!]
    const rs = group[0]!.o0
    let re = group[0]!.o1
    while (k < hunks.length && hits(rs, re, hunks[k]!)) {
      re = Math.max(re, hunks[k]!.o1)
      group.push(hunks[k++]!)
    }
    if (rs > po) {
      const n = rs - po
      out.push({ o0: po, o1: rs, a0: pa, a1: pa + n, b0: pb, b1: pb + n, who: 0 })
      pa += n
      pb += n
    }
    let ra: [number, number]
    let rb: [number, number]
    let who: Chunk['who']
    if (group.length === 1) {
      const h = group[0]!
      if (h.side === 0) {
        ra = [h.x0, h.x1]
        rb = [pb, pb + (re - rs)]
        who = 1
      } else {
        ra = [pa, pa + (re - rs)]
        rb = [h.x0, h.x1]
        who = 2
      }
    } else {
      ra = sideRange(group, 0, rs, re)
      rb = sideRange(group, 1, rs, re)
      who = 3
    }
    out.push({ o0: rs, o1: re, a0: ra[0], a1: ra[1], b0: rb[0], b1: rb[1], who })
    po = re
    pa = ra[1]
    pb = rb[1]
  }
  if (po < o.length) out.push({ o0: po, o1: o.length, a0: pa, a1: a.length, b0: pb, b1: b.length, who: 0 })
  return out
}

// ---------- 按段合并 ----------

interface Para {
  text: string
  /** 比较用：去掉末尾空白 */
  key: string
}

const paras = (text: string): Para[] => splitParagraphs(text).map((t) => ({ text: t, key: t.trimEnd() }))
const keysOf = (ps: readonly Para[]) => ps.map((p) => p.key)

/** 三边一样的键、末尾空白各不相同时用哪一版：只有一边改了用它，两边都改了用 a（keep） */
function pick3(o: string, a: string, b: string): string {
  if (a === b) return a
  if (a === o) return b
  if (b === o) return a
  return a
}

/** 同上，两边都改了时用 b（副本那边） */
function pick3b(o: string, a: string, b: string): string {
  if (a === b) return a
  if (a === o) return b
  if (b === o) return a
  return b
}

/** 文末的空白（最后一行行尾的空白和后面的空行、换行） */
const endingOf = (s: string) => s.slice(s.trimEnd().length)

interface Carry {
  /** 挪的那边：x[j] 换成改过的字 */
  j: number
  /** 改的那边：y[k] 换回 base 的那段 */
  k: number
  /** base 里的那段 */
  i: number
}

/**
 * 挪段：x 把 base 第 i 段原封不动挪到了别处（原位置没了、别处多了一段键一模一样的，两边都只有这一段），
 * y 在原位置一对一改了这段的字（y 自己没再在别处放一段同样的）。返回要搬的几处，按 base 里的顺序
 */
function findCarries(o: readonly Para[], x: readonly Para[], y: readonly Para[]): Carry[] {
  const dx = diffIndices(keysOf(o), keysOf(x))
  const gone = new Map<string, number>()
  const added = new Map<string, number>()
  const goneAt: number[] = []
  const addedAt = new Map<string, number>()
  for (const h of dx) {
    for (let i = h.buffer1[0]; i < h.buffer1[0] + h.buffer1[1]; i++) {
      const key = o[i]!.key
      gone.set(key, (gone.get(key) ?? 0) + 1)
      goneAt.push(i)
    }
    for (let j = h.buffer2[0]; j < h.buffer2[0] + h.buffer2[1]; j++) {
      const key = x[j]!.key
      added.set(key, (added.get(key) ?? 0) + 1)
      addedAt.set(key, j)
    }
  }
  const dy = diffIndices(keysOf(o), keysOf(y))
  const yAdded = new Set<string>()
  for (const h of dy) for (let j = h.buffer2[0]; j < h.buffer2[0] + h.buffer2[1]; j++) yAdded.add(y[j]!.key)
  const out: Carry[] = []
  for (const i of goneAt) {
    const key = o[i]!.key
    if (key === '' || gone.get(key) !== 1 || added.get(key) !== 1 || yAdded.has(key)) continue
    const h = dy.find((d) => d.buffer1[0] <= i && i < d.buffer1[0] + d.buffer1[1])
    // y 在原位置一对一改了这段（这一处 y 换进来的段数和 base 一样）
    if (!h || h.buffer1[1] !== h.buffer2[1]) continue
    out.push({ j: addedAt.get(key)!, k: h.buffer2[0] + (i - h.buffer1[0]), i })
  }
  return out
}

/** 把 y 改的字搬到 x 挪去的位置（末尾空白用 x 那里的），y 那边当没改这段 */
function applyCarries(o: readonly Para[], x: Para[], y: Para[], carries: readonly Carry[]): void {
  for (const c of carries) {
    const edited = y[c.k]!.key
    x[c.j] = { text: edited + x[c.j]!.text.slice(x[c.j]!.key.length), key: edited }
    y[c.k] = o[c.i]!
  }
}

/** 后面还接着别的段：不是以空行结尾时补成一个空行 */
function padded(piece: string): string {
  let s = piece.endsWith('\n') ? piece : piece + '\n'
  const lines = s.slice(0, -1).split('\n')
  if (!BLANK.test(lines[lines.length - 1]!)) s += '\n'
  return s
}

/** 一段一段拼回去；文末的空白换成 end */
function finish(pieces: readonly string[], end: string): string {
  const xs = pieces.filter((p) => p !== '')
  let out = ''
  xs.forEach((p, k) => {
    out += k < xs.length - 1 ? padded(p) : p
  })
  const body = out.trimEnd()
  return body === '' ? out : body + end
}

export function mergeParagraphs(base: string, local: string, remote: string, keep: 'local' | 'remote'): ParaMergeResult {
  if (local === remote) return { text: local, copy: null, conflicts: [] }
  if (local === base) return { text: remote, copy: null, conflicts: [] }
  if (remote === base) return { text: local, copy: null, conflicts: [] }

  // a 是 keep 那边，b 是另一边
  const [aText, bText] = keep === 'local' ? [local, remote] : [remote, local]
  const O = paras(base)
  const A = paras(aText)
  const B = paras(bText)
  const ab = findCarries(O, A, B)
  const ba = findCarries(O, B, A)
  applyCarries(O, A, B, ab)
  applyCarries(O, B, A, ba)

  const text: string[] = []
  const copy: string[] = []
  const conflicts: ParaConflict[] = []
  const both = (t: string) => {
    text.push(t)
    copy.push(t)
  }

  /** 按句合并 o → a、o → b：同一句两边都改了才冲突 */
  const bySentence = (o: string, a: string, b: string) => {
    const so = splitSentences(o)
    const sa = splitSentences(a)
    const sb = splitSentences(b)
    let t = ''
    let cp = ''
    let clash = false
    for (const c of align(sa, so, sb)) {
      const x = sa.slice(c.a0, c.a1).join('')
      const y = sb.slice(c.b0, c.b1).join('')
      if (c.who === 0) {
        const z = so.slice(c.o0, c.o1).join('')
        t += z
        cp += z
      } else if (c.who === 1 || (c.who === 3 && x === y)) {
        t += x
        cp += x
      } else if (c.who === 2) {
        t += y
        cp += y
      } else if (c.o0 === c.o1) {
        // 两边在同一处各加了句子：都留下，keep 那边在前
        t += x + y
        cp += x + y
      } else {
        t += x
        cp += y
        clash = true
      }
    }
    text.push(t)
    copy.push(cp)
    if (clash) conflicts.push({ base: o.trimEnd(), kept: t.trimEnd(), other: cp.trimEnd() })
  }

  const join = (ps: readonly Para[]) => ps.map((p) => p.text).join('')
  for (const c of align(keysOf(A), keysOf(O), keysOf(B))) {
    const a = A.slice(c.a0, c.a1)
    const o = O.slice(c.o0, c.o1)
    const b = B.slice(c.b0, c.b1)
    if (c.who === 0) {
      o.forEach((p, k) => both(pick3(p.text, a[k]!.text, b[k]!.text)))
    } else if (c.who === 1) {
      a.forEach((p) => both(p.text))
    } else if (c.who === 2) {
      b.forEach((p) => both(p.text))
    } else if (a.length === b.length && a.every((p, k) => p.key === b[k]!.key)) {
      // 两边改得一样
      a.forEach((p) => both(p.text))
    } else if (o.length === 0) {
      // 两边在同一处各插了段：都留下，keep 那边在前
      a.forEach((p) => both(p.text))
      b.forEach((p) => both(p.text))
    } else if (a.length === o.length && b.length === o.length) {
      o.forEach((p, k) => {
        const x = a[k]!
        const y = b[k]!
        if (x.key === y.key) both(pick3(p.text, x.text, y.text))
        else if (x.key === p.key) both(y.text)
        else if (y.key === p.key) both(x.text)
        else bySentence(p.text, x.text, y.text)
      })
    } else {
      bySentence(join(o), join(a), join(b))
    }
  }

  const [eo, ea, eb] = [endingOf(base), endingOf(aText), endingOf(bText)]
  return {
    text: finish(text, pick3(eo, ea, eb)),
    copy: conflicts.length ? finish(copy, pick3b(eo, ea, eb)) : null,
    conflicts,
  }
}

/**
 * 同步时两台设备都改了的一个文件怎么合（Git 按行合不了时叫到这里；iPhone / iPad 的 SyncModel、Mac 的同步拉取都走这一个）：
 * - 白板笔迹 `.ink`：按笔画、组的编号三方合并（ink.ts 的 mergeInk），两边各写各的都留下，同一笔两边都改了取后改的，没有副本；
 * - md：按段合并（mergeParagraphs），同一句两边都改了另存副本；
 * - 别的（图片、PDF、PencilKit 的 .drawing）：null，照旧另存「（iPad 上的一版）」副本。
 * 输入是解码过的文字（md 只有 \n）。
 */
export function mergeVaultText(path: string, base: string, local: string, remote: string, keep: 'local' | 'remote'): ParaMergeResult | null {
  const p = path.toLowerCase()
  if (p.endsWith('.ink')) return { text: mergeInk(base, local, remote, keep).text, copy: null, conflicts: [] }
  if (p.endsWith('.md')) return mergeParagraphs(base, local, remote, keep)
  return null
}
