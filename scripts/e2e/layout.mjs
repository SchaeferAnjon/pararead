// 阅读页三栏在窄窗口里的位置：960 宽放不下三栏时收一栏，正文不能被挤没（0.1.0 里左栏一收起，正文就排进 0 宽的那一列）。
// node scripts/e2e/layout.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-layout`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h])
// 每一栏的「左边+宽度」，没有的是 -；firstBtn 是正文标题栏第一个按钮的左边（左栏收起时要让开红绿灯）
const cols = () =>
  ev(() => {
    const o = {}
    for (const s of ['left', 'mid', 'right']) {
      const r = document.querySelector('.col-' + s)?.getBoundingClientRect()
      o[s] = r ? `${Math.round(r.x)}+${Math.round(r.width)}` : '-'
    }
    o.firstBtn = Math.round(document.querySelector('.mid-bar .icon-btn').getBoundingClientRect().x)
    return o
  })
const click = (title) => ev((x) => [...document.querySelectorAll('button.icon-btn')].find((b) => b.title.startsWith(x)).click(), title)
const fails = []
const expect = async (name, want, wait = 700) => {
  await sleep(wait)
  const got = await cols()
  const pass = Object.entries(want).every(([k, v]) => got[k] === v)
  console.log(pass ? '通过' : '没过', name, JSON.stringify(got), pass ? '' : `应该是 ${JSON.stringify(want)}`)
  if (!pass) fails.push(name)
}
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await size(960, 886)
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  await sleep(1500)
  await win.dblclick(`[data-paper="${r.paper.id}"]`)
  await expect('960 宽打开：左栏自动收起，正文和 AI 栏都在', { left: '-', mid: '0+580', right: '580+380', firstBtn: 84 }, 2500)
  console.log(await shot(win, 'layout-960'))
  // 标题栏放不下带字的按钮时只留图标：搜索、显示设置不能被挤出去
  const bar = await ev(() => { const mid = document.querySelector('.col-mid').getBoundingClientRect(); const r = (t) => Math.round(document.querySelector(`button[title^="${t}"]`).getBoundingClientRect().right); return { mid: Math.round(mid.right), aa: r('显示设置'), find: r('搜索') } })
  console.log(bar.aa <= bar.mid && bar.find < bar.aa ? '通过' : '没过', '960 宽：搜索和显示设置都在标题栏里', JSON.stringify(bar))
  if (!(bar.aa <= bar.mid && bar.find < bar.aa)) fails.push('标题栏')
  await click('显示左栏')
  await expect('点显示左栏：左栏留着，收 AI 栏', { left: '0+260', mid: '260+700', right: '-' })
  await click('显示 AI 问答')
  await expect('点显示 AI 问答：AI 栏留着，收左栏', { left: '-', mid: '0+580', right: '580+380' })
  await size(1400, 886)
  await expect('拉到 1400：自动收的左栏回来', { left: '0+260', mid: '260+760', right: '1020+380' })
  await click('收起左栏')
  await expect('手动收起左栏：正文占满左边', { left: '-', mid: '0+1020', right: '1020+380', firstBtn: 84 })
  await size(960, 886)
  await size(1400, 886)
  await expect('缩小再拉宽：手动收的左栏不自己回来', { left: '-', mid: '0+1020', right: '1020+380' })
  // 拖 AI 栏的分隔条：正文最少留 480
  await size(960, 886)
  await sleep(700)
  const box = await win.locator('.col-right .resizer').boundingBox()
  await win.mouse.move(box.x + 6, 300)
  await win.mouse.down()
  await win.mouse.move(box.x - 300, 300, { steps: 5 })
  await win.mouse.up()
  await expect('AI 栏往左拖 300：停在正文剩 480', { left: '-', mid: '0+480', right: '480+480' })
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
