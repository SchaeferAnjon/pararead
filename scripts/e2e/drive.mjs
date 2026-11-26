// 端到端驱动：用 playwright 的 _electron 启动开发构建（先 npm run build），数据放隔离目录（--data-dir），不碰真实文献库。
// 在 macOS 上带 E2E=1 启动（测试模式，见 src/main/testMode.ts）：窗口不出现在屏幕上、不抢焦点，访达、打开面板、右键菜单只记到 globalThis.srScreen。
// 用法见 scripts/e2e/smoke.mjs。原生右键菜单 playwright 点不到：菜单栏命令用 app.evaluate 调菜单项的 click()，
// 右键菜单里的动作直接调 window.api 的同一个接口。
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// playwright 用工作区里装的那份（devDependencies，和画布笔记的 @playwright/test 同一版）；PLAYWRIGHT_ROOT 能指到别处的
const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? import.meta.url)
const { _electron } = require('playwright')

// fileURLToPath：Windows 上 URL 的 pathname 是 /D:/…，当不了工作目录
export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '')
export const SHOTS = process.env.E2E_SHOTS ?? `${ROOT}/tmp/shots`
// 测试论文：E2E_PAPER=<一篇双栏英文论文的 PDF>。smoke、onboarding、packaged 这几个脚本要它
export const PAPER = process.env.E2E_PAPER ?? ''
mkdirSync(SHOTS, { recursive: true })

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch(dir, env = {}) {
  const dataDir = resolve(dir) // --data-dir 要绝对路径
  mkdirSync(dataDir, { recursive: true })
  // E2E_APP=装好的 .app 里的可执行文件（/Applications/ParaRead.app/Contents/MacOS/ParaRead）时测打包后的正式版
  const packaged = process.env.E2E_APP
  const app = await _electron.launch({
    executablePath: packaged ?? `${ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
    // E2E_MAIN=<另一份构建的 main/index.js>（放在 apps/pararead 里面，好找到 node_modules）：量改前改后时跑改前那份
    args: packaged ? [`--data-dir=${dataDir}`] : [process.env.E2E_MAIN ?? `${ROOT}/out/main/index.js`, `--data-dir=${dataDir}`],
    cwd: ROOT,
    // 界面语言固定简体中文（脚本按中文文案找按钮）；要截别的语言传 PARAREAD_UI_LANG
    // 测试模式只在 macOS 上开：Windows 上从不显示的窗口截不了图（CI 是 GitHub 的机器，照旧显示窗口）
    env: { PARAREAD_UI_LANG: 'zh', ...process.env, ...(process.platform === 'darwin' ? { E2E: '1' } : {}), ...env },
    timeout: 60000
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // E2E_OFFSCREEN=1：测试窗口挪到屏幕外，不挡正在用这台电脑的人（截图照样能拍）
  if (process.env.E2E_OFFSCREEN) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.setPosition(-3000, 60)))
  return { app, win }
}

export async function shot(win, name) {
  const f = `${SHOTS}/${name}.png`
  await win.screenshot({ path: f })
  return f
}

// 退出：走 app.quit()，10 秒没退就杀掉并报错（退出卡住本身就是 bug）
export async function close(app) {
  const pid = app.process().pid
  app.evaluate(({ app }) => app.quit()).catch(() => {})
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
  }
  process.kill(pid, 'SIGKILL')
  throw new Error('应用 10 秒没退出')
}
