/**
 * MeetCaption 和画布笔记之间的写法（MeetCaption 联动，设计 24-meetcaption联动「已定（2026-11-23）」）：两边都调这一份。
 *
 * 上课记录（每场课、每场会一篇；一天里同一项目的几段并成一篇，属性里几场就几段）：
 *
 *   ---
 *   类型: 上课记录
 *   课程: ecp
 *   模式: 课堂
 *   日期: 2026-11-04
 *   时长: "2:30"
 *   meetcaption: ["2026-11-04 09.29", "2026-11-04 11.05"]
 *   录音: [".canvas-notes/录音/<这一篇的路径，去掉 .md>/录音-1.webm", …]   ← 「<库名>-录音」独立仓库，挂在库里这一处，Git LFS
 *   字幕: [".canvas-notes/字幕/meetcaption/2026-11-04 09.29.vtt", …]       ← 字幕全文，双语，普通 Git
 *   ---
 *   # 2026-11-04 近似加法器与 CDM8 乘法器
 *   > [!ai] 这节课讲了什么 · MeetCaption · DeepSeek          ← MeetCaption 写的块都带框，头一行写明 MeetCaption
 *   > …
 *   ## 作业
 *   - [ ] 列出 … [▶ 09:43](meetcaption://open?session=2026-11-04%2009.29&t=840) 📅 2026-11-11   ← 时间放在 📅 前面
 *   ## 第 1 段 · 09:29
 *   ### 近似计算的动机 [▶ 09:29](meetcaption://open?session=2026-11-04%2009.29&t=0)
 *   ![关键画面 09:41:12](../../.canvas-notes/录音/<这一篇的路径，去掉 .md>/画面-09.41.12.jpg)   ← 相对这一篇，和别的图一样
 *
 * 「录音」「字幕」第 i 个对「meetcaption」第 i 场；▶ 的 t 是那一场开始后的秒数，字是那一刻的钟点。
 * 关键画面（课堂、网课自动截）文件名是钟点（画面-HH.MM.SS.jpg），放在录音那一处旁边。
 * 录音放哪由 MeetCaption 写进 .canvas-notes/meetcaption.json 的 audio：{ store: 'local' | 'lfs' | 'icloud', path: '.canvas-notes/录音', remote?, icloud?（相对 iCloud 云盘） }；
 * 三种存法笔记里的「录音」路径都一样（icloud 时 .canvas-notes/录音 是指向 iCloud 文件夹的替身，lfs 时是单独的 Git 仓库）。MeetCaption 那份 JS 抄本：apps/meetcaption/src/main/canvas/format.js。
 * 纯函数，不碰 Electron、Node。
 */
import { readPropList, prop } from './props'

/** MeetCaption 的五种模式（它首页那五张卡）；写进属性「模式」用中文 */
export type McMode = 'class' | 'online' | 'meeting' | 'interview' | 'video'
export const MC_MODE_NAMES: Record<McMode, string> = { class: '课堂', online: '网课', meeting: '会议', interview: '面试', video: '视频' }
/** 听哪路声音：课堂只听麦克风（教室现场），网课听电脑的声音 */
export const MC_MODE_SOURCE: Record<McMode, 'mic' | 'system'> = { class: 'mic', online: 'system', meeting: 'system', interview: 'system', video: 'system' }
export const isMcMode = (v: unknown): v is McMode => typeof v === 'string' && v in MC_MODE_NAMES
export function mcModeOf(name: string | undefined): McMode | undefined {
  if (!name) return undefined
  if (isMcMode(name)) return name
  return (Object.keys(MC_MODE_NAMES) as McMode[]).find((k) => MC_MODE_NAMES[k] === name)
}

// ---------- 深链 ----------

const q = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

/** 画布笔记 → MeetCaption：开始上课 / 开会。back：开始时在哪个文件夹首页（下课「在画布笔记里继续」带回来） */
export function mcStartUrl(o: { project: string; mode: McMode; source?: 'mic' | 'system'; back?: string }): string {
  return `meetcaption://start?${q({ project: o.project, mode: o.mode, source: o.source ?? MC_MODE_SOURCE[o.mode], back: o.back })}`
}

