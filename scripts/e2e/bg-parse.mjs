// 后台解析走查（假 MinerU）：只解析打开的那篇、精细失败一次记住不再每篇跑、连着的库都解析时后台那篇在滚动时停下（进程真停）停手再继续、
// 状态条「后台在解析 1/2 篇 · 暂停」手动暂停继续（阅读页标题栏、文献库左下角）、设置里「重试精细解析」。
//   E2E_PAPER=<一篇 PDF> node scripts/e2e/bg-parse.mjs <数据目录>
// 假 MinerU 是 sh 脚本：快速档按 0.1 秒一步写进度、写出重排；精细档报用户那台的错（'private_ranges' … 'tuple'）。
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { close, launch, PAPER, ROOT, shot, sleep } from './drive.mjs'

const data = resolve(process.argv[2] ?? `${process.cwd()}/tmp/data-bg-parse`)
const vault = `${data}-vault`
if (!PAPER) throw new Error('要 E2E_PAPER')
const FOLDER = '课程/study project 2'
mkdirSync(resolve(vault, FOLDER), { recursive: true })
if (!existsSync(resolve(vault, '.git'))) execFileSync('git', ['init', '-q', vault])
const NAMES = ['Emo-01.pdf', 'Emo-02.pdf', 'Emo-03-slow.pdf', 'Emo-04-slow.pdf']
NAMES.forEach((n, i) => {
  const f = resolve(vault, FOLDER, n)
  copyFileSync(PAPER, f)
  appendFileSync(f, `\n%variant ${i}\n`) // 内容不同，库里认成四篇
})

const calls = `${data}-calls.log`
writeFileSync(calls, '')
const fake = `${data}-fake-mineru`
writeFileSync(
  fake,
  `#!/bin/sh
out="$4"; tier="$6"; pdf="$2"
echo "$tier $(basename "$pdf") $$" >> "${calls}"
if [ "$tier" = basic ]; then sleep 1; echo "Error: Failed to parse $pdf: argument 'private_ranges': 'int' object is not an instance of 'tuple'" 1>&2; exit 1; fi
case "$pdf" in *slow*) n=80;; *) n=8;; esac
i=0
while [ $i -lt $n ]; do sleep 0.1; i=$((i+1)); printf 'Layout Predict: %d%%|#| %d/%d\\r' $((i*100/n)) $i $n 1>&2; done
cp "${ROOT}/tests/fixtures/simpler-flash.md" "$out"
echo "Parsed 1 input(s)." 1>&2
`
)
chmodSync(fake, 0o755)

const lines = () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean)
const ran = (tier, name) => lines().filter((l) => l.startsWith(`${tier} ${name} `))
const pidOf = (name) => Number(ran('flash', name).at(-1)?.split(' ')[2])
const stopped = (pid) => {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).includes('T')
  } catch {
    return false
  }
}
// 后台那篇在后台 QoS 里跑：这台电脑忙时（别的程序把核占满）几十秒才轮到一次，等它的几处放宽到 3 分钟
const BG_MS = 180_000
async function until(what, fn, ms = 20000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`等不到：${what}`)
    await sleep(150)
  }
}
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg)
  console.log(`✓ ${msg}`)
}

