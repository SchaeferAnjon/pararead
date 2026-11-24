/**
 * 在后台盯着各家命令行（task-m55m7，用户 r20：「再加上自动拉取模型，再加上自动更新…Claude Code 更新了…我们是否还兼容」）：
 * - 版本：每次找到的命令行跑 --version（cli.ts 的 checkCli，换了文件才重跑），记下来；
 * - 版本变了（和上次查过的不一样）就自查一次（engine-check.ts），结论按版本记着，同一个版本不再查；
 * - 模型列表：软件启动后、每天一次、版本变了、点「检查更新」时在后台拉（engine-models.ts）；拉不到用上次的；
 * - 新版本：每天看一次、点「检查更新」看一次（engine-update.ts）；「更新」只在用户点了才跑它官方的更新，跑完重读版本、再自查。
 * 记在软件设置目录 userData/ai/engines.json（拉到的模型、版本、自查结论、看到的新版本），不联网也照样用上次的。
 * 测试实例（CN_E2E=1）默认不盯（各家是假的、不起真命令行），CN_ENGINE_WATCH=1 才盯（e2e 用假命令行脚本测这一套）。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { t } from './shared/i18n'
import type { EngineInfo } from './shared'
import type { CliId as EngineId } from './shared'
import type { ModelOption } from './shared'
import { type EngineHealth, isNewer, parseVersion, pulledText, stateOf, VERIFIED } from './shared'
import { checkCli, forgetChecks, locateCli } from './cli'
import { checkEngine } from './engine-check'
import { claudeModels, geminiModels, opencodeModels } from './engine-models'
import { latestVersion, runUpdate, updatePlan } from './engine-update'
import { codexModelList } from './engines'
import { atomicWriteSync } from '@cn/atomic'

const IDS: EngineId[] = ['claude', 'codex', 'gemini', 'opencode']
const DAY = 24 * 3600_000

/** 记在 engines.json 里的一家 */
interface Saved {
  path?: string
  version?: string
  models?: ModelOption[]
  modelsAt?: number
  health?: EngineHealth
  latest?: string
  latestAt?: number
}

/** 这次打开软件以来的（不存） */
interface Live {
  modelsErr?: string
  pulling?: Promise<void>
  checking?: Promise<void>
  latestBusy?: Promise<void>
  latestNote?: string
  update?: EngineInfo['update']
}

let file = ''
let saved: Partial<Record<EngineId, Saved>> = {}
const live: Record<EngineId, Live> = { claude: {}, codex: {}, gemini: {}, opencode: {} }
let changed: () => void = () => undefined
let since = Date.now()
let on = false
let timer: NodeJS.Timeout | null = null

function load(): Partial<Record<EngineId, Saved>> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const out: Partial<Record<EngineId, Saved>> = {}
    for (const id of IDS) if (raw[id] && typeof raw[id] === 'object') out[id] = raw[id] as Saved
    return out
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('engines.json 读不了，从头记', e)
    return {}
  }
}

function save() {
  if (!file) return
  mkdirSync(dirname(file), { recursive: true })
  atomicWriteSync(file, JSON.stringify(saved))
}

const short = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 120)

/**
 * 开始盯：dir 是 userData/ai；changed 在有新东西（拉到模型、自查完、更新完）时叫，界面再要一次；
 * enabled 关着时只读上次记下的（测试实例不起真命令行）
 */
export function startEngineWatch(o: { dir: string; changed(): void; enabled: boolean }) {
  file = join(o.dir, 'engines.json')
  changed = o.changed
  since = Date.now()
  on = o.enabled
  saved = load()
  if (!on || timer) return
  // 每小时看一眼：模型、新版本过了一天的再拉、再看；没过一天的什么都不跑
  timer = setInterval(() => void refreshAll(), 3600_000)
  timer.unref()
}

export const watching = () => on

/** 每一家看一遍（启动后取到登录 shell 的 PATH 以后叫一次） */
export function refreshAll(): Promise<void> {
  return Promise.all(IDS.map((id) => refresh(id).catch((e) => console.error(`${id} 后台查看出错`, e)))).then(() => undefined)
}

/**
 * 看一家：读版本；版本没查过就自查；模型过了一天（或 force、版本变了）再拉；新版本过了一天（或 latest）再看。
 * 没装、运行不了的不看（留着上次拉到的模型，装回来接着用）
 */
export async function refresh(id: EngineId, o: { force?: boolean; latest?: boolean } = {}): Promise<void> {
  if (!on) return
  const hit = locateCli(id)
  if (!hit) return
  if (o.force) forgetChecks(hit.path)
  const c = await checkCli(hit.path)
  if (!c.ok) return
  const version = parseVersion(c.version) ?? c.version
  const s = (saved[id] ??= {})
  const fresh = s.version !== version || s.path !== hit.path
  if (fresh) {
    s.version = version
    s.path = hit.path
    save()
    changed()
  }
  const work: Promise<void>[] = []
  if (!s.health || s.health.version !== version) work.push(check(id, hit.path, version))
  if (o.force || fresh || !s.modelsAt || Date.now() - s.modelsAt > DAY) work.push(pull(id, hit.path))
  if (o.latest || !s.latestAt || Date.now() - s.latestAt > DAY) work.push(latest(id, hit.path, !!o.latest))
  await Promise.all(work)
}

/** 软件里别处读到了新版本（AI 面板要引擎列表时 --version 跑出来的和记的不一样）：在后台看一遍 */
export function noteVersion(id: EngineId, raw: string) {
  if (!on) return
  const v = parseVersion(raw) ?? raw
  if (saved[id]?.version !== v) void refresh(id).catch((e) => console.error(`${id} 后台查看出错`, e))
}

