/**
 * 改数据库里的一条（拖看板卡换状态、拖日历改日期、格子里改、勾关联）：算出要写哪几个文件、改前改后的字；
 * 写盘、提交、撤回由主进程做（关联两边写是两篇一次提交、一次撤回，2026-11-22 用户定「关联列两边都写」）。
 *
 * 只换那一篇开头的那一行：拖卡只换「状态:」、拖日期只换「日期:」（拖回没排日子的拿掉这一行）、勾关联两篇各一行
 * （那一篇原来没有「所属讲」就加一行，去掉最后一个时这一行拿掉：勾上再去掉回到原样）。算出来的（公式、汇总）不写。
 */
import { type BaseCtx, type BaseRec, colTypeOf, dateMoved, relationLinks, linkTarget } from './base-rows'
import { listOf } from './base-types'
import { readPropList, setProp, setPropList } from './props'

/** 要写的一个文件：before 是算的时候读到的字（主进程写之前比一下，被别处改过就不写） */
export interface FileWrite {
  path: string
  before: string
  after: string
}

/** 撤回：每个文件换回去 */
export const undoWrites = (ws: FileWrite[]): FileWrite[] => ws.map((w) => ({ path: w.path, before: w.after, after: w.before }))

const recAt = (ctx: BaseCtx, path: string) => ctx.recs.find((r) => r.path === path) ?? null

/** 一串里写的这一项是不是指着这一篇 */
const pointsTo = (raw: string, rec: BaseRec) => {
  const t = linkTarget(raw)
  return t === rec.name || t === rec.path.replace(/\.md$/i, '') || rec.path.replace(/\.md$/i, '').endsWith('/' + t)
}

/**
 * 改一格：value 是字（状态、日期、数字、文字）、一串（多选、关联：那边的名字）、是 / 否（勾选），null 或空字拿掉这一行。
 * 关联列走 setRelation（两边写）；公式、汇总、名字（改名由主进程做）不写，返回空
 */
export function writeCell(ctx: BaseCtx, path: string, col: string, value: string | string[] | boolean | null): FileWrite[] {
  const rec = recAt(ctx, path)
  if (!rec || col.startsWith('file.') || col.startsWith('formula.')) return []
  const key = col.replace(/^note\./, '')
  const t = colTypeOf(ctx, key)
  if (t === 'formula' || t === 'rollup' || t === 'title') return []
  if (t === 'relation') return setRelation(ctx, path, key, Array.isArray(value) ? value : typeof value === 'string' && value ? listOf(value) : [])
  let after: string
  if (Array.isArray(value) || t === 'multi') {
    const items = Array.isArray(value) ? value : value === null || value === '' ? [] : listOf(String(value))
    after = setPropList(rec.text, key, items)
  } else if (value === null || value === '') after = setProp(rec.text, key, undefined)
  else after = setProp(rec.text, key, String(value))
  return after === rec.text ? [] : [{ path, before: rec.text, after }]
}

/** 日历上拖到哪天（null：拖回「没排日子的」，拿掉这一行）；原来带钟点的钟点留着 */
export function moveToDay(ctx: BaseCtx, path: string, prop: string, day: string | null): FileWrite[] {
  const rec = recAt(ctx, path)
  if (!rec) return []
  return writeCell(ctx, path, prop, day === null ? null : dateMoved(rec.props[prop] ?? '', day))
}

/**
 * 关联列这一条连到那边哪几篇（names 是那边的名字，照这个先后）。两边都写（twoWay）时，新连上的那一篇的 twoWay 一列加上这一篇，
 * 不连了的拿掉；那边没有这一篇的只写这边。原来写着的项照原来的写法
 */
export function setRelation(ctx: BaseCtx, path: string, prop: string, names: string[]): FileWrite[] {
  const def = ctx.doc.props[prop]
  const rec = recAt(ctx, path)
  if (!rec || def?.type !== 'relation') return []
  const pool = ctx.related.get(def.to) ?? []
  const want = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const old = relationLinks(ctx, rec, prop)
  const texts = new Map<string, { before: string; after: string }>()
  const cur = (r: BaseRec) => texts.get(r.path)?.after ?? r.text
  const put = (r: BaseRec, after: string) => texts.set(r.path, { before: texts.get(r.path)?.before ?? r.text, after })
  put(
    rec,
    setPropList(
      cur(rec),
      prop,
      want.map((n) => old.find((o) => o.name === n)?.raw ?? `[[${n}]]`),
    ),
  )
  if (def.twoWay) {
    const back = def.twoWay
    for (const n of want) {
      if (old.some((o) => o.name === n)) continue
      const t = pool.find((r) => r.name === n)
      if (!t) continue
      const items = readPropList(cur(t), back) ?? []
      if (!items.some((b) => pointsTo(b, rec))) put(t, setPropList(cur(t), back, [...items, `[[${rec.name}]]`]))
    }
    for (const o of old) {
      if (want.includes(o.name) || !o.path) continue
      const t = pool.find((r) => r.path === o.path)
      if (!t) continue
      const items = readPropList(cur(t), back) ?? []
      const next = items.filter((b) => !pointsTo(b, rec))
      if (next.length !== items.length) put(t, setPropList(cur(t), back, next))
    }
  }
  return [...texts.entries()].filter(([, v]) => v.after !== v.before).map(([p, v]) => ({ path: p, before: v.before, after: v.after }))
}

