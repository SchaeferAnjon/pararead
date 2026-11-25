import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { envFailure, lastLogLine, MineruQueue, parseTqdm, type MineruJob, type MineruProgress, type QueueOptions, type QueueStatus } from '../src/main/mineru'
import { PINS, venvPkgVersion } from '../src/main/mineruInstall'

describe('进度解析', () => {
  it('取 tqdm 最后一个百分比和阶段名', () => {
    const s = 'Layout Predict:  40%|████      | 6/15 [00:01<00:02]\rLayout Predict:  53%|█████▎    | 8/15 [00:01<00:01]'
    expect(parseTqdm(s)).toEqual({ stage: 'Layout Predict', percent: 53 })
    expect(parseTqdm('OCR-det: 100%|██████████| 249/249')).toEqual({ stage: 'OCR-det', percent: 100 })
    expect(parseTqdm('no progress here')).toBeNull()
  })
  it('日志最后一行跳过 pdfium 噪声', () => {
    expect(lastLogLine('Parsed 1 input(s).\nExplicitly closing <PdfBitmap> x\n')).toBe('Parsed 1 input(s).')
  })
})

// 假的 mineru-kit 是 sh 脚本：Windows 上不跑
describe.skipIf(process.platform === 'win32')('MineruQueue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-mineru-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // 假的 mineru-kit：打印 tqdm 进度，写出 -o 指定的文件；记录调用顺序
  const fake = join(dir, 'fake-mineru')
  writeFileSync(
    fake,
    `#!/bin/sh
out="$4"; tier="$6"
echo "$tier" >> "${dir}/calls.log"
if [ -f "${dir}/running" ]; then echo overlap >> "${dir}/calls.log"; fi
touch "${dir}/running"
printf 'Layout Predict:  50%%|#####     | 1/2 [00:00<00:00]\\r' 1>&2
sleep 0.1
printf 'Layout Predict: 100%%|##########| 2/2 [00:00<00:00]\\n' 1>&2
case "$2" in *fail*) rm -f "${dir}/running"; echo "boom: model missing" 1>&2; exit 3;; esac
case "$2" in *slow*) sleep 5;; esac
case "$2" in *mid*) sleep 1.2;; esac
echo "# Out $tier" > "$out"
echo "Parsed 1 input(s)." 1>&2
rm -f "${dir}/running"
`
  )
  chmodSync(fake, 0o755)

  function run(jobs: MineruJob[], timeoutMs = 10_000, extra: Partial<QueueOptions> = {}, total = jobs.length) {
    const events: MineruProgress[] = []
    const done: string[] = []
    const failed: { job: MineruJob; error: string }[] = []
    let resolve!: () => void
    const finished = new Promise<void>((r) => (resolve = r))
    const statuses: QueueStatus[] = []
    const check = (): void => {
      if (done.length + failed.length === total) resolve()
    }
    const q = new MineruQueue({
      command: () => fake,
      timeoutMs,
      onProgress: (p) => events.push(p),
      onDone: (j) => {
        done.push(`${j.paperId}:${j.tier}`)
        check()
      },
      onFailed: (job, error) => {
        failed.push({ job, error })
        check()
      },
      onStatus: (st) => statuses.push(st),
      background: false,
      ...extra
    })
    for (const j of jobs) q.enqueue(j)
    return { q, events, done, failed, finished, statuses }
  }

  const job = (paperId: string, tier: 'flash' | 'basic', pdf = 'x.pdf'): MineruJob => ({ paperId, tier, pdf, out: join(dir, paperId, `${tier}.md`) })

  it('单进程排队：flash 插到 basic 前面，结果写到目标文件', async () => {
    rmSync(join(dir, 'calls.log'), { force: true })
    const r = run([job('a', 'flash'), job('a', 'basic'), job('b', 'flash')])
    await r.finished
    expect(r.done).toEqual(['a:flash', 'b:flash', 'a:basic'])
    const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n')
    expect(calls).toEqual(['flash', 'flash', 'basic'])
    expect(readFileSync(join(dir, 'a', 'basic.md'), 'utf8')).toContain('# Out basic')
    expect(r.events.some((e) => e.status === 'running' && e.percent === 50 && e.stage === 'Layout Predict')).toBe(true)
  })

  it('重复入队被忽略', async () => {
    const r = run([job('c', 'flash')])
    r.q.enqueue(job('c', 'flash'))
    await r.finished
    expect(r.done).toEqual(['c:flash'])
  })

  it('失败时报退出码和日志最后一行，不留半成品', async () => {
    const r = run([job('d', 'flash', 'fail.pdf')])
    await r.finished
    expect(r.failed[0].error).toBe('退出码 3：boom: model missing')
    expect(existsSync(join(dir, 'd', 'flash.md'))).toBe(false)
  })

  it('超时会杀掉进程并报超时', async () => {
    const r = run([job('e', 'flash', 'slow.pdf')], 300)
    await r.finished
    expect(r.failed[0].error).toMatch(/超时/)
  }, 15_000)

  it('命令不存在时直接失败', async () => {
    const q = new MineruQueue({ command: () => '/nope/mineru-kit', onProgress: () => {}, onDone: () => {}, onFailed: () => {} })
    const failed: string[] = []
    await new Promise<void>((resolve) => {
      const q2 = new MineruQueue({
        command: () => '/nope/mineru-kit',
        onProgress: () => {},
        onDone: () => {},
        onFailed: (_j, e) => {
          failed.push(e)
          resolve()
        }
      })
      q2.enqueue(job('f', 'flash'))
    })
    expect(q.isBusy()).toBe(false)
    expect(failed[0]).toBe('找不到 MinerU：/nope/mineru-kit')
  })

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('打开着的那篇排最前：先它的快速、精细，再别的篇', async () => {
    const r = run([], 10_000, {}, 4)
    r.q.setPaused(true)
    r.q.enqueue(job('o1', 'flash'))
    r.q.enqueue(job('o1', 'basic'))
    r.q.enqueue(job('o2', 'flash'))
    r.q.enqueue(job('o2', 'basic'))
    r.q.setOpen('o2')
    r.q.setPaused(false)
    await r.finished
    expect(r.done).toEqual(['o2:flash', 'o2:basic', 'o1:flash', 'o1:basic'])
  })

  it('用户在操作时后台那篇停下（进程 SIGSTOP），停手 idleMs 后接着跑完；超时不算停着的时间', async () => {
    const r = run([], 1500, { idleMs: 600 }, 1)
    r.q.enqueue(job('p1', 'flash', 'mid.pdf'))
    await sleep(150)
    const t0 = Date.now()
    // 连着操作 2 秒：一直停着
    while (Date.now() - t0 < 2000) {
      r.q.activity()
      expect(r.q.status().paused).toBe('busy')
      await sleep(100)
    }
    expect(r.done).toEqual([])
    await r.finished
    // 真在跑的时间约 1.3 秒 < 1.5 秒的超时：停着的 2 秒不算
    expect(r.failed).toEqual([])
    expect(r.done).toEqual(['p1:flash'])
    expect(r.statuses.some((s) => s.paused === 'busy' && s.current?.paperId === 'p1')).toBe(true)
    expect(r.events.some((e) => /暂停中/.test(e.logLine))).toBe(true)
  })

  it('打开着那篇的快速解析不因为操作停下；它的精细照样停', async () => {
    const r = run([], 10_000, { idleMs: 60_000 }, 2)
    r.q.setOpen('q1')
    r.q.activity()
    r.q.enqueue(job('q1', 'flash'))
    r.q.enqueue(job('q1', 'basic'))
    await sleep(1500)
    expect(r.done).toEqual(['q1:flash'])
    expect(r.q.status().paused).toBe('busy')
    r.q.setOpen(null)
    r.q.stopAll()
  })

  it('打开了另一篇：正在跑的后台那篇让位（放回队里，不算失败），打开的先跑完', async () => {
    const r = run([], 10_000, {}, 2)
    r.q.enqueue(job('bg', 'flash', 'mid.pdf'))
    await sleep(200)
    r.q.enqueue(job('fg', 'flash'))
    r.q.setOpen('fg')
    await r.finished
    expect(r.done).toEqual(['fg:flash', 'bg:flash'])
    expect(r.failed).toEqual([])
  })

  // 以前后台那篇用 taskpolicy -b 起：之后 taskpolicy -B -p 拉不出后台 QoS（返回 0、优先级还是 4），刚导入就打开的那篇一直慢 5 倍
  it.skipIf(process.platform !== 'darwin')('在后台解析的那篇被打开：进程真离开后台 QoS；回文献库再回后台', async () => {
    const pri = (pid: number): number => Number(execFileSync('ps', ['-o', 'pri=', '-p', String(pid)], { encoding: 'utf8' }).trim())
    const until = async (f: () => boolean): Promise<void> => {
      for (let i = 0; i < 100 && !f(); i++) await sleep(50)
    }
    const r = run([], 20_000, { background: true }, 1)
    r.q.enqueue(job('lift', 'flash', 'slow.pdf'))
    const q = r.q as unknown as { current: { child: { pid: number } } | null }
    await until(() => !!q.current?.child.pid)
    const pid = q.current!.child.pid
    await until(() => pri(pid) === 4)
    expect(pri(pid)).toBe(4)
    r.q.setOpen('lift')
    await until(() => pri(pid) > 4)
    expect(pri(pid)).toBeGreaterThan(4)
    r.q.setOpen(null)
    await until(() => pri(pid) === 4)
    expect(pri(pid)).toBe(4)
    r.q.stopAll()
  })

  it('手动暂停：不起新的，继续后跑完；状态条数这一批几篇、完了几篇，跑完清零', async () => {
    const r = run([], 10_000, {}, 2)
    r.q.setPaused(true)
    r.q.enqueue(job('m1', 'flash'))
    r.q.enqueue(job('m2', 'flash'))
    await sleep(300)
    expect(r.done).toEqual([])
    expect(r.q.status()).toMatchObject({ total: 2, done: 0, paused: 'manual' })
    r.q.setPaused(false)
    await r.finished
    await sleep(50)
    expect(r.statuses.some((s) => s.total === 2 && s.done === 1)).toBe(true)
    expect(r.q.status()).toMatchObject({ total: 0, done: 0, paused: null })
  })

  it('去掉排队里的精细', () => {
    const r = run([], 10_000, {}, 0)
    r.q.setPaused(true)
    r.q.enqueue(job('d1', 'flash'))
    r.q.enqueue(job('d1', 'basic'))
    r.q.enqueue(job('d2', 'basic'))
    expect(r.q.dropTier('basic').map((j) => j.paperId)).toEqual(['d1', 'd2'])
    expect(r.q.pending().map((j) => `${j.paperId}:${j.tier}`)).toEqual(['d1:flash'])
    r.q.stopAll()
  })
})

