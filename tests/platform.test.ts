import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { winKbd } from '../src/shared/kbd'
import { keyMatches, winAcc } from '../src/main/platform'
import { findZoteroDir } from '../src/main/zotero'

describe('Windows 上的写法', () => {
  it('快捷键提示换成 Ctrl', () => {
    expect(winKbd('⌘O')).toBe('Ctrl+O')
    expect(winKbd('⇧⌘F')).toBe('Ctrl+Shift+F')
    expect(winKbd('{0} 条 · ⌘↩ 导入')).toBe('{0} 条 · Ctrl+Enter 导入')
    expect(winKbd('上一个 ⇧↩')).toBe('上一个 Shift+Enter')
    expect(winKbd('⌘Z 撤销')).toBe('Ctrl+Z 撤销')
  })

  it('菜单快捷键换成 Windows 的，按键对得上', () => {
    expect(winAcc('Cmd+O')).toBe('Ctrl+O')
    expect(winAcc('Shift+Cmd+F')).toBe('Shift+Ctrl+F')
    expect(winAcc('Ctrl+Cmd+S')).toBe('Ctrl+Alt+S')
    const k = (key: string, mods: Partial<{ control: boolean; shift: boolean; alt: boolean }> = {}) => ({ type: 'keyDown', key, control: false, shift: false, alt: false, ...mods })
    expect(keyMatches(k('F', { control: true, shift: true }), 'Shift+Ctrl+F')).toBe(true)
    expect(keyMatches(k('f', { control: true }), 'Shift+Ctrl+F')).toBe(false)
    expect(keyMatches(k(',', { control: true }), 'Ctrl+,')).toBe(true)
    expect(keyMatches(k('-', { control: true }), 'Ctrl+-')).toBe(true)
    expect(keyMatches(k('s', { control: true, alt: true }), 'Ctrl+Alt+S')).toBe(true)
    expect(keyMatches({ ...k('o', { control: true }), type: 'keyUp' }, 'Ctrl+O')).toBe(false)
  })
})

describe('Windows 上的 Zotero', () => {
  let dir = ''
  const app = process.env.APPDATA
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (app === undefined) delete process.env.APPDATA
    else process.env.APPDATA = app
  })
  it('在 %APPDATA%\\Zotero\\Zotero\\Profiles 里找用户改过的数据目录', () => {
    dir = mkdtempSync(join(tmpdir(), 'pr-zot-'))
    const data = join(dir, 'MyZotero')
    mkdirSync(data)
    writeFileSync(join(data, 'zotero.sqlite'), '')
    const prof = join(dir, 'Roaming', 'Zotero', 'Zotero', 'Profiles', 'abc.default')
    mkdirSync(prof, { recursive: true })
    writeFileSync(join(prof, 'prefs.js'), `user_pref("extensions.zotero.dataDir", "${data}");\nuser_pref("extensions.zotero.useDataDir", true);\n`)
    process.env.APPDATA = join(dir, 'Roaming')
    expect(findZoteroDir(join(dir, 'home'), true)).toBe(data)
  })
})
