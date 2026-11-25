// ParaRead × 画布笔记联动（src/main/cnLink.ts、src/shared/cnLink.ts）：库里那篇配对笔记是唯一一份。
// 用一个临时「画布笔记库」（真 git 仓库）和内存里的数据库，读写都用画布笔记读同一篇用的 @cn/format 核对。
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFUSED, DEFAULT_KINDS, DOUBT_MARK, highlightsOf, kindsJson, KINDS_FILE, openConfused, parseReadAt, parseReadingNote, prop, READ_AT_FILE, upsertHighlight } from '@cn/format'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => tmpdir() }
}))

import { CnLink } from '../src/main/cnLink'
import { getAnnotation, listAnnotations, openDb, saveAnnotation, type DB } from '../src/main/db'
import { annOfHl, cnFilter, inCnFolder, kindOf, parseCnFilter, rectOf, reconcile, shareable, withKind } from '../src/shared/cnLink'
import type { Annotation, CnVault } from '../src/shared/types'
import type { Ctx } from '../src/main/ctx'

const PDF = '课程/ecp/Paper One.pdf'
const NOTE = '课程/ecp/Paper One 笔记.md'

let dir: string
let vault: string
let data: string
let db: DB
let cn: CnLink
let settings: { cnVaults: CnVault[]; cnLastPlace: { root: string; folder: string } | null }

const git = (...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' })

function addPaper(id: string, hash: string, link: { root: string; path: string } | null, extra: Record<string, unknown> = {}): void {
  db.prepare("INSERT INTO papers (id, title, authors, tags, file_name, file_hash, page_count, created_at, vault, vault_path) VALUES (?, ?, '[]', '[]', ?, ?, 5, ?, ?, ?)").run(
    id,
    extra.title ?? 'Paper One',
    extra.fileName ?? 'Paper One.pdf',
    hash,
    1000,
    link?.root ?? null,
    link?.path ?? null
  )
}

const ann = (id: string, o: Partial<Annotation> = {}): Annotation => ({
  id,
  paperId: 'p1',
  mode: 'pdf',
  color: 'yellow',
  style: 'highlight',
  label: null,
  kind: 'key',
  text: 'we selected the AffectiveROAD dataset',
  note: '',
  page: 2,
  rects: [[0.1, 0.2, 0.3, 0.02], [0.1, 0.22, 0.2, 0.02]],
  blockId: null,
  blockHash: null,
  start: null,
  end: null,
  section: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...o
})

/** 界面存一条：ann:save 的做法（先写进笔记，再带着身份存） */
function save(a: Annotation): Annotation {
  const out = cn.annSaved(getAnnotation(db, a.id), a)
  saveAnnotation(db, out)
  return getAnnotation(db, a.id)!
}

const note = () => readFileSync(join(vault, NOTE), 'utf8')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-cnlink-'))
  vault = join(dir, 'vault')
  data = join(dir, 'data')
  mkdirSync(join(vault, '课程/ecp'), { recursive: true })
  mkdirSync(join(data, 'papers'), { recursive: true })
  writeFileSync(join(vault, PDF), '%PDF-1.4 one')
  execFileSync('git', ['init', '-q', vault])
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 't')
  git('add', '-A')
  git('commit', '-qm', 'init')
  db = openDb(':memory:')
  settings = { cnVaults: [{ root: vault, folders: ['课程/ecp'], hidden: [] }], cnLastPlace: null }
  const ctx = {
    db,
    dataDir: data,
    library: {
      pageTexts: () => ['', 'we selected the AffectiveROAD dataset [14], which has 13 drives', 'page three'],
      reflowDoc: () => null,
      ownPdfPath: (id: string) => join(data, 'papers', `${id}.pdf`),
      importFile: vi.fn(async () => ({ status: 'added', paper: {} }))
    },
    settings: { get: () => settings, set: (p: Partial<typeof settings>) => Object.assign(settings, p), view: () => settings },
    broadcast: vi.fn(),
    log: vi.fn(),
    afterImport: vi.fn(),
    vaultListed: vi.fn(),
    mainWindow: () => null
  } as unknown as Ctx
  cn = new CnLink(ctx)
})

