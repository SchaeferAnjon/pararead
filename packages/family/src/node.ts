/**
 * 软件家族在 Node 这边的几件事（主进程用；不依赖 Electron，画布笔记、画布今日、ParaRead 一样用）：
 * - 这台 Mac 上装了哪些（findInstalled）：按身份号问系统（LaunchServices），只认放在「应用程序」里的那份；
 * - 库里的联动开关（readLinks / writeLink / watchLinks）：.canvas-notes/联动.json，哪边拨了两边都变；
 * - 名单每天从总站看一次（loadList / refreshList），没网、总站没有时用软件带的那份。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, unwatchFile, watchFile } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { BUILTIN, bundleIdsOf, cmpVersion, FAMILY_URL, FETCH_EVERY, type FamilyList, type Installed, LINKS_FILE, mergeFamily, parseFamily, parseLinks, setLinkText } from './index'
import { atomicWriteSync } from '@cn/atomic'

// ---------- 装没装 ----------

/**
 * 一次问完名单里所有身份号（系统自带的 osascript 跑 JXA，调 NSWorkspace.URLsForApplicationsWithBundleIdentifier，约 0.5 秒，不弹授权）。
 * 系统认的是「这台 Mac 上有这个软件」，不管放在哪：开发机上项目文件夹里打包出来的那份、Xcode 的 DerivedData、废纸篓里的都会被找到。
 * 所以只认放在「应用程序」里的（/Applications、~/Applications、/System/Applications 和它们下面的文件夹）；几份都在时取版本最新的。
 */
const JXA = `ObjC.import('AppKit')
function run(argv) {
  const ids = JSON.parse(argv[0])
  const ws = $.NSWorkspace.sharedWorkspace
  const out = {}
  for (const id of ids) {
    const urls = ws.URLsForApplicationsWithBundleIdentifier(id)
    const list = []
    for (let i = 0; i < urls.count; i++) {
      const u = urls.objectAtIndex(i)
      const b = $.NSBundle.bundleWithURL(u)
      const v = b.isNil() ? null : b.objectForInfoDictionaryKey('CFBundleShortVersionString')
      list.push({ path: u.path.js, version: v && !v.isNil() ? v.js : null })
    }
    out[id] = list
  }
  return JSON.stringify(out)
}`

/** 放在「应用程序」里（不在项目文件夹、DerivedData、废纸篓里） */
export function inApplications(path: string, home: string): boolean {
  if (path.includes('/.Trash/')) return false
  return ['/Applications/', '/System/Applications/', join(home, 'Applications') + '/'].some((d) => path.startsWith(d))
}

/** 系统找到的几份里挑一份：只要「应用程序」里的，版本新的在前 */
export function pickInstalled(found: Record<string, { path: string; version: string | null }[]>, ids: Record<string, string[]>, home: string): Installed {
  const out: Installed = {}
  for (const [app, bids] of Object.entries(ids)) {
    const all = bids.flatMap((b) => found[b] ?? []).filter((x) => inApplications(x.path, home))
    all.sort((a, b) => cmpVersion(b.version ?? '0', a.version ?? '0'))
    if (all[0]) out[app] = all[0]
  }
  return out
}

/** 问系统：名单里哪些装了。不是 Mac、osascript 出错时报错（调的人决定怎么说） */
export function findInstalled(list: FamilyList, home: string): Promise<Installed> {
  const ids = bundleIdsOf(list)
  const all = [...new Set(Object.values(ids).flat())]
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA, JSON.stringify(all)], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`问系统装了哪些软件没问成：${err.message}`))
      resolve(pickInstalled(JSON.parse(stdout) as Record<string, { path: string; version: string | null }[]>, ids, home))
    })
  })
}

/** 测试模式：装了哪些从一个文件读（{ "canvas-today": "0.3.0" }），测试改了文件再点「装好了，再看一下」就像真装上了 */
export function installedFromFile(file: string): Installed {
  let v: Record<string, string>
  try {
    v = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw e
  }
  return Object.fromEntries(Object.entries(v).map(([id, version]) => [id, { version, path: `/Applications/${id}.app` }]))
}

// ---------- 库里的联动开关 ----------

const linksPath = (vault: string) => join(vault, LINKS_FILE)

