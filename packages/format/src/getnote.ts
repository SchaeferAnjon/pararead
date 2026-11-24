/**
 * Get笔记 的一篇怎么写成库里的 md（同步来源第一家，设计页 61-同步来源第 4 节「一篇的写法」）。纯函数，不依赖 Electron。
 *
 * 属性名照用户库里已有的 500 篇（title、note_type、getnote_id、url、tags、created、updated、synced），只多一个 getnote_url：
 *
 *   ---
 *   title: "十年老 Kindle 越狱复活"
 *   note_type: link
 *   getnote_id: 1925789669321169464
 *   url: "https://mp.weixin.qq.com/s?__biz=…&mid=…&idx=1&sn=…"
 *   getnote_url: https://www.biji.com/note/1925789669321169464
 *   tags: ["Kindle 越狱", "微信读书墨水屏"]
 *   created: 2026-11-01 19:09:53
 *   updated: 2026-11-01 19:09:53
 *   synced: 2026-11-23 17:51:55
 *   ---
 *   # 🔗 十年老 Kindle 越狱复活
 *
 *   （Get笔记 的 AI 总结，原样）
 *
 *   > [!quote]- 原文（2683 字）            链接笔记
 *   > [!note]- 录音转写（7:51）            录音笔记
 *   ## 图片                                 图片笔记
 *   ## 追加 · 2026-10-02 10:00              子笔记，按时间
 *
 *   来源：[原文](…) · [在 Get笔记 里打开](…)
 *
 * 老写法的四处毛病，新写法都避开（设计页第 1 节，测试 test/getnote.test.ts）：
 * 图片链到 Get笔记 的临时地址（一个月后 403）→ 下进附件写相对链接；录音时间点写成 getnotes.seek 假链接 → 写成 `00:02:08`；
 * 微信文章网址带一千多字的跟踪参数 → 只留 __biz、mid、idx、sn；表格前面不空行 md 不认 → 补一个空行。
 */
import { relativeLink } from './blocks'
import { type RemoteItem, sourceFileName, stamp } from './sync-source'

export const GETNOTE_ID = 'getnote_id'
export const GETNOTE_IDS = 'getnote_ids'
export const GETNOTE_DELETED = 'getnote_deleted'
export const GETNOTE_NEWER = 'getnote_newer'

/** 录音类的几种（课堂、会议、本地音频…） */
const AUDIO = new Set(['audio', 'meeting', 'local_audio', 'internal_record', 'class_audio', 'recorder_audio', 'recorder_flash_audio'])
// 不翻：写进文件的标题行（照用户老笔记的样子）
const EMOJI: Record<string, string> = { link: '🔗', img_text: '🖼️', plain_text: '📝', class_audio: '🎓' }

export interface GnTag {
  name: string
  type: string
}
export interface GnAttachment {
  type: string
  url: string
  title?: string
  duration?: number
  original_url?: string
}

/** 接口回来的一篇（列表、详情一个样子；详情多几样） */
export interface GnNote {
  id: string
  title: string
  content: string
  note_type: string
  tags: GnTag[]
  created_at: string
  updated_at: string
  note_url: string
  children_ids: string[]
  children_count: number
  attachments: GnAttachment[]
  web_page: { url?: string; content?: string } | null
  audio: { original?: string } | null
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** 接口里的一篇 → GnNote（id 一律字符串：looseJson 把大整数读成了字符串，note_id 本来就是字符串） */
export function gnNoteOf(raw: unknown): GnNote {
  const o = (raw ?? {}) as Record<string, unknown>
  const n = (o.note && typeof o.note === 'object' ? o.note : o) as Record<string, unknown>
  const id = str(n.note_id) || str(n.id)
  if (!/^\d+$/.test(id)) throw new Error('Get笔记 回来的一篇没有 id')
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    id,
    title: str(n.title).trim(),
    content: str(n.content),
    note_type: str(n.note_type) || 'plain_text',
    tags: list<Record<string, unknown>>(n.tags).map((t) => ({ name: str(t.name), type: str(t.type) })),
    created_at: str(n.created_at),
    updated_at: str(n.updated_at) || str(n.created_at),
    note_url: str(n.note_url) || `https://www.biji.com/note/${id}`,
    children_ids: list<unknown>(n.children_ids).map(str).filter((x) => /^\d+$/.test(x)),
    children_count: typeof n.children_count === 'number' ? n.children_count : 0,
    attachments: list<Record<string, unknown>>(n.attachments).map((a) => ({
      type: str(a.type),
      url: str(a.url),
      ...(a.title ? { title: str(a.title) } : {}),
      ...(typeof a.duration === 'number' ? { duration: a.duration } : {}),
      ...(a.original_url ? { original_url: str(a.original_url) } : {}),
    })),
    web_page: n.web_page && typeof n.web_page === 'object' ? { url: str((n.web_page as Record<string, unknown>).url), content: str((n.web_page as Record<string, unknown>).content) } : null,
    audio: n.audio && typeof n.audio === 'object' ? { original: str((n.audio as Record<string, unknown>).original) } : null,
  }
}

