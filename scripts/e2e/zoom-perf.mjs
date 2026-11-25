// 捏合顺不顺（ParaRead 缩放顺）：同一篇论文在 ParaRead（原文、对照）和画布笔记里捏合，量帧率和掉帧。每轮三段：
//   来回：适合宽度 → 300% → 适合宽度（停手时倍数没变，不重排）；放大停手：→ 300% 停手（停手后排版、重画算在里面）；缩小停手：→ 回来停手。
// 捏合照触控板的样子发：每 16.7 ms 一个按着 ctrl 的滚轮（deltaY ±2，Chromium 的捏合就是这个），55 个是 3 倍；主线程忙时到点的几个一起发。
// 量的是最后一下之后再加 400 ms 里的 requestAnimationFrame（帧率、每帧间隔、按 60 Hz 算掉了几帧、最长一帧）和
// Long Animation Frames（超过 50 ms 的帧共多久）。窗口不上屏（E2E=1 / CN_E2E=1），两边都按 2 倍屏画（--force-device-scale-factor=2）；
// 第 1 页宽两边差不多（ParaRead 窗口 PERF_PR_W 默认 1100、画布笔记 PERF_NOTES_W 默认 1430，左栏开着），对照是这个窗口里左右两页。
//   E2E_PAPER=<论文 PDF> [BABELDOC_DIR=<装好的组件，对照要>] node scripts/e2e/zoom-perf.mjs pararead|dual|notes [轮数，默认 3]
// 找慢在哪：PERF_PROFILE=1（CPU 剖析）、PERF_TRACE=1 / css（时间线 / 选择器耗时）、PERF_CSS、PERF_JS（量之前改样式、跑一段）。
// 画布笔记那边要先 cd apps/notes && pnpm exec electron-vite build。
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { close, PAPER, ROOT, sleep } from './drive.mjs'

const which = process.argv[2] ?? 'pararead'
const rounds = Number(process.argv[3] ?? 3)
if (!PAPER) throw new Error('要 E2E_PAPER=<论文 PDF>')

/** 在页面里捏一次：去 300% 再回来。sel 是滚动的那一层，(fx, fy) 是手指在它里面的比例位置 */
const pinch = ({ sel, steps, dy, way }) =>
  new Promise((done) => {
    const el = document.querySelector(sel)
    const b = el.getBoundingClientRect()
    const x = b.left + b.width * 0.4
    const y = b.top + b.height * 0.5
    const frames = []
    const loaf = []
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const script = (e.scripts ?? []).reduce((a, s) => a + s.duration, 0)
        const layout = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0
        loaf.push({ t: e.startTime, d: e.duration, script, layout })
      }
    })
    po.observe({ type: 'long-animation-frame', buffered: false })
    let on = true
    const tick = (t) => {
      frames.push(t)
      if (on) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const plan = way === 'in' ? Array(steps).fill(-dy) : way === 'out' ? Array(steps).fill(dy) : [...Array(steps).fill(-dy), ...Array(steps).fill(dy)]
    const t0 = performance.now()
    let i = 0
    let caught = 0
    let peak = 0
    const pw = () => document.querySelector('.pdfpane:not([hidden]) .pdfpage, .page[data-side="src"], .page')?.getBoundingClientRect().width ?? 0
    const w0 = pw()
    const pump = () => {
      const due = Math.min(plan.length, Math.floor((performance.now() - t0) / (1000 / 60)) + 1)
      for (; i < due; i++) {
        const ev = new WheelEvent('wheel', { ctrlKey: true, deltaY: plan[i], clientX: x, clientY: y, bubbles: true, cancelable: true })
        el.dispatchEvent(ev)
        if (ev.defaultPrevented) caught++
      }
      peak = Math.max(peak, pw())
      if (i < plan.length) return void setTimeout(pump, 4)
      const t1 = performance.now()
      // 最后一下之后再看 400 ms（停手后那一次排版、重画也算进来）
      setTimeout(() => {
        on = false
        po.disconnect()
        const end = t1 + 400
        const fs = frames.filter((t) => t >= t0 && t <= end)
        const gaps = fs.slice(1).map((t, k) => t - fs[k])
        const dropped = gaps.reduce((a, g) => a + Math.max(0, Math.round(g / (1000 / 60)) - 1), 0)
        const long = loaf.filter((e) => e.t >= t0 && e.t <= end)
        done({
          ms: Math.round(end - t0),
          caught,
          grow: Math.round((peak / w0) * 100) / 100,
          frames: fs.length,
          fps: Math.round((fs.length / (end - t0)) * 1000 * 10) / 10,
          dropped,
          worst: Math.round(Math.max(0, ...gaps)),
          p95: Math.round([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)] ?? 0),
          longFrames: long.length,
          script: Math.round(long.reduce((a, e) => a + e.script, 0)),
          layout: Math.round(long.reduce((a, e) => a + e.layout, 0)),
          busy: Math.round(long.reduce((a, e) => a + e.d, 0))
        })
      }, 400)
    }
    pump()
  })

