// 设置 › 重排：选默认用快速还是精细。默认快速 → 新导入的论文只跑快速、精细不自动跑，打开显示快速的；
// 改回精细 → 没有精细结果的论文排队补上，做完自动换成精细。卡片里的「检测」按钮照常能点、不会误选。
// E2E_PAPER=<一篇 PDF> node scripts/e2e/engine-default.mjs <新的数据目录>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-engine`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  // 设置 › 重排：点「快速」那张卡片
  await ev(() => window.api.openSettings('reflow'))
  await sleep(1500)
  const sw = app.windows().find((w) => w !== win)
  const cards = sw.locator('.choice.pick')
  ok('重排页两张能选的卡片，精细是默认', (await cards.count()) === 2 && (await cards.nth(1).getAttribute('class')).includes('on') && (await cards.nth(1).innerText()).includes('默认'))
  await cards.nth(1).locator('button', { hasText: '检测' }).click()
  await sleep(1500)
  ok('点卡片里的「检测」不会改默认', (await ev(() => window.api.getSettings())).defaultEngine === 'basic')
  await cards.nth(0).click()
  await sleep(600)
  ok('点快速那张：快速变成默认，写明精细不自动跑', (await ev(() => window.api.getSettings())).defaultEngine === 'flash' && (await cards.nth(0).innerText()).includes('精细不自动跑'))
  console.log(await shot(sw, 'engine-default-flash'))

  // 默认快速时导入一篇
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  let p
  for (let i = 0; i < 180; i++) {
    await sleep(1000)
    p = (await ev((x) => window.api.getPaper(x), id)).reflow
    if (p.flash === 'done') break
  }
  await sleep(4000)
  p = (await ev((x) => window.api.getPaper(x), id)).reflow
  ok('默认快速：只跑了快速，精细没排队', p.flash === 'done' && p.basic === 'none' && p.ready === 'flash', JSON.stringify({ flash: p.flash, basic: p.basic, ready: p.ready }))

  // 改回精细：这篇排队补精细，做完换上
  await cards.nth(1).click()
  await sleep(1500)
  p = (await ev((x) => window.api.getPaper(x), id)).reflow
  ok('改回精细：没有精细结果的论文排队补上', ['queued', 'running', 'done'].includes(p.basic), p.basic)
  for (let i = 0; i < 300 && p.basic !== 'done'; i++) (await sleep(1000)), (p = (await ev((x) => window.api.getPaper(x), id)).reflow)
  ok('精细做完自动换上', p.basic === 'done' && p.ready === 'basic', JSON.stringify({ basic: p.basic, ready: p.ready }))
  console.log(await shot(sw, 'engine-default-basic'))

  // 再改成快速：已经有精细结果的这篇，打开显示快速的
  await cards.nth(0).click()
  await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)
  const tierShown = await ev(() => document.querySelector('.mid-bar')?.textContent ?? '')
  ok('默认快速时打开：用快速的那份（标题栏写着快速）', /快速/.test(tierShown) && !/精细/.test(tierShown.replace(/全文翻译/, '')), tierShown.slice(0, 80))
  await sw.close()

  // 阅读页里手动选精细：默认快速时再导一篇（只有快速），选精细后标签写「精细」带进度，不再显示成「快速」；排好自动换上
  const [r2] = await ev((p) => window.api.importPdfs([p]), process.env.E2E_PAPER2 ?? PAPER)
  const id2 = r2.paper.id
  for (let i = 0; i < 180 && (await ev((x) => window.api.getPaper(x), id2)).reflow.flash !== 'done'; i++) await sleep(1000)
  await sleep(1500)
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('back').click())
  await sleep(1200)
  await win.dblclick(`[data-paper="${id2}"]`)
  await sleep(2500)
  const btn = win.locator('.mid-bar button[title*="重排"]').first()
  ok('只有快速时标签是「快速」', (await btn.innerText()).trim() === '快速', await btn.innerText())
  await btn.click()
  await sleep(400)
  await win.locator('.menu-item', { hasText: '精细' }).first().click()
  const seen = new Set()
  let p2
  for (let i = 0; i < 300; i++) {
    await sleep(1000)
    seen.add((await btn.innerText()).trim())
    p2 = (await ev((x) => window.api.getPaper(x), id2)).reflow
    if (p2.basic === 'done') break
  }
  await sleep(1500)
  const labels = [...seen]
  ok('选精细后排的时候标签写「精细」（带进度），不再显示成「快速」', labels.every((l) => l.startsWith('精细')), labels.slice(0, 6).join(' | '))
  ok('精细排好自动换上，标签「精细」不转圈', p2.basic === 'done' && (await btn.innerText()).trim() === '精细' && (await btn.locator('.spin').count()) === 0)

  // 没装 MinerU：选快速或精细直接说清楚，不记下这一档
  await ev(() => window.api.setSettings({ mineruPath: '/nonexistent/mineru-kit' }))
  await btn.click()
  await sleep(400)
  await win.locator('.menu-item', { hasText: '快速' }).first().click()
  await sleep(800)
  ok('没装 MinerU 时选快速：提示去设置里下载，标签不变', (await win.locator('.toast', { hasText: 'MinerU' }).count()) === 1 && (await btn.innerText()).trim() === '精细')
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
