// 保版面双语对照（对照 / 译文看法，2026-11-23，设计页 51）真走一遍，真装 BabelDOC、真翻（DeepSeek，额度小：课件 10 页、论文 3 页）：
// 1. 看法五格，PDF 打开默认「对照」，左栏收起；组件没装先出「先装」卡：点下载、暂停、接着装，装好（第一次约 1 分钟加下载）；
// 2. 「打开就翻」关着：出「翻成对照」卡，点了先翻在看的第 3 页前后，翻到的页换上、没翻到的是变灰的原页加小卡；暂停、跳到第 9 页、继续；
// 3. 截图：对照第 3、9 页（对照沉浸式翻译那两张），上下排、只看译文、窄窗口自动上下、深色；
// 4. 在译页上框选：小条默认「截：译文」，原页同一处虚线框；换「两边都带」问 AI（真发一次），写进配对笔记：页码链接指原 PDF、图注「我框的 · 译文」；
// 5. 在译页上划线：存成译页的标注，原页左边距一道同色竖线；关了再开，翻好的页直接出（缓存），不再起 BabelDOC；
// 6. 论文（竖版双栏）第 1 到 3 页对照；设置 › 翻译 的四行。
// DEEPSEEK_API_KEY=… E2E_PAPER=<Lecture05.pdf> E2E_PAPER2=<BST-GATNet.pdf> BABELDOC_DIR=<组件放哪，装过的能重用> node scripts/e2e/layout-tr.mjs <新的数据目录>
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { close, launch, PAPER, ROOT, shot, SHOTS, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-layout-tr`
const PAPER2 = process.env.E2E_PAPER2 ?? ''
const BABEL = process.env.BABELDOC_DIR ?? `${ROOT}/tmp/babeldoc`
const env = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, PARAREAD_BABELDOC_DIR: BABEL, PARAREAD_TR_RETRY_MS: '500' }
let { app, win } = await launch(dir, env)
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
let passed = 0
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass ? passed++ : fails.push(name))
const t0 = Date.now()
const secs = () => Math.round((Date.now() - t0) / 1000)
const midShot = async (name) => {
  const box = await ev(() => { const r = document.querySelector('.col-mid').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  const f = `${SHOTS}/${name}.png`
  await win.screenshot({ path: f, clip: box })
  console.log(f)
  return f
}
const st = (id) => ev((id) => window.api.layoutTrState(id, 0), id)
const trReady = (n) => ev((n) => { const p = document.querySelector(`.page[data-page="${n}"][data-side="tr"]`); return !!p && !p.classList.contains('pending') && !!p.querySelector('canvas')?.width && (p.querySelector('.textLayer')?.textContent ?? '').length > 5 }, n)
const goPage = async (n) => {
  await ev(() => document.querySelector('.pdf-scroller')?.dispatchEvent(new Event('scroll')))
  await win.locator('.page-chip button').click()
  await win.locator('.page-chip input').fill(String(n))
  await win.keyboard.press('Enter')
  await sleep(1200)
}
const pause = async () => {
  await win.locator('[data-testid="tr-progress"]').click()
  await win.locator('.pop.menu .menu-item', { hasText: '暂停' }).click()
  await sleep(500)
}
const drag = async (r) => {
  await win.mouse.move(r.x, r.y)
  await win.mouse.down()
  await win.mouse.move(r.x + r.w, r.y + r.h, { steps: 8 })
  await win.mouse.up()
}

try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', trOnOpen: false, openView: 'dual', dualLayout: 'side', trService: '', rightCollapsed: false, leftCollapsed: false }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  // 上次读到第 3 页（打开就停在那，先翻它前后）
  await ev((id) => window.api.updatePaper(id, { lastPosition: { page: 3, pageFrac: 0 } }), id)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)

  // ---- 1. 五格、默认对照、左栏收起、先装组件 ----
  const labels = (await win.locator('.mid-bar .mode-seg .seg-item').allInnerTexts()).map((x) => x.trim()).join('|')
  ok('看法五格：原文 / 对照 / 译文 / 重排 / 速览', labels === '原文|对照|译文|重排|速览', labels)
  ok('PDF 打开默认「对照」', (await win.locator('.mid-bar .mode-seg .seg-item.on').innerText()).trim() === '对照')
  ok('对照时左栏自动收起', (await win.locator('.col-left').count()) === 0)
  ok('对照里一行两页：左原页、右译页（还没翻的是变灰的原页）', (await win.locator('.page[data-page="3"][data-side="src"]').count()) === 1 && (await win.locator('.page[data-page="3"][data-side="tr"].pending').count()) === 1)
  const installed = (await ev(() => window.api.layoutTrInstallState())).phase === 'done'
  if (!installed) {
    ok('组件没装：出「先装保版面翻译组件」', (await win.locator('[data-testid="tr-install"]').count()) === 1)
    await midShot('lt-01-install')
    const ti = Date.now()
    await win.locator('[data-testid="tr-install"] button', { hasText: '下载组件' }).click()
    for (let i = 0; i < 120 && (await ev(() => window.api.layoutTrInstallState())).percent < 8; i++) await sleep(1000)
    await sleep(3000)
    await midShot('lt-02-installing')
    const mid = await ev(() => window.api.layoutTrInstallState())
    ok('装的时候有进度和 MB', mid.percent > 0 && (await win.locator('[data-testid="tr-install"] .tb-bar').count()) === 1, JSON.stringify(mid))
    await win.locator('[data-testid="tr-install"] button', { hasText: '暂停' }).click()
    for (let i = 0; i < 30 && (await ev(() => window.api.layoutTrInstallState())).phase !== 'none'; i++) await sleep(500)
    ok('能暂停：停下来，按钮换成「接着装」', (await ev(() => window.api.layoutTrInstallState())).phase === 'none' && (await win.locator('[data-testid="tr-install"] button', { hasText: '接着装' }).count()) === 1)
    await win.locator('[data-testid="tr-install"] button', { hasText: '接着装' }).click()
    let s
    for (let i = 0; i < 1500; i++) {
      s = await ev(() => window.api.layoutTrInstallState())
      if (s.phase === 'done' || s.phase === 'failed') break
      if (i % 30 === 0) console.log('  装到', s.phase, s.percent + '%', s.mb + ' MB', s.line.slice(0, 80))
      await sleep(1000)
    }
    ok('接着装，装好了', s.phase === 'done', `${Math.round((Date.now() - ti) / 1000)} 秒 ${s.error ?? ''}`)
    await sleep(800)
  }
  ok('装好后组件卡收起', (await win.locator('[data-testid="tr-install"]').count()) === 0)

  // ---- 2. 翻成对照 ----
  ok('「打开就翻」关着：出「翻成对照」卡（页数、时间、花费）', (await win.locator('[data-testid="tr-first"]').count()) === 1, await win.locator('[data-testid="tr-first"] .tb-meta').innerText().catch(() => ''))
  await midShot('lt-03-first')
  const tt = Date.now()
  await win.locator('[data-testid="tr-first"] button', { hasText: '翻成对照' }).click()
  await sleep(1500)
  ok('点了开始翻：卡收起，标题栏「翻译中 0 / 43 页」', (await win.locator('[data-testid="tr-first"]').count()) === 0 && /翻译中 0 \/ 43 页/.test(await win.locator('[data-testid="tr-progress"]').innerText()))
  const s1 = await st(id)
  ok('先翻在看的第 3 页和前后：1 到 5 页', JSON.stringify(s1.busy) === '[1,2,3,4,5]', JSON.stringify(s1.busy))
  ok('正在翻的页上写「正在翻第 3 页」', /正在翻第 3 页/.test(await win.locator('.page[data-page="3"][data-side="tr"] .tr-pend-card').innerText()))
  await midShot('lt-04-translating')
  for (let i = 0; i < 300 && !(await trReady(3)); i++) await sleep(1000)
  const firstSecs = Math.round((Date.now() - tt) / 1000)
  ok('第 3 页的译页换上了（有字的文字层）', await trReady(3), `${firstSecs} 秒`)
  await pause()
  const s2 = await st(id)
  ok('暂停：停在 5 页、不再往后翻', s2.paused && Object.keys(s2.pages).length === 5 && !s2.busy.length, JSON.stringify({ paused: s2.paused, n: Object.keys(s2.pages).length, busy: s2.busy }))
  const zh3 = await ev(() => document.querySelector('.page[data-page="3"][data-side="tr"] .textLayer').textContent)
  ok('第 3 页译页是中文，计算栈的格子也翻了', /问题|算法|计算/.test(zh3), zh3.slice(0, 80))
  await goPage(3)
  await midShot('lt-05-dual-p3')

  // 跳到第 9 页，继续：先翻第 9 页前后
  await goPage(9)
  ok('没翻到的页上写「还没翻」和「继续翻译」', /第 9 页还没翻/.test(await win.locator('.page[data-page="9"][data-side="tr"] .tr-pend-card').innerText()))
  await win.locator('.page[data-page="9"][data-side="tr"] .tr-pend-card .text-btn').click()
  await sleep(1500)
  ok('跳到第 9 页再继续：先翻 7 到 11 页', JSON.stringify((await st(id)).busy) === '[7,8,9,10,11]', JSON.stringify((await st(id)).busy))
  for (let i = 0; i < 300 && !(await trReady(9)); i++) await sleep(1000)
  ok('第 9 页的译页换上了', await trReady(9))
  await pause()
  ok('标题栏「已暂停 10 / 43 页」', /已暂停 10 \/ 43 页/.test(await win.locator('[data-testid="tr-progress"]').innerText()))
  await goPage(9)
  await sleep(800)
  await midShot('lt-06-dual-p9')
  const zh9 = await ev(() => document.querySelector('.page[data-page="9"][data-side="tr"] .textLayer').textContent)
  ok('第 9 页译页：要点和红字都换成中文', /维|向量|不同/.test(zh9), zh9.slice(0, 80))
  // 版面不动：两页一样大，同一行
  const geo = await ev(() => { const a = document.querySelector('.page[data-page="9"][data-side="src"]').getBoundingClientRect(); const b = document.querySelector('.page[data-page="9"][data-side="tr"]').getBoundingClientRect(); return { aw: a.width, bw: b.width, ah: a.height, bh: b.height, dy: Math.abs(a.top - b.top) } })
  ok('原页和译页一样大、在同一行', Math.abs(geo.aw - geo.bw) < 1 && Math.abs(geo.ah - geo.bh) < 1 && geo.dy < 1, JSON.stringify(geo))

  // ---- 3. 别的排法 ----
  await win.locator('.mid-bar .lay-seg .seg-item').nth(1).click()
  await sleep(1200)
  await goPage(9)
  ok('上下排：原页在上、译页在下', await ev(() => { const a = document.querySelector('.page[data-page="9"][data-side="src"]').getBoundingClientRect(); const b = document.querySelector('.page[data-page="9"][data-side="tr"]').getBoundingClientRect(); return b.top > a.bottom && Math.abs(a.left - b.left) < 1 }))
  await midShot('lt-07-stack')
  await win.locator('.mid-bar .lay-seg .seg-item').nth(0).click()
  await sleep(500)
  await win.locator('.mid-bar .mode-seg .seg-item', { hasText: '译文' }).click()
  await sleep(1500)
  await goPage(9)
  ok('「译文」只放译页', (await win.locator('.page[data-side="src"]').count()) === 0 && (await win.locator('.page[data-page="9"][data-side="tr"]').count()) === 1)
  await midShot('lt-08-mono')
  await win.locator('.mid-bar .mode-seg .seg-item', { hasText: '对照' }).click()
  await sleep(800)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900))
  await sleep(1200)
  await goPage(9)
  ok('窗口窄（一页不到 480）：对照自动上下排，设置里还是左右', (await win.locator('.tr-row.lay-stack').count()) > 0 && (await ev(() => window.api.getSettings())).dualLayout === 'side')
  await midShot('lt-09-narrow')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
  await win.emulateMedia({ colorScheme: 'dark' })
  await sleep(1200)
  ok('深色：页面进了深色', (await ev(() => document.documentElement.dataset.theme)) === 'dark')
  await goPage(9)
  await midShot('lt-10-dark')
  await win.emulateMedia({ colorScheme: 'light' })
  await sleep(800)

  // ---- 4. 在译页上框选、两边都带、问 AI、写进配对笔记 ----
  await goPage(9)
  const trBox = await ev(() => { const q = document.querySelector('.page[data-page="9"][data-side="tr"]').getBoundingClientRect(); return { x: q.x + q.width * 0.12, y: q.y + q.height * 0.27, w: q.width * 0.62, h: q.height * 0.13 } })
  await win.keyboard.down('Alt')
  await drag(trBox)
  await win.keyboard.up('Alt')
  await win.waitForSelector('.sel-toolbar', { timeout: 10000 })
  ok('框完出小条，默认「截：译文」', /截：\s*译文/.test(await win.locator('[data-testid="shot-side"]').innerText()))
  ok('原页同一处出虚线框', (await win.locator('.page[data-page="9"][data-side="src"] .box-rect.mirror').count()) === 1)
  await midShot('lt-11-box')
  await win.locator('[data-testid="shot-side"]').click()
  await win.locator('.pop.menu .menu-item', { hasText: '两边都带' }).click()
  await sleep(600)
  ok('换成「两边都带」', /两边都带/.test(await win.locator('[data-testid="shot-side"]').innerText()))
  await win.locator('.sel-toolbar button', { hasText: '问 AI' }).click()
  await sleep(800)
  const att = await ev(() => { const i = document.querySelector('.attach-img, .chipm.lead img'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null })
  ok('两边拼成一张图放进 AI 输入框，不自动发', !!att && att.h > att.w * 0.2 && (await ev(() => document.querySelectorAll('.msg.user, .chat-user, .um').length)) === 0, JSON.stringify(att))
  await win.locator('.col-right textarea').fill('这两句在说什么？一句话回答。')
  await win.keyboard.press('Enter')
  for (let i = 0; i < 90 && !(await ev((id) => window.api.chatList(id), id)).some((m) => m.role === 'assistant' && m.content); i++) await sleep(1000)
  const chats = await ev((id) => window.api.chatList(id), id)
  const u = chats.find((m) => m.box)
  ok('问的那条记着页、框、两边的截图', !!u && u.box.page === 9 && u.box.side === 'both' && !!u.box.src && !!u.box.tr, JSON.stringify(u?.box && { ...u.box, src: !!u.box.src, tr: !!u.box.tr }))
  ok('AI 回答了', chats.some((m) => m.role === 'assistant' && m.content.length > 4))
  const vault = join(dir, 'vault')
  mkdirSync(join(vault, '课程', 'ecp'), { recursive: true })
  const w = await ev(([id, v]) => window.api.writePairedNote(id, v, '课程/ecp/Lecture05.pdf'), [id, vault])
  const md = readFileSync(join(vault, w.note), 'utf8')
  ok('写进配对笔记：页码链接指原 PDF 第 9 页那块', /\[第 9 页\]\(Lecture05\.pdf#page=9&rect=/.test(md), w.note)
  ok('原文那张在前、「我框的 · 译文」在后，两张图都写进附件', md.indexOf('![我框的](') > 0 && md.indexOf('![我框的 · 译文](') > md.indexOf('![我框的](') && readdirSync(join(vault, '附件', 'Lecture05')).filter((f) => f.endsWith('.png')).length === 2, readdirSync(join(vault, '附件', 'Lecture05')).join(','))
  console.log(md.split('\n').filter((l) => /第 9 页|我框的/.test(l)).join('\n'))

  // ---- 5. 在译页上划线 ----
  await win.keyboard.press('Escape')
  const line = await ev(() => { const sp = [...document.querySelectorAll('.page[data-page="9"][data-side="tr"] .textLayer span')].find((s) => /[一-鿿]{4,}/.test(s.textContent)); const q = sp.getBoundingClientRect(); return { x: q.x + 2, y: q.y + q.height / 2, w: Math.min(q.width - 4, 160) } })
  await win.mouse.move(line.x, line.y)
  await win.mouse.down()
  await win.mouse.move(line.x + line.w, line.y, { steps: 6 })
  await win.mouse.up()
  await win.waitForSelector('.sel-toolbar', { timeout: 5000 })
  await win.locator('.sel-toolbar .dot-btn').first().click()
  await sleep(800)
  const anns = await ev((id) => window.api.annList(id), id)
  const a = anns.find((x) => x.side === 'tr')
  ok('划在译页上：存成译页的标注，页码是原 PDF 的第 9 页', !!a && a.page === 9 && a.mode === 'pdf', JSON.stringify(a && { page: a.page, side: a.side, text: a.text }))
  ok('译页画底色，原页左边距一道同色竖线', (await win.locator('.page[data-page="9"][data-side="tr"] .pdf-hl').count()) > 0 && (await win.locator('.page[data-page="9"][data-side="src"] .pdf-across').count()) === 1)
  await midShot('lt-12-highlight')

  // ---- 关了再开：缓存直接出 ----
  await close(app)
  ;({ app, win } = await launch(dir, env))
  await sleep(1500)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)
  await goPage(9)
  for (let i = 0; i < 20 && !(await trReady(9)); i++) await sleep(500)
  const s3 = await st(id)
  ok('再开：还是对照，翻好的 10 页直接出，不再起 BabelDOC', (await win.locator('.mid-bar .mode-seg .seg-item.on').innerText()).trim() === '对照' && (await trReady(9)) && Object.keys(s3.pages).length === 10 && !s3.busy.length)

  // ---- 6. 论文（竖版） ----
  if (PAPER2) {
    await win.locator('.mid-bar button[title^="回文献库"]').click()
    await sleep(1000)
    await ev(() => window.api.setSettings({ trOnOpen: true }))
    const [r2] = await ev((p) => window.api.importPdfs([p]), PAPER2)
    const id2 = r2.paper.id
    await win.dblclick(`[data-paper="${id2}"]`)
    await sleep(2000)
    ok('「打开就翻」开着：论文打开直接翻第 1 到 3 页，不出卡', (await win.locator('[data-testid="tr-first"]').count()) === 0 && JSON.stringify((await st(id2)).busy) === '[1,2,3]', JSON.stringify((await st(id2)).busy))
    for (let i = 0; i < 300 && !(await trReady(2)); i++) await sleep(1000)
    ok('论文第 2 页的译页换上了', await trReady(2))
    await pause()
    await goPage(2)
    await midShot('lt-13-paper-p2')

    // ---- 7. 没翻成（0.2.1；2026-11-25 起先自动重试）：翻译服务装成回原文 / 空译文，页上出「第 N 页没翻成」、不进缓存；点重新翻译能翻成 ----
    const fake = (v) => app.evaluate((_e, v) => (globalThis.paraReadTrFake = v), v)
    const idxPages = () => { const d = readdirSync(join(dir, 'layout-tr', id2))[0]; return Object.keys(JSON.parse(readFileSync(join(dir, 'layout-tr', id2, d, 'index.json'), 'utf8')).pages).map(Number) }
    // 等第 n 页有了结果（翻好、试够了标没翻成、或整篇停下）；自动重试的间隙 busy 是空的，不能只看 busy。有结果马上暂停（不让它接着翻后面的页）
    const waitPage = async (n) => {
      for (let i = 0; i < 600; i++) {
        const s = await st(id2)
        if (!s.busy.length && !s.retrying?.pages.includes(n) && (s.pages[n] || s.failed[n] || s.error)) break
        await sleep(500)
      }
      await ev((x) => window.api.layoutTrPause(x), id2)
    }
    const failedCard = (n) => win.locator(`.page[data-page="${n}"][data-side="tr"] [data-testid="tr-failed"]`)
    // 带第 2 页的 BabelDOC 跑了几次（回原文时同一批里别的页也一样没翻成，会一起重试：「第 2,4 页」）
    const has2 = (arg) => arg.split(',').some((r) => { const [a, b] = r.split('-').map(Number); return a <= 2 && 2 <= (b ?? a) })
    const runs = () => readFileSync(join(dir, 'main.log'), 'utf8').split('\n').filter((l) => { const m = new RegExp(`保版面翻译：${id2} 第 (\\S+) 页$`).exec(l); return !!m && has2(m[1]) }).length
    await fake('echo')
    const runs0 = runs()
    await win.locator('[data-testid="tr-progress"]').click()
    await win.locator('.pop.menu .menu-item', { hasText: '重新翻译这页（第 2 页）' }).click()
    // 第一次回原文后在重试：顶栏说哪页、为什么、正在重试
    let sawRetry = ''
    for (let i = 0; i < 300 && !sawRetry; i++) {
      const s = await st(id2)
      if (s.retrying?.pages.includes(2)) sawRetry = (await win.locator('[data-testid="tr-progress"]').getAttribute('title')) ?? ''
      else await sleep(300)
    }
    // 正文列不到 1200（这里开着 AI 栏）按钮写「2 页重试中 · 3 / 7 页」，哪页、为什么、第几次在悬停提示（菜单头一行同一句）
    ok('回原文后自动重试：顶栏「N 页重试中」，悬停提示说哪页、为什么、排着第几次', /页重试中 · /.test(sawRetry) && /第 (\d+[、–])*2([、–]\d+)* 页没翻成（译文和原文一样），排着第 2 \/ 3 次重试/.test(sawRetry), sawRetry)
    ok('页上等重试的小卡：黄点、第几次、上次为什么', /第2页排着重试（第2\/3次）上次：译文和原文一样/.test(((await win.locator('.page[data-page="2"][data-side="tr"] [data-testid="tr-retrying"]').innerText().catch(() => '')) || '').replace(/\s+/g, '')) || (await st(id2)).busy.includes(2))
    await midShot('lt-14-retrying')
    await waitPage(2)
    await win.keyboard.press('Escape')
    let s7 = await st(id2)
    ok('回原文：自动试 3 次还是原文，第 2 页才算没翻成，不当译文显示', !!s7.failed[2] && !s7.pages[2] && (await failedCard(2).count()) === 1 && runs() - runs0 === 3, JSON.stringify(s7.failed) + ` 跑了 ${runs() - runs0} 次`)
    ok('没翻成的页不进缓存（index.json 里没有第 2 页）', !idxPages().includes(2), JSON.stringify(idxPages()))
    ok('页上写「第 2 页没翻成 译文和原文一样」和「重试」', /第 2 页没翻成/.test(await failedCard(2).innerText()) && /译文和原文一样/.test(await failedCard(2).innerText()) && /重试/.test(await failedCard(2).innerText()))
    await goPage(2)
    await midShot('lt-15-failed')
    await win.locator('[data-testid="tr-progress"]').click()
    await sleep(300)
    const note7 = await win.locator('.pop.menu').innerText()
    ok('菜单头一行说哪页、为什么', /第 (\d+[、–])*2([、–]\d+)* 页自动重试了 3 次还没翻成：译文和原文一样/.test(note7), note7.split('\n')[0])
    await midShot('lt-15b-failed-menu')
    await win.keyboard.press('Escape')
    // 翻译服务一直回空译文：每个请求重试过还是空，连着 3 批一个请求都没成，整篇停下说原因（不再一页一页白跑）
    await fake('empty')
    await failedCard(2).locator('button').click()
    await waitPage(2)
    await win.keyboard.press('Escape')
    s7 = await st(id2)
    ok('空译文：整篇停下，说「翻译服务回了空译文」，第 2 页没有当译文显示', /翻译服务回了空译文/.test(s7.error ?? '') && !s7.pages[2], s7.error ?? '')
    await midShot('lt-15c-stopped')
    await fake(undefined)
    await win.locator('.page[data-page="2"][data-side="tr"] .tr-pend-card button').click()
    for (let i = 0; i < 240 && !(await trReady(2)); i++) await sleep(1000)
    await ev((x) => window.api.layoutTrPause(x), id2)
    await win.keyboard.press('Escape')
    s7 = await st(id2)
    const zh2 = await ev(() => document.querySelector('.page[data-page="2"][data-side="tr"] .textLayer')?.textContent ?? '')
    ok('恢复后点「重试」：第 2 页翻成中文、进缓存', !!s7.pages[2] && !s7.failed[2] && /[一-鿿]{20}/.test(zh2) && idxPages().includes(2), zh2.slice(0, 40))
    // 全翻完以后标题栏的翻译按钮还在，菜单里能重新翻译这页和全篇（全篇先确认）
    await win.locator('[data-testid="tr-progress"]').click()
    const items = (await win.locator('.pop.menu .menu-item').allInnerTexts()).join('|')
    ok('翻译菜单里有「重新翻译这页」「重新翻译全篇…」', /重新翻译这页/.test(items) && /重新翻译全篇/.test(items), items)
    await win.locator('.pop.menu .menu-item', { hasText: '重新翻译全篇' }).click()
    await sleep(400)
    ok('重新翻译全篇先确认一句（页数、花费）', /全篇 7 页重新翻译/.test(await win.locator('.pop.menu').innerText()))
    await midShot('lt-16-redo-all-confirm')
    await win.locator('.pop.menu .menu-item', { hasText: '取消' }).click()
  }

  // 设置 › 翻译
  await ev(() => window.api.openSettings('translate'))
  await sleep(1500)
  const sw = app.windows().find((p) => p.url().includes('settings'))
  if (sw) {
    await sw.waitForLoadState('domcontentloaded')
    await sleep(800)
    const f = `${SHOTS}/lt-14-settings.png`
    await sw.screenshot({ path: f })
    console.log(f)
    ok('设置 › 翻译：打开 PDF 时、什么时候翻、翻译用、保版面组件', (await sw.locator('.frow .fl').allInnerTexts()).join('|').includes('打开 PDF 时|什么时候翻|翻译用|保版面组件'))
    // 删除组件要再点一次才删（这里只点一次，看按钮换字，不真删测试用的组件）
    await sw.locator('button', { hasText: '删除组件' }).click()
    ok('组件那一行能在访达里看、删除要再点一次', (await sw.locator('button', { hasText: '在 Finder 中显示' }).count()) === 1 && (await sw.locator('button', { hasText: '再点一次删除' }).count()) === 1)
    await sw.keyboard.press('Tab')
    // 翻译用本机 Claude Code（2026-11-25）：选了才出模型和档位，选 Opus · 高，标题栏菜单「换翻译服务…」后面写着
    await sw.locator('.radio-row', { hasText: '本机 Claude Code' }).click()
    await sleep(600)
    ok('选本机 Claude Code 后单选下面出「模型」「思考强度」两行', (await sw.locator('[data-testid="tr-cc"] .tr-cc-l').allInnerTexts()).join('|') === '模型|思考强度')
    await sw.locator('[data-testid="tr-cc"] button', { hasText: 'Opus' }).click()
    await sw.locator('[data-testid="tr-cc"] button', { hasText: '高' }).click()
    await sleep(600)
    const set2 = await ev(() => window.api.getSettings())
    ok('存下 trCcModel: opus、trCcEffort: high，翻译用的名字带上模型和档位', set2.trCcModel === 'opus' && set2.trCcEffort === 'high' && /Claude Code · Opus · 高/.test(set2.trServiceName), `${set2.trCcModel} ${set2.trCcEffort} ${set2.trServiceName}`)
    const f2 = `${SHOTS}/lt-17-settings-cc.png`
    await sw.screenshot({ path: f2 })
    console.log(f2)
    await ev(() => window.api.setSettings({ trService: '', trCcModel: 'haiku', trCcEffort: 'low' }))
  } else ok('设置窗口打开了', false)
} catch (e) {
  console.error(e)
  fails.push(String(e?.message ?? e).slice(0, 200))
  await shot(win, 'lt-error').catch(() => {})
} finally {
  await close(app).catch((e) => fails.push(e.message))
}
console.log(`\n${passed} 项通过，${fails.length} 项没过，用时 ${secs()} 秒`)
if (fails.length) {
  console.log(fails.join('\n'))
  process.exit(1)
}
