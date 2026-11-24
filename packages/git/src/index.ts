/**
 * 调系统 git 命令（SSH、钥匙串直接能用）。每个调用都有超时；git 报错原样抛出。
 */
import { execFile } from 'node:child_process'
import { readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { atomicWrite, finishTemp, RECYCLE_DIR, TEMP_GLOB, tempPathFor, unlinkTemp } from '@cn/atomic'

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export interface GitOptions {
  timeoutMs?: number
}

/**
 * 从访达、程序坞打开的软件只拿到 /usr/bin:/bin 这样的 PATH，Homebrew 装的 git-lfs 这类 git 钩子要用的程序找不到
 * （用户全局 core.hooksPath 里有 Git LFS 的 post-checkout 钩子时，git worktree 会直接失败）。补上常见安装位置，排在继承来的后面。
 */
export function gitPath(path = process.env.PATH ?? ''): string {
  const dirs = [...path.split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  return [...new Set(dirs.filter(Boolean))].join(':')
}

export function git(cwd: string, args: string[], opts: GitOptions = {}, tries = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const ms = opts.timeoutMs ?? 30_000
    // 兜底：软件里偶尔 git 已经退出（ps 里是 <defunct>）、Node 却一直没收到它退出的消息，回调永远不来（端到端测试里约百分之一，
    // 退出软件时就卡在提交上）。超时后再等 5 秒还没回音就算失败，不让调用的一直等
    const deadline = setTimeout(() => reject(new GitError(`git ${args[0]} 没有回音`, args, '')), ms + 5_000)
    try {
      execFile(
        'git',
        ['-c', 'core.quotepath=false', ...args],
        { cwd, timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PATH: gitPath(), GIT_TERMINAL_PROMPT: '0' } },
        (err, stdout, stderr) => {
          clearTimeout(deadline)
          if (err) reject(new GitError(`git ${args[0]} 失败：${stderr.trim() || err.message}`, args, stderr))
          else resolve(stdout)
        },
      )
    } catch (e) {
      clearTimeout(deadline)
      // macOS 上别的线程正好在关文件时（收下几百处、库里几百个文件一起变），起子进程偶尔当场报 EBADF；
      // 进程根本没起来，隔一会儿再起一次就好
      if ((e as NodeJS.ErrnoException).code === 'EBADF' && tries > 1) setTimeout(() => git(cwd, args, opts, tries - 1).then(resolve, reject), 50)
      else reject(e)
    }
  })
}

export async function isRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch (e) {
    if (e instanceof GitError) return false
    throw e
  }
}

export async function init(dir: string): Promise<void> {
  await git(dir, ['init', '-b', 'main'])
  await ensureExcludes(dir)
}

/**
 * Git 不看的软件内部文件（task-8dula）：原子写的临时文件（`.<名字>.cn-<进程>-<随机>.tmp`，保存那一下才有，崩溃会留下）、
 * 崩溃残留挪去的回收处。写进这个库自己的 .git/info/exclude（不进提交、不改用户的 .gitignore）：
 * 软件里的提交、状态（左栏「没提交的」）和终端里的 git 都看不见它们
 */
export const EXCLUDES = [TEMP_GLOB, `/${RECYCLE_DIR}/`]
const excluded = new Map<string, Promise<void>>()
export function ensureExcludes(dir: string): Promise<void> {
  let p = excluded.get(dir)
  if (!p) {
    p = (async () => {
      const rel = (await git(dir, ['rev-parse', '--git-path', 'info/exclude'])).trim()
      const file = isAbsolute(rel) ? rel : join(dir, rel)
      const cur = await readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return ''
        throw e
      })
      const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()))
      const missing = EXCLUDES.filter((l) => !have.has(l))
      if (!missing.length) return
      const head = cur && !cur.endsWith('\n') ? cur + '\n' : cur
      await atomicWrite(file, `${head}# 画布笔记：保存时的临时文件、崩溃残留的回收处\n${missing.join('\n')}\n`, { mkdir: true })
    })()
    // 不是仓库、读不到：下次再试，不把失败记住
    p.catch(() => excluded.delete(dir))
    excluded.set(dir, p)
  }
  return p
}