// 两边一样按 2 倍屏画（测试窗口不在屏幕上时画布笔记那边是 1 倍）
const DSF = '--force-device-scale-factor=2'
const STEPS = 55 // e^(0.02 × 55) ≈ 3.0
const DY = 2

let app, win, sel
if (which === 'notes') {
  // 画布笔记：临时库里放这篇，⌘K 打开，适合宽度
  const NOTES = join(ROOT, '../notes')
  const require = createRequire(join(NOTES, 'package.json'))
  const { _electron } = require('@playwright/test')
  const root = mkdtempSync(join(tmpdir(), 'cn-zoomperf-'))
  const vault = join(root, '测试库')
  mkdirSync(join(vault, '论文'), { recursive: true })
  writeFileSync(join(vault, '论文/paper.pdf'), readFileSync(PAPER))
  execFileSync('git', ['init', '-q', '-b', 'main', vault])
  execFileSync('git', ['-C', vault, 'add', '-A'])
  execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '样本'])
  mkdirSync(join(root, 'trash'))
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [DSF, join(NOTES, 'out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') }
  })
  win = await app.firstWindow()
  await win.locator('.vault b').waitFor({ timeout: 30000 })
  // 不用 setViewportSize：它把屏幕倍数也盖成 1
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 1000), Number(process.env.PERF_NOTES_W ?? 1430))
  await sleep(800)
  await win.keyboard.press('Meta+k')
  await win.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('paper')
  await win.locator('.pal-row', { hasText: 'paper' }).first().click()
  await win.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]').waitFor({ state: 'attached', timeout: 20000 })
  // 左栏收起（⌘\ 照命令表；没有就算了，两边的页宽另记）
  sel = '.pdfpane:not([hidden]) [data-testid="pdf-view"]'
} else {
  const require = createRequire(import.meta.url)
  const { _electron } = require('playwright')
  app = await _electron.launch({
    executablePath: `${ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
    args: [DSF, `${ROOT}/out/main/index.js`, `--data-dir=${mkdtempSync(join(tmpdir(), 'pr-zoomperf-'))}`],
    cwd: ROOT,
    env: { ...process.env, PARAREAD_UI_LANG: 'zh', E2E: '1', PARAREAD_BABELDOC_DIR: process.env.BABELDOC_DIR ?? join(tmpdir(), 'pr-zoomperf-no-babeldoc') }
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await sleep(1000)
  await win.evaluate((dual) => window.api.setSettings({ onboarded: true, trOnOpen: false, openView: dual ? 'dual' : 'pdf', dualLayout: 'side', rightCollapsed: true, leftCollapsed: true }), which === 'dual')
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 1000), Number(process.env.PERF_PR_W ?? 1100))
  const [r] = await win.evaluate((p) => window.api.importPdfs([p]), PAPER)
  await win.dblclick(`[data-paper="${r.paper.id}"]`)
  await win.locator('.page[data-page="1"] canvas').first().waitFor({ state: 'attached', timeout: 20000 }).catch(async (e) => (await win.screenshot({ path: join(tmpdir(), 'zoom-perf-fail.png') }), Promise.reject(e)))
  sel = '.pdf-scroller'
}

try {
  await sleep(2500)
  const pageW = await win.evaluate(() => Math.round((document.querySelector('.pdfpane:not([hidden]) .pdfpage, .page[data-side="src"]') ?? document.querySelector('.page')).getBoundingClientRect().width))
  const zoomText = async () => (await win.locator(which === 'notes' ? '.pdfpane:not([hidden]) [data-testid="pdf-zoom"], [data-testid="pdf-zoom"]' : '[data-testid="zoom-btn"]').first().innerText()).trim()
  const census = () => win.evaluate(() => ({
    all: document.querySelectorAll('*').length,
    text: document.querySelectorAll('.textLayer *').length,
    textLayers: [...document.querySelectorAll('.textLayer')].filter((l) => l.childElementCount).length,
    pages: document.querySelectorAll('.page, .pdfpage').length,
    links: document.querySelectorAll('.pdf-link').length,
  }))
  console.log('元素', JSON.stringify(await census()))
  console.log(`${which}：第 1 页宽 ${pageW}px，缩放 ${await zoomText()}，屏幕倍数 ${await win.evaluate(() => devicePixelRatio)}`)
  // PERF_CSS='<css>'：量之前往页面里加一段样式（找慢在哪时用，比如把文字层藏掉看差多少）
  if (process.env.PERF_CSS) await win.addStyleTag({ content: process.env.PERF_CSS })
  // PERF_JS='<js>'：量之前在页面里跑一段（同上，找慢在哪时用）
  if (process.env.PERF_JS) console.log('PERF_JS', await win.evaluate(process.env.PERF_JS))
  const all = []
  const ins = []
  const outs = []
  for (let k = 0; k < rounds; k++) {
    // 先翻到第 2 页中间（几页都在视口附近），再捏
    await win.evaluate((s) => (document.querySelector(s).scrollTop = 1400), sel)
    await sleep(1500)
    const r = await win.evaluate(pinch, { sel, steps: STEPS, dy: DY, way: 'both' })
    const mid = await zoomText()
    all.push(r)
    console.log(`第 ${k + 1} 轮 来回`, JSON.stringify(r), '捏完', mid)
    await sleep(1500)
    // 只放大、停手（停手后按 300% 排版、重画），再只缩小、停手
    // PERF_PROFILE=1：最后一轮「放大停手」录一份 CPU 剖析，列自身耗时最多的 15 个函数（找哪里慢）
    const prof = process.env.PERF_PROFILE && k === rounds - 1 ? await win.context().newCDPSession(win) : null
    if (prof) await prof.send('Profiler.enable'), await prof.send('Profiler.setSamplingInterval', { interval: 200 }), await prof.send('Profiler.start')
    // PERF_TRACE=1：最后一轮「放大停手」录 Chromium 的时间线，按事件名加总、列最长的几个（主线程排版、样式、画布、合成各多久）
    const tr = process.env.PERF_TRACE && k === rounds - 1 ? await win.context().newCDPSession(win) : null
    const evs = []
    if (tr) {
      tr.on('Tracing.dataCollected', (d) => evs.push(...d.value))
      await tr.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,gpu,v8' + (process.env.PERF_TRACE === 'css' ? ',disabled-by-default-blink.debug' : ''), transferMode: 'ReportEvents' })
    }
    const rin = await win.evaluate(pinch, { sel, steps: STEPS, dy: DY, way: 'in' })
    if (tr) {
      const done = new Promise((r) => tr.once('Tracing.tracingComplete', r))
      await tr.send('Tracing.end')
      await done
      const sum = new Map()
      const big = []
      for (const e of evs) if (e.ph === 'X' && e.dur) {
        const key = `${e.name}@${e.tid}`
        sum.set(key, (sum.get(key) ?? 0) + e.dur)
        if (e.dur > 15000) big.push(`${Math.round(e.dur / 1000)}ms ${e.name}@${e.tid} ${JSON.stringify(e.args?.data ?? e.args ?? {}).slice(0, 120)}`)
      }
      console.log([...sum].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`).join('\n'))
      console.log('--- 超过 15ms 的：\n' + big.slice(0, 30).join('\n'))
      // PERF_TRACE=css：哪几条选择器最费时（SelectorStats）
      const sel = new Map()
      for (const e of evs) for (const x of e.args?.selector_stats?.selector_timings ?? []) {
        const o = sel.get(x.selector) ?? { us: 0, n: 0 }
        o.us += x['elapsed (us)'] ?? 0
        o.n += x.match_attempts ?? 0
        sel.set(x.selector, o)
      }
      if (sel.size) console.log(`--- 选择器（${sel.size} 条，共 ${Math.round([...sel.values()].reduce((a, v) => a + v.us, 0) / 1000)}ms）：`), console.log('\n' + [...sel].sort((a, b) => b[1].us - a[1].us).slice(0, 15).map(([k, v]) => `${Math.round(v.us / 1000)}ms ${v.n}次 ${k}`).join('\n'))
    }
    if (prof) {
      const { profile } = await prof.send('Profiler.stop')
      const self = new Map()
      const dt = new Map()
      profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)))
      for (const n of profile.nodes) {
        const f = n.callFrame
        const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`
        self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0))
      }
      console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`).join('\n'))
    }
    console.log(`第 ${k + 1} 轮 放大停手`, JSON.stringify(rin), '捏完', await zoomText(), '元素', JSON.stringify(await census()))
    await sleep(1500)
    const rout = await win.evaluate(pinch, { sel, steps: STEPS, dy: DY, way: 'out' })
    console.log(`第 ${k + 1} 轮 缩小停手`, JSON.stringify(rout), '捏完', await zoomText())
    ins.push(rin)
    outs.push(rout)
    await sleep(1500)
  }
  const avg = (rs) => {
    const f = (k) => Math.round((rs.reduce((a, r) => a + r[k], 0) / rs.length) * 10) / 10
    return JSON.stringify({ fps: f('fps'), dropped: f('dropped'), worst: f('worst'), p95: f('p95'), longFrames: f('longFrames'), busy: f('busy') })
  }
  console.log(`平均（${rounds} 轮）来回`, avg(all))
  console.log(`平均（${rounds} 轮）放大停手`, avg(ins))
  console.log(`平均（${rounds} 轮）缩小停手`, avg(outs))
} finally {
  if (which === 'notes') await app.close()
  else await close(app)
}
