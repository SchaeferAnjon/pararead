// 自动更新（electron-updater，查 GitHub Release 的 latest-mac.yml），照会议字幕：启动 30 秒后查一次，之后每 6 小时一次；
// 有新版在后台下载，下好了告诉界面（设置「关于」里提示「重启更新」），用户点了才重启；不点也行，下次退出时自动装上。
// Mac 上新版要和装着的版本用同一张 Developer ID 证书签名，Squirrel.Mac 才肯换。electron-updater 下完 zip 就报 update-downloaded，
// 这时 Squirrel 还没取包、没验签：等 Electron 自己的 autoUpdater 也报 update-downloaded 才算 ready。
import { autoUpdater as nativeUpdater } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
const FIRST_CHECK_MS = 30_000
const EVERY_MS = 6 * 3600_000

export interface UpdateState {
  phase: 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error'
  version: string
  percent: number
  error: string
  checkedAt: number
}

export class Updater {
  state: UpdateState
  private timer: ReturnType<typeof setTimeout> | null = null

  /** supported：打包后的正式版才更新（开发版、源码运行不更新）；enabled()：设置里的「自动检查更新」 */
  constructor(
    private supported: boolean,
    private enabled: () => boolean,
    private onState: (s: UpdateState) => void
  ) {
    this.state = { phase: supported ? 'idle' : 'off', version: '', percent: 0, error: '', checkedAt: 0 }
    if (!supported) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking', error: '' }))
    autoUpdater.on('update-available', (info) => this.set({ phase: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('update-not-available', () => this.set({ phase: 'latest', checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) => this.set({ phase: 'downloading', percent: Math.floor(p.percent ?? 0) }))
    let staged = false
    let pending: Partial<UpdateState> | null = null
    nativeUpdater.on('update-downloaded', () => {
      staged = true
      if (pending) this.set({ phase: 'ready', ...pending })
    })
    autoUpdater.on('update-downloaded', (info) => {
      const done = { version: info.version, percent: 100, checkedAt: Date.now() }
      if (process.platform !== 'darwin' || staged) this.set({ phase: 'ready', ...done })
      else ((pending = done), this.set({ phase: 'downloading', ...done }))
    })
    autoUpdater.on('error', (e) => {
      // 下好以后再出的错（比如又查了一次没网）不盖掉「已下载」
      if (this.state.phase === 'ready') return
      this.set({ phase: 'error', error: String(e?.message ?? e).split('\n')[0], checkedAt: Date.now() })
    })
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  start(): void {
    if (!this.supported) return
    if (this.timer) clearTimeout(this.timer)
    const loop = (): void => {
      if (this.enabled() && !['checking', 'downloading', 'ready'].includes(this.state.phase)) this.check().catch(() => {})
      this.timer = setTimeout(loop, EVERY_MS)
    }
    this.timer = setTimeout(loop, FIRST_CHECK_MS)
  }

  /** 查一次（设置里的「检查更新」也走这里） */
  async check(): Promise<UpdateState> {
    if (!this.supported || ['checking', 'downloading', 'ready'].includes(this.state.phase)) return this.state
    await autoUpdater.checkForUpdates().catch(() => {})
    return this.state
  }

  /** 已下载好的新版：退出、装上、重新打开 */
  install(): boolean {
    if (this.state.phase !== 'ready') return false
    autoUpdater.quitAndInstall(true, true)
    return true
  }
}
