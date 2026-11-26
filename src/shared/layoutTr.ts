// 保版面翻译（对照 / 译文看法）的纯逻辑：排哪几页先翻、译文页放在哪个文件、目标语言给 BabelDOC 的代码。
// BabelDOC 是单独的程序（AGPL-3.0），ParaRead 只经命令行参数、文件和本机端口跟它打交道，不引它的代码（main/babeldoc.ts）。
import { t } from './i18n'

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
  /** 整篇停下的原因：只有翻译服务本身用不了（没 Key、Key 不对、没余额、没登录、连着几批一个请求都没成）才停，一页翻不成不停 */
  error: string | null
  /** 自动重试了几次还没翻成的页 → 一句人话的原因（trWhy）。不进缓存、不当译文显示，页上出「这页没翻成 · 重新翻译」；只记在内存里，关了再开会再翻 */
  failed: Record<number, string>
  /** 正在自动重试的页、为什么、第几次（顶栏和页上的小卡说给用户听） */
  retrying?: { pages: number[]; why: string; attempt: number } | null
  /** 整篇停下时的原话（英文报错、状态码），只放悬停提示；error 是给人看的那句 */
  errorRaw?: string | null
}

export function emptyState(paperId: string, lang: string, total: number): LayoutTrState {
  return { paperId, lang, total, pages: {}, busy: [], busySince: null, msPerPage: null, paused: false, started: false, error: null, failed: {}, retrying: null }
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
 * - 参考文献页照规矩不翻（ZH_RULES），三连词大都还在：原文一半以上的行像文献条目（[12] 开头或带年份），或四分之一以上的行像作者-年份式条目（「. 2021. 」）的页不判。
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
  // 作者-年份式的文献（ACL、arXiv 常见：「…Surdeanu. 2021. Explainable…」「(2021).」），一条折成两三行，带年份的行不到一半：
  // 数像条目开头的行，实测文献页 0.32 到 0.48、正文页 0 到 0.02（2026-11-25，Chain-of-Thought 论文第 10 到 14 页被误判没翻成）
  const entries = lines.filter((l) => /\. (19|20)\d{2}[a-z]?\. |\((19|20)\d{2}[a-z]?\)\./.test(l)).length
  if (lines.length >= 8 && entries / lines.length >= 0.25) return null
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

/**
 * 翻译出错归哪一类（2026-11-25「翻译不稳定、老出错」）：决定等多久再试、要不要停下整篇、给用户说哪句人话。
 * status 是翻译服务回的 HTTP 状态码（有就先看它）；原话要中英文都认（GlmError 的字跟着界面语言走，服务回的原话多是英文）。
 */
export type TrErrKind = 'rate' | 'timeout' | 'server' | 'network' | 'empty' | 'auth' | 'balance' | 'layout' | 'scanned' | 'same' | 'other'
export function trErrKind(msg: string, status?: number): TrErrKind {
  const m = msg ?? ''
  if (status === 429) return /\b1113\b|insufficient|balance|余额/i.test(m) ? 'balance' : 'rate'
  if (status === 402 || /insufficient[ _]balance|余额不足|\b402\b/i.test(m)) return 'balance'
  if (status === 401 || status === 403 || /\b40[13]\b|invalid[ _]api[ _]key|unauthori[sz]ed|authentication|not logged in|\/login|没有 API Key|没填.*Key|Key 不对/i.test(m)) return 'auth'
  if (status !== undefined && status >= 500) return 'server'
  if (/\b429\b|rate[ _-]?limit|too many requests|限流|\b1302\b|overloaded/i.test(m)) return 'rate'
  if (/超时|timed? ?out|timeout|ETIMEDOUT/i.test(m)) return 'timeout'
  if (/empty translation|空译文|没有内容/i.test(m)) return 'empty'
  if (/Scanned PDF/i.test(m)) return 'scanned'
  if (/原样留着|same as (the )?source/i.test(m)) return 'same'
  if (/BabelDOC|Traceback|退出码/i.test(m)) return 'layout'
  if (/\b5\d\d\b|bad gateway|service unavailable|internal server error|upstream/i.test(m)) return 'server'
  if (/网络错误|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|network/i.test(m)) return 'network'
  return 'other'
}

/** 整篇得停下等用户去设置里改的那几类（重试没用、每页都会一样失败） */
export const FATAL_KINDS: readonly TrErrKind[] = ['auth', 'balance']

/** 给用户看的一句人话（顶栏、页上的小卡、菜单头一行），原话进日志和悬停提示 */
export function trWhy(kind: TrErrKind): string {
  return {
    rate: t('翻译服务限流'),
    timeout: t('翻译服务超时'),
    server: t('翻译服务暂时出错'),
    network: t('连不上翻译服务'),
    empty: t('翻译服务回了空译文'),
    auth: t('翻译服务的 Key 不对或没登录'),
    balance: t('翻译服务余额不足'),
    layout: t('排版组件 BabelDOC 出错'),
    scanned: t('BabelDOC 把这几页当成了扫描件'),
    same: t('译文和原文一样'),
    other: t('翻译出错')
  }[kind]
}

/** 一页自动试几次（第一次加重试），还不成才标「没翻成」等用户点 */
export const MAX_PAGE_TRIES = 3
/** 连着几批一个请求都没成就整篇停下（多半是断网或服务挂了，不然每页都白跑一遍） */
export const MAX_DEAD_BATCHES = 3

/** 顶栏按钮上放得下的短说法（顶栏窄，长的那句放菜单头一行和悬停提示） */
export function trWhyShort(why: string): string {
  const m: Record<string, string> = {
    [trWhy('rate')]: t('限流'),
    [trWhy('timeout')]: t('超时'),
    [trWhy('server')]: t('服务出错'),
    [trWhy('network')]: t('连不上'),
    [trWhy('empty')]: t('空译文'),
    [trWhy('layout')]: t('排版出错'),
    [trWhy('scanned')]: t('当成扫描件'),
    [trWhy('same')]: t('还是原文')
  }
  return m[why] ?? why
}
