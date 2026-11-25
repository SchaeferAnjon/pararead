// 端到端走查一次全跑（先 pnpm run build）：每个脚本一个新数据目录、一个自己的浏览器插件接收口，同时跑 --workers 个（默认 2），
// 最后列出过了几个、挂了几个，每个的输出在 <输出目录>/<名字>.log。超时（默认 15 分钟）的算挂。
//   E2E_PAPER=<双栏英文论文> E2E_PAPER2=<另一篇> DEEPSEEK_API_KEY=… node scripts/e2e/all.mjs [--workers=2] [--only=a,b] [--out=<目录>]
// 默认不跑的：packaged、windows（要装好的包，E2E_APP）、mineru-install（下载约 2 GB）、claude-code（要本机 claude 登录着，花订阅），
// langs（找漏翻的工具，参数是语言和两个数据目录，不分过不过）、layout-tr（真装约 950 MB 的 BabelDOC、真翻 13 页），
// 用 --only 点名才跑。connector、word、inspiration 用固定端口（27485、27484），只在别的都跑完后一个一个跑。
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '../..')
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const workers = Math.max(1, Number(arg('workers') ?? 2))
const out = arg('out') ?? mkdtempSync(join(tmpdir(), 'pararead-e2e-all-'))
const timeoutMin = Number(arg('timeout') ?? 15)
const OPT_IN = ['bg-perf', 'packaged', 'windows', 'mineru-install', 'claude-code', 'langs', 'layout-tr']
const SERIAL = ['connector', 'word', 'inspiration']
const NOT_SCRIPTS = ['drive', 'all', 'office-stub']

const every = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.slice(0, -4))
  .filter((n) => !NOT_SCRIPTS.includes(n))
const only = arg('only')?.split(',')
const names = only ?? every.filter((n) => !OPT_IN.includes(n))
for (const n of names) if (!every.includes(n)) throw new Error(`没有 scripts/e2e/${n}.mjs`)
if (!process.env.E2E_PAPER) throw new Error('要 E2E_PAPER：一篇双栏英文论文的 PDF')
mkdirSync(join(out, 'data'), { recursive: true })

let port = 27600 + Math.floor(Math.random() * 300)
function run(name) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const env = { ...process.env, E2E_SHOTS: join(out, 'shots', name) }
    // 插件接收口：connector 要测的就是 27485 本身，别的都换开，免得同时开着的几个抢一个口、或者发进正在用的 ParaRead
    if (name !== 'connector') env.PARAREAD_CONNECTOR_PORT = String(port++)
    const child = spawn(process.execPath, [join(HERE, `${name}.mjs`), join(out, 'data', name)], { cwd: ROOT, env, detached: true })
    let log = ''
    child.stdout.on('data', (d) => (log += d))
    child.stderr.on('data', (d) => (log += d))
    const timer = setTimeout(() => {
      log += `\n超过 ${timeoutMin} 分钟，杀掉\n`
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }, timeoutMin * 60_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      writeFileSync(join(out, `${name}.log`), log)
      const s = Math.round((Date.now() - t0) / 1000)
      const passed = code === 0
      console.log(`${passed ? '过' : '挂'}  ${name}（${s} 秒${passed ? '' : `，退出码 ${code}`}）`)
      resolve({ name, passed, s })
    })
  })
}

const queue = names.filter((n) => !SERIAL.includes(n))
const results = []
await Promise.all(
  Array.from({ length: Math.min(workers, queue.length) }, async () => {
    for (let n; (n = queue.shift()); ) results.push(await run(n))
  }),
)
for (const n of names.filter((n) => SERIAL.includes(n))) results.push(await run(n))

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length} 个脚本：${results.length - failed.length} 过，${failed.length} 挂${failed.length ? `（${failed.map((r) => r.name).join('、')}）` : ''}`)
console.log(`输出在 ${out}`)
process.exit(failed.length ? 1 : 0)
