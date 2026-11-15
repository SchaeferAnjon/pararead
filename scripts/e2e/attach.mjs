// 「仅链接」论文补 PDF：
// 1. 选中一条仅链接的：右边面板说清没有 PDF，给「去出版社页面下载」（链到它的页面）和「补上 PDF」；双击不打开空的阅读页。
// 2. 点「补上 PDF」选文件（系统的选文件框用假的代替，直接回这篇 PDF）：变成正常论文，排队重排，能打开读。
// 3. 浏览器插件在出版社页面抓同一篇（按 DOI 认）：PDF 补进已有的那一条，不多出一条，插件那边显示「补进了已有的那一条」。
// E2E_PAPER=<一篇 PDF> E2E_PAPER2=<另一篇 PDF> node scripts/e2e/attach.mjs <新的数据目录>
import { readFileSync } from 'node:fs'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const PAPER2 = process.env.E2E_PAPER2
if (!PAPER2) throw new Error('要 E2E_PAPER2：第二篇 PDF')
// 接收口换一个测试专用的端口：27485 是正在用的那个 ParaRead 的，发过去会进真实文献库
const PORT = 27600 + Math.floor(Math.random() * 300)
const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-attach`, { DEEPSEEK_API_KEY: '', PARAREAD_CONNECTOR_PORT: String(PORT) })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const papers = () => ev(() => window.api.listPapers())
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const a = (await ev(() => window.api.importLink({ title: 'Recent Trends in Driver Safety Monitoring Systems: State of the Art and Challenges', doi: '10.1109/tvt.2016.2631604', url: 'https://ieeexplore.ieee.org/document/7755794', authors: ['Arief Barkah Koesdwiady'], year: 2016 }))).paper
  const b = (await ev(() => window.api.importLink({ title: 'The Effects of High Stress on Attention', doi: '10.1177/1071181315591107', url: 'https://journals.sagepub.com/doi/10.1177/1071181315591107', authors: ['Julie C. Prinet'], year: 2015 }))).paper
  await sleep(800)

  // 1. 选中仅链接的那条
  await win.click(`[data-paper="${a.id}"]`)
  await sleep(600)
  const box = win.locator('.insp-link')
  ok('右边面板说清没有 PDF，给两个按钮', (await box.count()) === 1 && (await box.locator('a.btn', { hasText: '去出版社页面下载' }).count()) === 1 && (await box.locator('button', { hasText: '补上 PDF' }).count()) === 1)
  ok('「去出版社页面下载」链到它的页面（在浏览器里打开）', (await box.locator('a.btn').getAttribute('href')) === 'https://ieeexplore.ieee.org/document/7755794' && (await box.locator('a.btn').getAttribute('target')) === '_blank')
  ok('仅链接的没有「打开阅读」', (await win.locator('.insp-ft .btn', { hasText: '打开阅读' }).count()) === 0)
  console.log(await shot(win, 'attach-link'))
  await win.dblclick(`[data-paper="${a.id}"]`)
  await sleep(800)
  ok('双击不打开空的阅读页，提示去右边补', (await win.locator('.reflow, .pdf-scroller').count()) === 0 && (await win.locator('.toast', { hasText: '还没有 PDF' }).count()) === 1)

  // 2. 点「补上 PDF」：系统选文件框换成假的，回这篇 PDF
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, PAPER)
  await box.locator('button', { hasText: '补上 PDF' }).click()
  let pa
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    pa = (await papers()).find((x) => x.id === a.id)
    if (pa?.kind === 'pdf') break
  }
  ok('补上以后变成正常论文、有页数、排队重排', pa.kind === 'pdf' && pa.pageCount > 0 && ['queued', 'running', 'done'].includes(pa.reflow.flash) || pa.reflow.ready === 'simple', JSON.stringify({ kind: pa.kind, pages: pa.pageCount, flash: pa.reflow.flash, ready: pa.reflow.ready }))
  await sleep(600)
  ok('面板换回「打开阅读」，补 PDF 那块没了', (await win.locator('.insp-link').count()) === 0 && (await win.locator('.insp-ft .btn', { hasText: '打开阅读' }).count()) === 1)
  ok('还是这一条，没多出来', (await papers()).length === 2)

  ok('接收口用的是测试端口', (await ev(() => window.api.connectorStatus())).port === PORT)
  // 3. 插件抓同一篇（按 DOI 认），带着它下载到的 PDF
  const before = (await papers()).length
  const res = await fetch(`http://127.0.0.1:${PORT}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ParaRead-Connector': '1', Origin: 'chrome-extension://test' },
    body: JSON.stringify({ url: 'https://journals.sagepub.com/doi/10.1177/1071181315591107', pdfUrl: null, meta: { title: 'The effects of high stress on attention: a first step toward triggering attentional narrowing', doi: '10.1177/1071181315591107', authors: ['Julie C. Prinet', 'Nadine B. Sarter'], year: 2015 }, pdf: readFileSync(PAPER2).toString('base64') })
  }).then((r) => r.json())
  await sleep(1000)
  const pb = (await papers()).find((x) => x.id === b.id)
  ok('插件抓到同一篇：回「补进了已有的那一条」', res.status === 'attached', JSON.stringify(res))
  ok('PDF 补进那一条，没多出一条', pb.kind === 'pdf' && (await papers()).length === before, JSON.stringify({ kind: pb.kind, n: (await papers()).length }))
  const popup = readFileSync(new URL('../../src/renderer/public/extension/popup.js', import.meta.url), 'utf8')
  ok('插件弹窗认得这个结果', /attached: 'PDF 补进了库里已有的那一条'/.test(popup))

  // 补好的能打开读
  await win.dblclick(`[data-paper="${a.id}"]`)
  await sleep(2500)
  ok('补好的那篇能打开读', (await win.locator('.reflow, .pdf-scroller, .reflow-status').count()) > 0)
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
