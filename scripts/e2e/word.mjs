// Word 引用插件：起本机 HTTPS 服务（不装进 Word、不动钥匙串），查接口，再用假 Office.js 在浏览器里把任务窗格走一遍：
// 搜索 → 插入引用 → 再插一处 → 参考文献表 → 换成 APA → 手改编号后格式检查 → 更新全文。还看设置里的「Word 插件」分区。
// 验证不了的：真 Word 里的侧载、系统信任证书、内容控件的真实行为（这台电脑没装 Word）。
//   node scripts/e2e/word.mjs <有两篇以上论文的数据目录>
import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import { createRequire } from 'node:module'
import { close, launch, ROOT, shot, sleep } from './drive.mjs'

const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? '/opt/homebrew/lib/node_modules/')
const { chromium } = require('playwright')
const ORIGIN = 'https://localhost:27484'
const ok = (name, cond, extra = '') => (console.log(`${cond ? '✓' : '✗'} ${name}${extra ? `：${extra}` : ''}`), cond || (process.exitCode = 1))
const get = (path, opts = {}) =>
  new Promise((res, rej) => {
    const r = request(ORIGIN + path, { rejectUnauthorized: false, method: 'GET', ...opts }, (rsp) => {
      let body = ''
      rsp.on('data', (d) => (body += d)).on('end', () => res({ status: rsp.statusCode, type: rsp.headers['content-type'], cors: rsp.headers['access-control-allow-origin'], body }))
    })
    r.on('error', rej).end()
  })

