/**
 * ParaRead × 画布笔记联动，ParaRead 这一侧（设计 canvas-notes 20-pararead联动「已定」，2026-11-23 用户定）：
 * - 两个来源：自己的文献库 + 连上的画布笔记库（可以连几个，每个库勾哪些文件夹，单篇能藏起来）。库里的 PDF 不拷贝，直接读库里那份。
 * - 两边看到的完全一样：库里那篇配对笔记是唯一一份。ParaRead 里划的线、看不懂、有质疑、AI 问答写进它（写法全靠 @cn/format），
 *   画布笔记那边写的读回来（打开时、笔记一变就对一遍）；annotations 表对库里的论文只当缓存（位置、讲解、自己写的话）。
 * - 划线四色带含义：含义表是库里 .canvas-notes/划线颜色.json，两个软件读写同一份。
 * - 读到哪合一：库里 .canvas-notes/读到哪.json，谁晚谁为准；关论文时笔记属性「读到」「读了」跟上。
 * - 右键「放到画布笔记…」：PDF 和配对笔记放进库里一个文件夹，ParaRead 里的划线、问答、读到哪写进那篇笔记。
 * - 深链 pararead://open?file=…&page=…&vault=…&back=…&view=…（画布笔记首页组件「继续读」），回去用 canvas-notes://open。
 * - 从老版本迁过来：老的高亮按颜色换成含义、库里也有的那几篇把 ParaRead 里的标注写进笔记；一次，能撤回，老数据留着。
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  type AskSection,
  CONFUSED,
  canvasNotesOpenUrl,
  confusedOf,
  DEFAULT_META,
  decodeNote,
  encodeNote,
  type Highlight,
  highlightsOf,
  type HlKind,
  kindName,
  KINDS_FILE,
  kindsJson,
  newReadingNote,
  nextHlId,
  notePathFor,
  parseKinds,
  parseParaReadOpen,
  parseReadAt,
  parseReadingNote,
  placeNames,
  putReadAt,
  type ReadAt,
  READ_AT_FILE,
  readAtJson,
  readAtLabel,
  removeHighlight,
  removeSection,
  renameKindIn,
  upsertHighlight,
  upsertSection,
  withReadAtProps
} from '@cn/format'
import { canvasNotesVaults, vaultFolders, type VaultFolder } from '@cn/family/node'
import { commitPaths } from '@cn/git'
import { annOfHl, colorOfKind, hlOfAnn, kindOf, nameOfKind, reconcile, shareable, withKind } from '../shared/cnLink'
import { latest, plainExplain } from '../shared/explainText'
import { annotationSection, chatSections, pairedThreadId } from '../shared/pairedNote'
import { pageOfText, plain as plainMd } from '../shared/refs'
import { t } from '../shared/i18n'
import type { Annotation, CnVault, Paper } from '../shared/types'
import type { Ctx } from './ctx'
import { deleteAnnotation, getAnnotation, getPaper, listAnnotations, listChats, saveAnnotation } from './db'
import { E2E } from './testMode'

/** 读到哪是 ParaRead 记的 */
const BY = 'pararead'
const MIGRATION_FILE = 'cn-migration.json'

export interface CnLinkOf {
  root: string
  /** PDF 在库里的路径 */
  pdf: string
  /** 配对笔记在库里的路径 */
  note: string
}

/** 设置 › 画布笔记 要的样子 */
export interface CnState {
  vaults: { root: string; name: string; missing: boolean; folders: string[]; hidden: string[] }[]
  /** 画布笔记在这台 Mac 上开过、还没连的库 */
  suggestions: { root: string; name: string }[]
  kinds: HlKind[]
  migration: CnMigrationView | null
}

export interface CnMigrationView {
  at: number
  kinds: number
  notes: number
  papers: number
  undone: boolean
}

interface Migration {
  at: number
  undone: boolean
  /** 按含义换过颜色的老标注：原来的颜色 */
  rows: { id: string; color: string }[]
  /** 写过的笔记：写之前、写之后的字（撤回时还是「写之后」才换回去） */
  notes: { root: string; path: string; before: string | null; after: string }[]
  /** 指到库里那份的论文 */
  papers: string[]
}

export interface PlaceInfo {
  vaults: { root: string; name: string }[]
  last: { root: string; folder: string } | null
  size: number
  marks: number
  asks: number
  readAt: string | null
}

export interface PlacePreview {
  pdf: string
  note: string
  renamed: boolean
  reuse: boolean
  noteExists: boolean
}

const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const relPath = (root: string, abs: string) => relative(root, abs).split(sep).join('/')
const inside = (root: string, abs: string) => {
  const r = relative(root, abs)
  return !!r && !r.startsWith('..') && !isAbsolute(r)
}

export class CnLink {
  private watchers = new Map<string, { w: FSWatcher; timer: NodeJS.Timeout | null; n: number }>()
  private chatTimers = new Map<string, NodeJS.Timeout>()
  private readAtQueue: Promise<unknown> = Promise.resolve()
  private commitQueue: Promise<unknown> = Promise.resolve()
  private scanning: Promise<void> | null = null
  /** 列着的时候又改了勾的文件夹：列完再列一遍 */
  private scanAgain = false

  constructor(private c: Ctx) {}

  // ---------------------------------------------------------------- 库

  private vaultsSetting(): CnVault[] {
    return this.c.settings.get().cnVaults ?? []
  }
  private saveVaults(v: CnVault[]): void {
    this.c.settings.set({ cnVaults: v })
    this.c.broadcast('settings:changed', this.c.settings.view())
  }

  /** 画布笔记开过的库（测试模式下只认 CN_USER_DATA 指的，不去读这台 Mac 上真的画布笔记设置） */
  private suggestions(): { root: string; name: string }[] {
    if (E2E && !process.env.CN_USER_DATA) return []
    const have = new Set(this.vaultsSetting().map((v) => v.root))
    return canvasNotesVaults()
      .filter((v) => !have.has(v.path))
      .map((v) => ({ root: v.path, name: v.name }))
  }

