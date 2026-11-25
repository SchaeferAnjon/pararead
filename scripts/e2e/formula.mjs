// AI 看得到公式（2026-11-24）真跑一遍：真 MinerU 快速解析（flash，公式裁成图）、真问 DeepSeek「公式 (1) 是什么」。
// 以前给 AI 的全文里公式 (1)(2) 只剩「[图]」，AI 说「公式在原文中是图片看不到」，拿通常写法冒充原文、漏了 LeakyReLU 和拼接；
// 现在第一次问时公式图先交给看图模型（设置里那家，DeepSeek）转成 LaTeX，回答里要有原文的 LeakyReLU 和 [W_i h_i ‖ W_j h_j] 拼接。
// 再换「Claude API」（画布笔记那家，借画布笔记的 Key）开新会话问一次公式 (1)（有 CN_TEST_ANTHROPIC_API_KEY 时）。
// DEEPSEEK_API_KEY=… MINERU_PATH=<mineru-kit> E2E_PAPER=<BST-GATNet.pdf> [CN_TEST_ANTHROPIC_API_KEY=…] node scripts/e2e/formula.mjs <数据目录> [截图目录]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { close, launch, PAPER, SHOTS, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-formula`
const OUT = process.argv[3] ?? SHOTS
const mineru = process.env.MINERU_PATH ?? ''
if (!existsSync(mineru)) throw new Error('要 MINERU_PATH=<装好的 mineru-kit>（公式图来自 MinerU 快速解析）')
const anth = process.env.CN_TEST_ANTHROPIC_API_KEY ?? ''
const { app, win } = await launch(dir, {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
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

async function ask(text, ms = 240_000) {
  const n = await answers.count()
  await box.click()
  await box.fill(text)
  await box.press('Enter')
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await answers.count()) > n && (await col.locator('[data-testid=pr-answer-live]').count()) === 0) break
    await sleep(500)
  }
  const done = (await answers.count()) > n
  return { done, text: done ? await answers.last().locator('.txt').innerText() : '', head: done ? await answers.last().locator('.read .by').innerText().catch(() => '') : '' }
}

/** 截图前把这一问的回答头和第一个排好的公式滚进来 */
async function showFormula() {
  await answers.last().evaluate((el) => {
    const head = el.querySelector('.read .by') ?? el
    head.scrollIntoView({ block: 'start' })
  })
  await sleep(500)
}

/** 回答里有原文 (1) 的 LeakyReLU 和拼接：W_i h_i ‖ W_j h_j（LaTeX 或 KaTeX 排好后的字都认） */
function hasEq1(t) {
  const flat = t.replace(/\s+/g, '')
  const concat = /(\\parallel|\\\|)/.test(flat) || /[∥‖]/.test(flat)
  const wh = /W_?\{?i\}?.{0,12}h_?\{?i\}?/.test(flat) || /Wi.{0,4}hi/.test(flat)
  return { leaky: /LeakyReLU/i.test(t), concat, wh, all: /LeakyReLU/i.test(t) && concat && wh }
}

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await ev(
    ([d, m]) => window.api.setSettings({ onboarded: true, agentDir: d, provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', chatPick: { engine: 'pararead' }, borrowAsked: [], mineruPath: m, defaultEngine: 'flash' }),
    [`${dir}/projects`, mineru]
  )
  await sleep(500)
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  // 等 MinerU 快速解析跑完（真跑，几十秒到几分钟）
  let p = null
  for (let i = 0; i < 600; i++) {
    p = await ev((x) => window.api.getPaper(x), id)
    if (p.reflow.flash === 'done' || p.reflow.flash === 'failed') break
    await sleep(1000)
  }
  ok('MinerU 快速解析跑完了', p.reflow.flash === 'done', JSON.stringify(p.reflow))
  const flash = readFileSync(join(dir, 'reflow', id, 'flash.md'), 'utf8')
  const imgs = flash.match(/!\[[^\]]*\]\(data:image/g)?.length ?? 0
  ok('快速解析的结果里公式是裁好的图（这就是 AI 以前看不到的原因）', imgs >= 3 && !/LeakyReLU/.test(flash), `${imgs} 张内嵌图，正文里有没有 LeakyReLU：${/LeakyReLU/.test(flash)}`)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)

  // 1. 设置里那家（DeepSeek）问公式 (1)：第一次问时公式图转成 LaTeX
  const a1 = await ask('公式 (1) 是什么？照原文写出来，再解释每一项。')
  const cache = join(dir, 'reflow', id, 'formulas.json')
  const latex = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : {}
  const texs = Object.values(latex).filter(Boolean)
  ok('公式图转成了 LaTeX，存了一份', texs.some((x) => /LeakyReLU/.test(x)), texs.join(' ｜ ').slice(0, 300))
  const e1 = hasEq1(a1.text)
  ok('DeepSeek 答公式 (1)：有 LeakyReLU 和 [W_i h_i ‖ W_j h_j] 拼接', a1.done && e1.all, JSON.stringify(e1))
  ok('没说「公式是图片看不到」', !/(是|为)图片.{0,12}(看不到|看不见|无法)/.test(a1.text))
  ok('回答头没写「公式没看到原图」', !/没看到原图/.test(a1.head), a1.head)
  writeFileSync(`${OUT}/pr-formula-deepseek.txt`, `${a1.head}\n\n${a1.text}`)
  await showFormula()
  await col.screenshot({ path: `${OUT}/pr-formula-deepseek.png` })

  // 2. 换画布笔记那家 Anthropic API（Claude）问公式 (2)：会话第一问带全文，全文里公式已是 LaTeX
  if (anth) {
    await col.getByTestId('ai-engine').click()
    await sleep(300)
    await win.locator('.aipk-menu [role=menuitemradio]', { hasText: 'Claude API' }).first().click()
    await sleep(800)
    // 第一次用 Claude API：问「用画布笔记那把？」，点「用它」后接着发出去
    const n2 = await answers.count()
    await box.click()
    await box.fill('公式 (1) 是什么？照原文写出来。')
    await box.press('Enter')
    await sleep(1500)
    if (await col.getByTestId('borrow').count()) await col.getByTestId('borrow').getByRole('button', { name: '用它' }).click()
    for (let i = 0; i < 360 && !((await answers.count()) > n2 && (await col.locator('[data-testid=pr-answer-live]').count()) === 0); i++) await sleep(500)
    const a2 = { text: await answers.last().locator('.txt').innerText(), head: await answers.last().locator('.read .by').innerText().catch(() => ''), done: (await answers.count()) > n2 }
    const e2 = hasEq1(a2.text)
    ok('Claude 答公式 (1)：有 LeakyReLU 和拼接', a2.done && e2.all, `${a2.head}｜${JSON.stringify(e2)}`)
    writeFileSync(`${OUT}/pr-formula-claude.txt`, `${a2.head}\n\n${a2.text}`)
    await showFormula()
    await col.screenshot({ path: `${OUT}/pr-formula-claude.png` })
  }
} catch (e) {
  fails.push(String(e?.stack ?? e))
  await win.screenshot({ path: `${OUT}/pr-formula-error.png` }).catch(() => {})
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 条：\n${fails.join('\n')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
