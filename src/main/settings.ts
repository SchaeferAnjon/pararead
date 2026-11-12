import { chmodSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { providerOf } from '../shared/providers'
import type { Settings, SettingsView } from '../shared/types'

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepseek',
  keys: {},
  customBaseUrl: '',
  textModel: 'deepseek-flash',
  visionModel: 'deepseek-flash',
  targetLang: '简体中文',
  mineruPath: join(homedir(), '.mineru-venv/bin/mineru-kit'),
  theme: 'system',
  readSize: 18,
  srcFont: 'serif',
  display: 'both',
  trStyle: 'text',
  leftW: 260,
  rightW: 380,
  leftCollapsed: false,
  rightCollapsed: false,
  libSideW: 220,
  lastColor: 'yellow',
  pdfInvert: false,
  libView: 'table',
  libSort: { key: 'opened', desc: true },
  libFilter: 'all',
  titleTr: 'off',
  recentSearches: [],
  zoteroDir: null,
  aiLang: '',
  chatSize: 14,
  chatFloat: false,
  thinking: false,
  agentDir: '',
  syncEnabled: false,
  syncDir: '',
  syncDevice: '',
  uiLang: 'auto',
  onboarded: false,
  autoUpdate: true,
  wordStyle: 'gbt',
  wordCheck: true
}

// 设置文件明文存放，权限 0600。不用 safeStorage：没正式签名的应用每次读都会弹钥匙串框。
export class SettingsStore {
  private data: Settings
  constructor(private file: string) {
    this.data = { ...DEFAULT_SETTINGS }
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings> & { apiKey?: string }
      // 0.1 只有智谱 Coding Plan 一家：旧的 apiKey 挪进 keys
      if (parsed.apiKey !== undefined && !parsed.provider) {
        parsed.provider = 'zhipu-coding'
        parsed.keys = { 'zhipu-coding': parsed.apiKey }
      }
      delete parsed.apiKey
      // 加首次引导之前就在用的：不再弹引导
      if (parsed.onboarded === undefined) parsed.onboarded = true
      this.data = { ...DEFAULT_SETTINGS, ...parsed }
      chmodSync(file, 0o600)
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  set(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch }
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
    chmodSync(this.file, 0o600)
    return this.get()
  }

  // Key 读取顺序：设置文件里这家服务的值，没有就读这家的环境变量（如 DEEPSEEK_API_KEY）
  apiKey(provider = this.data.provider): { key: string; source: 'settings' | 'env' | 'none'; env: string } {
    const env = providerOf(provider).env ?? ''
    if (this.data.keys[provider]) return { key: this.data.keys[provider], source: 'settings', env }
    const v = env ? (process.env[env] ?? '') : ''
    if (v) return { key: v, source: 'env', env }
    return { key: '', source: 'none', env }
  }

  setKey(key: string, provider = this.data.provider): void {
    this.set({ keys: { ...this.data.keys, [provider]: key } })
  }

  view(): SettingsView {
    const { keys: _omit, ...rest } = this.data
    const k = this.apiKey()
    return { ...rest, apiKeyMasked: maskKey(k.key), apiKeySource: k.source, apiKeyEnv: k.env, mineruInstalled: existsSync(this.data.mineruPath) }
  }
}

export function maskKey(key: string): string {
  if (!key) return ''
  return '••••••••' + key.slice(-4)
}