/** 空录音：录音类，AI 说了时长 0 秒、或「空白」「无有效」（设计页：29 篇新的里 2 篇） */
export function gnIsEmpty(n: Pick<GnNote, 'note_type' | 'title' | 'content'>): boolean {
  if (!AUDIO.has(n.note_type)) return false
  const head = n.title + '\n' + n.content.slice(0, 800)
  return /时长\**[：:]\s*0\s*秒/.test(head) || /无有效|空白语音|录音内容空白|内容空白/.test(head)
}

/** 列表里的一篇 → 通用的 RemoteItem */
export function gnItem(n: GnNote): RemoteItem {
  return { id: n.id, title: gnTitle(n), kind: n.note_type, created: n.created_at, updated: n.updated_at, empty: gnIsEmpty(n) }
}

/** 标题：没写标题的用正文第一行（去掉 md 记号），再没有用「Get笔记 时间」 */
export function gnTitle(n: Pick<GnNote, 'title' | 'content' | 'created_at'>): string {
  if (n.title.trim()) return n.title.trim()
  for (const l of n.content.split('\n')) {
    const s = l
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[#>*\-\s]+|[*_`]/g, '')
      .trim()
    if (s) return [...s].slice(0, 40).join('')
  }
  // 不翻：写进文件的标题
  return `Get笔记 ${n.created_at.slice(0, 16)}`
}

/** 文件名（不带 .md） */
export const gnFileName = (n: Pick<GnNote, 'title' | 'content' | 'created_at'>) => sourceFileName(gnTitle(n)) || sourceFileName(`Get笔记 ${n.created_at.slice(0, 16)}`)

/** 微信文章的网址只留认文章的四个参数（__biz、mid、idx、sn）；别的网址原样 */
export function cleanSourceUrl(u: string): string {
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return u
  }
  if (url.hostname !== 'mp.weixin.qq.com') return u
  const keep = ['__biz', 'mid', 'idx', 'sn']
  // __biz 末尾的 == 照原样留着（不转成 %3D%3D，和微信自己给的链接一个样）
  const q = keep.filter((k) => url.searchParams.has(k)).map((k) => `${k}=${encodeURIComponent(url.searchParams.get(k)!).replace(/%3D/g, '=')}`)
  // 一个认文章的参数都没有（只有 chksm 这类跟踪的）：没法缩，原样留着能打开
  if (!q.length) return u
  return `${url.origin}${url.pathname}?${q.join('&')}`
}

/** 正文里的图（![](https://…)），按出现的先后 */
export function gnBodyImages(md: string): string[] {
  return [...md.matchAll(/!\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]!)
}

/** 这一篇要下的图：正文里的、图片笔记附件里的、子笔记里的、链接原文里的（original：带原文时；去重，按先后） */
export function gnImages(n: GnNote, children: readonly GnNote[] = [], original = true): string[] {
  const all = [
    ...gnBodyImages(n.content),
    ...n.attachments.filter((a) => a.type === 'image').map((a) => a.original_url || a.url),
    ...children.flatMap((c) => gnBodyImages(c.content)),
    ...(original && n.note_type === 'link' ? gnBodyImages(n.web_page?.content ?? '') : []),
  ]
  return [...new Set(all.filter(Boolean))]
}

/**
 * 正文修三处：图换成库里的相对链接（local 给了这张图的库里路径时；没下的保持原地址）、
 * 假时间链接 [00:02:08](https://getnotes.seek:128) 写成 `00:02:08`、表格第一行前补空行（代码块里不动）
 */
export function gnFixBody(md: string, notePath: string, local: ReadonlyMap<string, string>): string {
  let out = md.replace(/(!\[[^\]\n]*\]\()(https?:\/\/[^)\s]+)(\))/g, (all, head: string, url: string, tail: string) => {
    const p = local.get(url)
    return p ? head + linkTo(notePath, p) + tail : all
  })
  out = out.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\(https?:\/\/getnotes\.seek(?::\d+)?[^)]*\)/g, '`$1`')
  const lines = out.split('\n')
  const fixed: string[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const prev = lines[i - 1]
    if (!fence && /^\s*\|/.test(l) && prev !== undefined && prev.trim() && !/^\s*\|/.test(prev)) fixed.push('')
    fixed.push(l)
  }
  return fixed.join('\n')
}

