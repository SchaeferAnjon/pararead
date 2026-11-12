// 装好的正式版从头走一遍（新用户的路）：首次引导 5 步（自带 Key 真填真验证）→ 导入一篇 → 文献库 → 阅读页对照翻译 → 问 AI →
// 设置的「关于」→ 用「打开方式」再送一个 PDF 进来 → 退出。数据放隔离目录，不碰真实文献库。
//   E2E_APP="/Applications/ParaRead.app/Contents/MacOS/ParaRead" KEY=$(dispatch env get DEEPSEEK_API_KEY) \
//     node scripts/e2e/packaged.mjs <新的数据目录> [第二个 PDF]
import { execFileSync } from 'node:child_process'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

if (!process.env.E2E_APP) throw new Error('要 E2E_APP：装好的 .app 里的可执行文件')
const [dir, second] = process.argv.slice(2)
// 从访达打开的应用拿不到终端里的环境变量：把服务商 Key 的环境变量清掉，Key 在引导里手填
const { app, win } = await launch(dir, { DEEPSEEK_API_KEY: '', ZHIPU_API_KEY: '', OPENAI_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
const ok = (name, cond, extra = '') => console.log(`${cond ? '✓' : '✗'} ${name}${extra ? `：${extra}` : ''}`)
try {
  const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData'), exe: process.execPath }))
  ok('是打包后的正式版', info.packaged, `${info.version} · ${info.exe}`)
  ok('数据在隔离目录', info.userData.startsWith(dir), info.userData)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820))
  await sleep(1500)
  await ev((d) => window.api.setSettings({ agentDir: d + '/agent' }), dir)

  // 1 欢迎
  ok('新数据目录先出首次引导', (await win.locator('.onb').count()) === 1)
  await shot(win, 'pkg-onb-1')
  await win.locator('.of .btn.primary').click()
  // 2 AI：自带 Key，填 DeepSeek 的 Key，点验证
  // 点卡片左上角：卡片展开后正中间是服务商按钮，点中间会换服务商
  await win.locator('.choice', { hasText: '自带 Key' }).first().click({ position: { x: 16, y: 16 } })
  await sleep(300)
  const s0 = await ev(() => window.api.getSettings())
  ok('默认服务商是 DeepSeek，没有现成的 Key', s0.provider === 'deepseek' && s0.apiKeySource === 'none', `${s0.provider} · ${s0.apiKeySource}`)
  await win.locator('.choice.on input.input').fill(process.env.KEY ?? '')
  await win.locator('.choice.on .btn', { hasText: '验证' }).click()
  await win.locator('.choice.on .ok-t').waitFor({ timeout: 30000 })
  ok('Key 验证可用', true, (await win.locator('.choice.on .ok-t').innerText()).trim())
  await win.locator('.of .btn.primary').click()
  await sleep(400)
  // 3 语言
  await shot(win, 'pkg-onb-3')
  await win.locator('.of .btn.primary').click()
  await sleep(600)
  // 4 重排
  await shot(win, 'pkg-onb-4')
  const mi = await ev(() => window.api.mineruInstallState())
  ok('重排引擎状态', true, `${mi.phase}${mi.percent ? ` ${mi.percent}%` : ''}`)
  await win.locator('.of .btn.primary').click()
  await sleep(600)
  // 5 导入（文件对话框点不了，走同一个接口）
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  ok('导入测试论文', r.status === 'added' || r.status === 'exists', r.status)
  await win.locator('.of .btn.primary', { hasText: '打开文献库' }).click()
  await sleep(1500)
  ok('进了文献库', (await win.locator('.row').count()) === 1 && (await ev(() => window.api.getSettings())).onboarded)

  // 文献库 → 阅读页
  const id = r.paper.id
  let ready = false
  for (let i = 0; i < 90 && !ready; i++) (await sleep(1000), (ready = (await ev((x) => window.api.getPaper(x), id)).reflow.ready))
  ok('快速重排完成', ready)
  await win.locator('.row').first().click()
  await sleep(800)
  await shot(win, 'pkg-library')
  await win.locator('.row').first().dblclick()
  await sleep(2000)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  let trs = 0
  for (let i = 0; i < 40 && trs < 5; i++) (await sleep(1000), (trs = await win.locator('.tr-text').count()))
  ok('对照模式出译文', trs >= 5, `${trs} 段`)
  await shot(win, 'pkg-reader')
  // 问 AI：真在输入框里打字、回车
  await win.locator('.inbox textarea').last().fill('这篇论文解决什么问题？一句话')
  await win.keyboard.press('Enter')
  let ans = ''
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    ans = (await win.locator('.msg-ai').last().innerText().catch(() => '')).trim()
    if (ans.length > 20 && (await win.locator('.inbox .send.stop').count()) === 0) break
  }
  ok('AI 回答', ans.length > 20, ans.slice(0, 60).replace(/\n/g, ' '))
  await shot(win, 'pkg-ai')

  // 设置 · 关于：版本号、检查更新
  const opened = app.waitForEvent('window', { timeout: 5000 }).catch(() => null)
  await ev(() => window.api.openSettings('about'))
  const sw = (await opened) ?? app.windows().find((w) => w !== win)
  await sw.waitForLoadState('domcontentloaded')
  await sleep(1000)
  await sw.locator('.btn', { hasText: '检查更新' }).first().click().catch(() => {})
  await sleep(6000)
  const up = await ev(() => window.api.updateStatus())
  ok('检查更新有结果（发布仓库还没建，应该报错而不是卡住）', ['error', 'latest', 'downloading', 'ready'].includes(up.phase), `${up.phase} ${up.error ?? ''}`.slice(0, 140))
  await shot(sw, 'pkg-about')
  await sw.close()

  // 打开方式：系统把文件交给已经开着的这个实例
  if (second) {
    execFileSync('/usr/bin/open', ['-a', process.env.E2E_APP.replace(/\/Contents\/MacOS\/.*$/, ''), second])
    let n = 1
    for (let i = 0; i < 20 && n < 2; i++) (await sleep(1000), (n = (await ev(() => window.api.listPapers())).length))
    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))
    ok('「打开方式」送来的 PDF 进了库并打开', n >= 2, `库里 ${n} 篇 · 窗口 ${titles.join(' / ')}`)
    await sleep(1500)
    await shot(win, 'pkg-open-with')
  }
  ok('界面没有报错', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  const t0 = Date.now()
  await close(app)
  console.log(`✓ 退出用了 ${Date.now() - t0} ms`)
}
