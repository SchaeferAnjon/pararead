// ParaRead 往画布笔记库里写配对笔记（共用 @cn/format 的写法，src/shared/pairedNote.ts）：
// 一个临时「画布笔记库」里放一篇 PDF → ParaRead 导入它 → 原文模式真拖选一行点「看不懂」、另一行点「有质疑」
// →（有 DEEPSEEK_API_KEY 时）带着一句摘录问 AI 一句 → 调 pairedNote:write 写进库里「<PDF 名> 笔记.md」→ 同样的再写一次文件不动。
// 写好的库给画布笔记那边接着测（apps/notes/e2e/pararead-note.spec.ts，PR_VAULT=<库>）：右栏「笔记」认得出每一处、打开再保存一个字节不变。
//   E2E_PAPER=<一篇 PDF> node scripts/e2e/cn-note.mjs <数据目录> [<库的文件夹，默认数据目录旁边的 vault>]
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { close, launch, PAPER, shot, sleep } from './drive.mjs'

const data = resolve(process.argv[2] ?? `${process.cwd()}/tmp/data-cn-note`)
const vault = resolve(process.argv[3] ?? `${data}-vault`)
if (!PAPER) throw new Error('要 E2E_PAPER')
const rel = `论文/${basename(PAPER)}`
mkdirSync(resolve(vault, '论文'), { recursive: true })
copyFileSync(PAPER, resolve(vault, rel))
const note = rel.replace(/\.pdf$/i, ' 笔记.md')

const key = process.env.DEEPSEEK_API_KEY ?? ''
const { app, win } = await launch(data, { DEEPSEEK_API_KEY: key })
const ev = (fn, ...a) => win.evaluate(fn, ...a)
const fails = []
const ok = (name, pass, info = '') => (console.log(pass ? '通过' : '没过', name, info), pass || fails.push(name))
try {
  await sleep(1000)
  await ev(() => window.api.setSettings({ onboarded: true, display: 'src' }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const [r] = await ev((p) => window.api.importPdfs([p]), resolve(vault, rel))
  const id = r.paper.id
  for (let i = 0; i < 90 && !(await ev((x) => window.api.getPaper(x), id)).reflow.ready; i++) await sleep(1000)
  await win.dblclick(`[data-paper="${id}"]`)
  await sleep(1500)

  // 原文模式：拖选两行，一行点「看不懂」、一行点「有质疑」（都带 PDF 上的框）
  await ev(() => [...document.querySelectorAll('.mid-bar .mode-seg .seg-item')][0]?.click())
  await sleep(2500)
  const lines = await ev(() =>
    [...document.querySelectorAll('.textLayer span')]
      .filter((s) => s.textContent.length > 40 && s.getBoundingClientRect().top > 150 && s.getBoundingClientRect().top < 760)
      .filter((s, i, a) => i === 0 || s.getBoundingClientRect().top - a[0].getBoundingClientRect().top > 120)
      .slice(0, 2)
      .map((sp) => {
        const q = sp.getBoundingClientRect()
        return { x: q.x, y: q.y, w: q.width, h: q.height }
      }),
  )
  for (const [i, label] of ['confused', 'doubt'].entries()) {
    const line = lines[i]
    // 从这一行头一个字的左边拖到行尾：选整行，不从词中间开始
    await win.mouse.move(line.x + 1, line.y + line.h / 2)
    await win.mouse.down()
    await win.mouse.move(line.x + line.w - 1, line.y + line.h / 2, { steps: 8 })
    await win.mouse.up()
    await sleep(500)
    // 联动以后「看不懂」是四种含义里的一种（选中小条上带名字的那一颗），「有质疑」照旧是标记
    await win.locator(label === 'confused' ? '.sel-toolbar .tb-kind[data-kind="confused"]' : `.sel-toolbar .tb-label[data-label="${label}"]`).click()
    await sleep(800)
    await win.keyboard.press('Escape')
  }
  const anns = await ev((x) => window.api.annList(x), id)
  ok('两处标注都存上了，各带标签', anns.filter((a) => a.label).length === 2, anns.map((a) => `${a.label}·第${a.page}页`).join('、'))
  console.log(await shot(win, 'cn-note-pararead'))

  // 带一句摘录问 AI（真发 DeepSeek；没有 Key 就不问）
  let asked = 0
  if (key) {
    const quote = anns.find((a) => a.label === 'doubt')?.text ?? ''
    const got = { done: false, err: '' }
    await win.exposeFunction('__s', (e) => ((got.done ||= !!e.done), (got.err ||= e.error ?? '')))
    await ev(() => window.api.onStream((e) => window.__s(e)))
    await ev(([x, q]) => window.api.chatSend('cn-note-1', x, { content: '用一句话讲这句在说什么', quote: q, image: null }), [id, quote])
    for (let i = 0; i < 90 && !got.done && !got.err; i++) await sleep(1000)
    ok('AI 答完了', got.done && !got.err, got.err)
    asked = 1
  }

  const w1 = await ev(([x, v, f]) => window.api.writePairedNote(x, v, f), [id, vault, rel])
  ok('写进了库里那篇配对笔记', w1.changed && w1.note === note && w1.sections === 2 + asked, JSON.stringify(w1))
  const md = readFileSync(resolve(vault, note), 'utf8')
  ok('笔记是画布笔记的写法：属性、一级标题、每处第二行行尾带身份', /^---\n类型: 笔记\n/.test(md) && md.includes(`# ${basename(PAPER, '.pdf')} 笔记`) && (md.match(/<!-- cn:thread=.+-p\d+-pr-\w+ -->/g) ?? []).length === 2 + asked)
  ok('看不懂、有质疑写成问题段，原文写在问题块里', /## 第 \d+ 页 · 看不懂：/.test(md) && /## 第 \d+ 页 · 有质疑：/.test(md) && /^> \[!question\] 看不懂\n> \S/m.test(md) && /^> \[!question\] 有质疑\n> \S/m.test(md))
  ok('原文模式那一处带 PDF 上框的位置', /\[第 \d+ 页\]\([^)]*#page=\d+&rect=[\d.,]+\) · \d\d:\d\d <!-- cn:thread=[^>]*-->\n\n> /.test(md))
  const w2 = await ev(([x, v, f]) => window.api.writePairedNote(x, v, f), [id, vault, rel])
  ok('同样的内容再写一次，文件不动', !w2.changed && readFileSync(resolve(vault, note), 'utf8') === md)
  const bad = await ev(([x, v]) => window.api.writePairedNote(x, v, '../外面.pdf').then(() => 'ok', (e) => String(e.message)), [id, vault])
  ok('库外面的路径不写', bad.includes('不是库里的 PDF 路径'), bad)
  console.log(`库：${vault}\n笔记：${note}`)
} finally {
  await close(app)
}
ok('退出以后笔记还在库里', existsSync(resolve(vault, note)))
console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : '全部通过')
process.exit(fails.length ? 1 : 0)
