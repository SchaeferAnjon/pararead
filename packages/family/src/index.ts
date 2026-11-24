/**
 * 软件家族（设置 › 软件家族，2026-11-23 用户选方向 A「一张表看全」，task-59o3v）：同一个人做的几个软件，
 * 装了的能打开、开联动，没装的能下载。画布笔记、画布今日、ParaRead 三个软件用同一份。
 *
 * 这里是纯数据和纯函数（不依赖 Electron、Node，iPad 版照着移植）：
 * - 名单的样子（FamilyList）、软件自带的那份（BUILTIN，list.ts）、总站读来的那份怎么认（parseFamily）、两份怎么合（mergeFamily）；
 * - 联动开关存在库里 .canvas-notes/联动.json（LINKS_FILE），两个软件读同一份：怎么读写那几个字（parseLinks、linksJson）；
 * - 一个软件的家族页上该画什么（familyView）：能联动的在前、一个软件一张表，其余收在下面一行一个。
 * 读盘、问系统装没装、联网在 ./node（Node 能用，不依赖 Electron）。
 */

export { BUILTIN } from './list'

export type Lang = 'zh' | 'en'
/** 一句给人看的字：zh 必有，en 缺了用 zh */
export interface Words {
  zh: string
  en?: string
}

export interface FamilyApp {
  /** 名单里的名字，也是图标文件名、联动里 apps 写的那个 */
  id: string
  name: Words
  /** 一句话：这个软件做什么 */
  one: Words
  /** 图标文件（包里 icons/ 下面、总站同名） */
  icon: string
  /** 「下载」打开的网页：有官网开官网（Apple 芯片还是 Intel 在官网上选），没官网开 GitHub 发布页 */
  download: string
  /** 怎么认这台 Mac 上装没装：身份号可以写几个（改名前后、开发版） */
  mac?: { bundleIds: string[]; scheme?: string }
}

/** 开关（存在库里，两个软件里是同一个）/ 状态一句 / 开关在别的页、链过去 / 只说一句 */
export type LinkKind = 'toggle' | 'status' | 'goto' | 'info'

/** 一样联动在某一个软件里怎么说 */
export interface LinkSide {
  /** 不写就用这样联动的 kind */
  kind?: LinkKind
  label: Words
  /** 装了时的说明 */
  desc: Words
  /** 没装时的说明（「装了以后：…」）；不写用 desc */
  off?: Words
  /** 拨开 / 拨关以后提示条说的「已存 · …」 */
  on?: Words
  offDone?: Words
  /** goto、带链接的 status：链到本软件设置里哪一行（各软件自己认） */
  go?: string
  goText?: Words
}

export interface FamilyLink {
  id: string
  /** 哪两个软件之间 */
  apps: [string, string]
  kind: LinkKind
  /** toggle 没拨过时的值：只多放一个按钮的默认开，会往库里写东西的默认关 */
  default?: boolean
  /** 左边小图（各软件按名字画，@cn/design FamilyPic） */
  pic: string
  /** 从哪个版本起会：版本不够的那边写「先更新…」 */
  since?: Record<string, string>
  /** 在哪个软件的家族页上出现、怎么说 */
  in: Record<string, LinkSide>
}

export interface FamilyList {
  version: 1
  /** 哪天改的（YYYY-MM-DD）：两份合的时候新的说了算 */
  updated: string
  apps: FamilyApp[]
  links: FamilyLink[]
}

/** 这台 Mac 上装着的：软件 id → 版本和位置 */
export type Installed = Record<string, { version: string | null; path: string }>

/** 联动开关存在库里的这个文件（跟着 Git 走，换台 Mac 也一样） */
export const LINKS_FILE = '.canvas-notes/联动.json'
/** 总站上的名单 */
export const FAMILY_URL = 'https://apps.us-cloud.uk/family.json'
export const HUB_URL = 'https://apps.us-cloud.uk'
/** 有网时多久看一次总站 */
export const FETCH_EVERY = 24 * 60 * 60 * 1000

export const say = (w: Words | undefined, lang: Lang): string => (w ? (lang === 'en' ? (w.en ?? w.zh) : w.zh) : '')

// ---------- 名单 ----------

const isWords = (v: unknown): v is Words => !!v && typeof v === 'object' && typeof (v as Words).zh === 'string' && ((v as Words).en === undefined || typeof (v as Words).en === 'string')
const KINDS: LinkKind[] = ['toggle', 'status', 'goto', 'info']

