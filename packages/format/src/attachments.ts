/**
 * 附件按文档分文件夹（CN-40 A）：一篇笔记的图存在 `附件/<笔记路径去掉 .md>/`，例如 `附件/课程/ecp/Lecture05 笔记/截图 1.png`。
 * 改名、移动笔记时文件夹跟着挪，笔记里的相对链接跟着改（这里只算文字，挪文件在主进程）。
 */
import { relativeLink, resolveLink } from './blocks'

export const ATTACHMENTS_DIR = '附件'

/** 这篇笔记的附件文件夹 */
export function attachmentDir(notePath: string): string {
  return `${ATTACHMENTS_DIR}/${notePath.replace(/\.md$/i, '')}`
}

/** md 链接和图片里的地址：[字](地址) / ![说明](地址 "标题") */
const LINK = /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\s*\))/g

/**
 * 笔记从 oldPath 挪到 newPath（改名或换文件夹）后改它里面的相对链接：
 * - 指向自己附件文件夹（movedDir 给了时）里的，换到新文件夹；
 * - 换了文件夹以后断掉的相对链接（别的附件、别的笔记），按新位置重算；
 * 网址、没断的链接一个字都不动。
 */
export function relinkMovedNote(text: string, oldPath: string, newPath: string, movedDir?: { from: string; to: string }): string {
  return text.replace(LINK, (all, head: string, raw: string, tail: string) => {
    const angle = raw.startsWith('<')
    const link = angle ? raw.slice(1, -1) : raw
    const target = resolveLink(oldPath, link)
    if (!target) return all
    let next = target
    if (movedDir && (target === movedDir.from || target.startsWith(movedDir.from + '/'))) next = movedDir.to + target.slice(movedDir.from.length)
    if (resolveLink(newPath, link) === next) return all
    const rel = relativeLink(newPath, next)
    return head + (angle ? `<${rel}>` : rel) + tail
  })
}

// ---------------------------------------------------------------- 老图挪进各篇自己的文件夹（梦游，2026-11-17 用户定）

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i

/** 一张挪的图：从哪到哪、哪篇在用、在那篇的哪一节（往上最近的标题，没有就是「开头」） */
export interface OldImageMove {
  from: string
  to: string
  note: string
  section: string
}

/** 不挪的：几篇共用（不复制、不挑一篇）/ 没有哪篇在用 / 那篇在收件箱（等归类以后再挪）/ 那篇的文件夹里已有同名的 */
export interface OldImageKept {
  path: string
  why: 'shared' | 'unused' | 'inbox' | 'clash'
  notes: string[]
}

export interface OldImagePlan {
  moves: OldImageMove[]
  kept: OldImageKept[]
  /** 改了链接的笔记：新全文和每处改动（原来的地址 → 新地址） */
  edits: { note: string; text: string; links: { before: string; after: string }[] }[]
}

/**
 * 「附件/」根目录平铺的老图（以前没按篇分文件夹时存的）挪进引用它的那篇自己的附件文件夹 `附件/<笔记路径>/`，图不改名，
 * 笔记里指向它的相对链接跟着改，别的字一个不动。两篇以上共用的、没人用的留在原处。只算，不动文件。
 * files：库里所有文件的相对路径（判断老图和同名冲突）；notes：要看的笔记（跳过的笔记不给就行）。
 */
