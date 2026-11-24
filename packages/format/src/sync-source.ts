/**
 * 同步来源（2026-11-23 设计页 61-同步来源，用户看过定稿）：定时从别的服务只读拉进库。这里是不依赖 Electron 的纯函数：
 * 宽松读 JSON、认库里哪篇来自哪一家（属性 getnote_id / getnote_ids）、拉到哪的记录（.canvas-notes/同步来源/<来源>.json）、
 * 第一次连上分「比库里最新那篇还新的 / 更早的」、每天全量对账算「那边改了、删了、库里删了」。
 * Get笔记 一篇怎么写成 md 在 getnote.ts；主进程那一半（翻页、下图、写盘、提交）在 apps/notes/src/main/sources/。
 *
 * 规矩（用户定的四件，设计页第 1、4 节）：
 * - 只拉不删：那边删了，库里那篇只加属性 `<来源>_deleted: 日期`；
 * - 那边改了：库里那篇从拉进来以后没人动过（字的指纹和拉进来时一样）才换成新的，动过只标 `<来源>_newer: 那边的修改时间`；
 * - 库里删过的不再拉回来；第一次连上没勾的、空录音也不拉。
 */

// ---------------------------------------------------------------- 宽松 JSON

/**
 * 读接口回来的 JSON：Get笔记 的 id 是 64 位整数（JSON.parse 会丢精度，1927296063601909568 读成 …600），
 * 正文里还会夹着没转义的换行（接口说明里写了）。字符串外面 16 位以上的整数改成字符串，字符串里的控制字符补上转义，再 JSON.parse
 */
export function looseJson(text: string): unknown {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      // 一整个字符串：控制字符补转义
      let j = i + 1
      let s = '"'
      while (j < n) {
        const d = text[j]!
        if (d === '\\') {
          s += d + (text[j + 1] ?? '')
          j += 2
          continue
        }
        if (d === '"') break
        const code = d.charCodeAt(0)
        if (code < 0x20) s += d === '\n' ? '\\n' : d === '\r' ? '\\r' : d === '\t' ? '\\t' : '\\u' + code.toString(16).padStart(4, '0')
        else s += d
        j++
      }
      out += s + '"'
      i = j + 1
      continue
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i + 1
      while (j < n && /[0-9.eE+-]/.test(text[j]!)) j++
      const num = text.slice(i, j)
      out += /^-?\d{16,}$/.test(num) ? `"${num}"` : num
      i = j
      continue
    }
    out += c
    i++
  }
  return JSON.parse(out)
}

// ---------------------------------------------------------------- 库里哪篇来自哪一家

/** frontmatter 那一段（没有是空的） */
const fmOf = (text: string) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''

/**
 * 这篇认的是那边哪几篇：`<idProp>: 123`（一篇），合并过的 `<idsProp>: [1, 2, 3]`（几篇并成一篇，设计页第 1 节：用户库里有 2 篇）。
 * 只看属性，文件挪到哪、改了名都认得
 */
export function sourceIdsOf(text: string, idProp: string, idsProp: string): { ids: string[]; merged: boolean } {
  if (!text.startsWith('---')) return { ids: [], merged: false }
  const fm = fmOf(text)
  const one = new RegExp(`^${idProp}:[ \\t]*["']?(\\d+)["']?[ \\t]*$`, 'm').exec(fm)
  if (one) return { ids: [one[1]!], merged: false }
  const many = new RegExp(`^${idsProp}:[ \\t]*\\[([^\\]\\n]*)\\]`, 'm').exec(fm)
  if (many) return { ids: [...many[1]!.matchAll(/\d+/g)].map((m) => m[0]), merged: true }
  // 一行一个的列表写法
  const block = new RegExp(`^${idsProp}:[ \\t]*\\n((?:[ \\t]+-[^\\n]*\\n?)+)`, 'm').exec(fm + '\n')
  if (block) return { ids: [...block[1]!.matchAll(/\d+/g)].map((m) => m[0]), merged: true }
  return { ids: [], merged: false }
}

