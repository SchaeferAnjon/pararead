// AI 重点：左栏「重点」每条按类别铺 Notion 那样的浅底色；点一条跳到正文，那一句（和译文里对应的那句）用同一类别色标出来；
// 开着「AI 重点高亮」时全文的重点句按类别上色，原文、译文两边都有；关掉以后只剩点过的那一条。
// DEEPSEEK_API_KEY=… node scripts/e2e/marks.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-marks`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const TYPES = ['objective', 'method', 'result', 'novelty']
// 现在圈着的：每一类原文几处、译文几处
const marks = () =>
  ev((types) => {
    const out = {}
    for (const t of types) {
      const rs = [...(CSS.highlights.get(`ai-mark-${t}`) ?? [])]
      const zh = rs.filter((r) => r.startContainer.parentElement.closest('.tr'))
      out[t] = { en: rs.length - zh.length, zh: zh.length, first: rs.find((r) => !r.startContainer.parentElement.closest('.tr'))?.toString().slice(0, 60) ?? '' }
    }
    return out
  }, TYPES)
const total = (m, side) => TYPES.reduce((a, t) => a + m[t][side], 0)
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), r.paper.id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${r.paper.id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .mode-seg .seg-item')][3]?.click())
  await sleep(1500)
  await win.locator('.mid-bar button', { hasText: '全文翻译' }).first().click()

  // 左栏「重点」：问一次 AI 标出来
  await win.locator('.lp-tabs .seg-item, .left-tabs .seg-item, .seg-item', { hasText: '重点' }).first().click()
  await win.locator('.btn', { hasText: '标出重点' }).click()
  await win.locator('.key-item').first().waitFor({ timeout: 150_000 })
  await sleep(800)
  const list = await ev(() =>
    [...document.querySelectorAll('.key-item')].map((b) => ({ cls: [...b.classList].find((c) => c.startsWith('mk-')), bg: getComputedStyle(b).backgroundColor, tag: getComputedStyle(b.querySelector('.tag')).color }))
  )
  const kinds = [...new Set(list.map((x) => x.cls))]
  const bgByKind = Object.fromEntries(kinds.map((k) => [k, [...new Set(list.filter((x) => x.cls === k).map((x) => x.bg))]]))
  ok('重点列表：每条带类别底色，同类同色、不同类不同色', list.length > 3 && kinds.length >= 2 && Object.values(bgByKind).every((v) => v.length === 1) && new Set(Object.values(bgByKind).map((v) => v[0])).size === kinds.length, JSON.stringify(bgByKind))
  console.log(await shot(win, 'marks-list'))

  // 「标出重点」会顺手打开「AI 重点高亮」：先关掉，再试只点一条
  const toggle = win.locator('.mid-bar button[title="AI 重点高亮"]')
  if (await toggle.evaluate((b) => b.classList.contains('active'))) await toggle.click()
  await sleep(600)
  // 「AI 重点高亮」没开：点一条，正文里只标这一条，用它的类别色
  const item = win.locator('.key-item').nth(1)
  const kind = (await item.getAttribute('class')).match(/mk-(\w+)/)[1]
  const text = (await item.evaluate((b) => b.lastChild.textContent)).trim().slice(0, 30)
  await item.click()
  let m = await marks()
  for (let i = 0; i < 60 && !(m[kind].en > 0 && m[kind].zh > 0); i++) (await sleep(1000)), (m = await marks())
  ok('点一条：正文里那一句用它的类别色标出来', m[kind].en === 1 && total(m, 'en') === 1 && text.startsWith(m[kind].first.slice(0, 20)), `${kind}：${m[kind].first}｜共 ${total(m, 'en')} 处｜列表里：${text}`)
  ok('译文里对应的那句也标上同一类别色', m[kind].zh > 0, `${m[kind].zh} 处`)
  ok('列表里点过的那条框出来', (await win.locator('.key-item.on').count()) === 1)
  await sleep(500)
  console.log(await shot(win, 'marks-jump'))

  // 打开「AI 重点高亮」：全文按类别上色
  await toggle.click()
  await sleep(800)
  m = await marks()
  for (let i = 0; i < 60 && total(m, 'zh') < 3; i++) (await sleep(1000)), (m = await marks())
  const used = TYPES.filter((t) => m[t].en > 0)
  ok('开着 AI 重点：全文的重点句按类别上色，原文译文都有', used.length >= 2 && total(m, 'en') >= list.length - 2 && total(m, 'zh') > 0, JSON.stringify(Object.fromEntries(TYPES.map((t) => [t, [m[t].en, m[t].zh]]))))
  const tagColors = await ev(() => [...new Set([...document.querySelectorAll('.aitag')].map((x) => getComputedStyle(x).backgroundColor))].length)
  ok('正文边上的类别小标签也是类别色', tagColors >= 2, `${tagColors} 种`)
  console.log(await shot(win, 'marks-all'))
  await win.emulateMedia({ colorScheme: 'dark' })
  await sleep(800)
  console.log(await shot(win, 'marks-all-dark'))
  await win.emulateMedia({ colorScheme: 'light' })

  await win.locator('.mid-bar button[title="AI 重点高亮"]').click()
  await sleep(800)
  m = await marks()
  ok('关掉 AI 重点：只剩点过的那一条', total(m, 'en') === 1 && m[kind].en === 1, JSON.stringify(Object.fromEntries(TYPES.map((t) => [t, m[t].en]))))
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
