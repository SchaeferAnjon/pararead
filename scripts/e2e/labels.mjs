// 标签：选中一段点「看不懂」，另一段点「有质疑」；正文里画波浪线、悬停看到标签；点已有的标注可以去掉标签；
// 左栏笔记和全库笔记页能按标签筛；原文模式里也能打；导出的 Markdown 带标签。
// node scripts/e2e/labels.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-labels`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const dragIn = async (nth) => {
  const p = await ev((n) => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const b = [...document.querySelectorAll('.blk.paragraph')].filter((x) => x.getBoundingClientRect().top > sc.top + 40 && x.querySelector('.src').textContent.length > 200)[n]; const q = b.querySelector('.src').getBoundingClientRect(); return { x: q.x, y: q.y } }, nth)
  await win.mouse.move(p.x + 40, p.y + 14)
  await win.mouse.down()
  await win.mouse.move(p.x + 300, p.y + 14, { steps: 8 })
  await win.mouse.up()
  await sleep(400)
  return p
}
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'src' }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(2000)
  await ev(() => { [...document.querySelectorAll('.blk.heading')].find((x) => /INTRODUCTION/.test(x.textContent)).scrollIntoView({ block: 'start' }); document.querySelector('.reflow-scroller').scrollTop -= 40 })
  await sleep(700)

  const p0 = await dragIn(0)
  ok('划词工具条里有「看不懂」「有质疑」', (await win.locator('.sel-toolbar .tb-label').count()) === 2)
  console.log(await shot(win, 'labels-toolbar'))
  await win.locator('.sel-toolbar .tb-label[data-label="confused"]').click()
  await sleep(600)
  await dragIn(1)
  await win.locator('.sel-toolbar .tb-label[data-label="doubt"]').click()
  await sleep(800)
  let anns = await ev((x) => window.api.annList(x), id)
  ok('两处都存上了，各带标签', anns.length === 2 && anns.some((a) => a.label === 'confused') && anns.some((a) => a.label === 'doubt'), anns.map((a) => a.label).join('、'))
  const waves = await ev(() => ({ c: CSS.highlights.get('lb-confused')?.size ?? 0, d: CSS.highlights.get('lb-doubt')?.size ?? 0 }))
  ok('正文里画了两种波浪线', waves.c === 1 && waves.d === 1, JSON.stringify(waves))
  ok('打了标签的地方不铺底色，只有线', (await ev(() => ['yellow', 'green', 'blue', 'red'].reduce((n, c) => n + (CSS.highlights.get(`hl-${c}`)?.size ?? 0), 0))) === 0)
  await win.mouse.move(p0.x + 120, p0.y + 14)
  await sleep(700)
  const tip = await win.locator('.note-tip').textContent().catch(() => '')
  ok('鼠标停上去看到标签', tip.includes('看不懂'), tip)
  await win.mouse.move(60, 700)
  console.log(await shot(win, 'labels-text'))

  // 左栏笔记按标签筛
  await win.locator('.lp-tabs .seg-item', { hasText: '笔记' }).click()
  await sleep(300)
  await win.locator('.notes .lp-bar .seg-item', { hasText: '有质疑' }).click()
  await sleep(300)
  ok('左栏笔记点「有质疑」只剩那一条，带标签', (await win.locator('.note-item').count()) === 1 && (await win.locator('.note-item .lb-chip').textContent()) === '有质疑')
  console.log(await shot(win, 'labels-notes'))

  // 点已有的「看不懂」，再点「看不懂」去掉
  await win.mouse.click(p0.x + 120, p0.y + 14)
  await sleep(400)
  ok('点已有的标注：标签按钮是选中的', (await win.locator('.sel-toolbar .tb-label.current[data-label="confused"]').count()) === 1)
  await win.locator('.sel-toolbar .tb-label[data-label="confused"]').click()
  await sleep(600)
  anns = await ev((x) => window.api.annList(x), id)
  ok('再点一次去掉标签：波浪线没了，变回普通高亮', anns.length === 2 && anns.filter((a) => a.label).length === 1 && (await ev(() => CSS.highlights.get('lb-confused')?.size ?? 0)) === 0 && (await ev(() => ['yellow', 'green', 'blue', 'red'].reduce((n, c) => n + (CSS.highlights.get(`hl-${c}`)?.size ?? 0), 0))) === 1)
  await win.keyboard.press('Escape')

  // 原文模式里打标签
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][0]?.click())
  await sleep(2500)
  const line = await ev(() => { const sp = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.length > 40 && s.getBoundingClientRect().top > 150 && s.getBoundingClientRect().top < 700); const q = sp.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height } })
  await win.mouse.move(line.x + 4, line.y + line.h / 2)
  await win.mouse.down()
  await win.mouse.move(line.x + Math.min(240, line.w - 6), line.y + line.h / 2, { steps: 8 })
  await win.mouse.up()
  await sleep(500)
  await win.locator('.sel-toolbar .tb-label[data-label="confused"]').click()
  await sleep(800)
  ok('原文模式也能打标签，页面上有虚线、没有底色', (await win.locator('.pdf-hl.lb-confused').count()) >= 1 && (await win.locator('.pdf-hl.lb-confused').first().evaluate((n) => getComputedStyle(n).backgroundImage + getComputedStyle(n).backgroundColor)).includes('rgba(0, 0, 0, 0)'))

  // 全库笔记页
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await sleep(800)
  await win.locator('.nav-item', { hasText: '笔记' }).click()
  await win.waitForSelector('.np-item')
  await win.locator('.notes-page .seg-item', { hasText: '看不懂' }).click()
  await sleep(300)
  ok('笔记页按「看不懂」筛：只剩原文模式那一条', (await win.locator('.np-item').count()) === 1 && (await win.locator('.np-item .lb-chip').textContent()) === '看不懂')
  console.log(await shot(win, 'labels-page'))
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