afterEach(() => {
  cn.closeAll()
  // Windows 上 git 的对象文件是只读的，rmSync 删只读文件报 EPERM：先都改成可写；刚关的文件监听要一会儿才放开文件夹，删不掉多试几次
  if (process.platform === 'win32') for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) if (f.isFile()) chmodSync(join(f.parentPath, f.name), 0o666)
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('含义、框、对账（纯函数）', () => {
  it('老数据按颜色和标签算含义：红色没标签的算重点，看不懂的标签算看不懂', () => {
    expect(kindOf({ kind: null, label: null, color: 'yellow' })).toBe('key')
    expect(kindOf({ kind: null, label: null, color: 'green' })).toBe('def')
    expect(kindOf({ kind: null, label: null, color: 'blue' })).toBe('cite')
    expect(kindOf({ kind: null, label: null, color: 'red' })).toBe('key')
    expect(kindOf({ kind: null, label: 'confused', color: 'yellow' })).toBe(CONFUSED)
    expect(kindOf({ kind: 'def', label: null, color: 'yellow' })).toBe('def')
  })

  it('几行的框合成一个，三位小数', () => {
    expect(rectOf([[0.1, 0.2, 0.3, 0.02], [0.1, 0.22, 0.2, 0.02]])).toEqual([0.1, 0.2, 0.3, 0.04])
    expect(rectOf(null)).toBeUndefined()
  })

  it('能写进笔记的：有页码、有原文；整块框住的、译文上划的不写', () => {
    expect(shareable(ann('a'))).toBe(true)
    expect(shareable(ann('a', { page: null }))).toBe(false)
    expect(shareable(ann('a', { style: 'box' }))).toBe(false)
    expect(shareable(ann('a', { mode: 'reflow', blockId: 'b1:tr' }))).toBe(false)
  })

  it('对账：笔记里新的建、换了含义的改、删了的删', () => {
    const rows = [ann('a', { hl: 'p2-h1' }), ann('b', { hl: 'p2-h2' }), ann('c', { hl: null })]
    const hls = [
      { id: 'p2-h1', key: 'def', text: 'x', page: 2, file: PDF, name: '定义' },
      { id: 'p3-h1', key: 'key', text: 'y', page: 3, file: PDF, name: '重点' }
    ]
    const r = reconcile(rows, hls)
    expect(r.create.map((h) => h.id)).toEqual(['p3-h1'])
    expect(r.update).toEqual([{ id: 'a', kind: 'def', page: 2 }])
    expect(r.remove).toEqual(['b'])
  })

  it('换含义：颜色跟着走；换成看不懂打上标签，换走去掉', () => {
    const k = DEFAULT_KINDS
    expect(withKind(ann('a'), k, 'cite')).toMatchObject({ kind: 'cite', color: 'blue', label: null })
    expect(withKind(ann('a'), k, CONFUSED)).toMatchObject({ kind: CONFUSED, color: 'red', label: 'confused' })
    expect(withKind(ann('a', { label: 'confused', kind: CONFUSED }), k, 'key')).toMatchObject({ kind: 'key', label: null })
    expect(withKind(ann('a', { label: 'doubt' }), k, 'def')).toMatchObject({ label: 'doubt' })
    expect(annOfHl({ id: 'p2-h3', key: CONFUSED, text: 't', page: 2, file: PDF, name: '' }, 'p1', k, 'n1', 5)).toMatchObject({ label: 'confused', color: 'red', hl: 'p2-h3', rects: null })
  })

  it('有质疑的石墨灰：ParaRead 的 --lb-doubt 就是共用的那一份，深浅都过 3:1（对白纸、对面板）', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/tokens.css'), 'utf8')
    expect(css).toContain(`--lb-doubt: light-dark(${DOUBT_MARK.light.toLowerCase()}, ${DOUBT_MARK.dark.toLowerCase()});`)
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    for (const bg of ['#ffffff', '#f6f6f8', '#ececee']) expect(ratio(DOUBT_MARK.light, bg)).toBeGreaterThanOrEqual(3)
    for (const bg of ['#ffffff', '#1b1b1d', '#252528', '#141416']) expect(ratio(DOUBT_MARK.dark, bg)).toBeGreaterThanOrEqual(3)
  })

  it('左栏「画布笔记库」的筛选：库和文件夹带斜杠、引号也认得回来', () => {
    const f = cnFilter('/a/b "c"', '课程/ecp')
    expect(parseCnFilter(f)).toEqual({ root: '/a/b "c"', folder: '课程/ecp' })
    expect(inCnFolder({ root: '/v', path: '课程/ecp/x.pdf' }, '/v', '课程/ecp')).toBe(true)
    expect(inCnFolder({ root: '/v', path: '课程/ecp/sub/x.pdf' }, '/v', '课程/ecp')).toBe(false)
    expect(inCnFolder({ root: '/v', path: 'x.pdf' }, '/v', '')).toBe(true)
  })
})

