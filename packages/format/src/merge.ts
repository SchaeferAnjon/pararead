import { diff3Merge, diffPatch } from 'node-diff3'

export interface MergeResult {
  text: string
  /** 两边改了同一处，text 是 local 原样 */
  conflict: boolean
}

/** 按行三方合并：base 是上次读到的磁盘版本，local 是编辑器里的，remote 是磁盘上新的。 */
export function merge3(base: string, local: string, remote: string): MergeResult {
  if (local === remote) return { text: local, conflict: false }
  if (local === base) return { text: remote, conflict: false }
  if (remote === base) return { text: local, conflict: false }
  const regions = diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'), { excludeFalseConflicts: true })
  const lines: string[] = []
  for (const r of regions) {
    if (r.conflict) return { text: local, conflict: true }
    lines.push(...r.ok!)
  }
  return { text: lines.join('\n'), conflict: false }
}

type Region = ReturnType<typeof diff3Merge<string>>[number]

/**
 * 两边都只往文件末尾加了字（用户在末尾打了一句、梦游在末尾补一行双链、同步来的在末尾添了一段）：两边的都留下，local 在前。
 * 第 i 段冲突后面只剩空行才算末尾；local、remote 都得原样留着 base 那几行、只在后面接着写。
 * 两边都在同一行行尾接着打（谁也没换行）分不清谁该在前，不合。合不了返回 null
 */
function tailBoth(regions: Region[], i: number): string[] | null {
  if (!regions.slice(i + 1).every((r) => !r.conflict && r.ok!.every((l) => l === ''))) return null
  const c = regions[i]!.conflict!
  const [a, o, b] = [c.a, c.o, c.b].map((l) => l.join('\n')) as [string, string, string]
  if (!a.startsWith(o) || !b.startsWith(o)) return null
  const aRest = a.slice(o.length)
  const bRest = b.slice(o.length)
  if (!aRest) return b.split('\n')
  if (!bRest) return a.split('\n')
  // base 这一段是整行插进来的（o 为空行数）：两边各是整行，中间换行；不然要有一边是另起一行
  const lineBreak = aRest.endsWith('\n') || bRest.startsWith('\n')
  if (!lineBreak && c.o.length) return null
  return (o + aRest + (lineBreak ? '' : '\n') + bRest).split('\n')
}

/**
 * 三方合并，两边改了同一处时那几行留 local（编辑器里正在写的）；别处 remote 改的照样合进来。
 * conflict 说有没有这种「留了 local」的地方（有就把 remote 另存冲突副本）。两边都只往末尾加的不算（tailBoth）。
 */
export function merge3Ours(base: string, local: string, remote: string): MergeResult {
  if (local === remote || remote === base) return { text: local, conflict: false }
  if (local === base) return { text: remote, conflict: false }
  const regions = diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'), { excludeFalseConflicts: true })
  const lines: string[] = []
  let conflict = false
  for (const [i, r] of regions.entries()) {
    if (r.conflict) {
      const both = tailBoth(regions, i)
      if (both) {
        lines.push(...both)
        continue
      }
      conflict = true
      lines.push(...r.conflict.a)
    } else lines.push(...r.ok!)
  }
  return { text: lines.join('\n'), conflict }
}

/** 按字合并时一个「字」：一串英文字母数字、一串空白，或者别的一个字符（汉字、标点各算一个） */
const tokens = (s: string) => s.match(/[A-Za-z0-9_]+|\s+|[^]/gu) ?? []
/** 按字合并只用在一小段冲突上：太长的不硬合 */
const FINE_MAX = 20_000

/**
 * 三方合并，先按行；两边改了同一行但改的不是同一处（一边在行尾接着打字、一边改了行里的链接），再按字合并这几行。
 * 按字也碰到同一处才算冲突，text 是 local 原样。
 */
export function merge3Fine(base: string, local: string, remote: string): MergeResult {
  if (local === remote) return { text: local, conflict: false }
  if (local === base) return { text: remote, conflict: false }
  if (remote === base) return { text: local, conflict: false }
  const regions = diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'), { excludeFalseConflicts: true })
  const lines: string[] = []
  for (const [i, r] of regions.entries()) {
    if (!r.conflict) {
      lines.push(...r.ok!)
      continue
    }
    const [a, o, b] = [r.conflict.a, r.conflict.o, r.conflict.b].map((l) => l.join('\n'))
    if (a!.length + o!.length + b!.length > FINE_MAX) return { text: local, conflict: true }
    const fine = diff3Merge(tokens(a!), tokens(o!), tokens(b!), { excludeFalseConflicts: true })
    if (fine.some((f) => f.conflict)) {
      // 两边都只往末尾加：都留下（用户末尾打的一句、梦游补的「相关：[[…]]」）
      const both = tailBoth(regions, i)
      if (!both) return { text: local, conflict: true }
      lines.push(...both)
      continue
    }
    lines.push(...fine.flatMap((f) => f.ok!).join('').split('\n'))
  }
  return { text: lines.join('\n'), conflict: false }
}

export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * 把 a 改成 b 的最小一组改动（按行找改动块，块内再去掉相同的头尾），offset 都是相对 a 的。
 * 编辑器按这组改动更新，光标和没动的地方保持原样。
 */
export function textChanges(a: string, b: string): TextChange[] {
  if (a === b) return []
  const al = a.split('\n')
  const bl = b.split('\n')
  const lineStart: number[] = [0]
  for (let i = 0; i < al.length; i++) lineStart.push(lineStart[i]! + al[i]!.length + 1)

  const changes: TextChange[] = []
  for (const p of diffPatch(al, bl)) {
    const { offset: aOff, length: aLen } = p.buffer1
    const { chunk: bChunk } = p.buffer2
    // 改动块在 a 里对应的字符范围；把块后面的换行算进去，插入整行时才对得上
    let from = lineStart[aOff]!
    let to = lineStart[aOff + aLen]!
    let insert = bChunk.map((l) => l + '\n').join('')
    if (to > a.length) {
      // 块一直到最后一行（最后一行后面没有换行）：改用块前面的那个换行
      to = a.length
      insert = (aOff > 0 && bChunk.length ? '\n' : '') + bChunk.join('\n')
      if (aOff > 0) from -= 1
    }
    changes.push(trim({ from, to, insert }, a))
  }
  return changes
}

function trim(c: TextChange, a: string): TextChange {
  let { from, to, insert } = c
  while (from < to && insert.length > 0 && a[from] === insert[0]) {
    from++
    insert = insert.slice(1)
  }
  while (from < to && insert.length > 0 && a[to - 1] === insert[insert.length - 1]) {
    to--
    insert = insert.slice(0, -1)
  }
  return { from, to, insert }
}

export function applyChanges(a: string, changes: TextChange[]): string {
  let out = ''
  let pos = 0
  for (const c of changes) {
    out += a.slice(pos, c.from) + c.insert
    pos = c.to
  }
  return out + a.slice(pos)
}
