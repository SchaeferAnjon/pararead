// 写论文（综述对比表）走一遍，真 AI（DeepSeek）：导入 4 篇（E2E_PAPER 加 arXiv 上 3 篇开放获取的）→ 文献库多选 → 「做对比表」→
// 每格有原句和页码、点格子看出处、打开原文那一处 → 「关系」「指标」→ 勾格子写一段、提纲、查证、换英文 →
// 复制成 LaTeX、导出 .bib、新加一篇后 .bib 自动更新 → 送进 Word（假 Office.js 的窗格开着时直接插；关着时排队、打开后点插入）→
// 侧栏再打开这个会话、导出 Markdown、深色截图。
//   npx electron-vite build
//   E2E_PAPER=<一篇论文的 PDF> DEEPSEEK_API_KEY=… node scripts/e2e/writing.mjs <新的数据目录（绝对路径）>
// 截图放 E2E_SHOTS（默认 tmp/shots）。验证不了的：真 Word 里的插入（这台电脑没装 Word）。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { close, launch, PAPER, ROOT, shot, sleep } from './drive.mjs'

const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? '/opt/homebrew/lib/node_modules/')
const { chromium } = require('playwright')
const ARXIV = ['https://arxiv.org/abs/2108.13378', 'https://arxiv.org/abs/2206.04218', 'https://arxiv.org/abs/2206.15165']
const LATE = 'https://arxiv.org/abs/2206.04200' // 新加的一篇：.bib 要自动跟上
const dir = process.argv[2]
if (!dir || !PAPER || !process.env.DEEPSEEK_API_KEY) throw new Error('用法：E2E_PAPER=… DEEPSEEK_API_KEY=… node scripts/e2e/writing.mjs <数据目录>')
const exportDir = join(dir, 'export')
const home = join(dir, 'home')
mkdirSync(exportDir, { recursive: true })
mkdirSync(home, { recursive: true })

const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info ? `：${info}` : ''), pass || fails.push(name))
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {})
// 临时 HOME：MinerU 找不到就用简单重排，不碰真实的文件夹
const { app, win } = await launch(dir, { PARAREAD_WORD_SERVE: '1', PARAREAD_EXPORT_DIR: exportDir, HOME: home })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const until = async (what, fn, secs = 300) => {
  for (let i = 0; i < secs; i++) {
    const v = await fn()
    if (v) return v
    await sleep(1000)
  }
  throw new Error(`等不到：${what}`)
}
const snap = async (name) => console.log('  截图', await shot(win, name))
const mx = () => ev((sid) => window.api.matrixGet(sid), sid)
let sid = null
let pane = null

