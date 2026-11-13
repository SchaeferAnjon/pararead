// 手写笔：原文模式里拿起笔画一个圈，换蓝色画一道，橡皮擦掉红圈，⌘Z 撤销蓝线；缩放后笔画跟着页面；重开还在。
// node scripts/e2e/ink.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-ink`
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
let { app, win } = await launch(dir, { DEEPSEEK_API_KEY: '' })
let ev = (fn, ...a) => win.evaluate(fn, ...a)
const openPdf = async (id) => {
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][0]?.click())
  await sleep(2500)
}
const page1 = () => ev(() => { const q = document.querySelector('.page[data-page="1"]').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height } })
const strokes = () => ev(() => [...document.querySelectorAll('.ink-layer polyline[data-ink]')].map((p) => ({ id: p.dataset.ink, color: p.getAttribute('stroke'), n: p.getAttribute('points').split(' ').length, box: (() => { const r = p.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() })))
const circle = async (cx, cy, r) => {
  await win.mouse.move(cx + r, cy)
  await win.mouse.down()
  for (let i = 1; i <= 36; i++) await win.mouse.move(cx + r * Math.cos((i / 36) * 2 * Math.PI), cy + r * Math.sin((i / 36) * 2 * Math.PI))
  await win.mouse.up()
}
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  await sleep(1500)
  await openPdf(id)

  await win.locator('.mid-bar button[title^="笔"]').click()
  await sleep(200)
  ok('点笔：出三个颜色和橡皮', (await win.locator('.ink-tools .ink-dot').count()) === 3 && (await win.locator('.ink-tools button[title^="橡皮"]').count()) === 1)
  let p = await page1()
  const c = { x: p.x + p.w * 0.5, y: p.y + p.h * 0.45 }
  await circle(c.x, c.y, 60)
  await sleep(300)
  let s = await strokes()
  ok('拖着画：页面上出一个红圈，没选到字', s.length === 1 && s[0].color === '#e5484d' && s[0].n > 20 && Math.abs(s[0].box[2] - 120) < 6 && !String(await ev(() => getSelection().toString())).trim(), JSON.stringify(s[0]))
  await win.locator('.ink-tools .ink-dot').nth(1).click()
  await win.mouse.move(p.x + p.w * 0.2, p.y + p.h * 0.7)
  await win.mouse.down()
  await win.mouse.move(p.x + p.w * 0.6, p.y + p.h * 0.7, { steps: 12 })
  await win.mouse.up()
  await sleep(300)
  s = await strokes()
  ok('换蓝色再画一道', s.length === 2 && s[1].color === '#2f6fde')
  console.log(await shot(win, 'ink-drawn'))
  const saved = await ev((x) => window.api.inkList(x), id)
  ok('两笔都存上了', saved.length === 2)

  // 缩放：笔画跟着页面放大
  await ev(() => document.querySelector('.mid-bar button[title="缩放"]').click())
  await sleep(300)
  await win.keyboard.press('Escape')
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('zoom-in')?.click())
  await sleep(1200)
  const p2 = await page1()
  const s2 = await strokes()
  const k = p2.w / p.w
  ok('缩放后笔画跟着页面一起变大', k > 1.05 && Math.abs(s2[0].box[2] / s[0].box[2] - k) < 0.05, `页面 ×${k.toFixed(2)}，红圈 ${s[0].box[2]} → ${s2[0].box[2]}`)

  // ⌘Z 撤销蓝线
  await win.keyboard.press('Meta+z')
  await sleep(300)
  s = await strokes()
  ok('⌘Z 撤销刚画的蓝线', s.length === 1 && s[0].color === '#e5484d')
  // 橡皮擦红圈
  await win.locator('.ink-tools button[title^="橡皮"]').click()
  const red = s[0].box
  await win.mouse.move(red[0] + 2, red[1] + red[3] / 2)
  await win.mouse.down()
  await win.mouse.move(red[0] + 4, red[1] + red[3] / 2 + 2, { steps: 3 })
  await win.mouse.up()
  await sleep(300)
  ok('橡皮碰到红圈：擦掉了', (await strokes()).length === 0 && (await ev((x) => window.api.inkList(x), id)).length === 0)

  // 再画一笔，放下笔，重开还在
  await win.locator('.ink-tools .ink-dot').nth(2).click()
  p = await page1()
  await circle(p.x + p.w * 0.4, p.y + p.h * 0.3, 40)
  await win.keyboard.press('Escape')
  await sleep(300)
  ok('Esc 放下笔，又能选字', (await win.locator('.ink-tools').count()) === 0 && !(await ev(() => document.querySelector('.pdf-scroller').classList.contains('ink-mode'))))
  await close(app)
  ;({ app, win } = await launch(dir, { DEEPSEEK_API_KEY: '' }))
  ev = (fn, ...a) => win.evaluate(fn, ...a)
  await sleep(1200)
  await openPdf(id)
  s = await strokes()
  ok('重开应用：笔画还在', s.length === 1 && s[0].color === '#1d1d1f')
  console.log(await shot(win, 'ink-reopen'))
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
