// 分类与检索走一遍：三层文件夹、给论文加标签并按标签筛、搜到 PDF 正文里的字（哪篇、哪一页）。
// node scripts/e2e/organize.mjs <新的数据目录>；E2E_PAPER=<一篇论文的 PDF>
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-organize`, { DEEPSEEK_API_KEY: '' })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  const id = r.paper.id
  await sleep(1500)

  // 1. 文件夹套三层，侧栏里一层层展开
  const a = await ev(() => window.api.createFolder('硬件', null))
  const b = await ev((p) => window.api.createFolder('存内计算', p), a?.id ?? a)
  const c = await ev((p) => window.api.createFolder('忆阻器', p), b?.id ?? b)
  await sleep(800)
  const folders = await ev(() => window.api.listFolders())
  const depth = (f) => (f.parentId ? 1 + depth(folders.find((x) => x.id === f.parentId)) : 1)
  ok('文件夹能套三层', folders.length === 3 && Math.max(...folders.map(depth)) === 3, folders.map((f) => `${f.name}（第 ${depth(f)} 层）`).join('、'))
  for (const name of ['硬件', '存内计算']) {
    const row = win.locator('.sb .nav-item', { hasText: name }).first()
    if (!(await win.locator('.sb .nav-item', { hasText: '忆阻器' }).count())) await row.locator('svg').first().click().catch(() => {})
    await sleep(300)
  }
  ok('侧栏里能看到第三层', (await win.locator('.sb .nav-item', { hasText: '忆阻器' }).count()) === 1)

  // 2. 标签：在文献信息里填，侧栏出现「标签」，点一个只看带它的论文
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)
  await win.locator('.mid-bar button[title^="文献信息"]').click()
  const field = win.locator('#f-tags')
  await field.fill('存内计算，综述, #存内计算')
  await field.blur()
  await sleep(800)
  const tags = (await ev((x) => window.api.getPaper(x), id)).tags
  ok('在文献信息里加标签：存上了，重复的去掉', tags.length === 2 && tags.includes('存内计算') && tags.includes('综述'), tags.join('、'))
  await win.keyboard.press('Escape')
  await win.locator('.mid-bar button[title^="回文献库"]').click()
  await sleep(800)
  const tagRows = await win.locator('.sb [data-tag]').evaluateAll((ns) => ns.map((n) => n.textContent))
  ok('侧栏出现「标签」，列着两个标签和篇数', tagRows.length === 2 && tagRows.every((x) => x.endsWith('1')), tagRows.join('｜'))
  await win.locator('.sb [data-tag="综述"]').click()
  await sleep(500)
  ok('点一个标签：只看带它的论文', (await win.locator('[data-paper]').count()) === 1 && (await win.locator('.sb [data-tag="综述"].on').count()) === 1)
  console.log(await shot(win, 'organize-tags'))
  await ev((x) => window.api.updatePaper(x, { tags: ['综述'] }), id)
  await sleep(600)
  ok('去掉一个标签：侧栏跟着少一个', (await win.locator('.sb [data-tag]').count()) === 1)

  // 3. 全文检索：搜正文里才有的词，结果指到这篇的某一页
  const hits = await ev(() => window.api.searchPapers('memory wall'))
  const full = hits.find((h) => h.where === 'text' && /第 \d+ 页/.test(h.snippet))
  ok('搜 PDF 正文里的词：搜得到，带页码', hits.length > 0 && !!full, JSON.stringify(full ?? hits[0]).slice(0, 160))
} finally {
  await close(app)
}
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
