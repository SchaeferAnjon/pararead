// 按标签讲解（方向 B：攒着一起讲）：打标签不打断、右栏「疑问」计数、节末「过一遍」逐条讲（看不懂讲到「懂了」、换个讲法、
// 有质疑讲到你判断）、过完的小结和问作者清单、讲过的再看不再花 AI、波浪线变淡、后台先备讲解的开关、
// 全库笔记页的「一起讲」和「整理成问作者清单」；最后不带 Key 再开一次：存下的讲解还在，没讲过的说清缺什么。
// DEEPSEEK_API_KEY=… node scripts/e2e/explain.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const dir = resolve(process.argv[2] ?? `${process.cwd()}/tmp/data-explain`)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
const until = async (fn, ms = 120000) => {
  for (let t = 0; t < ms; t += 500) {
    if (await fn()) return true
    await sleep(500)
  }
  return false
}

let { app, win } = await launch(dir, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY })
let ev = (fn, ...a) => win.evaluate(fn, ...a)
// 引言里第 nth 个长段落：滚到视口中间，从第一行拖一段
const dragIn = async (nth) => {
  const p = await ev((n) => {
    const all = [...document.querySelectorAll('.blk')]
    const h = all.findIndex((x) => x.classList.contains('heading') && /INTRODUCTION/.test(x.textContent))
    const b = all.slice(h + 1).filter((x) => x.classList.contains('paragraph') && x.querySelector('.src').textContent.length > 300 && !/received|e-mail|Digital Object|supported in part|licensed/i.test(x.textContent))[n]
    b.scrollIntoView({ block: 'center' })
    const q = b.querySelector('.src').getBoundingClientRect()
    return { x: q.x, y: q.y }
  }, nth)
  await sleep(300)
  await win.mouse.move(p.x + 40, p.y + 14)
  await win.mouse.down()
  await win.mouse.move(p.x + 420, p.y + 14, { steps: 8 })
  await win.mouse.up()
  await sleep(400)
  return p
}
const label = async (nth, l) => {
  await dragIn(nth)
  await win.locator(`.sel-toolbar .tb-label[data-label="${l}"]`).click()
  await sleep(600)
}
const anns = (id) => ev((x) => window.api.annList(x), id)
const toIntro = () =>
  ev(() => {
    ;[...document.querySelectorAll('.blk.heading')].find((x) => /INTRODUCTION/.test(x.textContent)).scrollIntoView({ block: 'start' })
    document.querySelector('.reflow-scroller').scrollTop -= 40
  })
