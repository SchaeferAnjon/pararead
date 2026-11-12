// 换界面语言走一遍：文献库、阅读页（对照）、收费页、设置窗（通用、会员），再用新数据目录看首次引导；每屏截图，
// 并数界面上还剩多少处中文（论文和译文区域不算），用来找漏翻的。
// node scripts/e2e/langs.mjs <语言> <有论文的数据目录> <新的数据目录>
import { close, launch, shot, sleep } from './drive.mjs'

const [lang, dataDir, freshDir] = process.argv.slice(2)
const env = { PARAREAD_UI_LANG: lang }
// 界面上的中文：跳过论文内容、译文、用户起的名字
const leftover = (win) =>
  win.evaluate(() => {
    const skip = '.doc, .tr-text, .row .t1, .row .t2, .page, .qv-title, .qv-abs, textarea, input, .msg, .ellipsis, .lang-native'
    const out = new Set()
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.textContent.trim()
      if (!/[一-鿿]/.test(s) || n.parentElement.closest(skip)) continue
      out.add(s.slice(0, 40))
    }
    for (const el of document.querySelectorAll('[title],[placeholder],[aria-label]'))
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const s = el.getAttribute(a)
        if (s && /[一-鿿]/.test(s) && !el.closest(skip)) out.add(`@${a} ${s.slice(0, 40)}`)
      }
    return [...out]
  })
const report = async (win, name) => {
  const left = await leftover(win)
  console.log(`${name}: ${await shot(win, `${lang}-${name}`)}${left.length ? `\n  还是中文: ${left.join(' | ')}` : ''}`)
}

{
  const { app, win } = await launch(dataDir, env)
  win.on('pageerror', (e) => console.log('pageerror:', e.message))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820))
    await sleep(1500)
    await win.locator('.row').first().click()
    await sleep(600)
    await report(win, 'library')
    await win.locator('.plan').click()
    await sleep(2500)
    await report(win, 'pricing')
    await win.keyboard.press('Escape')
    await win.locator('.row').first().dblclick()
    await sleep(2000)
    await win.evaluate(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
    await sleep(2500)
    await report(win, 'reader')
    for (const sec of ['general', 'member', 'reflow', 'about']) {
      const opened = app.waitForEvent('window', { timeout: 5000 }).catch(() => null)
      await win.evaluate((s) => window.api.openSettings(s), sec)
      const sw = (await opened) ?? app.windows().find((w) => w !== win)
      await sw.waitForLoadState('domcontentloaded')
      await sleep(sec === 'member' ? 2500 : 900)
      await report(sw, `settings-${sec}`)
    }
    console.log('菜单栏:', (await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label))).join(' · '))
  } finally {
    await close(app).catch((e) => console.log('退出:', e.message))
  }
}
{
  const { app, win } = await launch(freshDir, env)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820))
    await sleep(1500)
    await report(win, 'onb-1')
    for (const n of [2, 3, 4, 5]) {
      await win.locator('.of .btn.primary').click()
      await sleep(500)
      await report(win, `onb-${n}`)
    }
    await win.evaluate(() => window.api.mineruStopInstall())
  } finally {
    await close(app).catch((e) => console.log('退出:', e.message))
  }
}