/** 画布笔记 → MeetCaption：打开那一场（t 秒；view=screen 看录屏那一秒） */
export function mcOpenUrl(o: { session: string; t?: number; view?: 'screen' }): string {
  return `meetcaption://open?${q({ session: o.session, t: o.t === undefined ? undefined : Math.max(0, Math.floor(o.t)), view: o.view })}`
}

/** 笔记里的 ▶ 时间：认不出是 null */
export function parseMcOpen(url: string): { session: string; t: number } | null {
  const m = /^meetcaption:\/\/open\?(.*)$/.exec(url.trim())
  if (!m) return null
  const p = new URLSearchParams(m[1]!.replace(/\+/g, '%2B'))
  const session = p.get('session')
  const t = Number(p.get('t') ?? 0)
  return session && Number.isFinite(t) && t >= 0 ? { session, t: Math.floor(t) } : null
}

/**
 * MeetCaption → 画布笔记，两种：
 * - canvas-notes://open?file=<库里的路径>&t=<秒>&session=<场>&back=<文件夹>&vault=<库的文件夹>：打开那一篇、滚到那个时间点（back 给了先回那个文件夹首页）
 * - canvas-notes://meetcaption?session=<场>&t=<秒>：只知道哪一场时，画布笔记自己在库里找写着这一场的那一篇
 */
export interface McJump {
  file?: string
  session?: string
  t?: number
  back?: string
  vault?: string
}
export function canvasNotesMcUrl(j: McJump): string {
  if (j.file) return `canvas-notes://open?${q({ file: j.file, t: j.t, session: j.session, back: j.back, vault: j.vault })}`
  return `canvas-notes://meetcaption?${q({ session: j.session, t: j.t, back: j.back, vault: j.vault })}`
}
export function parseCanvasNotesMc(url: string): McJump | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'canvas-notes:' || (u.hostname !== 'open' && u.hostname !== 'meetcaption')) return null
  const g = (k: string) => u.searchParams.get(k) ?? undefined
  const t = Number(g('t'))
  const j: McJump = {
    ...(u.hostname === 'open' && g('file') ? { file: g('file') } : {}),
    ...(g('session') ? { session: g('session') } : {}),
    ...(g('t') !== undefined && Number.isFinite(t) && t >= 0 ? { t: Math.floor(t) } : {}),
    ...(g('back') !== undefined ? { back: g('back') } : {}),
    ...(g('vault') ? { vault: g('vault') } : {}),
  }
  if (u.hostname === 'meetcaption' && !j.session) return null
  if (u.hostname === 'open' && !j.file) return null
  return j
}

// ---------- 时间 ----------

