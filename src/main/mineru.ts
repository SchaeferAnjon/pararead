import { spawn, type ChildProcess } from 'node:child_process'
import { t } from '../shared/i18n'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
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

export interface QueueOptions {
  command: () => string
  timeoutMs?: number
  onProgress: (p: MineruProgress) => void
  onDone: (job: MineruJob) => void
  onFailed: (job: MineruJob, error: string) => void
  spawnImpl?: typeof spawn
}

// 同一时间只跑一个 MinerU 进程；多篇排队。flash 在 basic 前面插队，让对照模式先能用。
export class MineruQueue {
  private queue: MineruJob[] = []
  private current: { job: MineruJob; child: ChildProcess; startedAt: number } | null = null
  private stopped = false

  constructor(private o: QueueOptions) {}

  enqueue(job: MineruJob): void {
    if (this.current && this.current.job.paperId === job.paperId && this.current.job.tier === job.tier) return
    if (this.queue.some((j) => j.paperId === job.paperId && j.tier === job.tier)) return
    if (job.tier === 'flash') {
      const firstBasic = this.queue.findIndex((j) => j.tier === 'basic')
      if (firstBasic >= 0) this.queue.splice(firstBasic, 0, job)
      else this.queue.push(job)
    } else this.queue.push(job)
    this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'queued', percent: null, stage: '', logLine: t('排队中'), startedAt: null })
    this.pump()
  }

  cancelPaper(paperId: string): void {
    this.queue = this.queue.filter((j) => j.paperId !== paperId)
    if (this.current?.job.paperId === paperId) killTree(this.current.child, 'SIGKILL')
  }

  pending(): MineruJob[] {
    return [...(this.current ? [this.current.job] : []), ...this.queue]
  }

  isBusy(): boolean {
    return !!this.current
  }

  // 退出应用时调用：之后不再回调（数据库马上要关），连 MinerU 起的子进程一起杀
  stopAll(): void {
    this.stopped = true
    this.queue = []
    if (this.current) killTree(this.current.child, 'SIGKILL')
  }

  private pump(): void {
    if (this.current || this.stopped) return
    const job = this.queue.shift()
    if (!job) return
    this.run(job)
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
    const child = sp(cmd, ['parse', job.pdf, '-o', tmp, '--tier', job.tier, ...(job.args ?? []), '-v'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      detached: true, // 自成一个进程组，停的时候整组杀
      windowsHide: true
    })
    this.current = { job, child, startedAt }
    report({ logLine: `mineru-kit parse --tier ${job.tier}` })

    let tail = ''
    let percent: number | null = null
    let stage = ''
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      tail += '\n' + t('超时：超过 {0} 分钟', Math.round((this.o.timeoutMs ?? 600_000) / 60000))
      killTree(child, 'SIGTERM')
      setTimeout(() => killTree(child, 'SIGKILL'), 5000).unref()
    }, this.o.timeoutMs ?? 600_000)

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
      clearTimeout(timer)
      this.current = null
      if (err) this.finish(job, t('启动 MinerU 失败：{0}', err.message))
      else if (code === 0 && existsSync(tmp) && statSync(tmp).size > 0) {
        renameSync(tmp, job.out)
        this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'done', percent: 100, stage, logLine: 'Parsed 1 input(s).', startedAt })
        this.o.onDone(job)
      } else {
        const reason = timedOut ? lastLogLine(tail) : t('退出码 {0}：{1}', code, lastLogLine(tail) || t('没有输出'))
        this.finish(job, reason)
      }
      this.pump()
    }
    child.on('error', (e) => done(null, e))
    child.on('close', (code) => done(code))
  }

  private finish(job: MineruJob, error: string): void {
    this.current = null
    this.o.onProgress({ paperId: job.paperId, tier: job.tier, status: 'failed', percent: null, stage: '', logLine: error, startedAt: null, error })
    this.o.onFailed(job, error)
    if (!this.current) setImmediate(() => this.pump())
  }
}

