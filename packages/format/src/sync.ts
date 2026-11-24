import { merge3Ours } from './merge'

/**
 * 正在编辑的笔记碰上外部改动（Git 同步、AI、梦游、别的软件）时怎么办。规矩：正在打的字不丢。
 *
 * base   上次和磁盘对上的版本
 * local  编辑器里现在的文字
 * remote 磁盘上新的文字
 */
export type Reconcile =
  /** 什么都不用做 */
  | { kind: 'none' }
  /** 编辑器换成 text（本地没改，直接用磁盘的；或者两边改的不是一处，合并好了） */
  | { kind: 'update'; text: string; merged: boolean }
  /**
   * 两边改了同一处：那一处留 local（正在打的字不丢），磁盘那一版另存成冲突副本；
   * text 是编辑器该换成的：同一处是 local 的，外面在别处改的也合进来（不是只进冲突副本）
   */
  | { kind: 'conflict'; conflictText: string; text: string }

export function reconcile(base: string, local: string, remote: string): Reconcile {
  if (remote === base || remote === local) return { kind: 'none' }
  if (local === base) return { kind: 'update', text: remote, merged: false }
  const m = merge3Ours(base, local, remote)
  if (m.conflict) return { kind: 'conflict', conflictText: remote, text: m.text }
  return { kind: 'update', text: m.text, merged: true }
}

const pad2 = (x: number) => String(x).padStart(2, '0')

/** 文件名里的时间「18-20」：冲突副本、写不进去另存的那篇共用（文件名里不放冒号，也不用点） */
export function clockStamp(when: Date): string {
  return `${pad2(when.getHours())}-${pad2(when.getMinutes())}`
}

/** 「旅行.md」→「旅行（冲突 2026-11-15 14-03）.md」；n > 1 时加序号 */
export function conflictCopyName(fileName: string, when: Date, n = 1): string {
  const dot = fileName.toLowerCase().endsWith('.md') ? fileName.length - 3 : fileName.length
  const stamp = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())} ${clockStamp(when)}`
  const suffix = n > 1 ? ` ${n}` : ''
  return `${fileName.slice(0, dot)}（冲突 ${stamp}${suffix}）${fileName.slice(dot)}`
}
