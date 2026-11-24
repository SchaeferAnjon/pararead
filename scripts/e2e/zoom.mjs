// 放大缩小（0.2.1）真走一遍：对照下捏合放大原文 → 译文那边比例相同、同一页两边顶边差在 ±8px、手指下那一点不动；
// ⌘+ / ⌘- 两边一起；放大到 230%、300% 横着能滚到最左（左页左边界在可视区里）和最右（右页右边界在）；⌘0 回适合宽度；关了再开倍数还在。
// 译页不用真翻（「打开就翻」关着，译页是变灰的原页，大小和位置一样）。
//   E2E_PAPER=<一篇双栏论文 PDF> [BABELDOC_DIR=<装好的组件，装过才出对照两页>] node scripts/e2e/zoom.mjs <新的数据目录>
import { close, launch, PAPER, ROOT, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-zoom`
const env = { PARAREAD_BABELDOC_DIR: process.env.BABELDOC_DIR ?? `${ROOT}/tmp/babeldoc` }
let { app, win } = await launch(dir, env)
let ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
let passed = 0
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass ? passed++ : fails.push(name))
const geo = (n) =>
  ev((n) => {
    const box = (side) => {
      const r = document.querySelector(`.page[data-page="${n}"][data-side="${side}"]`)?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right } : null
    }
    const sc = document.querySelector('.pdf-scroller').getBoundingClientRect()
    return { src: box('src'), tr: box('tr'), sc: { x: sc.x, y: sc.y, w: sc.width, h: sc.height, right: sc.right } }
  }, n)
const zoomNow = async () => (await win.locator('[data-testid="zoom-btn"]').innerText()).trim()
const menuCmd = (id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id)

try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, trOnOpen: false, openView: 'dual', dualLayout: 'side', rightCollapsed: true, leftCollapsed: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)
  const g0 = await geo(1)
  ok('对照：一行两页（原页、译页）', !!g0.src && !!g0.tr, JSON.stringify(g0).slice(0, 120))
  ok('工具栏缩放按钮写 100%', (await zoomNow()) === '100%')
  await win.locator('[data-testid="zoom-btn"]').click()
  const items = (await win.locator('.pop.menu .menu-item').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  ok('百分比菜单：适合宽度、50% 到 300%', items.some((x) => x.startsWith('适合宽度')) && items.some((x) => x.startsWith('50%')) && items.some((x) => x.startsWith('300%')), items.join(' | '))
  await shot(win, 'zoom-menu')
  await win.keyboard.press('Escape')

  // 1. 捏合放大原文：在原页第 1 页正文中间捏，手指下那一点不动，译页同比例、同一行
  const px = g0.src.x + g0.src.w * 0.3
  const py = g0.src.y + Math.min(g0.src.h * 0.45, g0.sc.h * 0.6)
  const fx = (px - g0.src.x) / g0.src.w
  const fy = (py - g0.src.y) / g0.src.h
  await shot(win, 'zoom-before')
  await win.mouse.move(px, py)
  await win.keyboard.down('Control')
  for (let i = 0; i < 6; i++) {
    await win.mouse.wheel(0, -12)
    await sleep(60)
  }
  await win.keyboard.up('Control')
  await sleep(1200)
  const z1 = await zoomNow()
  const g1 = await geo(1)
  ok('捏合放大：倍数变大', parseInt(z1) > 100, z1)
  ok('原页、译页一样大（同比例）', Math.abs(g1.src.w - g1.tr.w) < 1 && Math.abs(g1.src.w / g0.src.w - parseInt(z1) / 100) < 0.03, `${g0.src.w.toFixed(0)} → ${g1.src.w.toFixed(0)} / ${g1.tr.w.toFixed(0)}`)
  ok('同一页两边顶边差 ±8px', Math.abs(g1.src.y - g1.tr.y) <= 8, `${(g1.src.y - g1.tr.y).toFixed(1)}`)
  const nx = g1.src.x + fx * g1.src.w
  const ny = g1.src.y + fy * g1.src.h
  ok('捏的那一点还在手指下（±8px）', Math.abs(nx - px) <= 8 && Math.abs(ny - py) <= 8, `${(nx - px).toFixed(1)}, ${(ny - py).toFixed(1)}`)
  await shot(win, 'zoom-after-pinch')

  // 2. ⌘+ / ⌘-：两边一起
  await menuCmd('zoom-in')
  await sleep(800)
  const z2 = await zoomNow()
  const g2 = await geo(1)
  ok('⌘+ 放大一档（到下一个整 10%），两边一起', parseInt(z2) === Math.floor(parseInt(z1) / 10) * 10 + 10 && Math.abs(g2.src.w - g2.tr.w) < 1, `${z1} → ${z2}`)
  await menuCmd('zoom-out')
  await menuCmd('zoom-out')
  await sleep(800)
  const g3 = await geo(1)
  ok('⌘- 缩小，两边一起', parseInt(await zoomNow()) === parseInt(z2) - 20 && Math.abs(g3.src.w - g3.tr.w) < 1, await zoomNow())

  // 3. 230%、300%：横着滚到最左，左页左边界在可视区里；滚到最右，右页右边界在
  for (const pct of ['230%', '300%']) {
    if (pct === '230%') {
      await win.locator('[data-testid="zoom-btn"]').click()
      await win.locator('.pop.menu .menu-item', { hasText: '250%' }).click()
      for (let i = 0; i < 2; i++) await menuCmd('zoom-out')
    } else {
      await win.locator('[data-testid="zoom-btn"]').click()
      await win.locator('.pop.menu .menu-item', { hasText: '300%' }).click()
    }
    await sleep(1200)
    ok(`到 ${pct}`, (await zoomNow()) === pct, await zoomNow())
    await ev(() => (document.querySelector('.pdf-scroller').scrollLeft = 0))
    await sleep(300)
    const gl = await geo(1)
    ok(`${pct} 滚到最左：左页左边界在可视区里`, gl.src.x >= gl.sc.x - 0.5, `左页 ${gl.src.x.toFixed(0)} · 视口 ${gl.sc.x.toFixed(0)}`)
    await shot(win, `zoom-${pct.replace('%', '')}-left`)
    await ev(() => { const s = document.querySelector('.pdf-scroller'); s.scrollLeft = s.scrollWidth })
    await sleep(300)
    const gr = await geo(1)
    ok(`${pct} 滚到最右：右页右边界在可视区里`, gr.tr.right <= gr.sc.right + 0.5, `右页 ${gr.tr.right.toFixed(0)} · 视口 ${gr.sc.right.toFixed(0)}`)
  }

  // 4. 关了再开倍数还在（按论文记）；⌘0 回适合宽度
  await close(app)
  ;({ app, win } = await launch(dir, env))
  ev = (fn, ...a) => win.evaluate(fn, ...a)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
  await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)
  ok('关了再开：这篇还是 300%', (await zoomNow()) === '300%', await zoomNow())
  await menuCmd('zoom-reset')
  await sleep(800)
  const g4 = await geo(1)
  ok('⌘0 回适合宽度（100%），两页回到原来大小', (await zoomNow()) === '100%' && Math.abs(g4.src.w - g0.src.w) < 2, `${g4.src.w.toFixed(0)} / ${g0.src.w.toFixed(0)}`)
} finally {
  await close(app).catch(() => {})
}
console.log(`\n${passed} 项通过，${fails.length} 项没过${fails.length ? '：' + fails.join('；') : ''}`)
process.exit(fails.length ? 1 : 0)
