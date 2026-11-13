import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lastLogLine, MineruQueue, parseTqdm, type MineruJob, type MineruProgress } from '../src/main/mineru'

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
echo "# Out $tier" > "$out"
echo "Parsed 1 input(s)." 1>&2
rm -f "${dir}/running"
`
  )
  chmodSync(fake, 0o755)

  function run(jobs: MineruJob[], timeoutMs = 10_000) {
    const events: MineruProgress[] = []
    const done: string[] = []
    const failed: { job: MineruJob; error: string }[] = []
    let resolve!: () => void
    const finished = new Promise<void>((r) => (resolve = r))
    const total = jobs.length
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
      }
    })
    for (const j of jobs) q.enqueue(j)
    return { q, events, done, failed, finished }
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
})
