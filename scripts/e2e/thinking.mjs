// 深度思考开关走一遍：DeepSeek、智谱 Coding Plan 两家真发请求，开的时候有思考、关的时候没有；
// 总会先想的模型（Kimi K3、Claude）问答框里不显示开关，设置里写明。
// DEEPSEEK_API_KEY=… ZHIPU_API_KEY=… E2E_PAPER=<一篇论文的 PDF> node scripts/e2e/thinking.mjs <数据目录>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-think`
const { app, win } = await launch(dir)
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const Q = '一个房间里有 3 个开关控制隔壁 3 盏灯，只能进隔壁一次，怎么确定对应关系？一句话回答。'
try {
  await ev((d) => window.api.setSettings({ onboarded: true, agentDir: d, provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', thinking: false }), `${dir}/projects`)
  await sleep(500)
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 60 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2000)

  const st = { text: '', reasoning: '', done: 0, err: '' }
  await win.exposeFunction('__th', (e) => {
    if (e.delta) st.text += e.delta
    if (e.reasoning) st.reasoning += e.reasoning
    if (e.done) st.done++
    if (e.error) st.err = e.error
  })
  await ev(() => window.api.onStream((e) => window.__th(e)))
  const chip = win.locator('.col-right .tchip', { hasText: '深度思考' })
  const ask = async () => {
    Object.assign(st, { text: '', reasoning: '', err: '' })
    const was = st.done
    await win.locator('.col-right textarea').fill(Q)
    await win.locator('.col-right textarea').press('Enter')
    for (let i = 0; i < 240 && st.done === was && !st.err; i++) await sleep(500)
    await sleep(300)
    return { text: st.text, reasoning: st.reasoning.length, err: st.err, badge: (await win.locator('.msg-ai.last .think').count()) > 0 }
  }
  const setChip = async (on) => {
    if ((await chip.evaluate((b) => b.classList.contains('on'))) !== on) await chip.click()
    await sleep(300)
  }

  for (const [prov, model] of [
    ['deepseek', 'deepseek-flash'],
    ['zhipu-coding', 'glm-5.3-flash']
  ]) {
    await ev(([p, m]) => window.api.setSettings({ provider: p, textModel: m, visionModel: m }), [prov, model])
    await sleep(800)
    await setChip(false)
    const off = await ask()
    // GLM-5.3 关不掉思考，只压到最浅；关着时界面不显示思考
    ok(`${prov} 关着：界面上没有思考`, !off.err && off.text.length > 5 && off.reasoning === 0 && !off.badge, `${off.err}思考 ${off.reasoning} 字｜${off.text.slice(0, 40)}`)
    await setChip(true)
    const on = await ask()
    ok(`${prov} 开着：先思考再答，界面显示「已深度思考」`, !on.err && on.text.length > 5 && on.reasoning > 50 && on.badge, `${on.err}思考 ${on.reasoning} 字｜${on.text.slice(0, 40)}`)
    console.log(await shot(win, `think-${prov}`))
  }

  // 总会先想的模型：开关不显示；换回去又出来
  await ev(() => window.api.setSettings({ provider: 'kimi', textModel: 'kimi-k3', visionModel: 'kimi-k3' }))
  await sleep(800)
  ok('Kimi K3：问答框里没有深度思考开关', (await chip.count()) === 0)
  await ev(() => window.api.openSettings('ai'))
  await sleep(1500)
  const sw = app.windows().find((w) => w !== win)
  const row = sw.locator('.frow', { hasText: '每次都会先想再答' })
  ok('Kimi K3：设置里写明每次都会先想', (await row.count()) === 1 && (await sw.locator('.frow', { hasText: '深度思考默认开' }).count()) === 0)
  console.log(await shot(sw, 'think-settings-kimi'))
  await sw.close()
  await ev(() => window.api.setSettings({ provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash' }))
  await sleep(800)
  ok('换回 DeepSeek：开关又出来', (await chip.count()) === 1)
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
