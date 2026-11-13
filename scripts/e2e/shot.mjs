// 截图翻译走一遍：对照模式里点工具栏的截图按钮，拖框框住一张图（快速重排里公式也是图），点「翻译」出译文；
// Esc、点一下不拖都能取消；原文（PDF）模式的截图翻译也再走一遍。
// DEEPSEEK_API_KEY=… node scripts/e2e/shot.mjs <新的数据目录>；E2E_PAPER=<一篇带图的论文 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-shot`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const drag = async (r) => {
  await win.mouse.move(r.x, r.y)
  await win.mouse.down()
  await win.mouse.move(r.x + r.w, r.y + r.h, { steps: 10 })
  await win.mouse.up()
}
// 卡片里的结果出来（或报错）
const result = async () => {
  for (let i = 0; i < 120; i++) {
    const s = await ev(() => ({ text: document.querySelector('.result-card .card-body .md')?.textContent ?? '', err: document.querySelector('.result-card .inline-err')?.textContent ?? '', busy: !!document.querySelector('.result-card .card-body .skel, .result-card .card-body .skeleton') }))
    if (s.err || (s.text && !s.busy && i > 3)) return s
    await sleep(500)
  }
  return { text: '', err: '超时' }
}
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'both' }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), r.paper.id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${r.paper.id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(2000)

  // 1. 对照模式：点按钮，出遮罩和提示
  const btn = win.locator('.mid-bar button[title^="截图翻译"]')
  ok('对照模式的工具栏有截图翻译', (await btn.count()) === 1)
  await btn.click()
  await sleep(300)
  ok('点了出框选层和提示', (await win.locator('.shot-layer .shot-hint').count()) === 1)
  await win.keyboard.press('Escape')
  await sleep(300)
  ok('Esc 取消', (await win.locator('.shot-layer').count()) === 0)

  // 2. 框住一张图，点翻译
  await ev(() => document.querySelector('.blk.img').scrollIntoView({ block: 'center' }))
  await sleep(1500)
  const img = await ev(() => { const q = document.querySelector('.blk.img img').getBoundingClientRect(); return { x: q.x - 4, y: q.y - 4, w: q.width + 8, h: Math.min(q.height + 8, 400) } })
  await btn.click()
  await sleep(300)
  await drag(img)
  await win.waitForSelector('.sel-toolbar', { timeout: 10000 })
  const shotOk = await ev(() => { const t = document.querySelector('.sel-toolbar'); return !!t })
  ok('框完出工具条，框选层收起', shotOk && (await win.locator('.shot-layer').count()) === 0)
  await win.locator('.sel-toolbar button', { hasText: '翻译' }).first().click()
  await win.waitForSelector('.result-card', { timeout: 10000 })
  const cardImg = await ev(() => { const i = document.querySelector('.result-card .card-shot'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null })
  ok('卡片里是截下来的那块图', !!cardImg && cardImg.w > 50 && cardImg.h > 50, JSON.stringify(cardImg))
  let res = await result()
  ok('截图翻译出了译文', !res.err && /[一-鿿]/.test(res.text) && res.text.length > 6, res.err || res.text.slice(0, 80))
  console.log(await shot(win, 'shot-reflow'))
  await win.keyboard.press('Escape')
  await sleep(400)

  // 3. 点一下不拖：取消，不出东西
  await btn.click()
  await sleep(300)
  await win.mouse.click(700, 500)
  await sleep(500)
  ok('点一下不拖：取消', (await win.locator('.shot-layer').count()) === 0 && (await win.locator('.sel-toolbar').count()) === 0)

  // 4. 原文（PDF）模式的截图翻译
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][0]?.click())
  await sleep(2500)
  await win.locator('.mid-bar button', { hasText: '截图翻译' }).click()
  const pg = await ev(() => { const q = [...document.querySelectorAll('.page')].find((p) => p.getBoundingClientRect().top > -50).getBoundingClientRect(); return { x: q.x + q.width * 0.1, y: Math.max(q.y, 120) + 40, w: q.width * 0.8, h: 160 } })
  await drag(pg)
  await win.waitForSelector('.sel-toolbar', { timeout: 10000 })
  await win.locator('.sel-toolbar button', { hasText: '翻译' }).first().click()
  res = await result()
  ok('原文模式的截图翻译也出了译文', !res.err && /[一-鿿]/.test(res.text), res.err || res.text.slice(0, 80))
  console.log(await shot(win, 'shot-pdf'))
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