/** 当前分支；还没有提交时也能拿到名字 */
export async function currentBranch(dir: string): Promise<string> {
  return (await git(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
}

export interface FileStatus {
  path: string
  /** 两个字母的状态，同 git status --porcelain：' M'、'??'、'A ' 等 */
  code: string
  /** 改名（R）、复制（C）的旧路径 */
  from?: string
}

export async function status(dir: string): Promise<FileStatus[]> {
  await ensureExcludes(dir)
  // 不抢 index.lock：界面随时在查状态，抢了锁会让同时进行的提交、撤回失败
  return parseStatus(await git(dir, STATUS_ARGS))
}

export const STATUS_ARGS = ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']

/** git status --porcelain=v1 -z 的输出 → 每个文件的状态 */
export function parseStatus(out: string): FileStatus[] {
  const items: FileStatus[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (!p) continue
    const code = p.slice(0, 2)
    // 改名时下一段是旧路径
    if (code[0] === 'R' || code[0] === 'C') items.push({ path: p.slice(3), code, from: parts[++i]! })
    else items.push({ path: p.slice(3), code })
  }
  return items
}

/** 别的 git 进程正占着 index.lock */
export const isLocked = (e: unknown) => e instanceof GitError && /index\.lock|Unable to create .*\.lock|another git process/i.test(e.stderr || e.message)

/**
 * 要写 index 的那一步（add、commit）撞上别的 git 进程正占着 index.lock（终端、编辑器、测试里不带 --no-optional-locks 的
 * git status 都会短暂占着，软件自己两处同时提交也会）：等一下这一步再来，最多 6 次（共约 1.8 秒）。
 * 不等的话 add 已经暂存、commit 却失败，暂存的改动就一直挂着没提交（删文件夹后留下「D 写作/冰岛/.gitkeep」）。
 * 只重来撞锁的那一步：add 成功后整段重来，已经暂存的删除再 add 会报「pathspec did not match」。
 * 锁一直不放（上次 git 崩了留下的）照样报错。
 */
async function gitLocking(dir: string, args: string[]): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      return await git(dir, args)
    } catch (e) {
      if (!isLocked(e) || i >= 5) throw e
      await new Promise((r) => setTimeout(r, 120 * (i + 1)))
    }
  }
}

/**
 * 提交这一步：查过有要提交的、到真的 commit 之间，软件里另一处提交（自动提交、「现在提交」、AI 那次）可能已经把它们收进去了，
 * git 这时说「nothing to commit」、退出码不是 0。再看一眼还有没有要提交的：没有了就当没有要提交的（返回 false），还有才照样报错
 */
async function commitStep(dir: string, args: string[], pending: () => Promise<boolean>): Promise<boolean> {
  try {
    await gitLocking(dir, args)
    return true
  } catch (e) {
    if (e instanceof GitError && !(await pending())) return false
    throw e
  }
}

/** 把所有改动提交成一次；没有改动时返回 null */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await ensureExcludes(dir)
  await gitLocking(dir, ['add', '-A'])
  if ((await status(dir)).length === 0) return null
  if (!(await commitStep(dir, ['commit', '-q', '-m', message], async () => (await status(dir)).length > 0))) return null
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

/**
 * 工作区里没提交的都提交，说明按改了什么写：先暂存再看状态，git 才认得出改名（「挪了 1 个文件：a → b」，
 * 不是「新增 1 个文件：b；删除 1 个：a」）。没有要提交的返回 null
 */
