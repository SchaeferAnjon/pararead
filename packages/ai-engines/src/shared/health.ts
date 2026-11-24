/**
 * 各家命令行的版本、自查、模型拉到没有（task-m55m7，用户 r20：「Claude Code 更新了…我们是否还兼容」）。
 * 主进程（engine-watch.ts）记、查；设置 › AI 每家那一行、引擎菜单、AI 对话出错时用这里的话说。不碰 Electron，能单独测。
 */
import type { CliId as EngineId } from './sources'
import { list, t } from './i18n'

/**
 * 我们照它的 --help 和真跑核过的版本（engines.ts 里那些参数就是照这几个版本写的）。装着的是别的版本时后台自查一次；
 * 核过的版本也跑一遍不花钱的自查，只是不再真问一个字
 */
export const VERIFIED: Record<EngineId, string> = { claude: '2.1.330', codex: '0.163.0', gemini: '0.64.0', opencode: '1.19.3' }

/**
 * 自查查出来的一处不对：
 * flag 参数不认了（--mcp-config）、value 参数的值不认了（--permission-mode bypassPermissions）、method 接口里没有了（thread/start、thread/start.sandbox）、
 * format 输出认不出了（stream-json 的 result 那一行）、feature 全能模式关着时有一样关不掉了（只提醒，照样能用）
 */
export type ProblemKind = 'flag' | 'value' | 'method' | 'format' | 'feature'

export interface EngineProblem {
  kind: ProblemKind
  what: string
  /** 影响哪：chat 是 AI 对话（含读 PDF 的边读边问）；quick 是 / 命令、梦游、小活、翻译；all 是都影响 */
  scope: 'chat' | 'quick' | 'all'
}

export interface EngineHealth {
  /** 查的是哪个版本 */
  version: string
  /** ok 能用；bad 有参数、接口、输出不认了；warn 只是全能模式关着时有一样关不掉；unknown 自查没跑成 */
  state: 'ok' | 'bad' | 'warn' | 'unknown'
  problems: EngineProblem[]
  /** 自查没跑成的原因，或者「输出格式没问成：没登录」这类补充 */
  note?: string
  /** 是我们核过的版本 */
  verified?: boolean
  /** 真问了一个字核过输出（不是核过的版本、离线查都过了时，只问一次） */
  asked?: boolean
  at: number
}

/** 「2.1.330 (Claude Code)」「codex-cli 0.163.0」里的版本号 */
export function parseVersion(raw: string): string | null {
  return /\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/.exec(raw)?.[0] ?? null
}

/** 比两个版本：a 新返回正数；预发布（-beta）比同号的正式版旧 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split(/[-+]/, 2) as [string, string | undefined]
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre.localeCompare(y.pre, undefined, { numeric: true })
}

export const isNewer = (latest: string | undefined, current: string | undefined) => !!latest && !!current && compareVersions(latest, current) > 0

/** 影响哪：中文原句，说的时候 t() */
const SCOPE_TEXT: Record<EngineProblem['scope'], string> = { chat: 'AI 对话可能出错', quick: '/ 命令、梦游、小活可能出错', all: '用到它的都可能出错' }

/** 几处问题合起来影响哪：AI 对话和别的都有就是都影响 */
function scopeOf(ps: EngineProblem[]): EngineProblem['scope'] {
  const s = new Set(ps.map((p) => p.scope))
  return s.has('all') || (s.has('chat') && s.has('quick')) ? 'all' : s.has('chat') ? 'chat' : 'quick'
}

/** 一种问题怎么说：一个、几个 */
function kindText(kind: ProblemKind, whats: string[]): string {
  const ws = list(whats)
  const n = whats.length
  switch (kind) {
    case 'flag':
      return n === 1 ? t('有一个参数不认了：{list}', { list: ws }) : t('有{n}个参数不认了：{list}', { n, list: ws })
    case 'value':
      return t('参数的值不认了：{list}', { list: ws })
    case 'method':
      return t('接口变了：{list} 没有了', { list: ws })
    case 'format':
      return t('输出格式变了：{list}', { list: ws })
    case 'feature':
      return t('全能模式关着时关不掉：{list}', { list: ws })
  }
}

/**
 * 查出来的问题说成一句：「有一个参数不认了：--mcp-config，AI 对话可能出错」；
 * 只剩「关不掉」的那种不说会出错（照样能用）
 */
export function problemText(problems: EngineProblem[]): string {
  const bad = problems.filter((p) => p.kind !== 'feature')
  const order: ProblemKind[] = ['flag', 'value', 'method', 'format', 'feature']
  const parts = order.flatMap((k) => {
    const ws = [...new Set(problems.filter((p) => p.kind === k).map((p) => p.what))]
    return ws.length ? [kindText(k, ws)] : []
  })
  if (!parts.length) return ''
  const all = parts.join(t('；', { ctx: '分句' }))
  return bad.length ? t('{problems}，{scope}', { problems: all, scope: t(SCOPE_TEXT[scopeOf(bad)]) }) : all
}

/** 设置 › AI 那一行、引擎菜单里写的：「2.1.330 · 能用」「2.2.0 · 有一个参数不认了：--xxx，AI 对话可能出错」 */
export function healthText(h: EngineHealth): string {
  if (h.state === 'unknown') return h.note ? t('{v} · 没查成：{note}', { v: h.version, note: h.note }) : t('{v} · 没查成', { v: h.version })
  if (h.state === 'ok') return t('{v} · 能用', { v: h.version })
  if (h.state === 'warn') return t('{v} · 能用（{problems}）', { v: h.version, problems: problemText(h.problems) })
  return `${h.version} · ${problemText(h.problems)}`
}

/** 自查的结论：有不认的就是 bad，只剩关不掉的是 warn */
export function stateOf(problems: EngineProblem[]): EngineHealth['state'] {
  if (problems.some((p) => p.kind !== 'feature')) return 'bad'
  return problems.length ? 'warn' : 'ok'
}

const two = (n: number) => String(n).padStart(2, '0')

/** 「今天 09:14」「11-20 09:14」 */
export function whenText(at: number, now = Date.now()): string {
  const d = new Date(at)
  const now2 = new Date(now)
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`
  return d.toDateString() === now2.toDateString() ? t('今天 {hm}', { hm }) : `${two(d.getMonth() + 1)}-${two(d.getDate())} ${hm}`
}

/**
 * 模型列表是什么时候拉的（模型菜单底下、设置那一行）：这次打开软件以后拉的是「刚拉的」；以前拉的写「上次拉的 11-20 09:14」，
 * 这次没拉成再说一句为什么；一次都没拉到是「自带的几个」
 */
export function pulledText(o: { at?: number; err?: string; since: number; now?: number }): string {
  if (!o.at) return o.err ? t('没拉到（{err}），用的是自带的几个', { err: o.err }) : t('自带的几个，还没拉')
  if (o.at >= o.since && !o.err) return t('刚拉的')
  const when = whenText(o.at, o.now)
  return o.err ? t('上次拉的 {when}，这次没拉到（{err}）', { when, err: o.err }) : t('上次拉的 {when}', { when })
}
