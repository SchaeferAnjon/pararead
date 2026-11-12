// 在软件里装 MinerU（精细重排的引擎）：普通用户的电脑上没有 Python，也没有 MinerU。
// 四步，全放在数据目录的 mineru/ 里，不动系统：
//   1. 下载 uv（一个可执行文件，管 Python 和包）  2. uv 建一个带 Python 3.12 的环境
//   3. 装 mineru（带 PyTorch，约 1.3 GB）        4. 下载版面、公式、表格、OCR 模型（约 850 MB，放在 ~/.mineru/models）
// 中途退出下次接着来（uv 和模型下载都有缓存、能续）。装好后把设置里的 mineruPath 指过去。
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { t } from '../shared/i18n'

// 这个版本在本机实测过（4.0.12）；升级要先测重排的输出格式
const MINERU_VERSION = '4.0.12'
const PYTHON = '3.12'

export type MineruPhase = 'none' | 'uv' | 'python' | 'packages' | 'models' | 'done' | 'failed'
export interface MineruInstallState {
  phase: MineruPhase
  percent: number // 0 到 100，按四步的大致用时加权
  line: string // 当前在做什么，或最后一行输出
  error: string | null
}

// 各步在总进度里占的位置
const SPAN: Record<'uv' | 'python' | 'packages' | 'models', [number, number]> = { uv: [0, 3], python: [3, 8], packages: [8, 60], models: [60, 100] }

export class MineruInstaller {
  state: MineruInstallState
  private child: ChildProcess | null = null
  private abort: AbortController | null = null
  private running = false

  constructor(
    private dir: string,
    private onState: (s: MineruInstallState) => void,
    private onDone: (command: string) => void
  ) {
    this.state = { phase: existsSync(this.command()) && existsSync(this.marker()) ? 'done' : 'none', percent: 0, line: '', error: null }
  }

  command(): string {
    return join(this.dir, 'venv', 'bin', 'mineru-kit')
  }
  private marker(): string {
    return join(this.dir, 'installed.json')
  }
  /** 上次开始过但没装完：下次启动接着装 */
  pending(): boolean {
    return existsSync(join(this.dir, 'installing')) && this.state.phase !== 'done'
  }

