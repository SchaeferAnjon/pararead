// 批注管理走一遍：对照模式里划线、高亮（带页码），原文模式里划线；回文献库点「笔记」，全库的摘录按论文列着、带页码，
// 搜得到，点一条回到那篇论文的那一处。
// node scripts/e2e/notes.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-notes`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
// 在对照模式某一段的原文第一行拖选一截，返回这一段的块号
const dragIn = async (nth) => {
  const p = await ev((n) => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const b = [...document.querySelectorAll('.blk.paragraph')].filter((x) => x.getBoundingClientRect().top > sc.top + 40 && x.querySelector('.src').textContent.length > 200)[n]; const q = b.querySelector('.src').getBoundingClientRect(); return { id: b.dataset.block, x: q.x, y: q.y } }, nth)
  await win.mouse.move(p.x + 40, p.y + 14)
  await win.mouse.down()
  await win.mouse.move(p.x + 300, p.y + 14, { steps: 8 })
  await win.mouse.up()
  await sleep(400)
  return p.id
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

  // 1. 划线
  await dragIn(0)
  await win.locator('.sel-toolbar button[title="划线"]').click()
  await sleep(700)
  let anns = await ev((x) => window.api.annList(x), id)
  const ul = await ev(() => [...(CSS.highlights.get('ul-yellow') ?? [])].map((q) => q.toString()))
  ok('对照模式里划线：存成划线，字下面有线、没有底色', anns.length === 1 && anns[0].style === 'underline' && ul.length === 1 && (await ev(() => (CSS.highlights.get('hl-yellow')?.size ?? 0))) === 0, ul[0])
  ok('这条标注带着原文的页码', typeof anns[0].page === 'number' && anns[0].page >= 1, `第 ${anns[0].page} 页`)
  // 2. 高亮，再写批注
  await dragIn(1)
  await win.locator('.sel-toolbar .dot-btn').nth(1).click()
  await sleep(700)
  anns = await ev((x) => window.api.annList(x), id)
  const hl = anns.find((a) => a.style !== 'underline')
  ok('高亮照旧，也带页码', !!hl && hl.color === 'green' && typeof hl.page === 'number', `第 ${hl?.page} 页`)
  await ev((a) => window.api.annSave({ ...a, note: '这句是全文的出发点', updatedAt: Date.now() }), hl)
  // 3. 点已有的划线，再点「划线」：变回高亮；再点一次变回划线
  await ev(() => getSelection().removeAllRanges())
  console.log(await shot(win, 'notes-reader'))

  // 4. 回文献库，进「笔记」页
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await sleep(800)
  await win.locator('.nav-item', { hasText: '笔记' }).click()
  await win.waitForSelector('.np-item')
  const page = await ev(() => ({ papers: [...document.querySelectorAll('.np-paper .tt')].map((n) => n.textContent), items: [...document.querySelectorAll('.np-item')].map((n) => ({ ul: !!n.querySelector('.np-mark .ul'), quote: n.querySelector('.np-quote').textContent.slice(0, 30), note: n.querySelector('.np-note')?.textContent ?? '', meta: n.querySelector('.hint').textContent })) }))
  ok('笔记页：按论文分组，两条都在，各带页码', page.papers.length === 1 && page.items.length === 2 && page.items.every((x) => /第 \d+ 页/.test(x.meta)) && page.items.some((x) => x.ul) && page.items.some((x) => x.note === '这句是全文的出发点'), JSON.stringify(page.items))
  console.log(await shot(win, 'notes-page'))
  await win.locator('.np-search input').fill('出发点')
  await sleep(300)
  ok('搜批注里的字：只剩那一条', (await win.locator('.np-item').count()) === 1)
  await win.locator('.np-search input').fill('')
  await win.locator('.notes-page .seg-item', { hasText: '有批注的' }).click()
  await sleep(300)
  ok('只看有批注的：一条', (await win.locator('.np-item').count()) === 1)
  await win.locator('.notes-page .seg-item', { hasText: '全部' }).click()
  await sleep(300)

  // 5. 点划线那一条：回到论文，跳到那一段
  const target = anns.find((a) => a.style === 'underline')
  await win.locator(`.np-item[data-ann="${target.id}"]`).click()
  await win.waitForSelector('.reflow-scroller .blk', { timeout: 20000 })
  await sleep(2500)
  const at = await ev((bid) => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const b = document.querySelector(`[data-block="${bid}"]`).getBoundingClientRect(); return { top: Math.round(b.top - sc.top), h: Math.round(sc.height) } }, target.blockId)
  ok('点一条回到原文那一处', at.top >= -10 && at.top < at.h / 2, JSON.stringify(at))
  console.log(await shot(win, 'notes-jump'))

  // 6. 原文（PDF）模式里划线
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][0]?.click())
  await sleep(2500)
  const line = await ev(() => { const sp = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.length > 40 && s.getBoundingClientRect().top > 150 && s.getBoundingClientRect().top < 700); const q = sp.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height } })
  await win.mouse.move(line.x + 4, line.y + line.h / 2)
  await win.mouse.down()
  await win.mouse.move(line.x + Math.min(240, line.w - 6), line.y + line.h / 2, { steps: 8 })
  await win.mouse.up()
  await sleep(500)
  await win.locator('.sel-toolbar button[title="划线"]').click()
  await sleep(800)
  anns = await ev((x) => window.api.annList(x), id)
  const pdfUl = anns.find((a) => a.mode === 'pdf')
  ok('原文模式里划线：有底线、带页码', !!pdfUl && pdfUl.style === 'underline' && pdfUl.page >= 1 && (await win.locator('.pdf-hl.ul').count()) >= 1, `第 ${pdfUl?.page} 页`)
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
