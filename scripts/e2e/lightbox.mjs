// 对照模式里点图放大：图弹出来盖住整个窗口；点图放大到 2 倍、再点还原；触控板捏合（带 ctrl 的滚轮）缩放；
// 放大后能拖、能双指滑；点空白、按 Esc、点关闭都能关。
// node scripts/e2e/lightbox.mjs <新的数据目录>；E2E_PAPER=<一篇带图的论文 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-lightbox`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
// 大图现在的样子：占多大、倍数写的多少
const state = () => ev(() => { const lb = document.querySelector('.lightbox'); if (!lb) return null; const r = lb.querySelector('img').getBoundingClientRect(); const b = lb.getBoundingClientRect(); return { cover: Math.round(b.width) === innerWidth && Math.round(b.height) === innerHeight, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), pct: lb.querySelector('.lb-pct').textContent } })
const openIt = async () => { await win.locator('.blk.img .plate').first().click(); await win.waitForSelector('.lightbox'); await sleep(300) }
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'src' }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), r.paper.id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${r.paper.id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(2000)
  await ev(() => document.querySelector('.blk.img').scrollIntoView({ block: 'center' }))
  await sleep(800)

  await openIt()
  const fit = await state()
  const [innerW, innerH] = await ev(() => [innerWidth, innerHeight])
  ok('点图：弹出来盖住整个窗口，图撑到窗口能放下的最大', !!fit && fit.cover && fit.pct === '100%' && Math.abs(Math.max(fit.w / (innerW * 0.92), fit.h / (innerH * 0.86)) - 1) < 0.01, JSON.stringify(fit))
  console.log(await shot(win, 'lightbox-fit'))
  ok('正文里的图不再原地放大', (await win.locator('.blk.img.zoomed').count()) === 0)

  // 点图：放大到 2 倍；再点：还原
  const img = await win.locator('.lightbox img').boundingBox()
  await win.mouse.click(img.x + img.width * 0.25, img.y + img.height * 0.25)
  await sleep(300)
  let s = await state()
  ok('点一下图：放大到 2 倍', s.pct === '200%' && Math.abs(s.w - fit.w * 2) <= 2, JSON.stringify(s))
  console.log(await shot(win, 'lightbox-2x'))
  // 放大后按住拖：图跟着走，松手不算点击
  await win.mouse.move(720, 450)
  await win.mouse.down()
  await win.mouse.move(620, 400, { steps: 6 })
  await win.mouse.up()
  await sleep(200)
  let d = await state()
  ok('放大后能拖着看，拖完不会被当成点击', d.pct === '200%' && d.x === s.x - 100 && d.y === s.y - 50, `${s.x},${s.y} → ${d.x},${d.y}`)
  await win.mouse.click(720, 450)
  await sleep(300)
  ok('再点一下：还原', (await state()).pct === '100%')

  // 触控板捏合：浏览器里是带 ctrl 的滚轮
  await win.mouse.move(720, 450)
  await win.keyboard.down('Control')
  for (let i = 0; i < 6; i++) await win.mouse.wheel(0, -20)
  await win.keyboard.up('Control')
  await sleep(300)
  s = await state()
  ok('捏合放大', parseInt(s.pct) > 250 && s.w > fit.w * 2.5, s.pct)
  // 双指滑动：平移
  await win.mouse.wheel(60, 40)
  await sleep(200)
  d = await state()
  ok('放大后双指滑动是平移', d.x === s.x - 60 && d.y === s.y - 40 && d.pct === s.pct, `${s.x},${s.y} → ${d.x},${d.y}`)
  await win.keyboard.down('Control')
  for (let i = 0; i < 30; i++) await win.mouse.wheel(0, 20)
  await win.keyboard.up('Control')
  await sleep(300)
  ok('捏合缩小：最小回到刚好放下', (await state()).pct === '100%')
  // 工具条的加减
  await win.locator('.lb-bar button[title="放大"]').click()
  await sleep(200)
  ok('工具条的放大', (await state()).pct === '150%')

  // 三种关法
  await win.keyboard.press('Escape')
  await sleep(300)
  ok('按 Esc 关掉，还在对照模式里', (await state()) === null && (await win.locator('.reflow-scroller').count()) === 1)
  await openIt()
  await win.mouse.click(20, 450)
  await sleep(300)
  ok('点空白关掉', (await state()) === null)
  await openIt()
  await win.locator('.lb-bar button[title="关闭"]').click()
  await sleep(300)
  ok('点关闭按钮关掉', (await state()) === null)
  // 图上悬停的「放大」按钮也是弹出来
  await win.locator('.blk.img').first().hover()
  await win.locator('.blk.img .hoverbar .hb', { hasText: '放大' }).first().click()
  await sleep(400)
  ok('悬停工具条里的「放大」也是弹出来', (await state())?.pct === '100%')
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
