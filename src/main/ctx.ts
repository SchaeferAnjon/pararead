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
  /** 画布笔记联动（cnLink.ts）：讲解好了、问答答完时写进库里的配对笔记 */
  cn: { explained: (annId: string) => void; chatChanged: (paperId: string) => void; readTime: (paperId: string, ms: number) => void }
}