describe('精细解析失败的原因', () => {
  it('环境问题（包版本对不上、少模块）认得出，单篇的问题不算', () => {
    expect(envFailure("退出码 1：失败: argument 'private_ranges': 'int' object is not an instance of 'tuple'")).toBe(true)
    expect(envFailure("退出码 1：object is not an instance of 'tuple'")).toBe(true)
    expect(envFailure('退出码 1：ModuleNotFoundError: No module named torch')).toBe(true)
    expect(envFailure('超时：超过 10 分钟')).toBe(false)
    expect(envFailure('退出码 1：PDF is encrypted')).toBe(false)
  })
})

describe('MinerU 环境里钉住的包', () => {
  it('docvortex 钉在 0.6.7（0.6.8 起 private_ranges 和 mineru 4.0.12 对不上）', () => {
    expect(PINS.docvortex).toBe('0.6.7')
  })
  it('读虚拟环境里装的版本', () => {
    const v = mkdtempSync(join(tmpdir(), 'sr-venv-'))
    const lib = process.platform === 'win32' ? join(v, 'Lib', 'site-packages') : join(v, 'lib', 'python3.12', 'site-packages')
    mkdirSync(join(lib, 'docvortex-0.6.22.dist-info'), { recursive: true })
    mkdirSync(join(lib, 'mineru-4.0.12.dist-info'), { recursive: true })
    expect(venvPkgVersion(v, 'docvortex')).toBe('0.6.22')
    expect(venvPkgVersion(v, 'mineru')).toBe('4.0.12')
    expect(venvPkgVersion(v, 'torch')).toBeNull()
    rmSync(v, { recursive: true, force: true })
  })
})