describe('ParaRead 里划的写进配对笔记，画布笔记读得出来', () => {
  beforeEach(() => addPaper('p1', 'H1', { root: vault, path: PDF }))

  it('划一条重点：笔记里多一行，画布笔记读出同一条（含义、原文、页码、框）；只换了框不再写', async () => {
    const a = save(ann('a1'))
    expect(a.hl).toBe('p2-h1')
    const hs = highlightsOf(note(), NOTE)
    expect(hs).toEqual([{ id: 'p2-h1', key: 'key', text: 'we selected the AffectiveROAD dataset', page: 2, rect: [0.1, 0.2, 0.3, 0.04], file: PDF, name: '重点' }])
    await cn.settled()
    expect(git('log', '--format=%s', '-1')).toContain('ParaRead：Paper One 第 2 页划线 · 重点')
    const before = note()
    save({ ...a, rects: [[0.5, 0.5, 0.1, 0.1]] })
    expect(note()).toBe(before)
  })

  it('换成定义：同一行换掉，不另起一行', () => {
    const a = save(ann('a1'))
    save(withKind(a, DEFAULT_KINDS, 'def'))
    const hs = highlightsOf(note(), NOTE)
    expect(hs.map((h) => [h.id, h.key, h.name])).toEqual([['p2-h1', 'def', '定义']])
  })

  it('看不懂写成问题段：画布笔记认出是看不懂、还没问过；ParaRead 讲完以后回答写进去，算问过了', () => {
    const a = save(ann('c1', { kind: CONFUSED, label: 'confused', color: 'red' }))
    let hs = highlightsOf(note(), NOTE)
    expect(hs).toHaveLength(1)
    expect(hs[0]).toMatchObject({ id: a.hl, key: CONFUSED, text: 'we selected the AffectiveROAD dataset', page: 2, asked: false })
    expect(openConfused(hs)).toHaveLength(1)
    expect(note()).toMatch(/^## 第 2 页 · 看不懂：/m)
    // 讲解好了（explain.ts 存完以后调 explained）
    db.prepare('UPDATE annotations SET explain = ? WHERE id = ?').run(JSON.stringify({ versions: [{ focus: '', raw: '<one>这句说选了哪个数据集。</one>', at: 2000 }], misses: 0 }), 'c1')
    cn.explained('c1')
    hs = highlightsOf(note(), NOTE)
    expect(hs[0]).toMatchObject({ asked: true })
    expect(openConfused(hs)).toHaveLength(0)
    expect(parseReadingNote(note(), NOTE)[0]!.qas![0]!.a).toContain('这句说选了哪个数据集')
  })

  it('画布笔记那边接着问过的看不懂，ParaRead 讲解不盖掉它的回答；换成别的含义要报错', () => {
    const a = save(ann('c1', { kind: CONFUSED, label: 'confused', color: 'red' }))
    // 画布笔记那边问了 AI：回答接在问题后面
    const md = note().replace(/(> ==we selected the AffectiveROAD dataset== <!-- cn:hl=p2-h1 k=confused -->\n)/, '$1\n画布笔记里的回答。\n')
    writeFileSync(join(vault, NOTE), md)
    db.prepare('UPDATE annotations SET explain = ? WHERE id = ?').run(JSON.stringify({ versions: [{ focus: '', raw: '<one>ParaRead 的讲解。</one>', at: 2000 }], misses: 0 }), 'c1')
    cn.explained('c1')
    expect(note()).toContain('画布笔记里的回答。')
    expect(note()).not.toContain('ParaRead 的讲解。')
    expect(() => save(withKind(getAnnotation(db, a.id)!, DEFAULT_KINDS, 'key'))).toThrow(/问过 AI/)
  })

  it('删一条：只删那一行，那一段删空了连标题一起删', () => {
    const a = save(ann('a1'))
    save(ann('a2', { text: 'which has 13 drives' }))
    cn.annDeleted(a)
    expect(highlightsOf(note(), NOTE).map((h) => h.id)).toEqual(['p2-h2'])
    cn.annDeleted(getAnnotation(db, 'a2')!)
    expect(note()).not.toContain('划的线')
  })

  it('有质疑：线照写，另起一段问题段（画布笔记的问答段）', () => {
    save(ann('d1', { label: 'doubt' }))
    const secs = parseReadingNote(note(), NOTE)
    expect(secs.map((s) => s.title)).toEqual(['有质疑：we selected the AffectiveROAD dataset'])
    expect(highlightsOf(note(), NOTE)).toHaveLength(1)
  })

  it('画布笔记那边划的读进来，换了含义跟上，删了的删掉；ParaRead 还没写进去的写进去', () => {
    save(ann('a1'))
    // 画布笔记划了一条定义、把 ParaRead 那条换成想引用
    let md = upsertHighlight(note(), { id: 'p3-h1', key: 'def', text: 'page three', page: 3, file: PDF }, NOTE, '定义')
    md = upsertHighlight(md, { id: 'p2-h1', key: 'cite', text: 'we selected the AffectiveROAD dataset', page: 2, file: PDF }, NOTE, '想引用')
    writeFileSync(join(vault, NOTE), md)
    // ParaRead 这边有一条老的（还没写进去）
    saveAnnotation(db, ann('old', { kind: null, color: 'green', text: 'which has 13 drives', hl: null }))
    expect(cn.syncFromNote('p1')).toBe(true)
    const rows = listAnnotations(db, 'p1')
    expect(rows.find((r) => r.id === 'a1')).toMatchObject({ kind: 'cite', color: 'blue' })
    expect(rows.find((r) => r.hl === 'p3-h1')).toMatchObject({ kind: 'def', color: 'green', page: 3, mode: 'pdf', rects: null })
    expect(rows.find((r) => r.id === 'old')!.hl).toBe('p2-h2')
    expect(highlightsOf(note(), NOTE).map((h) => [h.id, h.key])).toEqual([
      ['p2-h1', 'cite'],
      ['p2-h2', 'def'],
      ['p3-h1', 'def']
    ])
    // 画布笔记删了 p3-h1
    writeFileSync(join(vault, NOTE), note().replace(/^- ==page three==.*\n/m, ''))
    cn.syncFromNote('p1')
    expect(listAnnotations(db, 'p1').some((r) => r.hl === 'p3-h1')).toBe(false)
    expect(cn.syncFromNote('p1')).toBe(false)
  })

  it('含义表用库里那份：画布笔记改了名字，ParaRead 写的是新名字；改名能把已写的一起改', async () => {
    mkdirSync(join(vault, '.canvas-notes'), { recursive: true })
    writeFileSync(join(vault, KINDS_FILE), kindsJson(DEFAULT_KINDS.map((k) => (k.key === 'def' ? { ...k, name: '术语' } : k))))
    save(ann('a1', { kind: 'def', color: 'green' }))
    expect(highlightsOf(note(), NOTE)[0]!.name).toBe('术语')
    expect(cn.countKind(vault, 'def')).toBe(1)
    expect(await cn.renameKind(vault, 'def', '概念', true)).toBe(1)
    expect(highlightsOf(note(), NOTE)[0]!.name).toBe('概念')
    expect(cn.kinds(vault).find((k) => k.key === 'def')!.name).toBe('概念')
  })

  it('读到哪写进库里那份（ParaRead 记的），关论文时笔记属性跟上；读到哪.json 不进 Git', async () => {
    save(ann('a1'))
    cn.readAtPut('p1', { page: 3, pct: 42, section: 'B. Architecture' })
    cn.readAtPut('p1', { addMs: 120_000 })
    await cn.settled()
    const r = parseReadAt(readFileSync(join(vault, READ_AT_FILE), 'utf8'))[PDF]!
    expect(r).toMatchObject({ page: 3, pct: 42, section: 'B. Architecture', by: 'pararead', ms: { pararead: 120_000 } })
    expect(readFileSync(join(vault, '.git/info/exclude'), 'utf8')).toContain(`/${READ_AT_FILE}`)
    await cn.closed('p1')
    expect(prop(note(), '读到')).toBe('42% · B. Architecture')
    expect(prop(note(), '读了')).toBe('2 分钟')
    await cn.settled()
    expect(git('status', '--porcelain')).toBe('')
  })
})

describe('勾上的文件夹里的 PDF 列进文献库', () => {
  it('列着的时候改了勾的文件夹：列完再按新勾的列一遍（以前一个 await 都没有时 scanning 清不掉，之后再也不列）', async () => {
    settings.cnVaults = [{ root: vault, folders: [''], hidden: [] }]
    const first = cn.scan()
    cn.setFolders(vault, ['课程/ecp'])
    await first
    await cn.scan()
    const lib = (cn as unknown as { c: Ctx }).c.library as unknown as { importFile: ReturnType<typeof vi.fn> }
    expect(lib.importFile).toHaveBeenCalledWith(join(vault, PDF), { link: { root: vault, path: PDF } })
  })
})

describe('放到画布笔记', () => {
  it('PDF 拷进那个文件夹、笔记写上划线和读到哪，这一条指到库里那份；一次提交', async () => {
    addPaper('p2', 'HASH-TWO', null, { title: 'Two', fileName: 'Two.pdf' })
    writeFileSync(join(data, 'papers', 'p2.pdf'), '%PDF-1.4 two')
    saveAnnotation(db, ann('x1', { paperId: 'p2', kind: null, color: 'blue', text: 'quoted line' }))
    db.prepare('UPDATE papers SET progress = 0.5, last_position = ? WHERE id = ?').run(JSON.stringify({ page: 2 }), 'p2')
    const pre = cn.placePreview('p2', vault, '课程/ecp')
    expect(pre).toMatchObject({ pdf: '课程/ecp/Two.pdf', note: '课程/ecp/Two 笔记.md', renamed: false, reuse: false, noteExists: false })
    await cn.place('p2', vault, '课程/ecp')
    expect(readFileSync(join(vault, '课程/ecp/Two.pdf'), 'utf8')).toBe('%PDF-1.4 two')
    const md = readFileSync(join(vault, '课程/ecp/Two 笔记.md'), 'utf8')
    expect(highlightsOf(md, '课程/ecp/Two 笔记.md').map((h) => [h.key, h.text])).toEqual([['cite', 'quoted line']])
    expect(prop(md, '读到')).toBe('50%')
    expect(cn.linkOf('p2')).toEqual({ root: vault, pdf: '课程/ecp/Two.pdf', note: '课程/ecp/Two 笔记.md' })
    expect(settings.cnLastPlace).toEqual({ root: vault, folder: '课程/ecp' })
    await cn.settled()
    expect(git('log', '--format=%s', '-1').trim()).toBe('ParaRead：放进 课程/ecp · Two')
    expect(git('status', '--porcelain')).toBe('')
  })

  it('同名的一份内容不一样：换成「名字 (2)」', () => {
    addPaper('p3', 'HASH-THREE', null, { title: 'Paper One', fileName: 'Paper One.pdf' })
    expect(cn.placePreview('p3', vault, '课程/ecp')).toMatchObject({ pdf: '课程/ecp/Paper One (2).pdf', renamed: true, reuse: false })
  })
})

describe('从旧版迁过来（一次，能撤回，老数据留着）', () => {
  it('老高亮按颜色换成含义；库里也有的那篇指到库里、标注写进笔记；撤回以后都换回来', async () => {
    const hash = (await import('node:crypto')).createHash('sha256').update(readFileSync(join(vault, PDF))).digest('hex')
    addPaper('own', hash, null)
    copyFileSync(join(vault, PDF), join(data, 'papers', 'own.pdf'))
    saveAnnotation(db, ann('r1', { paperId: 'own', kind: null, color: 'red' }))
    saveAnnotation(db, ann('c1', { paperId: 'own', kind: null, color: 'yellow', label: 'confused', text: 'which has 13 drives' }))
    const v = cn.migrate()
    expect(v).toMatchObject({ kinds: 2, papers: 1, notes: 1, undone: false })
    expect(getAnnotation(db, 'r1')).toMatchObject({ kind: 'key', color: 'yellow' })
    expect(getAnnotation(db, 'c1')).toMatchObject({ kind: CONFUSED, color: 'red' })
    expect(cn.linkOf('own')?.pdf).toBe(PDF)
    expect(highlightsOf(note(), NOTE).map((h) => h.key).sort()).toEqual([CONFUSED, 'key'])
    // 再迁一次什么都不动
    expect(cn.migrate()).toMatchObject({ kinds: 2, papers: 1 })
    await cn.settled()
    expect(git('log', '--format=%s', '-1')).toContain('从旧版迁过来')

    const r = await cn.undoMigration()
    expect(r).toEqual({ notes: 1, kept: 0 })
    expect(existsSync(join(vault, NOTE))).toBe(false)
    expect(getAnnotation(db, 'r1')).toMatchObject({ kind: null, color: 'red', hl: null })
    expect(cn.linkOf('own')).toBeNull()
    expect(existsSync(join(data, 'papers', 'own.pdf'))).toBe(true)
    // 撤回过就不再自己迁
    expect(cn.migrate()).toMatchObject({ undone: true })
    expect(getAnnotation(db, 'r1')!.kind).toBeNull()
  })

  it('撤回时笔记之后又改过：不动它，数出来', async () => {
    const hash = (await import('node:crypto')).createHash('sha256').update(readFileSync(join(vault, PDF))).digest('hex')
    addPaper('own', hash, null)
    saveAnnotation(db, ann('r1', { paperId: 'own', kind: null }))
    cn.migrate()
    writeFileSync(join(vault, NOTE), note() + '\n我自己加的一句。\n')
    expect(await cn.undoMigration()).toEqual({ notes: 0, kept: 1 })
    expect(note()).toContain('我自己加的一句。')
  })
})
