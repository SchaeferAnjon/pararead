/**
 * 找本机装的 AI 命令行（CN-87）。从访达打开的 Mac 应用 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * 找不到 Homebrew、npm、bun 装的，也找不到只在 .zshrc 里加进 PATH 的，所以按这个顺序找：
 * 1. 用户在引擎菜单「装在别处？指定位置…」选的（记在 userData/ai/settings.json）；
 * 2. 登录 shell 的 PATH：启动后在后台跑一次 `$SHELL -ilc` 打印 PATH（5 秒超时，结果记着；VS Code 取 shell 环境也是这么做的）；
 * 3. 常见的安装位置：~/.local/bin、Homebrew、npm 全局（含 ~/.npmrc 的 prefix）、bun、volta、pnpm、nvm、fnm、mise、asdf、n；
 * 4. 继承来的 PATH 和系统目录；最后是 Codex.app、ChatGPT.app 包里带的 codex。
 * 找到了还要跑一次 `<命令> --version`（3 秒超时）能跑才算装好（checkCli），和「没装」分开说。子进程的 PATH 也用这一串目录。
 *
 * 找哪些目录最早参照了 Claudian（github.com/yishentu/claudian，MIT，版权 (c) 2025 Yishen Tu）的
 * src/core/process/env.ts 和 cliBinaryLocator.ts，许可声明见仓库根目录 THIRD_PARTY_NOTICES.md。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import type { CliId as EngineId } from './shared'
import { t } from './shared/i18n'

export const COMMAND: Record<EngineId, string> = { claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode' }

/** 没装时怎么装（用到时才取，跟界面语言） */
export const INSTALL_HINT: Record<EngineId, string> = {
  get claude() {
    return t('没找到 claude 命令。装 Claude Code：curl -fsSL https://claude.ai/install.sh | bash，再在终端里运行一次 claude 登录。')
  },
  get codex() {
    return t('没找到 codex 命令。装 Codex：brew install codex 或 npm i -g @openai/codex，再运行一次 codex 登录。')
  },
  get gemini() {
    return t('没找到 gemini 命令。装 Gemini CLI：brew install gemini-cli 或 npm i -g @google/gemini-cli，再运行一次 gemini 登录。')
  },
  get opencode() {
    return t('没找到 opencode 命令。装 OpenCode：brew install opencode 或 curl -fsSL https://opencode.ai/install | bash。')
  },
}

/** 自带命令行的 Mac 应用：包里 Contents/Resources/<命令>（Codex 桌面 App 带着 codex；并进 ChatGPT 桌面 App 以后在 ChatGPT.app 里） */
const APP_BUNDLES: Partial<Record<EngineId, string[]>> = { codex: ['Codex.app', 'ChatGPT.app'] }

/**
 * 一个目录下各个版本的 bin，新版本在前（nvm、fnm、mise 装的 node：npm 全局装的命令在各自版本的 bin 里）。
 * 找命令是挨个看可能的位置，读不了的目录就当这里没有
 */