let id
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'src', explainPrefetch: false }))
  // 「复制」不碰这台电脑真的剪贴板：换成记在页面里
  await ev(() => (navigator.clipboard.writeText = async (s) => void (window.__copied = s)))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  id = r.paper.id
  // 等精细重排也做完：做到一半换档位会把正文重排一遍
  for (let i = 0; i < 400; i++) {
    const rf = (await ev((x) => window.api.getPaper(x), id)).reflow
    if (rf.ready && (rf.basic === 'done' || rf.basic === 'failed')) break
    await sleep(1000)
  }
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await ev(() => [...document.querySelectorAll('.mid-bar .seg-item')][1]?.click())
  await sleep(2000)
  await toIntro()
  await sleep(700)

  // B1 打标签不打断
  await label(0, 'confused')
  ok('打完标签工具条收起，什么都不弹', (await win.locator('.sel-toolbar, .result-card').count()) === 0)
  await label(1, 'confused')
  await label(2, 'doubt')
  const badge = (await win.locator('.r-tabs .q-badge').textContent()) ?? ''
  ok('右栏顶上「疑问」后面记着数：2 处看不懂、1 处有质疑', badge.replace(/\s/g, '') === '21', badge)
  const sec = (await win.locator('.sec-end').first().textContent().catch(() => '')) ?? ''
  ok('这一节末尾那一行写着还有几处、带「过一遍」', /2 处看不懂/.test(sec) && /1 处有质疑/.test(sec) && /过一遍/.test(sec), sec)
  const quiet = (await anns(id)).every((a) => !a.explain) && (await ev(() => window.api.explainPending())).length === 0
  ok('后台先备讲解关着：打标签时没问 AI', quiet)
  console.log(await shot(win, 'explain-labeled'))

  // B2 过一遍：从节末开始
  await win.locator('.sec-end button', { hasText: '过一遍' }).first().click()
  await sleep(500)
  ok('右栏换到「疑问」逐条：第 1 / 3 条', ((await win.locator('.q-walkbar').textContent()) ?? '').includes('第 1 / 3 条'))
  const inView = await ev(() => {
    const r = [...(CSS.highlights.get('hl-hover') ?? [])][0]?.getBoundingClientRect()
    const box = document.querySelector('.reflow-scroller').getBoundingClientRect()
    return !!r && r.top > box.top && r.bottom < box.bottom
  })
  ok('正文滚到这一处并加深（在视口里）', inView)
  const t0 = Date.now()
  ok('看不懂：一句话先出来', await until(() => win.locator('.q-walk .ex-one').count()), `${((Date.now() - t0) / 1000).toFixed(1)} 秒`)
  const gotAll = await until(() => win.locator('.q-walk .ex-opt').count())
  const secs = await win.locator('.q-walk .ex-sh').allTextContents()
  ok('看不懂六节讲全：一句话、拆开看、先要知道、举个例子、这篇里、考你一下', gotAll && ['一句话', '拆开看', '先要知道', '举个例子', '这篇里', '考你一下'].every((k) => secs.some((s) => s.startsWith(k))), secs.join(' / '))
  console.log(await shot(win, 'explain-walk-confused'))
  await win.locator('.q-walk .ex-opt').first().click()
  ok('考你一下：选了就说对错和为什么', (await win.locator('.q-walk .ex-fb').count()) === 1)
  await until(async () => (await anns(id)).some((a) => a.explain?.versions?.length === 1), 15000)
  const first = (await anns(id)).find((a) => a.explain)
  ok('讲完存在这条标注上', !!first?.explain?.versions?.[0]?.raw.includes('<one>'))

  // 还不懂，换个讲法
  await win.locator('.q-foot button', { hasText: '还不懂，换个讲法' }).click()
  ok('换个讲法：存下第二版、记一次没懂', await until(async () => (await anns(id)).find((a) => a.id === first.id)?.explain?.versions?.length === 2), '')
  const again = (await anns(id)).find((a) => a.id === first.id)
  ok('第二版围着另一个「卡在哪」讲', again.explain.misses === 1 && again.explain.versions[1].focus !== again.explain.versions[0].focus, JSON.stringify(again.explain.versions.map((v) => v.focus)))
  await until(() => win.locator('.q-walk .ex-opt').count(), 30000)
  console.log(await shot(win, 'explain-walk-again'))
  await win.locator('.q-foot button', { hasText: '懂了' }).click()
  await sleep(600)
  ok('点「懂了」到第 2 条，第 1 条变成「懂了」', ((await win.locator('.q-walkbar').textContent()) ?? '').includes('第 2 / 3 条') && (await anns(id)).find((a) => a.id === first.id).labelStatus === 'understood')
  ok('懂了的那处波浪线变淡', (await ev(() => CSS.highlights.get('lb-confused-done')?.size ?? 0)) === 1)
  await until(() => win.locator('.q-walk .ex-opt').count())
  await win.locator('.q-foot button', { hasText: '懂了' }).click()
  await sleep(600)

  // 有质疑
  ok('有质疑：AI 的看法讲出来', await until(() => win.locator('.q-walk .ex-lean').count(), 150000))
  const dsecs = await win.locator('.q-walk .ex-sh').allTextContents()
  ok('有质疑讲全：它在说、论文自己的依据、没说出来的前提、别的文献（学术检索）、可以问作者', ['它在说', '论文自己的依据', '没说出来的前提', '别的文献', '可以问作者'].every((k) => dsecs.some((s) => s.startsWith(k))), dsecs.join(' / '))
  const lit = await win.locator('.q-walk .ex-lit, .q-walk .ex-note').count()
  ok('别的文献有一栏（检索到的或「没找到」）', lit > 0, `${await win.locator('.q-walk .ex-lit').count()} 篇`)
  ok('判断按钮：质疑成立、质疑不成立、还要查、跳过，AI 倾向的带圆点', (await win.locator('.q-foot [data-verdict]').count()) === 3 && (await win.locator('.q-foot .lean-dot').count()) === 1 && (await win.locator('.q-foot button', { hasText: '跳过' }).count()) === 1)
  console.log(await shot(win, 'explain-walk-doubt'))
  await win.locator('.q-foot [data-verdict="upheld"]').click()
  await sleep(600)
  ok('过完给小结', ((await win.locator('.q-done h4').textContent()) ?? '').includes('过完了'))
  const askN = await win.locator('.q-asks li').count()
  ok('问作者清单攒好了', askN > 0, `${askN} 条`)
  if (askN) {
    await win.locator('.q-asks button', { hasText: '复制' }).click()
    const clip = (await ev(() => window.__copied)) ?? ''
    ok('问作者清单复制成 Markdown', clip.startsWith('# 问作者清单') && clip.includes('（质疑成立）'), clip.split('\n').slice(0, 5).join(' | '))
  }
  console.log(await shot(win, 'explain-done'))
  ok('节末那一行没了（这一节都处理过了）', (await win.locator('.sec-end').count()) === 0)

  // 再看不再花 AI：回列表点处理过的那条
  await win.locator('.q-done button', { hasText: '回到列表' }).click()
  await sleep(300)
  const before = JSON.stringify((await anns(id)).map((a) => a.explain?.versions?.length ?? 0))
  await win.locator(`.q-item[data-ann="${first.id}"]`).click()
  await sleep(400)
  ok('讲过的再打开：当场出来，不再问 AI', (await win.locator('.q-walk .ex-one').count()) === 1 && (await win.locator('.q-walk .skel').count()) === 0 && (await ev(() => window.api.explainPending())).length === 0)
  ok('懂了的那条底下给「其实还没懂，放回疑问」，不再是「懂了，下一条」', (await win.locator('.q-foot button', { hasText: '其实还没懂' }).count()) === 1 && (await win.locator('.q-foot .btn.primary').count()) === 0)
  await sleep(1500)
  ok('讲解的版数没变', JSON.stringify((await anns(id)).map((a) => a.explain?.versions?.length ?? 0)) === before)

  // 左栏笔记：状态和一句话讲解
  await win.locator('.lp-tabs .seg-item', { hasText: '笔记' }).click()
  await sleep(300)
  ok('左栏笔记每条带状态和一句话讲解', (await win.locator('.note-item .st-chip').count()) === 3 && (await win.locator('.note-item .note-sum').count()) >= 2)
  console.log(await shot(win, 'explain-leftnotes'))

  // 后台先备讲解的开关：开着时打标签就排队讲
  await ev(() => window.api.setSettings({ explainPrefetch: true }))
  await win.locator('.q-walkbar button', { hasText: '列表' }).click()
  await label(3, 'confused')
  ok('开着「后台先备讲解」：列表里先是「在备讲解」', await until(() => win.locator('.q-item .q-prep', { hasText: '在备讲解' }).count(), 8000))
  console.log(await shot(win, 'explain-prefetch'))
  ok('后台讲好变成「讲解备好了」', await until(() => win.locator('.q-item .q-prep', { hasText: '讲解备好了' }).count(), 150000))
  await ev(() => window.api.setSettings({ explainPrefetch: false }))
  await label(4, 'confused')

  // B3 全库笔记页
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await sleep(800)
  await win.locator('.nav-item', { hasText: '笔记' }).click()
  await win.waitForSelector('.np-item')
  await win.locator('.notes-page .np-bar .seg-item', { hasText: '看不懂' }).click()
  await sleep(300)
  const subs = await win.locator('.np-sub .seg-item').allTextContents()
  ok('看不懂下面再分：还没懂 2 / 懂了 2 / 全部', subs.join('|').replace(/\s/g, '') === '还没懂2|懂了2|全部', subs.join('|'))
  ok('只勾一条时「一起讲」点不了', await win.locator('.np-bar .btn.primary', { hasText: '一起讲' }).isDisabled())
  for (const cb of await win.locator('.np-item .np-cb:not(.off)').all()) await cb.click()
  ok('勾两条以后「一起讲（2）」', ((await win.locator('.np-bar .btn.primary').textContent()) ?? '').includes('一起讲（2）'))
  await win.locator('.np-bar .btn.primary').click()
  ok('一起讲：先说共同卡在哪', await until(() => win.locator('.np-panel .gx-root').count()))
  ok('一起讲：回到每一处、考你一下', await until(() => win.locator('.np-panel .ex-opt').count()))
  ok('一起讲：每一处都有一句', (await win.locator('.np-panel .gx-row').count()) === 2)
  await until(() => win.locator('.np-panel .btn.primary:not([disabled])').count(), 15000)
  console.log(await shot(win, 'explain-group'))
  await win.locator('.np-panel button', { hasText: '这几处都懂了' }).click()
  await sleep(800)
  const all = await ev(() => window.api.annAll())
  ok('这几处都标成「懂了」，共同的那段挂在两处上', all.filter((a) => a.label === 'confused' && a.labelStatus === 'understood').length === 4 && all.filter((a) => a.explain?.group).length === 2)
  await win.locator('.notes-page .np-bar .seg-item', { hasText: '有质疑' }).click()
  await sleep(300)
  await win.locator('.np-bar .btn.primary', { hasText: '整理成问作者清单' }).click()
  await sleep(300)
  ok('问作者清单按论文列出判为成立的', (await win.locator('.np-panel[data-panel="asks"] li').count()) === askN)
  await win.locator('.np-panel button', { hasText: '复制为 Markdown' }).click()
  const md = (await ev(() => window.__copied)) ?? ''
  ok('复制成 Markdown：论文一个二级标题', md.startsWith('# 问作者清单') && /\n## .+\n/.test(md))
  console.log(await shot(win, 'explain-asks'))
  // 导出 Markdown：状态和一句话讲解跟在摘录后面
  await app.evaluate((_e, d) => (process.env.PARAREAD_EXPORT_DIR = d), dir)
  const f = await ev((x) => window.api.annExport(x), id)
  const txt = f ? readFileSync(f, 'utf8') : ''
  ok('导出的 Markdown 带状态和讲解', /状态：懂了。讲解：/.test(txt) && /状态：质疑成立/.test(txt))
} finally {
  await close(app)
}

