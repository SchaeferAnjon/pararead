import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PASTED_NAME } from '../../ai-chat/src/materials'
import { MAX_PASTED_IMAGES, PASTED_FILE, PastedImages } from '../src/pasted'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pasted-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('名字的规矩、张数上限和界面那边（@cn/ai-chat）一样', () => {
  expect(PASTED_FILE.source).toBe(PASTED_NAME.source)
  // paste.ts 引了 DOM（createImageBitmap），这个包的 tsconfig 不带 DOM：读原文核对
  const paste = readFileSync(join(__dirname, '../../ai-chat/src/paste.ts'), 'utf8')
  expect(paste).toContain(`export const MAX_PASTED = ${MAX_PASTED_IMAGES}`)
})

it('存一张、按名字读回来交给引擎：字节原样，PNG / JPEG 认得对', async () => {
  const s = new PastedImages(join(tmp(), 'pasted'))
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
  const jpg = new Uint8Array([255, 216, 255, 9])
  const a = await s.save(png, 'image/png')
  const b = await s.save(jpg, 'image/jpeg')
  expect(a).toMatch(PASTED_FILE)
  expect(b.endsWith('.jpg')).toBe(true)
  const got = await s.images([a, b])
  expect(got.map((g) => g.mime)).toEqual(['image/png', 'image/jpeg'])
  expect([...Buffer.from(got[0]!.data, 'base64')]).toEqual([...png])
  expect(readFileSync(got[1]!.path)).toEqual(Buffer.from(jpg))
  expect(await s.dataUrl(a)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
  expect(await s.images(undefined)).toEqual([])
})

it('不对的名字、超了张数、空的和太大的图不收，不读别的文件', async () => {
  const s = new PastedImages(tmp())
  await expect(s.images(['../settings.json'])).rejects.toThrow('粘贴的图不对')
  await expect(s.images('x')).rejects.toThrow('粘贴的图不对')
  const n = await s.save(new Uint8Array([1]), 'image/png')
  await expect(s.images([n, n, n, n, n])).rejects.toThrow('粘贴的图不对')
  expect(() => s.path('a/b.png')).toThrow('粘贴的图不对')
  await expect(s.save(new Uint8Array(), 'image/png')).rejects.toThrow('这张图不对')
  await expect(s.save('png', 'image/png')).rejects.toThrow('这张图不对')
})

it('选图框选到的文件：PNG、JPEG 原样，别的格式交给 toPng，最多 room 张，来源是文件名', async () => {
  const d = tmp()
  const s = new PastedImages(join(d, 'pasted'))
  const files = ['课表.png', '通知.JPG', '动图.gif'].map((f, i) => {
    const p = join(d, f)
    writeFileSync(p, Buffer.from([i + 1, i + 2]))
    return p
  })
  const conv: string[] = []
  const got = await s.addFiles(files, 4, (raw, file) => (conv.push(file), new Uint8Array([9, ...raw])))
  expect(got.map((g) => g.label)).toEqual(['课表.png', '通知.JPG', '动图.gif'])
  expect(got[1]!.name.endsWith('.jpg')).toBe(true)
  expect(conv).toEqual(['动图.gif'])
  const imgs = await s.images(got.map((g) => g.name))
  expect([...Buffer.from(imgs[2]!.data, 'base64')]).toEqual([9, 3, 4])
  expect(await s.addFiles(files, 1, (r) => r)).toHaveLength(1)
})
