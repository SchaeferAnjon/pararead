import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { writeQueued } from '../src'

const writeFileAtomic = (p: string, text: string) => writeQueued(p, text, { mkdir: true })

const root = mkdtempSync(join(tmpdir(), 'cn-atomic-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('先写临时文件再改名', () => {
  it('同一毫秒连写几十次：都不报错，最后一次落盘，不留临时文件', async () => {
    const p = join(root, 'a/.首页.json')
    await Promise.all(Array.from({ length: 40 }, (_, i) => writeFileAtomic(p, `第 ${i} 次\n`)))
    expect(readFileSync(p, 'utf8')).toBe('第 39 次\n')
    expect(readdirSync(join(root, 'a'))).toEqual(['.首页.json'])
  })

  it('改了又改回去（前一次还没写完）：落盘的是最后那次', async () => {
    const p = join(root, 'b.json')
    writeFileSync(p, '原样\n')
    await Promise.all([writeFileAtomic(p, '改了\n'), writeFileAtomic(p, '原样\n')])
    expect(readFileSync(p, 'utf8')).toBe('原样\n')
  })

  it('和盘上一样就不写', async () => {
    const p = join(root, 'c.json')
    writeFileSync(p, '一样\n')
    const before = statSync(p).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await writeFileAtomic(p, '一样\n')
    expect(statSync(p).mtimeMs).toBe(before)
  })
})
