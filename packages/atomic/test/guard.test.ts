import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

// 守着 task-8dula：两个软件的主进程和 packages 里写文件一律走 @cn/atomic（原子写）。
// 新加的 writeFile / appendFile / copyFile / createWriteStream 这个测试会挂：换成 atomicWrite / atomicAppend / atomicCopy，
// 真不是库里、设置里的数据（日志、系统临时文件夹里用一次的），加进下面的 ALLOWED 并写明为什么

const ROOT = join(import.meta.dirname, '..', '..', '..')
const DIRS = ['apps/notes/src/main', 'apps/today/src/main', 'packages/format/src', 'packages/tasks/src', 'packages/git/src', 'packages/family/src', 'packages/calendar/src']

/** 文件 → 允许的写法和为什么 */
const ALLOWED: Record<string, { calls: string[]; why: string }> = {
  'apps/notes/src/main/crash-log.ts': { calls: ['appendFileSync'], why: '崩溃日志一行行追加（设置目录）' },
  'apps/notes/src/main/index.ts': { calls: ['appendFileSync'], why: '测试模式的 quit.log' },
  'apps/notes/src/main/ai.ts': { calls: ['appendFileSync'], why: '测试用的 CN_FAKE_PICK_LOG' },
  'apps/notes/src/main/feynman.ts': { calls: ['appendFileSync'], why: '测试用的 CN_FAKE_FEYNMAN_LOG' },
  'apps/notes/src/main/when-ai.ts': { calls: ['appendFileSync'], why: '测试用的 CN_FAKE_WHEN_LOG' },
  'apps/notes/src/main/plugins/translate/cli.ts': { calls: ['appendFileSync'], why: '测试用的 CN_TR_FAKE_PICK_LOG' },
  'apps/notes/src/main/video/log.ts': { calls: ['appendFileSync'], why: '排查日志 CN_VIDEO_LOG' },
  'apps/notes/src/main/activity.ts': { calls: ['appendFile'], why: '动态记录一行行追加（设置目录的 jsonl）' },
  'apps/notes/src/main/dream-main.ts': { calls: ['appendFile'], why: '梦游评测集一行行追加（设置目录 dream-eval 的 jsonl，只存这台 Mac）' },
  'apps/notes/src/main/related-main.ts': { calls: ['appendFile'], why: '相关栏点的评测集一行行追加（设置目录 dream-eval 的 jsonl）' },
  'apps/notes/src/main/search/model-fetch.ts': { calls: ['createWriteStream'], why: '向量模型下载接着下的 .part（核对 sha256 后才换上）' },
  'apps/notes/src/main/agent/fake-engine.ts': { calls: ['writeFileSync'], why: '假 AI 引擎扮演外面的程序改库' },
  'apps/notes/src/main/agent/engines.ts': { calls: ['writeFileSync'], why: '系统临时文件夹里给 AI 引擎的配置，进程退出就删' },
  'apps/notes/src/main/agent/engine-check.ts': { calls: ['writeFileSync'], why: '自查时系统临时文件夹里的空配置' },
  'apps/notes/src/main/mobile-ai/index.ts': { calls: ['writeFileSync'], why: '系统临时文件夹里这一问的截图，答完删' },
  'apps/notes/src/main/mindmap/export.ts': { calls: ['writeFile'], why: '导出 PDF 时系统临时文件夹里的中间网页' },
  'apps/notes/src/main/import/write.ts': { calls: ['writeFile'], why: '系统临时文件夹里交给 git 的路径表' },
  'apps/notes/src/main/import/apple-notes.ts': { calls: ['copyFileSync'], why: '把备忘录数据库拷到临时文件夹再读' },
  'apps/notes/src/main/chrome-import.ts': { calls: ['copyFile'], why: '把 Chrome 数据库拷到临时文件夹再读' },
  'apps/notes/src/main/web/chrome-data.ts': { calls: ['copyFile', 'cp'], why: '拷 Chrome 数据库来读；插件文件夹整个拷到旁边再改名' },
  'apps/notes/src/main/web/favicon-source.ts': { calls: ['copyFile'], why: '把 Chrome 数据库拷到临时文件夹再读' },
  'apps/notes/src/main/video/stt.ts': { calls: ['writeFile'], why: '系统临时文件夹里给 yt-dlp 的 cookies.txt，用完删' },
}

const CALL = /(?<![\w.])(writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|createWriteStream|cp|cpSync)\(/g

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

it('写文件都走 @cn/atomic：没有新冒出来的 writeFile / appendFile / copyFile', () => {
  const found: string[] = []
  for (const d of DIRS) {
    for (const f of walk(join(ROOT, d))) {
      const rel = relative(ROOT, f).split('\\').join('/')
      const text = readFileSync(f, 'utf8')
      for (const [i, line] of text.split('\n').entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
        for (const m of line.matchAll(CALL)) {
          if (ALLOWED[rel]?.calls.includes(m[1]!)) continue
          found.push(`${rel}:${i + 1} ${m[1]}`)
        }
      }
    }
  }
  expect(found).toEqual([])
})
