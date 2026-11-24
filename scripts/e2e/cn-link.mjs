// ParaRead × 画布笔记联动（src/main/cnLink.ts）走查：一个临时「画布笔记库」（真 git 仓库），全程真点。
//  1. 旧版数据：文献库里先有这篇（ParaRead 自己存的一份）和一条老的红色高亮；
//  2. 设置 › 画布笔记：点「连上「库」」、勾「课程/ecp」→ 自己迁过来：这一篇指到库里那份，老高亮写进配对笔记（红色没标签的算重点）；
//     「撤回」→ 笔记没了、高亮换回红色；「重新迁」→ 又回来；
//  3. 左栏「画布笔记库 › ecp」列出这篇；打开、原文模式拖选三行：点「定义」、按 3（想引用）、点「看不懂」→ 笔记里两行划线、一段看不懂问题段；
//     点在一条上换成「重点」→ 那一行换掉；
//  4. 画布笔记那边往笔记里写一条（外部改动）→ 一秒内阅读页里多一条，颜色是那种含义的；
//  5. 翻页 → 读到哪.json 里是 pararead 记的；回文献库 → 笔记属性「读到」；
//  6. 另一篇 ParaRead 自己的论文：右键「放到画布笔记…」→ 弹窗选「课程」→「放进」→ 库里多了 PDF 和笔记，一次提交；
//  7. 深链 pararead://open?file=…&page=3&back=课程/ecp&view=original → 翻到第 3 页的原文，点「回画布笔记」→ 发出 canvas-notes://open?file=课程/ecp；
//  8. 右键「在 ParaRead 里藏起来」→ 列表里没了，设置里「放回来」→ 又有了。
//   E2E_PAPER=<一篇 PDF> E2E_PAPER2=<另一篇> node scripts/e2e/cn-link.mjs <数据目录> [<库的文件夹>]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const data = resolve(process.argv[2] ?? `${process.cwd()}/tmp/data-cn-link`)
const vault = resolve(process.argv[3] ?? `${data}-vault`)
const PAPER2 = process.env.E2E_PAPER2 ?? ''
if (!PAPER || !PAPER2) throw new Error('要 E2E_PAPER 和 E2E_PAPER2')
const rel = `课程/ecp/${basename(PAPER)}`
const noteRel = rel.replace(/\.pdf$/i, ' 笔记.md')
mkdirSync(resolve(vault, '课程/ecp'), { recursive: true })
mkdirSync(resolve(vault, '课程/线代'), { recursive: true })
copyFileSync(PAPER, resolve(vault, rel))
const git = (...a) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' })
if (!existsSync(resolve(vault, '.git'))) {
  execFileSync('git', ['init', '-q', vault])
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'e2e')
  git('add', '-A')
  git('commit', '-qm', '开始')
}
// 画布笔记的设置目录（假的）：ParaRead 从这里知道画布笔记开过这个库
const cnUser = `${data}-cn-user`
mkdirSync(cnUser, { recursive: true })
writeFileSync(resolve(cnUser, 'settings.json'), JSON.stringify({ lastVault: vault, knownVaults: [vault] }))

const note = () => (existsSync(resolve(vault, noteRel)) ? readFileSync(resolve(vault, noteRel), 'utf8') : null)
const lines = (md, re) => (md ?? '').split('\n').filter((l) => re.test(l))

