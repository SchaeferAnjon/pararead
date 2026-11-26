// 保版面翻译（对照、译文看法）：用 BabelDOC 把 PDF 的字原位换成译文，图、色块、表格不动（2026-11-23 用户定，设计页 51）。
// BabelDOC 是单独的程序（AGPL-3.0），这里只起它的命令行、传参数、读它写出的 PDF，不和 ParaRead 的代码混在一起。
// 一次翻一批页：先翻在看的这一页和前后各 2 页，再从这里往后、到底再从头，一批 12 页；同一时间只跑一个 BabelDOC。
// 出错（2026-11-25「翻译不稳定、老出错、不快」）：请求失败在 trProxy 里按错的种类重试；一批 BabelDOC 失败了把这批拆成两半再翻、
// 译文还是原文的页不用缓存再翻，一页最多试 MAX_PAGE_TRIES 次，还不成只把那几页标「没翻成」，别的页照常往下翻；
// 只有翻译服务本身用不了（Key、余额、连着几批一个请求都没成）才整篇停下。
// 快：macOS 上 BabelDOC 每次起都要让 CoreML 编译一遍版面模型（实测 70 到 110 秒），pararead-py/sitecustomize.py 给 onnxruntime 加上编译缓存，
// 第二次起只要几秒；不再让它判「扫描件」（课件图多，一批里八成的页被它判成扫描页、整批不出译文，翻没翻成 ParaRead 自己会比）。
// 翻译请求经本机的口子（trProxy.ts）回到 ParaRead，按「设置 › 翻译 › 翻译用」转给会员、DeepSeek 或本机 Claude Code。
// 译文 PDF 是缓存：数据目录 layout-tr/<论文>/<语言>-<BabelDOC 版本>/，一批一个文件，index.json 记每页在哪个文件第几页。
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, shell } from 'electron'
import { BABELDOC_VERSION, babelLang, emptyState, nextBatch, pagesArg, indexBatch, untranslatedReason, trErrKind, trWhy, FATAL_KINDS, MAX_PAGE_TRIES, MAX_DEAD_BATCHES, type LayoutTrState, type TrErrKind } from '../shared/layoutTr'
import { t } from '../shared/i18n'
import type { Ai } from './ai'
import { babelCommand, babelEnv, BabelInstaller } from './babeldocInstall'
import type { SettingsStore } from './settings'
import { IS_WIN, killTree } from './platform'
import { TrProxy } from './trProxy'
import type { RetryOpts } from './trRetry'
import { E2E } from './testMode'
import { pageTexts } from './pdftext'

interface Deps {
  dataDir: string
  /** 组件装在哪（用户缓存里） */
  componentDir: string
  settings: SettingsStore
  ai: Ai
  pdfPath: (paperId: string) => string
  broadcast: (channel: string, payload: unknown) => void
  log: (msg: string) => void
  /** 装过 MinerU 的 uv，拿来用不用再下 */
  mineruUv: () => string | null
  /** 测试里缩短：请求重试的等法、一组页重试前等多久 */
  trRetry?: RetryOpts
  retryWaitMs?: (attempt: number) => number
}

interface Index {
  pages: LayoutTrState['pages']
  /** 用户点过「翻成对照」（「打开就翻」关着时，点过的这一篇以后打开接着翻） */
  started?: boolean
  /** 用户点了暂停：关了再开也停着，点「继续翻译」才接着翻（不在用户没留意时花钱） */
  paused?: boolean
}

const ZH_RULES =
  'Extra rules for Chinese output: put one half-width space between Chinese characters and Latin letters or digits (e.g. "24 个中有 14 个不同"); keep acronyms and abbreviations such as HDC, GPU, CPU, URLs, author names, dates and reference lines exactly as in the source; keep every placeholder and tag unchanged.'

export class LayoutTranslator {
  readonly installer: BabelInstaller
  private proxy: TrProxy
  private states = new Map<string, LayoutTrState>()
  /** 用户点了「重新翻译」的页（论文:页）：翻这几页时不用 BabelDOC 自己的译文缓存 */
  private fresh = new Set<string>()
  private active: { paperId: string; focus: number } | null = null
  private child: ChildProcess | null = null
  private running = false
  private stopped = false
  /** 每页自动试过几次没成（论文:页） */
  private tries = new Map<string, number>()
  /** 每篇等着重试的几组页（一批失败拆成的两半、译文还是原文的页），排在新的批前面 */
  private retryQ = new Map<string, number[][]>()
  /** 每篇连着几批一个请求都没成 */
  private dead = new Map<string, number>()