function readApp(v: unknown): FamilyApp | null {
  const a = v as FamilyApp
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id || !isWords(a.name) || !isWords(a.one) || typeof a.icon !== 'string' || typeof a.download !== 'string') return null
  if (!/^https:\/\//.test(a.download)) return null
  const ids = a.mac?.bundleIds
  if (a.mac && (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))) return null
  return { id: a.id, name: a.name, one: a.one, icon: a.icon, download: a.download, ...(a.mac ? { mac: { bundleIds: ids!, ...(typeof a.mac.scheme === 'string' ? { scheme: a.mac.scheme } : {}) } } : {}) }
}

function readSide(v: unknown): LinkSide | null {
  const s = v as LinkSide
  if (!s || typeof s !== 'object' || !isWords(s.label) || !isWords(s.desc)) return null
  if (s.kind !== undefined && !KINDS.includes(s.kind)) return null
  for (const k of ['off', 'on', 'offDone', 'goText'] as const) if (s[k] !== undefined && !isWords(s[k])) return null
  if (s.go !== undefined && typeof s.go !== 'string') return null
  return s
}

function readLink(v: unknown): FamilyLink | null {
  const l = v as FamilyLink
  if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !Array.isArray(l.apps) || l.apps.length !== 2 || !l.apps.every((x) => typeof x === 'string')) return null
  if (!KINDS.includes(l.kind) || typeof l.pic !== 'string' || !l.in || typeof l.in !== 'object') return null
  const sides: Record<string, LinkSide> = {}
  for (const [k, s] of Object.entries(l.in)) {
    const side = readSide(s)
    if (side) sides[k] = side
  }
  const since = l.since && typeof l.since === 'object' ? Object.fromEntries(Object.entries(l.since).filter(([, x]) => typeof x === 'string')) : undefined
  return { id: l.id, apps: [l.apps[0], l.apps[1]], kind: l.kind, ...(typeof l.default === 'boolean' ? { default: l.default } : {}), pic: l.pic, ...(since ? { since } : {}), in: sides }
}

/** 总站读来的名单：样子不对的软件、联动丢掉，整份不像名单给 null（用软件带的那份） */
export function parseFamily(json: unknown): FamilyList | null {
  const f = json as FamilyList
  if (!f || typeof f !== 'object' || f.version !== 1 || typeof f.updated !== 'string' || !Array.isArray(f.apps) || !Array.isArray(f.links)) return null
  const apps = f.apps.map(readApp).filter((a): a is FamilyApp => !!a)
  const links = f.links.map(readLink).filter((l): l is FamilyLink => !!l)
  if (!apps.length) return null
  return { version: 1, updated: f.updated, apps, links }
}

/**
 * 软件带的和总站的合成一份：新的（updated 晚的）说了算、按它的先后排，旧的里多出来的接在后面。
 * 软件发版后总站还没更新时，新版带的联动照样在；总站加了新软件，不用等发版就出现。
 */
export function mergeFamily(builtin: FamilyList, remote: FamilyList | null): FamilyList {
  if (!remote) return builtin
  const [a, b] = remote.updated >= builtin.updated ? [remote, builtin] : [builtin, remote]
  const apps = [...a.apps, ...b.apps.filter((x) => !a.apps.some((y) => y.id === x.id))]
  const links = [...a.links, ...b.links.filter((x) => !a.links.some((y) => y.id === x.id))]
  return { version: 1, updated: a.updated, apps, links }
}

/** 版本号比大小（0.10.0 > 0.9.5；「1.139.1-dispatch」只比前面的数） */
export function cmpVersion(a: string, b: string): number {
  const p = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN))
  const x = p(a)
  const y = p(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const m = x[i] ?? 0
    const n = y[i] ?? 0
    if (Number.isNaN(m) || Number.isNaN(n)) break
    if (m !== n) return m < n ? -1 : 1
  }
  return 0
}

// ---------- 库里的联动开关 ----------

/** .canvas-notes/联动.json 读出来：只认 true / false，别的当没拨过；文件坏了（手改、合并冲突）也当没拨过 */
export function parseLinks(text: string | null): Record<string, boolean> {
  if (!text) return {}
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
  } catch (e) {
    if (e instanceof SyntaxError) return {}
    throw e
  }
}