  private set(patch: Partial<MineruInstallState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  private step(phase: keyof typeof SPAN, frac: number, line?: string): void {
    const [a, b] = SPAN[phase]
    this.set({ phase, percent: Math.round(a + (b - a) * Math.min(1, Math.max(0, frac))), ...(line === undefined ? {} : { line }) })
  }

  stop(): void {
    this.abort?.abort()
    if (this.child?.pid) {
      try {
        process.kill(-this.child.pid, 'SIGKILL')
      } catch {
        this.child.kill('SIGKILL')
      }
    }
  }

  async start(): Promise<void> {
    if (this.running || this.state.phase === 'done') return
    this.running = true
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, 'installing'), String(Date.now()))
    this.set({ phase: 'uv', percent: 0, line: '', error: null })
    try {
      const uv = await this.getUv()
      const env = { ...process.env, UV_CACHE_DIR: join(this.dir, 'cache'), UV_PYTHON_INSTALL_DIR: join(this.dir, 'python'), PYTHONUNBUFFERED: '1' }
      const venv = join(this.dir, 'venv')
      this.step('python', 0, t('准备 Python 环境'))
      if (!existsSync(join(venv, 'bin', 'python'))) await this.run(uv, ['venv', '--python', PYTHON, venv], env, 'python')
      this.step('packages', 0, t('下载 MinerU 和 PyTorch（约 1.3 GB）'))
      // uv 和模型下载的输出里没有总进度：按下载目录长到多大来算（包先进 uv 的缓存，约 1.3 GB；模型约 850 MB）
      await this.run(uv, ['pip', 'install', '--python', join(venv, 'bin', 'python'), `mineru==${MINERU_VERSION}`], env, 'packages', { dir: join(this.dir, 'cache'), expectKb: 1_300_000 })
      this.step('models', 0, t('下载识别模型（约 850 MB）'))
      await this.run(this.command(), ['models', 'download', '--tier', 'basic'], env, 'models', { dir: join(homedir(), '.mineru', 'models'), expectKb: 850_000 })
      await this.run(this.command(), ['--version'], env, 'models')
      writeFileSync(this.marker(), JSON.stringify({ version: MINERU_VERSION, at: Date.now() }))
      rmSync(join(this.dir, 'installing'), { force: true })
      rmSync(join(this.dir, 'cache'), { recursive: true, force: true })
      this.set({ phase: 'done', percent: 100, line: '', error: null })
      this.onDone(this.command())
    } catch (e) {
      const stopped = this.abort?.signal.aborted
      this.set({ phase: stopped ? 'none' : 'failed', error: stopped ? null : (e as Error).message })
    } finally {
      this.running = false
      this.child = null
      this.abort = null
    }
  }

  // uv：官方发布的单个可执行文件。Mac 上已经装了 uv 的也用自己这份，版本一致
  private async getUv(): Promise<string> {
    const bin = join(this.dir, 'uv')
    if (existsSync(bin)) return bin
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const name = `uv-${arch}-apple-darwin`
    const url = `https://github.com/astral-sh/uv/releases/latest/download/${name}.tar.gz`
    this.step('uv', 0, t('下载安装工具 uv'))
    this.abort = new AbortController()
    const res = await fetch(url, { signal: this.abort.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(t('下载 uv 失败：{0}', `HTTP ${res.status}`))
    const total = Number(res.headers.get('content-length')) || 0
    const tgz = join(this.dir, 'uv.tar.gz')
    let got = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (b: Buffer) => {
      got += b.length
      if (total) this.step('uv', got / total)
    })
    await pipeline(body, createWriteStream(tgz))
    await this.run('/usr/bin/tar', ['-xzf', tgz, '-C', this.dir, '--strip-components', '1', `${name}/uv`], process.env, 'uv')
    rmSync(tgz, { force: true })
    if (!existsSync(bin)) throw new Error(t('uv 解压后没找到可执行文件'))
    return bin
  }

  // 跑一步：输出的最后一行给界面看；uv 和 tqdm 的进度行里有百分比或「已下载 / 总量」就用它
  private run(cmd: string, args: string[], env: NodeJS.ProcessEnv, phase: keyof typeof SPAN, watch?: { dir: string; expectKb: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: this.dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      this.child = child
      let tail = ''
      let frac = 0
      const timer = watch
        ? setInterval(() => {
            execFile('/usr/bin/du', ['-sk', watch.dir], { timeout: 10_000 }, (_err, out) => {
              const kb = Number(String(out).split(/\s/)[0]) || 0
              frac = Math.max(frac, Math.min(0.98, kb / watch.expectKb))
              this.step(phase, frac)
            })
          }, 3000)
        : null
      child.on('close', () => timer && clearInterval(timer))
      const onData = (b: Buffer): void => {
        tail = (tail + b.toString()).slice(-4000)
        const line = tail.split(/[\r\n]/).map((x) => x.trim()).filter(Boolean).pop() ?? ''
        const pct = /(\d{1,3})%\|/.exec(line)
        if (pct) frac = Math.max(frac, Number(pct[1]) / 100)
        this.step(phase, frac, line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160))
      }
      child.stdout!.on('data', onData)
      child.stderr!.on('data', onData)
      child.on('error', (e) => reject(new Error(`${cmd.split('/').pop()}：${e.message}`)))
      child.on('close', (code, sig) => {
        if (code === 0) return resolve()
        const last = tail.split(/[\r\n]/).map((x) => x.trim()).filter(Boolean).slice(-3).join(' · ')
        reject(new Error(sig ? t('已停止') : `${cmd.split('/').pop()} ${args[0]} ${t('退出码')} ${code}：${last.slice(0, 300)}`))
      })
    })
  }
}

/** 数据目录里装过的 MinerU 版本（没装过是 null） */
export function installedMineru(dir: string): string | null {
  const f = join(dir, 'installed.json')
  return existsSync(f) ? ((JSON.parse(readFileSync(f, 'utf8')) as { version: string }).version ?? null) : null
}