  state(): CnState {
    const vaults = this.vaultsSetting().map((v) => ({ root: v.root, name: basename(v.root), missing: !existsSync(v.root), folders: v.folders, hidden: v.hidden }))
    return { vaults, suggestions: this.suggestions(), kinds: this.kinds(this.vaultsSetting()[0]?.root ?? null), migration: this.migrationView() }
  }

  /** 连上一个库：默认勾最外层（库里所有 PDF 都太多，先只列最外层的；在设置里勾别的文件夹） */
  connect(root: string): CnState {
    if (!isAbsolute(root) || !existsSync(root) || !statSync(root).isDirectory()) throw new Error(t('找不到这个文件夹'))
    const list = this.vaultsSetting()
    if (!list.some((v) => v.root === root)) this.saveVaults([...list, { root, folders: [''], hidden: [] }])
    this.migrate()
    void this.scan()
    return this.state()
  }

  disconnect(root: string): CnState {
    this.saveVaults(this.vaultsSetting().filter((v) => v.root !== root))
    this.c.broadcast('library:changed', null)
    return this.state()
  }

  setFolders(root: string, folders: string[]): CnState {
    this.saveVaults(this.vaultsSetting().map((v) => (v.root === root ? { ...v, folders: [...new Set(folders.filter((f) => typeof f === 'string' && !f.split('/').includes('..')))] } : v)))
    // 新勾上的文件夹里有文献库里一模一样的那几篇：先迁（指过去、标注写进笔记，记进迁移能撤回），再列别的
    this.migrate()
    void this.scan()
    return this.state()
  }

  setHidden(root: string, path: string, hide: boolean): void {
    this.saveVaults(this.vaultsSetting().map((v) => (v.root === root ? { ...v, hidden: hide ? [...new Set([...v.hidden, path])] : v.hidden.filter((h) => h !== path) } : v)))
    this.c.broadcast('library:changed', null)
  }

  /** 这一篇藏起来了没有（文献库不列） */
  isHidden(p: Paper): boolean {
    if (!p.cn) return false
    return this.vaultsSetting().some((v) => v.root === p.cn!.root && v.hidden.includes(p.cn!.path))
  }

  tree(root: string): VaultFolder[] {
    return vaultFolders(root)
  }

  /** 勾上的文件夹里的 PDF 自己出现在文献库里：还没有的按「库里的一篇」导进来（不拷贝、不问 AI），一次一篇 */
  scan(): Promise<void> {
    if (this.scanning) {
      this.scanAgain = true
      return this.scanning
    }
    this.scanAgain = false
    this.scanning = (async () => {
      // 先让出一下：下面一个 await 都没有时（勾的文件夹里没有新的 PDF），整段会在给 this.scanning 赋值之前就跑完，finally 里清掉的又被赋回去
      await Promise.resolve()
      const m = this.loadMigration()
      const undone = new Set(
        m?.undone ? m.papers.map((id) => (this.c.db.prepare('SELECT file_hash FROM papers WHERE id = ?').get(id) as { file_hash: string } | undefined)?.file_hash).filter((h): h is string => !!h) : []
      )
      try {
        for (const v of this.vaultsSetting()) {
          if (!existsSync(v.root)) continue
          for (const folder of v.folders) {
            let ents
            try {
              ents = readdirSync(folder ? join(v.root, folder) : v.root, { withFileTypes: true })
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
              throw e
            }
            for (const ent of ents) {
              if (!ent.isFile() || !/\.pdf$/i.test(ent.name) || ent.name.startsWith('.')) continue
              const rel = folder ? `${folder}/${ent.name}` : ent.name
              if (v.hidden.includes(rel)) continue
              const have = this.c.db.prepare('SELECT id FROM papers WHERE vault = ? AND vault_path = ? AND deleted = 0').get(v.root, rel)
              if (have) continue
              // 撤回过迁移的那几篇：和库里这份一模一样也不再自己指过去（不然撤回过一会儿又迁回来了）；从画布笔记点「继续读」开的照样指过去
              if (undone.size && undone.has(createHash('sha256').update(readFileSync(join(v.root, rel))).digest('hex'))) continue
              const r = await this.c.library.importFile(join(v.root, rel), { link: { root: v.root, path: rel } })
              if (r.status === 'failed') this.c.log(`画布笔记库里这份导不进来：${rel}：${r.error}`)
              else this.c.broadcast('library:changed', null)
            }
          }
        }
      } finally {
        this.scanning = null
      }
      if (this.scanAgain) await this.scan()
    })()
    return this.scanning
  }

  /** 在设置里「选文件夹」连一个库（画布笔记没开过的库） */
  async choose(): Promise<string | null> {
    const w = this.c.mainWindow() ?? BrowserWindow.getAllWindows()[0]
    const r = await (w ? dialog.showOpenDialog(w, { title: t('选画布笔记的库'), properties: ['openDirectory'] }) : dialog.showOpenDialog({ title: t('选画布笔记的库'), properties: ['openDirectory'] }))
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  }

  // ---------------------------------------------------------------- 一篇论文和它的笔记

  linkOf(paperId: string): CnLinkOf | null {
    const r = this.c.db.prepare('SELECT vault, vault_path FROM papers WHERE id = ?').get(paperId) as { vault: string | null; vault_path: string | null } | undefined
    if (!r?.vault || !r.vault_path || !existsSync(r.vault)) return null
    return { root: r.vault, pdf: r.vault_path, note: notePathFor(r.vault_path) }
  }

  /** 含义表：库里的论文用它那个库的；ParaRead 自己的用连上的第一个库的；都没有用默认四种 */
  kinds(root: string | null): HlKind[] {
    const r = root ?? this.vaultsSetting().find((v) => existsSync(v.root))?.root ?? null
    if (!r) return parseKinds(null)
    const f = join(r, KINDS_FILE)
    return parseKinds(existsSync(f) ? readFileSync(f, 'utf8') : null)
  }
  kindsFor(paperId: string | null): HlKind[] {
    return this.kinds(paperId ? (this.linkOf(paperId)?.root ?? null) : null)
  }

