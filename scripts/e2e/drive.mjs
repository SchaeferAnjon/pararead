// 端到端驱动：用 playwright 的 _electron 启动开发构建（先 npm run build），数据放隔离目录（--data-dir），不碰真实文献库。
// 用法见 scripts/e2e/smoke.mjs。原生右键菜单 playwright 点不到：菜单栏命令用 app.evaluate 调菜单项的 click()，
// 右键菜单里的动作直接调 window.api 的同一个接口。
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// playwright 用全局装的那份（npm i -g playwright）
const require = createRequire(process.env.PLAYWRIGHT_ROOT ?? '/opt/homebrew/lib/node_modules/')
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
    args: packaged ? [`--data-dir=${dataDir}`] : [`${ROOT}/out/main/index.js`, `--data-dir=${dataDir}`],
    cwd: ROOT,
    // 界面语言固定简体中文（脚本按中文文案找按钮）；要截别的语言传 PARAREAD_UI_LANG
    env: { PARAREAD_UI_LANG: 'zh', ...process.env, ...env },
    timeout: 60000
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
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
