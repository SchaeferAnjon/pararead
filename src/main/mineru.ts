import { spawn, type ChildProcess } from 'node:child_process'
import { t } from '../shared/i18n'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { setPriority } from 'node:os'
import { dirname } from 'node:path'
import { killTree } from './platform'

export type MineruTier = 'flash' | 'basic'

export interface MineruJob {
  paperId: string
  tier: MineruTier
  pdf: string
  out: string // 最终的 .md 路径
  args?: string[] // 额外参数，如影印版的 --ocr-mode ocr
}

export interface MineruProgress {
  paperId: string
  tier: MineruTier
  status: 'queued' | 'running' | 'done' | 'failed'
  percent: number | null
  stage: string
  logLine: string
  startedAt: number | null
  error?: string
}

// tqdm 进度条写在 stderr，用 \r 刷新，比如「OCR-det:  53%|█████▎    | 8/15 [00:01<00:01]」。取最后一个。
export function parseTqdm(chunk: string): { stage: string; percent: number } | null {
  const re = /([A-Za-z][\w\- ]{0,40}?):\s*(\d{1,3})%\|/g
  let m: RegExpExecArray | null
  let last: { stage: string; percent: number } | null = null
  while ((m = re.exec(chunk))) last = { stage: m[1].trim(), percent: Math.min(100, Number(m[2])) }
  return last
}

// 日志最后一行：按 \r 和 \n 切，去掉空行和 pdfium 的噪声
export function lastLogLine(chunk: string): string {
  const lines = chunk
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('Explicitly closing'))
  return lines.length ? lines[lines.length - 1].slice(0, 300) : ''
}

export interface QueueStatus {
  total: number // 这一批（从队列空着到又空）里要解析的篇数
  done: number // 这一批里解析完（成了或没成）的篇数
  current: { paperId: string; tier: MineruTier } | null
  paused: 'manual' | 'busy' | null // manual：用户点了暂停；busy：用户正在操作，等空闲
}

export interface QueueOptions {
  command: () => string
  timeoutMs?: number
  onProgress: (p: MineruProgress) => void
  onDone: (job: MineruJob) => void
  onFailed: (job: MineruJob, error: string) => void
  onStatus?: (s: QueueStatus) => void
  idleMs?: number // 用户停手多久算空闲，默认 10 秒
  now?: () => number
  spawnImpl?: typeof spawn
  /** false：后台那篇不放进后台 QoS（排队的单测用：这台电脑忙时后台 QoS 的进程几秒才轮到一次，测的又不是它） */
  background?: boolean
}

// 精细解析失败是这台电脑的环境问题（包版本对不上、少模块），换一篇也一样会失败：不是这篇 PDF 的问题
export function envFailure(error: string): boolean {
  return /not an instance of|No module named|ModuleNotFoundError|ImportError|AttributeError|TypeError|argument '\w+'|找不到 MinerU|启动 MinerU 失败/.test(error)
}

const IS_MAC = process.platform === 'darwin'

// 同一时间只跑一个 MinerU 进程；多篇排队。打开着的那篇排最前，其余的 flash 在 basic 前面（让对照模式先能用）。
// 不抢前台：打开着的那篇用 nice 10 跑，别的篇用后台 QoS（macOS taskpolicy -b，只用能效核、IO 也让路，实测快速解析一篇慢 5 倍）；
// 用户在操作（滚动、打字、点）时暂停（整组 SIGSTOP），停手 idleMs 再继续（SIGCONT）；打开着的那篇的快速解析不停，用户正等着它。
// Windows 没有 SIGSTOP：只降优先级、不起新的。
export class MineruQueue {
  private queue: MineruJob[] = []
  private current: { job: MineruJob; child: ChildProcess; startedAt: number; preempted: boolean } | null = null
  private stopped = false
  private openPaper: string | null = null
  private manual = false
  private lastActive = -Infinity
  private held = false // 现在这个进程被 SIGSTOP 了
  private batch = new Set<string>()
  private ticker: NodeJS.Timeout | null = null
  private lastStatus = ''
  private runMs = 0
  private lastTick = 0

  constructor(private o: QueueOptions) {}

  private now(): number {
    return this.o.now ? this.o.now() : Date.now()
  }

