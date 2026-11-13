// 对照模式的意群显示：在显示设置里打开，正文段变成一句原文配一句译文，对应的意群同色。
// 重点查：开关前后 .src / .tr-text 的文字一个字不变（高亮按字符偏移存）、之前画的高亮还在原来那几个字上、
// 上下和左右两种排法、鼠标停在一块上两边一起亮、关掉回到原样。
// DEEPSEEK_API_KEY=… node scripts/e2e/senses.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-senses`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const pick = async (label) => {
  if (!(await win.locator('.aa-pop').count())) await win.locator('button[title="显示设置"]').click()
  await win.locator('.aa-pop .seg-item', { hasText: label }).click()
  await sleep(500)
}
const toggleSense = async () => {
  if (!(await win.locator('.aa-pop').count())) await win.locator('button[title="显示设置"]').click()
  await win.locator('.aa-pop .aa-row', { hasText: '意群' }).locator('.switch').click()
  await sleep(300)
}
// 每个已有译文的正文段现在的文字（原文、译文）
const texts = () => ev(() => Object.fromEntries([...document.querySelectorAll('.blk.paragraph')].filter((b) => b.querySelector('.tr-text')).map((b) => [b.dataset.block, [b.querySelector('.src').textContent, b.querySelector('.tr-text').textContent]])))
// 现在画着的黄色高亮盖住的字
const hlText = () => ev(() => [...(CSS.highlights.get('hl-yellow') ?? [])].map((r) => r.toString()))
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  // 滚到引言，等这一屏的译文都到
  const toIntro = async () => { await ev(() => { [...document.querySelectorAll('.blk.heading')].find((x) => /INTRODUCTION/.test(x.textContent)).scrollIntoView({ block: 'start' }); document.querySelector('.reflow-scroller').scrollTop -= 40 }); await sleep(600) }
  await sleep(2000)
  await toIntro()
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if (await ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const vis = [...document.querySelectorAll('.blk.paragraph')].filter((b) => { const q = b.getBoundingClientRect(); return q.bottom > sc.top && q.top < sc.bottom }); return vis.length > 0 && vis.every((b) => b.querySelector('.tr-text')) })) break
  }
  await toIntro()

  // 先在普通显示下画一条高亮（引言第一段的第一行）
  const firstPara = await ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const b = [...document.querySelectorAll('.blk.paragraph')].find((x) => x.getBoundingClientRect().top > sc.top + 60 && x.querySelector('.tr-text')); const q = b.querySelector('.src').getBoundingClientRect(); return { id: b.dataset.block, x: q.x, y: q.y, w: q.width } })
  await win.mouse.move(firstPara.x + 60, firstPara.y + 14)
  await win.mouse.down()
  await win.mouse.move(firstPara.x + 330, firstPara.y + 14, { steps: 8 })
  await win.mouse.up()
  await sleep(400)
  await win.locator('.sel-toolbar .dot-btn').first().click({ timeout: 5000 })
  await sleep(700)
  const hl0 = await hlText()
  ok('普通显示下画了一条高亮', hl0.length === 1 && hl0[0].length > 5, hl0[0])
  const off = await texts()

  // 打开意群
  await toggleSense()
  await win.keyboard.press('Escape')
  // 等眼前这几段都出来
  const visibleReady = () => ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const vis = [...document.querySelectorAll('.blk.paragraph')].filter((b) => { const q = b.getBoundingClientRect(); return q.bottom > sc.top + 40 && q.top < sc.bottom - 40 }); return vis.length > 0 && vis.every((b) => b.classList.contains('senses')) })
  for (let i = 0; i < 60 && !(await visibleReady()); i++) await sleep(1000)
  await sleep(1500)
  const sgCount = await win.locator('.blk.senses').count()
  ok('打开后正文段变成一句一行', sgCount >= 3, `${sgCount} 段有了意群`)
  const on = await texts()
  const sgIds = await ev(() => [...document.querySelectorAll('.blk.senses')].map((b) => b.dataset.block))
  const diff = sgIds.filter((k) => off[k] && (off[k][0] !== on[k][0] || off[k][1] !== on[k][1]))
  ok('有意群的段：原文、译文的文字和打开前一个字不差', sgIds.some((k) => off[k]) && diff.length === 0, diff.length ? `不一样的：${diff.length} 段，例如 ${JSON.stringify([off[diff[0]][0].slice(0, 80), on[diff[0]][0].slice(0, 80)])}` : `${sgIds.filter((k) => off[k]).length} 段都一样`)
  const hl1 = await hlText()
  ok('之前画的高亮还盖在原来那几个字上', hl1.length === 1 && hl1[0] === hl0[0], hl1[0])

  // 上下排：原文第 i 句、译文第 i 句、原文第 i+1 句依次往下；同一块两边同色
  const rows = await ev(() => {
    const sc = document.querySelector('.reflow-scroller').getBoundingClientRect()
    const b = [...document.querySelectorAll('.blk.senses')].find((x) => x.getBoundingClientRect().top > sc.top && x.querySelectorAll('.src .sen').length >= 3)
    const top = (n) => Math.round(n.getBoundingClientRect().top)
    const en = [...b.querySelectorAll('.src .sen')], zh = [...b.querySelectorAll('.tr .sen')]
    const a = b.querySelector('.src .sg[data-k]'), z = b.querySelector(`.tr .sg[data-k="${a.dataset.k}"]`)
    return { n: en.length, nz: zh.length, en: en.slice(0, 3).map(top), zh: zh.slice(0, 3).map(top), x: [Math.round(en[0].getBoundingClientRect().x), Math.round(zh[0].getBoundingClientRect().x)], colorEn: getComputedStyle(a).color, colorZh: z && getComputedStyle(z).color, plain: getComputedStyle(b.querySelector('.src')).color, colors: new Set([...b.querySelectorAll('.src .sg')].map((n) => getComputedStyle(n).color)).size }
  })
  ok('上下排：一句原文、一句译文交替往下', rows.n === rows.nz && rows.en[0] < rows.zh[0] && rows.zh[0] < rows.en[1] && rows.en[1] < rows.zh[1] && rows.x[0] === rows.x[1], JSON.stringify({ 句数: rows.n, 原文顶: rows.en, 译文顶: rows.zh }))
  ok('同一块原文和译文同色，和普通字不同，一段里不止一种颜色', rows.colorEn === rows.colorZh && rows.colorEn !== rows.plain && rows.colors >= 3, `${rows.colorEn} / ${rows.colorZh}，${rows.colors} 种`)
  await win.mouse.click(60, 700)
  await sleep(300)
  console.log(await shot(win, 'senses-stack'))

  // 鼠标停在一块上：两边一起亮
  const sgBox = await ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const n = [...document.querySelectorAll('.blk.senses .src .sg')].filter((x) => x.getBoundingClientRect().top > sc.top + 60)[1]; const q = n.getBoundingClientRect(); return { x: q.x, y: q.y } })
  await win.mouse.move(sgBox.x + 10, sgBox.y + 8)
  await sleep(300)
  const hot = await ev(() => ({ en: document.querySelectorAll('.src .sg.hot').length, zh: document.querySelectorAll('.tr .sg.hot').length, same: new Set([...document.querySelectorAll('.sg.hot')].map((n) => n.dataset.k)).size }))
  ok('鼠标停在一块上，译文里对应的也亮', hot.en >= 1 && hot.zh >= 1 && hot.same === 1, JSON.stringify(hot))
  console.log(await shot(win, 'senses-hover'))
  await win.mouse.move(60, 700)
  await sleep(300)
  ok('鼠标移出正文后不再亮着', (await win.locator('.sg.hot').count()) === 0)

  // 意群开着时在一句里划词：高亮存上，偏移对得上字
  const sen = await ev(() => { const s = [...document.querySelectorAll('.blk.senses .src .sen')].find((n) => n.getBoundingClientRect().top > 300 && n.textContent.length > 60); const q = s.getBoundingClientRect(); return { x: q.x, y: q.y } })
  await win.mouse.move(sen.x + 30, sen.y + 14)
  await win.mouse.down()
  await win.mouse.move(sen.x + 260, sen.y + 14, { steps: 8 })
  await win.mouse.up()
  await sleep(400)
  await win.locator('.sel-toolbar .dot-btn').nth(1).click({ timeout: 5000 })
  await sleep(700)
  const anns = await ev((x) => window.api.annList(x), id)
  const green = await ev(() => [...(CSS.highlights.get('hl-green') ?? [])].map((q) => q.toString()))
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  ok('意群开着时划词高亮', anns.length === 2 && green.length === 1 && norm(green[0]) === norm(anns.find((a) => a.color === 'green').text), green[0])

  // 左右排
  await pick('左右')
  await win.keyboard.press('Escape')
  await sleep(600)
  const side = await ev(() => {
    const sc = document.querySelector('.reflow-scroller').getBoundingClientRect()
    const b = [...document.querySelectorAll('.blk.senses')].find((x) => x.getBoundingClientRect().bottom > sc.top + 200 && x.querySelectorAll('.src .sen').length >= 3)
    const q = (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.top), Math.round(r.width)] }
    return { en: [...b.querySelectorAll('.src .sen')].slice(0, 3).map(q), zh: [...b.querySelectorAll('.tr .sen')].slice(0, 3).map(q) }
  })
  ok('左右排：每句原文和它的译文在同一行、各占一栏', side.en.every((e, i) => Math.abs(e[1] - side.zh[i][1]) < 8 && side.zh[i][0] > e[0] + e[2] && Math.abs(e[2] - side.zh[i][2]) <= 1), JSON.stringify(side))
  await win.mouse.click(60, 700)
  await sleep(300)
  console.log(await shot(win, 'senses-side'))

  // 关掉：回到原样，文字不变，两条高亮都还在原来的字上
  await pick('上下')
  await toggleSense()
  await win.keyboard.press('Escape')
  await sleep(1200)
  const back = await texts()
  const diff2 = sgIds.filter((k) => off[k] && (off[k][0] !== back[k][0] || off[k][1] !== back[k][1]))
  const hl2 = await hlText()
  const green2 = await ev(() => [...(CSS.highlights.get('hl-green') ?? [])].map((q) => q.toString()))
  ok('关掉后回到整段，文字不变', (await win.locator('.blk.senses').count()) === 0 && diff2.length === 0)
  ok('两条高亮在关掉后还在原来的字上', hl2[0] === hl0[0] && norm(green2[0] ?? '') === norm(green[0]), `${hl2[0]}｜${green2[0]}`)
  await toggleSense()
  await win.keyboard.press('Escape')
  await sleep(1500)
  ok('再打开：直接出来（走缓存），设置里记着', (await win.locator('.blk.senses').count()) >= 3 && (await ev(() => window.api.getSettings())).senseGroups === true, `${await win.locator('.blk.senses').count()} 段`)
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
