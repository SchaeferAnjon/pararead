// 灵感库走一遍（真窗口，真 AI 只用在转述和对比表上，DeepSeek）：
// 对照模式划一句点「灵感」，小卡三样都填 → 正文左边只有小灯泡（不画线、不铺底），悬停看用法；再收一句什么都不填；
// 一句先打「有质疑」再收进灵感（两样都在）；原文模式划一句收进来（有矩形、补上小节名），对照模式收的在原文模式页边也有灯泡；
// 侧栏「灵感库」按主题 / 论文 / 时间分组、搜索；「用这一条」：直接引带页码、复制 LaTeX 的 key 和导出的 .bib 一致、AI 转述；
// 「回到原处」跳回那一句；导出 Markdown 带灵感；Word 窗格（假 Office.js）插原句（带页码）、插转述；对比表「写一段」加一条灵感。
//   npx electron-vite build
//   E2E_PAPER=<BST-GATNet 的 PDF> E2E_PAPER2=<另一篇 PDF> DEEPSEEK_API_KEY=… E2E_CHROME=<Chrome 可执行文件> node scripts/e2e/inspiration.mjs <新的数据目录（绝对路径）>
// 测试实例：临时 HOME、另一个浏览器插件接收口（27485 是正在用的那个 ParaRead 的）、导出放数据目录里。Word 插件服务用 27484，先确认没被占着。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { close, launch, PAPER, ROOT, shot, sleep } from './drive.mjs'

const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? import.meta.url)
const { chromium } = require('playwright')
const dir = process.argv[2]
const PAPER2 = process.env.E2E_PAPER2
if (!dir || !PAPER || !PAPER2 || !process.env.DEEPSEEK_API_KEY) throw new Error('用法：E2E_PAPER=… E2E_PAPER2=… DEEPSEEK_API_KEY=… node scripts/e2e/inspiration.mjs <数据目录>')
const exportDir = join(dir, 'export')
const home = join(dir, 'home')
mkdirSync(exportDir, { recursive: true })
mkdirSync(home, { recursive: true })
const ORIGIN = 'https://localhost:27484'
const S1 = 'From a biomedical and health informatics perspective'
const S1_END = 'diverse resource settings'

