import type { Ai } from './ai'
import type { DB } from './db'
import type { Library } from './library'
import type { SettingsStore } from './settings'
import type { Streamer } from './stream'
import type { Translator } from './translate'

// 各个 IPC 模块共用的东西，index.ts 建好传进来
export interface Ctx {
  db: DB
  dataDir: string
  library: Library
  settings: SettingsStore
  ai: Ai
  translator: Translator
  broadcast: (channel: string, payload: unknown) => void
  log: (msg: string) => void
  enqueueReflow: (paperId: string, tiers?: ('flash' | 'basic')[], args?: string[]) => void
  afterImport: (paperId: string) => void
  mainWindow: () => Electron.BrowserWindow | null
  streamer: Streamer
}