// 不带 Key 再开一次：讲过的照样看，没讲过的说清缺 Key
;({ app, win } = await launch(dir, { DEEPSEEK_API_KEY: '' }))
ev = (fn, ...a) => win.evaluate(fn, ...a)
try {
  await sleep(1500)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(2500)
  await win.locator('.r-tabs .seg-item', { hasText: '疑问' }).click()
  await sleep(300)
  const firstDone = (await anns(id)).find((a) => a.labelStatus === 'understood' && a.explain?.versions?.length)
  await win.locator(`.q-item[data-ann="${firstDone.id}"]`).click()
  await sleep(500)
  ok('重开以后讲过的照样在（没有 Key 也能看）', (await win.locator('.q-walk .ex-one').count()) === 1)
  await win.locator('.q-walkbar button', { hasText: '列表' }).click()
  await label(5, 'doubt')
  await win.locator('.q-head .btn.primary').click()
  ok('没有 Key：就地说缺什么，带「去设置」', await until(() => win.locator('.q-walk .ex-err', { hasText: 'Key' }).count(), 20000) && (await win.locator('.q-walk .ex-err button', { hasText: '去设置' }).count()) === 1, (await win.locator('.q-walk .ex-err').textContent().catch(() => '')) ?? '')
  console.log(await shot(win, 'explain-nokey'))
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