  /** 改含义的名字（和画布笔记设置 › 读PDF › 划线颜色同一份）；all：把库里已经写了的几处一起改 */
  async renameKind(root: string, key: string, name: string, all: boolean): Promise<number> {
    const nm = kindName(name)
    if (!nm) throw new Error(t('名字不对'))
    const kinds = this.kinds(root).map((k) => (k.key === key ? { ...k, name: nm } : k))
    mkdirSync(join(root, '.canvas-notes'), { recursive: true })
    writeFileSync(join(root, KINDS_FILE), kindsJson(kinds))
    const paths = [KINDS_FILE]
    let n = 0
    if (all)
      for (const f of this.markedNotes(root)) {
        const r = renameKindIn(f.text, key, nm, f.path)
        if (!r.n) continue
        if (this.writeNote(root, f.path, f.text, r.text)) {
          paths.push(f.path)
          n += r.n
        }
      }
    await this.commit(root, paths, `ParaRead：划线改名 ${nm}${n ? `（${n} 处）` : ''}`) // 不翻：提交说明
    return n
  }

  /** 这个键在库里已经写了几条（改名时问一次「一起改」） */
  countKind(root: string, key: string): number {
    let n = 0
    for (const f of this.markedNotes(root)) n += highlightsOf(f.text, f.path).filter((h) => h.key === key && h.key !== CONFUSED).length
    return n
  }