export async function commitPending(dir: string): Promise<string | null> {
  await ensureExcludes(dir)
  await gitLocking(dir, ['add', '-A'])
  const st = await status(dir)
  if (!st.length) return null
  if (!(await commitStep(dir, ['commit', '-q', '-m', describeChanges(st)], async () => (await status(dir)).length > 0))) return null
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

export interface Commit {
  hash: string
  date: string
  subject: string
  files: { path: string; added: number; removed: number }[]
}

/**
 * 软件自己的文件（CN-116）：`.canvas-notes/` 下面的全部（首页、左栏、置顶、对话、字幕）、画布今日的 `.canvas-tasks/`（提醒记录）、
 * 各文件夹的 `.首页.json` 和首页模板 `.首页模板.json`、空文件夹的 `.gitkeep`。提交说明不写它们，历史默认不列
 */
export function isInternalPath(p: string): boolean {
  const base = p.slice(p.lastIndexOf('/') + 1)
  return p === '.canvas-notes' || p.startsWith('.canvas-notes/') || p === '.canvas-tasks' || p.startsWith('.canvas-tasks/') || base === '.首页.json' || base === '.首页模板.json' || base === '.gitkeep'
}

/**
 * 读历史时排除的路径（git 自己跳过只动了这些的提交，「最近100次」全是用户的改动；混着的提交只列用户的文件）。
 * `.gitkeep` 不排除：新建文件夹那次只有它，历史里列成「课程/ecpc/」一行
 */
export const HIDE_INTERNAL = ['.', ':(exclude).canvas-notes', ':(exclude).canvas-tasks', ':(exclude)*/.首页.json', ':(exclude)*/.首页模板.json']

/** rev：从哪次提交往前数（不给是 HEAD）；paths：只看这些路径（git 的 pathspec，比如 HIDE_INTERNAL） */
export async function log(dir: string, limit = 50, rev?: string, paths?: readonly string[]): Promise<Commit[]> {
  if (rev !== undefined && !/^[0-9a-f]{7,40}$/.test(rev)) throw new Error('提交号不对')
  let out: string
  try {
    out = await git(dir, ['log', `-n${limit}`, '--format=%x1e%H%x1f%aI%x1f%s', '--numstat', '-z', ...(rev ? [rev] : []), ...(paths ? ['--', ...paths] : [])])
  } catch (e) {
    // 还没有任何提交
    if (e instanceof GitError && /does not have any commits|bad default revision/.test(e.stderr)) return []
    throw e
  }
  const commits: Commit[] = []
  for (const rec of out.split('\x1e')) {
    if (!rec.trim()) continue
    // 用了 -z 之后头一行以 \0 结尾
    const nl = rec.search(/[\0\n]/)
    const head = nl === -1 ? rec : rec.slice(0, nl)
    const [hash, date, subject] = head.split('\x1f') as [string, string, string]
    const files: Commit['files'] = []
    const rest = nl === -1 ? '' : rec.slice(nl + 1)
    const parts = rest.split('\0')
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i]!.trimStart().match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
      if (!m) continue
      // 挪了、改了名的：-z 下这一条路径是空的，后面跟着旧路径、新路径两段；记新路径
      let path = m[3]!
      if (!path) {
        path = parts[i + 2] ?? ''
        i += 2
      }
      if (path) files.push({ path, added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) })
    }
    commits.push({ hash, date, subject, files })
  }
  return commits
}

export async function hasRemote(dir: string): Promise<boolean> {
  return (await git(dir, ['remote'])).trim() !== ''
}

/** 第一个远程仓库的名字和地址；没有远程时是 null */
export async function remote(dir: string): Promise<{ name: string; url: string } | null> {
  const name = (await git(dir, ['remote'])).trim().split('\n')[0]
  if (!name) return null
  return { name, url: (await git(dir, ['remote', 'get-url', name])).trim() }
}

/** 设远程仓库地址：已有就改第一个，没有就加一个叫 origin 的。只改本机配置，不联网 */
export async function setRemote(dir: string, url: string): Promise<void> {
  const u = url.trim()
  if (!u || /\s/.test(u) || u.startsWith('-')) throw new Error('远程地址不对')
  const cur = await remote(dir)
  if (cur) await git(dir, ['remote', 'set-url', cur.name, u])
  else await git(dir, ['remote', 'add', 'origin', u])
}

export interface Identity {
  name: string
  email: string
  /** 写在这个库自己的配置里（.git/config），不是全局的 */
  local: boolean
}

/** 读一项配置；没设返回 null（git config --get 没找到时退出码是 1） */
async function configGet(dir: string, key: string, scope: string[] = []): Promise<string | null> {
  try {
    return (await git(dir, ['config', ...scope, '--get', key])).trim() || null
  } catch (e) {
    if (e instanceof GitError) return null
    throw e
  }
}

/** 提交用的署名（全局、系统、库里哪层设的都算）；名字或邮箱缺一样就是 null */
export async function identity(dir: string): Promise<Identity | null> {
  const [name, email, localName, localEmail] = await Promise.all([
    configGet(dir, 'user.name'),
    configGet(dir, 'user.email'),
    configGet(dir, 'user.name', ['--local']),
    configGet(dir, 'user.email', ['--local']),
  ])
  if (!name || !email) return null
  return { name, email, local: !!(localName && localEmail) }
}