/** 笔记里到库里一个文件的相对链接；括号也转义（标题里的括号会截断 md 链接） */
const linkTo = (notePath: string, target: string) => relativeLink(notePath, target).replace(/\(/g, '%28').replace(/\)/g, '%29')

/** 毫秒 → 7:51 / 1:31:05 */
export function clock(ms: number): string {
  const s = Math.round(ms / 1000)
  const p = (x: number) => String(x).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`
}

/** 提示块：每行前面加「> 」，空行写「>」 */
const callout = (head: string, body: string) => `${head}\n${body.trim().split('\n').map((l) => (l.trim() ? '> ' + l : '>')).join('\n')}\n`

const q = (s: string) => JSON.stringify(s)

export interface GnRenderOpts {
  /** 写在库里的哪一篇（算图片的相对链接） */
  path: string
  /** 图的网址 → 下进库里的路径（没下的不在里面） */
  images: ReadonlyMap<string, string>
  transcript: boolean
  original: boolean
  /** 这次拉的时间（synced） */
  now: Date
}

/** 一篇（加上它的子笔记）→ 整篇 md */
export function gnMarkdown(n: GnNote, children: readonly GnNote[], o: GnRenderOpts): string {
  const title = gnTitle(n)
  const link = n.attachments.find((a) => a.type === 'link')?.url
  const src = n.note_type === 'link' ? cleanSourceUrl(n.web_page?.url || link || '') : ''
  // 系统标签（「录音笔记」「AI链接笔记」）每篇都有，不分东西，不要
  const tags = [...new Set(n.tags.filter((t) => t.type !== 'system' && t.name.trim()).map((t) => t.name.trim()))]
  const fm = [
    '---',
    `title: ${q(title)}`,
    `note_type: ${n.note_type}`,
    `${GETNOTE_ID}: ${n.id}`,
    ...(src ? [`url: ${q(src)}`] : []),
    `getnote_url: ${n.note_url}`,
    `tags: [${tags.map(q).join(', ')}]`,
    `created: ${n.created_at}`,
    `updated: ${n.updated_at}`,
    `synced: ${stamp(o.now)}`,
    '---',
  ]
  const parts: string[] = [`# ${AUDIO.has(n.note_type) && n.note_type !== 'class_audio' ? '🎙️' : (EMOJI[n.note_type] ?? '📝')} ${title}`, gnFixBody(n.content.trim(), o.path, o.images)]
  const imgs = n.attachments.filter((a) => a.type === 'image').map((a) => a.original_url || a.url)
  if (imgs.length) {
    // 不翻：写进文件的小标题
    parts.push('## 图片\n\n' + imgs.map((u) => `![](${o.images.has(u) ? linkTo(o.path, o.images.get(u)!) : u})`).join('\n\n'))
  }
  if (o.original && n.note_type === 'link' && n.web_page?.content?.trim()) {
    const c = n.web_page.content.trim()
    // 不翻：写进文件的提示块（原文里的图也下进附件：真拉时一篇微信文章原文里 5 张图都是会过期的地址）
    parts.push(callout(`> [!quote]- 原文（${[...c].length} 字）`, gnFixBody(c, o.path, o.images)).trimEnd())
  }
  const said = n.audio?.original?.trim()
  if (o.transcript && AUDIO.has(n.note_type) && said) {
    const ms = n.attachments.find((a) => a.type === 'audio' && a.duration)?.duration
    // 不翻：写进文件的提示块
    parts.push(callout(`> [!note]- 录音转写${ms ? `（${clock(ms)}）` : ''}`, said).trimEnd())
  }
  for (const c of [...children].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    // 不翻：写进文件的小标题
    parts.push(`## ${c.title.trim() || '追加'} · ${c.created_at.slice(0, 16)}\n\n${gnFixBody(c.content.trim(), o.path, o.images)}`)
  }
  // 来源行放文末：放开头会占掉文件夹首页和搜索结果的摘要（设计页第 2 节图 6）
  const open = `[${AUDIO.has(n.note_type) ? '在 Get笔记 里听' : '在 Get笔记 里打开'}](${n.note_url})`
  // 不翻：写进文件的来源行
  parts.push(`来源：${src ? `[原文](${src}) · ` : ''}${open}`)
  return fm.join('\n') + '\n' + parts.filter((p) => p.trim()).join('\n\n') + '\n'
}

/** 图的扩展名：按文件头认（png / jpg / gif / webp），认不出当 jpg */
export function imageExt(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  return 'jpg'
}
