// 借画布笔记的 Key（画布今日、ParaRead 照这个接）：解 safeStorage 的密文、看画布笔记那边有没有、测试实例只认交进来的那份
import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { decryptSafeStorage, notesHasKey, notesSettingsDir, parseTestKeys, readNotesKey } from '../src/keys'

const dir = mkdtempSync(join(tmpdir(), 'cn-notes-keys-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** 照 Chromium OSCrypt（macOS）加密：v10 + AES-128-CBC */
function encryptLikeChromium(plain: string, password: string): Buffer {
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  const c = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10', 'latin1'), c.update(plain, 'utf8'), c.final()])
}

describe('借画布笔记的 Key', () => {
  it('解得开 safeStorage 加密的 Key；不是 v10 开头的不认', () => {
    expect(decryptSafeStorage(encryptLikeChromium('sk-ant-密钥-12345678', 'pw'), 'pw')).toBe('sk-ant-密钥-12345678')
    expect(() => decryptSafeStorage(Buffer.from('v11xxxx'), 'pw')).toThrow('不认识的加密格式')
  })

  it('画布笔记的设置目录', () => {
    expect(notesSettingsDir('/Users/x')).toBe('/Users/x/Library/Application Support/canvas-notes')
  })

  it('看画布笔记那边有没有：读 ai/keys.json 里有没有密文，不解；目录没有、文件坏了都当没有', () => {
    expect(notesHasKey({ dir: null }, 'anthropic')).toBe(false)
    expect(notesHasKey({ dir }, 'anthropic')).toBe(false)
    mkdirSync(join(dir, 'ai'), { recursive: true })
    writeFileSync(join(dir, 'ai', 'keys.json'), '{坏的')
    expect(notesHasKey({ dir }, 'anthropic')).toBe(false)
    writeFileSync(join(dir, 'ai', 'keys.json'), JSON.stringify({ v: 1, keys: { anthropic: { data: 'djEw', tail: '5678' } } }))
    expect(notesHasKey({ dir }, 'anthropic')).toBe(true)
    expect(notesHasKey({ dir }, 'openai')).toBe(false)
  })

  it('测试实例只认交进来的那份，不读文件、不碰钥匙串', async () => {
    const test = parseTestKeys('{"anthropic":"sk-test-1234"}')
    expect(notesHasKey({ dir, test }, 'anthropic')).toBe(true)
    expect(notesHasKey({ dir, test: {} }, 'anthropic')).toBe(false)
    expect(await readNotesKey({ dir, test }, 'anthropic')).toBe('sk-test-1234')
    await expect(readNotesKey({ dir, test }, 'openai')).rejects.toThrow('画布笔记里没有这一家的 Key')
    expect(parseTestKeys(undefined)).toBeNull()
    expect(parseTestKeys('坏的')).toEqual({})
  })

  it('真的读：没有设置目录、没有这一家都说清楚（不去碰钥匙串）', async () => {
    await expect(readNotesKey({ dir: null }, 'anthropic')).rejects.toThrow('没找到画布笔记的设置目录')
    await expect(readNotesKey({ dir }, 'openai')).rejects.toThrow('画布笔记里没有这一家的 Key')
  })
})
