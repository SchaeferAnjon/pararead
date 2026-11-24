/**
 * API Key 存哪、怎么借（画布笔记的 AI Key、翻译和听写的 Key，画布今日、ParaRead 借画布笔记那把）。
 *
 * KeyStore：用 Electron safeStorage 加密（加密钥匙在这台 Mac 的钥匙串里），密文存在宿主给的文件，不进库、不进 Git。
 * Key 只在主进程里：界面只拿得到「有没有、最后 4 位」。真要用 Key（问一句、测试连接）时才解密，打开软件、看设置页都不碰钥匙串。
 * 加密由宿主交（Electron 的 safeStorage；单元测试给假的；端到端测试只放内存，不碰真的钥匙串），这里不碰 Electron。
 *
 * 借画布笔记那把（task-587os，设计页第 4 节「Key 借用」）：画布笔记的 Key 也是 safeStorage（Chromium 的 OSCrypt，macOS 上是「v10」开头、
 * AES-128-CBC，钥匙是钥匙串里「Canvas Notes Safe Storage」那一项的密码经 PBKDF2-SHA1（盐 saltysalt、1003 次）得来，IV 是 16 个空格），
 * 密文在画布笔记设置目录的 ai/keys.json。读那一项密码用系统的 security 命令：系统会弹一次「允许访问」，这是用户刚刚同意过的那一下。
 * 测试实例不碰钥匙串：宿主把一份假的「画布笔记那边的 Key」交进来（NotesKeys 的 test，画布今日从 CT_TEST_NOTES_KEYS 读）。
 */
import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { atomicWriteSync } from '@cn/atomic'

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/** Key 的最后 4 位（界面上「sk-••••a3f9」） */
export const keyTail = (key: string) => key.slice(-4)

/** 粘贴进来的 Key：去掉空白和引号，太短、带空格的不收 */
export function cleanKey(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Key 不对')
  const k = raw.trim().replace(/^["'`]|["'`]$/g, '').replace(/^Bearer\s+/i, '')
  if (k.length < 8 || k.length > 400 || /\s/.test(k)) throw new Error('这不像一个 API Key：粘贴完整的一串，不带空格')
  return k
}

interface Entry {
  /** 密文（base64）；只放内存时没有 */
  data?: string
  tail: string
  /** 解开过的 */
  plain?: string
}

export class KeyStore {
  private map = new Map<string, Entry>()

  /** file 或 cipher 为 null：只放内存（端到端测试） */
  constructor(
    private file: string | null,
    private cipher: Cipher | null,
  ) {
    if (!file || !cipher) return
    let raw: { v?: number; keys?: Record<string, { data?: unknown; tail?: unknown }> }
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const [id, e] of Object.entries(raw.keys ?? {})) {
      if (typeof e?.data === 'string' && typeof e.tail === 'string') this.map.set(id, { data: e.data, tail: e.tail })
    }
  }

  has(id: string): boolean {
    return this.map.has(id)
  }

  /** 用的时候才解密 */
  get(id: string): string | undefined {
    const e = this.map.get(id)
    if (!e) return undefined
    if (e.plain === undefined) e.plain = this.cipher!.decrypt(Buffer.from(e.data!, 'base64'))
    return e.plain
  }

  tail(id: string): string | undefined {
    return this.map.get(id)?.tail
  }

  set(id: string, key: string) {
    this.map.set(id, { plain: key, tail: keyTail(key), ...(this.cipher && this.file ? { data: this.cipher.encrypt(key).toString('base64') } : {}) })
    this.save()
  }

  delete(id: string) {
    this.map.delete(id)
    this.save()
  }

  private save() {
    if (!this.file || !this.cipher) return
    const keys = Object.fromEntries([...this.map].map(([id, e]) => [id, { data: e.data, tail: e.tail }]))
    mkdirSync(dirname(this.file), { recursive: true })
    atomicWriteSync(this.file, JSON.stringify({ v: 1, keys }), { mode: 0o600 })
  }
}

/** 画布笔记的设置目录（macOS）：~/Library/Application Support/canvas-notes（Electron userData，跟 package.json 的 name） */
export const notesSettingsDir = (home: string = homedir()): string => join(home, 'Library', 'Application Support', 'canvas-notes')

/** 画布笔记在钥匙串里存 safeStorage 密码的那一项 */
export const NOTES_SAFE_STORAGE = 'Canvas Notes Safe Storage'

/** Chromium OSCrypt（macOS）的解法：v10 + AES-128-CBC，钥匙 PBKDF2-SHA1(密码, saltysalt, 1003, 16)，IV 16 个空格 */
export function decryptSafeStorage(data: Buffer, password: string): string {
  if (data.subarray(0, 3).toString('latin1') !== 'v10') throw new Error('不认识的加密格式')
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([d.update(data.subarray(3)), d.final()]).toString('utf8')
}

/** 钥匙串里一项的密码（系统会弹一次「允许访问」，等用户点，最多一分钟） */
export function keychainPassword(service: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', service], { timeout: 60_000 }, (err, stdout) => (err ? reject(new Error('没读到画布笔记在钥匙串里的那一项（没允许，或者画布笔记还没存过 Key）')) : resolve(stdout.trim()))),
  )
}

/** 借画布笔记的 Key：真的读画布笔记设置目录里的 ai/keys.json；test 给了就只认它（测试实例不碰钥匙串、不读用户真的设置） */
export interface NotesKeys {
  /** 画布笔记的设置目录（notesSettingsDir()；没装画布笔记、测试时是 null） */
  dir: string | null
  /** 测试用的「画布笔记那边的 Key」：{ anthropic: 'sk-…' }，宿主从自己的环境变量读来交进来 */
  test?: Record<string, string> | null
}

/** 解析测试用的那份（JSON 字符串，坏的、没给的当没有） */
export function parseTestKeys(raw: string | undefined): Record<string, string> | null {
  if (raw === undefined) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function notesKeysFile(dir: string): { keys?: Record<string, { data?: unknown }> } | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'ai', 'keys.json'), 'utf8')) as { keys?: Record<string, { data?: unknown }> }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null
    throw e
  }
}

/** 画布笔记那边有没有这一家的 Key（只看有没有，不解） */
export function notesHasKey(o: NotesKeys, id: string): boolean {
  if (o.test) return !!o.test[id]
  if (!o.dir) return false
  return typeof notesKeysFile(o.dir)?.keys?.[id]?.data === 'string'
}

/** 解出画布笔记那把（读钥匙串会弹一次「允许访问」）；没有抛一句人话 */
export async function readNotesKey(o: NotesKeys, id: string): Promise<string> {
  if (o.test) {
    const k = o.test[id]
    if (!k) throw new Error('画布笔记里没有这一家的 Key')
    return k
  }
  if (!o.dir) throw new Error('没找到画布笔记的设置目录')
  const data = notesKeysFile(o.dir)?.keys?.[id]?.data
  if (typeof data !== 'string') throw new Error('画布笔记里没有这一家的 Key')
  return decryptSafeStorage(Buffer.from(data, 'base64'), await keychainPassword(NOTES_SAFE_STORAGE))
}
