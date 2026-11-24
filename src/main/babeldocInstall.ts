// 在软件里装保版面翻译组件 BabelDOC（对照、译文看法用）：第一次点「对照」时装，不进安装包，放在用户缓存里（约 950 MB）。
// BabelDOC 是开源程序（AGPL-3.0），从 PyPI 下到用户电脑上，ParaRead 不重新打包、不改它，只当单独的程序跑（main/babeldoc.ts）。
// 四步，照 MinerU 的安装器（mineruInstall.ts）：
//   1. 下载 uv（装过 MinerU 的就用那一份）  2. uv 建一个带 Python 3.12 的环境
//   3. 装锁死版本的 babeldoc（约 600 MB）   4. babeldoc --warmup 下版面模型和字体（约 337 MB）
// 中途退出、断网下次接着装：uv 的包缓存装完才删，模型和字体是一个文件一个文件下、下好的有校验不再下。
// BabelDOC 的缓存目录写死在 ~/.cache/babeldoc：跑它时把 HOME 指到组件文件夹里的 home/，不碰用户的家目录。
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BABELDOC_MB, BABELDOC_VERSION, type BabelInstallState } from '../shared/layoutTr'
import { t } from '../shared/i18n'
import { dirKb, IS_WIN, killTree, venvExe } from './platform'

const PYTHON = '3.12'
// 各步在总进度里占的位置（按实测用时：装包 17 秒、下模型和字体 39 秒，大头是下载量）
const SPAN: Record<'uv' | 'python' | 'packages' | 'models', [number, number]> = { uv: [0, 2], python: [2, 6], packages: [6, 62], models: [62, 100] }
const PKG_KB = 600_000
const MODEL_KB = 337_000

