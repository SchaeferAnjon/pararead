// 思考强度（2026-11-15 起按模型选档）走一遍：DeepSeek 真发请求，「关」没有思考、「开」先想再答；
// 有 ZHIPU_API_KEY 时智谱 Coding Plan 也发：「低」实测不想，「高」先想；
// 总会先想的模型（Kimi K3、Claude）问答框写「总会先想」，菜单里没有可选的档，设置里写明。
// DEEPSEEK_API_KEY=… [ZHIPU_API_KEY=…] E2E_PAPER=<一篇论文的 PDF> node scripts/e2e/thinking.mjs <数据目录>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-think`
const { app, win } = await launch(dir, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, ZHIPU_API_KEY: process.env.ZHIPU_API_KEY ?? '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const Q = '一个房间里有 3 个开关控制隔壁 3 盏灯，只能进隔壁一次，怎么确定对应关系？一句话回答。'
try {
  await ev((d) => window.api.setSettings({ onboarded: true, agentDir: d, provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', thinkLevels: {} }), `${dir}/projects`)
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
  // 思考档在输入框底行「想多久」那一颗（@cn/ai-chat，2026-11-23 起）
  const chip = win.locator('.col-right [data-testid=ai-effort]')
  const ask = async () => {
    Object.assign(st, { text: '', reasoning: '', err: '' })
    const was = st.done
    await win.locator('.col-right textarea').fill(Q)
    await win.locator('.col-right textarea').press('Enter')
    for (let i = 0; i < 240 && st.done === was && !st.err; i++) await sleep(500)
    await sleep(300)
    return { text: st.text, reasoning: st.reasoning.length, err: st.err, badge: (await win.locator('.col-right [data-testid=pr-answer]').last().locator('.think-row').count()) > 0 }
  }
  // 从输入框底行「想多久」的菜单里选一档
  const setLevel = async (name) => {
    await chip.click()
    await sleep(200)
    await win.locator('.aipk-menu [role=menuitemradio]').filter({ has: win.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
    await sleep(300)
  }

  const runs = [['deepseek', 'deepseek-flash', '关', '开']]
  if (process.env.ZHIPU_API_KEY) runs.push(['zhipu-coding', 'glm-5.3-flash', '低', '高'])
  for (const [prov, model, low, high] of runs) {
    await ev(([p, m]) => window.api.setSettings({ provider: p, textModel: m, visionModel: m }), [prov, model])
    await sleep(800)
    await setLevel(low)
    const off = await ask()
    // GLM-5.3 关不掉思考，最省的「低」实测不想
    ok(`${prov}「${low}」：界面上没有思考`, !off.err && off.text.length > 5 && off.reasoning === 0 && !off.badge, `${off.err}思考 ${off.reasoning} 字｜${off.text.slice(0, 40)}`)
    await setLevel(high)
    const on = await ask()
    const line = await win.locator('.col-right [data-testid=pr-answer]').last().locator('.read .by').innerText().catch(() => '')
    ok(`${prov}「${high}」：先思考再答，回答头写「· ${high}」、下面有「已思考」`, !on.err && on.text.length > 5 && on.reasoning > 50 && on.badge && line.includes(`· ${high}`), `${on.err}思考 ${on.reasoning} 字｜${line}｜${on.text.slice(0, 40)}`)
    console.log(await shot(win, `think-${prov}`))
  }
  if (!process.env.ZHIPU_API_KEY) console.log('跳过 智谱：没给 ZHIPU_API_KEY')

  // 总会先想的模型：开关不显示；换回去又出来
  await ev(() => window.api.setSettings({ provider: 'kimi', textModel: 'kimi-k3', visionModel: 'kimi-k3' }))
  await sleep(800)
  ok('Kimi K3：没有能选的档，「想多久」那一颗不出', (await chip.count()) === 0)
  await ev(() => window.api.openSettings('ai'))
  await sleep(1500)
  const sw = app.windows().find((w) => w !== win)
  const row = sw.locator('.frow', { hasText: '每次都会先想再答' })
  ok('Kimi K3：设置里写明每次都会先想，没有档位按钮', (await row.count()) === 1 && (await sw.locator('.think-pick').count()) === 0)
  console.log(await shot(sw, 'think-settings-kimi'))
  await sw.close()
  await ev(() => window.api.setSettings({ provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash' }))
  await sleep(800)
  ok('换回 DeepSeek：还是记着的「开」', (await chip.innerText()).trim() === '开')
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全过')
process.exit(fails.length ? 1 : 0)
