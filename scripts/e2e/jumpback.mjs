// 跳走以后一键回来：对照模式点引用角标 →「跳到参考文献表里这一条」→ 底部出「回到刚才读的地方」→ 点它回到原处；
// 再跳一次，按 ⌘[（菜单「返回」）也回原处；原文模式点 PDF 里的引用链接跳到参考文献那页，再点回来。
// E2E_PAPER=<带引用链接的 PDF，比如 arXiv 的 1706.03762> node scripts/e2e/jumpback.mjs <新的数据目录>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-jumpback`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const top = (sel) => ev((s) => document.querySelector(s)?.scrollTop ?? -1, sel)
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2000)

  // —— 对照模式
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(2500)
  // 找正文里第一个 [n] 引用，滚到它，点它
  const at = await ev(() => {
    const sc = document.querySelector('.reflow-scroller')
    const walker = document.createTreeWalker(document.querySelector('.reflow'), NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement.closest('.blk.paragraph .src')) continue
      const m = /\[(\d+)\]/.exec(n.textContent)
      if (!m) continue
      n.parentElement.scrollIntoView({ block: 'center' })
      const rg = document.createRange()
      rg.setStart(n, m.index + 1)
      rg.setEnd(n, m.index + 1 + m[1].length)
      const b = rg.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, n: m[1], top: sc.scrollTop }
    }
    return null
  })
  ok('对照：正文里找到引用角标', !!at, at ? `[${at.n}]` : '')
  await sleep(300)
  const before = await top('.reflow-scroller')
  await win.mouse.click(at.x, at.y)
  await win.locator('.citepop').waitFor({ timeout: 5000 })
  await win.locator('.citepop button[title="跳到参考文献表里这一条"]').click()
  await sleep(1200)
  const after = await top('.reflow-scroller')
  const pill = win.locator('.back-pill')
  ok('跳到参考文献表，底部出「回到刚才读的地方」', after - before > 500 && (await pill.count()) === 1, `${before} → ${after}｜${await pill.innerText().catch(() => '')}`)
  console.log(await shot(win, 'jumpback-reflow-refs'))
  await pill.locator('.bp-go').click()
  await sleep(600)
  const back1 = await top('.reflow-scroller')
  ok('点它回到原处，提示收起', Math.abs(back1 - before) < 4 && (await pill.count()) === 0, `${back1}`)

  // 再跳一次，用菜单「返回」（⌘[）回来；没有可回的时候 ⌘[ 才回文献库
  await win.mouse.click(at.x, at.y)
  await win.locator('.citepop').waitFor({ timeout: 5000 })
  await win.locator('.citepop button[title="跳到参考文献表里这一条"]').click()
  await sleep(1000)
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('back').click())
  await sleep(600)
  ok('⌘[ 也回到原处，还在阅读页', Math.abs((await top('.reflow-scroller')) - before) < 4 && (await win.locator('.reflow').count()) === 1)

  // —— 原文模式：点 PDF 里的引用链接
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][0]?.click())
  await sleep(2500)
  const link = await ev(() => {
    const sc = document.querySelector('.pdf-scroller')
    for (const a of document.querySelectorAll('.page .pdf-link:not([href])')) {
      const pg = Number(a.closest('.page').dataset.page)
      if (pg < 2) continue
      a.scrollIntoView({ block: 'center' })
      const b = a.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, page: pg, n: document.querySelectorAll('.pdf-link').length, top: sc.scrollTop }
    }
    return { n: document.querySelectorAll('.pdf-link').length }
  })
  ok('原文：PDF 里的内部链接能点', link.page > 0, `这几页共 ${link.n} 个链接，点第 ${link.page} 页的一个`)
  await sleep(400)
  const pBefore = await top('.pdf-scroller')
  await win.mouse.click(link.x, link.y)
  await sleep(1200)
  const pAfter = await top('.pdf-scroller')
  ok('点链接跳走，底部出「回到第 N 页」（N 是点链接的那页）', Math.abs(pAfter - pBefore) > 300 && (await pill.innerText().catch(() => '')).includes(`回到第 ${link.page} 页`), `${pBefore} → ${pAfter}｜${await pill.innerText().catch(() => '')}`)
  console.log(await shot(win, 'jumpback-pdf'))
  await pill.locator('.bp-go').click()
  await sleep(600)
  ok('点它回到原来那页', Math.abs((await top('.pdf-scroller')) - pBefore) < 4 && (await pill.count()) === 0)

  // 没有可回的时候 ⌘[ 回文献库
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('back').click())
  await sleep(1200)
  ok('没有可回的时候 ⌘[ 回文献库', (await win.locator('.reflow, .pdf-scroller').count()) === 0)
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