/** 库里一篇来自那边的 */
export interface LocalCopy {
  path: string
  text: string
  merged: boolean
}

/** 整个库里认出来的：那边的 id → 库里那篇（合并笔记里的几个 id 都指到它） */
export function indexVault(notes: Iterable<[string, string]>, idProp: string, idsProp: string): Map<string, LocalCopy> {
  const out = new Map<string, LocalCopy>()
  for (const [path, text] of notes) {
    const { ids, merged } = sourceIdsOf(text, idProp, idsProp)
    for (const id of ids) if (!out.has(id)) out.set(id, { path, text, merged })
  }
  return out
}

/**
 * 新拉的放哪个文件夹：整个库里来自这一家的笔记，九成以上都在它下面的最深那一层（用户库：501 篇里 494 篇在 40-Clippings/Getnotes 和它的子文件夹，
 * AI-Tech 那一层只占六七成，不选它）。一篇都没有时给 null（界面用默认的「剪藏/Get笔记」）
 */
export function defaultSourceFolder(paths: readonly string[], share = 0.9): string | null {
  if (!paths.length) return null
  const count = new Map<string, number>()
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1)
    for (let k = 1; k <= parts.length; k++) {
      const f = parts.slice(0, k).join('/')
      count.set(f, (count.get(f) ?? 0) + 1)
    }
  }
  let best: string | null = null
  for (const [f, c] of count) {
    if (c / paths.length < share) continue
    if (best === null || f.split('/').length > best.split('/').length) best = f
  }
  if (best !== null) return best
  // 分得很散：直接放着最多篇的那个文件夹
  const direct = new Map<string, number>()
  for (const p of paths) {
    const f = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    direct.set(f, (direct.get(f) ?? 0) + 1)
  }
  return [...direct].sort((a, b) => b[1] - a[1])[0]![0]
}

// ---------------------------------------------------------------- 拉到哪的记录

/** 多久拉一次（设置页「什么时候拉」那一个下拉） */
export type SyncEvery = 'open+1h' | 'open+2h' | 'open+22' | 'open' | 'manual'
export const SYNC_EVERY: readonly SyncEvery[] = ['open+1h', 'open+2h', 'open+22', 'open', 'manual']

/** 一家来源在这个库里的设置（跟着 Git 走，两台 Mac 一样；Key 不在这里） */
export interface SourceSettings {
  /** 开着才定时拉（「现在拉一次」照样能点） */
  on: boolean
  /** 新的落在哪一层 */
  folder: string
  every: SyncEvery
  /** 图片下进附件 */
  images: boolean
  /** 录音的逐句转写收在文末 */
  transcript: boolean
  /** 链接的网页原文收在文末 */
  original: boolean
  /** 空录音不拉 */
  skipEmpty: boolean
}

export const defaultSourceSettings = (folder: string): SourceSettings => ({ on: true, folder, every: 'open+2h', images: true, transcript: true, original: true, skipEmpty: true })

/** .canvas-notes/同步来源/<来源>.json */
export interface SyncState {
  v: 1
  settings: SourceSettings
  /** 上次拉（不管哪台 Mac）：本地时间 2026-11-23T17:48:00 */
  lastPull: string | null
  /** 上次全量对账 */
  lastFull: string | null
  /** 拉进来时的样子：id → 那边的修改时间、写进库那一刻的字的指纹（判断后来有没有人动过） */
  notes: Record<string, { u: string; h: string }>
  /** 拉进来过、后来在库里删掉的：不再拉回来 */
  dropped: string[]
  /** 不拉的：第一次连上没勾的、空录音 */
  skipped: string[]
}

export const syncStatePath = (source: string) => `.canvas-notes/同步来源/${source}.json`

export function newSyncState(folder: string): SyncState {
  return { v: 1, settings: defaultSourceSettings(folder), lastPull: null, lastFull: null, notes: {}, dropped: [], skipped: [] }
}

