import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN, cmpVersion, familyView, type FamilyList, linkOn, linksJson, mergeFamily, parseFamily, parseLinks, setLinkText, type ViewInput } from '../src/index'
import { inApplications, loadList, pickInstalled, readLinks, refreshList, watchLinks, writeLink } from '../src/node'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

const NOTES_KNOWS = ['ct-open', 'pr-menu', 'pr-write', 'mc-write']
const base = (over: Partial<ViewInput> = {}): ViewInput => ({ host: 'canvas-notes', hostVersion: '0.5.2', list: BUILTIN, installed: {}, links: {}, knows: NOTES_KNOWS, lang: 'zh', vault: '我的库', ...over })

describe('名单', () => {
  it('包里的 family.json（总站放的那份）和软件带的一样：改了 list.ts 跑 pnpm --filter @cn/family gen', () => {
    expect(JSON.parse(readFileSync(join(__dirname, '../family.json'), 'utf8'))).toEqual(BUILTIN)
  })

  it('每个软件都有图标文件，联动两头都在名单里', () => {
    const icons = readdirSync(join(__dirname, '../icons'))
    for (const a of BUILTIN.apps) expect(icons, a.id).toContain(a.icon)
    const ids = BUILTIN.apps.map((a) => a.id)
    for (const l of BUILTIN.links) for (const a of l.apps) expect(ids, l.id).toContain(a)
    expect(parseFamily(JSON.parse(JSON.stringify(BUILTIN)))).toEqual(BUILTIN)
  })

  it('总站的名单样子不对的软件丢掉，整份不像就不用', () => {
    expect(parseFamily(null)).toBeNull()
    expect(parseFamily({ version: 2, updated: 'x', apps: [], links: [] })).toBeNull()
    const f = parseFamily({ version: 1, updated: '2027-01-01', apps: [{ id: 'x' }, { ...BUILTIN.apps[0], download: 'http://不安全' }, BUILTIN.apps[1]], links: [{ id: 'bad' }] })
    expect(f?.apps.map((a) => a.id)).toEqual(['canvas-today'])
    expect(f?.links).toEqual([])
  })

  it('两份合：新的说了算、按它排，旧的里多的接在后面；总站加了新软件就出现', () => {
    const remote: FamilyList = {
      version: 1,
      updated: '2027-01-01',
      apps: [{ id: 'newapp', name: { zh: '新软件' }, one: { zh: '新的' }, icon: 'newapp.png', download: 'https://new.example' }, { ...BUILTIN.apps[2]!, one: { zh: '改过的一句' } }],
      links: [],
    }
    const m = mergeFamily(BUILTIN, remote)
    expect(m.apps.map((a) => a.id).slice(0, 3)).toEqual(['newapp', 'pararead', 'canvas-notes'])
    expect(m.apps.find((a) => a.id === 'pararead')!.one.zh).toBe('改过的一句')
    expect(m.links.length).toBe(BUILTIN.links.length)
    // 总站那份旧（软件发版后总站还没更新）：软件带的说了算
    expect(mergeFamily(BUILTIN, { ...remote, updated: '2020-01-01' }).apps[0]!.id).toBe('canvas-notes')
  })

  it('版本号比大小', () => {
    expect(cmpVersion('0.10.0', '0.9.5')).toBe(1)
    expect(cmpVersion('0.1.4', '0.2.0')).toBe(-1)
    expect(cmpVersion('1.139.1-dispatch', '1.139.1')).toBe(0)
    expect(cmpVersion('1.0', '1.0.0')).toBe(0)
  })
})

describe('库里的联动开关', () => {
  it('只认 true / false，坏了当没拨过；写回去按名字排，两个软件写出来一个字不差', () => {
    expect(parseLinks('{"a":true,"b":"x","c":false}')).toEqual({ a: true, c: false })
    expect(parseLinks('{坏')).toEqual({})
    expect(parseLinks('[1]')).toEqual({})
    expect(setLinkText('{"z":true}', 'a', false)).toBe('{\n  "a": false,\n  "z": true\n}\n')
    expect(linksJson({ b: true, a: false })).toBe(setLinkText(null, 'b', true).replace('{\n  "b": true\n}', '{\n  "a": false,\n  "b": true\n}'))
  })

  it('没拨过的照名单里的默认：只多一个按钮的开、会往库里写的关', () => {
    expect(linkOn(BUILTIN, {}, 'ct-open')).toBe(true)
    expect(linkOn(BUILTIN, {}, 'pr-write')).toBe(false)
    expect(linkOn(BUILTIN, { 'ct-open': false }, 'ct-open')).toBe(false)
  })

  it('写一个只改那一个，别的原样；另一个软件看着文件，拨了就收到', async () => {
    dir = mkdtempSync(join(tmpdir(), 'family-'))
    expect(readLinks(dir)).toEqual({})
    const got: Record<string, boolean>[] = []
    const stop = watchLinks(dir, (l) => got.push(l), 50)
    expect(writeLink(dir, 'ct-open', false)).toEqual({ 'ct-open': false })
    writeLink(dir, 'cn-open', true)
    expect(readFileSync(join(dir, '.canvas-notes/联动.json'), 'utf8')).toBe('{\n  "cn-open": true,\n  "ct-open": false\n}\n')
    await expect.poll(() => got.at(-1), { timeout: 3000 }).toEqual({ 'cn-open': true, 'ct-open': false })
    stop()
  })
})

