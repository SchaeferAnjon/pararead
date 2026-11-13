// 浏览器插件走一遍：真的 Chromium 里装上插件，打开真的论文页，点「存进 ParaRead」，看应用的文献库里有没有这篇、PDF 和信息在不在。
// 也查接收口不让普通网页往里发。要联网（arXiv、Nature、PubMed、Google Scholar）。
// node scripts/e2e/connector.mjs <新的数据目录>
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { close, launch, ROOT, shot, sleep } from './drive.mjs'

const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? '/opt/homebrew/lib/node_modules/')
const { chromium } = require('playwright')
const CHROMIUM = process.env.E2E_CHROMIUM ?? `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const EXT = `${ROOT}/out/renderer/extension`
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))

const profile = mkdtempSync(join(tmpdir(), 'pr-ext-'))
const ctx = await chromium.launchPersistentContext(profile, { executablePath: CHROMIUM, headless: true, locale: 'zh-CN', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-connector`, { DEEPSEEK_API_KEY: '' })
try {
  await sleep(1200)
  await win.evaluate(() => window.api.setSettings({ onboarded: true }))
  const st = await win.evaluate(() => window.api.connectorStatus())
  ok('应用的接收口开着，插件文件夹在数据目录里', st.running && st.port === 27485 && /browser-extension$/.test(st.dir), `${st.port} ${st.error}`)

  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }))
  const id = new URL(sw.url()).host
  // 打开一个论文页，再把插件的小窗开成标签页指向它；返回小窗那一页
  const capture = async (url) => {
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('  打开出错：', e.message.split('\n')[0]))
    await sleep(1500)
    if (process.env.E2E_VERBOSE) console.log('  页面：', page.url().slice(0, 80), '｜', (await page.title()).slice(0, 50), '｜citation 标签', await page.locator('meta[name^="citation_"]').count())
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u || (t.url ?? '').startsWith(u))?.id, page.url())
    const pop = await ctx.newPage()
    await pop.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`)
    await pop.waitForSelector('.item, .empty', { timeout: 20000 })
    const items = await pop.$$eval('.item', (ns) => ns.map((n) => ({ t: n.querySelector('.t').textContent, d: n.querySelector('.d').textContent, s: n.querySelector('.s').textContent })))
    return { page, pop, items, app: await pop.$eval('#app', (n) => n.textContent) }
  }
  const save = async (pop) => {
    await pop.click('#go')
    await pop.waitForSelector('.s[data-status]', { timeout: 120000 })
    return pop.$eval('.s[data-status]', (n) => [n.dataset.status, n.textContent])
  }
  const paper = (title) => win.evaluate(async (t) => (await window.api.listPapers()).find((p) => p.title.toLowerCase().includes(t)), title)

  // 1. arXiv 的论文页
  let c = await capture('https://arxiv.org/abs/1706.03762')
  ok('arXiv 论文页：认出题名、作者、有 PDF', c.items.length === 1 && /Attention Is All You Need/i.test(c.items[0].t) && /Vaswani/.test(c.items[0].d) && c.items[0].s === '有 PDF' && c.app === '已连上', JSON.stringify(c.items[0]))
  let r = await save(c.pop)
  await sleep(1500)
  let p = await paper('attention is all you need')
  ok('点一下存进去：文献库里有这篇，PDF、作者、年份、arXiv 号都在', r[0] === 'added' && !!p && p.pageCount > 5 && p.authors.length >= 6 && p.authors[0] === 'Ashish Vaswani' && p.year === 2017 && p.arxiv === '1706.03762', `${r[1]}｜${p?.pageCount} 页｜${p?.authors?.slice(0, 2).join('、')}｜${p?.year}｜${p?.arxiv}`)

  // 2. 同一篇的 PDF 页：认得出是 PDF，存的时候发现已经有了
  c = await capture('https://arxiv.org/pdf/1706.03762')
  r = c.items.length ? await save(c.pop) : ['', '']
  ok('直接开着 PDF 的标签页也能存，重复的不会存两份', c.items.length === 1 && r[0] === 'duplicate', `${JSON.stringify(c.items[0])}｜${r[1]}`)

  // 3. 出版社的论文页（Nature，开放获取）：期刊、卷、页码、DOI
  c = await capture('https://www.nature.com/articles/s41586-021-03819-2')
  ok('出版社论文页：认出题名和期刊', c.items.length === 1 && /AlphaFold/i.test(c.items[0].t) && /Nature/.test(c.items[0].d), JSON.stringify(c.items[0]))
  r = c.items.length ? await save(c.pop) : ['', '']
  await sleep(1500)
  p = await paper('alphafold')
  await c.pop.setViewportSize({ width: 360, height: 220 })
  ok('存进去：期刊、卷、页码、DOI 都在', (r[0] === 'added' || r[0] === 'link') && !!p && p.venue === 'Nature' && p.doi === '10.1038/s41586-021-03819-2' && !!p.volume && !!p.pages, `${r[1]}｜${p?.venue} ${p?.volume} ${p?.pages}｜${p?.doi}｜${p?.pageCount} 页`)
  await c.pop.screenshot({ path: `${process.env.E2E_SHOTS ?? ROOT + '/tmp/shots'}/connector-popup.png` })
  // 应用里的设置页
  await win.evaluate(() => window.api.openSettings('browser'))
  await sleep(1500)
  const sw2 = app.windows().find((w) => w !== win)
  ok('设置里有「浏览器插件」这一页，写着接收开着', (await sw2.locator('.ok-t', { hasText: '开着' }).count()) === 1 && (await sw2.locator('button', { hasText: '在访达里显示插件文件夹' }).count()) === 1)
  console.log(await shot(sw2, 'connector-settings'))
  await sw2.close()

  // 4. PubMed（页面上没有 PDF）
  c = await capture('https://pubmed.ncbi.nlm.nih.gov/34265844/')
  // PubMed 把自动化浏览器挡在外面（403）：挡了就只报，不算没过
  if (/^403|forbidden/i.test(await c.page.title())) console.log('没验  PubMed：这个站不让自动化浏览器进（403）')
  else ok('PubMed：认出题名、作者、期刊', c.items.length === 1 && c.items[0].t.length > 10 && c.items[0].d.length > 5, JSON.stringify(c.items[0]))

  // 5. Google Scholar 的结果页（可能被验证码挡住）
  c = await capture('https://scholar.google.com/scholar?q=attention+is+all+you+need')
  console.log(c.items.length ? `通过 Google Scholar：认出 ${c.items.length} 条，第一条 ${JSON.stringify(c.items[0])}` : '没验  Google Scholar：结果页没出来（自动化浏览器被拦到验证页）')

  // 6. 没有论文信息的普通网页
  c = await capture('https://example.com/')
  ok('普通网页：说没认出论文', c.items.length === 0 && (await c.pop.$eval('.empty', (n) => n.textContent)).includes('没认出'))

  // 7. 普通网页不能往接收口里发
  const evil = await ctx.newPage()
  await evil.goto('https://example.com/')
  const tries = await evil.evaluate(async () => {
    const t = async (init) => fetch('http://127.0.0.1:27485/save', init).then((x) => x.status, (e) => 'blocked')
    const body = JSON.stringify({ url: 'https://evil.example', meta: { title: 'injected by a web page' }, pdfUrl: null, pdf: null })
    return [await t({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ParaRead-Connector': '1' }, body }), await t({ method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body })]
  })
  await sleep(800)
  ok('普通网页往接收口发：被挡住，文献库里没多出东西', tries[0] === 'blocked' && !(await paper('injected by a web page')), JSON.stringify(tries))
} finally {
  await close(app)
  await ctx.close()
  rmSync(profile, { recursive: true, force: true })
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
