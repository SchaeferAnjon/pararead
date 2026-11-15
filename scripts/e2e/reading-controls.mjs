// 阅读页三处新控件（2026-11-15，方向 A「模式里直接切」）在真窗口里走一遍：
// 1. 模式切换四格：原文 / 上下对照 / 左右对照 / 速览，⌘2 在上下和左右之间换；
// 2. 意群按钮：点一下开关，小箭头选文字着色或下划线，上下、左右两种排法都看；
// 3. 「显示」弹层的十二种译文样式：鼠标停上去正文先换（不存），点了才存，逐个量画出来的样子；意群下划线开着时三种下划线和马克笔不画；
// 4. 问答输入框「思考 · 档位」：deepseek / glm-5.3 / kimi-k3 / 本机 Claude Code 档位各不同，每个模型记一份，设置里同一个值；真发一次 DeepSeek 看「开」生效。
// DEEPSEEK_API_KEY=… E2E_PAPER=<一篇论文的 PDF> node scripts/e2e/reading-controls.mjs <新的数据目录>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = process.argv[2] ?? `${process.cwd()}/tmp/data-reading-controls`
const { app, win } = await launch(dir, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
let passed = 0
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass ? passed++ : fails.push(name))
const settings = () => ev(() => window.api.getSettings())
const art = () => ev(() => document.querySelector('article.reflow')?.className ?? '')
const seg = (label) => win.locator('.mid-bar .mode-seg .seg-item', { hasText: label })
const openAa = async () => {
  if (!(await win.locator('.aa-pop').count())) await win.locator('.mid-bar button[title="显示设置"]').click()
  await sleep(200)
}
const closeAa = async () => {
  if (await win.locator('.aa-pop').count()) await win.keyboard.press('Escape')
  await sleep(200)
}
// 正文里第一段有译文的、在视口里的段（意群开着时要已经变成一句一行）
const firstPara = (sense) =>
  ev((sense) => {
    const sc = document.querySelector('.reflow-scroller').getBoundingClientRect()
    return [...document.querySelectorAll('article.reflow .blk.paragraph')].find((b) => b.getBoundingClientRect().top > sc.top + 20 && b.getBoundingClientRect().top < sc.bottom - 200 && b.querySelector('.tr-text') && (!sense || b.classList.contains('senses')))?.dataset.block ?? null
  }, sense)
