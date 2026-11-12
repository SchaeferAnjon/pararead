// 冒烟：导入测试论文 → 等快速重排 → 打开 → 对照模式出译文 → 问 AI → 退出。
// node scripts/e2e/smoke.mjs <数据目录>；AI 用 DeepSeek：DEEPSEEK_API_KEY=$(dispatch env get DEEPSEEK_API_KEY)
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-smoke`, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true })) // 新数据目录会先出首次引导
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  console.log('导入', r.status, r.paper?.title)
  const id = r.paper.id
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if ((await ev((x) => window.api.getPaper(x), id)).reflow.ready) break
  }
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(8000)
  console.log('译文', await win.locator('.tr-text').count(), '段')
  console.log(await shot(win, 'smoke-reflow'))
  const got = { text: '', done: false, err: '' }
  await win.exposeFunction('__s', (e) => ((got.text += e.delta ?? ''), (got.done ||= !!e.done), (got.err ||= e.error ?? '')))
  await ev(() => window.api.onStream((e) => window.__s(e)))
  await ev((x) => window.api.chatSend('smoke1', x, { content: '一句话总结', quote: null, image: null }), id)
  for (let i = 0; i < 90 && !got.done && !got.err; i++) await sleep(1000)
  console.log('AI', got.err || got.text.slice(0, 80))
} finally {
  await close(app)
}