/** 读记录（坏了、缺几项的补默认；文件不在给 null） */
export function parseSyncState(text: string | null, folder: string): SyncState | null {
  if (text === null) return null
  let j: Partial<SyncState>
  try {
    j = JSON.parse(text) as Partial<SyncState>
  } catch {
    // 同步冲突写坏了：当没有记录，从库里认出来的接着拉（认重复只看属性，不会重复拉）
    return newSyncState(folder)
  }
  const d = defaultSourceSettings(folder)
  const s = (j.settings ?? {}) as Partial<SourceSettings>
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)
  return {
    v: 1,
    settings: {
      on: bool(s.on, d.on),
      folder: typeof s.folder === 'string' && s.folder && !s.folder.split('/').includes('..') ? s.folder : d.folder,
      every: SYNC_EVERY.includes(s.every as SyncEvery) ? (s.every as SyncEvery) : d.every,
      images: bool(s.images, d.images),
      transcript: bool(s.transcript, d.transcript),
      original: bool(s.original, d.original),
      skipEmpty: bool(s.skipEmpty, d.skipEmpty),
    },
    lastPull: typeof j.lastPull === 'string' ? j.lastPull : null,
    lastFull: typeof j.lastFull === 'string' ? j.lastFull : null,
    notes: j.notes && typeof j.notes === 'object' ? j.notes : {},
    dropped: Array.isArray(j.dropped) ? j.dropped.map(String) : [],
    skipped: Array.isArray(j.skipped) ? j.skipped.map(String) : [],
  }
}

/** 写记录：键排好、两格缩进，一次拉只改几行（Git 里看得清） */
export function syncStateText(s: SyncState): string {
  const notes = Object.fromEntries(Object.keys(s.notes).sort().map((k) => [k, s.notes[k]]))
  return JSON.stringify({ ...s, notes, dropped: [...new Set(s.dropped)].sort(), skipped: [...new Set(s.skipped)].sort() }, null, 2) + '\n'
}

