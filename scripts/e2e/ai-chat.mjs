// 右栏 AI 问答照画布笔记（2026-11-23）真点一遍：输入框底下的「谁来答」、真问（DeepSeek）、接着问、贴一张图问、换一家（画布笔记那套的
// DeepSeek API）、回答下面那排（拷贝、存为笔记、⋯）、全能模式那一行、「用画布笔记那把？」（测试 Key 由 PR_TEST_NOTES_KEYS 交，真问一句 Claude Haiku）。
// DEEPSEEK_API_KEY=… [CN_TEST_ANTHROPIC_API_KEY=…] E2E_PAPER=<论文 PDF> node scripts/e2e/ai-chat.mjs <数据目录> [截图目录]
import { close, launch, PAPER, SHOTS, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-aichat`
const OUT = process.argv[3] ?? SHOTS
const anth = process.env.CN_TEST_ANTHROPIC_API_KEY ?? ''
const { app, win } = await launch(dir, {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  // 测试实例不碰钥匙串：画布笔记「存着」的 Key 从这里来
  PR_TEST_NOTES_KEYS: JSON.stringify(anth ? { anthropic: anth } : {}),
  ANTHROPIC_API_KEY: '',
  OPENAI_API_KEY: ''
})
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const col = win.locator('.col-right')
const box = col.locator('[data-testid=ai-input] textarea')
const answers = col.locator('[data-testid=pr-answer]')
const shot = (name) => col.screenshot({ path: `${OUT}/${name}.png` })

/** 等这一问答完：存好的回答多一条 */
async function waitAnswer(before, ms = 180_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await answers.count()) > before && (await col.locator('[data-testid=pr-answer-live]').count()) === 0) return true
    await sleep(500)
  }
  return false
}
async function ask(text) {
  const n = await answers.count()
  await box.click()
  await box.fill(text)
  await box.press('Enter')
  const done = await waitAnswer(n)
  return { done, text: done ? await answers.last().locator('.txt').innerText() : '', head: done ? await answers.last().locator('.read .by').innerText().catch(() => '') : '' }
}
async function pickEngine(label) {
  await col.getByTestId('ai-engine').click()
  await sleep(300)
  await win.locator('.aipk-menu [role=menuitemradio]', { hasText: label }).first().click()
  await sleep(800)
}

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await ev((d) => window.api.setSettings({ onboarded: true, agentDir: d, provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', chatPick: { engine: 'pararead' }, borrowAsked: [] }), `${dir}/projects`)
  await sleep(500)
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  // 0.2.2 起没打开的论文按后台的速度解析：先打开（打开的那篇排最前、离开后台 QoS），再等重排好
  await win.dblclick(`[data-paper="${id}"]`)
  for (let i = 0; i < 180 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await sleep(2500)
  await shot('pr-after-empty')

  // 输入框底下：谁来答（设置里那家 DeepSeek）、全能模式那一行
  const eng = col.getByTestId('ai-engine')
  const engId = await eng.locator('[data-engine]').first().getAttribute('data-engine').catch(() => '')
  ok('输入框底下有「谁来答」，默认是设置里那家', engId === 'pararead', engId)
  ok('输入框下面有全能模式那一行', (await col.getByTestId('ai-omni').count()) === 1)
  await col.getByTestId('ai-engine').click()
  await sleep(400)
  const items = await win.locator('.aipk-menu [role=menuitemradio]').allInnerTexts()
  ok('「谁来答」菜单列出画布笔记那几家', ['Claude Code', 'Codex', 'DeepSeek API'].every((x) => items.some((i) => i.includes(x))), items.join(' | ').replace(/\n/g, ' '))
  await win.screenshot({ path: `${OUT}/pr-after-engines.png` })
  await win.keyboard.press('Escape')
  await sleep(300)

  // 1. 真问一次（设置里那家：DeepSeek）
  const a1 = await ask('用一句话说这篇论文的核心贡献。')
  ok('问一次：DeepSeek 答了', a1.done && a1.text.length > 10, a1.text.slice(0, 60))
  ok('回答头写谁答的', /deepseek/i.test(a1.head), a1.head)
  const bar = answers.last().getByTestId('pr-answer-bar')
  ok('回答下面那排：拷贝、存为笔记、⋯', (await bar.getByRole('button', { name: '拷贝' }).count()) === 1 && (await bar.getByRole('button', { name: '存为笔记' }).count()) === 1)
  await bar.getByRole('button', { name: '更多' }).click()
  await sleep(300)
  const menuItems = await win.locator('[role=menu] [role=menuitem]').allInnerTexts()
  ok('⋯ 里：引用到输入框、重新生成、导出、删除', ['引用到输入框', '重新生成', '导出', '删除'].every((x) => menuItems.some((i) => i.includes(x))), menuItems.join('|'))
  await win.locator('[role=menu] [role=menuitem]', { hasText: '引用到输入框' }).click()
  await sleep(300)
  ok('引用到输入框：输入框顶上多一块引用', (await col.getByTestId('ai-mat').count()) === 1)
  await col.getByTestId('ai-mat').locator('.pxx').click()
  await sleep(300)
  await bar.getByRole('button', { name: '拷贝' }).click()
  await sleep(300)
  const flat = (t) => t.replace(/\s+/g, '')
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  ok('拷贝：剪贴板里是回答', flat(clip).includes(flat(a1.text).slice(0, 20)), clip.slice(0, 40))
  await shot('pr-after-chat')

  // 2. 接着问：不认论文名。先问论文重排全文里出现最多的一个长词（6 个字母以上），再只用「它」接着问；
  //    接得上 = 回答里写出了上一问那个词，也没说「不知道你指什么」
  const word = await ev(async (pid) => {
    const text = ((await window.api.getReflow(pid))?.blocks ?? []).map((b) => b.md).join('\n')
    const stop = new Set(['between', 'through', 'however', 'because', 'without', 'different', 'figure', 'section', 'results', 'should', 'proposed', 'paper', 'which', 'where', 'their', 'these', 'those', 'there', 'other', 'using', 'based', 'within', 'during', 'table', 'shown', 'first', 'second', 'while', 'about', 'after', 'before', 'would', 'could'])
    const n = new Map()
    for (const w of text.toLowerCase().match(/[a-z]{6,}/g) ?? []) if (!stop.has(w)) n.set(w, (n.get(w) ?? 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }, id)
  ok('接着问：从论文正文里挑到一个词', word.length >= 6, word)
  const a2a = await ask(`这篇论文里的「${word}」在文中指什么？一句话。`)
  ok('接着问：先问那个词，答了', a2a.done && a2a.text.length > 4, a2a.text.slice(0, 60))
  const a2 = await ask('它在这篇论文里起什么作用？一句话，开头先原样写出「它」指的那个英文词。')
  const lost = /不知道.{0,8}(指|哪)|不清楚.{0,8}(指|哪)|你指的是|请(说明|告诉|提供).{0,12}(哪|什么)|没有上下文/.test(a2.text)
  ok('接着问：接得上上一句（写出了那个词，没说不知道指什么）', a2.done && a2.text.toLowerCase().includes(word) && !lost, a2.text.slice(0, 80))

  // 3. 贴一张图（论文这一页的截图），输入框顶上多一块，字里有 ①
  const png = (await win.locator('.col-mid, .reader-mid, main').first().screenshot({ clip: undefined }).catch(() => win.screenshot())).toString('base64')
  await box.click()
  await ev((b64) => {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bin], 'page.png', { type: 'image/png' }))
    const ta = document.querySelector('.col-right [data-testid=ai-input] textarea')
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png)
  await sleep(1500)
  ok('贴图：输入框顶上多一块图', (await col.getByTestId('ai-mat').count()) === 1)
  await shot('pr-after-paste')
  const n3 = await answers.count()
  await box.press('End')
  await box.type('这张图里大概是什么？一句话。')
  await box.press('Enter')
  const d3 = await waitAnswer(n3)
  const t3 = d3 ? await answers.last().locator('.txt').innerText() : ''
  ok('贴图问：答了', d3 && t3.length > 4, t3.slice(0, 60))
  ok('你发的那条里带着那张图', (await col.locator('.um-wrap').last().locator('img').count()) >= 1)
  await shot('pr-after-image')

  // 4. 换一家：画布笔记那套的 DeepSeek API（直连），回答头跟着换
  await pickEngine('DeepSeek API')
  ok('换了一家：回答头的标志跟着换', (await col.getByTestId('ai-engine').locator('[data-engine]').first().getAttribute('data-engine').catch(() => '')) === 'deepseek', await col.getByTestId('ai-engine').innerHTML().then((h) => h.slice(0, 80)))
  const a4 = await ask('这篇论文有几位作者？只答数字。')
  ok('换一家问：答了，回答头写 DeepSeek API', a4.done && a4.text.length > 0 && a4.head.includes('DeepSeek API'), `${a4.head}｜${a4.text.slice(0, 40)}`)
  await shot('pr-after-switch')

  // 5. 回答下面那排：存为笔记、⋯ 菜单
  await answers.last().getByTestId('pr-answer-bar').getByRole('button', { name: '存为笔记' }).click()
  await sleep(800)
  const anns = await ev((x) => window.api.annList(x), id)
  ok('存为笔记：多了一条笔记', anns.some((a) => a.section === 'AI 问答'))

  // 6. 用画布笔记那把：Claude API 这家 ParaRead 没有 Key、画布笔记有
  if (anth) {
    await pickEngine('Claude API')
    await col.getByTestId('ai-model').click()
    await sleep(300)
    await win.locator('.aipk-menu [role=menuitemradio]', { hasText: 'Haiku' }).first().click()
    await sleep(500)
    await box.click()
    await box.fill('只回答一个词：好')
    await box.press('Enter')
    await sleep(1500)
    ok('第一次用 Claude API：问「用画布笔记那把？」', (await col.getByTestId('borrow').count()) === 1)
    await shot('pr-after-borrow')
    const n6 = await answers.count()
    await col.getByTestId('borrow').getByRole('button', { name: '用它' }).click()
    const d6 = await waitAnswer(n6, 120_000)
    const head6 = d6 ? await answers.last().locator('.read .by').innerText() : ''
    ok('借来以后接着发出去，Claude API 答了', d6 && head6.includes('Claude API'), `${head6}｜${d6 ? (await answers.last().locator('.txt').innerText()).slice(0, 30) : ''}`)
    const s = await ev(() => window.api.getSettings())
    ok('Key 存进了 ParaRead 自己的设置（claude 那家）', s.borrowAsked.includes('anthropic'))
  } else console.log('跳过 借 Key：没给 CN_TEST_ANTHROPIC_API_KEY')

  // 7. 全能模式只对本机命令行起作用：换到 Claude Code 才能点；点一下设置里跟着变
  ok('Key 那几家：全能模式那一行灰着', (await col.getByTestId('ai-omni').locator('button[disabled], [aria-disabled=true]').count()) >= 1 || (await col.getByTestId('ai-omni').getAttribute('class'))?.includes('off'))
  await pickEngine('Claude Code')
  await shot('pr-after-omni')
  await col.getByTestId('ai-omni').locator('button, [role=switch]').first().click()
  await sleep(500)
  ok('全能模式点一下关上了', (await ev(() => window.api.chatEngines())).omni === false)
  await shot('pr-after-final')

  // 8. 0.2.1：设置 › AI 服务选的是本机 Claude Code、谁来答是「本机 Claude Code（设置里那家）」时，全能模式也能拨（0.2.0 拨不开）
  await ev(() => window.api.setSettings({ provider: 'claude-code', textModel: 'sonnet' }))
  await ev(() => window.api.chatSetPick({ engine: 'pararead' }))
  await sleep(800)
  const sw = col.getByTestId('ai-omni').locator('[role=switch]').first()
  ok('设置里那家是本机 Claude Code：谁来答写「本机 Claude Code（设置里那家）」', /本机 Claude Code/.test(await col.locator('[data-testid=ai-input] textarea').getAttribute('placeholder')), await col.locator('[data-testid=ai-input] textarea').getAttribute('placeholder'))
  ok('它的全能模式开关能拨（不是灰的）', !(await sw.isDisabled()))
  await sw.click()
  await sleep(500)
  ok('拨开全能模式：设置里跟着开', (await ev(() => window.api.chatEngines())).omni === true && (await sw.getAttribute('aria-checked')) === 'true')
  await shot('pr-omni-own-cc')
  await sw.click()
  await sleep(500)
  ok('再拨一下关上，设置里跟着关', (await ev(() => window.api.chatEngines())).omni === false)
} finally {
  await close(app)
}
if (fails.length) {
  console.log(`没过 ${fails.length} 项：${fails.join('；')}`)
  process.exit(1)
}
console.log('全部通过')
