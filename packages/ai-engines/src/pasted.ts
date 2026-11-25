/**
 * AI 输入框里粘贴、拖进来、「+」选的图（CN-24）：存在软件设置目录的 pasted/ 里（不进库、不进 Git），问的时候按名字读出来交给引擎
 * （EngineRun.images：Claude Code 走 stream-json 的 image 块、Codex 走 localImage 路径、API 走 base64）。
 * 画布笔记（main/pasted.ts）和画布今日（main/ai-chat.ts）共用这一份；系统选图框、界面上怎么显示由各软件自己管。
 * 名字是主进程起的 uuid（和 @cn/ai-chat/materials 的 PASTED_NAME 同一个规矩，test/pasted.test.ts 核对），不对的名字一律不读。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { atomicWrite } from '@cn/atomic'
import type { EngineImage } from './engines'

/** 一次最多带几张（和 @cn/ai-chat/paste 的 MAX_PASTED 一样） */
export const MAX_PASTED_IMAGES = 4
/** 一张最大 20 MB */
export const MAX_PASTED_BYTES = 20 * 1024 * 1024
/** pasted/ 里的文件名 */
export const PASTED_FILE = /^[0-9a-f-]{36}\.(png|jpg)$/

/** 系统选图框认的格式 */
export const PASTED_PICK_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tiff']

export class PastedImages {
  constructor(readonly dir: string) {}

  /** 存一张（PNG、JPEG，别的格式界面上已经画成 PNG），返回名字 */
  async save(bytes: unknown, mime: unknown): Promise<string> {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_PASTED_BYTES) throw new Error('这张图不对（最大 20 MB）')
    const name = `${randomUUID()}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`
    await mkdir(this.dir, { recursive: true })
    await atomicWrite(join(this.dir, name), bytes)
    return name
  }

  /**
   * 底行「+」系统选图框选到的文件：PNG、JPEG 原样存，别的格式（gif、webp、heic……）由 toPng 画成 PNG（Electron 的 nativeImage，软件自己交）；
   * 最多 room 张，返回存好的名字和文件名（材料卡上的来源）
   */
  async addFiles(paths: readonly string[], room: number, toPng: (raw: Uint8Array, file: string) => Uint8Array): Promise<{ name: string; label: string }[]> {
    const out: { name: string; label: string }[] = []
    for (const p of paths.slice(0, Math.max(0, Math.min(MAX_PASTED_IMAGES, Math.floor(room))))) {
      const raw = await readFile(p)
      if (!raw.length || raw.length > MAX_PASTED_BYTES) throw new Error(`「${basename(p)}」不对（最大 20 MB）`)
      const jpeg = /\.jpe?g$/i.test(p)
      const bytes = jpeg || /\.png$/i.test(p) ? raw : toPng(raw, basename(p))
      out.push({ name: await this.save(bytes, jpeg ? 'image/jpeg' : 'image/png'), label: basename(p) })
    }
    return out
  }

  /** 一张图在这台 Mac 上的路径；名字不对的报错，不碰别的文件 */
  path(name: unknown): string {
    if (typeof name !== 'string' || !PASTED_FILE.test(name)) throw new Error('粘贴的图不对')
    return join(this.dir, name)
  }

  /** 界面给的名字 → 交给引擎的图（名字不对、张数超了整个不收） */
  async images(names: unknown): Promise<EngineImage[]> {
    if (names === undefined) return []
    if (!Array.isArray(names) || names.length > MAX_PASTED_IMAGES) throw new Error('粘贴的图不对')
    const paths = names.map((n) => this.path(n))
    return Promise.all(
      paths.map(async (path) => ({ mime: path.endsWith('.jpg') ? ('image/jpeg' as const) : ('image/png' as const), data: (await readFile(path)).toString('base64'), path })),
    )
  }

  /** 界面上显示用的 data: 网址（没有自己的文件协议的软件用：画布今日） */
  async dataUrl(name: unknown): Promise<string> {
    const path = this.path(name)
    return `data:${path.endsWith('.jpg') ? 'image/jpeg' : 'image/png'};base64,${(await readFile(path)).toString('base64')}`
  }
}