/** 给这个库设署名（只写 .git/config，不碰全局） */
export async function setIdentity(dir: string, name: string, email: string): Promise<void> {
  const n = name.trim()
  const m = email.trim()
  if (!n || /[<>\n]/.test(n)) throw new Error('名字不能空着，也不能有尖括号')
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(m)) throw new Error('邮箱要写成「名字@地方」的样子')
  await git(dir, ['config', '--local', 'user.name', n])
  await git(dir, ['config', '--local', 'user.email', m])
}

/**
 * 这台 Mac 上 git 没有署名（新 Mac 常见：全局、库里都没设）时，所有提交都会报「作者身份未知」。
 * 缺哪样就在这个库里补哪样（fallback 是软件猜的名字和邮箱），返回补了什么；已经有就什么都不做、返回 null
 */
export async function ensureIdentity(dir: string, fallback: { name: string; email: string }): Promise<{ name?: string; email?: string } | null> {
  const [name, email] = await Promise.all([configGet(dir, 'user.name'), configGet(dir, 'user.email')])
  if (name && email) return null
  const set: { name?: string; email?: string } = {}
  if (!name) await git(dir, ['config', '--local', 'user.name', (set.name = fallback.name)])
  if (!email) await git(dir, ['config', '--local', 'user.email', (set.email = fallback.email)])
  return set
}

/** 只动了软件自己的文件时，这一处的人话（「改了左栏设置」「改了「ecp」的首页」「新建文件夹：课程/ecpc」） */
function internalSay(f: FileStatus): string {
  const p = f.path
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
  const last = dir.slice(dir.lastIndexOf('/') + 1)
  const base = p.slice(p.lastIndexOf('/') + 1)
  if (base === '.gitkeep') return f.code.includes('D') ? `删了文件夹：${dir}` : `新建文件夹：${dir}`
  if (base === '.首页.json') return `改了「${last}」的首页`
  if (base === '.首页模板.json') return `改了「${last}」的首页模板`
  if (p === '.canvas-notes/左栏.json') return '改了左栏设置'
  if (p === '.canvas-notes/置顶.json') return '改了置顶'
  if (p === '.canvas-notes/首页.json') return '改了首页'
  if (p === '.canvas-notes/anki.json') return '记了送进Anki的疑惑'
  if (p.startsWith('.canvas-notes/对话/')) return '存了AI对话'
  if (p.startsWith('.canvas-notes/字幕/')) return '存了字幕'
  if (p.startsWith('.canvas-tasks/提醒/')) return '记了提醒'
  return '改了软件设置'
}

/**
 * 提交说明：「更新 3 个文件：所思所想、旅行、收件箱/2026-11-15 1403」；新加的写「新增」，删掉的写「删除」，
 * 挪走的（这边删了、别处新加了同名的）写「挪了 1 个：删测/丁 → 写作/丁」；几样都有时按 更新、新增、挪了、删除 分开写，
 * 第一样写「个文件」（「更新 2 个文件：甲、乙；删除 1 个：丙」）。
 * 软件自己的文件（isInternalPath）不写进说明、不算个数；只动了它们时写人话「改了左栏设置」（CN-116）
 */
export function describeChanges(all: FileStatus[]): string {
  const files = all.filter((f) => !isInternalPath(f.path))
  if (!files.length) return [...new Set(all.map(internalSay))].join('；')
  const name = (p: string) => p.replace(/\.md$/i, '')
  const list = (fs: string[]) => fs.slice(0, 3).join('、') + (fs.length > 3 ? ' 等' : '')
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  const isNew = (f: FileStatus) => f.code === '??' || f.code[0] === 'A'
  const gone = files.filter((f) => f.code.includes('D'))
  const added = files.filter((f) => !f.code.includes('D') && isNew(f))
  // 挪走：这边删了、别处新加了同名的（或者 git 自己认出的改名）
  const moves: string[] = files.filter((f) => f.code[0] === 'R' && f.from).map((f) => `${name(f.from!)} → ${name(f.path)}`)
  const paired = new Set<FileStatus>()
  for (const g of gone) {
    const to = added.find((a) => !paired.has(a) && base(a.path) === base(g.path))
    if (!to) continue
    paired.add(g).add(to)
    moves.push(`${name(g.path)} → ${name(to.path)}`)
  }
  const groups: [string, string[]][] = [
    ['更新', files.filter((f) => !f.code.includes('D') && !isNew(f) && f.code[0] !== 'R').map((f) => name(f.path))],
    ['新增', added.filter((f) => !paired.has(f)).map((f) => name(f.path))],
    ['挪了', moves],
    ['删除', gone.filter((f) => !paired.has(f)).map((f) => name(f.path))],
  ]
  return groups
    .filter(([, fs]) => fs.length)
    .map(([what, fs], i) => `${what} ${fs.length} 个${i === 0 ? '文件' : ''}：${list(fs)}`)
    .join('；')
}