/** 写回去的字：按名字排、两格缩进、末尾换行（两个软件写出来一个字不差，Git 里不出假改动） */
export function linksJson(links: Record<string, boolean>): string {
  const sorted = Object.fromEntries(Object.entries(links).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return JSON.stringify(sorted, null, 2) + '\n'
}

/** 拨了一个以后的文字（原来的字里别的开关原样留着） */
export function setLinkText(text: string | null, id: string, on: boolean): string {
  return linksJson({ ...parseLinks(text), [id]: on })
}

/** 一样联动现在开着没有：拨过的照拨的，没拨过的照名单里的默认 */
export function linkOn(list: FamilyList, links: Record<string, boolean>, id: string): boolean {
  if (id in links) return links[id]!
  return list.links.find((l) => l.id === id)?.default ?? false
}

// ---------- 家族页上画什么 ----------

/** 一行右边放什么 */
export type RowRight =
  | { type: 'toggle'; on: boolean }
  /** 没装：「装了以后能开」（不放点不动的开关） */
  | { type: 'after' }
  /** 版本不够：「先更新{name}」 */
  | { type: 'update'; who: string; name: string }
  /** 没有库可存（ParaRead 找不到画布笔记的库） */
  | { type: 'novault' }
  /** 链到别处设：「在插件里设 ›」 */
  | { type: 'go'; go: string; text: string }
  | null

export interface ViewRow {
  id: string
  pic: string
  label: string
  desc: string
  /** 说明前面一颗绿点（「用同一个库」装了时） */
  dot: boolean
  right: RowRight
  /** 拨开、拨关以后提示条的话 */
  on: string
  offDone: string
}

export interface ViewApp {
  id: string
  name: string
  one: string
  icon: string
  download: string
  installed: { version: string | null; path: string } | null
}

export interface FamilyView {
  /** 能和本软件接上的：一个软件一张表 */
  linked: (ViewApp & { rows: ViewRow[] })[]
  /** 家族里还有：一行一个 */
  more: ViewApp[]
}

export interface ViewInput {
  /** 本软件 */
  host: string
  hostVersion: string
  list: FamilyList
  installed: Installed
  links: Record<string, boolean>
  /** 本软件的代码会的联动（名单里新出现、本软件还不会的写「先更新本软件」） */
  knows: readonly string[]
  lang: Lang
  /** 库的名字（换掉 {vault}）；没有库（ParaRead 找不到画布笔记的库）给 null，开关写「先在画布笔记里开一个库」 */
  vault: string | null
}

/** 一个软件的家族页：能联动的在前（名单里的先后），其余收在下面；本软件自己不列 */
export function familyView(v: ViewInput): FamilyView {
  const name = (id: string) => say(v.list.apps.find((a) => a.id === id)?.name ?? { zh: id }, v.lang)
  const fill = (s: string) => s.replace(/\{vault\}/g, v.vault ?? '')
  const app = (a: FamilyApp): ViewApp => ({ id: a.id, name: say(a.name, v.lang), one: say(a.one, v.lang), icon: a.icon, download: a.download, installed: v.installed[a.id] ?? null })
  const linked: FamilyView['linked'] = []
  const more: ViewApp[] = []
  for (const a of v.list.apps) {
    if (a.id === v.host) continue
    const ls = v.list.links.filter((l) => l.in[v.host] && l.apps.includes(v.host) && l.apps.includes(a.id))
    if (!ls.length) {
      more.push(app(a))
      continue
    }
    const has = v.installed[a.id] ?? null
    const rows = ls.map((l): ViewRow => {
      const s = l.in[v.host]!
      const kind = s.kind ?? l.kind
      const desc = fill(say(has || kind === 'info' ? s.desc : (s.off ?? s.desc), v.lang))
      let right: RowRight = null
      if (kind === 'toggle') {
        const hostOld = l.since?.[v.host] && cmpVersion(v.hostVersion, l.since[v.host]!) < 0
        const otherOld = has?.version && l.since?.[a.id] && cmpVersion(has.version, l.since[a.id]!) < 0
        if (!v.knows.includes(l.id) || hostOld) right = { type: 'update', who: v.host, name: name(v.host) }
        else if (!has) right = { type: 'after' }
        else if (otherOld) right = { type: 'update', who: a.id, name: name(a.id) }
        else if (v.vault === null) right = { type: 'novault' }
        else right = { type: 'toggle', on: linkOn(v.list, v.links, l.id) }
      } else if (s.go && (kind === 'goto' || (kind === 'status' && has))) right = { type: 'go', go: s.go, text: say(s.goText, v.lang) }
      return { id: l.id, pic: l.pic, label: fill(say(s.label, v.lang)), desc, dot: kind === 'status' && !!has, right, on: fill(say(s.on, v.lang)), offDone: fill(say(s.offDone, v.lang)) }
    })
    linked.push({ ...app(a), rows })
  }
  return { linked, more }
}

/** 名单里认这个软件的身份号（问系统装没装用） */
export const bundleIdsOf = (list: FamilyList): Record<string, string[]> => Object.fromEntries(list.apps.filter((a) => a.mac?.bundleIds.length).map((a) => [a.id, a.mac!.bundleIds]))
