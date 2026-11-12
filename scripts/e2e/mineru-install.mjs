// 实测软件里装 MinerU：新数据目录，把 mineruPath 指到不存在的地方（等于一台没装过的电脑），
// 没装时导入一篇应该先出简单重排；点安装，等四步装完，mineruPath 自动指到数据目录里的那份，再看快速重排能不能跑。
// node scripts/e2e/mineru-install.mjs <数据目录>      要下载约 1.3 GB（模型在 ~/.mineru/models 里已有的不重下）
import { close, launch, PAPER, sleep } from './drive.mjs'

const { app, win } = await launch(process.argv[2] ?? `${process.cwd()}/tmp/data-mineru`)
const ev = (fn, ...a) => win.evaluate(fn, ...a)
try {
  await sleep(1500)
  await ev(() => window.api.setSettings({ mineruPath: '/nonexistent/mineru-kit', onboarded: true }))
  console.log('装之前 mineruInstalled:', (await ev(() => window.api.getSettings())).mineruInstalled)
  const [r] = await ev((p) => window.api.importPdfs([p]), PAPER)
  await sleep(6000)
  console.log('没装时的重排:', JSON.stringify((await ev((x) => window.api.getPaper(x), r.paper.id)).reflow))
  await ev(() => window.api.mineruInstall())
  const t0 = Date.now()
  let last = ''
  for (;;) {
    await sleep(5000)
    const s = await ev(() => window.api.mineruInstallState())
    const line = `${s.phase} ${s.percent}% ${s.line.slice(0, 90)}`
    if (line !== last) console.log(Math.round((Date.now() - t0) / 1000) + 's', line)
    last = line
    if (s.phase === 'done' || s.phase === 'failed') {
      console.log('结束:', s.phase, s.error ?? '')
      break
    }
    if (Date.now() - t0 > 40 * 60_000) {
      console.log('超时')
      break
    }
  }
  const st = await ev(() => window.api.getSettings())
  console.log('mineruPath:', st.mineruPath, 'installed:', st.mineruInstalled)
  console.log('testMineru:', JSON.stringify(await ev(() => window.api.testMineru())))
  for (let i = 0; i < 150; i++) {
    await sleep(2000)
    const p = await ev((x) => window.api.getPaper(x), r.paper.id)
    if (p.reflow.flash === 'done' || p.reflow.flash === 'failed') {
      console.log('装好后的快速重排:', p.reflow.flash, p.reflow.error ?? '', '约', i * 2, '秒')
      break
    }
  }
} finally {
  await close(app)
}