const { app, win } = await launch(data, { PARAREAD_BG_IDLE_MS: '1500' })
const ev = (fn, arg) => win.evaluate(fn, arg)
try {
  await ev((m) => window.api.setSettings({ onboarded: true, mineruPath: m, defaultEngine: 'basic', openView: 'pdf', trOnOpen: false }), fake)
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await ev((v) => window.api.cnConnect(v), vault)
  await ev(([v, f]) => window.api.cnSetFolders(v, [f]), [vault, FOLDER])
  await ev(() => window.api.cnScan())
  const papers = await until('库里四篇列进来', async () => {
    const ps = (await ev(() => window.api.listPapers())).filter((p) => p.cn)
    return ps.length === 4 ? ps : null
  })
  const id = (n) => papers.find((p) => p.cn.path.endsWith(n)).id
  const paper = async (n) => (await ev((i) => window.api.getPaper(i), id(n)))
  const status = () => ev(() => window.api.bgStatus())

  // 1. 默认「只解析我打开的」：列进来的四篇一篇都不解析
  await sleep(2500)
  ok(lines().length === 0, '只解析我打开的：列进来的四篇没有一篇在解析')

  // 2. 打开 Emo-01：先快速、再精细；精细报 tuple 错，记住
  await win.dblclick(`[data-paper="${id('Emo-01.pdf')}"]`)
  await win.waitForSelector('.mid-body')
  await until('Emo-01 快速解析完', async () => (await paper('Emo-01.pdf')).reflow.flash === 'done')
  const broken = await until('精细失败记住', async () => (await ev(() => window.api.getSettings())).basicBroken)
  ok(/private_ranges/.test(broken.error) && ran('basic', 'Emo-01.pdf').length === 1, `打开的那篇先快速再精细，精细失败记住：${broken.error.slice(0, 80)}`)

  // 3. 再打开 Emo-02：只跑快速，不再跑精细
  await win.locator('button[title^="回文献库"]').click()
  await win.dblclick(`[data-paper="${id('Emo-02.pdf')}"]`)
  await win.waitForSelector('.mid-body')
  await until('Emo-02 快速解析完', async () => (await paper('Emo-02.pdf')).reflow.flash === 'done')
  await sleep(2000)
  ok(ran('basic', 'Emo-02.pdf').length === 0 && ran('basic', 'Emo-01.pdf').length === 1, '精细失败过以后，新打开的那篇只跑快速，不再白跑精细')
  ok(ran('flash', 'Emo-03-slow.pdf').length === 0, '没打开的 Emo-03 还没解析')

  // 4. 改成「连着的库都在后台解析」：Emo-03、Emo-04 排上；滚动时后台那篇停下（进程 T），停手 1.5 秒继续
  await ev(() => window.api.setSettings({ bgParse: 'vault' }))
  await until('Emo-03 开始解析', async () => ran('flash', 'Emo-03-slow.pdf').length > 0, BG_MS)
  const pid3 = pidOf('Emo-03-slow.pdf')
  await until('状态条出现', async () => (await win.locator('.bg-parse').count()) > 0)
  const t0 = Date.now()
  let sawStop = false
  while (Date.now() - t0 < 3000) {
    await win.mouse.move(600, 400)
    await win.mouse.wheel(0, 120)
    await sleep(200)
    if (stopped(pid3) && (await status()).paused === 'busy') sawStop = true
  }
  ok(sawStop, `滚动时后台那篇的 MinerU 进程停下（ps 状态 T，进程号 ${pid3}），状态条「等你停手」`)
  await shot(win, '1-阅读页-滚动时暂停')
  await win.locator('.bg-parse').screenshot({ path: `${process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`}/1b-状态条-等你停手.png` })
  await until('停手后接着跑', async () => !stopped(pid3) && (await status()).paused === null, 5000)
  ok(true, '停手 1.5 秒后接着跑（进程不再是 T）')

  // 5. 状态条手动暂停 / 继续（阅读页标题栏）
  const chip = win.locator('.bg-parse')
  const text = `${await chip.innerText()}（悬停：${(await chip.getAttribute('title')).split('\n')[0]}）`
  ok(/^\d\/2/.test(text) && /后台在解析 \d\/2 篇/.test(text), `阅读页标题栏的状态条：「${text.replace(/\n/g, ' ')}」`)
  await chip.locator('button[aria-label="暂停"]').click()
  await until('手动暂停', async () => (await status()).paused === 'manual' && stopped(pid3), 5000)
  await sleep(2500)
  ok((await status()).paused === 'manual' && stopped(pid3), '点「暂停」：进程停下，停手以后也不自己继续')
  await shot(win, '2-阅读页-手动暂停')
  await chip.screenshot({ path: `${process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`}/2b-状态条-已暂停.png` })
  await chip.locator('button[aria-label="继续"]').click()
  await until('Emo-03 解析完', async () => (await paper('Emo-03-slow.pdf')).reflow.flash === 'done', BG_MS)
  ok(true, '点「继续」：Emo-03 接着解析完')

  // 6. 文献库左下角：Emo-04 在解析
  await win.locator('button[title^="回文献库"]').click()
  await until('Emo-04 开始解析', async () => ran('flash', 'Emo-04-slow.pdf').length > 0, BG_MS)
  const libChip = win.locator('.sb-foot .bg-parse')
  await libChip.waitFor({ timeout: 5000 })
  await sleep(1800)
  const libText = await libChip.innerText()
  ok(/后台在解析 1\/2 篇/.test(libText), `文献库左下角的状态条：「${libText.replace(/\n/g, ' ')}」`)
  await shot(win, '3-文献库-左下角状态条')
  await libChip.locator('button', { hasText: '暂停' }).click()
  await until('文献库里暂停', async () => (await status()).paused === 'manual', 5000)
  await libChip.locator('button', { hasText: '继续' }).click()
  await until('Emo-04 解析完', async () => (await paper('Emo-04-slow.pdf')).reflow.flash === 'done', BG_MS)
  await until('状态条消失', async () => (await win.locator('.bg-parse').count()) === 0, 5000)
  ok(ran('basic', 'Emo-03-slow.pdf').length === 0 && ran('basic', 'Emo-04-slow.pdf').length === 0, '后台那两篇也只跑快速；都解析完状态条收起')

  // 7. 设置 › 重排：「重试精细解析」
  await ev(() => window.api.openSettings('reflow'))
  const s = await until('设置窗口', async () => app.windows().find((p) => p.url().includes('#settings')))
  await s.waitForLoadState('domcontentloaded')
  await s.locator('.nav-item', { hasText: '重排' }).click()
  const retry = s.locator('button', { hasText: '重试精细解析' })
  await retry.waitFor({ timeout: 5000 })
  await retry.scrollIntoViewIfNeeded()
  await shot(s, '4-设置-后台解析')
  const before = lines().filter((l) => l.startsWith('basic ')).length
  await retry.click()
  await until('重试跑了一次精细', async () => lines().filter((l) => l.startsWith('basic ')).length === before + 1)
  await until('又记住失败', async () => (await ev(() => window.api.getSettings())).basicBroken)
  ok(true, '「重试精细解析」：拿最近打开的那篇再跑一次精细，又失败、又记住')
  console.log('bg-parse 全部通过')
} finally {
  await close(app)
}
