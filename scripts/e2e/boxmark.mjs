// 公式、图、表整块标记：对照模式里悬停一个公式 → 工具条最前面四个色点 → 点一种颜色，公式被同色框住、记成一条笔记（带页码，左栏笔记里公式照样排出来）；
// 换一种颜色框跟着变；再点同一种颜色去掉；重开论文框还在。表格也试一次。
// E2E_PAPER=<带公式的论文 PDF> node scripts/e2e/boxmark.mjs <新的数据目录>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-boxmark`
let { app, win } = await launch(dir, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const boxAnns = (id) => ev((x) => window.api.annList(x).then((l) => l.filter((a) => a.style === 'box')), id)
const outline = (sel) => ev((s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return { w: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor } }, sel)
let id
const openPaper = async () => {
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2000)
  await ev(() => [...document.querySelectorAll('.mid-bar .mode-seg .seg-item')][3]?.click())
  await sleep(2000)
}
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  id = r.paper.id
  // 要等快速重排（MinerU）做完：简单重排里没有公式块
  for (let i = 0; i < 240 && !['flash', 'basic'].includes((await ev((x) => window.api.getPaper(x), id)).reflow.ready); i++) await sleep(1000)
  await openPaper()

  // 第一个公式：滚到中间，悬停
  const eqId = await ev(() => { const b = document.querySelector('.blk.eq') ?? document.querySelector('.blk.img'); b?.scrollIntoView({ block: 'center' }); return b?.dataset.block })
  ok('找到一个公式块（这篇的公式是图，就拿图）', !!eqId, eqId || JSON.stringify(await ev(() => ({ blks: document.querySelectorAll('.blk').length, types: [...new Set([...document.querySelectorAll('.blk')].map((b) => b.className))].slice(0, 12), mode: document.querySelector('.mid-bar .seg-item.on, .mid-bar [aria-pressed="true"]')?.textContent }))))
  await sleep(500)
  const eq = win.locator(`.blk[data-block="${eqId}"]`)
  await eq.hover()
  await sleep(300)
  const dots = eq.locator('.hb-dot')
  ok('悬停工具条最前面有四个色点，后面是 AI 解释、复制、放大', (await dots.count()) === 4 && (await eq.locator('.hb', { hasText: 'AI 解释' }).count()) === 1)
  await eq.locator('.hb-dot[data-color="blue"]').click()
  await sleep(800)
  let o = await outline(`.blk[data-block="${eqId}"]`)
  let list = await boxAnns(id)
  ok('点蓝色：公式被蓝框框住', o?.style === 'solid' && o.w === '2px' && o.color === 'rgb(0, 161, 216)', JSON.stringify(o))
  ok('记成一条笔记：整块、蓝色、LaTeX、带页码', list.length === 1 && list[0].color === 'blue' && list[0].blockId === eqId && list[0].text.length > 0 && list[0].page > 0, JSON.stringify(list.map((a) => [a.color, a.page, a.text.slice(0, 40)])))
  await eq.hover()
  console.log(await shot(win, 'boxmark-blue'))

  // 左栏笔记：公式照样排出来，同色细框
  await win.locator('.seg-item', { hasText: '笔记' }).first().click()
  await sleep(500)
  ok('左栏笔记里有这条，带同色框', (await win.locator('.note-mark.box[data-color="blue"]').count()) === 1, await win.locator('.note-mark.box').first().innerText().catch(() => ''))
  console.log(await shot(win, 'boxmark-notes'))

  // 换颜色
  await eq.hover()
  await eq.locator('.hb-dot[data-color="red"]').click()
  await sleep(800)
  o = await outline(`.blk[data-block="${eqId}"]`)
  list = await boxAnns(id)
  ok('换红色：框变红，还是一条', o?.color === 'rgb(255, 64, 21)' && list.length === 1 && list[0].color === 'red')

  // 表格也能标
  const tbId = await ev(() => { const b = document.querySelector('.blk.table'); b?.scrollIntoView({ block: 'center' }); return b?.dataset.block })
  if (tbId) {
    await sleep(500)
    const tb = win.locator(`.blk.table[data-block="${tbId}"]`)
    await tb.hover()
    await tb.locator('.hb-dot[data-color="green"]').click()
    await sleep(800)
    ok('表格点绿色：绿框，笔记写图注或前几行', (await outline(`.blk.table[data-block="${tbId}"]`))?.color === 'rgb(117, 187, 63)' && (await boxAnns(id)).length === 2)
  } else console.log('这篇没有表格，跳过')

  // 重开：框还在
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('back').click())
  await sleep(1200)
  await openPaper()
  await ev((b) => document.querySelector(`[data-block="${b}"]`)?.scrollIntoView({ block: 'center' }), eqId)
  await sleep(500)
  ok('回文献库再打开：红框还在', (await outline(`.blk[data-block="${eqId}"]`))?.color === 'rgb(255, 64, 21)')

  // 再点同一种颜色去掉
  await eq.hover()
  await eq.locator('.hb-dot[data-color="red"]').click()
  await sleep(800)
  o = await outline(`.blk[data-block="${eqId}"]`)
  ok('再点红色：框去掉，笔记删掉，提示能撤销', o?.style === 'none' && (await boxAnns(id)).filter((a) => a.blockId === eqId).length === 0 && (await win.locator('.toast', { hasText: '已去掉标记' }).count()) === 1)
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
