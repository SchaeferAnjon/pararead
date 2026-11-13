// 对照模式里选中一边、另一边跟着亮：真的用鼠标拖选原文的一截，看译文里亮起来的是不是对应的那一截；反过来也查。
// 对应关系来自意群对齐（一段问一次 AI，缓存），意群开关关着也要能用。
// DEEPSEEK_API_KEY=… node scripts/e2e/link.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-link`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
// 引言第一段里，原文（.src）或译文（.tr-text）中 needle 这几个字在屏幕上的位置（可能跨行）
const rectsOf = (side, needle) =>
  ev(([side, needle]) => {
    const sc = document.querySelector('.reflow-scroller').getBoundingClientRect()
    const blk = [...document.querySelectorAll('.blk.paragraph')].find((b) => b.getBoundingClientRect().top > sc.top + 60 && b.querySelector('.tr-text'))
    const root = blk.querySelector(side === 'en' ? '.src' : '.tr-text')
    const at = root.textContent.indexOf(needle)
    if (at < 0) return null
    const r = document.createRange()
    let pos = 0
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(), started = false; n; n = w.nextNode()) {
      const len = n.data.length
      if (!started && at < pos + len) (r.setStart(n, at - pos), (started = true))
      if (started && at + needle.length <= pos + len) { r.setEnd(n, at + needle.length - pos); break }
      pos += len
    }
    return [...r.getClientRects()].filter((q) => q.width > 1).map((q) => ({ x: q.x, y: q.y, w: q.width, h: q.height }))
  }, [side, needle])
const drag = async (side, needle) => {
  const rs = await rectsOf(side, needle)
  if (!rs?.length) throw new Error(`屏幕上找不到「${needle}」`)
  const a = rs[0], b = rs[rs.length - 1]
  await win.mouse.move(a.x + 1, a.y + a.h / 2)
  await win.mouse.down()
  await win.mouse.move(b.x + b.w - 1, b.y + b.h / 2, { steps: 10 })
  await win.mouse.up()
}
// 另一边亮着的字；等它出来（第一次要问 AI）
const linked = async (wait = 40) => {
  for (let i = 0; i < wait * 2; i++) {
    const t = await ev(() => [...(CSS.highlights.get('sel-link') ?? [])].map((r) => r.toString()))
    if (t.length) return t
    await sleep(500)
  }
  return []
}
const unselect = async () => { await win.mouse.click(60, 700); await sleep(400) }
const toIntro = async () => { await ev(() => { [...document.querySelectorAll('.blk.heading')].find((x) => /INTRODUCTION/.test(x.textContent)).scrollIntoView({ block: 'start' }); document.querySelector('.reflow-scroller').scrollTop -= 40 }); await sleep(600) }
const zhOf = () => ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); return [...document.querySelectorAll('.blk.paragraph')].find((b) => b.getBoundingClientRect().top > sc.top + 60 && b.querySelector('.tr-text')).querySelector('.tr-text').textContent })
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
  await sleep(2000)
  await toIntro()
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if (await ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const vis = [...document.querySelectorAll('.blk.paragraph')].filter((b) => { const q = b.getBoundingClientRect(); return q.bottom > sc.top && q.top < sc.bottom }); return vis.length > 0 && vis.every((b) => b.querySelector('.tr-text')) })) break
  }
  await toIntro()
  const zh = await zhOf()
  // 译文里这两句各自的位置：用来判断亮的是哪一句（译文是模型翻的，不写死字面）
  const zhSent = zh.split(/(?<=[。？！])/)
  console.log('译文前三句：', zhSent.slice(0, 3).map((x) => x.slice(0, 16) + '…').join(' ｜ '))

  // 1. 选原文第二句的一截 → 译文亮的在第二句里，不碰第一、第三句
  await drag('en', 'data is processed by the processor')
  let t = await linked()
  console.log(await shot(win, 'link-en-to-zh'))
  ok('选中原文的一截，译文里对应的亮了', t.length >= 1 && t.join('').length >= 4, t.join(' + '))
  ok('亮的是译文第二句里的字，没亮到别的句子', t.length >= 1 && t.every((x) => zhSent[1].includes(x)), `第二句：${zhSent[1]}`)
  ok('选区工具条照常出来', (await win.locator('.sel-toolbar').count()) === 1)

  // 2. 点别处：选区没了，亮的也没了
  await unselect()
  ok('选区没了，对面的也不亮了', (await ev(() => CSS.highlights.has('sel-link'))) === false)

  // 3. 选译文第三句开头几个字 → 原文亮的在第三句里
  const zh3 = zhSent[2].replace(/^[\s，]+/, '').slice(0, 6)
  await drag('zh', zh3)
  t = await linked()
  console.log(await shot(win, 'link-zh-to-en'))
  ok('选中译文的一截，原文里对应的亮了', t.length >= 1 && /Over the last few decades|computer architects/.test(t.join(' ')), `选了「${zh3}」→ ${t.join(' + ')}`)
  await unselect()

  // 4. 跨两句选原文 → 译文亮的跨第二、第三句
  await drag('en', 'stored inside the memory. Over the last few decades')
  t = await linked()
  ok('跨两句选：译文里两句各亮一截', t.join('').length > 6 && zhSent[1].includes(t.join('').slice(0, 3)) && zhSent[2].slice(0, 12).split('').some((ch) => t.join('').includes(ch)), t.join(' + '))
  await unselect()

  // 5. 意群开着、左右排法下一样
  await ev(() => window.api.setSettings({ senseGroups: true, trLayout: 'side' }))
  for (let i = 0; i < 40 && (await win.locator('.blk.senses').count()) < 2; i++) await sleep(700)
  await sleep(800)
  await toIntro()
  await drag('en', 'data is processed by the processor')
  t = await linked(10)
  console.log(await shot(win, 'link-senses-side'))
  ok('意群开着、左右排法：照样亮对应的', t.length >= 1 && t.every((x) => zhSent[1].includes(x)), t.join(' + '))
  await unselect()
  await drag('zh', zh3)
  t = await linked(10)
  ok('意群开着、左右排法：选译文也亮原文', t.length >= 1 && /Over the last few decades|computer architects/.test(t.join(' ')), t.join(' + '))
  await unselect()
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