const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info ? `：${info}` : ''), pass || fails.push(name))
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {})
const { app, win } = await launch(dir, { PARAREAD_WORD_SERVE: '1', PARAREAD_EXPORT_DIR: exportDir, HOME: home, PARAREAD_CONNECTOR_PORT: String(27600 + Math.floor(Math.random() * 300)) })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const until = async (what, fn, secs = 120) => {
  for (let i = 0; i < secs * 2; i++) {
    const v = await fn()
    if (v) return v
    await sleep(500)
  }
  throw new Error(`等不到：${what}`)
}
const SHOTS = process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`
// 截图，顺便记下要框出来的几个元素在图上的位置（交付页的编号框用，按屏幕像素 × 2）
const snap = async (name, boxes = {}) => {
  console.log('  截图', await shot(win, name))
  const items = []
  for (const [what, sel] of Object.entries(boxes)) {
    const r = await win.locator(sel).first().boundingBox().catch(() => null)
    if (r) items.push({ n: items.length + 1, what, box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2)) })
  }
  if (items.length) writeFileSync(`${SHOTS}/${name}.rects.json`, JSON.stringify(items))
}
const ideas = () => ev(() => window.api.ideaAll())
const post = (path, headers = {}) =>
  new Promise((res, rej) => {
    const r = request(ORIGIN + path, { rejectUnauthorized: false, method: 'POST', headers }, (rsp) => {
      let body = ''
      rsp.on('data', (d) => (body += d)).on('end', () => res({ status: rsp.statusCode, body }))
    })
    r.on('error', rej).end()
  })

// 在 root 里从 a 开头拖到 b 结尾（真鼠标），先把它滚到眼前
async function drag(rootSel, a, b) {
  const p = await ev(
    ({ rootSel, a, b }) => {
      const root = [...document.querySelectorAll(rootSel)].find((x) => x.textContent.replace(/\s+/g, ' ').includes(a))
      if (!root) return null
      root.scrollIntoView({ block: 'center' })
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes = []
      for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n)
      const flat = nodes.map((n) => n.data).join('')
      const at = (k) => {
        for (const n of nodes) {
          if (k < n.data.length) return [n, k]
          k -= n.data.length
        }
        return null
      }
      const i = flat.indexOf(a)
      const j = flat.indexOf(b, i) + b.length
      const [n1, o1] = at(i)
      const [n2, o2] = at(j - 1)
      const r1 = document.createRange()
      r1.setStart(n1, o1)
      r1.setEnd(n1, o1 + 1)
      const r2 = document.createRange()
      r2.setStart(n2, o2)
      r2.setEnd(n2, o2 + 1)
      const x = r1.getBoundingClientRect()
      const z = r2.getBoundingClientRect()
      return { x1: x.left + 1, y1: x.top + x.height / 2, x2: z.right - 1, y2: z.top + z.height / 2 }
    },
    { rootSel, a, b }
  )
  if (!p) throw new Error(`没找到：${a}`)
  await sleep(300)
  // 滚动以后再量一次
  await win.mouse.move(p.x1, p.y1)
  await win.mouse.down()
  await win.mouse.move(p.x2, p.y2, { steps: 12 })
  await win.mouse.up()
  await sleep(500)
}

try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'both', provider: 'deepseek', wordStyle: 'gbt' }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r1] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const [r2] = await ev((p) => window.api.importPdfs([p]), PAPER2)
  const pid = r1.paper.id
  await until('重排好', async () => (await ev((x) => window.api.getPaper(x), pid)).reflow.ready, 180)
  await win.dblclick(`[data-paper="${pid}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .mode-seg .seg-item')][3]?.click())
  await win.waitForSelector('.blk .src')
  await sleep(1200)

  // 1. 对照模式：工具条多了「灵感」，「解释」换成书
  await drag('.blk .src', S1, S1_END)
  const bar = await ev(() => ({ btns: [...document.querySelectorAll('.sel-toolbar .tb-btn')].map((b) => b.textContent.replace(/[A-Z]$/, '').trim()), explainIcon: document.querySelector('.sel-toolbar .tb-btn:nth-child(2) svg')?.getAttribute('class') ?? '' }))
  ok('工具条有「灵感」，在「笔记」后面', bar.btns.indexOf('灵感') === bar.btns.indexOf('笔记') + 1, bar.btns.join(' | '))
  ok('「解释」换成书的图标', /book-open/.test(bar.explainIcon), bar.explainIcon)
  await snap('ins-01-toolbar', { '工具条「灵感」': '.sel-toolbar .tb-btn:has-text("灵感")', '「解释」换成书': '.sel-toolbar .tb-btn:has-text("解释")' })

  // 2. 小卡三样都填：用法、两个新主题、转述；回车收好
  await win.locator('.sel-toolbar .tb-btn', { hasText: '灵感' }).click()
  await win.waitForSelector('.idea-capture')
  const where = await win.locator('.ic-head .hint').innerText().catch(() => '')
  ok('小卡显示原句、第几页和小节', (await win.locator('.ic-quote').innerText()).startsWith(S1) && /第 6 页/.test(where) && /CONCLUSION/.test(where), where)
  await win.locator('#ic-use').fill('引言第二段：说明为什么要在端侧做，隐私和成本两头都占')
  for (const tp of ['端侧部署', '隐私']) {
    await win.locator('.idea-topic.dash').click()
    await win.keyboard.type(tp)
    await win.keyboard.press('Enter')
  }
  await snap('ins-02-card', { '想怎么用': '#ic-use', '主题': '.ic-chips', '直接引还是转述': '.ic-how', '收进灵感库': '.idea-capture .btn.primary' })
  await win.locator('#ic-use').press('Enter')
  await sleep(800)
  let all = await ideas()
  const i1 = all.find((x) => x.text.startsWith(S1))
  ok('收进去了：用法、两个主题、直接引、页码 6', !!i1 && i1.use.startsWith('引言第二段') && i1.topics.join() === '端侧部署,隐私' && i1.how === 'quote' && i1.page === 6, JSON.stringify(i1 && { topics: i1.topics, page: i1.page, how: i1.how, section: i1.section }))
  ok('toast 写着主题，能打开灵感库', (await win.locator('.toast', { hasText: '收进灵感库 · 端侧部署、隐私' }).count()) === 1)
  const marks = await ev(() => ({ gut: document.querySelectorAll('.reflow .idea-gut').length, hl: ['hl-yellow', 'ul-yellow', 'idea-peek'].map((n) => CSS.highlights.get(n)?.size ?? 0) }))
  ok('正文左边一个小灯泡，那一句不画线不铺底', marks.gut === 1 && marks.hl.every((n) => n === 0), JSON.stringify(marks))
  await snap('ins-03-gutter', { '正文左边的小灯泡': '.reflow .idea-gut' })
  await win.locator('.reflow .idea-gut').hover()
  await win.waitForSelector('.idea-peek')
  await sleep(400)
  ok('悬停灯泡：用法和主题，那一句加一条淡紫的线', (await win.locator('.idea-peek .ip-use').innerText()).startsWith('引言第二段') && (await win.locator('.idea-peek .tag').count()) === 2 && (await ev(() => CSS.highlights.get('idea-peek')?.size ?? 0)) === 1)
  await snap('ins-04-peek', { '小灯泡': '.reflow .idea-gut', '悬停出的用法和主题': '.idea-peek' })
  await win.mouse.move(700, 120)
  await sleep(500)

  // 3. 小卡什么都不填，回车收好
  await drag('.blk .src', 'On the AffectiveROAD dataset', 'mean / P99 latency of 5.50 / 7.31 ms')
  await win.keyboard.press('i')
  await win.waitForSelector('.idea-capture')
  await win.locator('#ic-use').press('Enter')
  await sleep(800)
  all = await ideas()
  const i2 = all.find((x) => x.text.startsWith('On the AffectiveROAD'))
  ok('什么都不填也收：用法空、没主题、直接引', !!i2 && i2.use === '' && i2.topics.length === 0 && i2.how === 'quote', JSON.stringify(i2 && { use: i2.use, topics: i2.topics }))
  ok('第二个灯泡', (await win.locator('.reflow .idea-gut').count()) === 2)

  // 4. 同一句：先打「有质疑」，再点这条标注收进灵感
  await drag('.blk .src', 'This threat is primarily cognitive', 'attentional narrowing')
  await win.locator('.sel-toolbar .tb-btn', { hasText: '有质疑' }).click()
  await sleep(800)
  const doubt = (await ev((x) => window.api.annList(x), pid)).find((a) => a.label === 'doubt')
  ok('打上「有质疑」', !!doubt, doubt?.text.slice(0, 40))
  const pos = await ev(() => {
    const r = [...CSS.highlights.get('lb-doubt')][0].getClientRects()[0]
    return { x: r.left + 20, y: r.top + r.height / 2 }
  })
  await win.mouse.click(pos.x, pos.y)
  await win.waitForSelector('.sel-toolbar')
  await win.locator('.sel-toolbar .tb-btn', { hasText: '灵感' }).click()
  await win.locator('.idea-topic.dash').click()
  await win.keyboard.type('驾驶压力的危害')
  await win.keyboard.press('Enter')
  await win.locator('.ic-how .seg-item', { hasText: '用自己的话转述' }).click()
  await win.locator('.idea-capture .btn.primary').click()
  await sleep(800)
  all = await ideas()
  const i3 = all.find((x) => x.text.startsWith('This threat'))
  const doubt2 = (await ev((x) => window.api.annList(x), pid)).find((a) => a.id === doubt.id)
  ok('这一句既是「有质疑」又在灵感库里（转述、主题）', !!i3 && i3.how === 'paraphrase' && i3.topics[0] === '驾驶压力的危害' && doubt2?.label === 'doubt' && (await ev(() => CSS.highlights.get('lb-doubt')?.size ?? 0)) === 1)
  await snap('ins-05-doubt-and-idea', { '有质疑的红波浪线和灯泡在同一句': '.reflow .idea-gut >> nth=-1' })

  // 5. 原文模式：对照模式收的在页边也有灯泡；划一句收进来
  await ev(() => [...document.querySelectorAll('.mid-bar .mode-seg .seg-item')][0]?.click())
  await win.waitForSelector('.page[data-page="2"]')
  await ev(() => document.querySelector('.page[data-page="2"]').scrollIntoView())
  await until('第 2 页的文字层', () => ev(() => (document.querySelector('.page[data-page="2"] .textLayer')?.textContent ?? '').replace(/\s+/g, '').includes('Akeystrength')), 30)
  // 文字层一行一个 span，行和行之间没有空格：从「A key」拖到「annotation process」
  await drag('.page[data-page="2"] .textLayer', 'A key', 'annotation process')
  await win.locator('.sel-toolbar .tb-btn', { hasText: '灵感' }).click()
  ok('原文模式的小卡写着第几页', /第 2 页/.test(await win.locator('.ic-head .hint').innerText()))
  await win.locator('#ic-use').fill('方法部分：选 AffectiveROAD 的理由')
  await win.locator('.idea-topic', { hasText: '驾驶压力的危害' }).count()
  await win.locator('.idea-topic.dash').click()
  await win.keyboard.type('数据集')
  await win.keyboard.press('Enter')
  await win.locator('#ic-use').press('Enter')
  await sleep(900)
  all = await ideas()
  const i4 = all.find((x) => x.text.startsWith('A key'))
  ok('原文模式收的：有矩形、第 2 页、小节名从重排里补上', !!i4 && i4.mode === 'pdf' && i4.rects?.length > 0 && i4.page === 2 && /DATASET/i.test(i4.section), JSON.stringify(i4 && { page: i4.page, section: i4.section, rects: i4.rects?.length }))
  await until('第 2 页的灯泡', () => ev(() => document.querySelectorAll('.page[data-page="2"] .idea-gut').length === 1), 10)
  await snap('ins-06-pdf', { '原文模式的灯泡在页边': '.page[data-page="2"] .idea-gut' })
  await ev(() => document.querySelector('.page[data-page="6"]').scrollIntoView())
  await until('第 6 页对照模式收的那句也有灯泡', () => ev(() => document.querySelectorAll('.page[data-page="6"] .idea-gut').length >= 1), 30)
  ok('对照模式收的句子在原文模式页边也有灯泡', true)
  await snap('ins-07-pdf-p6')

  // 6. 侧栏「灵感库」
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await sleep(800)
  const navCount = await win.locator('.nav-item', { hasText: '灵感库' }).locator('.count').innerText()
  ok('侧栏「灵感库」写着条数', navCount === '4', navCount)
  await win.locator('.nav-item', { hasText: '灵感库' }).click()
  await win.waitForSelector('.idea-item')
  await win.locator('.ideas-page .seg-item', { hasText: '按主题' }).click()
  const topicHeads = await ev(() => [...document.querySelectorAll('.ig-head .tt')].map((x) => x.textContent))
  ok('按主题：一条两个主题两组都有，没打主题的放最后', topicHeads.includes('端侧部署') && topicHeads.includes('隐私') && topicHeads.at(-1) === '没打主题', topicHeads.join(' | '))
  await snap('ins-08-library-topic', { '侧栏「灵感库」': '.nav-item:has-text("灵感库")', '按主题 / 论文 / 时间': '.ideas-page .np-bar .seg', '搜索': '.ideas-page .np-search', '一条灵感': '.idea-item' })
  await win.locator('.ideas-page .seg-item', { hasText: '按论文' }).click()
  const paperHeads = await ev(() => [...document.querySelectorAll('.ig-head .tt')].map((x) => x.textContent))
  ok('按论文：一篇一组', paperHeads.length === 1 && paperHeads[0].startsWith('BST-GATNet'), paperHeads.join(' | '))
  const order = await ev(() => [...document.querySelectorAll('.idea-item .np-quote')].map((x) => x.textContent.slice(0, 12)))
  ok('一篇里按页码排', order[0].startsWith('This threat') || order[0].startsWith('A key'), order.join(' | '))
  await snap('ins-09-library-paper')
  await win.locator('.ideas-page .seg-item', { hasText: '按时间' }).click()
  ok('按时间：今天', (await ev(() => [...document.querySelectorAll('.ig-head .tt')].map((x) => x.textContent))).join() === '今天')
  await win.locator('.np-search input').fill('privacy')
  ok('搜 privacy：只剩那一句', (await win.locator('.idea-item').count()) === 1)
  await win.locator('.np-search input').fill('端侧')
  ok('搜主题「端侧」：用法和主题都能搜到', (await win.locator('.idea-item').count()) === 1)
  await win.locator('.np-search input').fill('')
  await win.locator('.ideas-page .seg-item', { hasText: '按主题' }).click()

  // 7. 用这一条：直接引带页码；复制 LaTeX 的 key 和导出的 .bib 一致
  await ev(() => window.api.bibChoose())
  await win.locator(`.idea-item[data-idea="${i1.id}"]`).first().click()
  await win.waitForSelector('.idea-drawer')
  ok('直接引：原句加 GB/T 带页码的引用', (await win.locator('.idea-out').innerText()).includes('[1]6'), await win.locator('.idea-out .c').innerText())
  await win.locator('.idea-drawer .seg-item', { hasText: 'IEEE' }).click()
  ok('换 IEEE：[1, p. 6]', (await win.locator('.idea-out .c').innerText()) === '[1, p. 6]')
  await ev(() => { const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (x) => ((window.__copied = x), w(x).catch(() => {})) })
  await win.locator('.idea-df .btn', { hasText: '复制 LaTeX' }).click()
  await sleep(300)
  const tex = await ev(() => window.__copied)
  const key = /\\cite\[p\.~6\]\{([^}]+)\}/.exec(tex)?.[1]
  const bibFile = join(exportDir, 'ParaRead.bib')
  const bib = existsSync(bibFile) ? readFileSync(bibFile, 'utf8') : ''
  ok('复制的 LaTeX 是 ``原句\'\'~\\cite[p.~6]{key}', tex.startsWith('``From a biomedical') && !!key, tex.slice(-60))
  ok('key 和自动导出的 .bib 一致', !!key && bib.includes(`{${key},`), key)
  await snap('ins-10-use-quote', { '直接引带页码': '.idea-out', 'LaTeX 和 key': '.idea-drawer .mx-code', '送进 Word': '.idea-df .btn.primary' })
  // AI 转述（DeepSeek），存下来
  await win.locator('.idea-drawer .seg-item', { hasText: '转述' }).first().click()
  await win.locator('.idea-drawer .btn', { hasText: '转述这一句' }).click()
  await until('转述好了', async () => (await ideas()).find((x) => x.id === i1.id)?.paraphrase?.en, 90)
  await sleep(500)
  const para = await win.locator('.idea-out').innerText()
  ok('AI 转述加引用、不带页码，存在这条上', para.includes('[1]') && !para.includes('p. 6'), para.slice(0, 120))
  ok('转述的 LaTeX 只有 \\cite{key}', (await win.locator('.idea-drawer .mx-code').innerText()).includes(`\\cite{${key}}`))
  await snap('ins-11-use-paraphrase', { 'AI 转述加引用': '.idea-out' })
  ok('抽屉里换成「转述」存回这条', (await ideas()).find((x) => x.id === i1.id)?.how === 'paraphrase')
  await win.locator('.idea-drawer .seg-item', { hasText: '直接引原句' }).click()
  await sleep(500)
  ok('再换回「直接引原句」', (await ideas()).find((x) => x.id === i1.id)?.how === 'quote')

  // 8. 回到原处
  await win.locator('.idea-src .text-btn', { hasText: '回到原处' }).click()
  await until('跳回那一句、灯泡亮', () => ev(() => !!document.querySelector('.idea-gut.on')), 20)
  const back = await ev(() => {
    const g = document.querySelector('.idea-gut.on')
    const r = g.getBoundingClientRect()
    return { inView: r.top > 0 && r.bottom < innerHeight, peek: CSS.highlights.get('idea-peek')?.size ?? 0 }
  })
  ok('回到原处：那一句在眼前，灯泡和那一句亮一下', back.inView && back.peek === 1, JSON.stringify(back))
  await snap('ins-12-back', { '回到原处：灯泡和那一句亮一下': '.idea-gut.on' })

  // 9. 导出 Markdown 带灵感
  await ev((x) => window.api.annExport(x), pid)
  const md = readdirSync(exportDir).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(exportDir, f), 'utf8')).join('\n')
  ok('导出的 Markdown 有「灵感」一节，带用法、主题、转述', md.includes('## 灵感') && md.includes('想怎么用：引言第二段') && md.includes('#端侧部署') && md.includes('转述（English）'), `${md.length} 字`)

  // 10. Word 窗格（假 Office.js）：灵感分页，按主题筛，插原句、插转述
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 350, height: 720 }, deviceScaleFactor: 2 })
  await ctx.route('https://appsforoffice.microsoft.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(`${ROOT}/scripts/e2e/office-stub.js`, 'utf8') }))
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(`${ORIGIN}/word.html?tab=idea&lang=zh`)
  await page.locator('.wp-idea').first().waitFor({ timeout: 10000 })
  ok('窗格列出 4 条灵感', (await page.locator('.wp-idea').count()) === 4)
  await page.locator('.wp-topic', { hasText: '端侧部署' }).click()
  await sleep(500)
  ok('按主题「端侧部署」筛：1 条', (await page.locator('.wp-idea').count()) === 1)
  const paneSnap = async (name, boxes) => {
    await page.screenshot({ path: `${SHOTS}/${name}.png` })
    const items = []
    for (const [what, sel] of Object.entries(boxes)) {
      const r = await page.locator(sel).first().boundingBox().catch(() => null)
      if (r) items.push({ n: items.length + 1, what, box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2)) })
    }
    writeFileSync(`${SHOTS}/${name}.rects.json`, JSON.stringify(items))
  }
  await paneSnap('ins-13-word-pane', { '「灵感」分段': '.wp-top .seg-item:has-text("灵感")', '按主题筛': '.wp-topics', '插原句 / 插转述': '.wp-idea .row' })
  await page.locator('.wp-idea .btn', { hasText: '插原句' }).click()
  await page.locator('.wp-foot', { hasText: '已插入原句和引用' }).waitFor()
  let ccs = await page.evaluate(() => window.__ccs())
  let text = await page.evaluate(() => window.__docText())
  ok('插原句：引号里是原句，引用带页码（GB/T 上标）', text.includes(`“${S1}`) && ccs[0]?.tag === `prcite:${pid}#p6` && ccs[0]?.html === '[1]<sup>6</sup>', `${ccs[0]?.tag} ${ccs[0]?.html}`)
  await page.locator('.wp-topic', { hasText: '全部' }).click()
  await sleep(400)
  await page.locator(`.wp-idea[data-idea="${i3.id}"] .btn`, { hasText: '插转述' }).click()
  await page.locator('.wp-foot', { hasText: '已插入转述和引用' }).waitFor({ timeout: 90000 })
  ccs = await page.evaluate(() => window.__ccs())
  text = await page.evaluate(() => window.__docText())
  ok('插转述：AI 转述加一处不带页码的引用', ccs.length === 2 && ccs[1].tag === `prcite:${pid}` && ccs[1].text === '[1]', text.slice(-160))
  ok('窗格没有脚本错误', errs.length === 0, errs.join(' / '))
  await paneSnap('ins-14-word-inserted', { '插好了': '.wp-foot' })
  ok('转述接口要窗格自己的头（别的网页发不出来）', (await post(`/api/ideas/paraphrase?id=${i1.id}&lang=en`)).status === 403)

  // 11. 对比表「写一段」加一条灵感（两篇，DeepSeek 填表）
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await sleep(800)
  await win.locator('.nav-item', { hasText: '全部论文' }).first().click()
  await sleep(600)
  await win.locator('.icon-btn[title="多选"]').click()
  for (const id of [pid, r2.paper.id]) await win.click(`[data-paper="${id}"]`)
  // 从阅读页回来时刚读的那篇已经是选中的，再点一下反而取消：按钮还不能点就把它点回来
  for (let k = 0; k < 2 && (await win.locator('.batch .btn.primary', { hasText: '做对比表' }).isDisabled()); k++) await win.click(`[data-paper="${k ? r2.paper.id : pid}"]`)
  await win.locator('.batch .btn.primary', { hasText: '做对比表' }).click()
  await win.locator('.mx-grid').waitFor({ timeout: 10000 })
  const sid = await until('会话建好', () => ev(async () => (await window.api.researchList()).find((s) => s.kind === 'matrix')?.id), 10)
  await until('表填好', async () => (await ev((s) => window.api.matrixGet(s), sid)).state.rows.every((r) => r.status === 'done' || r.status === 'failed'), 400)
  const mv = await ev((s) => window.api.matrixGet(s), sid)
  ok('对比表里带着这几篇的灵感', mv.ideas.length === 4, `${mv.ideas.length} 条`)
  await sleep(800)
  const boxes = win.locator('.mx-cell[data-cell] .checkbox')
  for (const k of [0, 1, 4]) await boxes.nth(k).click()
  await sleep(600) // 勾选 300ms 后才存（防抖），存好再写
  await win.locator('.mx-selbar .btn.primary').click()
  await win.locator('.mx-ol[data-part="outline"]').waitFor({ timeout: 120000 })
  await win.locator('.idea-add .tag.dash').click()
  await win.waitForSelector('.idea-menu')
  await sleep(300)
  await snap('ins-15-matrix-menu', { '「＋ 灵感」': '.idea-add .tag.dash', '表里这几篇的灵感': '.idea-menu' })
  await win.locator('.idea-menu .menu-item', { hasText: 'From a biomedical' }).click()
  ok('素材里多了这条灵感', (await win.locator('.idea-chip').count()) === 1)
  await win.locator('.text-btn', { hasText: '勾选变了，重新排' }).click()
  await until('新提纲用上灵感', async () => (await ev((s) => window.api.matrixGet(s), sid)).state.draft?.outline.some((o) => o.cells.some((c) => c.startsWith('idea:'))), 120)
  await win.locator('.mx-ol[data-part="outline"]').waitFor()
  ok('提纲用上了这条灵感', (await win.locator('.mx-ol .tag', { hasText: '灵感' }).count()) >= 1)
  await win.locator('.mx-drawer .btn.primary', { hasText: '写成段落' }).click()
  await win.locator('.mx-para').waitFor({ timeout: 180000 })
  const d = (await ev((s) => window.api.matrixGet(s), sid)).state.draft
  const used = d.sentences.filter((s) => s.src.some((c) => c.startsWith('idea:')))
  const latex = (await ev((s) => window.api.matrixLatex(s), sid)).text
  ok('段落里有句子用到这条灵感', used.length > 0, used.map((s) => s.t.slice(0, 90)).join(' / '))
  ok('用到这条直接引的灵感的那句，LaTeX 引用带页码', used.every((s) => s.pages?.[pid] === 6) && latex.includes('\\cite[p.~6]{'), latex.slice(0, 200))
  await win.locator('.mx-drawer').evaluate((el) => (el.scrollTop = 0))
  await snap('ins-16-matrix-drawer', { '素材里的灵感': '.idea-chip' })

  // 12. 深色：灵感库和正文的灯泡
  await win.emulateMedia({ colorScheme: 'dark' })
  await win.locator('.nav-item', { hasText: '灵感库' }).click()
  await win.waitForSelector('.idea-item')
  await win.locator(`.idea-item[data-idea="${i1.id}"]`).first().click()
  await sleep(500)
  await snap('ins-17-library-dark')
  await win.locator('.idea-src .text-btn', { hasText: '回到原处' }).click()
  await until('灯泡', () => ev(() => !!document.querySelector('.idea-gut')), 20)
  await sleep(2800)
  await win.locator('.reflow .idea-gut').first().hover()
  await sleep(400)
  await snap('ins-18-reader-dark')
} catch (e) {
  fails.push(String(e?.message ?? e))
  console.log('出错', e)
  await snap('ins-error').catch(() => {})
} finally {
  await browser.close()
  await close(app)
}
console.log(fails.length ? `\n没过 ${fails.length} 项：\n- ${fails.join('\n- ')}` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
