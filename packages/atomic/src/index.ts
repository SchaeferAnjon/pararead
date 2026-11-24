/**
 * 原子写（task-8dula）：先写同一个文件夹里的临时文件、fsync，再改名盖过去。
 * 写到一半进程被杀、断电，盘上要么是原来的整份、要么是新的整份，不会有半截；别的程序（Git、同步盘、Obsidian、画布今日）
 * 任何时候读到的都是写完的一份。画布笔记、画布今日的主进程和 packages/git 写文件都走这里；只用 Node，不依赖 Electron。
 *
 * 保留原文件的：权限（chmod 过的 0600 还是 0600）、创建时间（macOS 上文件树按它排「新建的」）、软链接（写到它指着的那个文件）。
 * 换行（CRLF）、BOM、结尾换行是字节的事，调用的人照原文件编好（@cn/format 的 encodeNote）再交进来，这里一个字节不改。
 * 不保留：Finder 标签这类扩展属性（xattr）、硬链接（改名后是新的一个文件）。
 *
 * 临时文件名：`.<原名>.cn-<进程号>-<随机>.tmp`。点开头（文件树、Obsidian、iCloud 的「隐藏文件」都不列），.tmp 结尾（不是 .md，
 * 搜索、梦游、监听都不当笔记），Git 由 packages/git 写进 .git/info/exclude 的 TEMP_GLOB 忽略。
 * 崩溃留下的临时文件下次打开库时 sweepTemps 挪进 `.canvas-notes/回收/`，不直接删。
 */
import { accessSync, closeSync, constants, copyFileSync, fchmodSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, statSync, type Stats, unlinkSync, utimesSync, writeSync } from 'node:fs'
import { access, copyFile, link, lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink, utimes } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'

/** 临时文件名的样子；第 1 组是原名（太长时截短过），第 2 组是写它的进程号 */
export const TEMP_RE = /^\.(.+)\.cn-(\d+)-[0-9a-z]+\.tmp$/
/** 同一个样子的 .gitignore 写法（.git/info/exclude、内部忽略用） */
export const TEMP_GLOB = '.*.cn-*.tmp'
/** 崩溃留下的临时文件挪到库里的这里（相对库根目录） */
export const RECYCLE_DIR = '.canvas-notes/回收'

export function isTempName(name: string): boolean {
  return TEMP_RE.test(name)
}

/** 路径里有没有一段是临时文件（rel 用 / 或系统分隔符都行） */
export function isTempPath(p: string): boolean {
  return isTempName(p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf(sep)) + 1))
}