/** 从 since 起的提交数 */
export async function countCommitsSince(dir: string, since: Date): Promise<number> {
  try {
    return Number((await git(dir, ['rev-list', '--count', `--since=${since.toISOString()}`, 'HEAD'])).trim())
  } catch (e) {
    if (e instanceof GitError && /unknown revision|ambiguous argument 'HEAD'/.test(e.stderr)) return 0
    throw e
  }
}

export type SyncResult =
  | { kind: 'no-remote' }
  /** 远程和本地改了同一处，已经退回同步前的样子 */
  | { kind: 'conflict'; message: string }
  | { kind: 'ok'; committed: string | null; pulled: number; pushed: boolean }

export type PullResult = { kind: 'no-remote' } | { kind: 'conflict'; message: string } | { kind: 'ok'; committed: string | null; pulled: number }

/**
 * 拉：先把本地改动提交，再取远程、rebase 到远程上（不推）。打开库时先拉一次（设置 › Git和同步）用它，同步也是先走这一步。
 * rebase 冲突时 abort，库回到拉之前，交给用户处理。
 */
export async function pull(dir: string, opts: GitOptions = {}): Promise<PullResult & { remote?: string; branch?: string; remoteHead?: string | null; before?: string | null }> {
  if (!(await hasRemote(dir))) return { kind: 'no-remote' }
  const timeoutMs = opts.timeoutMs ?? 60_000
  const st = await status(dir)
  const committed = st.length ? await commitAll(dir, describeChanges(st)) : null
  const branch = await currentBranch(dir)
  const remote = (await git(dir, ['remote'])).trim().split('\n')[0]!
  const before = await revParse(dir, 'HEAD')

  await git(dir, ['fetch', remote], { timeoutMs })
  const remoteHead = await revParse(dir, `${remote}/${branch}`)
  let pulled = 0
  if (remoteHead) {
    pulled = Number((await git(dir, ['rev-list', '--count', `HEAD..${remote}/${branch}`])).trim())
    if (pulled > 0) {
      try {
        await git(dir, ['rebase', `${remote}/${branch}`], { timeoutMs })
      } catch (e) {
        if (!(e instanceof GitError)) throw e
        await git(dir, ['rebase', '--abort']).catch(() => undefined)
        return { kind: 'conflict', message: e.message }
      }
    }
  }
  return { kind: 'ok', committed, pulled, remote, branch, remoteHead, before }
}

/**
 * 同步：先把本地改动提交，再 pull --rebase，再 push。
 * rebase 冲突时 abort，库回到同步前，交给用户处理。
 */
export async function sync(dir: string, opts: GitOptions = {}): Promise<SyncResult> {
  const p = await pull(dir, opts)
  if (p.kind !== 'ok') return p.kind === 'no-remote' ? { kind: 'no-remote' } : { kind: 'conflict', message: p.message }
  const { remote, branch, remoteHead, before } = p as Required<typeof p>
  const remoteRef = `${remote}/${branch}`
  const ahead = remoteHead ? Number((await git(dir, ['rev-list', '--count', `${remoteRef}..HEAD`])).trim()) : before ? 1 : 0
  if (ahead > 0) await git(dir, ['push', '-u', remote, `HEAD:${branch}`], { timeoutMs: opts.timeoutMs ?? 60_000 })
  return { kind: 'ok', committed: p.committed, pulled: p.pulled, pushed: ahead > 0 }
}

/**
 * 备一份整个库的历史（设置 › Git和同步「每天备份一份到」）：git bundle 打成一个文件，先写临时文件再换名，
 * 写到一半断了也不坏上一份。要找回时 git clone 这个文件就是一个完整的库
 */