export function readLinks(vault: string): Record<string, boolean> {
  try {
    return parseLinks(readFileSync(linksPath(vault), 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw e
  }
}

/** 拨一个：读现在的、只改这一个，先写临时文件再改名（另一个软件同时在读也读不到半截）；返回改完的全部 */
export function writeLink(vault: string, id: string, on: boolean): Record<string, boolean> {
  const p = linksPath(vault)
  let cur: string | null = null
  try {
    cur = readFileSync(p, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const text = setLinkText(cur, id, on)
  if (text !== cur) {
    mkdirSync(dirname(p), { recursive: true })
    atomicWriteSync(p, text)
  }
  return parseLinks(text)
}

/**
 * 另一个软件（或 Git 拉下来）改了联动开关：f 拿到新的。按修改时间每秒看一次（文件不在也能看，建出来就报），
 * 不用 fs.watch：.canvas-notes 文件夹可能还没有，换库时也好停。返回停下的函数
 */
export function watchLinks(vault: string, f: (links: Record<string, boolean>) => void, interval = 1000): () => void {
  const p = linksPath(vault)
  const on = () => f(readLinks(vault))
  watchFile(p, { interval, persistent: false }, on)
  return () => unwatchFile(p, on)
}

// ---------- 名单：软件带的 + 每天从总站看一次 ----------

interface Cache {
  /** 上次看成的时间（总站回了名单） */
  checkedAt: number
  list: unknown
}

function readCache(file: string): Cache | null {
  try {
    const c = JSON.parse(readFileSync(file, 'utf8')) as Cache
    return typeof c.checkedAt === 'number' ? c : null
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null
    throw e
  }
}

/** 现在用的名单（软件带的合上次从总站读来的）和上次看成的时间（从没看成过是 null） */
export function loadList(cacheFile: string, builtin: FamilyList = BUILTIN): { list: FamilyList; checkedAt: number | null } {
  const c = readCache(cacheFile)
  return { list: mergeFamily(builtin, c ? parseFamily(c.list) : null), checkedAt: c?.checkedAt ?? null }
}

/**
 * 到点了（离上次看成过了一天，或从没看成过）就去总站读一次 family.json，读成了存在本机（userData）。
 * 没网、超时、总站还没放名单（404）、名单样子不对：不报错，接着用手里的；返回这次看成没有
 */
export async function refreshList(cacheFile: string, now: number, opts: { url?: string; force?: boolean } = {}): Promise<boolean> {
  const c = readCache(cacheFile)
  if (!opts.force && c && now - c.checkedAt < FETCH_EVERY) return false
  let body: unknown
  try {
    const r = await fetch(opts.url ?? FAMILY_URL, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } })
    if (!r.ok) return false
    body = await r.json()
  } catch {
    // 没网、超时、不是 JSON：这是常有的事，下回再看
    return false
  }
  if (!parseFamily(body)) return false
  mkdirSync(dirname(cacheFile), { recursive: true })
  atomicWriteSync(cacheFile, JSON.stringify({ checkedAt: now, list: body }))
  return true
}

// ---------------------------------------------------------------- ParaRead「放到画布笔记…」：画布笔记开过哪些库、库里的目录

/** 画布笔记装好的软件的设置目录（测试和多开用 CN_USER_DATA，和画布笔记 main/index.ts 同一个规矩） */
export const canvasNotesUserData = (env: NodeJS.ProcessEnv = process.env): string => env.CN_USER_DATA || join(homedir(), 'Library/Application Support/canvas-notes')

/**
 * 画布笔记在这台 Mac 上开过哪些库（读它设置目录里的 settings.json：lastVault、knownVaults，和对外接口 list_vaults 同一个读法），
 * 还在的才列；open 是上次开着的那个。画布笔记没装、没开过库是空的
 */
export function canvasNotesVaults(userData = canvasNotesUserData()): { name: string; path: string; open: boolean }[] {
  let s: { lastVault?: unknown; knownVaults?: unknown }
  try {
    s = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as typeof s
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return []
    throw e
  }
  const last = typeof s.lastVault === 'string' ? s.lastVault : null
  const known = Array.isArray(s.knownVaults) ? s.knownVaults.filter((x): x is string => typeof x === 'string') : []
  return [...new Set([...(last ? [last] : []), ...known])].filter((p) => existsSync(p)).map((p) => ({ name: basename(p), path: p, open: p === last }))
}

export interface VaultFolder {
  /** 库里的相对路径 */
  path: string
  name: string
  /** 下面直接放着几份 PDF */
  pdfs: number
  children: VaultFolder[]
}

/** 库里不算文件夹的：点开头的（.git、.canvas-notes）、附件、node_modules */
const NOT_FOLDER = new Set(['附件', 'node_modules'])

/** 库里的目录树（ParaRead「放到画布笔记…」弹窗选位置用）：depth 层以内，按名字排 */
export function vaultFolders(root: string, depth = 6): VaultFolder[] {
  const walk = (rel: string, left: number): VaultFolder[] => {
    let ents
    try {
      ents = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    return ents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !NOT_FOLDER.has(d.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
      .map((d) => {
        const path = rel ? `${rel}/${d.name}` : d.name
        let pdfs = 0
        try {
          pdfs = readdirSync(join(root, path), { withFileTypes: true }).filter((f) => f.isFile() && /\.pdf$/i.test(f.name)).length
        } catch {
          pdfs = 0
        }
        return { path, name: d.name, pdfs, children: left > 1 ? walk(path, left - 1) : [] }
      })
  }
  return walk('', depth)
}
