// 假 BabelDOC（tests/trRetry.test.ts 用）：照真的那样认命令行参数，每页给 ParaRead 的本机口子发一个翻译请求，写出 <out>/*.mono.pdf。
// FAKE_BABEL_CONF 指一个 JSON：crash 是这批里有就退出码 1 的页，same 是永远照抄原文的页，log 记每次跑了哪几页。
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makePdf, srcText, trText } from './fakePdf.mjs'

const argv = process.argv.slice(2)
const arg = (k) => argv[argv.indexOf(k) + 1]
const conf = JSON.parse(readFileSync(process.env.FAKE_BABEL_CONF, 'utf8'))
const pages = arg('--pages')
  .split(',')
  .flatMap((r) => {
    const [a, b] = r.split('-').map(Number)
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i)
  })
appendFileSync(conf.log, `${pages.join(',')}${argv.includes('--ignore-cache') ? ' fresh' : ''}\n`)

const ok = {}
await Promise.all(
  pages.map(async (p) => {
    const r = await fetch(`${arg('--openai-base-url')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${arg('--openai-api-key')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'pararead', messages: [{ role: 'user', content: `page ${p}` }] })
    })
    ok[p] = r.status === 200
  })
)
if (pages.some((p) => conf.crash.includes(p))) {
  console.log('[11/25/26 10:00:00] ERROR    ERROR:babeldoc.main:Error: boom on a crash page                 main.py:778')
  process.exit(1)
}
// 请求失败的页 BabelDOC 留原文，永远照抄的页也是原文
const out = pages.map((p) => (ok[p] && !conf.same.includes(p) ? trText(p) : srcText(p)))
writeFileSync(join(arg('--output'), 'paper.no_watermark.zh-CN.mono.pdf'), makePdf(out))
