// Windows 安装包走一遍（在 GitHub Actions 的 windows-latest 上跑，.github/workflows/windows.yml）：
// 打开 → 首次引导 → 导入一篇 → 文献库 → 阅读页原文、对照 → 快捷键（Ctrl+Alt+S 收侧栏、Ctrl+, 开设置）→
// 菜单里的快捷键提示写成 Ctrl → 右上角系统的窗口按钮没盖住我们的按钮 → Word 插件的本机服务（PowerShell 生成证书）→ 退出。
//   E2E_APP=<win-unpacked\ParaRead.exe> E2E_PAPER=<一篇 PDF> node scripts/e2e/windows.mjs <数据目录>
import { request } from 'node:https'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

if (!process.env.E2E_APP) throw new Error('要 E2E_APP：win-unpacked 里的 ParaRead.exe')
const dir = process.argv[2]
const { app, win } = await launch(dir, { PARAREAD_WORD_SERVE: '1' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))

// 标题栏里挨着右边的按钮不能被系统的窗口按钮盖住：窗口按钮之外的区域是 env(titlebar-area-*)
const covered = (w) =>
  w.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:env(titlebar-area-x,0px);width:env(titlebar-area-width,100vw);top:0;height:1px'
    document.body.appendChild(probe)
    const free = probe.getBoundingClientRect().right
    probe.remove()
    const hits = [...document.querySelectorAll('button, input, .seg, [role=button]')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.top < 52 && r.right > free)
      .map(({ el }) => (el.getAttribute('title') || el.textContent || el.className).trim().slice(0, 30))
    return { free: Math.round(free), width: innerWidth, hits }
  })

try {
  const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, userData: app.getPath('userData') }))
  ok('是 Windows 上打包后的正式版', info.packaged && info.platform === 'win32', `${info.version} · ${info.platform}`)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820))
  await sleep(2000)
  ok('界面认出是 Windows', await ev(() => document.documentElement.classList.contains('platform-win')))
  ok('新数据目录先出首次引导', (await win.locator('.onb').count()) === 1)
  console.log(await shot(win, 'win-onboarding'))
  await ev((d) => window.api.setSettings({ onboarded: true, agentDir: d + '\\projects' }), dir)
  await sleep(800)

  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  ok('导入 PDF', r.status === 'added', r.paper?.title ?? r.error)
  const id = r.paper.id
  let ready = false
  for (let i = 0; i < 90 && !ready; i++) (await sleep(1000)), (ready = (await ev((x) => window.api.getPaper(x), id)).reflow.ready)
  ok('快速重排做完', ready)
  await sleep(800)
  console.log(await shot(win, 'win-library'))
  const libCover = await covered(win)
  ok('文献库：右上角的窗口按钮没盖住按钮', libCover.hits.length === 0, JSON.stringify(libCover))

  // 菜单里的快捷键提示：导入旁边的小箭头
  await win.locator('.btn.primary[title="更多导入方式"]').click()
  await sleep(500)
  const hint = await win.locator('.menu-item .h').first().innerText().catch(() => '')
  ok('菜单里的快捷键写成 Ctrl', /^Ctrl\+/.test(hint), hint)
  console.log(await shot(win, 'win-menu'))
  await win.keyboard.press('Escape')
  await sleep(300)

  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(3000)
  ok('打开论文：原文页画出来了', (await win.locator('canvas').count()) > 0)
  console.log(await shot(win, 'win-reader-pdf'))
  const readerCover = await covered(win)
  ok('阅读页：右上角的窗口按钮没盖住按钮', readerCover.hits.length === 0, JSON.stringify(readerCover))
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(3000)
  const src = await win.locator('.src').count()
  ok('对照模式：重排的正文出来了', src > 5, `${src} 段`)
  console.log(await shot(win, 'win-reader-reflow'))

  // 快捷键：Windows 上没有菜单栏，由窗口自己接
  const side = await win.locator('.sb').count()
  await win.keyboard.press('Control+Alt+S')
  await sleep(600)
  const side2 = await win.locator('.sb').count()
  await win.keyboard.press('Control+Alt+S')
  await sleep(600)
  ok('Ctrl+Alt+S 收起、放出侧栏', side2 !== side && (await win.locator('.sb').count()) === side, `${side} → ${side2} → ${await win.locator('.sb').count()}`)
  await win.keyboard.press('Control+,')
  let sw = null
  for (let i = 0; i < 20 && !sw; i++) (await sleep(300)), (sw = app.windows().find((w) => w !== win) ?? null)
  ok('Ctrl+, 打开设置', !!sw)
  if (sw) {
    await sw.waitForLoadState('domcontentloaded')
    await sleep(1500)
    console.log(await shot(sw, 'win-settings'))
    const setCover = await covered(sw)
    ok('设置：右上角的窗口按钮没盖住按钮', setCover.hits.length === 0, JSON.stringify(setCover))
    await sw.keyboard.press('Control+W')
    await sleep(800)
    ok('Ctrl+W 关掉设置', !app.windows().includes(sw))
  }

  // Word 插件的本机 HTTPS 服务：证书是 PowerShell 现生成的
  const body = await new Promise((res) => {
    const q = request({ host: '127.0.0.1', port: 27484, path: '/api/state', headers: { host: 'localhost' }, rejectUnauthorized: false, timeout: 10_000 }, (rsp) => {
      let s = ''
      rsp.on('data', (b) => (s += b))
      rsp.on('end', () => res(`${rsp.statusCode} ${s}`))
    })
    q.on('error', (e) => res(`出错 ${e.message}`))
    q.end()
  })
  ok('Word 插件的本机服务（PowerShell 生成的证书）', /^200 .*"style"/.test(body), body.slice(0, 80))
  const word = await ev(() => window.api.wordStatus())
  ok('Word 插件状态：没装 Word 也不出错', word && word.word === false && !word.error, JSON.stringify(word))
  ok('界面没有报错', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
const t0 = Date.now()
await close(app).catch((e) => fails.push(String(e)))
ok('退出', true, `${Date.now() - t0} ms`)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