  enqueue(job: MineruJob): void {
    if (this.current && this.current.job.paperId === job.paperId && this.current.job.tier === job.tier) return
    if (this.queue.some((j) => j.paperId === job.paperId && j.tier === job.tier)) return
    this.queue.push(job)
    this.sort()
    this.batch.add(job.paperId)
    this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'queued', percent: null, stage: '', logLine: t('排队中'), startedAt: null })
    this.pump()
    this.check()
  }

  /** 打开了哪篇（null：回了文献库）。它的解析排最前；正在跑的是别的篇、它又在排队时，先停下别的（放回队里，以后重跑） */
  setOpen(paperId: string | null): void {
    const was = this.openPaper
    this.openPaper = paperId
    this.sort()
    const cur = this.current
    if (cur) {
      if (cur.job.paperId === paperId) this.boost(cur.child, true)
      else if (cur.job.paperId === was) this.boost(cur.child, false)
      if (paperId && cur.job.paperId !== paperId && this.queue.some((j) => j.paperId === paperId)) {
        cur.preempted = true
        this.queue.push(cur.job)
        this.sort()
        killTree(cur.child, 'SIGKILL')
      }
    }
    this.check()
  }

  /** 用户在操作（滚动、打字、点）：正在跑的后台解析停下，空闲 idleMs 再继续 */
  activity(): void {
    this.lastActive = this.now()
    this.check()
  }

  /** 手动暂停 / 继续 */
  setPaused(paused: boolean): void {
    this.manual = paused
    this.check()
    if (!paused) this.pump()
  }

  /** 去掉还在排队的某一档（比如精细解析在这台电脑上跑不了） */
  dropTier(tier: MineruTier): MineruJob[] {
    const gone = this.queue.filter((j) => j.tier === tier)
    this.queue = this.queue.filter((j) => j.tier !== tier)
    this.check()
    return gone
  }

  cancelPaper(paperId: string): void {
    this.queue = this.queue.filter((j) => j.paperId !== paperId)
    this.batch.delete(paperId)
    if (this.current?.job.paperId === paperId) killTree(this.current.child, 'SIGKILL')
    this.check()
  }

  pending(): MineruJob[] {
    return [...(this.current ? [this.current.job] : []), ...this.queue]
  }

  isBusy(): boolean {
    return !!this.current
  }

  status(): QueueStatus {
    const left = new Set(this.pending().map((j) => j.paperId))
    const paused = this.manual ? 'manual' : this.current ? (this.held ? 'busy' : null) : this.queue.length && this.hold(this.queue[0]) ? 'busy' : null
    return {
      total: this.batch.size,
      done: [...this.batch].filter((id) => !left.has(id)).length,
      current: this.current ? { paperId: this.current.job.paperId, tier: this.current.job.tier } : null,
      paused
    }
  }

  // 退出应用时调用：之后不再回调（数据库马上要关），连 MinerU 起的子进程一起杀
  stopAll(): void {
    this.stopped = true
    this.queue = []
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    if (this.current) killTree(this.current.child, 'SIGKILL')
  }

  private sort(): void {
    const rank = (j: MineruJob): number => (j.paperId === this.openPaper ? 0 : 2) + (j.tier === 'flash' ? 0 : 1)
    this.queue = this.queue.map((j, i) => ({ j, i })).sort((a, b) => rank(a.j) - rank(b.j) || a.i - b.i).map((x) => x.j)
  }

  // 这一份现在该不该等：手动暂停；或用户在操作，且不是打开着那篇的快速解析
  private hold(job: MineruJob): boolean {
    if (this.manual) return true
    const busy = this.now() - this.lastActive < (this.o.idleMs ?? 10_000)
    return busy && !(job.paperId === this.openPaper && job.tier === 'flash')
  }

  // 停 / 续正在跑的进程，起下一个，报状态；有活时每 200 毫秒看一次
  private check(): void {
    if (this.stopped) return
    const cur = this.current
    if (cur && !IS_WIN_PLATFORM) {
      const want = this.hold(cur.job)
      if (want !== this.held) {
        this.held = want
        signalTree(cur.child, want ? 'SIGSTOP' : 'SIGCONT')
        this.o.onProgress({ paperId: cur.job.paperId, tier: cur.job.tier, status: 'running', percent: null, stage: '', logLine: want ? t('暂停中：等你停下再继续') : t('继续解析'), startedAt: cur.startedAt })
      }
    }
    if (!cur) this.pump()
    const st = this.status()
    const key = JSON.stringify(st)
    if (key !== this.lastStatus) {
      this.lastStatus = key
      this.o.onStatus?.(st)
    }
    if (!this.current && !this.queue.length) {
      if (this.batch.size) {
        this.batch.clear()
        this.lastStatus = JSON.stringify(this.status())
        this.o.onStatus?.(this.status())
      }
      if (this.ticker) clearInterval(this.ticker)
      this.ticker = null
    } else if (!this.ticker) {
      this.lastTick = this.now()
      this.ticker = setInterval(() => this.tick(), 200)
      this.ticker.unref?.()
    }
  }

  // 超时只算真在跑的时间（暂停着的不算）
  private tick(): void {
    const now = this.now()
    if (this.current && !this.held) this.runMs += now - this.lastTick
    this.lastTick = now
    this.check()
  }

  private pump(): void {
    if (this.current || this.stopped) return
    const job = this.queue[0]
    if (!job || this.hold(job)) return
    this.queue.shift()
    this.run(job)
  }

  // 打开着的那篇提到 nice 10 的优先级，别的篇回到后台 QoS
  private boost(child: ChildProcess, open: boolean): void {
    if (!child.pid || this.o.background === false) return
    if (IS_MAC) {
      spawn('/usr/sbin/taskpolicy', [open ? '-B' : '-b', '-p', String(child.pid)], { stdio: 'ignore' }).on('error', () => undefined)
      return
    }
    try {
      setPriority(child.pid, open ? 10 : 19)
    } catch {
      // 进程刚退出：不用管
    }
  }

  private run(job: MineruJob): void {
    const cmd = this.o.command()
    const tmp = job.out.replace(/\.md$/, '.part.md')
    mkdirSync(dirname(job.out), { recursive: true })
    if (existsSync(tmp)) rmSync(tmp)
    const startedAt = Date.now()
    const report = (p: Partial<MineruProgress>): void =>
      this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'running', percent: null, stage: '', logLine: '', startedAt, ...p })

    if (!existsSync(cmd)) {
      this.finish(job, t('找不到 MinerU：{0}', cmd))
      return
    }
    const sp = this.o.spawnImpl ?? spawn
    const open = job.paperId === this.openPaper
    const args = ['parse', job.pdf, '-o', tmp, '--tier', job.tier, ...(job.args ?? []), '-v']
    // macOS 一律用 nice 10 起，后台那篇再由 boost 放进后台 QoS（taskpolicy -b -p）：用 taskpolicy -b 直接起的进程，
    // 之后 taskpolicy -B -p 拉不出来（返回 0、优先级还是 4），刚导入就打开的那篇会一直按后台的速度跑
    const [bin, argv] = IS_MAC ? ['/usr/bin/nice', ['-n', '10', cmd, ...args]] : [cmd, args]
    const child = sp(bin, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      detached: true, // 自成一个进程组，停的时候整组杀
      windowsHide: true
    })
    if (!IS_MAC || !open) this.boost(child, open)
    const me = { job, child, startedAt, preempted: false }
    this.current = me
    this.held = false
    this.runMs = 0
    report({ logLine: `mineru-kit parse --tier ${job.tier}` })

    let tail = ''
    let percent: number | null = null
    let stage = ''
    let settled = false
    let timedOut = false
    const limit = this.o.timeoutMs ?? 600_000
    const timer = setInterval(() => {
      if (timedOut || this.runMs < limit) return
      timedOut = true
      tail += '\n' + t('超时：超过 {0} 分钟', Math.round(limit / 60000))
      signalTree(child, 'SIGCONT')
      killTree(child, 'SIGTERM')
      setTimeout(() => killTree(child, 'SIGKILL'), 5000).unref()
    }, 100)

    const onData = (buf: Buffer): void => {
      const s = buf.toString('utf8')
      tail = (tail + s).slice(-4000)
      const p = parseTqdm(s)
      if (p) {
        percent = p.percent
        stage = p.stage
      }
      const line = lastLogLine(s)
      report({ percent, stage, logLine: line || lastLogLine(tail) })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    const done = (code: number | null, err?: Error): void => {
      if (settled || this.stopped) return
      settled = true
      clearInterval(timer)
      if (this.current === me) {
        this.current = null
        this.held = false
      }
      if (me.preempted) {
        // 让位给打开的那篇：已经放回队里，不算失败
        if (existsSync(tmp)) rmSync(tmp, { force: true })
        this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'queued', percent: null, stage: '', logLine: t('排队中'), startedAt: null })
      } else if (err) this.finish(job, t('启动 MinerU 失败：{0}', err.message))
      else if (code === 0 && existsSync(tmp) && statSync(tmp).size > 0) {
        renameSync(tmp, job.out)
        this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'done', percent: 100, stage, logLine: 'Parsed 1 input(s).', startedAt })
        this.o.onDone(job)
      } else {
        const reason = timedOut ? lastLogLine(tail) : t('退出码 {0}：{1}', code, lastLogLine(tail) || t('没有输出'))
        this.finish(job, reason)
      }
      this.check()
    }
    child.on('error', (e) => done(null, e))
    child.on('close', (code) => done(code))
  }

  private finish(job: MineruJob, error: string): void {
    this.current = null
    this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'failed', percent: null, stage: '', logLine: error, startedAt: null, error })
    this.o.onFailed(job, error)
    if (!this.current) setImmediate(() => this.check())
  }
}

const IS_WIN_PLATFORM = process.platform === 'win32'

// 整组停 / 续（MinerU 起的子进程一起）
function signalTree(child: ChildProcess, sig: 'SIGSTOP' | 'SIGCONT'): void {
  if (!child.pid || IS_WIN_PLATFORM) return
  try {
    process.kill(-child.pid, sig)
  } catch {
    try {
      child.kill(sig)
    } catch {
      // 已经退出
    }
  }
}