const { app, win } = await launch(data, { CN_USER_DATA: cnUser })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const until = async (f, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = await f()
    if (v) return v
    await sleep(250)
  }
  return null
}
const recorded = () => app.evaluate(() => globalThis.srScreen ?? [])
// 原文模式里第 n 行长一点的字（按页上的位置），拖着选整行
async function selectLine(n) {
  const ls = await ev(() =>
    [...document.querySelectorAll('.textLayer span')]
      .filter((s) => s.textContent.trim().length > 40 && s.getBoundingClientRect().top > 160 && s.getBoundingClientRect().top < 800)
      .map((sp) => {
        const q = sp.getBoundingClientRect()
        // 拖到这一段大半处那个词的末尾（不停在词中间）
        const tn = sp.firstChild
        const txt = sp.textContent ?? ''
        let cut = txt.indexOf(' ', Math.floor(txt.length * 0.6))
        if (cut < 0) cut = txt.length
        const rg = document.createRange()
        rg.setStart(tn, 0)
        rg.setEnd(tn, Math.min(cut, tn.length))
        const rr = rg.getBoundingClientRect()
        return { x: q.x, y: q.y, w: q.width, h: q.height, end: rr.right - 1, text: sp.textContent }
      })
  )
  const l = ls[n * 3]
  await win.mouse.move(l.x + 1, l.y + l.h / 2)
  await win.mouse.down()
  await win.mouse.move(l.end, l.y + l.h / 2, { steps: 8 })
  await win.mouse.up()
  await win.locator('.sel-toolbar').waitFor({ timeout: 5000 })
  return l
}
async function openSettings() {
  await ev(() => window.api.openSettings('cn'))
  let s
  for (let i = 0; i < 100 && !s; i++) {
    s = app.windows().find((p) => p.url().includes('#settings'))
    if (!s) await sleep(100)
  }
  await s.waitForLoadState('domcontentloaded')
  if (process.env.E2E_THEME) await s.emulateMedia({ colorScheme: process.env.E2E_THEME })
  await s.locator('.nav-item', { hasText: '画布笔记' }).click()
  return s
}

