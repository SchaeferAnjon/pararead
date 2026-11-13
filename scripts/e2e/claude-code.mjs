// 本机 Claude Code 这条通道走一遍（要这台电脑上装好并登录了 claude）：
// 首次引导里选它 → 设置里选它、验证 → 问答（流式、追问、带截图）→ 核心概念（JSON）→ 中途停 → 对照翻译 → 研究 Agent 用工具。
// node scripts/e2e/claude-code.mjs <数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { execFileSync } from 'node:child_process'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-cc`
const { app, win } = await launch(dir, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const children = () => execFileSync('/bin/sh', ['-c', 'pgrep -f "[c]laude -p --system-prompt-file" | wc -l']).toString().trim()
try {
  await sleep(1500)
  // 新数据目录先出首次引导：第 2 步「自带 Key」里选本机 Claude Code，没有 Key 输入框，点验证
  await win.locator('.of .btn.primary').click()
  await sleep(400)
  await win.locator('.choice', { hasText: '自带 Key' }).first().click({ position: { x: 16, y: 16 } })
  await win.locator('.prov-mini .pm', { hasText: '本机 Claude Code' }).click()
  await sleep(3000)
  const card = win.locator('.choice.on')
  ok('引导里选它：找到了，没有 Key 输入框', /版本/.test(await card.locator('.line .hint').innerText()) && (await card.locator('input').count()) === 0, (await card.locator('.line .hint').innerText()).trim())
  await card.locator('.btn', { hasText: '验证' }).click()
  await card.locator('.ok-t, .err-t').waitFor({ timeout: 60000 })
  ok('引导里验证', (await card.locator('.ok-t').count()) === 1, (await card.locator('.hint').last().innerText()).trim())
  console.log(await shot(win, 'cc-onboarding'))
  await ev((d) => window.api.setSettings({ onboarded: true, agentDir: d, provider: 'deepseek' }), `${dir}/projects`)
  await sleep(500)

  // 设置 › AI 服务：点「本机 Claude Code」，看状态，点验证
  await ev(() => window.api.openSettings('ai'))
  await sleep(1500)
  const sw = app.windows().find((w) => w !== win)
  await sw.locator('.prov .p', { hasText: '本机 Claude Code' }).click()
  await sw.locator('.frow', { hasText: 'Claude Code' }).locator('input').first().waitFor()
  await sleep(2500)
  const row = sw.locator('.frow').filter({ has: sw.locator('.fl', { hasText: /^Claude Code$/ }) })
  ok('设置里找到了 claude', /claude$/.test(await row.locator('input').inputValue()), `${await row.locator('input').inputValue()}｜${await row.locator('.hint').innerText()}`)
  await row.locator('button.btn', { hasText: '验证' }).click()
  await row.locator('.ok-t, .err-t').waitFor({ timeout: 60000 })
  ok('验证：真问了一句', (await row.locator('.ok-t').count()) === 1, await row.locator('.hint').innerText())
  const s = await ev(() => window.api.getSettings())
  ok('模型换成这一家的', s.provider === 'claude-code' && s.textModel === 'haiku' && s.visionModel === 'haiku', `${s.textModel}/${s.visionModel}`)
  console.log(await shot(sw, 'cc-settings'))
  await sw.close()

  // 导入论文、打开
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 60 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  ok('导入时用它抽了标题', !!r.paper.title, r.paper.title)
  await sleep(500)
  console.log(await shot(win, 'cc-library'))
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2000)

  // 问答：在输入框里打字回车，等流式回答结束
  const st = { text: '', done: 0, err: '', chunks: 0 }
  await win.exposeFunction('__cc', (e) => {
    if (e.delta) (st.text += e.delta), st.chunks++
    if (e.done) st.done++
    if (e.error) st.err = e.error
  })
  await ev(() => window.api.onStream((e) => window.__cc(e)))
  const ask = async (text, wait = 90) => {
    Object.assign(st, { text: '', err: '', chunks: 0 })
    const was = st.done
    await win.locator('.col-right textarea').fill(text)
    await win.locator('.col-right textarea').press('Enter')
    for (let i = 0; i < wait * 2 && st.done === was && !st.err; i++) await sleep(500)
    return st.err ? `出错：${st.err}` : st.text
  }
  const a1 = await ask('用一句话说这份材料讲什么')
  ok('问答出字，一段一段来的', a1.length > 10 && st.chunks > 3 && !st.err, `${st.chunks} 段｜${a1.slice(0, 60)}`)
  const a2 = await ask('把你刚才那句话翻成英文，只给英文')
  ok('追问接得上上一轮', /[a-z]{4,}/i.test(a2) && !st.err, a2.slice(0, 80))
  console.log(await shot(win, 'cc-chat'))

  // 带截图的问答（看图模型）
  const png = `data:image/png;base64,${(await win.screenshot()).toString('base64')}`
  Object.assign(st, { text: '', err: '', chunks: 0 })
  let was = st.done
  await ev(([x, img]) => window.api.chatSend('cc-img', x, { content: '图里左边那一页最大的标题是什么？只答标题', quote: null, image: img }), [id, png])
  for (let i = 0; i < 120 && st.done === was && !st.err; i++) await sleep(500)
  ok('看图', /propositional|normal forms/i.test(st.text), st.err || st.text.slice(0, 60))

  // 核心概念（要 JSON 的一次性请求）
  const c = await ev((x) => window.api.concepts(x, true), id)
  ok('核心概念', c.concepts.length > 2, c.concepts.slice(0, 3).map((x) => x.term ?? x.name ?? JSON.stringify(x).slice(0, 20)).join('、'))

  // 中途停：进程要跟着退
  Object.assign(st, { text: '', err: '', chunks: 0 })
  await ev((x) => window.api.chatSend('cc-stop', x, { content: '写一篇 1500 字的综述，分十节', quote: null, image: null }), id)
  for (let i = 0; i < 40 && st.chunks < 3; i++) await sleep(250)
  const running = children()
  await ev(() => window.api.aiAbort('cc-stop'))
  await sleep(2500)
  ok('中途停', st.err === '已停止' && running !== '0' && children() === '0', `停之前 ${running} 个进程，停之后 ${children()} 个｜${st.err}`)

  // 对照：整篇翻译一段一段调
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  let tr = 0
  for (let i = 0; i < 45 && tr < 6; i++) (await sleep(1000)), (tr = await win.locator('.tr-text').count())
  ok('对照翻译', tr >= 6, `${tr} 段，头一段：${(await win.locator('.tr-text').first().innerText().catch(() => '')).slice(0, 40)}`)
  console.log(await shot(win, 'cc-reflow'))

  // 研究 Agent：用工具看文件、读文件
  const p = await ev(() => window.api.agentCreateProject('cc-demo'))
  const ses = await ev((x) => window.api.agentNewSession(x), p.id)
  const evs = []
  await win.exposeFunction('__ag', (e) => evs.push(e))
  await ev(() => window.api.onAgentEvent((e) => window.__ag(e)))
  await ev(([a, b]) => window.api.agentSend(a, b, '列出项目里的文件，读 README.md，然后用一句话告诉我里面写了什么'), [p.id, ses.id])
  for (let i = 0; i < 180 && !evs.some((e) => (e.ev ?? e).type === 'done'); i++) await sleep(500)
  const flat = evs.map((e) => e.ev ?? e)
  const used = [...new Set(flat.filter((e) => e.type === 'tool').map((e) => e.step.name))]
  const said = flat.filter((e) => e.type === 'text').map((e) => e.text)
  ok('Agent 用了工具并答了', used.includes('read_file') && said.length > 0 && !flat.some((e) => e.type === 'error'), `工具：${used.join('、')}｜${(said.at(-1) ?? flat.find((e) => e.type === 'error')?.error ?? '').slice(0, 80)}`)
  ok('没有留下命令行进程', children() === '0', children())
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