/** 字的指纹（判断拉进来以后有没有人动过；不为安全，只为比） */
export function textPrint(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------- 算该拉哪几篇

/** 那边列表里的一篇（列表接口给的，不用再取详情） */
export interface RemoteItem {
  id: string
  title: string
  /** 那一家自己的类型（link、class_audio…） */
  kind: string
  /** 本地时间 2026-11-18 00:21:13 */
  created: string
  updated: string
  /** 空录音（没有转写、AI 也说空白） */
  empty: boolean
}

/** 不再拉的：库里有的、库里删过的、说过不拉的 */
export function knownIds(state: SyncState, vault: ReadonlyMap<string, LocalCopy>): Set<string> {
  return new Set([...vault.keys(), ...state.dropped, ...state.skipped])
}

/** 该拉的新的：那边有、库里没有、没删过、没说不拉；空录音照设置跳过（交回去记进 skipped） */
export function planNew(remote: readonly RemoteItem[], known: ReadonlySet<string>, skipEmpty: boolean): { pull: RemoteItem[]; empty: RemoteItem[] } {
  const pull: RemoteItem[] = []
  const empty: RemoteItem[] = []
  for (const r of remote) {
    if (known.has(r.id)) continue
    if (skipEmpty && r.empty) empty.push(r)
    else pull.push(r)
  }
  return { pull, empty }
}

/** 第一次连上：库里已经有几篇、比库里最新那篇还新的、更早的（设计页「连上了：Get笔记 里有 567 篇」） */
export interface FirstPlan {
  total: number
  inVault: number
  /** 库里来自这一家的最新一篇建于几时（「9 月 7 日」）；库里一篇都没有时是 null */
  newest: string | null
  /** 比库里最新那篇还新的（库里一篇都没有时：最近 30 天的） */
  newer: RemoteItem[]
  /** 更早的、库里没有的 */
  older: RemoteItem[]
}

export function planFirst(remote: readonly RemoteItem[], vault: ReadonlyMap<string, LocalCopy>, now: Date): FirstPlan {
  const inVault = remote.filter((r) => vault.has(r.id))
  const newest = inVault.reduce<string | null>((a, r) => (!a || r.created > a ? r.created : a), null)
  const cut = newest ?? stamp(new Date(now.getTime() - 30 * 86400_000))
  const missing = remote.filter((r) => !vault.has(r.id))
  return { total: remote.length, inVault: inVault.length, newest, newer: missing.filter((r) => r.created > cut), older: missing.filter((r) => r.created <= cut) }
}

/** 本地时间 2026-11-23 17:48:00（和 Get笔记 的 created_at 一个写法，能直接比大小） */
export function stamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 全量对账的结果 */
export interface FullPlan {
  /** 那边改了、库里那篇拉进来后没人动过：换成新的 */
  replace: { id: string; path: string }[]
  /** 那边改了、库里那篇动过（或不是这里拉的）：只标 newer */
  mark: { id: string; path: string; updated: string }[]
  /** 那边删了：只标 deleted */
  deleted: { id: string; path: string }[]
  /** 拉进来过、库里没了：记进 dropped */
  dropped: string[]
}

/**
 * 每天一次：拿那边全部的列表和库里认出来的比。
 * 改了：那边的修改时间比拉进来时（没记的看属性 updated）新。合并笔记不换也不标（几篇并成的一篇，换哪篇都不对）
 */
export function planFull(remote: readonly RemoteItem[], vault: ReadonlyMap<string, LocalCopy>, state: SyncState, props: { deleted: string; newer: string }): FullPlan {
  const out: FullPlan = { replace: [], mark: [], deleted: [], dropped: [] }
  const there = new Map(remote.map((r) => [r.id, r]))
  for (const id of Object.keys(state.notes)) if (!vault.has(id)) out.dropped.push(id)
  for (const [id, c] of vault) {
    if (c.merged) continue
    const fm = fmOf(c.text)
    const r = there.get(id)
    if (!r) {
      if (!new RegExp(`^${props.deleted}:`, 'm').test(fm)) out.deleted.push({ id, path: c.path })
      continue
    }
    const mine = state.notes[id]
    const was = mine?.u ?? /^updated:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m.exec(fm)?.[1] ?? ''
    if (!(r.updated > was)) continue
    if (mine && textPrint(c.text) === mine.h) out.replace.push({ id, path: c.path })
    else if (!new RegExp(`^${props.newer}:[ \\t]*["']?${r.updated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(fm)) out.mark.push({ id, path: c.path, updated: r.updated })
  }
  return out
}

/** 多久拉一次 → 下一次几点（只开软件时、只手动是 null） */
export function nextPull(every: SyncEvery, last: Date | null, now: Date): Date | null {
  if (every === 'open' || every === 'manual') return null
  if (every === 'open+22') {
    const t = new Date(now)
    t.setHours(22, 0, 0, 0)
    if (last && last >= t) t.setDate(t.getDate() + 1)
    return t
  }
  const gap = (every === 'open+1h' ? 1 : 2) * 3600_000
  return new Date((last ?? now).getTime() + gap)
}

/** 到点了没有（开软件那一次另算） */
export function pullDue(every: SyncEvery, last: Date | null, now: Date): boolean {
  if (!last) return every !== 'manual' && every !== 'open'
  const next = nextPull(every, last, now)
  return !!next && next.getTime() <= now.getTime()
}

/** 文件名：标题里 / \ : * ? " < > | 换成全角，换行换空格，太长截到 80 个字；开头的点去掉（不成隐藏文件） */
export function sourceFileName(title: string): string {
  const map: Record<string, string> = { '/': '／', '\\': '＼', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' }
  const s = title
    .replace(/[/\\:*?"<>|]/g, (c) => map[c]!)
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
  return [...s].slice(0, 80).join('').trim()
}