export async function bundle(dir: string, file: string): Promise<void> {
  const tmp = tempPathFor(file)
  try {
    await git(dir, ['bundle', 'create', tmp, '--all'], { timeoutMs: 10 * 60_000 })
  } catch (e) {
    await unlinkTemp(tmp)
    throw e
  }
  await finishTemp(tmp, file)
}

async function revParse(dir: string, ref: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', '--verify', '--quiet', ref])).trim() || null
  } catch (e) {
    if (e instanceof GitError) return null
    throw e
  }
}

/** 只提交这几个路径（新建、修改、删除都算）；返回提交号，没有改动返回 null */
export async function commitPaths(dir: string, paths: string[], message: string): Promise<string | null> {
  if (!paths.length) return null
  await ensureExcludes(dir)
  // 已经暂存了删除的（文件不在了、index 里也没了）不再 add：add 会报「pathspec did not match」，整次提交失败
  const inIndex = new Set((await git(dir, ['ls-files', '-z', '--', ...paths])).split('\0'))
  const onDisk = await Promise.all(paths.map((p) => stat(join(dir, p)).then(() => true, () => false)))
  const toAdd = paths.filter((p, i) => onDisk[i] || inIndex.has(p))
  if (toAdd.length) await gitLocking(dir, ['add', '-A', '--', ...toAdd])
  const staged = (await git(dir, ['diff', '--cached', '--name-only', '-z', '--', ...paths])).split('\0').filter(Boolean)
  if (!staged.length) return null
  const pending = async () => (await git(dir, ['status', '--porcelain', '-z', '--', ...paths])).split('\0').some(Boolean)
  if (!(await commitStep(dir, ['commit', '-q', '-m', message, '--', ...paths], pending))) return null
  // 取「最近一次改了这几个文件的提交」，不取 HEAD：提交完到这里之间软件里别处（视频条存字幕全文、自动提交）可能又提交了一次，
  // HEAD 就是别人的那次了，AI 回答下面的改动块、「打开」、撤回会指到别人那次上
  return (await git(dir, ['log', '-1', '--format=%H', '--', ...paths])).trim()
}

export interface RevertOptions {
  /** 提交说明（不给是「撤回」+ 原来那次的说明，比如「撤回AI：加一行」） */
  message?: string
  /**
   * 按行合不了的文件再试一次：base 是要撤回的那次提交里的样子，ours 是现在的，theirs 是那次提交之前的；
   * 返回合好的字，合不了给 null
   */
  resolve?(base: string, ours: string, theirs: string, path: string): string | null
  /** 还是合不了时报的那句（files 是合不了的文件） */
  conflict?(files: string[]): string
}