  constructor(private d: Deps) {
    // 测试模式：量速度的脚本（scripts/e2e/tr-bench.mjs）经 app.evaluate 读请求记录
    if (E2E) (globalThis as { paraReadLt?: unknown }).paraReadLt = this
    this.installer = new BabelInstaller(d.componentDir, (s) => {
      d.broadcast('layoutTr:install', s)
      // 装好了：开着的那篇接着翻
      if (s.phase === 'done') void this.pump()
    }, d.mineruUv)
    this.proxy = new TrProxy(
      async (c, useId, signal) => {
        // 测试模式：走查在 app.evaluate 里设 globalThis.paraReadTrFake，装成翻译服务回原文（echo）、空译文（empty）或一直 503（down）
        const fake = E2E ? (globalThis as { paraReadTrFake?: string }).paraReadTrFake : undefined
        if (fake === 'empty') return { text: '', prompt: 0, completion: 0 }
        if (fake === 'down') throw Object.assign(new Error('AI 服务 503：service unavailable'), { status: 503 })
        if (fake === 'echo') {
          const last = c.messages[c.messages.length - 1]
          return { text: typeof last?.content === 'string' ? last.content : '', prompt: 0, completion: 0 }
        }
        // 译成中文时补三条（照沉浸式翻译的译文比过）：中西文、数字之间留空格（PDF 里没有 text-autospace），缩写、网址、参考文献行不译
        const extra = /^zh/.test(this.lang()) && !c.json ? [{ role: 'system' as const, content: ZH_RULES }] : []
        // 每次最多等多久由 trProxy 管（超了按超时重试），这里给个更长的兜底；限流也交给 trProxy 退避
        const text = await d.ai.trOnce([...extra, ...c.messages], { json: c.json, maxTokens: c.maxTokens, timeoutMs: 600_000, useId, signal, noRetry: true })
        const chars = c.messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0)
        // 用量按字数估（BabelDOC 只拿它记日志）
        return { text, prompt: Math.ceil(chars / 3), completion: Math.ceil(text.length / 3) }
      },
      (msg) => {
        // 每批只记前 3 个，别的在批末一起说个数
        if (this.proxy.failed <= 3) d.log(`保版面翻译：请求重试过还是失败（这段会留原文）：${msg.slice(0, 300)}`)
      },
      {
        // 一次请求最多等：API 90 秒（DeepSeek 一段平常 1 秒），本机 Claude Code 一次起一个进程，3 分钟
        attemptMs: () => (this.d.ai.trLocal() ? 180_000 : 90_000),
        retry: { ...d.trRetry, onRetry: (n, kind, e) => d.log(`保版面翻译：请求第 ${n} 次失败（${kind}），等一会再试：${e.message.slice(0, 160)}`) }
      }
    )
  }

  private lang(): string {
    return babelLang(this.d.settings.get().targetLang)
  }
  private dir(paperId: string): string {
    return join(this.d.dataDir, 'layout-tr', paperId, `${this.lang()}-${BABELDOC_VERSION}`)
  }
  private readIndex(paperId: string): Index {
    const f = join(this.dir(paperId), 'index.json')
    if (!existsSync(f)) return { pages: {} }
    const idx = JSON.parse(readFileSync(f, 'utf8')) as Index
    // 文件被清掉了（缓存目录被删）的页当没翻过
    for (const [p, v] of Object.entries(idx.pages)) if (!existsSync(join(this.dir(paperId), v.file))) delete idx.pages[Number(p)]
    return idx
  }
  private writeIndex(paperId: string, idx: Index): void {
    mkdirSync(this.dir(paperId), { recursive: true })
    const f = join(this.dir(paperId), 'index.json')
    writeFileSync(`${f}.tmp`, JSON.stringify(idx))
    renameSync(`${f}.tmp`, f)
  }

  /** 这一篇翻到哪了（第一次问时从缓存读出来） */
  state(paperId: string, total = 0): LayoutTrState {
    let s = this.states.get(paperId)
    if (!s || s.lang !== this.lang()) {
      const idx = this.readIndex(paperId)
      const on = this.d.settings.get().trOnOpen
      s = { ...emptyState(paperId, this.lang(), total), pages: idx.pages, paused: !!idx.paused || (!on && !idx.started), started: on || !!idx.started }
      this.states.set(paperId, s)
    }
    if (total && s.total !== total) s.total = total
    return s
  }
  private emit(s: LayoutTrState): void {
    this.d.broadcast('layoutTr:state', s)
  }
  private patch(paperId: string, p: Partial<LayoutTrState>): LayoutTrState {
    const s = { ...this.state(paperId), ...p }
    this.states.set(paperId, s)
    this.emit(s)
    return s
  }

  /** 界面告诉这里：在看哪一篇的第几页（滚动时一直报）。在看的这篇排在最前面 */
  focus(paperId: string, page: number, total: number): LayoutTrState {
    const s = this.state(paperId, total)
    // 换了一篇：正在翻的是上一篇的，停掉（BabelDOC 自己有译文缓存，下次再翻这几页不再花钱）
    if (this.active && this.active.paperId !== paperId && this.running) this.kill()
    this.active = { paperId, focus: page }
    void this.pump()
    return s
  }
  /** 关了阅读页：不再往后翻 */
  blur(paperId: string): void {
    if (this.active?.paperId !== paperId) return
    this.active = null
    if (this.running) this.kill()
  }
  pause(paperId: string): LayoutTrState {
    if (this.active?.paperId === paperId && this.running) this.kill()
    this.writeIndex(paperId, { ...this.readIndex(paperId), paused: true })
    return this.patch(paperId, { paused: true })
  }
  /** 点「翻成对照」、「继续翻译」、出错后「重试」：没翻成的页也再翻一次 */
  resume(paperId: string): LayoutTrState {
    const idx = this.readIndex(paperId)
    if (!idx.started || idx.paused) this.writeIndex(paperId, { ...idx, started: true, paused: false })
    for (const p of Object.keys(this.state(paperId).failed)) this.fresh.add(`${paperId}:${p}`)
    this.forget(paperId)
    const s = this.patch(paperId, { paused: false, started: true, error: null, errorRaw: null, failed: {}, retrying: null })
    void this.pump()
    return s
  }
  /** 用户点了重试：自动重试的次数、排着的重试组、连着失败的批数都从头算 */
  private forget(paperId: string): void {
    for (const k of [...this.tries.keys()]) if (k.startsWith(`${paperId}:`)) this.tries.delete(k)
    this.retryQ.delete(paperId)
    this.dead.delete(paperId)
  }
  /** 重新翻译这一页：从缓存里拿掉，排到最前面；BabelDOC 自己的译文缓存也不用（不然拿回上次的译文） */
  redo(paperId: string, page: number): LayoutTrState {
    return this.redoPages(paperId, [page], page)
  }
  /** 重新翻译全篇（界面上先确认，要花翻译费） */
  redoAll(paperId: string): LayoutTrState {
    const s = this.state(paperId)
    const all = Array.from({ length: s.total }, (_, i) => i + 1)
    return this.redoPages(paperId, all, this.active?.paperId === paperId ? this.active.focus : 1)
  }
  private redoPages(paperId: string, list: number[], focus: number): LayoutTrState {
    const idx = this.readIndex(paperId)
    const s = this.state(paperId)
    const pages = { ...s.pages }
    const failed = { ...s.failed }
    for (const p of list) {
      delete idx.pages[p]
      delete pages[p]
      delete failed[p]
      this.fresh.add(`${paperId}:${p}`)
      this.tries.delete(`${paperId}:${p}`)
    }
    this.retryQ.set(paperId, (this.retryQ.get(paperId) ?? []).map((g) => g.filter((p) => !list.includes(p))).filter((g) => g.length))
    this.writeIndex(paperId, { ...idx, started: true, paused: false })
    // 不再有页指着的译文文件挪走（这篇的缓存文件夹里，不碰别处）
    const used = new Set(Object.values(idx.pages).map((v) => v.file))
    for (const f of readdirSync(this.dir(paperId))) if (/^p\d+-\d+-\d+\.pdf$/.test(f) && !used.has(f)) rmSync(join(this.dir(paperId), f), { force: true })
    if (this.active?.paperId === paperId) this.active.focus = focus
    // 全篇重翻：正在翻的那批也作废重来
    if (list.length > 1 && this.active?.paperId === paperId && this.running) this.kill()
    this.dead.delete(paperId)
    const out = this.patch(paperId, { pages, failed, paused: false, started: true, error: null, errorRaw: null })
    void this.pump()
    return out
  }
  /** 一个译文文件的内容（界面用 pdf.js 打开） */
  file(paperId: string, name: string): Uint8Array {
    if (!/^[\w.-]+\.pdf$/.test(name)) throw new Error(`bad file: ${name}`)
    return readFileSync(join(this.dir(paperId), name))
  }

  /** 设置 › 翻译：在访达里看组件文件夹 */
  revealComponent(): void {
    if (existsSync(this.d.componentDir)) shell.showItemInFolder(this.d.componentDir)
  }
  /** 设置 › 翻译：删掉组件（移到废纸篓，约 950 MB）；翻好的译文缓存留着，以后要翻新的页再装 */
  async removeComponent(): Promise<void> {
    this.kill()
    this.installer.stop()
    if (existsSync(this.d.componentDir)) await shell.trashItem(this.d.componentDir)
    this.installer.reset()
  }

  stop(): void {
    this.stopped = true
    this.kill()
    this.installer.stop()
    this.proxy.stop()
  }
  private kill(): void {
    if (this.child) killTree(this.child)
  }

  private async pump(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      while (!this.stopped && this.active && this.installer.installed()) {
        const { paperId, focus } = this.active
        const s = this.state(paperId)
        if (s.paused || s.error || !s.total) break
        // 先翻排着重试的组（翻好了、标了没翻成的页去掉），再按在看的位置排新的一批
        const q = this.retryQ.get(paperId) ?? []
        const open = (p: number): boolean => !s.pages[p] && !s.failed[p]
        while (q.length && !q[0].some(open)) q.shift()
        const queued = new Set(q.flat())
        const done = new Set([...Object.keys(s.pages), ...Object.keys(s.failed)].map(Number))
        const retry = q.length ? q.shift()!.filter(open) : null
        const batch = retry ?? nextBatch(s.total, focus, new Set([...done, ...queued]))
        if (!batch.length) break
        // 翻译用的那一家用不了（没 Key、没登录会员）：先说清楚，不然 BabelDOC 每段都失败、整页留原文
        await this.d.ai.trWarm()
        const bad = this.d.ai.trReady()
        if (bad) {
          if (retry) q.unshift(retry)
          this.patch(paperId, { error: bad, errorRaw: null })
          break
        }
        if (retry) {
          // 重试前等一会（服务刚出错多半要缓一缓）：第 2 次 3 秒，第 3 次 8 秒；等的时候用户暂停、换篇了就不翻
          const attempt = Math.max(...retry.map((p) => this.tries.get(`${paperId}:${p}`) ?? 0)) + 1
          await new Promise((r) => setTimeout(r, this.d.retryWaitMs?.(attempt) ?? (attempt <= 2 ? 3000 : 8000)))
          if (this.stopped || this.active?.paperId !== paperId || this.state(paperId).paused) {
            q.unshift(retry)
            break
          }
        }
        await this.runBatch(paperId, batch)
      }
    } finally {
      this.running = false
    }
  }

  /**
   * 这批里没翻成的页排进重试组。一批整个失败（split）且不止一页：不知道是哪页带坏的，不记次数，拆成两半再翻；
   * 单独一页失败、或者译文还是原文的页：记一次，试够 MAX_PAGE_TRIES 次的标「没翻成」（返回这些页和原因）。
   */
  private requeue(paperId: string, pages: number[], kind: TrErrKind, split: boolean): Record<number, string> {
    const q = this.retryQ.get(paperId) ?? []
    this.retryQ.set(paperId, q)
    if (split && pages.length > 1) {
      const half = Math.ceil(pages.length / 2)
      q.push(pages.slice(0, half), pages.slice(half))
      return {}
    }
    const failed: Record<number, string> = {}
    const again: number[] = []
    for (const p of pages) {
      const k = `${paperId}:${p}`
      const n = (this.tries.get(k) ?? 0) + 1
      this.tries.set(k, n)
      if (n >= MAX_PAGE_TRIES) failed[p] = trWhy(kind)
      else again.push(p)
    }
    if (again.length) q.push(again)
    return failed
  }

  /** 排着的下一组重试（顶栏说「第几页重试中 · 为什么」） */
  private nextRetry(paperId: string, why: string): LayoutTrState['retrying'] {
    const g = this.retryQ.get(paperId)?.[0]
    if (!g?.length) return null
    return { pages: g, why, attempt: Math.max(...g.map((p) => this.tries.get(`${paperId}:${p}`) ?? 0)) + 1 }
  }

  private async runBatch(paperId: string, pages: number[]): Promise<void> {
    const t0 = Date.now()
    const retrying = this.state(paperId).retrying
    this.patch(paperId, { busy: pages, busySince: t0, retrying: retrying && retrying.pages.some((p) => pages.includes(p)) ? retrying : null })
    const dir = this.dir(paperId)
    const job = join(dir, `job-${t0}`)
    mkdirSync(join(job, 'out'), { recursive: true })
    try {
      const base = await this.proxy.start()
      this.proxy.useId = `layout-${paperId}`
      const [py, pre] = babelCommand(this.d.componentDir)
      const args = [
        ...pre,
        '--files', this.d.pdfPath(paperId),
        '--pages', pagesArg(pages),
        '--only-include-translated-page',
        '--no-dual',
        // 不让 BabelDOC 判扫描件：课件里图多字少的页它判成扫描页，一批里超过八成就整批不出译文（还是退出码 0）。翻没翻成下面逐页比
        '--skip-scanned-detection',
        '--lang-in', 'en',
        '--lang-out', this.lang(),
        '--openai', '--openai-model', 'pararead', '--openai-base-url', base, '--openai-api-key', this.proxy.token,
        '--qps', String(this.d.ai.trQps()),
        '--output', join(job, 'out'),
        '--working-dir', join(job, 'work'),
        '--watermark-output-mode', 'no_watermark',
        '--report-interval', '1',
        ...(pages.some((p) => this.fresh.has(`${paperId}:${p}`)) ? ['--ignore-cache'] : [])
      ]
      this.d.log(`保版面翻译：${paperId} 第 ${pagesArg(pages)} 页`)
      this.proxy.resetStats()
      const tail = await this.exec(py, args)
      const { calls, failed, lastError, retries } = this.proxy
      this.d.log(`保版面翻译：${paperId} 第 ${pagesArg(pages)} 页 BabelDOC 请求 ${calls} 次，重试 ${retries} 次，最后失败 ${failed} 次${failed ? `（最后一个：${lastError.slice(0, 200)}）` : ''}`)
      // 请求一个都没成：BabelDOC 照样退出码 0、把原文当译文写出来（0.2.0 用户碰到的），这一批算失败
      const noneOk = calls > 0 && failed >= calls
      const out = readdirSync(join(job, 'out')).find((f) => f.endsWith('.mono.pdf'))
      if (noneOk) throw Object.assign(new Error(t('翻译请求失败：{0}', lastError.slice(0, 200))), { kind: this.proxy.lastKind ?? trErrKind(lastError), dead: true })
      // 没写出译文：BabelDOC 自己报的错在它的日志里（它这时也是退出码 0），挑带 ERROR 的那行说
      if (!out) throw new Error(`BabelDOC：${errorLine(tail) || t('没写出译文 PDF')}`)
      this.dead.delete(paperId)
      // 每页比原文和译文：原文原样留着的页算没翻成，不进缓存、不当译文显示
      const sorted = [...pages].sort((a, b) => a - b)
      const outData = new Uint8Array(readFileSync(join(job, 'out', out)))
      const [srcTexts, outTexts] = await Promise.all([pageTexts(new Uint8Array(readFileSync(this.d.pdfPath(paperId))), sorted), pageTexts(outData)])
      const bad: Record<number, string> = {}
      sorted.forEach((p, i) => {
        const why = outTexts.length === sorted.length ? untranslatedReason(srcTexts[i], outTexts[i]) : t('译文页数不对')
        if (why) bad[p] = why
      })
      const good = sorted.filter((p) => !bad[p])
      const name = `p${pages[0]}-${pages[pages.length - 1]}-${t0}.pdf`
      const add = Object.fromEntries(Object.entries(indexBatch(pages, name)).filter(([p]) => !bad[Number(p)]))
      if (good.length) {
        renameSync(join(job, 'out', out), join(dir, name))
        const idx = this.readIndex(paperId)
        idx.pages = { ...idx.pages, ...add }
        this.writeIndex(paperId, idx)
      }
      for (const p of good) {
        this.fresh.delete(`${paperId}:${p}`)
        this.tries.delete(`${paperId}:${p}`)
      }
      const ms = Date.now() - t0
      const badList = Object.keys(bad).map(Number)
      // 译文还是原文的页：多半是那几段请求重试过还失败（原因按请求的错说），不然就是 BabelDOC 没翻；不用缓存再翻，试够了才标没翻成
      const kind: TrErrKind = failed ? (this.proxy.lastKind ?? trErrKind(lastError)) : 'same'
      for (const p of badList) this.fresh.add(`${paperId}:${p}`)
      const gaveUp = badList.length ? this.requeue(paperId, badList, kind, false) : {}
      if (badList.length) this.d.log(`保版面翻译：${paperId} 第 ${badList.join(',')} 页没翻成（${Object.values(bad)[0]}${failed ? `；请求失败 ${failed} 次：${lastError.slice(0, 120)}` : ''}），${Object.keys(gaveUp).length ? `第 ${Object.keys(gaveUp).join(',')} 页试够了不再自动翻` : '等一会再翻'}`)
      this.d.log(`保版面翻译：${paperId} 第 ${pagesArg(pages)} 页好了 ${good.length} 页，${Math.round(ms / 1000)} 秒`)
      const st = this.state(paperId)
      this.patch(paperId, { pages: { ...st.pages, ...add }, failed: { ...st.failed, ...gaveUp }, busy: [], busySince: null, msPerPage: Math.round(ms / pages.length), retrying: this.nextRetry(paperId, trWhy(kind)) })
    } catch (e) {
      const err = e as Error & { kind?: TrErrKind; dead?: boolean }
      if (err.message === '__killed__') {
        this.patch(paperId, { busy: [], busySince: null })
        return
      }
      const kind = err.kind ?? trErrKind(err.message)
      this.d.log(`保版面翻译出错（${kind}）：${err.message}`)
      const st = this.state(paperId)
      const dead = err.dead ? (this.dead.get(paperId) ?? 0) + 1 : 0
      this.dead.set(paperId, dead)
      // 翻译服务本身用不了（Key 不对、没余额），或者连着几批一个请求都没成：整篇停下说原因，页不标没翻成（点重试接着翻）
      if (FATAL_KINDS.includes(kind) || dead >= MAX_DEAD_BATCHES) {
        this.patch(paperId, { busy: [], busySince: null, retrying: null, error: dead >= MAX_DEAD_BATCHES ? t('{0}，连着 {1} 批都没翻成', trWhy(kind), dead) : trWhy(kind), errorRaw: err.message.slice(0, 300) })
        return
      }
      // 别的（BabelDOC 出错、这批请求都失败了）：这批拆两半再翻，试够了的页标没翻成，别的页照常往下翻
      const gaveUp = this.requeue(paperId, pages, kind, true)
      this.patch(paperId, { busy: [], busySince: null, failed: { ...st.failed, ...gaveUp }, retrying: this.nextRetry(paperId, trWhy(kind)) })
    } finally {
      rmSync(job, { recursive: true, force: true })
    }
  }

  /** 跑 BabelDOC，成了回它最后的输出（没写出译文时从里面挑错） */
  private exec(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: this.d.componentDir, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true })
      this.child = child
      let tail = ''
      const on = (b: Buffer): void => {
        tail = (tail + b.toString()).slice(-6000)
      }
      child.stdout!.on('data', on)
      child.stderr!.on('data', on)
      child.on('error', (e) => reject(new Error(`BabelDOC：${e.message}`)))
      child.on('close', (code, sig) => {
        this.child = null
        if (code === 0) return resolve(tail)
        if (sig) return reject(new Error('__killed__'))
        reject(new Error(`BabelDOC ${t('退出码')} ${code}：${(errorLine(tail) || lastLine(tail)).slice(0, 240)}`))
      })
    })
  }

  /** BabelDOC 的环境：macOS 上加 CoreML 编译缓存（sitecustomize.py，只给 onnxruntime 加 ModelCacheDirectory，不改 BabelDOC） */
  private env(): NodeJS.ProcessEnv {
    const env = babelEnv(this.d.componentDir)
    if (process.platform !== 'darwin') return env
    const shimDir = join(this.d.componentDir, 'pararead-py')
    const shim = join(shimDir, 'sitecustomize.py')
    if (!existsSync(shim) || readFileSync(shim, 'utf8') !== COREML_SHIM) {
      mkdirSync(shimDir, { recursive: true })
      writeFileSync(shim, COREML_SHIM)
    }
    return { ...env, PYTHONPATH: shimDir, PARAREAD_COREML_CACHE: join(this.d.componentDir, 'home', '.cache', 'pararead-coreml') }
  }
}

