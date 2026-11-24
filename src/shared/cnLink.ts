/**
 * ParaRead × 画布笔记联动（设计 canvas-notes 20-pararead联动「已定」，2026-11-23）：ParaRead 这边的纯函数。
 * 库里一篇 PDF 旁边那篇配对笔记是两边唯一的一份：划的线一条一行（@cn/format 的 highlights.ts），看不懂写成问题段，
 * 有质疑、AI 问答写成问答段（src/shared/pairedNote.ts）。ParaRead 的 annotations 表对库里的论文只当缓存：
 * 位置（原文模式的框、对照模式的段和偏移）、讲解、自己写的笔记留在这边，含义、原文、页码以笔记为准。
 *
 * 老数据（联动以前的）没有含义的键，按颜色和标签算（kindOf）：看不懂的标签 → 看不懂；黄 → 重点、绿 → 定义、蓝 → 想引用，
 * 红没有标签的也算重点（红色现在是「看不懂」，老的红色高亮多半不是看不懂，不让它们冒出来变成问题段、算进「还有几处看不懂」）。
 */
import { CONFUSED, DEFAULT_KINDS, type Highlight, type HlKind, type Rect } from '@cn/format'
import type { Annotation, HlColor } from './types'

/** 老数据按颜色算含义 */
export const LEGACY_KIND: Record<string, string> = { yellow: 'key', green: 'def', blue: 'cite', red: 'key' }

/** 这一条的含义（键） */
export function kindOf(a: Pick<Annotation, 'kind' | 'label' | 'color'>): string {
  if (a.kind) return a.kind
  if (a.label === 'confused') return CONFUSED
  return LEGACY_KIND[a.color] ?? 'key'
}

/** 含义的颜色（含义表里没有这个键的是灰的：画布笔记那边删了这种颜色，已划的变没分类） */
export const colorOfKind = (kinds: HlKind[], key: string): HlColor => (kinds.find((k) => k.key === key)?.color as HlColor | undefined) ?? 'gray'

/** 含义的名字（没有这个键时写键本身） */
export const nameOfKind = (kinds: HlKind[], key: string): string => kinds.find((k) => k.key === key)?.name ?? key

/** 选了某种颜色的高亮（老的画法、单键 1 到 4）对应哪种含义：颜色一样的那种，没有就重点 */
export const kindOfColor = (kinds: HlKind[], color: HlColor): string => kinds.find((k) => k.color === color)?.key ?? 'key'

/** 不是看不懂的含义里排第一的（笔记、划线、灵感这些不挑颜色的动作用上次的颜色，上次是看不懂时用它） */
export const firstPlainKind = (kinds: HlKind[]): HlKind => kinds.find((k) => k.key !== CONFUSED) ?? DEFAULT_KINDS[0]!

/** 原文模式几行的框合成一个（笔记里一条记一个框，比例，三位小数）；没有框返回 undefined */
export function rectOf(rects: number[][] | null | undefined): Rect | undefined {
  const rs = (rects ?? []).filter((r) => r.length === 4 && r.every((n) => Number.isFinite(n)))
  if (!rs.length) return undefined
  const x0 = Math.min(...rs.map((r) => r[0]!))
  const y0 = Math.min(...rs.map((r) => r[1]!))
  const x1 = Math.max(...rs.map((r) => r[0]! + r[2]!))
  const y1 = Math.max(...rs.map((r) => r[1]! + r[3]!))
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  return [r3(x0), r3(y0), r3(x1 - x0), r3(y1 - y0)]
}

/**
 * 这一条能不能写进笔记：要有页码和原文；整块框住的公式、图（原文对不上 PDF 上的字）、对照模式里划在译文上的（字是译文，
 * 画布笔记在 PDF 上找不到）只留在 ParaRead
 */
export function shareable(a: Pick<Annotation, 'page' | 'text' | 'style' | 'blockId'>): boolean {
  return !!a.page && a.page >= 1 && !!a.text.trim() && a.style !== 'box' && !a.blockId?.endsWith(':tr')
}

/** 写进笔记的那一条（hl 是它在笔记里的身份） */
export function hlOfAnn(a: Annotation, hl: string, pdf: string): Pick<Highlight, 'id' | 'key' | 'text' | 'page' | 'rect' | 'file'> {
  const rect = a.mode === 'pdf' ? rectOf(a.rects) : undefined
  return { id: hl, key: kindOf(a), text: a.text, page: a.page!, ...(rect ? { rect } : {}), file: pdf }
}

/** 笔记和缓存对一遍：笔记里有、缓存没有的新建；含义、页码变了的改；缓存里写过（有 hl）、笔记里没了的删（在画布笔记里删了） */
export interface Reconcile {
  create: Highlight[]
  update: { id: string; kind: string; page: number }[]
  remove: string[]
}

export function reconcile(rows: Annotation[], hls: Highlight[]): Reconcile {
  const byHl = new Map(rows.filter((r) => r.hl).map((r) => [r.hl!, r]))
  const inNote = new Set(hls.map((h) => h.id))
  const out: Reconcile = { create: [], update: [], remove: [] }
  for (const h of hls) {
    const r = byHl.get(h.id)
    if (!r) out.create.push(h)
    else if (kindOf(r) !== h.key || (h.page && r.page !== h.page)) out.update.push({ id: r.id, kind: h.key, page: h.page || r.page || 1 })
  }
  for (const r of rows) if (r.hl && !inNote.has(r.hl)) out.remove.push(r.id)
  return out
}

/** 笔记里来的一条（在画布笔记里划的）在 ParaRead 里的样子：原文模式的一条，没有框（PDF 上按原文在那一页的文字层里找） */
export function annOfHl(h: Highlight, paperId: string, kinds: HlKind[], id: string, now: number): Annotation {
  return {
    id,
    paperId,
    mode: 'pdf',
    color: colorOfKind(kinds, h.key),
    style: 'highlight',
    label: h.key === CONFUSED ? 'confused' : null,
    kind: h.key,
    hl: h.id,
    text: h.text,
    note: '',
    page: h.page || null,
    rects: null,
    blockId: null,
    blockHash: null,
    start: null,
    end: null,
    section: '',
    createdAt: now,
    updatedAt: now
  }
}

/** 一条含义换了以后的样子：颜色跟含义走；换成看不懂打上标签，从看不懂换走去掉标签（有质疑不动） */
export function withKind(a: Annotation, kinds: HlKind[], key: string): Annotation {
  const label = key === CONFUSED ? 'confused' : a.label === 'confused' ? null : (a.label ?? null)
  return { ...a, kind: key, color: colorOfKind(kinds, key), label, ...(label !== a.label ? { labelStatus: null, explain: null } : {}) }
}

/** 文献库左栏「画布笔记库」里一个文件夹的筛选（存在设置的 libFilter 里）：cn:["<库>","<文件夹>"] */
export const cnFilter = (root: string, folder: string): string => `cn:${JSON.stringify([root, folder])}`
export function parseCnFilter(f: string): { root: string; folder: string } | null {
  if (!f.startsWith('cn:')) return null
  try {
    const [root, folder] = JSON.parse(f.slice(3)) as [unknown, unknown]
    return typeof root === 'string' && typeof folder === 'string' ? { root, folder } : null
  } catch {
    return null
  }
}
/** 这一篇在不在这个库的这个文件夹里（只算直接放在里面的） */
export const inCnFolder = (cn: { root: string; path: string } | null, root: string, folder: string): boolean =>
  !!cn && cn.root === root && (cn.path.includes('/') ? cn.path.slice(0, cn.path.lastIndexOf('/')) : '') === folder