/** 跑 BabelDOC 的环境变量：HOME 换成组件自己的，缓存、模型、字体都在组件文件夹里 */
export function babelEnv(dir: string): NodeJS.ProcessEnv {
  const home = join(dir, 'home')
  return { ...process.env, HOME: home, USERPROFILE: home, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1', TERM: 'dumb', COLUMNS: '200' }
}

/** 起 BabelDOC 的命令：用环境里的 python 调它的命令行入口（uv 生成的 babeldoc 脚本写死了环境的绝对路径，文件夹挪过就坏） */
export function babelCommand(dir: string): [string, string[]] {
  return [venvExe(join(dir, 'venv'), 'python'), ['-c', 'import sys; from babeldoc.main import cli; sys.argv[0] = "babeldoc"; sys.exit(cli())']]
}

export class BabelInstaller {
  state: BabelInstallState
  private child: ChildProcess | null = null
  private abort: AbortController | null = null
  private running = false

  constructor(
    private dir: string,
    private onState: (s: BabelInstallState) => void,
    private uvFrom: () => string | null = () => null
  ) {
    this.state = { phase: this.installed() ? 'done' : 'none', percent: this.installed() ? 100 : 0, mb: 0, line: '', error: null }
  }

  private marker(): string {
    return join(this.dir, 'installed.json')
  }
  installed(): boolean {
    return existsSync(this.marker()) && existsSync(babelCommand(this.dir)[0])
  }
  /** 装好的版本（没装是 null） */
  version(): string | null {
    return this.installed() ? ((JSON.parse(readFileSync(this.marker(), 'utf8')) as { version?: string }).version ?? null) : null
  }
  /** 上次开始过但没装完 */
  pending(): boolean {
    return existsSync(join(this.dir, 'installing')) && !this.installed()
  }
  busy(): boolean {
    return this.running
  }

  private set(patch: Partial<BabelInstallState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }
  private step(phase: keyof typeof SPAN, frac: number, line?: string): void {
    const [a, b] = SPAN[phase]
    this.set({ phase, percent: Math.max(this.state.percent, Math.round(a + (b - a) * Math.min(1, Math.max(0, frac)))), ...(line === undefined ? {} : { line }) })
  }

  /** 组件被删掉了：回到没装 */
  reset(): void {
    this.set({ phase: 'none', percent: 0, mb: 0, line: '', error: null })
  }

  /** 用户点了暂停：停在这里，下了的留着；下次启动不自动接着装，点「接着装」才装 */
  pause(): void {
    rmSync(join(this.dir, 'installing'), { force: true })
    this.stop()
  }

  /** 退出软件时停下：留着「装到一半」的记号，下次启动接着装 */
  stop(): void {
    this.abort?.abort()
    if (this.child) killTree(this.child)
  }

  async start(): Promise<void> {
    if (this.running || this.installed()) return
    this.running = true
    this.abort = new AbortController()
    mkdirSync(join(this.dir, 'home'), { recursive: true })
    writeFileSync(join(this.dir, 'installing'), String(Date.now()))
    // 接着装时进度不往回退（下了的还在缓存里）
    this.set({ phase: 'uv', line: '', error: null })
    try {
      const uv = await this.getUv()
      const env = { ...babelEnv(this.dir), UV_CACHE_DIR: join(this.dir, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(this.dir, 'python') }
      const venv = join(this.dir, 'venv')
      this.step('python', 0, t('准备 Python 环境'))
      if (!existsSync(venvExe(venv, 'python'))) await this.run(uv, ['venv', '--python', PYTHON, venv], env, 'python')
      this.step('packages', 0, t('下载 BabelDOC（约 600 MB）'))
      await this.run(uv, ['pip', 'install', '--python', venvExe(venv, 'python'), `babeldoc==${BABELDOC_VERSION}`], env, 'packages', { dirs: [join(this.dir, 'uv-cache')], expectKb: PKG_KB, baseMb: 0 })
      this.step('models', 0, t('下载版面模型和字体（约 340 MB）'))
      const [py, pre] = babelCommand(this.dir)
      await this.run(py, [...pre, '--warmup'], env, 'models', { dirs: [join(this.dir, 'home', '.cache', 'babeldoc')], expectKb: MODEL_KB, baseMb: Math.round(PKG_KB / 1024) })
      writeFileSync(this.marker(), JSON.stringify({ version: BABELDOC_VERSION, at: Date.now() }))
      rmSync(join(this.dir, 'installing'), { force: true })
      rmSync(join(this.dir, 'uv-cache'), { recursive: true, force: true })
      this.set({ phase: 'done', percent: 100, mb: BABELDOC_MB, line: '', error: null })
    } catch (e) {
      const stopped = this.abort?.signal.aborted
      this.set({ phase: stopped ? 'none' : 'failed', line: stopped ? t('已暂停，下次接着装') : this.state.line, error: stopped ? null : (e as Error).message })
    } finally {
      this.running = false
      this.child = null
      this.abort = null
    }
  }

  // uv：装过 MinerU 的就拷那一份，没有再从 GitHub 下官方发布的单个可执行文件
  private async getUv(): Promise<string> {
    const bin = join(this.dir, IS_WIN ? 'uv.exe' : 'uv')
    if (existsSync(bin)) return bin
    const other = this.uvFrom()
    if (other && existsSync(other)) {
      copyFileSync(other, bin)
      return bin
    }
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const name = IS_WIN ? `uv-${arch}-pc-windows-msvc` : `uv-${arch}-apple-darwin`
    const url = `https://github.com/astral-sh/uv/releases/latest/download/${name}${IS_WIN ? '.zip' : '.tar.gz'}`
    this.step('uv', 0, t('下载安装工具 uv'))
    const res = await fetch(url, { signal: this.abort!.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(t('下载 uv 失败：{0}', `HTTP ${res.status}`))
    const total = Number(res.headers.get('content-length')) || 0
    const tgz = join(this.dir, IS_WIN ? 'uv.zip' : 'uv.tar.gz')
    let got = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (b: Buffer) => {
      got += b.length
      if (total) this.step('uv', got / total)
    })
    await pipeline(body, createWriteStream(tgz))
    if (IS_WIN) await this.run('tar', ['-xf', tgz, '-C', this.dir, 'uv.exe'], process.env, 'uv')
    else await this.run('/usr/bin/tar', ['-xzf', tgz, '-C', this.dir, '--strip-components', '1', `${name}/uv`], process.env, 'uv')
    rmSync(tgz, { force: true })
    if (!existsSync(bin)) throw new Error(t('uv 解压后没找到可执行文件'))
    return bin
  }

  // 跑一步：输出的最后一行给界面看；uv、warmup 的输出里没有总进度，按下载的文件夹长到多大来算
  private run(cmd: string, args: string[], env: NodeJS.ProcessEnv, phase: keyof typeof SPAN, watch?: { dirs: string[]; expectKb: number; baseMb: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.abort?.signal.aborted) return reject(new Error(t('已停止')))
      const child = spawn(cmd, args, { cwd: this.dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true })
      this.child = child
      let tail = ''
      let frac = 0
      const timer = watch
        ? setInterval(() => {
            void Promise.all(watch.dirs.map((d) => (existsSync(d) ? dirKb(d) : Promise.resolve(0)))).then((kbs) => {
              const kb = kbs.reduce((a, b) => a + b, 0)
              frac = Math.max(frac, Math.min(0.98, kb / watch.expectKb))
              this.set({ mb: Math.max(this.state.mb, watch.baseMb + Math.round(Math.min(kb, watch.expectKb) / 1024)) })
              this.step(phase, frac)
            })
          }, 1500)
        : null
      child.on('close', () => timer && clearInterval(timer))
      const onData = (b: Buffer): void => {
        tail = (tail + b.toString()).slice(-4000)
        const line = tail.split(/[\r\n]/).map((x) => x.trim()).filter(Boolean).pop() ?? ''
        this.step(phase, frac, line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160))
      }
      child.stdout!.on('data', onData)
      child.stderr!.on('data', onData)
      child.on('error', (e) => reject(new Error(`${basename(cmd)}：${e.message}`)))
      child.on('close', (code, sig) => {
        if (code === 0) return resolve()
        const last = tail.split(/[\r\n]/).map((x) => x.trim()).filter(Boolean).slice(-3).join(' · ')
        reject(new Error(sig || this.abort?.signal.aborted ? t('已停止') : `${basename(cmd)} ${t('退出码')} ${code}：${last.slice(0, 300)}`))
      })
    })
  }
}