export function planOldImages(notes: { path: string; text: string }[], files: string[], opts: { hold?: (note: string) => boolean } = {}): OldImagePlan {
  const old = files.filter((f) => f.startsWith(ATTACHMENTS_DIR + '/') && !f.slice(ATTACHMENTS_DIR.length + 1).includes('/') && IMAGE_EXT.test(f)).sort()
  const isOld = new Set(old)
  const users = new Map<string, Map<string, string>>()
  for (const n of notes) {
    const lines = n.text.split('\n')
    let heading = ''
    for (const line of lines) {
      const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
      if (h) heading = h[1]!
      for (const m of line.matchAll(LINK)) {
        const raw = m[2]!.startsWith('<') ? m[2]!.slice(1, -1) : m[2]!
        const target = resolveLink(n.path, raw.replace(/#.*$/, ''))
        if (!target || !isOld.has(target)) continue
        const u = users.get(target) ?? new Map<string, string>()
        if (!u.has(n.path)) u.set(n.path, heading || '开头')
        users.set(target, u)
      }
    }
  }
  const have = new Set(files)
  const plan: OldImagePlan = { moves: [], kept: [], edits: [] }
  const byNote = new Map<string, Map<string, string>>()
  for (const img of old) {
    const u = users.get(img)
    if (!u) {
      plan.kept.push({ path: img, why: 'unused', notes: [] })
      continue
    }
    const list = [...u.keys()].sort()
    if (list.length > 1) {
      plan.kept.push({ path: img, why: 'shared', notes: list })
      continue
    }
    const note = list[0]!
    if (opts.hold?.(note)) {
      plan.kept.push({ path: img, why: 'inbox', notes: list })
      continue
    }
    const to = `${attachmentDir(note)}/${img.split('/').pop()}`
    if (have.has(to)) {
      plan.kept.push({ path: img, why: 'clash', notes: list })
      continue
    }
    plan.moves.push({ from: img, to, note, section: u.get(note)! })
    const m = byNote.get(note) ?? new Map<string, string>()
    m.set(img, to)
    byNote.set(note, m)
  }
  for (const n of notes) {
    const moved = byNote.get(n.path)
    if (!moved) continue
    const links: { before: string; after: string }[] = []
    const text = n.text.replace(LINK, (all, head: string, raw: string, tail: string) => {
      const angle = raw.startsWith('<')
      const link = angle ? raw.slice(1, -1) : raw
      const hash = /#.*$/.exec(link)?.[0] ?? ''
      const target = resolveLink(n.path, link.slice(0, link.length - hash.length))
      const to = target ? moved.get(target) : undefined
      if (!to) return all
      const rel = relativeLink(n.path, to) + hash
      const next = head + (angle ? `<${rel}>` : rel) + tail
      links.push({ before: all, after: next })
      return next
    })
    plan.edits.push({ note: n.path, text, links })
  }
  return plan
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|heic|bmp)$/i

/** 链接里的地址换成库里的路径：去掉尖括号、#页码、?参数；网址和跳出库的是 null */
function linkTarget(notePath: string, raw: string): string | null {
  const link = (raw.startsWith('<') ? raw.slice(1, -1) : raw).replace(/[#?].*$/, '')
  return link ? resolveLink(notePath, link) : null
}

export interface ImageRef {
  /** 库里的路径 */
  path: string
  /** 在哪一节：上面最近的标题；标题前面的写「第 N 段」 */
  where: string
  /** 在原文里的位置（跳到文中那一处） */
  offset: number
}

/**
 * 一篇笔记里用到的图，按在文中出现的先后，同一张只算第一次（「属性」里列附件、删笔记时数图用）；
 * all：用了几处列几处（附件弹层里点一张图，一处一处跳过去）。代码块和开头的属性里的不算。
 */
export function imageRefs(text: string, notePath: string, all = false): ImageRef[] {
  const out: ImageRef[] = []
  const seen = new Set<string>()
  let heading: string | null = null
  let para = 0
  let blank = true
  let fence = false
  let offset = 0
  const fm = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0].length ?? 0
  for (const line of text.split('\n')) {
    const at = offset
    offset += line.length + 1
    if (at < fm) continue
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    // 一级标题是这篇的名字，不算一节；二级往下才是「在哪一节」
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      if (h[1]!.length > 1) heading = h[2]!
      blank = true
      continue
    }
    if (!line.trim()) {
      blank = true
      continue
    }
    if (blank) para++
    blank = false
    for (const m of line.matchAll(/!\[[^\]\n]*\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g)) {
      const p = linkTarget(notePath, m[1]!)
      if (!p || !IMAGE.test(p) || (!all && seen.has(p))) continue
      seen.add(p)
      out.push({ path: p, where: heading ?? `第 ${para} 段`, offset: at + m.index! })
    }
  }
  return out
}

/** 一篇笔记里所有指向库里文件的相对链接（图片和普通链接都算）：删图前查「别的笔记也在用」 */
export function linkedPaths(text: string, notePath: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(LINK)) {
    const p = linkTarget(notePath, m[2]!)
    if (p) out.add(p)
  }
  return out
}

// ---------------------------------------------------------------- 一个附件谁在用（删笔记留不留、「没人用的附件」，2026-11-23 附件跟着笔记走）

/**
 * 文中提到的一个文件：先按 cands（库里的路径）找；都不在库里时按 name（去掉 ./ ../ 的名字或尾巴）认尾巴对得上的，
 * 写明了是链接的（loose：md 链接、[[嵌入]]、src）尾巴也对不上再认所有同名的，宁可多认
 */
export interface FileRef {
  cands: string[]
  name: string
  loose: boolean
}

const WIKI = /\[\[([^\]|#^\n]+)/g
const ATTR_URL = /\b(?:src|href|data-src|poster|xlink:href)\s*=\s*(?:"([^"\n]+)"|'([^'\n]+)')/gi
/** 带扩展名的一段字（属性里的封面、JSON、白板卡片、写坏了的链接）：不含空白和括号引号 */
const RAW = /[^\s"'`()<>[\]{}|*!,;]+\.[A-Za-z0-9]{1,10}(?![A-Za-z0-9])/g

const decoded = (s: string) => {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}
/** 名字兜底：去掉开头的 ./ ../ /，#、? 后面的不要 */
const looseName = (s: string) => decoded(s.replace(/[#?].*$/, '')).replace(/^(?:\.{1,2}\/|\/)+/, '')

/**
 * 一篇（或库里任何一个文字文件）提到的文件：md 链接和图片、[[双链]] / ![[嵌入]]、HTML 的 src / href、
 * 还有任何一段带扩展名的字（属性里的封面、白板卡片、JSON 里的路径）。只算字，不看磁盘；按库里有哪些文件认用 refHits。
 */
export function fileRefs(text: string, from: string): FileRef[] {
  const out: FileRef[] = []
  const add = (raw: string, wiki = false, loose = true) => {
    const link = (raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw).trim()
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) return
    const name = looseName(link)
    if (!name) return
    const cands = new Set<string>()
    const rel = linkTarget(from, link)
    if (rel) cands.add(rel)
    if (wiki || !link.startsWith('.')) cands.add(name)
    out.push({ cands: [...cands], name, loose })
  }
  for (const m of text.matchAll(LINK)) add(m[2]!)
  for (const m of text.matchAll(WIKI)) add(m[1]!, true)
  for (const m of text.matchAll(ATTR_URL)) add(m[1] ?? m[2]!)
  // 一段带扩展名的字可能是带空格的链接的后半截（「Lecture05 笔记/截图%201.png」）：只认尾巴，不按文件名认
  for (const m of text.matchAll(RAW)) add(m[0], false, false)
  return out
}

/**
 * fileRefs 在这些文件里认到的：路径对得上的就是它；一个都对不上（写坏了的链接、按名字的 [[嵌入]]）就认所有同名的（名字带路径时先认尾巴对得上的，尾巴也对不上再只看文件名）。
 * byName：小写文件名 → 那些文件（fileNameIndex 建）
 */
export function refHits(refs: FileRef[], files: ReadonlySet<string>, byName: ReadonlyMap<string, string[]>): Set<string> {
  const hit = new Set<string>()
  for (const r of refs) {
    let found = false
    for (const c of r.cands)
      if (files.has(c)) {
        hit.add(c)
        found = true
      }
    if (found) continue
    const low = r.name.toLowerCase()
    const same = byName.get(low.slice(low.lastIndexOf('/') + 1)) ?? []
    const tail = same.filter((p) => {
      const l = p.toLowerCase()
      return l === low || l.endsWith('/' + low)
    })
    // 尾巴也对不上（文件夹改过名的旧链接）：写明了是链接的只看文件名
    for (const p of tail.length || !r.loose ? tail : same) hit.add(p)
  }
  return hit
}

/** 小写文件名 → 库里那些文件（refHits 用） */
export function fileNameIndex(files: Iterable<string>): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const p of files) {
    const k = p.slice(p.lastIndexOf('/') + 1).toLowerCase()
    const list = m.get(k)
    if (list) list.push(p)
    else m.set(k, [p])
  }
  return m
}

/**
 * 附件归哪篇：附件/<笔记路径>/ 最长的那个前缀对上的、现在还在的那篇（「冰岛旅行.md」和「冰岛旅行/ttravel.md」都在时，
 * 附件/冰岛旅行/ttravel/ 里的归 ttravel）。没有就是 null
 */
export function attachOwner(path: string, isNote: (note: string) => boolean): string | null {
  if (!path.startsWith(ATTACHMENTS_DIR + '/')) return null
  const segs = path.slice(ATTACHMENTS_DIR.length + 1).split('/').slice(0, -1)
  for (let n = segs.length; n > 0; n--) {
    const note = segs.slice(0, n).join('/') + '.md'
    if (isNote(note)) return note
  }
  return null
}
