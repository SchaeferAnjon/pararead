// AI 重点：开着时原文里的重点句有灰底，译文里对应的那一句也要有；关掉两边都没有。
// DEEPSEEK_API_KEY=… node scripts/e2e/marks.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-marks`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
// 现在圈着的：原文几处、译文几处，以及第一对的字
const marks = () => ev(() => { const rs = [...(CSS.highlights.get('ai-mark') ?? [])]; const side = (r) => (r.startContainer.parentElement.closest('.tr') ? 'zh' : 'en'); const en = rs.filter((r) => side(r) === 'en'), zh = rs.filter((r) => side(r) === 'zh'); const z = zh[0]; const blk = z?.startContainer.parentElement.closest('[data-block]'); const e = z && en.find((r) => r.startContainer.parentElement.closest('[data-block]') === blk); return { en: en.length, zh: zh.length, pair: z ? [e?.toString().slice(0, 70), z.toString().slice(0, 50)] : null, block: blk?.dataset.block } })
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), r.paper.id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${r.paper.id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(1500)
  await win.locator('.mid-bar button[title="全文翻译"], .mid-bar button', { hasText: '全文翻译' }).first().click()
  await win.locator('.mid-bar button[title="AI 重点高亮"]').click()
  let m = { en: 0, zh: 0 }
  for (let i = 0; i < 150 && !(m.en > 0 && m.zh > 0); i++) (await sleep(1000)), (m = await marks())
  ok('AI 重点开着：原文里的重点句圈出来了', m.en > 0, `${m.en} 处`)
  ok('译文里对应的句子也圈出来了', m.zh > 0 && /[一-鿿]/.test(m.pair?.[1] ?? ''), JSON.stringify(m.pair))
  for (let i = 0; i < 60 && m.zh < Math.min(3, m.en); i++) (await sleep(1000)), (m = await marks())
  console.log(`原文 ${m.en} 处，译文 ${m.zh} 处`)
  if (m.block) await ev((b) => document.querySelector(`[data-block="${b}"]`).scrollIntoView({ block: 'center' }), m.block)
  await sleep(600)
  console.log(await shot(win, 'marks-both'))
  await win.locator('.mid-bar button[title="AI 重点高亮"]').click()
  await sleep(800)
  m = await marks()
  ok('关掉 AI 重点：两边都没有了', m.en === 0 && m.zh === 0)
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
