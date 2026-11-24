// 保版面翻译（对照 / 译文看法）的纯逻辑：排哪几页先翻、译文页放在哪个文件、目标语言给 BabelDOC 的代码。
// BabelDOC 是单独的程序（AGPL-3.0），ParaRead 只经命令行参数、文件和本机端口跟它打交道，不引它的代码（main/babeldoc.ts）。

/** 锁死的 BabelDOC 版本：设计页 51 在这台 Mac 上真跑过；升级前要重测出的 PDF 和命令行参数 */
export const BABELDOC_VERSION = '0.7.1'
/** 组件装好后大约多大（Python 环境和依赖约 600 MB，版面模型和字体约 337 MB） */
export const BABELDOC_MB = 950

/** 打开一篇时先翻的：在看的这一页和前后各 2 页 */
export const FIRST_AROUND = 2
/** 之后每批几页。每次起 BabelDOC 要约 45 秒（macOS 上编译版面模型），批太小都花在启动上 */
export const LATER_BATCH = 12

/** 设置里的目标语言 → BabelDOC 的 --lang-out。它按代码里的 CN / TW / JP / KR 选字体，简体写 zh-CN 才用中文字体排 */
export function babelLang(target: string): string {
  const m: Record<string, string> = { 简体中文: 'zh-CN', 繁體中文: 'zh-TW', 繁体中文: 'zh-TW', English: 'en', 日本語: 'ja', 한국어: 'ko-KR', Deutsch: 'de', Français: 'fr', Español: 'es', Italiano: 'it' }
  return m[target] ?? 'zh-CN'
}

/**
 * 下一批翻哪几页（从 1 数，升序）。focus 是正在看的页；done 是翻好了的，busy 是正在翻的。
 * 第一批（这篇一页都没翻过，或者 focus 附近还有没翻的）：focus 前后各 FIRST_AROUND 页；
 * 之后从 focus 往后接着翻，翻到底再从头补前面的，一批 LATER_BATCH 页；剩下的不到一批半就一次翻完。
 */
export function nextBatch(total: number, focus: number, done: ReadonlySet<number>, busy: ReadonlySet<number> = new Set()): number[] {
  const open = (p: number): boolean => p >= 1 && p <= total && !done.has(p) && !busy.has(p)
  const f = Math.min(Math.max(1, Math.round(focus) || 1), Math.max(1, total))
  const near: number[] = []
  for (let p = f - FIRST_AROUND; p <= f + FIRST_AROUND; p++) if (open(p)) near.push(p)
  if (near.length) return near
  const order: number[] = []
  for (let p = f; p <= total; p++) if (open(p)) order.push(p)
  for (let p = 1; p < f; p++) if (open(p)) order.push(p)
  const take = order.length <= LATER_BATCH * 1.5 ? order.length : LATER_BATCH
  return order.slice(0, take).sort((a, b) => a - b)
}

/** 一批的译文 PDF 只含这批的页（--only-include-translated-page），按页码升序排：第 i 页在文件里是第几页（从 1 数） */
export function indexBatch(pages: number[], file: string): Record<number, { file: string; at: number }> {
  const out: Record<number, { file: string; at: number }> = {}
  ;[...pages].sort((a, b) => a - b).forEach((p, i) => (out[p] = { file, at: i + 1 }))
  return out
}

/** BabelDOC 的 --pages 写法：1,2,3,7 → 1-3,7 */
export function pagesArg(pages: number[]): string {
  const s = [...new Set(pages)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]))
    i = j
  }
  return out.join(',')
}

/** 一篇的保版面翻译到哪了（主进程推给界面） */
export interface LayoutTrState {
  paperId: string
  lang: string
  total: number
  /** 翻好了的页 → 在哪个译文文件的第几页（文件名相对这篇的缓存文件夹） */
  pages: Record<number, { file: string; at: number }>
  /** 正在翻的这一批 */
  busy: number[]
  /** 这一批从什么时候开始（估还要多久） */
  busySince: number | null
  /** 上一批平均每页用了多少毫秒（含启动），没有是 null */
  msPerPage: number | null
  /** 停着：用户点了暂停，或者「打开就翻」关着、还没点「翻成对照」 */
  paused: boolean
  /** 这一篇开始翻过（打开就翻，或点过「翻成对照」）；「打开就翻」关着又没开始过的，界面上出「翻成对照」那张卡 */
  started: boolean
  /** 上一批出错的原因（还会接着试下一批之前停住） */
  error: string | null
  /** 翻了但没翻成的页（译文里还是原文，untranslatedReason）→ 原因。不进缓存、不当译文显示，页上出「这页没翻成 · 重新翻译」；只记在内存里，关了再开会再翻 */
  failed: Record<number, string>
}

export function emptyState(paperId: string, lang: string, total: number): LayoutTrState {
  return { paperId, lang, total, pages: {}, busy: [], busySince: null, msPerPage: null, paused: false, started: false, error: null, failed: {} }
}

/** 已经翻好几页 */
export const doneCount = (s: LayoutTrState): number => Object.keys(s.pages).length

/** 组件装到哪了 */
export type BabelPhase = 'none' | 'uv' | 'python' | 'packages' | 'models' | 'done' | 'failed'
export interface BabelInstallState {
  phase: BabelPhase
  percent: number
  /** 下了多少 MB（按缓存、模型文件夹长到多大算，大约） */
  mb: number
  line: string
  error: string | null
}

/** 框选在对照、译文看法里截哪一边 */
export type ShotSide = 'src' | 'tr' | 'both'

/**
 * 译文页到底翻了没有（2026-11-24：0.2.0 里 BabelDOC 的请求全失败时它不报错，把原文原样写进「译文」PDF，界面当翻好了显示）。
 * 拿这一页的原文和译文的字比，不看目标语言是哪种字（德文、法文也能判）：
 * - 原文不到 MIN_JUDGE_WORDS 个英文词（图、公式、幻灯片的标题页）不判，算翻好了，免得图多字少的页误判；
 * - 原文里连着的三个词（三连词）在译文里原样还在的比例 ≥ SAME_RUNS 就是没翻。真翻过的页只剩人名、缩写、公式和文献条目，
 *   阈值按实测定（tests/layoutTr.test.ts 里的数）；
 * - 参考文献页照规矩不翻（ZH_RULES），三连词大都还在：原文一半以上的行像文献条目（[12] 开头或带年份）的页不判。
 * 返回 null 是翻好了（或不判），否则是一句给日志的原因。
 */
export const MIN_JUDGE_WORDS = 40
export const SAME_RUNS = 0.6
const latinWords = (s: string): string[] => s.toLowerCase().match(/[a-z]{2,}/g) ?? []
const runsOf = (w: string[]): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
  return out
}
/** 原样留着的三连词占原文的比例（不判的页是 null） */
export function sameRunShare(src: string, out: string): number | null {
  const sw = latinWords(src)
  if (sw.length < MIN_JUDGE_WORDS) return null
  const lines = src.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 20)
  const refLike = lines.filter((l) => /^\[\d{1,3}\]/.test(l) || /\b(19|20)\d{2}\b/.test(l)).length
  if (lines.length >= 8 && refLike / lines.length > 0.5) return null
  const a = runsOf(sw)
  const b = runsOf(latinWords(out))
  let same = 0
  for (const r of a) if (b.has(r)) same++
  return same / Math.max(1, a.size)
}
export function untranslatedReason(src: string, out: string): string | null {
  const share = sameRunShare(src, out)
  return share !== null && share >= SAME_RUNS ? `${Math.round(share * 100)}% 的原文原样留着` : null
}