try {
  await sleep(1500)
  await ev(() => window.api.setSettings({ onboarded: true, theme: 'light', wordStyle: 'gbt' }))
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setSize(1440, 900)
    w.setPosition(-1500, 40) // 挪到屏幕外，不挡人
  })

  // 1. 导入
  const ids = []
  const [r0] = await ev((p) => window.api.importPdfs([p]), PAPER)
  ids.push(r0.paper.id)
  for (const u of ARXIV) {
    const r = await ev((x) => window.api.importUrl(x), u)
    ok(`arXiv 导入 ${u.slice(-10)}`, r.status === 'added' || r.status === 'duplicate', r.status)
    if (r.paper) ids.push(r.paper.id)
  }
  await until('都重排好', async () => (await ev(() => window.api.listPapers())).every((p) => p.reflow.ready), 180)
  // 在一篇里打一个「有质疑」加批注：对比表最后一列要带出来
  const pages = await ev((id) => window.api.pageTexts(id), ids[1])
  const doubtText = pages[2].replace(/\s+/g, ' ').slice(200, 320).trim()
  await ev(
    (a) => window.api.annSave(a),
    { id: 'e2e-doubt', paperId: ids[1], mode: 'pdf', color: 'yellow', style: 'highlight', label: 'doubt', text: doubtText, note: '这个结论在更大位宽上还成立吗？', page: 3, rects: [[0.1, 0.3, 0.6, 0.02]], blockId: null, blockHash: null, start: null, end: null, section: '', createdAt: Date.now(), updatedAt: Date.now() }
  )

  // 2. 文献库多选 → 做对比表
  await win.locator('.icon-btn[title="多选"]').click()
  for (const id of ids) await win.click(`[data-paper="${id}"]`)
  const bar = win.locator('.batch')
  ok('批量栏有「做对比表」，是这一屏唯一的实心按钮', (await bar.locator('.btn.primary', { hasText: '做对比表' }).count()) === 1 && (await win.locator('.btn.primary:visible').count()) === 1, `${await win.locator('.btn.primary:visible').count()} 个实心按钮`)
  await snap('writing-01-library')
  await bar.locator('.btn.primary', { hasText: '做对比表' }).click()
  await win.locator('.mx-grid').waitFor({ timeout: 10000 })
  sid = await until('会话建好', () => ev(async () => (await window.api.researchList()).find((s) => s.kind === 'matrix')?.id), 10)
  ok('侧栏「学术 AI」里多了这个对比表', (await win.locator('.nav-item', { hasText: '对比表' }).count()) >= 1)
  await sleep(2500)
  await snap('writing-02-filling')

  // 3. 填格子
  const t0 = Date.now()
  let v = await until('每篇都填好', async () => {
    const x = await mx()
    return x.state.rows.every((r) => r.status === 'done' || r.status === 'failed') && x
  }, 600)
  console.log(`  填表用了 ${Math.round((Date.now() - t0) / 1000)} 秒`)
  const cells = v.state.rows.flatMap((r) => Object.values(r.cells))
  const found = cells.filter((c) => c.found && c.page)
  ok('每篇都填上了', v.state.rows.every((r) => r.status === 'done'), v.state.rows.map((r) => r.status + (r.error ? ' ' + r.error : '')).join(' | '))
  ok('每格都有一句话', cells.length === v.state.rows.length * 4 && cells.every((c) => c.text), `${cells.length} 格`)
  ok('大多数格子的原句在全文里一字不差地找到了，带页码', found.length >= cells.length * 0.6, `${found.length}/${cells.length}`)
  // 抽查：找到的原句真在那一页
  const chk = await ev(async (x) => { const pg = await window.api.pageTexts(x.pid); const sq = (s) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ''); return sq(pg[x.page - 1]).includes(sq(x.quote)) || sq(pg[x.page - 1] + pg[x.page]).includes(sq(x.quote).slice(0, 60)) }, { pid: v.state.rows[0].paperId, ...v.state.rows[0].cells[Object.keys(v.state.rows[0].cells).find((k) => v.state.rows[0].cells[k].found)] })
  ok('抽查一格：原句确实在标的那一页', chk)
  const named = await until('会话起了名', async () => { const n = await ev((s) => window.api.researchList().then((l) => l.find((x) => x.id === s).title), sid); return n !== '对比表' && n }, 60).catch(() => '')
  ok('会话起了主题名', !!named, named)
  await sleep(800)
  ok('「你的批注」列带出「有质疑」', (await win.locator('.mx-cell .lb-chip[data-label="doubt"]').count()) === 1)
  await snap('writing-03-table')

  // 4. 点一格看出处，再打开原文那一处
  const cell = win.locator('.mx-cell[data-cell]').filter({ has: win.locator('.pg:not(.warn)') }).first()
  const cid = await cell.getAttribute('data-cell')
  await cell.click()
  await win.locator('.mx-drawer .mx-q').waitFor()
  const meta = await win.locator('.mx-drawer .mx-q .meta').innerText()
  ok('出处抽屉：原句、译文、页码', /第 \d+ 页/.test(meta) && (await win.locator('.mx-drawer .mx-q .en').innerText()).length > 20, meta)
  ok('点开的那格左边一条竖线', (await win.locator(`.mx-cell.src[data-cell="${cid}"]`).count()) === 1)
  await snap('writing-04-source')
  await win.locator('.mx-drawer .btn', { hasText: '打开原文这一处' }).click()
  await win.locator('.mid-bar').waitFor({ timeout: 15000 })
  await sleep(2500)
  const where = await ev(() => ({ mode: document.querySelector('.mid-bar .seg-item.on')?.textContent, y: document.querySelector('.reflow-scroller')?.scrollTop ?? document.querySelector('.pdf-scroller, .pdf-scroll')?.scrollTop ?? -1 }))
  ok('打开了那篇论文并跳到那一处（不在开头）', where.y > 100, JSON.stringify(where))
  await snap('writing-05-open-source')
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await win.locator('.mx-grid').waitFor({ timeout: 10000 })
  ok('回来还在对比表', true)

  // 5. 关系
  await win.locator('.hdr .seg-item', { hasText: '关系' }).click()
  v = await until('关系分析完', async () => { const x = await mx(); return ['done', 'failed'].includes(x.state.relStatus) && x }, 300)
  ok('关系分析出来了', v.state.relStatus === 'done' && v.state.relations.length >= 1, `${v.state.relations?.length ?? 0} 条：${(v.state.relations ?? []).map((r) => r.kind + ' ' + r.label).join('、')} ${v.state.relError ?? ''}`)
  await sleep(600)
  if (v.state.relations?.length) {
    ok('每条关系的原句都是正文里真有的句子', v.state.relations.every((r) => r.a.quote.length > 20 && r.a.page))
    await win.locator('.mx-rel .edge').first().click()
    await win.locator('.mx-relp').waitFor()
    ok('点一条线，下面并排出两篇的原文', (await win.locator('.mx-relp .mx-q').count()) >= 1)
    await win.locator('.mx-relp .btn', { hasText: '勾进段落' }).click()
  }
  await snap('writing-06-relations')

  // 6. 指标
  await win.locator('.hdr .seg-item', { hasText: '指标' }).click()
  v = await until('指标排完', async () => { const x = await mx(); return ['done', 'failed'].includes(x.state.metStatus) && x }, 240)
  ok('指标排出来了', v.state.metStatus === 'done', `${v.state.metrics?.length ?? 0} 组：${(v.state.metrics ?? []).map((g) => `${g.name}（${g.rows.length} 篇，${g.rows.filter((r) => !r.ok).length} 篇条件不同）`).join('、')} ${v.state.metError ?? ''}`)
  await sleep(600)
  await snap('writing-07-metrics')

  // 7. 勾格子 → 写一段
  await win.locator('.hdr .seg-item', { hasText: '表格' }).click()
  await win.locator('.mx-grid').waitFor()
  const boxes = win.locator('.mx-cell[data-cell] .checkbox')
  const want = [0, 1, 4, 5, 9, 10, 13]
  for (const i of want) await boxes.nth(i).click()
  const selText = await win.locator('.mx-selbar').innerText()
  ok('选中栏写着勾了几格、来自几篇', /已选 \d+ 格 · 来自 \d+ 篇/.test(selText), selText.split('\n')[0])
  await snap('writing-08-selected')
  await win.locator('.mx-selbar .btn.primary').click()
  await win.locator('.mx-ol[data-part="outline"]').waitFor({ timeout: 120000 })
  const items = await win.locator('.mx-ol .it').count()
  ok('先出提纲', items >= 2, `${items} 条`)
  v = await mx()
  const inOutline = new Set(v.state.draft.outline.flatMap((x) => x.cells))
  ok('勾的每一格都进了提纲', v.state.selected.every((x) => inOutline.has(x)) && (await win.locator('.mx-subh .text-btn', { hasText: '勾选变了' }).count()) === 0, v.state.draft.outline.map((x) => `${x.h}（${x.cells.length} 格）`).join(' | '))
  const first = await win.locator('.mx-ol .it').first().innerText()
  await win.locator('.mx-ol .it').first().locator('button[title="下移"]').click()
  ok('提纲能挪', (await win.locator('.mx-ol .it').nth(1).innerText()).slice(1) === first.slice(1))
  await win.locator('.mx-drawer .btn.primary', { hasText: '写成段落' }).click()
  await win.locator('.mx-para').waitFor({ timeout: 180000 })
  v = await mx()
  const sents = v.state.draft.sentences
  const tablePapers = new Set(v.state.rows.map((r) => r.paperId))
  ok('写成一段，每句带出处，只引用表里这几篇', sents.length >= 3 && sents.every((s) => s.cites.every((c) => tablePapers.has(c))) && sents.filter((s) => s.src.length).length >= sents.length / 2, `${sents.length} 句，${sents.filter((s) => s.cites.length).length} 句带引用`)
  const withSrc = sents.findIndex((s) => s.src.some((x) => !x.startsWith('rel:')))
  // 一句可能折成几行：鼠标放到它第一行的中间
  const r1 = await win.locator(`.mx-para .s[data-i="${withSrc}"]`).evaluate((el) => { el.scrollIntoView({ block: 'center' }); const r = el.getClientRects()[0]; return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await win.mouse.move(r1.x, r1.y)
  await sleep(300)
  ok('鼠标停在一句上，表里亮出它的出处格子', (await win.locator('.mx-cell.lit').count()) >= 1)
  await win.locator('.mx-tools .btn', { hasText: '查证' }).click()
  await win.locator('.mx-checks').waitFor({ timeout: 120000 })
  v = await mx()
  const checks = v.state.draft.checks
  ok('查证逐句列出处，没出处的标黄', checks.length === sents.length && (await win.locator('.mx-checks > div').count()) === sents.length, `${checks.filter((c) => c.ok).length} 句有出处，${checks.filter((c) => !c.ok).length} 句标黄：${checks.filter((c) => !c.ok).map((c) => c.why).join(' | ')}`)
  await win.locator('.mx-drawer').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await snap('writing-09-paragraph')

  // 8. 复制成 LaTeX、导出 .bib
  await win.locator('.mx-out .btn', { hasText: '复制成 LaTeX' }).click()
  await win.locator('.mx-code').waitFor()
  const tex = await win.locator('.mx-code').innerText()
  ok('LaTeX 段落带 \\cite{key}', /~\\cite\{[a-z]+\d{4}[a-z]+/.test(tex), tex.slice(0, 140))
  await snap('writing-10-latex')
  await win.locator('.modal .btn', { hasText: '导出 .bib…' }).click()
  await win.locator('.modal .btn', { hasText: '在 Finder 中显示' }).waitFor()
  const bibFile = join(exportDir, 'ParaRead.bib')
  const bib1 = existsSync(bibFile) ? readFileSync(bibFile, 'utf8') : ''
  const keys = [...tex.matchAll(/\\cite\{([^}]+)\}/g)].flatMap((m) => m[1].split(','))
  ok('.bib 导出到选的文件夹，段落里引的 key 都在', keys.length > 0 && keys.every((k) => bib1.includes(`{${k},`)), `${(bib1.match(/^@/gm) ?? []).length} 条，key：${[...new Set(keys)].join(', ')}`)
  // 测试窗口在屏幕外、没有焦点，系统剪贴板不让写：记下页面交给剪贴板的文字
  await ev(() => { const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (x) => ((window.__copied = x), w(x).catch(() => {})) })
  await win.locator('.modal .btn.primary', { hasText: '复制' }).click()
  ok('复制：交给剪贴板的就是这段 LaTeX', (await ev(() => window.__copied)) === tex && (await win.locator('.modal .btn.primary').innerText()) === '已复制')
  await snap('writing-11-latex-bib')
  await win.keyboard.press('Escape')
  const late = await ev((x) => window.api.importUrl(x), LATE)
  await until('.bib 跟着更新', () => readFileSync(bibFile, 'utf8').includes('PartitionPIM'), 30).catch(() => null)
  ok('新加一篇论文，.bib 自动更新', readFileSync(bibFile, 'utf8').includes('PartitionPIM'), late.status)

  // 9. 送进 Word：窗格开着 → 直接插在光标处
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 350, height: 760 }, deviceScaleFactor: 2 })
  await ctx.route('https://appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(`${ROOT}/scripts/e2e/office-stub.js`, 'utf8') }))
  pane = await ctx.newPage()
  const paneErrs = []
  pane.on('pageerror', (e) => paneErrs.push(e.message))
  await pane.goto('https://localhost:27484/word.html?tab=cite&lang=zh')
  await pane.locator('.wp-row').first().waitFor({ timeout: 15000 })
  await sleep(2500)
  const citesWanted = (await mx()).state.draft.sentences.filter((s) => s.cites.length).length
  await win.locator('.mx-out .btn.primary', { hasText: '送进 Word' }).click()
  await sleep(400)
  const toastText = await win.locator('.toast').innerText().catch(() => '')
  ok('应用里说已送进 Word、插在光标处', toastText.includes('插在光标处'), toastText)
  await pane.locator('[data-part="got"]').waitFor({ timeout: 15000 })
  let ccs = await pane.evaluate(() => window.__ccs())
  const docText = await pane.evaluate(() => window.__docText())
  ok('Word 里插进一段，每处引用是插件管的引用，按先后编号', ccs.filter((c) => c.tag.startsWith('prcite:')).length >= citesWanted && ccs.every((c) => /^\[[\d,-]+\]$/.test(c.text)), `${ccs.length} 处：${ccs.map((c) => c.text).join(' ')}`)
  ok('段落文字进了文档', docText.length > 80, docText.slice(0, 80))
  await pane.locator('.seg-item', { hasText: '参考文献表' }).click()
  await pane.locator('.wp-act .btn.primary').click()
  await pane.locator('.wp-foot', { hasText: '参考文献表已更新' }).waitFor()
  ccs = await pane.evaluate(() => window.__ccs())
  const bibCc = ccs.find((c) => c.tag === 'prbib')
  const citedN = new Set(ccs.filter((c) => c.tag.startsWith('prcite:')).flatMap((c) => c.tag.slice(7).split(','))).size
  ok('参考文献表跟着出来，条数等于引到的篇数', !!bibCc && bibCc.text.trim().split('\n').length === citedN, `${citedN} 篇`)
  await pane.screenshot({ path: join(process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`, 'writing-12-word-pane.png') })
  ok('Word 窗格没有报错', paneErrs.length === 0, paneErrs.join(' | '))
  // 窗格关着 → 排队，打开窗格后点「插入」
  await pane.close()
  await sleep(6500)
  await win.locator('.mx-out .btn.primary', { hasText: '送进 Word' }).click()
  await sleep(400)
  ok('窗格关着时说排在 Word 窗格里', (await win.locator('.toast').innerText().catch(() => '')).includes('点「插入」'))
  const pane2 = await ctx.newPage()
  await pane2.goto('https://localhost:27484/word.html?tab=cite&lang=zh')
  await pane2.locator('[data-part="inbox"]').waitFor({ timeout: 15000 })
  ok('打开窗格看到「从 ParaRead 收到 1 段」', (await pane2.locator('[data-part="inbox"]').innerText()).includes('收到 1 段'))
  await pane2.screenshot({ path: join(process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`, 'writing-13-word-inbox.png') })
  await pane2.locator('[data-part="inbox"] .btn', { hasText: '插入' }).click()
  await pane2.locator('[data-part="got"]').waitFor({ timeout: 15000 })
  ok('点「插入」插进去了', (await pane2.evaluate(() => window.__ccs())).some((c) => c.tag.startsWith('prcite:')))
  await pane2.close()

  // 10. 换成 English 再写一遍
  await win.locator('.mx-drawer .seg-item', { hasText: 'English' }).click()
  await win.locator('.mx-drawer .btn.primary', { hasText: '写成段落' }).click()
  await win.locator('.mx-para[lang="en"]').waitFor({ timeout: 180000 })
  const en = await win.locator('.mx-para').innerText()
  ok('英文段落', /^[\x00-\x7F\s\S]*[A-Za-z]{4,}/.test(en) && !/[一-鿿]{4,}/.test(en), en.slice(0, 100))

  // 11. 侧栏再打开、导出 Markdown
  await win.locator('.nav-item', { hasText: '全部论文' }).click()
  await sleep(500)
  await win.locator('.nav-item', { hasText: '对比表' }).first().click()
  await win.locator('.mx-grid').waitFor()
  await win.locator('.mx-selbar .btn.primary').click()
  ok('侧栏再打开，表和写好的段落都在', (await win.locator('.mx-para').count()) === 1)
  await win.locator('.mx-drawer .icon-btn[title="关闭"]').click()
  await win.locator('.hdr .btn', { hasText: '导出' }).click()
  await sleep(800)
  const md = readdirSync(exportDir).find((f) => f.endsWith('.md'))
  ok('导出 Markdown', !!md && readFileSync(join(exportDir, md), 'utf8').includes('| ---'), md)

  // 12. 深色
  // playwright 默认把页面的 prefers-color-scheme 固定成浅色：设置改成深色以外，页面也要跟着换
  await ev(() => window.api.setSettings({ theme: 'dark' }))
  await win.emulateMedia({ colorScheme: 'dark' })
  await sleep(800)
  await snap('writing-14-dark-table')
  await win.locator('.hdr .seg-item', { hasText: '关系' }).click()
  await sleep(800)
  await snap('writing-15-dark-relations')
  await win.locator('.hdr .seg-item', { hasText: '表格' }).click()
  await win.locator('.mx-selbar .btn.primary').click()
  await sleep(600)
  await snap('writing-16-dark-write')
  await ev(() => window.api.setSettings({ theme: 'light' }))
  await win.emulateMedia({ colorScheme: 'light' })
  // 13 寸屏幕的窗口：表横着滚，抽屉不挤
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760))
  await sleep(800)
  const narrow = await ev(() => ({ drawer: document.querySelector('.mx-drawer')?.getBoundingClientRect().width, pane: document.querySelector('.mx-pane').getBoundingClientRect().width }))
  ok('窄窗口里抽屉还是 420 宽，表在左边能横着滚', narrow.drawer === 420 && narrow.pane > 300, JSON.stringify(narrow))
  await snap('writing-17-narrow')
} catch (e) {
  fails.push(String(e.message))
  console.log('出错：', e.message)
  await shot(win, 'writing-error').catch(() => {})
} finally {
  await browser.close()
  await close(app).catch((e) => console.log('退出:', e.message))
  rmSync(home, { recursive: true, force: true })
}
console.log(fails.length ? `\n没过 ${fails.length} 项：\n- ${fails.join('\n- ')}` : '\n全部通过')
process.exitCode = fails.length ? 1 : 0

