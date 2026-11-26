// 量保版面翻译（对照 / 译文看法）整篇翻一遍的出错率和速度（2026-11-25「翻译不稳定、老出错、不快」）。不在 all.mjs 里：真装好的 BabelDOC、真翻译服务、真花钱。
// 每一遍一个新数据目录、BabelDOC 的译文缓存挪开：导入、打开（对照、打开就翻），一直等到每页翻好或没翻成；出「翻译出错」时照用户那样点「重试」（最多 RETRY 次）接着翻。
// 记：每页从打开到换上译文用了多久（p50 / p90）、整篇多久、没翻成几页、整篇停下几次和原因、请求数和失败原因分类、同时在翻的请求最多几个。
// E2E_PAPER=<PDF> BABELDOC_DIR=<装好的组件> [TR_SERVICE=deepseek|claude-code] [TR_MODEL=haiku|sonnet|opus] [TR_EFFORT=low|medium|high] [RUNS=3] [RETRY=5] [LIMIT_MIN=40] node scripts/e2e/tr-bench.mjs <放数据和结果的文件夹>
// DeepSeek 的 Key 照 ParaRead 自己的拿法（环境变量 DEEPSEEK_API_KEY，子进程继承），脚本不读也不写它。
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { close, launch, PAPER, sleep } from './drive.mjs'

const base = resolve(process.argv[2] ?? `${process.cwd()}/tmp/tr-bench`)
const RUNS = Number(process.env.RUNS ?? 3)
const RETRY = Number(process.env.RETRY ?? 5)
const LIMIT = Number(process.env.LIMIT_MIN ?? 40) * 60_000
const service = process.env.TR_SERVICE ?? 'deepseek'
const label = process.env.LABEL ?? service
if (!PAPER || !process.env.BABELDOC_DIR) throw new Error('要 E2E_PAPER 和 BABELDOC_DIR')
// 本机 Claude Code 用这台电脑登录的订阅（留着 CLAUDE_CONFIG_DIR），不带从外面那个 Claude Code 会话继承来的开关和 Key
if (service === 'claude-code') for (const k of Object.keys(process.env)) if (k === 'CLAUDECODE' || /^CLAUDE_CODE_/.test(k) || /^CLAUDE_API_KEY_[123]$/.test(k) || k === 'CN_TEST_ANTHROPIC_API_KEY') delete process.env[k]
mkdirSync(base, { recursive: true })

const pct = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
/** 一个错归哪一类 */
export function kindOf(msg = '') {
  if (/超时|timeout|timed out|ETIMEDOUT/i.test(msg)) return '超时'
  if (/\b429\b|rate|限流|1302/i.test(msg)) return '429 限流'
  if (/\b5\d\d\b|upstream|502|503|504|overloaded/i.test(msg) && !/empty translation/.test(msg)) return '5xx'
  if (/empty translation|空译文|JSON|没有内容|解析/i.test(msg)) return '解析失败 / 空译文'
  if (/BabelDOC|退出码|Traceback/i.test(msg)) return 'BabelDOC 崩'
  if (/原样留着|译文页数/.test(msg)) return '译文还是原文'
  if (/网络错误|ECONN|fetch failed|socket/i.test(msg)) return '网络'
  return '其他'
}