try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'src', lastMode: 'pdf' }))
  // E2E_THEME=dark：深色下再走一遍（交付页的截图）
  if (process.env.E2E_THEME) await win.emulateMedia({ colorScheme: process.env.E2E_THEME })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))

  // 1. 旧版数据：ParaRead 自己的一份 + 一条老的红色高亮（没有含义）
  const [r0] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r0.paper.id
  await ev((x) => window.api.annSave({ id: 'legacy1', paperId: x, mode: 'pdf', color: 'red', style: 'highlight', label: null, text: 'legacy red highlight text', note: '', page: 1, rects: [[0.1, 0.1, 0.3, 0.02]], blockId: null, blockHash: null, start: null, end: null, section: '', createdAt: 1, updatedAt: 1 }), id)

  // 2. 设置里连上库、勾文件夹
  const set = await openSettings()
  await set.locator('.cn-add .btn', { hasText: `连上「${basename(vault)}」` }).click()
  await set.locator('.cn-vault-set').waitFor()
  await set.locator('.cn-folder[data-folder="课程"] .chev').click()
  await set.locator('.cn-folder[data-folder="课程/ecp"] .cn-check').click()
  await set.locator('.cn-folder[data-folder=""] .cn-check').click() // 最外层取消勾
  await sleep(800)
  const st = await ev(() => window.api.cnState())
  ok('连上了库，勾的是「课程/ecp」', st.vaults.length === 1 && JSON.stringify(st.vaults[0].folders) === '["课程/ecp"]', JSON.stringify(st.vaults[0]?.folders))
  // 连上时自己迁：库里也有的这篇指到库里那份，老高亮写进笔记
  await until(() => note())
  ok('迁过来：老的红色高亮写进了配对笔记，算重点', lines(note(), /^- ==legacy red highlight text== · 重点 · \[第 1 页\]/).length === 1, lines(note(), /cn:hl=/).join(' | '))
  const p0 = await ev((x) => window.api.getPaper(x), id)
  ok('这一篇指到库里那份', p0.cn?.path === rel && p0.cn.root === vault, JSON.stringify(p0.cn))
  await set.locator('[data-migration="done"]').waitFor()
  console.log(await shot(set, 'cn-link-settings'))
  await set.locator('[data-migration="done"] .btn', { hasText: '撤回' }).click()
  await set.locator('[data-migration="undone"]').waitFor()
  const legacy = (await ev((x) => window.api.annList(x), id)).find((a) => a.id === 'legacy1')
  ok('撤回：笔记换回迁之前（没有这篇笔记）、高亮回到红色、论文不再指到库里', note() === null && legacy.color === 'red' && !legacy.kind && !(await ev((x) => window.api.getPaper(x), id)).cn, JSON.stringify({ note: note()?.length, color: legacy.color }))
  await set.locator('[data-migration="undone"] .btn', { hasText: '重新迁' }).click()
  await set.locator('[data-migration="done"]').waitFor()
  ok('重新迁：又写回去了', lines(note(), /legacy red highlight text/).length === 1)
  await set.close()

  // 3. 左栏「画布笔记库」里的文件夹，打开这篇，原文模式划三条
  await win.locator('.cn-nav .nav-item[data-cn-folder="课程/ecp"]').click()
  await win.locator(`[data-paper="${id}"]`).waitFor()
  ok('左栏「画布笔记库 › ecp」列出这篇，带「在画布笔记库里」的小书', (await win.locator(`[data-paper="${id}"] .cn-in`).count()) === 1)
  console.log(await shot(win, 'cn-link-library'))
  await win.dblclick(`[data-paper="${id}"]`)
  await win.locator('.mid-bar').waitFor()
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][0]?.click())
  await win.locator('.textLayer span').first().waitFor({ timeout: 20000 })
  await sleep(1500)
  await selectLine(0)
  const names = await win.locator('.sel-toolbar .tb-kind').allInnerTexts()
  ok('选中小条上四颗带名字的颜色', JSON.stringify(names) === JSON.stringify(['重点', '定义', '想引用', '看不懂']), JSON.stringify(names))
  console.log(await shot(win, 'cn-link-toolbar'))
  await win.locator('.sel-toolbar .tb-kind[data-kind="def"]').click()
  await sleep(600)
  await selectLine(1)
  await win.keyboard.press('3')
  await sleep(600)
  const l3 = await selectLine(2)
  await win.locator('.sel-toolbar .tb-kind[data-kind="confused"]').click()
  await sleep(800)
  let md = note()
  ok('划的线一条一行写进笔记：定义、想引用各一条', lines(md, / · 定义 · \[第 \d+ 页\]\(.*#page=\d+&rect=[\d.,]+\) <!-- cn:hl=p\d+-h\d+ k=def -->$/).length === 1 && lines(md, / k=cite -->$/).length === 1, lines(md, /cn:hl=/).join(' | '))
  ok('看不懂写成问题段，问题里是原文和身份', /^## 第 \d+ 页 · 看不懂：/m.test(md) && /^> \[!question\] 看不懂\n> ==.+== <!-- cn:hl=p\d+-h\d+ k=confused -->$/m.test(md), md.match(/## 第 \d+ 页 · 看不懂.*/)?.[0])
  await until(async () => (await ev((x) => window.api.annList(x), id)).every((a) => a.hl), 5000)
  const anns = await ev((x) => window.api.annList(x), id)
  ok('阅读页里四条都带着笔记里的身份', anns.length === 4 && anns.every((a) => a.hl), anns.map((a) => `${a.kind}:${a.hl}`).join(' '))
  // 看不懂是红色波浪线，不铺底
  const confusedEl = await ev(() => {
    const el = document.querySelector('.pdf-hl.lb-confused')
    return el ? { bg: getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor, wave: getComputedStyle(el, '::after').backgroundColor, mask: getComputedStyle(el, '::after').maskImage || getComputedStyle(el, '::after').webkitMaskImage } : null
  })
  ok('看不懂在 PDF 上画红色波浪线、不铺底', !!confusedEl && /255, 64, 21/.test(confusedEl.wave) && /svg/.test(confusedEl.mask) && /none/.test(confusedEl.bg), JSON.stringify(confusedEl).slice(0, 160))
  console.log(await shot(win, 'cn-link-marked'))
  // 有质疑：标记、不占颜色，石墨灰波浪线（2026-11-23 用户定不用紫）；笔记里线照写、另起一段「有质疑」问题段
  await selectLine(3)
  await win.locator('.sel-toolbar .tb-label[data-label="doubt"]').click()
  await until(() => /^## 第 \d+ 页 · 有质疑：/m.test(note() ?? ''), 5000)
  ok('有质疑写进笔记：另起一段问题段', /^## 第 \d+ 页 · 有质疑：/m.test(note() ?? '') && /^> \[!question\] 有质疑$/m.test(note() ?? ''))
  await win.locator('.pdf-hl.lb-doubt').first().waitFor({ timeout: 5000 })
  const doubtWave = await ev(() => getComputedStyle(document.querySelector('.pdf-hl.lb-doubt'), '::after').backgroundColor)
  const want = process.env.E2E_THEME === 'dark' ? 'rgb(134, 140, 149)' : 'rgb(92, 100, 112)'
  ok('有质疑在 PDF 上画石墨灰波浪线', doubtWave === want, doubtWave)
  await selectLine(3)
  await sleep(600) // 小条淡入放完再截
  console.log(await shot(win, 'cn-link-doubt-toolbar'))
  await win.keyboard.press('Escape')

  // 左栏「笔记」：每条写含义名，能按含义筛
  await win.locator('.lp-tabs .seg-item', { hasText: '笔记' }).click()
  await win.locator('.note-kind').first().waitFor()
  const kindNames = await win.locator('.note-kind').allInnerTexts()
  ok('左栏「笔记」每条写含义名', ['重点', '定义', '想引用', '看不懂'].every((n) => kindNames.some((k) => k.startsWith(n))), kindNames.join(' | '))
  console.log(await shot(win, 'cn-link-notes'))
  await win.locator('.lp-tabs .seg-item', { hasText: '目录' }).click()

  // 点在「定义」那一条上，换成「重点」
  const def = anns.find((a) => a.kind === 'def')
  const box = await win.locator(`.pdf-hl[data-ann="${def.id}"]`).first().boundingBox()
  await win.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2) // 右边：左边和那条老高亮叠着
  await win.locator('.sel-toolbar .tb-kind.current[data-kind="def"]').waitFor({ timeout: 5000 })
  await win.locator('.sel-toolbar .tb-kind[data-kind="key"]').click()
  await sleep(800)
  md = note()
  ok('换成重点：同一个身份那一行换掉', lines(md, new RegExp(`cn:hl=${def.hl} k=key -->$`)).length === 1 && lines(md, / k=def -->$/).length === 0, lines(md, new RegExp(def.hl)).join(''))
  // 看不懂一键问 AI：点那一条，小条上「讲一讲」→ 右栏「疑问」讲这一处（真 DeepSeek），讲解写进笔记里那一问下面
  if (process.env.DEEPSEEK_API_KEY) {
    const conf = anns.find((a) => a.kind === 'confused')
    const cb = await win.locator(`.pdf-hl[data-ann="${conf.id}"]`).first().boundingBox()
    await win.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2)
    await win.locator('.sel-toolbar .tb-btn', { hasText: '讲一讲' }).click()
    const answered = await until(() => {
      const sec = (note() ?? '').split('\n## ').find((x) => x.includes(`cn:hl=${conf.hl} k=confused`))
      return sec && /k=confused -->\n\n[^\n>]/.test(sec) ? sec : null
    }, 150000)
    ok('看不懂「讲一讲」（真 AI）：讲解写进笔记里那一问下面', !!answered, answered?.split('\n').slice(-6).join(' ⏎ ').slice(0, 160))
    console.log(await shot(win, 'cn-link-explain'))
    await win.keyboard.press('Escape')

    // 右栏「AI 问答」问一句（0.2.1：0.2.0 换成共用对话框后答完没写进配对笔记）→ 一秒后笔记里有这一问、库的 Git 多一条「问 AI」提交
    await ev(() => window.api.setSettings({ provider: 'deepseek', textModel: 'deepseek-flash' }))
    await ev(() => window.api.chatSetPick({ engine: 'pararead' }))
    await win.locator('.col-right').getByText('AI 问答', { exact: true }).first().click().catch(() => {})
    const q = '用一句话说这篇论文做了什么（走查 cn-link）'
    const box = win.locator('.col-right [data-testid=ai-input] textarea')
    await box.click()
    await box.fill(q)
    await box.press('Enter')
    const qa = await until(() => ((note() ?? '').includes(q) && /问 AI/.test(git('log', '--format=%s', '-3')) ? note() : null), 150000)
    ok('右栏问 AI（真 DeepSeek）：答完一秒后这一问写进配对笔记', !!qa, (note() ?? '').split('\n').filter((l) => l.includes('走查 cn-link')).join(' | ').slice(0, 160))
    ok('库的 Git 多一条「问 AI」提交', /ParaRead：.*问 AI \d+ 问/.test(git('log', '--format=%s', '-3')), git('log', '--format=%s', '-3').trim().replace(/\n/g, ' | '))
    // 打开这篇时补写：按 chats 全量写，再写一遍这一问不重复、不多一条「问 AI」提交（「读到」那条属性照常会变）
    const qaSec = () => (note() ?? '').split('\n## ').find((x) => x.includes(q))
    const before = qaSec()
    const askCommits = () => git('log', '--format=%s').split('\n').filter((l) => /问 AI/.test(l)).length
    const n0 = askCommits()
    await ev((x) => window.api.updatePaper(x, { lastOpened: Date.now() }), id)
    await sleep(2500)
    ok('打开时补写不重复：这一问那段不变、没有新的「问 AI」提交', !!before && qaSec() === before && askCommits() === n0 && (note() ?? '').split(q).length === 3, `${(note() ?? '').split(q).length - 1} 处`)
  }

  await sleep(1500)
  ok('每划一次提交一次进库的 Git', /ParaRead：.*划线 · /.test(git('log', '--format=%s', '-8')), git('log', '--format=%s', '-3').trim().replace(/\n/g, ' | '))

  // 4. 画布笔记那边写了一条（外部改动）→ 阅读页里跟着多一条
  const before = (await ev((x) => window.api.annList(x), id)).length
  const page1Text = await ev(() => [...document.querySelectorAll('.page[data-page="1"] .textLayer span')].map((s) => s.textContent).find((t) => t.trim().length > 30)?.trim())
  const ext = `- ==${page1Text}== · 想引用 · [第 1 页](${encodeURI(basename(PAPER))}#page=1) <!-- cn:hl=p1-h9 k=cite -->`
  const cur = note()
  writeFileSync(resolve(vault, noteRel), cur.includes('## 第 1 页 · 划的线\n') ? cur.replace('## 第 1 页 · 划的线\n', `## 第 1 页 · 划的线\n${ext}\n`) : cur.replace(/\n## /, `\n## 第 1 页 · 划的线\n${ext}\n\n## `))
  const got = await until(async () => (await ev((x) => window.api.annList(x), id)).find((a) => a.hl === 'p1-h9'))
  ok('画布笔记里加的一条，阅读页里马上有（想引用，蓝）', !!got && got.kind === 'cite' && got.color === 'blue' && (await ev((x) => window.api.annList(x), id)).length === before + 1, JSON.stringify(got && { kind: got.kind, color: got.color }))
  await until(() => win.locator(`.pdf-hl[data-ann="${got?.id}"]`).count(), 8000)
  ok('PDF 上按原文找到字画出来', (await win.locator(`.pdf-hl[data-ann="${got?.id}"]`).count()) > 0)

  // 5. 读到哪：翻到第 3 页
  await ev(() => document.querySelector('.page[data-page="3"]')?.scrollIntoView())
  const ra = await until(() => {
    const f = resolve(vault, '.canvas-notes/读到哪.json')
    if (!existsSync(f)) return null
    const r = JSON.parse(readFileSync(f, 'utf8')).files[rel]
    return r && r.by === 'pararead' && r.page >= 3 ? r : null
  }, 10000)
  ok('读到哪.json 里是 ParaRead 记的、第 3 页以后', !!ra, JSON.stringify(ra))
  ok('读到哪.json 不进 Git', readFileSync(resolve(vault, '.git/info/exclude'), 'utf8').includes('/.canvas-notes/读到哪.json'))
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  const readProp = await until(() => /^读到: .+$/m.exec(note() ?? '')?.[0], 8000)
  ok('关论文时笔记属性「读到」跟上', !!readProp, readProp ?? '')

  // 6. 另一篇放到画布笔记
  const [r2] = await ev((p) => window.api.importPdfs([p]), PAPER2)
  await win.locator('.nav-item', { hasText: '全部论文' }).click()
  await win.locator(`[data-paper="${r2.paper.id}"]`).click({ button: 'right' })
  await win.locator('.pop.menu .menu-item', { hasText: '放到画布笔记…' }).click()
  await win.locator('.cn-place').waitFor()
  await win.locator('.cn-place-row[data-folder="课程"]').click()
  await sleep(500)
  console.log(await shot(win, 'cn-link-place'))
  const target = await win.locator('.cn-place-name').first().innerText()
  await win.locator('.cn-place .btn.primary').click()
  await win.locator('.cn-place').waitFor({ state: 'detached' })
  const placed = `课程/${basename(PAPER2)}`
  ok('放进去：库里「课程」下多了这份 PDF 和它的笔记', existsSync(resolve(vault, placed)) && existsSync(resolve(vault, placed.replace(/\.pdf$/i, ' 笔记.md'))), target)
  const p2 = await ev((x) => window.api.getPaper(x), r2.paper.id)
  ok('文献库里这一条指到库里那份', p2.cn?.path === placed)
  await until(() => /ParaRead：放进 课程/.test(git('log', '--format=%s', '-1')), 5000)
  ok('一次提交', /ParaRead：放进 课程 · /.test(git('log', '--format=%s', '-1')), git('log', '--format=%s', '-1').trim())

  // 7. 深链：画布笔记首页组件「继续读」
  const url = `pararead://open?${new URLSearchParams({ file: resolve(vault, rel), page: '3', vault, back: '课程/ecp', view: 'original' })}`
  await app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault() {} }, u), url)
  await win.locator('.cn-back').waitFor({ timeout: 15000 })
  const cur3 = await until(() => ev(() => document.querySelector('.reader')?.dataset.mode === 'pdf' && [...document.querySelectorAll('.page')].find((p) => p.getBoundingClientRect().top > -200 && p.getBoundingClientRect().top < 400)?.dataset.page), 8000)
  ok('深链打开那一篇的原文、翻到第 3 页', cur3 === '3', String(cur3))
  console.log(await shot(win, 'cn-link-deeplink'))
  await win.locator('.cn-back').click()
  await sleep(300)
  const sent = (await recorded()).filter((s) => s.includes('canvas-notes://open'))
  ok('「回画布笔记」发出 canvas-notes://open?file=课程/ecp', sent.some((s) => s.includes(`canvas-notes://open?file=${encodeURIComponent('课程/ecp').replace(/%20/g, '+')}`)), sent.join(' | '))
  await win.locator('.cn-open').click()
  await sleep(300)
  ok('「在画布笔记里看」开这一篇的笔记', (await recorded()).some((s) => s.includes(`file=${new URLSearchParams({ f: noteRel }).toString().slice(2)}`)), (await recorded()).slice(-1)[0])
  await win.locator('.mid-bar button[title^="回文献库"]').click()

  // 8. 藏起来、放回来
  await win.locator('.cn-nav .nav-item[data-cn-folder="课程/ecp"]').click()
  await win.locator(`[data-paper="${id}"]`).click({ button: 'right' })
  ok('库里的论文右键没有「删除」，是「在 ParaRead 里藏起来」', (await win.locator('.pop.menu .menu-item', { hasText: '删除' }).count()) === 0)
  await win.locator('.pop.menu .menu-item', { hasText: '在 ParaRead 里藏起来' }).click()
  await win.locator(`[data-paper="${id}"]`).waitFor({ state: 'detached' })
  ok('藏起来以后列表里没有了，库里那份还在', existsSync(resolve(vault, rel)))
  const set2 = await openSettings()
  await set2.locator('.cn-hidden-row .btn', { hasText: '放回来' }).click()
  await win.locator(`[data-paper="${id}"]`).waitFor({ timeout: 5000 })
  ok('设置里放回来，又列出来了', true)
  await ev(() => window.api.cnSettled())
  ok('库里没有没提交的改动（读到哪.json 除外）', git('status', '--porcelain').trim() === '', git('status', '--porcelain'))
  console.log(`库：${vault}\n笔记：${noteRel}`)
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