const plain = (tail: string): string[] =>
  tail
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
/** BabelDOC 输出里最后一行带 ERROR 的（去掉它日志的时间、级别前缀） */
export function errorLine(tail: string): string {
  const l = [...plain(tail)].reverse().find((x) => /\bERROR\b|exception|Traceback/i.test(x) && !/Failed to migrate TOC/i.test(x))
  return l ? l.replace(/^(\[[^\]]*\]\s*)?(ERROR\s+)?(ERROR:)?[\w.]+:/, '').replace(/\s+[\w.]+\.py:\d+$/, '').trim() : ''
}
const lastLine = (tail: string): string => plain(tail).pop() ?? ''

/**
 * 放进 BabelDOC 的 Python 里（PYTHONPATH 上的 sitecustomize.py，启动时自动跑）：创建 onnxruntime 会话时给 CoreML 加编译缓存，
 * 缓存按模型内容的哈希分文件夹（BabelDOC 换了模型不会拿错）。出任何错都只打一行、照常不带缓存跑。
 */
const COREML_SHIM = `# ParaRead: keep onnxruntime's compiled CoreML model between BabelDOC runs (adds ModelCacheDirectory only; BabelDOC is untouched)
import hashlib, os
_dir = os.environ.get("PARAREAD_COREML_CACHE")
if _dir:
    try:
        import onnxruntime as _ort
        _Base = _ort.InferenceSession

        class _Cached(_Base):
            def __init__(self, model, sess_options=None, providers=None, *a, **k):
                if providers and isinstance(model, (bytes, bytearray)):
                    sub = os.path.join(_dir, hashlib.sha256(model).hexdigest()[:16])
                    os.makedirs(sub, exist_ok=True)
                    providers = [("CoreMLExecutionProvider", {"ModelCacheDirectory": sub}) if p == "CoreMLExecutionProvider" else p for p in providers]
                super().__init__(model, sess_options, providers, *a, **k)

        _ort.InferenceSession = _Cached
    except Exception as e:
        print("pararead: coreml cache off:", e)
`