// 正文区（中栏）的截图
const midShot = async (name) => {
  const box = await ev(() => { const r = document.querySelector('.col-mid').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  const f = `${process.env.E2E_SHOTS ?? `${process.cwd()}/tmp/shots`}/${name}.png`
  await win.screenshot({ path: f, clip: box })
  return f
}

try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', thinkLevels: {}, trStyle: 'text', senseGroups: false, senseStyle: 'text', trLayout: 'stack', display: 'both' }))
  // 测试窗口挪到屏幕外，不挡人
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.setPosition(-1600, 60) })
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  for (let i = 0; i < 120 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)

  // ---- 1. 模式切换四格 ----
  const labels = await win.locator('.mid-bar .mode-seg .seg-item').allInnerTexts()
  ok('模式切换是四格：原文、上下对照、左右对照、速览', labels.map((x) => x.trim()).join('|') === '原文|上下对照|左右对照|速览', labels.join('|'))
  await seg('上下对照').click()
  for (let i = 0; i < 90 && (await win.locator('.blk.paragraph .tr-text').count()) < 6; i++) await sleep(1000)
  ok('点「上下对照」进对照、上下排', !(await art()).includes('lay-side') && (await seg('上下对照').getAttribute('class')).includes('on'))
  await seg('左右对照').click()
  await sleep(500)
  ok('点「左右对照」换成左右排，设置里记成 side', (await art()).includes('lay-side') && (await settings()).trLayout === 'side')
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('mode-reflow').click())
  await sleep(500)
  ok('已经在对照里按 ⌘2：左右换回上下', !(await art()).includes('lay-side') && (await settings()).trLayout === 'stack')
  await seg('原文').click()
  await sleep(800)
  ok('点「原文」到原文模式，对照两格都不亮', (await win.locator('.pdf-scroller, .pdf-page, canvas').count()) > 0 && !(await seg('上下对照').getAttribute('class')).includes('on'))
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('mode-reflow').click())
  await sleep(800)
  ok('在原文里按 ⌘2：回到对照，还是上次的上下排', (await art()).includes('reflow') && !(await art()).includes('lay-side'))
  await ev(() => window.api.setSettings({ display: 'src' }))
  await sleep(300)
  ok('只看英文时没有意群按钮', (await win.locator('.sense-split').count()) === 0)
  await seg('左右对照').click()
  await sleep(500)
  ok('只看英文时点「左右对照」：换成双语、左右排', (await settings()).display === 'both' && (await art()).includes('lay-side'))
  await seg('上下对照').click()
  await sleep(400)
  console.log(await shot(win, 'rc-01-stack'))

  // ---- 2. 意群：两种样式、两种排法 ----
  await ev(() => [...document.querySelectorAll('.blk.heading')].find((x) => /INTRODUCTION/i.test(x.textContent))?.scrollIntoView({ block: 'start' }))
  await win.locator('.sense-split .btn').first().click()
  const senseReady = () => ev(() => { const sc = document.querySelector('.reflow-scroller').getBoundingClientRect(); const vis = [...document.querySelectorAll('.blk.paragraph')].filter((b) => { const q = b.getBoundingClientRect(); return q.bottom > sc.top + 40 && q.top < sc.bottom - 40 && b.querySelector('.tr, .tr-text') }); return vis.length > 0 && vis.every((b) => b.classList.contains('senses')) })
  for (let i = 0; i < 90 && !(await senseReady()); i++) await sleep(1000)
  await sleep(800)
  const look = () =>
    ev(() => {
      const sc = document.querySelector('.reflow-scroller').getBoundingClientRect()
      const b = [...document.querySelectorAll('.blk.senses')].find((x) => x.getBoundingClientRect().top > sc.top + 10 && x.querySelector('.tr .sg'))
      const a = b.querySelector('.src .sg'), z = b.querySelector(`.tr .sg[data-k="${a.dataset.k}"]`)
      const cs = (n) => getComputedStyle(n)
      return { plain: cs(b.querySelector('.src')).color, en: cs(a).color, zh: cs(z).color, bgEn: cs(a).backgroundImage, bgZh: cs(z).backgroundImage, bar: cs(a).backgroundSize }
    })
  let L = await look()
  ok('意群文字着色：两边同一块同色，和普通字不同、没有底线', (await art()).includes('sg-text') && L.en === L.zh && L.en !== L.plain && L.bgEn === 'none', JSON.stringify(L))
  console.log(await midShot('rc-02-sense-text-stack'))
  await seg('左右对照').click()
  await sleep(800)
  console.log(await midShot('rc-03-sense-text-side'))
  await win.locator('.sense-split .btn').nth(1).click()
  await sleep(200)
  await win.locator('.pop.menu .menu-item', { hasText: '下划线' }).click()
  await sleep(500)
  L = await look()
  ok('小箭头选「下划线」：字不变色，两边同一块底下同一种颜色的线', (await art()).includes('sg-underline') && L.en === L.plain && /gradient/.test(L.bgEn) && L.bgEn === L.bgZh && (await settings()).senseStyle === 'underline', JSON.stringify(L))
  console.log(await midShot('rc-04-sense-underline-side'))
  await seg('上下对照').click()
  await sleep(800)
  L = await look()
  ok('上下排也是下划线', !(await art()).includes('lay-side') && /gradient/.test(L.bgEn))
  console.log(await midShot('rc-05-sense-underline-stack'))
  await win.locator('.sense-split .btn').first().click()
  await sleep(500)
  ok('再点「意群」关掉', (await win.locator('.blk.senses').count()) === 0 && !(await settings()).senseGroups)

  // ---- 3. 十二种译文样式 ----
  const STYLES = [['text', '浅色字'], ['fill', '浅底色'], ['dash', '虚线下划线'], ['solid', '直线下划线'], ['dot', '点状下划线'], ['line', '分割线'], ['dbox', '虚线边框'], ['box', '实线边框'], ['hl', '高亮'], ['marker', '马克笔'], ['blur', '模糊'], ['fade', '透明']]
  // 画出来的样子：量一段译文的计算样式
  const drawn = (pid) =>
    ev((pid) => {
      const b = document.querySelector(`[data-block="${pid}"]`)
      if (!b?.querySelector('.tr-text')) return null
      const tr = b.querySelector(':scope > .tr'), tx = b.querySelector('.tr-text'), p = tx.querySelector('p') ?? tx
      const c = getComputedStyle(tr), x = getComputedStyle(tx), q = getComputedStyle(p)
      return { deco: x.textDecorationLine + ' ' + x.textDecorationStyle, bg: c.backgroundColor, pbg: q.backgroundColor, pimg: q.backgroundImage, pdisp: q.display, border: c.borderLeftStyle, top: c.borderTopStyle, left: c.borderLeftStyle, filter: c.filter, opacity: c.opacity }
    }, pid)
  const expect = {
    text: (d) => !/underline/.test(d.deco) && d.bg === 'rgba(0, 0, 0, 0)' && d.border === 'none',
    fill: (d) => d.bg !== 'rgba(0, 0, 0, 0)',
    dash: (d) => d.deco === 'underline dashed',
    solid: (d) => d.deco === 'underline solid',
    dot: (d) => d.deco === 'underline dotted',
    line: (d, side) => (side ? d.left === 'dashed' && d.top === 'none' : d.top === 'dashed'),
    dbox: (d) => d.border === 'dashed',
    box: (d) => d.border === 'solid',
    hl: (d) => d.pbg !== 'rgba(0, 0, 0, 0)' && d.pdisp === 'inline',
    marker: (d) => /gradient/.test(d.pimg) && d.pdisp === 'inline',
    blur: (d) => /blur/.test(d.filter),
    fade: (d) => Number(d.opacity) < 0.5
  }
  for (const side of [false, true]) {
    await seg(side ? '左右对照' : '上下对照').click()
    await sleep(600)
    await ev(() => [...document.querySelectorAll('.blk.heading')].find((x) => /INTRODUCTION/i.test(x.textContent))?.scrollIntoView({ block: 'start' }))
    for (let i = 0; i < 60 && !(await firstPara(false)); i++) await sleep(1000)
    await openAa()
    for (const [k, name] of STYLES) {
      let pid = await firstPara(false)
      for (let i = 0; i < 60 && !pid; i++) (await sleep(1000), (pid = await firstPara(false)))
      const before = (await settings()).trStyle
      await win.locator(`.aa-pop .tr-tile[data-style="${k}"]`).hover()
      await sleep(150)
      const prev = (await art()).includes(`tr-${k}`) && (await settings()).trStyle === before
      await win.locator(`.aa-pop .tr-tile[data-style="${k}"]`).click()
      await sleep(250)
      // 精细重排做完时正文会整篇换一遍（块的编号也换了）：那一段没了就重新挑一段
      let d = await drawn(pid)
      for (let i = 0; i < 30 && !d; i++) (await sleep(1000), (pid = await firstPara(false)), (d = pid && (await drawn(pid))))
      ok(`${side ? '左右' : '上下'}·${name}：悬停先换不存，点了存，画出来对`, prev && (await settings()).trStyle === k && expect[k](d, side), JSON.stringify(d))
      // 关掉弹层、鼠标移到左栏再拍正文（模糊、透明要鼠标不在段上）
      await closeAa()
      await win.mouse.move(100, 700)
      await sleep(250)
      console.log(await midShot(`rc-style-${side ? 'side' : 'stack'}-${k}`))
      await openAa()
    }
    // 移出格子：预览回到选中的那种
    await win.locator(`.aa-pop .tr-tile[data-style="dash"]`).hover()
    await sleep(150)
    await win.locator('.aa-pop .aa-sub').hover()
    await sleep(150)
    ok(`${side ? '左右' : '上下'}：鼠标移出格子，正文回到选中的「透明」`, (await art()).includes('tr-fade') && !(await art()).includes('tr-dash'))
    await closeAa()
  }
  // 模糊：鼠标停在那一段上才清楚
  await openAa()
  await win.locator('.aa-pop .tr-tile[data-style="blur"]').click()
  await closeAa()
  const bp = await firstPara(false)
  await win.locator(`[data-block="${bp}"] .src`).hover()
  await sleep(300)
  ok('模糊：鼠标停在这一段上，译文清楚了', !/blur/.test((await drawn(bp))?.filter ?? 'blur'))
  console.log(await midShot('rc-06-blur-hover'))

  // ---- 意群下划线和译文下划线 ----
  await ev(() => window.api.setSettings({ trStyle: 'dash' }))
  await win.locator('.sense-split .btn').nth(1).click()
  await win.locator('.pop.menu .menu-item', { hasText: '下划线' }).click()
  for (let i = 0; i < 60 && !(await senseReady()); i++) await sleep(1000)
  await sleep(500)
  const sp = await firstPara(true)
  const dd = await ev((pid) => getComputedStyle(document.querySelector(`[data-block="${pid}"] .tr .sen`)).textDecorationLine, sp)
  ok('意群下划线开着、译文样式是虚线下划线：译文不画虚线，选中值还是虚线下划线', (await art()).includes('tr-text') && !(await art()).includes('tr-dash') && dd === 'none' && (await settings()).trStyle === 'dash', `译文句 ${dd}`)
  await openAa()
  ok('格子上写「意群时不画」', (await win.locator('.aa-pop .tr-tile[data-style="dash"]').innerText()).includes('意群时不画') && (await win.locator('.aa-pop .tr-tile[data-style="box"]').innerText()).indexOf('意群时不画') < 0)
  console.log(await shot(win, 'rc-07-yield-panel'))
  await closeAa()
  await win.locator('.sense-split .btn').nth(1).click()
  await win.locator('.pop.menu .menu-item', { hasText: '文字着色' }).click()
  await sleep(500)
  const dd2 = await ev((pid) => getComputedStyle(document.querySelector(`[data-block="${pid}"] .tr .sen`)).textDecorationStyle, sp)
  ok('换成文字着色：虚线下划线回来了', (await art()).includes('tr-dash') && dd2 === 'dashed')
  console.log(await midShot('rc-08-sense-text-dash'))
  await win.locator('.sense-split .btn').first().click()
  await ev(() => window.api.setSettings({ trStyle: 'text' }))

  // ---- 4. 思考强度 ----
  const chip = win.locator('.col-right .think-chip')
  const menuItems = () => win.locator('.pop.menu .menu-item.two').allInnerTexts()
  const pickLevel = async (name) => {
    await chip.click()
    await sleep(200)
    await win.locator('.pop.menu .menu-item.two .mi-l', { hasText: new RegExp(`^${name}$`) }).click()
    await sleep(400)
  }
  ok('DeepSeek 第一次用：「思考 · 关」', (await chip.innerText()).includes('思考 · 关'))
  await chip.click()
  await sleep(200)
  let items = await menuItems()
  ok('DeepSeek 只有 关 / 开 两档，每档一句说明', items.length === 2 && /^关\n/.test(items[0]) && /^开\n/.test(items[1]) && (await win.locator('.pop.menu .menu-note', { hasText: '只能开或关' }).count()) === 1, items.join(' | '))
  console.log(await shot(win, 'rc-09-think-deepseek'))
  await win.keyboard.press('Escape')
  await pickLevel('开')
  ok('选「开」：按钮写「思考 · 开」，设置里 deepseek-flash 记成 on', (await chip.innerText()).includes('思考 · 开') && (await settings()).thinkLevels['deepseek-flash'] === 'on')

  // 真发一次：开着时有思考过程，回答上面写「已思考（开 · …）」
  const st = { text: '', reasoning: '', done: 0, err: '' }
  await win.exposeFunction('__rc', (e) => { if (e.delta) st.text += e.delta; if (e.reasoning) st.reasoning += e.reasoning; if (e.done) st.done++; if (e.error) st.err = e.error })
  await ev(() => window.api.onStream((e) => window.__rc(e)))
  await win.locator('.col-right textarea').fill('一个房间里有 3 个开关控制隔壁 3 盏灯，只能进隔壁一次，怎么确定对应关系？一句话回答。')
  await win.locator('.col-right textarea').press('Enter')
  for (let i = 0; i < 240 && !st.done && !st.err; i++) await sleep(500)
  await sleep(800)
  const thinkLine = await win.locator('.msg-ai.last .think').innerText().catch(() => '')
  ok('DeepSeek「开」真发一次：先想再答，回答上面写已思考（开 …）', !st.err && st.reasoning.length > 50 && st.text.length > 5 && /已思考（开/.test(thinkLine), `${st.err}思考 ${st.reasoning.length} 字｜${thinkLine}｜${st.text.slice(0, 40)}`)
  console.log(await shot(win, 'rc-10-think-sent'))

  await ev(() => window.api.setSettings({ provider: 'zhipu', textModel: 'glm-5.3-flash', visionModel: 'glm-4.6v' }))
  await sleep(600)
  ok('换 glm-5.3：「思考 · 低」', (await chip.innerText()).includes('思考 · 低'))
  await chip.click()
  await sleep(200)
  items = await menuItems()
  ok('glm-5.3 三档 低 / 高 / 最高，写明关不掉', items.length === 3 && items.map((x) => x.split('\n')[0]).join('') === '低高最高' && (await win.locator('.pop.menu .menu-note', { hasText: '关不掉' }).count()) === 1, items.map((x) => x.split('\n')[0]).join(','))
  console.log(await shot(win, 'rc-11-think-glm'))
  await win.keyboard.press('Escape')
  await pickLevel('最高')
  ok('glm-5.3 选「最高」记成 max', (await settings()).thinkLevels['glm-5.3-flash'] === 'max' && (await chip.innerText()).includes('思考 · 最高'))

  await ev(() => window.api.setSettings({ provider: 'kimi', textModel: 'kimi-k3', visionModel: 'kimi-k3' }))
  await sleep(600)
  ok('换 kimi-k3：按钮写「总会先想」', (await chip.innerText()).trim() === '总会先想')
  await chip.click()
  await sleep(200)
  ok('kimi-k3 菜单里只有一条「总会先想」，点不了，带说明', (await win.locator('.pop.menu .menu-item.two').count()) === 1 && (await win.locator('.pop.menu .menu-item.two').isDisabled()) && (await win.locator('.pop.menu').innerText()).includes('接口没有档位'))
  console.log(await shot(win, 'rc-12-think-kimi'))
  await win.keyboard.press('Escape')

  await ev(() => window.api.setSettings({ provider: 'claude-code', textModel: 'haiku', visionModel: 'haiku' }))
  await sleep(600)
  await chip.click()
  await sleep(200)
  items = await menuItems()
  ok('本机 Claude Code 五档 低 / 中 / 高 / 很高 / 最高，从低开始', items.map((x) => x.split('\n')[0]).join(',') === '低,中,高,很高,最高' && (await win.locator('.pop.menu .menu-item.two .tick svg').count()) === 1, items.map((x) => x.split('\n')[0]).join(','))
  console.log(await shot(win, 'rc-13-think-cc'))
  await win.keyboard.press('Escape')

  await ev(() => window.api.setSettings({ provider: 'deepseek', textModel: 'deepseek-flash', visionModel: 'deepseek-flash' }))
  await sleep(600)
  ok('换回 DeepSeek：还是记着的「开」', (await chip.innerText()).includes('思考 · 开'))

  // 设置 › AI 服务：同一个值；在设置里改，问答框跟着变
  await ev(() => window.api.openSettings('ai'))
  await sleep(1500)
  const sw = app.windows().find((w) => w !== win)
  await sw.setViewportSize?.({ width: 900, height: 660 }).catch(() => {})
  const pick = sw.locator('.think-pick')
  ok('设置里思考强度也是「开」', (await pick.innerText()).includes('开'))
  await pick.click()
  await sleep(200)
  await sw.locator('.pop.menu .menu-item.two .mi-l', { hasText: /^关$/ }).click()
  await sleep(500)
  await sw.locator('.disc', { hasText: '各家模型能选的档' }).click()
  await sleep(200)
  ok('设置里改成「关」、各家档位表展开', (await sw.locator('.vtable tr').count()) === 7 && (await settings()).thinkLevels['deepseek-flash'] === 'off')
  console.log(await shot(sw, 'rc-14-settings-ai'))
  await sleep(300)
  ok('问答框跟着变成「思考 · 关」', (await chip.innerText()).includes('思考 · 关'))
  // 设置 › 翻译：十二格、预览、意群三态
  await sw.locator('.nav-item', { hasText: '翻译' }).click()
  await sleep(500)
  ok('设置 › 翻译：十二格译文样式', (await sw.locator('.tr-tile').count()) === 12)
  await sw.locator('.tr-tile[data-style="marker"]').hover()
  await sleep(200)
  ok('设置里鼠标停在「马克笔」：预览先换', (await sw.locator('.tr-preview .reflow').getAttribute('class')).includes('tr-marker') && (await settings()).trStyle === 'text')
  await sw.locator('.tr-tile[data-style="dbox"]').click()
  await sw.locator('.tr-preview .seg-item', { hasText: '左右' }).click()
  await sw.locator('.frow', { hasText: '意群' }).locator('.seg-item', { hasText: '下划线' }).click()
  await sleep(400)
  ok('设置里点「虚线边框」、预览换左右、意群选下划线', (await settings()).trStyle === 'dbox' && (await settings()).senseGroups && (await settings()).senseStyle === 'underline' && (await sw.locator('.tr-preview .reflow').getAttribute('class')).includes('lay-side'))
  console.log(await shot(sw, 'rc-15-settings-tr'))
  await sw.close()

  // 深色
  await ev(() => window.api.setSettings({ trStyle: 'dash', senseGroups: false }))
  await win.emulateMedia({ colorScheme: 'dark' })
  await sleep(800)
  await seg('左右对照').click()
  await sleep(600)
  console.log(await shot(win, 'rc-16-dark-side-dash'))
  await openAa()
  console.log(await shot(win, 'rc-17-dark-panel'))
  await closeAa()
  await chip.click()
  await sleep(200)
  console.log(await shot(win, 'rc-18-dark-think'))
  await win.keyboard.press('Escape')
  await ev(() => window.api.setSettings({ senseGroups: true, senseStyle: 'underline', trStyle: 'text' }))
  for (let i = 0; i < 30 && !(await senseReady()); i++) await sleep(1000)
  await sleep(500)
  console.log(await midShot('rc-19-dark-sense-underline-side'))

  // 窄窗口：正文列不到 700 时，对照两格只留图标，意群、显示按钮也只留图标，都还在标题栏里
  await win.emulateMedia({ colorScheme: 'light' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800))
  await sleep(900)
  const bar = await ev(() => {
    const mid = document.querySelector('.mid-bar').getBoundingClientRect()
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect()
    return { mid: Math.round(mid.right), show: Math.round(r('button[title="显示设置"]').right), sense: !!r('.sense-split'), segText: document.querySelector('.mode-seg').innerText.replace(/\s/g, '') }
  })
  ok('窄窗口：对照两格只留图标，显示按钮还在标题栏里', bar.segText === '原文速览' && bar.show <= bar.mid && bar.sense, JSON.stringify(bar))
  console.log(await shot(win, 'rc-20-narrow'))
} catch (e) {
  fails.push(String(e))
  console.log('出错', e)
}
await close(app)
console.log(fails.length ? `通过 ${passed} 项，没过 ${fails.length} 项：${fails.join('；')}` : `全过（${passed} 项）`)
process.exit(fails.length ? 1 : 0)
