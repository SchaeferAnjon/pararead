import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 测试模式（E2E=1）：应用照常跑，但不占用户的屏幕，也不碰用户的数据。
 * 窗口从不显示（show、showInactive、focus 都不真做），全透明、鼠标穿透、被系统挪回屏幕就再挪出去，程序坞里不出图标；
 * 页面照常渲染，Playwright 经 CDP 点按、打字、截图都不受影响。
 * 访达、浏览器、打开 / 存储面板、提示框、右键菜单都不真弹，只记到 globalThis.srScreen（测试要用哪个，在 app.evaluate 里自己再换掉）。
 * 没给 --data-dir 时数据放临时目录；不注册 pararead:// 链接（会把正式版的小书签抢过来）；iCloud 同步不跑（除非设置里指定了别的同步目录）。
 */
export const E2E = process.env.E2E === '1'

/** 没给 --data-dir 时的数据目录：临时目录，不碰 ~/Library/Application Support 里的真文献库 */
export const e2eDataDir = (): string => mkdtempSync(join(tmpdir(), 'pararead-e2e-'))

export function guardScreen(): void {
  if (!E2E) return
  const g = globalThis as unknown as { srScreen: string[] }
  g.srScreen = []
  const skip = (what: string): void => {
    g.srScreen.push(what)
    console.log(`[测试模式] 没真的做：${what}`)
  }

  // 窗口：不显示、不抢焦点。放在屏幕外还不够（macOS 会把整个在屏幕外的窗口拉回来，改大小时尤其会），所以再加全透明、鼠标穿透
  BrowserWindow.prototype.show = function (this: BrowserWindow) {
    skip(`显示窗口 ${this.getTitle()}`)
  }
  BrowserWindow.prototype.showInactive = function (this: BrowserWindow) {
    skip(`显示窗口 ${this.getTitle()}`)
  }
  BrowserWindow.prototype.focus = function () {}
  BrowserWindow.prototype.moveTop = function () {}
  app.focus = () => {}
  if (app.dock) app.dock.show = async () => {}
  app.on('browser-window-created', (_e, w) => {
    w.setOpacity(0)
    w.setIgnoreMouseEvents(true)
    w.webContents.setBackgroundThrottling(false) // 看不见的窗口也照常渲染、跑定时器，截图才不会卡住
    const park = (): void => {
      if (w.isDestroyed()) return
      const b = w.getBounds()
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.bounds
        return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
      })
      if (onScreen) w.setPosition(-20000, 80)
    }
    w.on('move', park)
    w.on('resize', park)
    w.on('show', park)
  })
  void app.whenReady().then(() => app.dock?.hide())

  shell.showItemInFolder = (p) => skip(`在访达中显示 ${p}`)
  shell.openExternal = async (url) => skip(`用浏览器打开 ${url}`)
  shell.openPath = async (p) => {
    skip(`打开 ${p}`)
    return ''
  }
  dialog.showOpenDialog = (async () => {
    skip('打开面板')
    return { canceled: true, filePaths: [] }
  }) as typeof dialog.showOpenDialog
  dialog.showSaveDialog = (async () => {
    skip('存储面板')
    return { canceled: true, filePath: '' }
  }) as typeof dialog.showSaveDialog
  dialog.showMessageBox = (async () => {
    skip('提示框')
    return { response: 0, checkboxChecked: false }
  }) as typeof dialog.showMessageBox
  dialog.showErrorBox = (title) => skip(`出错框 ${title}`)
  // 右键菜单：只记下来，callback 照常回（选了「没选」），等着菜单关掉的 IPC 不会卡住
  Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
    skip(`右键菜单（${this.items.map((i) => i.label).filter(Boolean).join('、')}）`)
    if (opts?.callback) setTimeout(opts.callback, 0)
  }
}