export function registerLayoutTr(lt: LayoutTranslator): void {
  ipcMain.handle('layoutTr:installState', () => lt.installer.state)
  ipcMain.handle('layoutTr:install', () => void lt.installer.start())
  ipcMain.handle('layoutTr:stopInstall', () => lt.installer.pause())
  ipcMain.handle('layoutTr:state', (_e, paperId: string, total: number) => lt.state(paperId, total))
  ipcMain.handle('layoutTr:focus', (_e, paperId: string, page: number, total: number) => lt.focus(paperId, page, total))
  ipcMain.handle('layoutTr:blur', (_e, paperId: string) => lt.blur(paperId))
  ipcMain.handle('layoutTr:pause', (_e, paperId: string) => lt.pause(paperId))
  ipcMain.handle('layoutTr:resume', (_e, paperId: string) => lt.resume(paperId))
  ipcMain.handle('layoutTr:redo', (_e, paperId: string, page: number) => lt.redo(paperId, page))
  ipcMain.handle('layoutTr:redoAll', (_e, paperId: string) => lt.redoAll(paperId))
  ipcMain.handle('layoutTr:file', (_e, paperId: string, name: string) => lt.file(paperId, name))
  ipcMain.handle('layoutTr:reveal', () => lt.revealComponent())
  ipcMain.handle('layoutTr:remove', () => lt.removeComponent())
}
