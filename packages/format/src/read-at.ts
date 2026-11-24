/**
 * 「读到哪」两边合一（ParaRead 联动，2026-11-23 用户定「合一，取最近一次」）：画布笔记和 ParaRead 读同一份 PDF，
 * 读到第几页、哪一节、读了多久写进库里一份 .canvas-notes/读到哪.json（两个软件读写同一份，跟着 Git 走），谁晚谁为准；
 * 读了多久两边各记各的，加起来是总数（各自只往上加，合并时取大的，不会算两遍）。
 * 配对笔记的属性「读到」「读了」是写给人看的同一份（读到: 30% · B. BST-GATNet Architecture、读了: 39 分钟）。
 * 画布笔记的「问到第几页」（属性「进度」、课件进度）是另一件事，不动。纯函数，不碰 Electron、Node。
 */
import { setProp } from './props'

export const READ_AT_FILE = '.canvas-notes/读到哪.json'

/** 一份 PDF 读到哪 */
export interface ReadAt {
  /** 第几页（从 1 数） */
  page: number
  /** 一共几页（不知道时没有） */
  pages?: number
  /** 读到百分之几（ParaRead 按段算的更准；没有时按页算） */
  pct?: number
  /** 哪一节（ParaRead 认得出小节名） */
  section?: string
  /** 什么时候（毫秒）：两边比这个，谁晚谁为准 */
  at: number
  /** 谁记的：canvas-notes、pararead */
  by: string
  /** 读了多久（毫秒）：每个软件记自己的 */
  ms?: Record<string, number>
}

export type ReadAtMap = Record<string, ReadAt>

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 读那份文件：坏了的、不认得的条目跳过（不整份作废） */
export function parseReadAt(text: string | null): ReadAtMap {
  if (!text?.trim()) return {}
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return {}
  }
  const files = j && typeof j === 'object' ? (j as { files?: unknown }).files : null
  if (!files || typeof files !== 'object') return {}
  const out: ReadAtMap = {}
  for (const [k, v] of Object.entries(files as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const page = num(o.page)
    const at = num(o.at)
    if (!page || page < 1 || at === undefined || typeof o.by !== 'string') continue
    const ms: Record<string, number> = {}
    if (o.ms && typeof o.ms === 'object') for (const [a, n] of Object.entries(o.ms as Record<string, unknown>)) if (num(n) !== undefined && (n as number) >= 0) ms[a] = n as number
    out[k] = {
      page: Math.floor(page),
      ...(num(o.pages) ? { pages: Math.floor(o.pages as number) } : {}),
      ...(num(o.pct) !== undefined ? { pct: Math.min(100, Math.max(0, o.pct as number)) } : {}),
      ...(typeof o.section === 'string' && o.section.trim() ? { section: o.section.trim() } : {}),
      at,
      by: o.by,
      ...(Object.keys(ms).length ? { ms } : {}),
    }
  }
  return out
}

/** 写回：按路径排、两格缩进、末尾换行（两个软件写出来一个字不差） */
export function readAtJson(map: ReadAtMap): string {
  const files: Record<string, unknown> = {}
  for (const k of Object.keys(map).sort()) {
    const r = map[k]!
    files[k] = {
      page: r.page,
      ...(r.pages ? { pages: r.pages } : {}),
      ...(r.pct !== undefined ? { pct: Math.round(r.pct * 10) / 10 } : {}),
      ...(r.section ? { section: r.section } : {}),
      at: r.at,
      by: r.by,
      ...(r.ms && Object.keys(r.ms).length ? { ms: Object.fromEntries(Object.keys(r.ms).sort().map((a) => [a, Math.round(r.ms![a]!)])) } : {}),
    }
  }
  return JSON.stringify({ files }, null, 2) + '\n'
}

/** 两份合一：位置取晚的那份（一样晚取 b），读了多久每个软件取大的 */
export function mergeReadAt(a: ReadAt | undefined, b: ReadAt | undefined): ReadAt | undefined {
  if (!a) return b
  if (!b) return a
  const late = b.at >= a.at ? b : a
  const ms: Record<string, number> = { ...(a.ms ?? {}) }
  for (const [k, v] of Object.entries(b.ms ?? {})) ms[k] = Math.max(ms[k] ?? 0, v)
  const { ms: _drop, ...pos } = late
  void _drop
  return { ...pos, ...(Object.keys(ms).length ? { ms } : {}) }
}

/** 整份合一（另一个软件刚写过、Git 拉下来的那份和这边的） */
export function mergeReadAtMaps(a: ReadAtMap, b: ReadAtMap): ReadAtMap {
  const out: ReadAtMap = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = mergeReadAt(a[k], b[k])!
  return out
}

/**
 * 这个软件读到这里了：位置换成这次的（at 是现在），addMs 加进这个软件自己的「读了多久」。
 * 没翻页、只加时间时 at 不动（不因为开着就把另一边更晚的位置盖掉）
 */
export function putReadAt(map: ReadAtMap, file: string, by: string, o: { page?: number; pages?: number; pct?: number; section?: string; addMs?: number; now: number }): ReadAtMap {
  const old = map[file]
  const ms = { ...(old?.ms ?? {}) }
  if (o.addMs && o.addMs > 0) ms[by] = (ms[by] ?? 0) + o.addMs
  let next: ReadAt
  if (o.page !== undefined) {
    next = {
      page: Math.max(1, Math.floor(o.page)),
      ...(o.pages ? { pages: o.pages } : old?.pages ? { pages: old.pages } : {}),
      ...(o.pct !== undefined ? { pct: o.pct } : {}),
      ...(o.section ? { section: o.section } : {}),
      at: o.now,
      by,
    }
  } else if (old) {
    const { ms: _drop, ...rest } = old
    void _drop
    next = rest
  } else return map
  if (Object.keys(ms).length) next.ms = ms
  return { ...map, [file]: next }
}

/** 读到百分之几：记了按记的，没有按页算 */
export function readPct(r: ReadAt): number | undefined {
  if (r.pct !== undefined) return Math.round(r.pct)
  return r.pages ? Math.round((r.page / r.pages) * 100) : undefined
}

/** 一共读了几分钟（两个软件加起来） */
export const readMinutes = (r: ReadAt) => Math.round(Object.values(r.ms ?? {}).reduce((a, b) => a + b, 0) / 60_000)

/** 属性「读到」的值：30% · B. BST-GATNet Architecture；不知道百分比时写「第 3 页」（写进文件的字） */
export function readAtLabel(r: ReadAt): string {
  const pct = readPct(r)
  const where = pct !== undefined ? `${pct}%` : `第 ${r.page} 页`
  return r.section ? `${where} · ${r.section}` : where
}

/** 配对笔记的属性「读到」「读了」跟上（值没变时原文不变） */
export function withReadAtProps(md: string, r: ReadAt): string {
  let t = setProp(md, '读到', readAtLabel(r))
  const min = readMinutes(r)
  if (min > 0) t = setProp(t, '读了', `${min} 分钟`)
  return t
}