const all = []
for (let run = 1; run <= RUNS; run++) {
  const dir = join(base, `${label}-run${run}-${Date.now()}`)
  // BabelDOC 自己的译文缓存（组件文件夹里）挪到结果文件夹，不然第二遍起都是从缓存拿、量不出真翻的速度
  // （连着 -wal、-shm 一起挪，只挪主文件 sqlite 会报 disk I/O error；同一个组件文件夹同时只跑一个量速度的脚本）
  const cache = join(process.env.BABELDOC_DIR, 'home', '.cache', 'babeldoc', 'cache.v1.db')
  const aside = join(base, `cache-${label}-run${run}-${Date.now()}`)
  for (const f of ['', '-wal', '-shm', '-journal']) if (existsSync(cache + f)) (mkdirSync(aside, { recursive: true }), renameSync(cache + f, join(aside, `cache.v1.db${f}`)))
  const env = { PARAREAD_BABELDOC_DIR: process.env.BABELDOC_DIR }
  const { app, win } = await launch(dir, env)
  const ev = (fn, ...a) => win.evaluate(fn, ...a)
  const r = { run, service, model: process.env.TR_MODEL ?? null, effort: process.env.TR_EFFORT ?? null, pages: 0, landedMs: {}, failedFinal: {}, stops: [], batches: [], totalMs: null, requests: null, timedOut: false }
  try {
    await sleep(1000)
    const set = { onboarded: true, trOnOpen: true, openView: 'dual', dualLayout: 'side', rightCollapsed: true, leftCollapsed: true, trService: service === 'deepseek' ? 'deepseek' : service }
    await ev((s) => window.api.setSettings(s), set)
    if (service === 'claude-code') await ev((m) => window.api.setSettings(m), { trCcModel: process.env.TR_MODEL ?? 'haiku', trCcEffort: process.env.TR_EFFORT ?? 'low' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
    const [imp] = await ev((p) => window.api.importPdfs([p]), PAPER)
    const id = imp.paper.id
    const ready = (await ev(() => window.api.layoutTrInstallState())).phase === 'done'
    if (!ready) throw new Error('BABELDOC_DIR 里的组件没装好')
    const t0 = Date.now()
    await win.dblclick(`[data-paper="${id}"]`)
    let retries = 0
    let lastErr = null
    for (;;) {
      await sleep(1000)
      const s = await ev((id) => window.api.layoutTrState(id, 0), id)
      r.pages = s.total
      const now = Date.now() - t0
      for (const p of Object.keys(s.pages)) if (r.landedMs[p] === undefined) r.landedMs[p] = now
      if (s.msPerPage && s.busy.length === 0 && r.batches[r.batches.length - 1]?.msPerPage !== s.msPerPage) r.batches.push({ at: now, msPerPage: s.msPerPage })
      if (s.error && s.error !== lastErr) {
        r.stops.push({ at: now, error: s.error, kind: kindOf(s.error), failedPages: Object.keys(s.failed).map(Number), retry: retries })
        lastErr = s.error
        if (retries >= RETRY) break
        retries++
        await ev((id) => window.api.layoutTrResume(id), id)
        lastErr = null
        continue
      }
      const done = Object.keys(s.pages).length
      const failed = Object.keys(s.failed).length
      if (s.total && !s.busy.length && !s.error && done + failed >= s.total) {
        r.failedFinal = s.failed
        r.totalMs = now
        break
      }
      if (now > LIMIT) {
        r.timedOut = true
        r.failedFinal = s.failed
        r.totalMs = now
        break
      }
    }
    r.userRetries = retries
    r.requests = await app.evaluate(() => globalThis.paraReadLt?.proxy?.records ?? [])
    r.log = readFileSync(join(dir, 'main.log'), 'utf8').split('\n').filter((l) => /保版面翻译/.test(l)).map((l) => l.slice(0, 400))
  } catch (e) {
    r.crash = String(e?.stack ?? e)
  } finally {
    await close(app).catch(() => {})
  }
  // 汇总这一遍
  const reqs = r.requests ?? []
  const okReq = reqs.filter((x) => x.status === 200)
  const bad = reqs.filter((x) => x.status !== 200)
  const kinds = {}
  for (const x of bad) kinds[`${x.status} ${kindOf(x.error)}`] = (kinds[`${x.status} ${kindOf(x.error)}`] ?? 0) + 1
  // 同时在翻的请求最多几个
  const ev2 = reqs.flatMap((x) => [[x.at, 1], [x.at + x.ms, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0
  let peak = 0
  for (const [, d] of ev2) peak = Math.max(peak, (cur += d))
  const landed = Object.values(r.landedMs)
  r.summary = {
    pages: r.pages,
    translated: landed.length,
    failedPages: Object.keys(r.failedFinal).length,
    stops: r.stops.length,
    stopKinds: r.stops.map((s) => s.kind),
    totalS: r.totalMs && Math.round(r.totalMs / 1000),
    landedP50S: pct(landed, 50) && Math.round(pct(landed, 50) / 1000),
    landedP90S: pct(landed, 90) && Math.round(pct(landed, 90) / 1000),
    perPageS: r.totalMs && landed.length ? +(r.totalMs / 1000 / landed.length).toFixed(1) : null,
    batchMsPerPage: r.batches.map((b) => b.msPerPage),
    requests: reqs.length,
    requestFails: bad.length,
    requestFailKinds: kinds,
    reqP50S: pct(okReq.map((x) => x.ms), 50) && +(pct(okReq.map((x) => x.ms), 50) / 1000).toFixed(1),
    reqP90S: pct(okReq.map((x) => x.ms), 90) && +(pct(okReq.map((x) => x.ms), 90) / 1000).toFixed(1),
    peakConcurrent: peak,
    timedOut: r.timedOut,
    crash: r.crash ?? null
  }
  console.log(`第 ${run} 遍`, JSON.stringify(r.summary))
  all.push(r)
  writeFileSync(join(base, `${label}.json`), JSON.stringify(all, null, 1))
}
console.log(join(base, `${label}.json`))