  private markedNotes(root: string): { path: string; text: string }[] {
    const out: { path: string; text: string }[] = []
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir ? join(root, dir) : root, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
        const p = dir ? `${dir}/${ent.name}` : ent.name
        if (ent.isDirectory()) walk(p)
        else if (ent.isFile() && /\.md$/i.test(ent.name)) {
          const text = this.readNote(root, p)
          if (text?.includes('cn:hl=')) out.push({ path: p, text })
        }
      }
    }
    walk('')
    return out
  }

  // ---------------------------------------------------------------- 读写笔记

  private readNote(root: string, rel: string): string | null {
    try {
      return decodeNote(readFileSync(join(root, rel))).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /** 先比后写：磁盘上还是 base 才写（先写临时文件再换名，画布笔记盯着这篇，不让它读到写了一半的）；沿用文件的 BOM 和换行 */
  private writeNote(root: string, rel: string, base: string | null, next: string): boolean {
    const abs = join(root, rel)
    let meta = DEFAULT_META
    let cur: string | null = null
    try {
      const d = decodeNote(readFileSync(abs))
      cur = d.text
      meta = d.meta
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    if (cur !== base) return false
    mkdirSync(dirname(abs), { recursive: true })
    const tmp = `${abs}.pararead-${process.pid}.tmp`
    writeFileSync(tmp, encodeNote(next, meta))
    renameSync(tmp, abs)
    return true
  }

  /** 改一下这篇的配对笔记（没有就新建）：f 拿现在的字、回新的字；刚被改过就重读再来，三次不成报错。回新的字（没变是 null） */
  private editNote(link: CnLinkOf, f: (md: string) => string, message: string | null): string | null {
    for (let tries = 0; ; tries++) {
      const cur = this.readNote(link.root, link.note)
      const next = f(cur ?? newReadingNote(link.pdf))
      if (next === (cur ?? newReadingNote(link.pdf)) && cur !== null) return null
      if (cur === null && next === newReadingNote(link.pdf)) return null
      if (this.writeNote(link.root, link.note, cur, next)) {
        if (message) void this.commit(link.root, [link.note], message)
        return next
      }
      if (tries >= 2) throw new Error(t('笔记刚被改过，没记上，再试一次'))
    }
  }

  /** 提交进库的 Git（库不是 Git 仓库就不提交）；一个接一个，撞上画布笔记正在提交时 @cn/git 自己等 */
  commit(root: string, paths: string[], message: string): Promise<unknown> {
    if (!existsSync(join(root, '.git'))) return Promise.resolve()
    this.commitQueue = this.commitQueue
      .catch(() => undefined)
      .then(() => commitPaths(root, paths, message))
      .catch((e: Error) => this.c.log(`提交进画布笔记库失败：${e.message}`))
    return this.commitQueue
  }

  /** 等前面排着的提交做完（测试、退出前用） */
  settled(): Promise<unknown> {
    return Promise.all([this.commitQueue.catch(() => undefined), this.readAtQueue.catch(() => undefined)])
  }

  /** 这一条在笔记里那一段问题段（看不懂的：问题里带着它的身份） */
  private confusedSectionOf(md: string, note: string, hl: string): AskSection | null {
    return parseReadingNote(md, note).find((s) => confusedOf(s.qas?.[0]?.q ?? '')?.id === hl) ?? null
  }

  /** 这一段的回答是不是 ParaRead 自己写的（空、或者就是这一条最新一版讲解）：是的话 ParaRead 换含义、删的时候能整段拿掉 */
  private ownAnswer(s: AskSection, a: Annotation | null): boolean {
    const ans = (s.qas ?? []).map((q) => q.a.trim()).filter(Boolean)
    if (!ans.length) return true
    const mine = a ? plainExplain(latest(a.explain)?.raw ?? '').trim() : ''
    return !!mine && ans.length === 1 && ans[0] === mine
  }

  /**
   * ParaRead 里存了一条（新划、换含义、打上 / 去掉有质疑、讲解好了）：写进笔记。只动这一条那一行、那一段；只换了位置（找到了框）不写。
   * 返回存好的那条（带上它在笔记里的身份）
   */
  annSaved(prev: Annotation | null, a: Annotation): Annotation {
    const link = this.linkOf(a.paperId)
    if (!link || !shareable(a)) return a
    const same = prev && prev.hl && kindOf(prev) === kindOf(a) && prev.page === a.page && prev.text === a.text && prev.label === a.label && prev.note === a.note
    if (same && JSON.stringify(prev.explain ?? null) === JSON.stringify(a.explain ?? null) && prev.labelStatus === a.labelStatus) return a
    const kinds = this.kinds(link.root)
    const key = kindOf(a)
    const name = nameOfKind(kinds, key)
    let hl = a.hl ?? prev?.hl ?? null
    this.editNote(
      link,
      (md0) => {
        let md = md0
        if (!hl) hl = nextHlId(md, a.page!)
        const wasConfused = !!prev?.hl && kindOf(prev) === CONFUSED
        const row = { ...a, hl }
        if (key !== CONFUSED) {
          if (wasConfused) {
            const s = this.confusedSectionOf(md, link.note, hl)
            if (s) {
              if (!this.ownAnswer(s, prev)) throw new Error(t('这处已经问过 AI，回答在笔记里；要换请先在笔记里删那一段'))
              md = removeSection(md, s.id, link.note)
            }
          }
          md = upsertHighlight(md, hlOfAnn(row, hl, link.pdf), link.note, name)
        } else {
          if (prev?.hl && kindOf(prev) !== CONFUSED) md = removeHighlight(md, prev.hl, link.note)
          md = this.putQuestion(md, link, row, name, this.confusedSectionOf(md, link.note, hl))
        }
        // 有质疑：另写一段问题段（和画布笔记读得懂的问答段一样）；去掉了且还没问过就删那一段
        const doubtId = pairedThreadId(link.pdf, a.page!, a.id)
        const doubt = parseReadingNote(md, link.note).find((s) => s.id === doubtId) ?? null
        if (a.label === 'doubt') md = this.putQuestion(md, link, row, '', doubt)
        else if (doubt && prev?.label === 'doubt' && this.ownAnswer(doubt, prev)) md = removeSection(md, doubt.id, link.note)
        return md
      },
      `ParaRead：${stemOf(link.pdf)} 第 ${a.page} 页划线 · ${name}` // 不翻：提交说明
    )
    const out = { ...a, hl }
    if (hl !== a.hl) this.c.db.prepare('UPDATE annotations SET hl = ? WHERE id = ?').run(hl, a.id)
    return out
  }

  /**
   * 看不懂、有质疑的问题段：还没有就照这一条新写；已经有了（画布笔记那边可能接着问过）只补 ParaRead 有、笔记里还空着的回答和处理到哪了，
   * 别的照笔记里的原样（读回来再写回去，一个字不变）
   */
  private putQuestion(md: string, link: CnLinkOf, a: Annotation, name: string, existing: AskSection | null): string {
    const mine = annotationSection(link.pdf, a, name || undefined)
    if (!mine) return md
    if (!existing) return upsertSection(md, mine, link.note)
    const next: AskSection = { ...existing, qas: existing.qas ? existing.qas.map((q) => ({ ...q })) : existing.qas }
    const first = next.qas?.[0]
    const myAns = mine.qas?.[0]?.a ?? ''
    const filled = !!first && !first.a.trim() && !!myAns
    if (filled) {
      first!.a = myAns
      // 讲解卡里接着问的几轮跟在后面（笔记里只有这一问时）
      if (next.qas!.length === 1 && mine.qas!.length > 1) next.qas!.push(...mine.qas!.slice(1))
      if (mine.recap && !existing.recap) next.recap = mine.recap
    }
    // 处理到哪了（看懂了、质疑不成立……）写在小结最前面；小结别的字（画布笔记那边 AI 写的）不动
    const STATUS = /^(看懂了|质疑成立|质疑不成立|还要查)(：)?/
    const status = STATUS.exec(mine.recap ?? '')?.[1]
    const rest = (next.recap ?? '').replace(STATUS, '')
    if (status) next.recap = rest ? `${status}：${rest}` : status
    else if (STATUS.test(next.recap ?? '')) next.recap = rest
    if (JSON.stringify(next) === JSON.stringify(existing)) return md
    return upsertSection(md, next, link.note)
  }

  /** ParaRead 里删了一条：划的线删那一行；看不懂的删那一段（画布笔记那边问过的不删，报错）；有质疑那一段还没问过就删 */
  annDeleted(a: Annotation): void {
    const link = this.linkOf(a.paperId)
    if (!link || !a.hl) return
    this.editNote(
      link,
      (md0) => {
        let md = md0
        if (kindOf(a) === CONFUSED) {
          const s = this.confusedSectionOf(md, link.note, a.hl!)
          if (s) {
            if (!this.ownAnswer(s, a)) throw new Error(t('这处已经问过 AI，回答在笔记里；要删请在笔记里删那一段'))
            md = removeSection(md, s.id, link.note)
          }
        } else md = removeHighlight(md, a.hl!, link.note)
        if (a.label === 'doubt' && a.page) {
          const d = parseReadingNote(md, link.note).find((s) => s.id === pairedThreadId(link.pdf, a.page!, a.id))
          if (d && this.ownAnswer(d, a)) md = removeSection(md, d.id, link.note)
        }
        return md
      },
      `ParaRead：${stemOf(link.pdf)} 删掉一条划线` // 不翻：提交说明
    )
  }

  /** 讲解好了、换了处理状态（explain.ts 存完以后）：这一条的问题段补上回答 */
  explained(annId: string): void {
    const a = getAnnotation(this.c.db, annId)
    if (!a) return
    try {
      this.annSaved({ ...a, explain: null, labelStatus: null }, a)
    } catch (e) {
      this.c.log(`讲解写进画布笔记失败：${(e as Error).message}`)
    }
  }

  /** AI 问答答完一问：一秒后把这篇的问答写进笔记（连着问几句只写一次） */
  chatChanged(paperId: string): void {
    if (!this.linkOf(paperId)) return
    clearTimeout(this.chatTimers.get(paperId))
    this.chatTimers.set(
      paperId,
      setTimeout(() => {
        this.chatTimers.delete(paperId)
        try {
          this.writeChats(paperId)
        } catch (e) {
          this.c.log(`问答写进画布笔记失败：${(e as Error).message}`)
        }
      }, 1000)
    )
  }

  writeChats(paperId: string, commit = true): void {
    const link = this.linkOf(paperId)
    if (!link) return
    const pages = this.c.library.pageTexts(paperId)
    const secs = chatSections(link.pdf, listChats(this.c.db, paperId), (q) => pageOfText(pages, q))
    if (!secs.length) return
    this.editNote(
      link,
      (md) => secs.reduce((m, s) => upsertSection(m, s, link.note), md),
      commit ? `ParaRead：${stemOf(link.pdf)} 问 AI ${secs.reduce((n, s) => n + (s.qas?.length ?? 0), 0)} 问` : null // 不翻：提交说明
    )
  }

  /**
   * 笔记和缓存对一遍（打开时、笔记一变）：画布笔记那边划的建进来，换了含义的跟上，删了的删掉；
   * ParaRead 这边还没写进去的（老数据、放进库以前划的）写进去。返回缓存变了没有
   */
  syncFromNote(paperId: string, commit = true): boolean {
    const link = this.linkOf(paperId)
    if (!link) return false
    const kinds = this.kinds(link.root)
    const md = this.readNote(link.root, link.note)
    const hls: Highlight[] = md ? highlightsOf(md, link.note).filter((h) => h.page >= 1) : []
    const rows = listAnnotations(this.c.db, paperId)
    const plan = reconcile(rows, hls)
    const now = Date.now()
    for (const h of plan.create) saveAnnotation(this.c.db, annOfHl(h, paperId, kinds, randomUUID().slice(0, 12), now))
    for (const u of plan.update) {
      const r = rows.find((x) => x.id === u.id)!
      const n = withKind(r, kinds, u.kind)
      saveAnnotation(this.c.db, { ...n, page: u.page, updatedAt: now })
    }
    for (const id of plan.remove) deleteAnnotation(this.c.db, id)
    // 颜色跟着含义表（画布笔记那边换了颜色、删了一种）
    let recolor = 0
    for (const r of listAnnotations(this.c.db, paperId))
      if (r.hl && r.color !== colorOfKind(kinds, kindOf(r))) {
        this.c.db.prepare('UPDATE annotations SET color = ? WHERE id = ?').run(colorOfKind(kinds, kindOf(r)), r.id)
        recolor++
      }
    const pending = this.writePending(paperId, commit)
    return plan.create.length + plan.update.length + plan.remove.length + recolor + pending > 0
  }

  /** 还没写进笔记的（没有 hl、能写的）一条一条写进去；返回写了几条 */
  writePending(paperId: string, message = true): number {
    const link = this.linkOf(paperId)
    if (!link) return 0
    const todo = listAnnotations(this.c.db, paperId).filter((a) => !a.hl && shareable(a))
    if (!todo.length) return 0
    const kinds = this.kinds(link.root)
    const ids = new Map<string, string>()
    this.editNote(
      link,
      (md0) => {
        let md = md0
        for (const a of todo) {
          const hl = nextHlId(md, a.page!)
          ids.set(a.id, hl)
          const key = kindOf(a)
          const row = { ...a, hl }
          if (key === CONFUSED) md = this.putQuestion(md, link, row, nameOfKind(kinds, key), null)
          else md = upsertHighlight(md, hlOfAnn(row, hl, link.pdf), link.note, nameOfKind(kinds, key))
          if (a.label === 'doubt') md = this.putQuestion(md, link, row, '', parseReadingNote(md, link.note).find((s) => s.id === pairedThreadId(link.pdf, a.page!, a.id)) ?? null)
        }
        return md
      },
      message ? `ParaRead：${stemOf(link.pdf)} 写进 ${todo.length} 处划线` : null // 不翻：提交说明
    )
    for (const [id, hl] of ids) this.c.db.prepare('UPDATE annotations SET hl = ?, kind = COALESCE(kind, ?) WHERE id = ?').run(hl, kindOf(todo.find((x) => x.id === id)!), id)
    return ids.size
  }

  /** 开着的论文盯着它的笔记：画布笔记那边一改就对一遍，变了告诉界面重读 */
  watchPaper(paperId: string): void {
    const link = this.linkOf(paperId)
    if (!link) return
    const cur = this.watchers.get(paperId)
    if (cur) {
      cur.n++
      return
    }
    const dir = join(link.root, dirname(link.note))
    const name = basename(link.note)
    let w: FSWatcher
    try {
      w = watch(dir, (_ev, f) => {
        if (f && f.toString() !== name) return
        const me = this.watchers.get(paperId)
        if (!me) return
        if (me.timer) clearTimeout(me.timer)
        me.timer = setTimeout(() => {
          me.timer = null
          try {
            if (this.syncFromNote(paperId)) this.c.broadcast('cn:annChanged', paperId)
          } catch (e) {
            this.c.log(`读画布笔记的笔记失败：${(e as Error).message}`)
          }
        }, 250)
      })
    } catch (e) {
      this.c.log(`盯不了笔记所在的文件夹：${(e as Error).message}`)
      return
    }
    this.watchers.set(paperId, { w, timer: null, n: 1 })
  }

  unwatchPaper(paperId: string): void {
    const cur = this.watchers.get(paperId)
    if (!cur || --cur.n > 0) return
    cur.w.close()
    if (cur.timer) clearTimeout(cur.timer)
    this.watchers.delete(paperId)
  }

  closeAll(): void {
    for (const [, x] of this.watchers) x.w.close()
    this.watchers.clear()
  }

  // ---------------------------------------------------------------- 读到哪

  private readAtMap(root: string) {
    const f = join(root, READ_AT_FILE)
    return parseReadAt(existsSync(f) ? readFileSync(f, 'utf8') : null)
  }

  readAt(paperId: string): (ReadAt & { blockId: string | null }) | null {
    const link = this.linkOf(paperId)
    if (!link) return null
    const r = this.readAtMap(link.root)[link.pdf]
    return r ? { ...r, blockId: this.blockOnPage(paperId, r.page) } : null
  }

  /** 对照模式里这一页的第一段（画布笔记那边读到第 N 页，ParaRead 用对照打开时滚到它） */
  blockOnPage(paperId: string, page: number): string | null {
    const doc = this.c.library.reflowDoc(paperId)
    const pages = this.c.library.pageTexts(paperId)
    if (!doc || !pages.length) return null
    for (const b of doc.blocks) {
      if (b.type !== 'paragraph' && b.type !== 'heading') continue
      const text = plainMd(b.md).slice(0, 160)
      if (text.length < 12) continue
      const p = pageOfText(pages, text)
      if (p !== null && p >= page) return b.id
    }
    return null
  }

  /** 翻到哪了、读了多久（papers:update、papers:readTime 之后）：写进库里那份读到哪 */
  readAtPut(paperId: string, o: { page?: number; pct?: number; section?: string; addMs?: number }): void {
    const link = this.linkOf(paperId)
    if (!link) return
    const pages = getPaper(this.c.db, paperId)?.pageCount || undefined
    this.readAtQueue = this.readAtQueue
      .catch(() => undefined)
      .then(() => {
        const map = this.readAtMap(link.root)
        const next = putReadAt(map, link.pdf, BY, { ...(o.page ? { page: o.page } : {}), ...(o.pct !== undefined ? { pct: Math.round(o.pct * 10) / 10 } : {}), ...(o.section ? { section: o.section } : {}), ...(pages ? { pages } : {}), ...(o.addMs ? { addMs: o.addMs } : {}), now: Date.now() })
        if (next === map) return
        mkdirSync(join(link.root, '.canvas-notes'), { recursive: true })
        writeFileSync(join(link.root, READ_AT_FILE), readAtJson(next))
        keepOutOfGit(link.root)
      })
      .catch((e: Error) => this.c.log(`写读到哪失败：${e.message}`))
  }

  /** 从论文的位置算出第几页、哪一节（原文模式记着页码；对照模式按顶上那段的字找页） */
  positionToReadAt(paperId: string, p: Paper): { page?: number; pct?: number; section?: string } {
    const pos = p.lastPosition ?? {}
    let page = pos.page
    if (!page && pos.textPrefix) page = pageOfText(this.c.library.pageTexts(paperId), pos.textPrefix) ?? undefined
    const section = pos.heading ? plainMd(pos.heading).replace(/^#+\s*/, '').trim().slice(0, 60) : undefined
    return { ...(page ? { page } : {}), pct: p.progress * 100, ...(section ? { section } : {}) }
  }

  /** 关论文时：配对笔记属性「读到」「读了」跟上（笔记已经有了才写），变了提交一次 */
  async closed(paperId: string): Promise<void> {
    const link = this.linkOf(paperId)
    this.unwatchPaper(paperId)
    if (!link) return
    await this.readAtQueue.catch(() => undefined)
    const r = this.readAtMap(link.root)[link.pdf]
    if (!r || this.readNote(link.root, link.note) === null) return
    this.editNote(link, (md) => withReadAtProps(md, r), `ParaRead：${stemOf(link.pdf)} 读到 ${readAtLabel(r)}`) // 不翻：提交说明
  }

  // ---------------------------------------------------------------- 放到画布笔记

  placeInfo(paperId: string): PlaceInfo {
    const p = getPaper(this.c.db, paperId)
    if (!p) throw new Error(t('论文不存在'))
    const own = this.vaultsSetting()
      .filter((v) => existsSync(v.root))
      .map((v) => ({ root: v.root, name: basename(v.root) }))
    const vaults = [...own, ...this.suggestions().filter((s) => !own.some((o) => o.root === s.root))]
    const f = this.c.library.ownPdfPath(paperId)
    const anns = listAnnotations(this.c.db, paperId)
    const last = this.c.settings.get().cnLastPlace
    return {
      vaults,
      last: last && vaults.some((v) => v.root === last.root) ? last : null,
      size: existsSync(f) ? statSync(f).size : 0,
      marks: anns.filter(shareable).length,
      asks: listChats(this.c.db, paperId).filter((m) => m.role === 'user').length,
      readAt: p.progress > 0 ? `${Math.round(p.progress * 100)}%` : null
    }
  }

  private fileNameOf(p: Paper): string {
    const n = basename(p.fileName || `${p.title}.pdf`).replace(/[\\/:*?"<>|]/g, ' ').trim()
    return /\.pdf$/i.test(n) ? n : `${n}.pdf`
  }

  placePreview(paperId: string, root: string, folder: string): PlacePreview {
    const p = getPaper(this.c.db, paperId)
    if (!p) throw new Error(t('论文不存在'))
    const hash = (this.c.db.prepare('SELECT file_hash FROM papers WHERE id = ?').get(paperId) as { file_hash: string }).file_hash
    const names = placeNames(
      folder,
      this.fileNameOf(p),
      (rel) => existsSync(join(root, rel)),
      (rel) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex') === hash
    )
    return { pdf: names.pdf, note: names.note, renamed: names.renamed, reuse: names.reuse, noteExists: existsSync(join(root, names.note)) }
  }

  /** 放进去：PDF 拷进那个文件夹（库里已经有一模一样的就用那份），这一条指到库里那份；划线、问答、读到哪写进那篇笔记；一次提交 */
  async place(paperId: string, root: string, folder: string): Promise<PlacePreview> {
    const p = getPaper(this.c.db, paperId)
    if (!p) throw new Error(t('论文不存在'))
    if (p.kind !== 'pdf') throw new Error(t('只有 PDF 能放进画布笔记'))
    if (!existsSync(root) || (folder && !existsSync(join(root, folder)))) throw new Error(t('库里没有这个文件夹'))
    const pre = this.placePreview(paperId, root, folder)
    if (!pre.reuse) {
      mkdirSync(dirname(join(root, pre.pdf)), { recursive: true })
      copyFileSync(this.c.library.ownPdfPath(paperId), join(root, pre.pdf))
    }
    this.c.db.prepare('UPDATE papers SET vault = ?, vault_path = ? WHERE id = ?').run(root, pre.pdf, paperId)
    const link = this.linkOf(paperId)!
    // 库里已有这篇的笔记（先在画布笔记里问过）：按身份并进去，画布笔记那边的照旧
    this.syncFromNote(paperId, false)
    const secs = chatSections(link.pdf, listChats(this.c.db, paperId), (q) => pageOfText(this.c.library.pageTexts(paperId), q))
    if (secs.length) this.editNote(link, (md) => secs.reduce((m, s) => upsertSection(m, s, link.note), md), null)
    const pos = this.positionToReadAt(paperId, p)
    if (pos.page) this.readAtPut(paperId, { ...pos, addMs: p.readMs })
    await this.readAtQueue.catch(() => undefined)
    const r = this.readAtMap(root)[link.pdf]
    if (r) this.editNote(link, (md) => withReadAtProps(md, r), null)
    if (this.readNote(root, link.note) === null) this.writeNote(root, link.note, null, newReadingNote(link.pdf))
    await this.commit(root, [link.pdf, link.note], `ParaRead：放进 ${folder || basename(root)} · ${stemOf(link.pdf)}`) // 不翻：提交说明
    this.c.settings.set({ cnLastPlace: { root, folder } })
    this.c.broadcast('library:changed', null)
    return pre
  }

  // ---------------------------------------------------------------- 深链

  /** pararead://open?file=<绝对路径>&page=&vault=&back=&view=：认出这一篇（库里的不拷贝），回界面要打开的样子 */
  async open(raw: string): Promise<{ id: string; page: number | null; view: 'bilingual' | 'original' | null; back: { root: string; folder: string } | null; blockId: string | null } | null> {
    const o = parseParaReadOpen(raw)
    if (!o || !isAbsolute(o.file) || !/\.pdf$/i.test(o.file) || !existsSync(o.file)) return null
    const root = (o.vault && inside(o.vault, o.file) ? o.vault : null) ?? this.vaultsSetting().find((v) => inside(v.root, o.file))?.root ?? null
    const r = root ? await this.c.library.importFile(o.file, { link: { root, path: relPath(root, o.file) } }) : await this.c.library.importFile(o.file)
    if (r.status === 'failed') throw new Error(r.error)
    if (r.status === 'added' && !root) this.c.afterImport(r.paper.id)
    this.c.broadcast('library:changed', null)
    const id = r.paper.id
    const page = o.page ?? null
    return { id, page, view: o.view ?? null, back: root && o.back !== undefined ? { root, folder: o.back } : null, blockId: page && o.view !== 'original' ? this.blockOnPage(id, page) : null }
  }

  /** 在画布笔记里打开：这一篇的笔记、PDF 那一页，或者回到来的那个文件夹首页 */
  openInCn(paperId: string | null, what: 'note' | 'pdf' | 'folder', o: { page?: number; folder?: string } = {}): string {
    const link = paperId ? this.linkOf(paperId) : null
    const file = what === 'folder' ? (o.folder ?? '') : what === 'note' ? link?.note : link?.pdf
    if (file === undefined) throw new Error(t('这篇不在画布笔记库里'))
    const url = canvasNotesOpenUrl(file, what === 'pdf' ? o.page : undefined)
    void shell.openExternal(url)
    return url
  }

  // ---------------------------------------------------------------- 从老版本迁过来

  private migrationFile(): string {
    return join(this.c.dataDir, MIGRATION_FILE)
  }
  private loadMigration(): Migration | null {
    const f = this.migrationFile()
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Migration) : null
  }
  private saveMigration(m: Migration): void {
    writeFileSync(this.migrationFile(), JSON.stringify(m))
  }
  migrationView(): CnMigrationView | null {
    const m = this.loadMigration()
    return m ? { at: m.at, kinds: m.rows.length, notes: m.notes.length, papers: m.papers.length, undone: m.undone } : null
  }

  /**
   * 迁一次（启动时、连上一个库时）：老的高亮按颜色换成含义（颜色跟着含义走，红色没标签的算重点，原来的颜色记下来）；
   * 文献库里和连上的库里一模一样的那几篇指到库里那份，ParaRead 里的划线、问答写进那篇笔记（写之前的字记下来）。
   * 撤回过就不再自己迁（设置里「重新迁」）。老数据（ParaRead 自己存的 PDF、讲解、自己写的话）一样不删
   */
  migrate(force = false): CnMigrationView | null {
    let m = this.loadMigration()
    if (m?.undone && !force) return this.migrationView()
    if (!m || m.undone) m = { at: Date.now(), undone: false, rows: [], notes: [], papers: [] }
    const kinds = this.kinds(null)
    const legacy = this.c.db.prepare('SELECT id, color, label FROM annotations WHERE kind IS NULL').all() as { id: string; color: string; label: string | null }[]
    const upd = this.c.db.prepare('UPDATE annotations SET kind = ?, color = ? WHERE id = ?')
    for (const r of legacy) {
      const key = kindOf({ kind: null, label: r.label as Annotation['label'], color: r.color as Annotation['color'] })
      upd.run(key, colorOfKind(kinds, key), r.id)
      m.rows.push({ id: r.id, color: r.color })
    }
    // 连上的库里有的
    const byHash = new Map<string, { root: string; path: string }>()
    for (const v of this.vaultsSetting()) {
      if (!existsSync(v.root)) continue
      for (const folder of v.folders) {
        let ents
        try {
          ents = readdirSync(folder ? join(v.root, folder) : v.root, { withFileTypes: true })
        } catch {
          continue
        }
        for (const ent of ents) {
          if (!ent.isFile() || !/\.pdf$/i.test(ent.name)) continue
          const rel = folder ? `${folder}/${ent.name}` : ent.name
          byHash.set(createHash('sha256').update(readFileSync(join(v.root, rel))).digest('hex'), { root: v.root, path: rel })
        }
      }
    }
    const own = this.c.db.prepare('SELECT id, file_hash FROM papers WHERE vault IS NULL AND deleted = 0').all() as { id: string; file_hash: string }[]
    for (const p of own) {
      const at = byHash.get(p.file_hash)
      if (!at) continue
      const note = notePathFor(at.path)
      const before = this.readNote(at.root, note)
      this.c.db.prepare('UPDATE papers SET vault = ?, vault_path = ? WHERE id = ?').run(at.root, at.path, p.id)
      m.papers.push(p.id)
      this.syncFromNote(p.id, false)
      this.writeChats(p.id, false)
      const after = this.readNote(at.root, note)
      if (after !== null && after !== before) m.notes.push({ root: at.root, path: note, before, after })
    }
    if (!legacy.length && !m.papers.length && !this.loadMigration()) return null
    this.saveMigration(m)
    for (const root of new Set(m.notes.map((n) => n.root))) void this.commit(root, m.notes.filter((n) => n.root === root).map((n) => n.path), `ParaRead：从旧版迁过来（${m.papers.length} 篇）`) // 不翻：提交说明
    if (legacy.length || m.papers.length) this.c.broadcast('library:changed', null)
    return this.migrationView()
  }

  /** 撤回迁移：笔记还是迁完那样的换回迁之前（之后又改过的不动，数出来），论文不再指到库里，老高亮换回原来的颜色、去掉含义 */
  async undoMigration(): Promise<{ notes: number; kept: number }> {
    const m = this.loadMigration()
    if (!m || m.undone) return { notes: 0, kept: 0 }
    let notes = 0
    let kept = 0
    const paths = new Map<string, string[]>()
    for (const n of m.notes) {
      const cur = this.readNote(n.root, n.path)
      if (cur !== n.after) {
        kept++
        continue
      }
      if (n.before === null) unlinkSync(join(n.root, n.path))
      else this.writeNote(n.root, n.path, cur, n.before)
      notes++
      paths.set(n.root, [...(paths.get(n.root) ?? []), n.path])
    }
    for (const id of m.papers) {
      this.c.db.prepare('UPDATE papers SET vault = NULL, vault_path = NULL WHERE id = ?').run(id)
      this.c.db.prepare('UPDATE annotations SET hl = NULL WHERE paper_id = ?').run(id)
    }
    const back = this.c.db.prepare('UPDATE annotations SET kind = NULL, color = ? WHERE id = ?')
    for (const r of m.rows) back.run(r.color, r.id)
    for (const [root, ps] of paths) await this.commit(root, ps, 'ParaRead：撤回从旧版迁过来') // 不翻：提交说明
    this.saveMigration({ ...m, undone: true })
    this.c.broadcast('library:changed', null)
    return { notes, kept }
  }

  // ---------------------------------------------------------------- IPC

  register(): void {
    const str = (v: unknown, what: string): string => {
      if (typeof v !== 'string') throw new Error(t('{0}不对', what))
      return v
    }
    const root = (v: unknown): string => {
      const r = str(v, t('库'))
      if (!isAbsolute(r)) throw new Error(t('库的文件夹不对：{0}', r))
      return r
    }
    ipcMain.handle('cn:state', () => this.state())
    ipcMain.handle('cn:connect', (_e, r: unknown) => this.connect(root(r)))
    ipcMain.handle('cn:choose', async () => {
      const r = await this.choose()
      return r ? this.connect(r) : null
    })
    ipcMain.handle('cn:disconnect', (_e, r: unknown) => this.disconnect(root(r)))
    ipcMain.handle('cn:setFolders', (_e, r: unknown, folders: unknown) => this.setFolders(root(r), Array.isArray(folders) ? folders.filter((f): f is string => typeof f === 'string') : []))
    ipcMain.handle('cn:hide', (_e, r: unknown, path: unknown, hide: unknown) => this.setHidden(root(r), str(path, t('路径')), hide !== false))
    ipcMain.handle('cn:tree', (_e, r: unknown) => this.tree(root(r)))
    ipcMain.handle('cn:scan', () => this.scan())
    ipcMain.handle('cn:kinds', (_e, paperId: unknown) => this.kindsFor(typeof paperId === 'string' ? paperId : null))
    ipcMain.handle('cn:countKind', (_e, r: unknown, key: unknown) => this.countKind(root(r), str(key, t('颜色'))))
    ipcMain.handle('cn:renameKind', (_e, r: unknown, key: unknown, name: unknown, all: unknown) => this.renameKind(root(r), str(key, t('颜色')), str(name, t('名字')), all === true))
    ipcMain.handle('cn:link', (_e, paperId: unknown) => this.linkOf(str(paperId, t('论文'))))
    ipcMain.handle('cn:watch', (_e, paperId: unknown) => {
      const id = str(paperId, t('论文'))
      // 库里列进来、还没在 ParaRead 里开过的一篇：第一次打开时才排重排（列文件夹时不为几十篇一起跑 MinerU）
      const p = getPaper(this.c.db, id)
      if (p?.kind === 'pdf' && !p.reflow.ready && p.reflow.flash === 'none' && p.reflow.basic === 'none') this.c.afterImport(id)
      const changed = this.syncFromNote(id)
      this.watchPaper(id)
      return changed
    })
    ipcMain.handle('cn:closed', (_e, paperId: unknown) => this.closed(str(paperId, t('论文'))))
    ipcMain.handle('cn:readAt', (_e, paperId: unknown) => this.readAt(str(paperId, t('论文'))))
    ipcMain.handle('cn:placeInfo', (_e, paperId: unknown) => this.placeInfo(str(paperId, t('论文'))))
    ipcMain.handle('cn:placePreview', (_e, paperId: unknown, r: unknown, folder: unknown) => this.placePreview(str(paperId, t('论文')), root(r), str(folder, t('文件夹'))))
    ipcMain.handle('cn:place', (_e, paperId: unknown, r: unknown, folder: unknown) => this.place(str(paperId, t('论文')), root(r), str(folder, t('文件夹'))))
    ipcMain.handle('cn:openInCn', (_e, paperId: unknown, what: unknown, o: unknown) =>
      this.openInCn(typeof paperId === 'string' ? paperId : null, what === 'pdf' || what === 'folder' ? what : 'note', (o && typeof o === 'object' ? o : {}) as { page?: number; folder?: string })
    )
    ipcMain.handle('cn:migrate', () => this.migrate(true))
    ipcMain.handle('cn:undoMigration', () => this.undoMigration())
    ipcMain.handle('cn:settled', () => this.settled())
  }
}

/**
 * 读到哪.json 不进 Git（翻一页写一次）：写进这个库自己的 .git/info/exclude（不碰用户的 .gitignore），和画布笔记同一个做法
 * （apps/notes 的 main/reading/highlights.ts keepOutOfGit）
 */
function keepOutOfGit(root: string): void {
  const git = join(root, '.git')
  if (!existsSync(git) || !statSync(git).isDirectory()) return
  const ex = join(git, 'info', 'exclude')
  const line = `/${READ_AT_FILE}`
  const cur = existsSync(ex) ? readFileSync(ex, 'utf8') : ''
  if (cur.split('\n').includes(line)) return
  mkdirSync(dirname(ex), { recursive: true })
  writeFileSync(ex, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
}
