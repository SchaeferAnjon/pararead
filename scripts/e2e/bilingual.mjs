// 对照模式的两种排法：上下（译文跟在每段原文下面）和左右（原文在左、译文在右，按段对齐）。
// 在显示设置里切、量每段的位置、左右排时划词高亮、换排法后还停在原来那段、窄窗口、重开还记得。
// DEEPSEEK_API_KEY=… node scripts/e2e/bilingual.mjs <新的数据目录>；E2E_PAPER=<一篇带公式和图的论文 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-bilingual`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h])
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
// 第一个已经有译文的正文段、第一个标题、第一个不翻译的块（公式、图、表）各自的位置
const measure = () =>
  ev(() => {
    const box = (n) => { const r = n?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), b: Math.round(r.bottom) } : null }
    const art = document.querySelector('article.reflow')
    const cs = getComputedStyle(art)
    const inner = art.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const para = [...art.querySelectorAll('.blk.paragraph')].find((b) => b.querySelector('.tr-text') && b.querySelector('.src').textContent.length > 200)
    const head = [...art.querySelectorAll('.blk.heading')].find((b) => b.querySelector('.tr-text'))
    const wide = art.querySelector('.blk.eq, .blk.img, .blk.table')
    return { side: art.classList.contains('lay-side'), inner: Math.round(inner), src: box(para?.querySelector('.src')), tr: box(para?.querySelector('.tr')), hsrc: box(head?.querySelector('.src')), htr: box(head?.querySelector('.tr')), wide: box(wide), wideKind: wide?.className }
  })