function check(id: EngineId, path: string, version: string): Promise<void> {
  const l = live[id]
  if (l.checking) return l.checking
  l.checking = (async () => {
    changed()
    const verified = VERIFIED[id] === version
    let r: Awaited<ReturnType<typeof checkEngine>>
    try {
      r = await checkEngine(id, path, { probe: !verified })
    } catch (e) {
      r = { problems: [], note: t('自查出错：{error}', { error: short(e) }), partial: true }
    }
    // 查的时候版本又变了（正在更新）：这次的不算
    if (saved[id]?.version !== version) return
    const state = r.problems.length ? stateOf(r.problems) : r.partial ? 'unknown' : 'ok'
    saved[id]!.health = { version, state, problems: r.problems, ...(r.note ? { note: r.note } : {}), ...(verified ? { verified } : {}), ...(r.asked ? { asked: true } : {}), at: Date.now() }
    save()
  })().finally(() => {
    l.checking = undefined
    changed()
  })
  return l.checking
}

function pull(id: EngineId, path: string): Promise<void> {
  const l = live[id]
  if (l.pulling) return l.pulling
  l.pulling = (async () => {
    try {
      const models = id === 'claude' ? (await claudeModels(path)).models : id === 'codex' ? await codexModelList(path) : id === 'gemini' ? await geminiModels(path) : await opencodeModels(path)
      const s = (saved[id] ??= {})
      s.models = models
      s.modelsAt = Date.now()
      l.modelsErr = undefined
      save()
    } catch (e) {
      // 拉不到（没登录、没网）：用上次的，界面上写「上次拉的 …，这次没拉到（为什么）」
      l.modelsErr = short(e)
      console.error(`${id} 的模型列表拉不到`, e)
    }
  })().finally(() => {
    l.pulling = undefined
    changed()
  })
  return l.pulling
}

function latest(id: EngineId, path: string, asked: boolean): Promise<void> {
  const l = live[id]
  if (l.latestBusy) return l.latestBusy
  l.latestBusy = (async () => {
    try {
      const v = await latestVersion(id, path)
      const s = (saved[id] ??= {})
      s.latest = v
      s.latestAt = Date.now()
      // 点了「检查更新」、没有更新的：说一声「已是最新」
      l.latestNote = asked && !isNewer(v, s.version) ? t('已是最新') : undefined
      save()
    } catch (e) {
      // 后台看不到就算了（不说）；点了「检查更新」才说为什么
      l.latestNote = asked ? t('没查到新版本：{error}', { error: short(e) }) : l.latestNote
    }
  })().finally(() => {
    l.latestBusy = undefined
    changed()
  })
  return l.latestBusy
}

/** 「检查更新」：重读版本、重拉模型、看新版本，都等它做完 */
export async function checkNow(id: EngineId): Promise<void> {
  live[id].latestNote = undefined
  changed()
  await refresh(id, { force: true, latest: true })
}

/** 「更新」：跑它官方的更新；成了重读版本、再自查、再拉模型；没成照实说它最后一句原话 */
export async function updateNow(id: EngineId): Promise<void> {
  const hit = locateCli(id)
  if (!hit) throw new Error(t('这台Mac上没找到它'))
  const plan = updatePlan(id, hit.path)
  if ('none' in plan) throw new Error(plan.none)
  const l = live[id]
  if (l.update?.state === 'running') return
  const from = saved[id]?.version
  l.update = { state: 'running', text: plan.text }
  l.latestNote = undefined
  changed()
  try {
    const r = await runUpdate(plan)
    if (!r.ok) {
      l.update = { state: 'failed', why: r.why }
      return
    }
    // 换了文件：忘掉记着的 --version，重读；版本变了 refresh 会再自查、再拉模型
    const now = locateCli(id)
    if (now) forgetChecks(now.path)
    forgetChecks(hit.path)
    const c = now ? await checkCli(now.path) : null
    const to = c?.ok ? (parseVersion(c.version) ?? c.version) : undefined
    l.update = { state: 'ok', ...(from ? { from } : {}), ...(to ? { to } : {}) }
    await refresh(id, { force: true })
  } finally {
    changed()
  }
}

/** 拉到的模型（没拉到过是 null：用自带的） */
export function pulledModels(id: EngineId): ModelOption[] | null {
  const m = saved[id]?.models
  return m?.length ? m : null
}

/** 这一家记下的版本和自查结论（AI 出错时说清楚是不是命令行不兼容） */
export function engineState(id: EngineId): { version?: string; health?: EngineHealth } {
  const s = saved[id]
  return { ...(s?.version ? { version: s.version } : {}), ...(s?.health && s.health.version === s.version ? { health: s.health } : {}) }
}

/** 给界面的那几样（合进 EngineInfo）；不盯的时候（测试实例）只有记下的版本 */
export function watchInfo(id: EngineId, path: string | null): Partial<EngineInfo> {
  const s = saved[id] ?? {}
  const l = live[id]
  const out: Partial<EngineInfo> = {}
  if (s.version && path && s.path === path) out.version = s.version
  if (!on || !path) return out
  out.pulled = pulledText({ at: s.modelsAt, ...(l.modelsErr ? { err: l.modelsErr } : {}), since })
  out.pulledCount = s.models?.length ?? 0
  if (out.version && s.health?.version === out.version) out.health = s.health
  if (l.checking) out.checking = true
  if (isNewer(s.latest, out.version)) out.latest = s.latest
  if (l.latestNote) out.latestNote = l.latestNote
  const plan = updatePlan(id, path)
  out.updateWith = 'none' in plan ? { none: plan.none } : { text: plan.text }
  if (l.update) out.update = l.update
  return out
}