let seq = 0
/** 和 target 同一个文件夹的临时文件名（同一个卷才能改名盖过去）。原名按字节截到 120，加上后缀不超过 255 字节 */
export function tempPathFor(target: string): string {
  let name = basename(target)
  if (Buffer.byteLength(name) > 120) {
    const cps = Array.from(name)
    while (Buffer.byteLength(cps.join('')) > 120) cps.pop()
    name = cps.join('')
  }
  const rand = `${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return join(dirname(target), `.${name}.cn-${process.pid}-${rand}.tmp`)
}

/** 读到这个文件时它的样子：写之前再看一眼，变了就是外面（别的程序、同步盘）改过 */
export interface FileStamp {
  mtimeMs: number
  size: number
  ino: number
}

export function stampOf(st: Stats): FileStamp {
  return { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino }
}

function sameStamp(st: Stats | null, want: FileStamp | null): boolean {
  if (!st || !want) return !st && !want
  return st.mtimeMs === want.mtimeMs && st.size === want.size && st.ino === want.ino
}

/** 写之前发现文件在外面改过（expect 对不上）：什么都没写，调用的人重读、合并后再写 */
export class ChangedOutsideError extends Error {
  readonly code = 'ECHANGED'
  readonly path: string
  constructor(path: string) {
    super(`写之前发现文件在外面改过：${path}`)
    this.path = path
  }
}

export interface AtomicOptions {
  /** 权限：给了就用它（钥匙、密码这类必须 0600 的）；不给时已有的文件沿用原来的，新文件照 0666 减 umask */
  mode?: number
  /** 只建新文件：目标已经有了报 EEXIST（同 writeFile 的 flag 'wx'），不盖 */
  exclusive?: boolean
  /** 目标必须还是读到时的样子（null：必须还不存在），改名前最后一刻再比一次；不对抛 ChangedOutsideError */
  expect?: FileStamp | null
  /** 文件夹不在就建（默认不建，和 writeFile 一样报 ENOENT） */
  mkdir?: boolean
}

/** 读文件连同读时的样子（同一个打开的文件上 fstat，不会读到这一份、量到下一份）；不在返回 null */
export async function readStamped(path: string): Promise<{ bytes: Buffer; stamp: FileStamp } | null> {
  let fh
  try {
    fh = await open(path, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  try {
    const st = await fh.stat()
    const bytes = await fh.readFile()
    return { bytes, stamp: stampOf(st) }
  } finally {
    await fh.close()
  }
}

const isENOENT = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
/** 文件夹 fsync 在有的文件系统（网络盘、exFAT）上不支持：只有这几种报错可以不管，文件本身已经 fsync 过 */
const DIR_SYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'])
/** 不支持硬链接的文件系统：exclusive 退回「先看有没有、再改名」 */
const LINK_UNSUPPORTED = new Set(['ENOTSUP', 'EPERM', 'EXDEV', 'ENOSYS'])

/** 软链接写到它指着的文件；文件还不在就是这个路径本身 */
async function resolveTarget(path: string): Promise<{ target: string; cur: Stats | null }> {
  let l: Stats
  try {
    l = await lstat(path)
  } catch (e) {
    if (isENOENT(e)) return { target: path, cur: null }
    throw e
  }
  if (!l.isSymbolicLink()) return { target: path, cur: l }
  const target = await realpath(path).catch((e: unknown) => {
    // 指着的文件不在了：写到它该在的地方
    if (isENOENT(e)) return null
    throw e
  })
  if (target === null) return { target: path, cur: null }
  return { target, cur: await stat(target) }
}

function resolveTargetSync(path: string): { target: string; cur: Stats | null } {
  let l: Stats
  try {
    l = lstatSync(path)
  } catch (e) {
    if (isENOENT(e)) return { target: path, cur: null }
    throw e
  }
  if (!l.isSymbolicLink()) return { target: path, cur: l }
  let target: string
  try {
    target = realpathSync(path)
  } catch (e) {
    if (isENOENT(e)) return { target: path, cur: null }
    throw e
  }
  return { target, cur: statSync(target) }
}

function eexist(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`EEXIST: file already exists, '${path}'`), { code: 'EEXIST', errno: -17, syscall: 'open', path })
}

async function syncDir(dir: string) {
  let fh
  try {
    fh = await open(dir, 'r')
    await fh.sync()
  } catch (e) {
    if (!DIR_SYNC_UNSUPPORTED.has((e as NodeJS.ErrnoException).code ?? '')) throw e
  } finally {
    await fh?.close()
  }
}

function syncDirSync(dir: string) {
  let fd: number | null = null
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch (e) {
    if (!DIR_SYNC_UNSUPPORTED.has((e as NodeJS.ErrnoException).code ?? '')) throw e
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/**
 * macOS：改名盖过去以后是一个新文件，创建时间变成现在。把临时文件的修改时间先设成原文件的创建时间（APFS、HFS+ 上
 * 修改时间早于创建时间时，系统把创建时间一起拨回去），再设回现在，盖过去以后创建时间还是原来的
 */
const KEEP_BIRTH = process.platform === 'darwin'

async function keepBirth(tmp: string, cur: Stats) {
  if (!KEEP_BIRTH || !(cur.birthtimeMs > 0)) return
  const now = new Date()
  await utimes(tmp, now, new Date(cur.birthtimeMs))
  await utimes(tmp, now, now)
}

function keepBirthSync(tmp: string, cur: Stats) {
  if (!KEEP_BIRTH || !(cur.birthtimeMs > 0)) return
  const now = new Date()
  utimesSync(tmp, now, new Date(cur.birthtimeMs))
  utimesSync(tmp, now, now)
}

async function place(tmp: string, target: string, o: AtomicOptions) {
  if (o.expect !== undefined) {
    const now = await stat(target).catch((e: unknown) => {
      if (isENOENT(e)) return null
      throw e
    })
    if (!sameStamp(now, o.expect)) throw new ChangedOutsideError(target)
  }
  if (!o.exclusive) return rename(tmp, target)
  try {
    // link 是原子的「有了就失败」：两个程序同时建同一个名字，只有一个成功
    await link(tmp, target)
  } catch (e) {
    if (!LINK_UNSUPPORTED.has((e as NodeJS.ErrnoException).code ?? '')) throw e
    if (await stat(target).then(() => true, (e2: unknown) => (isENOENT(e2) ? false : Promise.reject(e2)))) throw eexist(target)
    return rename(tmp, target)
  }
  await unlink(tmp)
}

function placeSync(tmp: string, target: string, o: AtomicOptions) {
  if (o.expect !== undefined) {
    let now: Stats | null = null
    try {
      now = statSync(target)
    } catch (e) {
      if (!isENOENT(e)) throw e
    }
    if (!sameStamp(now, o.expect)) throw new ChangedOutsideError(target)
  }
  if (!o.exclusive) return renameSync(tmp, target)
  try {
    linkSync(tmp, target)
  } catch (e) {
    if (!LINK_UNSUPPORTED.has((e as NodeJS.ErrnoException).code ?? '')) throw e
    let has = true
    try {
      statSync(target)
    } catch (e2) {
      if (!isENOENT(e2)) throw e2
      has = false
    }
    if (has) throw eexist(target)
    return renameSync(tmp, target)
  }
  unlinkSync(tmp)
}

/** 写前的检查：只建新文件时已经有了、外面已经改过、文件被锁成只读（不能因为改名能成就把锁着的文件换掉） */
function precheck(target: string, cur: Stats | null, o: AtomicOptions) {
  if (cur && o.exclusive) throw eexist(target)
  if (o.expect !== undefined && !sameStamp(cur, o.expect)) throw new ChangedOutsideError(target)
  if (cur && !cur.isFile()) throw Object.assign(new Error(`不是文件：${target}`), { code: 'EISDIR', path: target })
}

/** 原子写一个文件（文字按 UTF-8 写，字节原样写） */
export async function atomicWrite(path: string, data: string | Uint8Array, o: AtomicOptions = {}): Promise<void> {
  if (o.mkdir) await mkdir(dirname(path), { recursive: true })
  const { target, cur } = await resolveTarget(path)
  precheck(target, cur, o)
  if (cur) await access(target, constants.W_OK)
  const tmp = tempPathFor(target)
  const mode = o.mode ?? (cur ? cur.mode & 0o7777 : 0o666)
  try {
    const fh = await open(tmp, 'wx', mode)
    try {
      await fh.writeFile(data)
      // open 的 mode 会被 umask 减掉：原文件的权限、指定的权限照原样设回去
      if (cur || o.mode !== undefined) await fh.chmod(mode)
      await fh.sync()
    } finally {
      await fh.close()
    }
    if (cur) await keepBirth(tmp, cur)
    await place(tmp, target, o)
  } catch (e) {
    await unlink(tmp).catch((e2: unknown) => {
      if (!isENOENT(e2)) throw e2
    })
    throw e
  }
  await syncDir(dirname(target))
}

/** 同上，同步版（退出时、只能同步的地方存设置用） */
export function atomicWriteSync(path: string, data: string | Uint8Array, o: AtomicOptions = {}): void {
  if (o.mkdir) mkdirSync(dirname(path), { recursive: true })
  const { target, cur } = resolveTargetSync(path)
  precheck(target, cur, o)
  if (cur) accessSync(target, constants.W_OK)
  const tmp = tempPathFor(target)
  const mode = o.mode ?? (cur ? cur.mode & 0o7777 : 0o666)
  try {
    const fd = openSync(tmp, 'wx', mode)
    try {
      const buf = typeof data === 'string' ? Buffer.from(data) : data
      for (let off = 0; off < buf.length; ) off += writeSync(fd, buf, off, buf.length - off)
      if (cur || o.mode !== undefined) fchmodSync(fd, mode)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (cur) keepBirthSync(tmp, cur)
    placeSync(tmp, target, o)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch (e2) {
      if (!isENOENT(e2)) throw e2
    }
    throw e
  }
  syncDirSync(dirname(target))
}

/**
 * 原子拷一个文件（附件、图片、视频这种大文件）：拷进临时文件（APFS 上是克隆，不占空间、一下就好）、fsync，再改名过去。
 * 新文件的权限跟着源文件（和 copyFile 一样），盖已有的文件时沿用目标原来的
 */
export async function atomicCopy(src: string, dest: string, o: AtomicOptions = {}): Promise<void> {
  if (o.mkdir) await mkdir(dirname(dest), { recursive: true })
  const { target, cur } = await resolveTarget(dest)
  precheck(target, cur, o)
  if (cur) await access(target, constants.W_OK)
  const tmp = tempPathFor(target)
  try {
    await copyFile(src, tmp, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
    const fh = await open(tmp, 'r+')
    try {
      if (o.mode !== undefined) await fh.chmod(o.mode)
      else if (cur) await fh.chmod(cur.mode & 0o7777)
      await fh.sync()
    } finally {
      await fh.close()
    }
    if (cur) await keepBirth(tmp, cur)
    await place(tmp, target, o)
  } catch (e) {
    await unlink(tmp).catch((e2: unknown) => {
      if (!isENOENT(e2)) throw e2
    })
    throw e
  }
  await syncDir(dirname(target))
}

export function atomicCopySync(src: string, dest: string, o: AtomicOptions = {}): void {
  if (o.mkdir) mkdirSync(dirname(dest), { recursive: true })
  const { target, cur } = resolveTargetSync(dest)
  precheck(target, cur, o)
  if (cur) accessSync(target, constants.W_OK)
  const tmp = tempPathFor(target)
  try {
    copyFileSync(src, tmp, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
    const fd = openSync(tmp, 'r+')
    try {
      if (o.mode !== undefined) fchmodSync(fd, o.mode)
      else if (cur) fchmodSync(fd, cur.mode & 0o7777)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (cur) keepBirthSync(tmp, cur)
    placeSync(tmp, target, o)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch (e2) {
      if (!isENOENT(e2)) throw e2
    }
    throw e
  }
  syncDirSync(dirname(target))
}

/** 这一次没写成的临时文件拿掉（只用在 tempPathFor 给出、自己刚建的临时文件上） */
export async function unlinkTemp(tmp: string): Promise<void> {
  if (!isTempPath(tmp)) throw new Error(`不是临时文件：${tmp}`)
  await unlink(tmp).catch((e: unknown) => {
    if (!isENOENT(e)) throw e
  })
}

/**
 * 别的程序（git bundle、截图工具）已经把内容写进了 tempPathFor(target) 给的临时文件：fsync 后换上去。
 * 出错时临时文件删掉（它只是这一次的半成品）
 */
export async function finishTemp(tmp: string, target: string): Promise<void> {
  try {
    const fh = await open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(tmp, target)
  } catch (e) {
    await unlink(tmp).catch((e2: unknown) => {
      if (!isENOENT(e2)) throw e2
    })
    throw e
  }
  await syncDir(dirname(target))
}

/**
 * 往文件末尾加一段（库里的笔记、记录文件）：读出整份、接上、原子写回。不用 appendFile：追加到一半被杀会留下半行，
 * 别的程序也可能读到半行。文件不在就新建
 */
export async function atomicAppend(path: string, text: string, o: Omit<AtomicOptions, 'exclusive' | 'expect'> = {}): Promise<void> {
  const cur = await readStamped(path)
  const next = cur ? Buffer.concat([cur.bytes, Buffer.from(text)]) : Buffer.from(text)
  await atomicWrite(path, next, { ...o, expect: cur ? cur.stamp : null })
}

/** 同一个文件的几次写排队一个个来（点得快时后点的那次最后落盘）；内容和盘上一样就不写，免得 Git 里多出假改动 */
const queues = new Map<string, Promise<unknown>>()
export function writeQueued(path: string, data: string | Uint8Array, o: AtomicOptions = {}): Promise<void> {
  const run = async () => {
    const cur = await readFile(path).catch((e: unknown) => {
      if (isENOENT(e)) return null
      throw e
    })
    if (cur && Buffer.compare(cur, typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength)) === 0) return
    await atomicWrite(path, data, o)
  }
  const next = (queues.get(path) ?? Promise.resolve()).then(run, run)
  queues.set(path, next)
  // 队尾写完就把这个文件从表里拿掉；出错照样从 next 交给调用的人
  const drop = () => queues.get(path) === next && queues.delete(path)
  next.then(drop, drop)
  return next
}

export interface SweptTemp {
  /** 临时文件原来在哪（相对 root） */
  from: string
  /** 挪到了哪（相对 root） */
  to: string
  /** 它要替换的那个文件（相对 root）；名字截短过认不出时是 null */
  target: string | null
  /** 那个文件还在不在（在：临时文件只是没写完的一次保存，原文件是完整的旧版） */
  targetExists: boolean
  size: number
}

function alive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM：进程在，只是不归我们管
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface SweepOptions {
  /** 挪到哪（绝对路径；默认 root 下的 RECYCLE_DIR） */
  recycle?: string
  /** 不进去找的文件夹名 */
  skipDirs?: readonly string[]
  /** 比这新的不动（可能是另一个程序正在写：画布今日和画布笔记同时开着一个库） */
  minAgeMs?: number
  /** 写它的进程还在时，比这新的也不动 */
  aliveAgeMs?: number
  now?: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeOf = (d: Date) => `${dayOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/**
 * 打开库时：上次崩溃、断电留下的临时文件挪进回收处（不删，`回收/<日期>/<原来的文件夹>/`，去掉开头的点，访达里看得见），
 * 每挪一个在 `回收/记录.txt` 记一行。写它的进程已经不在（或者放了很久）才算残留；临时文件只是没换上去的那一次保存，
 * 原文件还是完整的旧版，所以挪走不丢东西。返回挪了哪些
 */
export async function sweepTemps(root: string, o: SweepOptions = {}): Promise<SweptTemp[]> {
  const recycle = o.recycle ?? join(root, RECYCLE_DIR)
  const skip = new Set(o.skipDirs ?? ['.git', 'node_modules'])
  const minAge = o.minAgeMs ?? 60_000
  const aliveAge = o.aliveAgeMs ?? 6 * 3600_000
  const now = o.now ?? Date.now()
  const found: string[] = []
  const walk = async (dir: string) => {
    if (dir === recycle) return
    let ents
    try {
      ents = await readdir(dir, { withFileTypes: true })
    } catch (e) {
      // 扫的时候文件夹刚被挪走、删掉
      if (isENOENT(e)) return
      throw e
    }
    for (const ent of ents) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) await walk(p)
      } else if (ent.isFile() && isTempName(ent.name)) found.push(p)
    }
  }
  await walk(root)
  const out: SweptTemp[] = []
  const day = new Date(now)
  for (const p of found) {
    const m = TEMP_RE.exec(basename(p))!
    let st: Stats
    try {
      st = await stat(p)
    } catch (e) {
      if (isENOENT(e)) continue
      throw e
    }
    const age = now - st.mtimeMs
    if (age < minAge) continue
    if (alive(Number(m[2])) && age < aliveAge) continue
    const relDir = relative(root, dirname(p))
    const targetAbs = join(dirname(p), m[1]!)
    const targetExists = await stat(targetAbs).then(() => true, (e: unknown) => (isENOENT(e) ? false : Promise.reject(e)))
    const destDir = join(recycle, dayOf(day), relDir)
    await mkdir(destDir, { recursive: true })
    let dest = join(destDir, basename(p).slice(1))
    for (let n = 2; await stat(dest).then(() => true, () => false); n++) dest = join(destDir, `${n}-${basename(p).slice(1)}`)
    await rename(p, dest)
    const item: SweptTemp = {
      from: relative(root, p).split(sep).join('/'),
      to: relative(root, dest).split(sep).join('/'),
      target: relative(root, targetAbs).split(sep).join('/'),
      targetExists,
      size: st.size,
    }
    out.push(item)
    const why = targetExists ? '原文件还在、是完整的旧版，这是没换上去的一次保存' : '原文件不在，这可能是没建成的新文件，内容在这里'
    await atomicAppend(join(recycle, '记录.txt'), `${timeOf(new Date(now))} 挪走崩溃留下的临时文件 ${item.from}（${st.size} 字节，写它的进程 ${m[2]} 已不在；${why}）→ ${item.to}\n`)
  }
  return out
}