describe('装没装', () => {
  it('只认放在「应用程序」里的：项目文件夹里打包出来的、DerivedData、废纸篓里的不算', () => {
    const home = '/Users/me'
    expect(inApplications('/Applications/ParaRead.app', home)).toBe(true)
    expect(inApplications('/Applications/Setapp/X.app', home)).toBe(true)
    expect(inApplications('/Users/me/Applications/TypeRight.app', home)).toBe(true)
    expect(inApplications('/Users/me/Documents/Projects/canvas-today-public/apps/today/release/0.3.0/mac/mac-arm64/Canvas Today.app', home)).toBe(false)
    expect(inApplications('/Users/me/.Trash/Ask Free.app', home)).toBe(false)
    expect(inApplications('/Users/me/Projects/x/build/DerivedData/Build/Products/Release/GetNewWord.app', home)).toBe(false)
  })

  it('一个软件写几个身份号（改名前后）：哪个装了都算，几份取新的', () => {
    const got = pickInstalled(
      {
        'com.ankilearn.app': [{ path: '/Applications/Anki Learn.app', version: '1.0' }],
        'com.jiazonghan.pararead': [
          { path: '/Applications/ParaRead.app', version: '0.1.4' },
          { path: '/Users/me/p/release/0.1.5/mac-arm64/ParaRead.app', version: '0.1.5' },
        ],
        'com.jiazonghan.canvastoday': [{ path: '/Users/me/p/release/0.3.0/Canvas Today.app', version: '0.3.0' }],
      },
      { chatcards: ['io.github.schaeferanjon.chatcards', 'com.ankilearn.app'], pararead: ['com.jiazonghan.pararead'], 'canvas-today': ['com.jiazonghan.canvastoday'] },
      '/Users/me',
    )
    expect(got).toEqual({ chatcards: { path: '/Applications/Anki Learn.app', version: '1.0' }, pararead: { path: '/Applications/ParaRead.app', version: '0.1.4' } })
  })
})

