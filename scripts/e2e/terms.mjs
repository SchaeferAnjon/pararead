// 术语：左栏点「术语」，AI 列出术语（译名、解释、次数）；正文里术语画虚线、悬停看解释；点一条跳到它出现的段，
// 再点跳下一处；关掉「正文里标出来」虚线没了；重开走缓存。
// DEEPSEEK_API_KEY=… node scripts/e2e/terms.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-terms`
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
let { app, win } = await launch(dir, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
let ev = (fn, ...a) => win.evaluate(fn, ...a)
const open = async (id) => {
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(1500)
  await win.locator('.lp-tabs .seg-item', { hasText: '术语' }).click()
}
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'src' }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await open(id)
  const t0 = Date.now()
  await win.waitForSelector('.term-item', { timeout: 150000 })
  const items = await win.locator('.term-item').evaluateAll((ns) => ns.map((n) => ({ term: n.dataset.term, head: n.querySelector('.term-head').textContent, ex: n.querySelector('.term-ex')?.textContent ?? '', n: parseInt(n.querySelector('.hint').textContent), off: n.disabled })))
  ok('点开「术语」：AI 列出了术语，带译名、解释、次数', items.length >= 8 && items.filter((x) => x.n > 0).length >= items.length * 0.7 && items.every((x) => x.ex.length > 4), `${items.length} 条，${Math.round((Date.now() - t0) / 1000)} 秒；${items.slice(0, 4).map((x) => `${x.head}`).join('｜')}`)
  await sleep(800)
  const marks = await ev(() => [...(CSS.highlights.get('term') ?? [])].map((q) => q.toString()))
  ok('正文里的术语画了虚线', marks.length >= 10, `${marks.length} 处，例如 ${marks.slice(0, 4).join('、')}`)

  // 悬停一处虚线：出译名和解释
  const pt = await ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const q = [...CSS.highlights.get('term')].map((r) => r.getClientRects()[0]).find((q) => q && q.top > sc.top + 40 && q.bottom < sc.bottom - 40); return q && { x: q.x + q.width / 2, y: q.y + q.height / 2 } })
  if (pt) {
    await win.mouse.move(pt.x, pt.y)
    await sleep(700)
  }
  const tip = await win.locator('.note-tip').textContent().catch(() => '')
  ok('鼠标停在术语上：出译名和解释', !!pt && tip.length > 6, tip.replace(/\n/g, ' ｜ '))
  console.log(await shot(win, 'terms-panel'))

  // 点一条出现两段以上的：跳到第一处，再点跳到下一处
  const multi = await win.locator('.term-item').evaluateAll((ns) => ns.findIndex((n) => !n.disabled && parseInt(n.querySelector('.hint').textContent) >= 3))
  const where = () => ev(() => { const sc = document.querySelector('.reflow-scroller'); return Math.round(sc.scrollTop) })
  await win.locator('.term-item').nth(multi).click()
  await sleep(900)
  const y1 = await where()
  await win.locator('.term-item').nth(multi).click()
  await sleep(900)
  const y2 = await where()
  ok('点一条跳到它出现的段，再点跳到下一处', multi >= 0 && y2 !== y1, `${items[multi]?.term}：${y1} → ${y2}`)

  // 关掉「正文里标出来」
  await win.locator('.terms .lp-bar .switch').click()
  await sleep(600)
  ok('关掉「正文里标出来」：虚线没了，设置记着', (await ev(() => CSS.highlights.get('term')?.size ?? 0)) === 0 && (await ev(() => window.api.getSettings())).termMarks === false)
  await win.locator('.terms .lp-bar .switch').click()
  await sleep(300)

  // 重开：直接出来
  await close(app)
  ;({ app, win } = await launch(dir, { DEEPSEEK_API_KEY: '' }))
  ev = (fn, ...a) => win.evaluate(fn, ...a)
  await sleep(1200)
  await open(id)
  await win.waitForSelector('.term-item', { timeout: 5000 }).catch(() => {})
  ok('重开应用：术语直接出来（走缓存，没有 AI 也行）', (await win.locator('.term-item').count()) === items.length)
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
