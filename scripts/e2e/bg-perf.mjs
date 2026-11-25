// 量后台解析抢不抢前台（不在 all.mjs 里：要真 MinerU，跑一次约 2 分钟）：
//   [OPEN_ALL=1] node scripts/e2e/bg-perf.mjs <新的数据目录> <画布笔记库> [vault]
// 库里「课程/study project 2」放十几篇 PDF；连上库、勾这个文件夹，打开第一篇看原文，
// 「读」60 秒（滚 3 秒、停 2 秒，共 12 轮），滚的时候量帧率（requestAnimationFrame 间隔），每秒用 ps 记 ParaRead 和 MinerU 的 CPU；
// 再停手 20 秒看后台解析接着跑没有。第三个参数 vault：设置成「连着的库都在后台解析」。
// MINERU=<mineru-kit>（默认 ~/.mineru-venv/bin/mineru-kit）；OUT=<构建目录>（默认 out，量改前的用另一份构建）
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, sleep, close } from './drive.mjs'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright')

const [dir, vault, mode] = process.argv.slice(2)
if (!dir || !vault) throw new Error('用法：node scripts/e2e/bg-perf.mjs <新的数据目录> <画布笔记库> [vault]')
const FOLDER = '课程/study project 2'
const MINERU = process.env.MINERU ?? `${homedir()}/.mineru-venv/bin/mineru-kit`
const OUT = process.env.OUT ?? 'out'

const app = await _electron.launch({
  executablePath: `${ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: [`${ROOT}/${OUT}/main/index.js`, `--data-dir=${resolve(dir)}`],
  cwd: ROOT,
  env: { ...process.env, PARAREAD_UI_LANG: 'zh', E2E: '1' },
  timeout: 60000
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
const ev = (fn, arg) => win.evaluate(fn, arg)
const appPid = app.process().pid

await ev((m) => window.api.setSettings({ onboarded: true, mineruPath: m, defaultEngine: 'basic', openView: 'pdf', trOnOpen: false }), MINERU)
if (mode === 'vault') await ev(() => window.api.setSettings({ bgParse: 'vault' }))
await win.reload()
await win.waitForLoadState('domcontentloaded')
await ev((v) => window.api.cnConnect(v), resolve(vault))
await ev(([v, f]) => window.api.cnSetFolders(v, [f]), [resolve(vault), FOLDER])
await ev(() => window.api.cnScan())
let papers = []
for (let i = 0; i < 60 && papers.length < 14; i++) {
  papers = (await ev(() => window.api.listPapers())).filter((p) => p.cn)
  await sleep(500)
}
papers.sort((a, b) => a.fileName.localeCompare(b.fileName))
console.log(`库里列进来 ${papers.length} 篇`)

// CPU：ParaRead（主进程和它的 Helper）、MinerU（mineru-kit 和它起的子进程）
function cpu() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(l)
      return { pid: +m[1], ppid: +m[2], cpu: +m[3], cmd: m[4] }
    })
  const kids = new Map()
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r])
  const tree = (pid) => [...(kids.get(pid) ?? [])].flatMap((r) => [r, ...tree(r.pid)])
  const all = [rows.find((r) => r.pid === appPid), ...tree(appPid)].filter(Boolean)
  const mineru = all.filter((r) => /mineru-kit|taskpolicy|\/nice /.test(r.cmd))
  const mineruAll = mineru.flatMap((r) => [r, ...tree(r.pid)])
  const ids = new Set(mineruAll.map((r) => r.pid))
  const sum = (xs) => Math.round(xs.reduce((a, r) => a + r.cpu, 0))
  return { pararead: sum(all.filter((r) => !ids.has(r.pid))), mineru: sum(mineruAll), mineruProcs: mineru.length }
}
// LOAD=<n>：另起 n 个占满一个核的进程（普通优先级），模拟用户那台 10 核、负载 15 的电脑
const { spawn } = await import('node:child_process')
const burners = Array.from({ length: Number(process.env.LOAD ?? 0) }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }))
process.on('exit', () => burners.forEach((b) => b.kill('SIGKILL')))
const samples = []
let phase = 'open'
const sampler = setInterval(() => samples.push({ phase, ...cpu() }), 1000)

// OPEN_ALL=1：先把每篇都「打开」一次（cn:watch，和界面打开一篇一样排上解析），造「14 篇都在排队解析」——改前没有「连着的库都在后台解析」，只能这样排满
if (process.env.OPEN_ALL) for (const p of papers.slice(1)) await ev((id) => window.api.cnWatch(id), p.id)
// 打开第一篇（看原文），等 MinerU 起来
await win.dblclick(`[data-paper="${papers[0].id}"]`)
await win.waitForSelector('.mid-body', { timeout: 30000 })
for (let i = 0; i < 40 && !cpu().mineruProcs; i++) await sleep(250)
await sleep(1500)

// 读 60 秒：滚 3 秒、停 2 秒；滚的时候量帧率
phase = 'read'
const rounds = []
for (let r = 0; r < 12; r++) {
  const m = await ev(
    (ms) =>
      new Promise((res) => {
        const el = document.querySelector('.mid-body')
        const gaps = []
        let last = performance.now()
        const t0 = last
        let dir = 1
        const step = (now) => {
          gaps.push(now - last)
          last = now
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) dir = -1
          if (el.scrollTop <= 0) dir = 1
          el.scrollTop += 8 * dir
          el.dispatchEvent(new WheelEvent('wheel', { deltaY: 8 * dir, bubbles: true }))
          if (now - t0 < ms) requestAnimationFrame(step)
          else {
            gaps.shift()
            gaps.sort((a, b) => a - b)
            res({ frames: gaps.length, fps: (gaps.length / (now - t0)) * 1000, p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0, max: gaps[gaps.length - 1] ?? 0, janky: gaps.filter((g) => g > 50).length })
          }
        }
        requestAnimationFrame(step)
      }),
    3000
  )
  rounds.push(m)
  await sleep(2000)
}
// 停手 20 秒
phase = 'idle'
await sleep(20000)
clearInterval(sampler)

burners.forEach((b) => b.kill('SIGKILL'))
const st = await ev(() => window.api.bgStatus?.() ?? null)
const list = (await ev(() => window.api.listPapers())).filter((p) => p.cn)
const parsed = { flash: list.filter((p) => p.reflow.flash === 'done').length, basic: list.filter((p) => p.reflow.basic === 'done').length }
await close(app)

const avg = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10) / 10
const by = (ph, k) => avg(samples.filter((s) => s.phase === ph).map((s) => s[k]))
const result = {
  build: OUT,
  load: Number(process.env.LOAD ?? 0),
  mode: mode ?? 'opened',
  fps: avg(rounds.map((r) => r.fps)),
  p95FrameMs: avg(rounds.map((r) => r.p95)),
  worstFrameMs: Math.round(Math.max(...rounds.map((r) => r.max))),
  framesOver50ms: rounds.reduce((a, r) => a + r.janky, 0),
  cpuWhileReading: { pararead: by('read', 'pararead'), mineru: by('read', 'mineru') },
  cpuIdleAfter: { pararead: by('idle', 'pararead'), mineru: by('idle', 'mineru') },
  parsedAfter: parsed,
  status: st
}
console.log(JSON.stringify(result))