describe('家族页上画什么', () => {
  it('画布笔记：能联动的五个在前（名单的先后），其余四个收在下面；自己不列', () => {
    const v = familyView(base())
    expect(v.linked.map((a) => a.id)).toEqual(['canvas-today', 'pararead', 'meetcaption', 'bookmarkkeeper', 'chatcards'])
    expect(v.more.map((a) => a.id)).toEqual(['askfree', 'getnewword', 'typeright', 'dispatch'])
    expect(v.linked[0]!.rows.map((r) => r.id)).toEqual(['ct-open', 'same-vault'])
  })

  it('画布今日：画布笔记一张表三行，MeetCaption 一张；ParaRead 这些收在下面', () => {
    const v = familyView(base({ host: 'canvas-today', hostVersion: '0.3.1', knows: ['cn-open', 'mc-todo'] }))
    expect(v.linked.map((a) => a.id)).toEqual(['canvas-notes', 'meetcaption'])
    expect(v.linked[0]!.rows.map((r) => r.id)).toEqual(['same-vault', 'cn-open', 'cn-look'])
    expect(v.more.map((a) => a.id)).toEqual(['pararead', 'bookmarkkeeper', 'chatcards', 'askfree', 'getnewword', 'typeright', 'dispatch'])
  })

  it('没装：开关那几行写「装了以后能开」、说明换成「装了以后：…」；链过去的照样能点', () => {
    const v = familyView(base())
    const ct = v.linked[0]!
    expect(ct.installed).toBeNull()
    expect(ct.rows[0]).toMatchObject({ right: { type: 'after' }, desc: '装了以后：待办点开能直接跳过去' })
    expect(ct.rows[1]).toMatchObject({ dot: false, right: null, desc: '装了以后：打开就认这个库，不用另外选' })
    const bk = v.linked.find((a) => a.id === 'bookmarkkeeper')!
    expect(bk.rows[0]!.right).toEqual({ type: 'go', go: 'plBook', text: '在插件里设' })
  })

  it('装了：开关照库里的（没拨过照默认），状态那行前面一颗点、库名换进去', () => {
    const v = familyView(base({ installed: { 'canvas-today': { version: '0.3.0', path: '/Applications/Canvas Today.app' } }, links: { 'ct-open': false } }))
    const ct = v.linked[0]!
    expect(ct.installed?.version).toBe('0.3.0')
    expect(ct.rows[0]!.right).toEqual({ type: 'toggle', on: false })
    expect(ct.rows[1]).toMatchObject({ dot: true, desc: '画布今日也在用「我的库」：清单里每一条就是这边笔记里的一行' })
  })

  it('版本不够写「先更新…」：那边的软件还不会、本软件的代码还不会（总站新加的联动）', () => {
    const list = mergeFamily(BUILTIN, { ...BUILTIN, updated: '2099-01-01', links: [...BUILTIN.links, { id: 'future', apps: ['canvas-notes', 'pararead'], kind: 'toggle', pic: 'prnote', in: { 'canvas-notes': { label: { zh: '以后的' }, desc: { zh: '以后' } } } }] })
    const v = familyView(base({ list, installed: { pararead: { version: '0.1.4', path: '/Applications/ParaRead.app' } } }))
    const pr = v.linked.find((a) => a.id === 'pararead')!
    expect(pr.rows.map((r) => r.right)).toEqual([
      { type: 'toggle', on: true },
      { type: 'update', who: 'pararead', name: 'ParaRead' },
      { type: 'update', who: 'canvas-notes', name: '画布笔记' },
    ])
  })

  it('英文：缺英文的用中文；ParaRead 找不到库时开关写「先在画布笔记里开一个库」', () => {
    const v = familyView(base({ host: 'pararead', hostVersion: '0.1.5', knows: ['pr-menu'], lang: 'en', vault: null, installed: { 'canvas-notes': { version: '0.5.1', path: '/Applications/Canvas Notes.app' } } }))
    expect(v.linked.map((a) => a.id)).toEqual(['canvas-notes'])
    expect(v.linked[0]!.name).toBe('Canvas Notes')
    expect(v.linked[0]!.rows[0]!.right).toEqual({ type: 'novault' })
    expect(v.more.find((a) => a.id === 'meetcaption')!.name).toBe('MeetCaption')
  })
})

describe('每天看一次总站', () => {
  it('没看成过用软件带的；看成了存起来，一天之内不再看；总站没有（404）、没网不报错', async () => {
    dir = mkdtempSync(join(tmpdir(), 'family-'))
    const cache = join(dir, 'family.json')
    expect(loadList(cache)).toEqual({ list: BUILTIN, checkedAt: null })
    const remote = { ...BUILTIN, updated: '2099-01-01', apps: [...BUILTIN.apps, { id: 'newapp', name: { zh: '新软件' }, one: { zh: '新的' }, icon: 'x.png', download: 'https://n.example' }] }
    const real = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (url: string) => {
      calls++
      if (String(url).includes('404')) return new Response('no', { status: 404 })
      if (String(url).includes('down')) throw new TypeError('fetch failed')
      return new Response(JSON.stringify(remote), { status: 200 })
    }) as typeof fetch
    try {
      expect(await refreshList(cache, 1000, { url: 'https://h/404' })).toBe(false)
      expect(await refreshList(cache, 1000, { url: 'https://h/down' })).toBe(false)
      expect(loadList(cache).checkedAt).toBeNull()
      expect(await refreshList(cache, 2000, { url: 'https://h/ok' })).toBe(true)
      expect(loadList(cache)).toMatchObject({ checkedAt: 2000 })
      expect(loadList(cache).list.apps.at(-1)!.id).toBe('newapp')
      calls = 0
      expect(await refreshList(cache, 2000 + 60_000, { url: 'https://h/ok' })).toBe(false)
      expect(calls).toBe(0)
      expect(await refreshList(cache, 2000 + 25 * 3600_000, { url: 'https://h/ok' })).toBe(true)
    } finally {
      globalThis.fetch = real
    }
    writeFileSync(cache, '{坏')
    expect(loadList(cache).checkedAt).toBeNull()
  })
})

it('packages/family 的纯数据那一半不依赖 Electron、Node 模块和别的包（iPad 版照着移植）', () => {
  for (const f of ['index.ts', 'list.ts']) {
    const code = readFileSync(join(__dirname, '../src', f), 'utf8')
    expect(code, f).not.toMatch(/from ['"](electron|node:|fs|path|child_process|@cn\/)/)
  }
  expect(readFileSync(join(__dirname, '../src/node.ts'), 'utf8')).not.toMatch(/from ['"]electron/)
})