/** 撤回一次提交：再做一次反向提交，返回新的提交号。合不了就退回撤回之前，什么都不动 */
export async function revert(dir: string, hash: string, o: RevertOptions = {}): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('提交号不对')
  const fail = async (files: string[]) => {
    await git(dir, ['revert', '--abort']).catch(() => undefined)
    return new Error(o.conflict?.(files) ?? '撤回不了：那之后这几处又被改过了，需要手动处理。')
  }
  // 不给说明：用中文「撤回」接上原来那次的说明（AI、剪藏、导入、视频的撤回都走这里；git 自己的是英文「Revert "…"」）
  const message = o.message ?? `撤回${(await git(dir, ['log', '-1', '--format=%s', hash])).trim()}`
  try {
    if (!o.resolve) {
      // 不用按字合并的：照旧一步撤回（git 要求暂存区干净，不会把别的东西带进来），再把说明换成中文
      await git(dir, ['revert', '--no-edit', hash])
    } else await git(dir, ['revert', '--no-commit', hash])
  } catch (e) {
    if (!(e instanceof GitError)) throw e
    const files = (await git(dir, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean)
    if (!o.resolve || !files.length) throw await fail(files)
    const merged: [string, string][] = []
    for (const f of files) {
      const stage = (n: number) => git(dir, ['show', `:${n}:${f}`]).catch(() => null)
      const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
      const text = base !== null && ours !== null && theirs !== null ? o.resolve(base, ours, theirs, f) : null
      if (text === null) throw await fail(files)
      merged.push([f, text])
    }
    for (const [f, text] of merged) await atomicWrite(join(dir, f), text)
    await git(dir, ['add', '--', ...files])
  }
  await git(dir, o.resolve ? ['commit', '-q', '-m', message] : ['commit', '--amend', '-q', '-m', message])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

/** 最近一次改到这几个路径的提交号；从没提交过返回 null */
export async function lastCommitOf(dir: string, paths: string[]): Promise<string | null> {
  if (!paths.length) return null
  try {
    return (await git(dir, ['log', '-1', '--format=%H', '--', ...paths])).trim() || null
  } catch (e) {
    if (e instanceof GitError && /does not have any commits|bad default revision/.test(e.stderr)) return null
    throw e
  }
}

/**
 * 只撤回一次提交里 paths 这几个文件的改动（自动提交把 AI 改的和别处正写着的字一起收进去了，撤回只撤 AI 的那几个）：
 * 把那几个文件的改动反着打回去，再只提交它们，返回新的提交号。那之后这几个文件又被改过、打不回去：什么都不动，报「撤回不了」
 */
export async function revertPaths(dir: string, hash: string, paths: string[], message: string): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('提交号不对')
  const patch = await git(dir, ['diff', '--binary', '-M', `${hash}^`, hash, '--', ...paths])
  if (!patch.trim()) throw new Error('那次提交里没有这几个文件的改动')
  const rel = (await git(dir, ['rev-parse', '--git-path', 'cn-revert.patch'])).trim()
  const file = isAbsolute(rel) ? rel : join(dir, rel)
  await atomicWrite(file, patch)
  try {
    // 不加 --3way：打不上就整个不动（git apply 要么全打上，要么一个文件都不改）
    await git(dir, ['apply', '-R', file])
  } catch (e) {
    if (!(e instanceof GitError)) throw e
    throw new Error('撤回不了：那之后这几处又被改过了，需要手动处理。')
  } finally {
    await rm(file, { force: true })
  }
  const done = await commitPaths(dir, paths, message)
  if (!done) throw new Error('那次提交里没有这几个文件的改动')
  return done
}

/** since 以来每次提交的时间（毫秒）和改了哪些文件，新的在前 */
export async function commitsSince(dir: string, since: Date): Promise<{ t: number; files: string[] }[]> {
  let out: string
  try {
    out = await git(dir, ['log', `--since=${since.toISOString()}`, '--format=%x1e%at', '--name-only'])
  } catch (e) {
    if (e instanceof GitError && /does not have any commits|bad default revision/.test(e.stderr)) return []
    throw e
  }
  return out
    .split('\x1e')
    .filter((r) => r.trim())
    .map((r) => {
      const [t, ...files] = r.trim().split('\n')
      return { t: Number(t) * 1000, files: files.filter(Boolean) }
    })
}

export interface LineTimes {
  /** 工作区里这个文件的每一行 */
  lines: string[]
  /** 每一行所在提交的作者时间（毫秒）；还没提交的行是 0 */
  at: number[]
}

/**
 * 解析 `git blame --porcelain`：每一行字前面一行头「提交号 原行号 现行号 [行数]」，同一提交第一次出现时跟着 author-time 等几行，
 * 再出现就不带了，所以按提交号记时间；字是 tab 开头的那一行。全 0 的提交号是还没提交的字（时间记 0）。
 */
export function parseBlame(out: string): LineTimes {
  const time = new Map<string, number>()
  const lines: string[] = []
  const at: number[] = []
  let sha = ''
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) {
      lines.push(l.slice(1))
      at.push(/^0+$/.test(sha) ? 0 : (time.get(sha) ?? 0))
      continue
    }
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(l)
    if (head) sha = head[1]!
    else if (l.startsWith('author-time ')) time.set(sha, Number(l.slice('author-time '.length)) * 1000)
  }
  return { lines, at }
}

/** 这个文件（工作区里的字）每一行是哪次提交写的、作者时间；库里还没有它的历史（没跟踪、还没有任何提交）返回 null */
export async function lineTimes(dir: string, path: string): Promise<LineTimes | null> {
  try {
    return parseBlame(await git(dir, ['blame', '--porcelain', '--', path]))
  } catch (e) {
    if (e instanceof GitError && /no such ref: HEAD|no such path .* in HEAD|does not have any commits/.test(e.stderr)) return null
    throw e
  }
}
