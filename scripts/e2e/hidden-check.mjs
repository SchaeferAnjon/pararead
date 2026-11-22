// 测试模式（E2E=1）的检查：窗口不出现在屏幕上，按钮照常能点，截图照常能截。
//
//   npm run build && node scripts/e2e/hidden-check.mjs [数据目录]
//
// 走一遍：启动 → 文献库 → 真点「导入」（打开面板只记下来）→ 导入测试论文 → 右键它（右键菜单只记下来）→
// 打开设置窗口 → 把窗口改大小。每一步查：所有窗口没显示、全透明，前台应用没被换掉；给了 WINCHECK=<可执行文件>
// （参数是 pid，屏幕上有这个进程的可见窗口就退出码 1）时再从系统那边查一次。截图放 E2E_SHOTS（默认 tmp/shots）。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const front = () => execFileSync('lsappinfo', ['info', '-only', 'name', execFileSync('lsappinfo', ['front']).toString().trim()]).toString().trim()
const failures = []
const check = (ok, what) => {
  console.log(`${ok ? '通过' : '失败'}  ${what}`)
  if (!ok) failures.push(what)
}

const frontBefore = front()
const { app, win } = await launch(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'pararead-e2e-')))
const pid = app.process().pid

async function hidden(step) {
  await sleep(1500)
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), opacity: w.getOpacity() })))
  check(wins.length > 0 && wins.every((w) => !w.visible && w.opacity === 0), `${step}：${wins.length} 个窗口都没显示、全透明`)
  if (process.env.WINCHECK) {
    try {
      check(true, `${step}：系统里查不到可见窗口 ${execFileSync(process.env.WINCHECK, [String(pid)]).toString().trim()}`)
    } catch (e) {
      check(false, `${step}：系统里查到了可见窗口 ${e.stdout}`)
    }
  }
  check(front() === frontBefore, `${step}：前台应用还是 ${frontBefore}`)
}

const recorded = () => app.evaluate(() => globalThis.srScreen)
try {
  await sleep(1000)
  await win.evaluate(() => window.api.setSettings({ onboarded: true })) // 新数据目录会先出首次引导
  await win.waitForSelector('button[title^="导入 PDF"]', { timeout: 30_000 })
  await hidden('文献库')

  await win.click('button[title^="导入 PDF"]')
  await sleep(500)
  check((await recorded()).includes('打开面板'), '点「导入」：打开面板只记下来')

  if (existsSync(PAPER)) {
    const [r] = await win.evaluate((p) => window.api.importPdfs([p]), PAPER)
    await sleep(1500)
    await win.click(`[data-paper="${r.paper.id}"]`, { button: 'right' })
    await sleep(500)
    // 右键菜单是页面里自己画的（lib/menu.tsx），只有系统菜单才会被测试模式记下来
    const menu = await win.locator('.pop.menu').count()
    check(menu === 1, `右键论文：页面里出了自绘菜单（${menu} 个）`)
    await win.keyboard.press('Escape')
    await hidden('导入论文后')
  } else console.log(`没有测试论文 ${PAPER}，跳过导入和右键`)
  console.log(await shot(win, 'hidden-library'))

  // 菜单栏「设置…」：playwright 点不到原生菜单，调菜单项的 click()
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find((i) => i.label === '设置…').click())
  let settings
  for (let i = 0; i < 100 && !settings; i++) {
    settings = app.windows().find((p) => p.url().includes('#settings'))
    if (!settings) await sleep(100)
  }
  check(Boolean(settings), '设置窗口打开了')
  await settings.waitForLoadState('domcontentloaded')
  await hidden('设置窗口')
  console.log(await shot(settings, 'hidden-settings'))

  // macOS 改大小时最会把窗口拉回屏幕
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.setSize(w.getSize()[0] + 40, w.getSize()[1] + 40)))
  await hidden('改窗口大小后')
  console.log(`拦下的显示窗口：${(await recorded()).filter((s) => s.startsWith('显示窗口')).length} 次`)
} finally {
  await close(app)
}
console.log(failures.length ? `${failures.length} 项失败` : '全部通过')
process.exit(failures.length ? 1 : 0)