/** 「2026-11-04 09.29」那一场几点开始（当天 0 点起的秒）；认不出是 null */
export function sessionClock(session: string): number | null {
  const m = /(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?\s*$/.exec(session)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null
}
/** 那一场的日子「2026-11-04」 */
export const sessionDate = (session: string) => /^\d{4}-\d{2}-\d{2}/.exec(session)?.[0] ?? null

const pad = (n: number) => String(n).padStart(2, '0')
/** 秒 → 「09:43」（钟点，超过一天绕回去）；withSec 带秒 */
export function clockLabel(sec: number, withSec = false): string {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}${withSec ? ':' + pad(s % 60) : ''}`
}
/** 一场里的秒 → 播放条上的「1:02:05」「12:05」 */
export function spanLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** ▶ 时间的写法：[▶ 09:43](meetcaption://open?session=…&t=840)，字是那一刻的钟点 */
export function mcTimeLink(session: string, t: number): string {
  const c = sessionClock(session)
  return `[▶ ${c === null ? spanLabel(t) : clockLabel(c + t)}](${mcOpenUrl({ session, t })})`
}

// ---------- 上课记录 ----------

export interface McTime {
  /** 第几行（从 1 数） */
  line: number
  session: string
  t: number
  /** 显示的字「09:43」 */
  label: string
}

export interface McRecord {
  sessions: string[]
  /** 和 sessions 一一对上；缺的是 null */
  recordings: (string | null)[]
  subtitles: (string | null)[]
  mode?: McMode
  course?: string
  date?: string
  /** 属性「时长」写的（「2:30」）；没写是 undefined */
  duration?: string
  /** 正文里的每个 ▶ 时间 */
  times: McTime[]
  /** 正文里嵌的关键画面：写在链接里的路径（相对这一篇）、钟点（秒） */
  frames: { path: string; clock: number | null }[]
}

/** 这一篇是不是 MeetCaption 的上课记录（属性里有 meetcaption 那一行） */
export function isMcRecord(text: string): boolean {
  return !!readPropList(text, 'meetcaption')?.length
}

/** 录音、字幕、关键画面在库里的位置（录音仓库挂在 .canvas-notes/录音/） */
export const mcRecordingDir = (notePath: string) => `.canvas-notes/录音/${notePath.replace(/\.md$/i, '')}`
export const mcSubtitlePath = (session: string) => `.canvas-notes/字幕/meetcaption/${session}.vtt`
export const mcFrameName = (clock: number) => `画面-${clockLabel(clock, true).replace(/:/g, '.')}.jpg`
/** 「画面-09.41.12.jpg」→ 当天的秒 */
export function frameClock(name: string): number | null {
  const m = /画面-(\d{2})\.(\d{2})\.(\d{2})\.jpg$/i.exec(name)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

const LINK = /\[▶[^\]]*\]\((meetcaption:\/\/open\?[^)\s]+)\)/g
const IMG = /!\[[^\]]*\]\(([^)\s]+\.jpg)\)/gi
const dec = (s: string) => {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

export function readMcRecord(text: string): McRecord | null {
  const sessions = readPropList(text, 'meetcaption')
  if (!sessions?.length) return null
  const recs = readPropList(text, '录音') ?? []
  const subs = readPropList(text, '字幕') ?? []
  const times: McTime[] = []
  const frames: McRecord['frames'] = []
  const lines = text.split('\n')
  lines.forEach((l, i) => {
    for (const m of l.matchAll(LINK)) {
      const o = parseMcOpen(m[1]!)
      if (o) times.push({ line: i + 1, ...o, label: /\[▶\s*([^\]]*)\]/.exec(m[0])![1]!.trim() })
    }
    for (const m of l.matchAll(IMG)) if (frameClock(dec(m[1]!)) !== null) frames.push({ path: m[1]!, clock: frameClock(dec(m[1]!)) })
  })
  const mode = mcModeOf(prop(text, '模式'))
  return {
    sessions,
    recordings: sessions.map((_, i) => recs[i] || null),
    subtitles: sessions.map((s, i) => subs[i] || mcSubtitlePath(s)),
    ...(mode ? { mode } : {}),
    ...(prop(text, '课程') ? { course: prop(text, '课程') } : {}),
    ...(prop(text, '日期') ? { date: prop(text, '日期') } : {}),
    ...(prop(text, '时长') ? { duration: prop(text, '时长') } : {}),
    times,
    frames,
  }
}

/** 这一刻（哪一场、第几秒）在正文里落在哪一行：同一场里不晚于它的最后一个 ▶；都晚于它就是这一场的第一个；没这一场是 null */
export function lineAtTime(rec: McRecord, session: string, t: number): number | null {
  const same = rec.times.filter((x) => x.session === session)
  if (!same.length) return null
  const before = same.filter((x) => x.t <= t).sort((a, b) => b.t - a.t || a.line - b.line)[0]
  return (before ?? [...same].sort((a, b) => a.t - b.t)[0]!).line
}

/** 一个钟点（关键画面）落在哪一场的第几秒：开始不晚于它的最后一场 */
export function clockToSession(sessions: string[], clock: number): { session: string; t: number } | null {
  let best: { session: string; t: number } | null = null
  for (const s of sessions) {
    const c = sessionClock(s)
    if (c !== null && c <= clock && (!best || clock - c < best.t)) best = { session: s, t: clock - c }
  }
  return best
}

/** 「2:30」→ 150 分钟；认不出是 null */
export function durationMinutes(d: string | undefined): number | null {
  const m = d ? /^(\d+):(\d{2})$/.exec(d.trim()) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// ---------- 字幕全文（WebVTT，双语：一句一条，第一行原文、第二行译文；说话人写 <v 名字>） ----------

export interface McCue {
  start: number
  end: number
  text: string
  tr?: string
  who?: string
}

const TS = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/
const secOf = (s: string) => {
  const m = TS.exec(s.trim())
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : NaN
}

export function parseVtt(text: string): McCue[] {
  const out: McCue[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at === -1) continue
    const [a, z] = lines[at]!.split('-->')
    const start = secOf(a!)
    const end = secOf(z!.trim().split(/\s+/)[0]!)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const body = lines.slice(at + 1)
    if (!body.length) continue
    let who: string | undefined
    const first = body[0]!.replace(/^<v(?:\.[^\s>]*)?\s+([^>]+)>/, (_m, w: string) => ((who = w.trim()), ''))
    const strip = (s: string) => s.replace(/<\/?[^>]+>/g, '').trim()
    out.push({ start, end, text: strip(first), ...(body[1] ? { tr: strip(body.slice(1).join(' ')) } : {}), ...(who ? { who } : {}) })
  }
  return out
}

export function writeVtt(cues: McCue[]): string {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000)
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${String(ms % 1000).padStart(3, '0')}`
  }
  return 'WEBVTT\n\n' + cues.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.who ? `<v ${c.who}>` : ''}${c.text}${c.tr ? '\n' + c.tr : ''}`).join('\n\n') + '\n'
}

/** 这一秒落在哪一句（不晚于它开始的最后一句） */
export function cueAt(cues: McCue[], t: number): number {
  let lo = 0
  let hi = cues.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid]!.start <= t + 0.001) (ans = mid), (lo = mid + 1)
    else hi = mid - 1
  }
  return ans
}

// ---------- 写一篇（MeetCaption 下课写进库时用；测试的样本也用它） ----------

export interface McRecordDraft {
  /** 这一篇在库里的路径（录音那一处跟着它） */
  path: string
  title: string
  course?: string
  mode: McMode
  sessions: string[]
  duration?: string
  /** MeetCaption 写的概览（放进带框带身份的块） */
  overview?: { text: string; engine?: string }
  /** 作业：一行一件，t 是这句话在第几场第几秒，due 是 YYYY-MM-DD */
  todos?: { text: string; session: string; t: number; due?: string }[]
  /** 每一场里的小节：标题、开始的秒、老师讲的点、关键画面（钟点） */
  parts?: { session: string; sections: { title: string; t: number; points?: { text: string; t: number }[]; frames?: number[] }[] }[]
}

export function writeMcRecord(d: McRecordDraft): string {
  const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`
  const dir = mcRecordingDir(d.path)
  const up = '../'.repeat(d.path.split('/').length - 1)
  const fm = [
    '---',
    `类型: ${d.mode === 'meeting' ? '会议记录' : d.mode === 'interview' ? '面试记录' : '上课记录'}`,
    ...(d.course ? [`课程: ${d.course}`] : []),
    `模式: ${MC_MODE_NAMES[d.mode]}`,
    `日期: ${sessionDate(d.sessions[0]!) ?? ''}`,
    ...(d.duration ? [`时长: "${d.duration}"`] : []),
    `meetcaption: ${list(d.sessions)}`,
    `录音: ${list(d.sessions.map((_, i) => `${dir}/录音-${i + 1}.webm`))}`,
    `字幕: ${list(d.sessions.map(mcSubtitlePath))}`,
    '---',
  ]
  const out = [...fm, `# ${d.title}`, '']
  if (d.overview) out.push(`> [!ai] 这节课讲了什么 · MeetCaption${d.overview.engine ? ' · ' + d.overview.engine : ''}`, ...d.overview.text.split('\n').map((l) => (l ? `> ${l}` : '>')), '')
  if (d.todos?.length) {
    out.push('## 作业', '')
    for (const x of d.todos) out.push(`- [ ] ${x.text} ${mcTimeLink(x.session, x.t)}${x.due ? ` 📅 ${x.due}` : ''}`)
    out.push('')
  }
  const many = (d.parts?.length ?? 0) > 1
  for (const [i, p] of (d.parts ?? []).entries()) {
    const c = sessionClock(p.session)
    if (many) out.push(`## 第 ${i + 1} 段 · ${c === null ? p.session : clockLabel(c)}`, '')
    for (const s of p.sections) {
      out.push(`${many ? '###' : '##'} ${s.title} ${mcTimeLink(p.session, s.t)}`, '')
      for (const pt of s.points ?? []) out.push(`- ${pt.text} ${mcTimeLink(p.session, pt.t)}`)
      if (s.points?.length) out.push('')
      for (const f of s.frames ?? []) out.push(`![关键画面 ${clockLabel(f, true)}](${encodeURI(`${up}${dir}/${mcFrameName(f)}`)})`, '')
    }
  }
  return out.join('\n').replace(/\n+$/, '\n')
}