// 浏览器先起（起不来就别留一个应用在后台）。全局装的 playwright 和缓存里的浏览器版本对不上时，用 E2E_CHROME 指定可执行文件
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {})
const { app, win } = await launch(process.argv[2], { PARAREAD_WORD_SERVE: '1' })
try {
  await sleep(2500)
  await win.evaluate(() => window.api.setSettings({ onboarded: true, wordStyle: 'gbt', wordCheck: true }))

  // 接口
  const state = await get('/api/state')
  ok('/api/state', state.status === 200 && JSON.parse(state.body).style === 'gbt', state.body)
  ok('不给别的网站读（没有 CORS 头）', !state.cors)
  const all = JSON.parse((await get('/api/search?q=')).body)
  ok('/api/search 空词列最近的', all.items.length >= 2, `${all.total} 篇`)
  const word = all.items[0].title.split(/\s+/)[0]
  const hit = JSON.parse((await get('/api/search?q=' + encodeURIComponent(word.toLowerCase()))).body)
  ok('/api/search 按词搜', hit.items.some((x) => x.id === all.items[0].id), `「${word}」→ ${hit.total} 篇`)
  ok('/api/items', JSON.parse((await get('/api/items?ids=' + all.items[0].id)).body)[0]?.title === all.items[0].title)
  ok('页面和图标', (await get('/word.html')).status === 200 && (await get('/word-icon-32.png')).type === 'image/png')
  ok('别的文件不给', (await get('/index.html')).status === 404 && (await get('/assets/..%2F..%2Fmain%2Findex.js')).status === 404)
  ok('Host 不是本机的不认', (await get('/api/state', { headers: { Host: 'evil.example' } })).status === 403)
  ok('只收 GET', (await get('/api/state', { method: 'POST' })).status === 405)

  // 任务窗格（假 Office.js）
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 350, height: 720 }, deviceScaleFactor: 2 })
  await ctx.route('https://appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(`${ROOT}/scripts/e2e/office-stub.js`, 'utf8') }))
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(`${ORIGIN}/word.html?tab=cite&lang=zh`)
  await page.locator('.wp-row').first().waitFor({ timeout: 10000 })
  const ccs = () => page.evaluate(() => window.__ccs())
  const snap = async (name) => page.screenshot({ path: `${process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`}/${name}.png` })

  // 第一处：引第 1 篇
  await page.locator('.wp-row').nth(0).click()
  await snap('word-cite')
  await page.locator('.wp-act .btn.primary').click()
  await page.locator('.wp-foot', { hasText: '已插入' }).waitFor()
  let c = await ccs()
  ok('插入第一处引用', c.length === 1 && c[0].text === '[1]' && c[0].tag === 'prcite:' + all.items[0].id, JSON.stringify(c[0]))
  // 第二处：引第 2 篇和第 1 篇
  await page.locator('.wp-row').nth(1).click()
  await page.locator('.wp-row').nth(0).click()
  await page.locator('.wp-act .btn.primary').click()
  await page.locator('.wp-foot', { hasText: '已插入' }).waitFor()
  c = await ccs()
  ok('第二处引两篇，编号按先后', c.length === 2 && c[1].text === '[1,2]', c.map((x) => x.text).join(' '))

  // 参考文献表
  await page.locator('.seg-item', { hasText: '参考文献表' }).click()
  ok('预览列出两条', (await page.locator('.wp-bib').count()) === 2)
  await page.locator('.wp-act .btn.primary').click()
  await page.locator('.wp-foot', { hasText: '参考文献表已更新' }).waitFor()
  c = await ccs()
  const bib = c.find((x) => x.tag === 'prbib')
  ok('文档里有参考文献表，两条带编号', !!bib && bib.text.trim().split('\n').length === 2 && bib.text.startsWith('[1] '), bib?.text.slice(0, 90).replace(/\n/g, ' ⏎ '))
  await snap('word-bib')

  // 换成 APA：全文跟着变
  await page.locator('.wp-pick select').selectOption('apa')
  await page.locator('.wp-foot', { hasText: '全文已换成' }).waitFor()
  c = await ccs()
  ok('换成 APA 后文中引用变成著者年份', /^\(.+, \d{4}|n\.d\.\)/.test(c[0].text) && !c.find((x) => x.tag === 'prbib').text.startsWith('['), c[0].text + ' | ' + c[1].text)
  await page.locator('.wp-pick select').selectOption('gbt')
  await page.locator('.wp-foot', { hasText: '全文已换成' }).waitFor()

  // 格式检查：先应该只有文献缺项的提醒；手改一处编号、手打一个 [9] 后要查出来
  await page.locator('.seg-item', { hasText: '格式检查' }).click()
  const before = await page.locator('.wp-issue').allInnerTexts()
  ok('没改动时没有错误项', !(await page.locator('.wp-issue .bad').count()), `${before.length} 条提醒`)
  await page.evaluate(() => {
    const d = window.__doc
    d.nodes.find((n) => n.cc && n.tag.startsWith('prcite:')).text = '[5]'
    d.nodes.push({ text: ' 另见 [9]。' })
  })
  await page.locator('.wp-act .btn', { hasText: '重新检查' }).click()
  await page.locator('.wp-issue .bad').first().waitFor()
  const issues = await page.locator('.wp-issue').allInnerTexts()
  ok('查出手改的编号和手打的编号', issues.some((x) => x.includes('被手改过')) && issues.some((x) => x.includes('[9]')), issues.map((x) => x.slice(0, 34)).join(' | '))
  await snap('word-check')
  await page.locator('.wp-act .btn.primary', { hasText: '更新全文' }).click()
  await page.locator('.wp-foot', { hasText: '全文已更新' }).waitFor()
  ok('更新全文后编号改回来', (await ccs())[0].text === '[1]')
  ok('文献信息存在文档里', Object.keys(JSON.parse((await page.evaluate(() => window.__doc.settings))['pr.items'])).length === 2)
  ok('任务窗格没有报错', errs.length === 0, errs.slice(0, 2).join(' | '))

  // 不在 Word 里打开：提示
  const plain = await ctx.newPage()
  await plain.route('https://appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Office={onReady:(cb)=>cb({host:null})}' }))
  await plain.goto(`${ORIGIN}/word.html`)
  ok('不在 Word 里打开有提示', (await plain.locator('.wp-empty').innerText()).includes('Word'))

  // 设置里的分区
  const opened = app.waitForEvent('window', { timeout: 5000 }).catch(() => null)
  await win.evaluate(() => window.api.openSettings('word'))
  const sw = (await opened) ?? app.windows().find((w) => w !== win)
  await sw.waitForLoadState('domcontentloaded')
  await sleep(1200)
  const st = await win.evaluate(() => window.api.wordStatus())
  ok('设置里的状态', st.running && !st.installed, JSON.stringify(st))
  console.log(await shot(sw, 'word-settings'))
} finally {
  await browser.close()
  await close(app).catch((e) => console.log('退出:', e.message))
}