const pick = async (label) => {
  if (!(await win.locator('.aa-pop').count())) await win.locator('button[title="显示设置"]').click()
  await win.locator('.aa-pop .seg-item', { hasText: label }).click()
  await sleep(500)
}
const topBlock = () => ev(() => { const sc = document.querySelector('.reflow-scroller'); const top = sc.getBoundingClientRect().top; return [...sc.querySelectorAll('[data-block]')].find((n) => n.getBoundingClientRect().bottom > top + 8)?.dataset.block })
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await size(1440, 900)
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  for (let i = 0; i < 60 && (await win.locator('.blk.paragraph .tr-text').count()) < 4; i++) await sleep(1000)

  let m = await measure()
  ok('默认是上下：译文在原文下面，同一栏', !m.side && m.tr.y >= m.src.b && m.tr.x === m.src.x && m.tr.w === m.src.w, JSON.stringify({ src: m.src, tr: m.tr }))
  console.log(await shot(win, 'bi-stack'))

  await pick('左右')
  m = await measure()
  const gap = m.tr.x - (m.src.x + m.src.w)
  ok('切到左右：原文在左、译文在右，两栏一样宽', m.side && m.tr.x > m.src.x + m.src.w && Math.abs(m.tr.w - m.src.w) <= 1, `栏宽 ${m.src.w} / ${m.tr.w}，栏距 ${gap}`)
  ok('按段对齐：两边第一行顶上差不到 6', Math.abs(m.tr.y - m.src.y) < 6, `原文顶 ${m.src.y}，译文顶 ${m.tr.y}`)
  ok('标题也分两栏', m.htr.x > m.hsrc.x + m.hsrc.w - 1 && Math.abs(m.htr.y - m.hsrc.y) < 8, JSON.stringify({ src: m.hsrc, tr: m.htr }))
  ok('公式、图、表跨两栏', !!m.wide && Math.abs(m.wide.w - m.inner) <= 1, `${m.wideKind} 宽 ${m.wide?.w}，版心 ${m.inner}`)
  await win.keyboard.press('Escape')
  await win.mouse.click(700, 500)
  await sleep(300)
  console.log(await shot(win, 'bi-side-1440'))

  // 左右排时划词：在原文栏拖选一段，点黄色，高亮存上。译文还在陆续到，等这一段不动了再拖
  // 选定一段（已经有译文、够长），滚到它的开头（段比窗口高时滚到中间会把第一行滚出去），之后只盯这一段
  const tid = await ev(() => { const b = [...document.querySelectorAll('.blk.paragraph')].find((x) => x.querySelector('.tr-text') && x.querySelector('.src').textContent.length > 200); b.scrollIntoView({ block: 'start' }); document.querySelector('.reflow-scroller').scrollTop -= 80; return b.dataset.block })
  const target = () => ev((id) => { const r = document.querySelector(`[data-block="${id}"] .src`).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } }, tid)
  let p2 = await target()
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const now = await target()
    if (now.y === p2.y) break
    p2 = now
  }
  await win.mouse.move(p2.x + 20, p2.y + 12)
  await win.mouse.down()
  await win.mouse.move(p2.x + Math.min(260, p2.w - 20), p2.y + 12, { steps: 8 })
  await win.mouse.up()
  await sleep(500)
  const selInfo = await ev(() => ({ sel: String(getSelection()).slice(0, 60), pop: [...document.querySelectorAll('.pop')].map((n) => n.className), at: document.elementFromPoint(innerWidth / 2, 300)?.className }))
  ok('左右排时划词出工具条', (await win.locator('.sel-toolbar').count()) === 1, JSON.stringify({ ...selInfo, p2 }))
  if (!(await win.locator('.sel-toolbar').count())) console.log(await shot(win, 'bi-debug'))
  await win.locator('.sel-toolbar .dot-btn').first().click({ timeout: 5000 })
  await sleep(600)
  const anns = await ev((x) => window.api.annList(x), id)
  ok('高亮存上了', anns.length === 1 && anns[0].text.length > 5, anns[0]?.text.slice(0, 40))
  console.log(await shot(win, 'bi-side-highlight'))

  // 换排法后还停在原来那段
  await ev(() => { const sc = document.querySelector('.reflow-scroller'); sc.scrollTop = sc.scrollHeight * 0.4 })
  await sleep(600)
  const before = await topBlock()
  await pick('上下')
  const afterStack = await topBlock()
  await pick('左右')
  const afterSide = await topBlock()
  ok('换排法后顶上还是同一段', before === afterStack && before === afterSide, `${before} → ${afterStack} → ${afterSide}`)

  // 只看英文时没有「排列」这一行；切回双语又出来
  await pick('只看英文')
  ok('只看英文时不出「排列」', (await win.locator('.aa-pop .aa-row', { hasText: '排列' }).count()) === 0 && !(await measure()).side)
  await pick('双语')
  ok('切回双语「排列」还是左右', (await win.locator('.aa-pop .aa-row', { hasText: '排列' }).count()) === 1 && (await measure()).side)
  await win.keyboard.press('Escape')

  // 窄窗口：正文列 580，两栏各 250 上下
  await size(960, 886)
  await sleep(900)
  await ev(() => (document.querySelector('.reflow-scroller').scrollTop = 0))
  await sleep(400)
  m = await measure()
  ok('960 宽的窗口里还是两栏，每栏不小于 240', m.side && m.src.w >= 240 && Math.abs(m.tr.w - m.src.w) <= 1, `栏宽 ${m.src.w}，栏距 ${m.tr.x - m.src.x - m.src.w}`)
  // 窄窗口里「显示设置」要点得到（标题栏放不下时文字按钮只留图标）
  const bar = await ev(() => { const mid = document.querySelector('.col-mid').getBoundingClientRect(); const r = (t) => Math.round(document.querySelector(`button[title^="${t}"]`).getBoundingClientRect().right); return { mid: Math.round(mid.right), aa: r('显示设置'), find: r('搜索'), tools: [...document.querySelectorAll('.bar-tools > *')].filter((b) => b.getBoundingClientRect().top < mid.top + 44).length } })
  ok('960 宽：搜索和显示设置都在标题栏里', bar.aa <= bar.mid && bar.find < bar.aa, JSON.stringify(bar))
  await pick('上下')
  ok('窄窗口里也切得动', !(await measure()).side)
  await pick('左右')
  await win.keyboard.press('Escape')
  await win.mouse.click(300, 500)
  await sleep(300)
  console.log(await shot(win, 'bi-side-960'))
  ok('设置里记着', (await ev(() => window.api.getSettings())).trLayout === 'side')
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