/** 关联选择里勾一下 / 去掉一下（on 不给是反过来） */
export function toggleRelation(ctx: BaseCtx, path: string, prop: string, name: string, on?: boolean): FileWrite[] {
  const rec = recAt(ctx, path)
  if (!rec) return []
  const cur = relationLinks(ctx, rec, prop).map((l) => l.name)
  const has = cur.includes(name)
  const next = (on ?? !has) ? (has ? cur : [...cur, name]) : cur.filter((n) => n !== name)
  return setRelation(ctx, path, prop, next)
}

/** 关联两边对不上（外面改了一边）：数据库开着时提示一句，点一下补上 */
export interface RelationIssue {
  /** missing-back：这边连着、那边的 twoWay 里没有；missing-forward：那边写着、这边没连；dangling：连着的那一篇没有 */
  kind: 'missing-back' | 'missing-forward' | 'dangling'
  prop: string
  /** 写着的那一篇 */
  from: string
  /** 少了它的那一篇（dangling 时是 null） */
  to: string | null
  message: string
}

/** 找对不上的地方（prop 不给是每一个关联列） */
export function relationIssues(ctx: BaseCtx, only?: string): RelationIssue[] {
  const out: RelationIssue[] = []
  for (const [prop, def] of Object.entries(ctx.doc.props)) {
    if (def.type !== 'relation' || (only && prop !== only)) continue
    const pool = ctx.related.get(def.to) ?? []
    for (const r of ctx.recs) {
      for (const l of relationLinks(ctx, r, prop)) {
        if (!l.path) {
          out.push({ kind: 'dangling', prop, from: r.path, to: null, message: `「${r.name}」的「${prop}」连着「${l.name}」，那边没有这一篇` })
          continue
        }
        if (!def.twoWay) continue
        const t = pool.find((x) => x.path === l.path)
        if (t && !(readPropList(t.text, def.twoWay) ?? []).some((b) => pointsTo(b, r))) out.push({ kind: 'missing-back', prop, from: r.path, to: t.path, message: `「${t.name}」的「${def.twoWay}」里少了「${r.name}」` })
      }
    }
    if (!def.twoWay) continue
    for (const t of pool) {
      for (const b of readPropList(t.text, def.twoWay) ?? []) {
        const r = ctx.recs.find((x) => pointsTo(b, x))
        if (r && !relationLinks(ctx, r, prop).some((l) => l.path === t.path)) out.push({ kind: 'missing-forward', prop, from: t.path, to: r.path, message: `「${r.name}」的「${prop}」里少了「${t.name}」` })
      }
    }
  }
  return out
}

/** 点一下补上：那边少了补那边，这边少了补这边，连着没有的那一篇拿掉（只写一篇） */
export function fixRelationIssue(ctx: BaseCtx, issue: RelationIssue): FileWrite[] {
  const def = ctx.doc.props[issue.prop]
  if (def?.type !== 'relation') return []
  const pool = ctx.related.get(def.to) ?? []
  const write = (r: BaseRec, after: string): FileWrite[] => (after === r.text ? [] : [{ path: r.path, before: r.text, after }])
  if (issue.kind === 'missing-back' && def.twoWay) {
    const r = recAt(ctx, issue.from)
    const t = pool.find((x) => x.path === issue.to)
    if (!r || !t) return []
    const items = readPropList(t.text, def.twoWay) ?? []
    return items.some((b) => pointsTo(b, r)) ? [] : write(t, setPropList(t.text, def.twoWay, [...items, `[[${r.name}]]`]))
  }
  if (issue.kind === 'missing-forward') {
    const r = issue.to ? recAt(ctx, issue.to) : null
    const t = pool.find((x) => x.path === issue.from)
    if (!r || !t) return []
    const items = readPropList(r.text, issue.prop) ?? []
    return items.some((b) => pointsTo(b, t)) ? [] : write(r, setPropList(r.text, issue.prop, [...items, `[[${t.name}]]`]))
  }
  if (issue.kind === 'dangling') {
    const r = recAt(ctx, issue.from)
    if (!r) return []
    const keep = relationLinks(ctx, r, issue.prop).filter((l) => l.path)
    return write(
      r,
      setPropList(
        r.text,
        issue.prop,
        keep.map((l) => l.raw),
      ),
    )
  }
  return []
}