function versionBins(root: string, sub: string): string[] {
  try {
    return readdirSync(root)
      .filter((v) => !v.startsWith('.'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => join(root, v, sub))
  } catch {
    return []
  }
}

/** npm 全局装到哪：环境变量 NPM_CONFIG_PREFIX，或 ~/.npmrc 里的 prefix（~、${HOME} 换成家目录） */
function npmPrefixBins(home: string, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = []
  const fromEnv = env.NPM_CONFIG_PREFIX || env.npm_config_prefix
  if (fromEnv) out.push(join(fromEnv, 'bin'))
  let rc = ''
  try {
    rc = readFileSync(join(home, '.npmrc'), 'utf8')
  } catch {
    return out // 没有 .npmrc、读不了：就当没设
  }
  const m = /^\s*prefix\s*=\s*(.+?)\s*$/m.exec(rc)
  if (m) {
    const p = m[1]!
      .replace(/^["']|["']$/g, '')
      .replace(/^~(?=\/|$)/, home)
      .replace(/\$\{HOME\}|\$HOME\b/g, home)
    if (p.startsWith('/')) out.push(join(p, 'bin'))
  }
  return out
}

/** 登录 shell 的 PATH（启动后在后台取一次，loadShellPath） */
let shellDirs: string[] = []
let shellLoad: Promise<string[]> | null = null
/** 用户在「装在别处？指定位置…」选的（AgentStore 读设置后交过来） */
let customPaths: Partial<Record<EngineId, string>> = {}

/**
 * 按顺序找的目录：登录 shell 的 PATH 在最前，再是常见安装位置、继承来的 PATH、系统目录。
 * homeOnly：只看家目录下的（单元测试用：这台 Mac 的 /opt/homebrew/bin 里可能真装着）
 */
export function searchDirs(env: NodeJS.ProcessEnv = process.env, shell: string[] = shellDirs, homeOnly = false): string[] {
  const home = env.HOME || homedir()
  const mise = env.MISE_DATA_DIR || join(home, '.local/share/mise')
  const fnm = [env.FNM_DIR, join(home, 'Library/Application Support/fnm'), join(home, '.local/share/fnm'), join(home, '.fnm')].filter((x): x is string => !!x)
  const dirs = [
    ...shell,
    join(home, '.local/bin'),
    join(home, '.claude/local'),
    ...(homeOnly ? [] : ['/opt/homebrew/bin', '/usr/local/bin']),
    ...npmPrefixBins(home, env),
    join(home, '.npm-global/bin'),
    join(home, '.npm-packages/bin'),
    join(home, '.bun/bin'),
    join(home, '.volta/bin'),
    join(home, '.opencode/bin'),
    join(home, 'Library/pnpm'),
    ...(env.PNPM_HOME ? [env.PNPM_HOME] : []),
    join(home, '.yarn/bin'),
    join(home, '.cargo/bin'),
    ...versionBins(join(home, '.nvm/versions/node'), 'bin'),
    ...fnm.flatMap((r) => [join(r, 'aliases/default/bin'), ...versionBins(join(r, 'node-versions'), 'installation/bin')]),
    join(mise, 'shims'),
    ...versionBins(join(mise, 'installs/node'), 'bin'),
    join(env.ASDF_DATA_DIR || join(home, '.asdf'), 'shims'),
    ...(env.N_PREFIX ? [join(env.N_PREFIX, 'bin')] : []),
    join(home, '.n/bin'),
    ...(env.PATH ?? '').split(delimiter),
    ...(homeOnly ? [] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']),
  ]
  return [...new Set(dirs.filter(Boolean))]
}

function isExecutable(p: string): boolean {
  try {
    const s = statSync(p)
    return s.isFile() && (s.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/** 给界面看的「在哪找到」：家目录写成 ~（「~/.local/bin」），App 包里的写「在 Codex.app 里找到」 */
export function whereOf(path: string, home: string): string {
  const app = /\/([^/]+\.app)\/Contents\//.exec(path)
  if (app) return t('在 {app} 里找到', { app: app[1] })
  const dir = dirname(path)
  return dir === home || dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir
}

export interface CliHit {
  path: string
  where: string
  /** 用户自己指定的位置 */
  custom?: true
}

export interface Look {
  env?: NodeJS.ProcessEnv
  /** 登录 shell 的 PATH（默认是启动时取到的那份） */
  shell?: string[]
  /** 用户指定的位置（默认是设置里记着的） */
  custom?: Partial<Record<EngineId, string>>
  /** 只看家目录下的（单元测试用） */
  homeOnly?: boolean
}

/**
 * 端到端测试用（CN_CLI_HOME_ONLY=1）：只在家目录（测试给的临时家目录）里找，登录 shell 和继承来的 PATH 里家目录外的也不看，
 * 不然 /etc/paths.d 带进来的 /opt/homebrew/bin 里这台 Mac 真装着的命令行会被找到
 */
const homeOnlyTest = () => process.env.CN_CLI_HOME_ONLY === '1'

export function locateCli(id: EngineId, o: Look = {}): CliHit | null {
  const env = o.env ?? process.env
  const home = env.HOME || homedir()
  const strict = homeOnlyTest()
  const mine = (o.custom ?? customPaths)[id]
  if (mine && isExecutable(mine)) return { path: mine, where: whereOf(mine, home), custom: true }
  for (const dir of searchDirs(env, o.shell ?? shellDirs, o.homeOnly || strict)) {
    if (strict && dir !== home && !dir.startsWith(home + '/')) continue
    const p = join(dir, COMMAND[id])
    if (isExecutable(p)) return { path: p, where: whereOf(p, home) }
  }
  for (const root of [...(o.homeOnly || strict ? [] : ['/Applications']), join(home, 'Applications')])
    for (const app of APP_BUNDLES[id] ?? []) {
      const p = join(root, app, 'Contents/Resources', COMMAND[id])
      if (isExecutable(p)) return { path: p, where: whereOf(p, home) }
    }
  return null
}

export function findCli(id: EngineId, env: NodeJS.ProcessEnv = process.env): string | null {
  return locateCli(id, { env })?.path ?? null
}

/** 「装在别处？指定位置…」选的：选了 Codex.app 这样的包就用包里带的命令行；能执行的文件才收 */
export function pickedCli(id: EngineId, picked: string): string | null {
  if (/\.app\/?$/.test(picked)) {
    const p = join(picked, 'Contents/Resources', COMMAND[id])
    return isExecutable(p) ? p : null
  }
  return isExecutable(picked) ? picked : null
}

export function setCustomCli(p: Partial<Record<EngineId, string>>) {
  customPaths = { ...p }
}

const MARK = '__CN_SHELL_PATH__'

/**
 * 跑一次登录 shell 打印 PATH：.zshrc 里打印的杂字不算，只取两个标记中间那段。
 * 不给终端（标准输入是空的），.zshrc 里等着回答的提示读到空就过去了；到时间还没完就整组杀掉，返回空（照常用固定的目录）
 */
export function loginShellPath(o: { shell?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<string[]> {
  const env = o.env ?? process.env
  const shell = o.shell ?? (env.SHELL || userInfo().shell || '/bin/zsh')
  // ${PATH} 要带花括号：后面紧跟的标记也是字母和下划线，不带会被读成一个叫 PATH__CN_… 的变量
  const cmd = basename(shell) === 'fish' ? `printf '%s' ${MARK}(string join : $PATH)${MARK}` : `printf '%s' "${MARK}\${PATH}${MARK}"`
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    // 告诉 .zshrc 这是在取环境（想跳过慢的初始化可以认这个变量），不弹 oh-my-zsh 的升级提示
    const child: ChildProcess = spawn(shell, ['-ilc', cmd], { env: { ...env, CN_RESOLVING_ENVIRONMENT: '1', DISABLE_AUTO_UPDATE: 'true' }, stdio: ['ignore', 'pipe', 'ignore'], detached: true })
    const finish = (dirs: string[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve([...new Set(dirs)])
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL') // 进程组已经没了
      }
      finish([])
    }, o.timeoutMs ?? 5000)
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => (out += d))
    child.on('error', () => finish([]))
    child.on('close', () => {
      const a = out.indexOf(MARK)
      const b = a === -1 ? -1 : out.indexOf(MARK, a + MARK.length)
      finish(b === -1 ? [] : out.slice(a + MARK.length, b).split(':').filter((d) => d.startsWith('/')))
    })
  })
}

/** 启动后在后台取一次登录 shell 的 PATH；again：重新取（「重新找一遍」） */
export function loadShellPath(again = false): Promise<string[]> {
  if (again) shellLoad = null
  return (shellLoad ??= loginShellPath().then((d) => (shellDirs = d)))
}

export type CliCheck = { ok: true; version: string } | { ok: false; why: string }
const checked = new Map<string, { key: string; result: CliCheck }>()

function fileKey(path: string): string | null {
  try {
    const s = statSync(path)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return null
  }
}

/** 跑过的 `--version` 结果（文件换过了、没跑过是 undefined） */
export function checkedCli(path: string): CliCheck | undefined {
  const hit = checked.get(path)
  return hit && hit.key === fileKey(path) ? hit.result : undefined
}

const line = (s: string, last: boolean) => {
  const ls = s.split('\n').map((l) => l.trim()).filter(Boolean)
  return (last ? ls[ls.length - 1] : ls[0]) ?? ''
}

/** 找到的命令行能不能跑：`<命令> --version`，timeoutMs 内跑完、退出码 0 才算装好。按路径和修改时间记着，换了版本再跑一次 */
export function checkCli(path: string, timeoutMs = 3000): Promise<CliCheck> {
  const name = basename(path)
  const key = fileKey(path)
  if (!key) return Promise.resolve({ ok: false, why: t('{path} 不在了', { path }) })
  const hit = checked.get(path)
  if (hit?.key === key) return Promise.resolve(hit.result)
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    const finish = (r: CliCheck) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      checked.set(path, { key, result: r })
      resolve(r)
    }
    const child = spawn(path, ['--version'], { env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, why: t('运行 {name} --version {s} 秒没反应', { name, s: +(timeoutMs / 1000).toFixed(1) }) })
    }, timeoutMs)
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => (out += d))
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (err = (err + d).slice(-4000)))
    child.on('error', (e) => finish({ ok: false, why: t('{name} 运行不了：{error}', { name, error: e.message }) }))
    child.on('close', (code, signal) => {
      if (code === 0) return finish({ ok: true, version: line(out, false) || line(err, false) })
      const why = line(err, true) || line(out, true)
      finish({ ok: false, why: why ? t('运行 {name} --version 出错（退出码 {code}）：{why}', { name, code: code ?? signal, why }) : t('运行 {name} --version 出错（退出码 {code}）', { name, code: code ?? signal }) })
    })
  })
}

/** 「重新找一遍」：忘掉跑过的 --version；给了 path 只忘这一个（更新完、「检查更新」时重读这一家的版本） */
export function forgetChecks(path?: string) {
  if (path) checked.delete(path)
  else checked.clear()
}

/** 子进程用的环境：PATH 补全（登录 shell 的在最前；gemini 这类 node 脚本要找得到 node） */
export function cliEnv(extra: Record<string, string> = {}, shell: string[] = shellDirs): NodeJS.ProcessEnv {
  return { ...process.env, PATH: searchDirs(process.env, shell).join(delimiter), ...extra }
}
