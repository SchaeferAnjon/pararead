// 真跑本机的命令行（要联网、花一点额度），照 ParaRead 的接法：createEngines 列出各家、拿 Engine，
// 全能模式不给 mcp（Claude Code bypassPermissions、Codex danger-full-access……不接 MCP、留会话）问一句，再只聊天问一句。
// 默认只跑 Claude Code（haiku、low）；CN_REAL_ENGINES=claude,codex 多跑几家（别家用它自己的默认模型、low）。
// 在 Claude Code 的终端里跑时去掉父会话的 CLAUDE_* 环境变量（像从访达打开的软件一样）：
// env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx vitest run packages/ai-engines/test/real-engines.test.ts
// 全能那一问留下的会话记录（Claude Code 在 ~/.claude/projects/ 下名字带 cn-real-engines- 的文件夹，Codex 在 ~/.codex/sessions）跑完挪走。
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claudeArgs, createEngines, loadShellPath } from '../src'
import { type CliId, isCli } from '../src/shared'

const IDS = (process.env.CN_REAL_ENGINES ?? 'claude').split(',').filter(isCli) as CliId[]

describe.skipIf(!process.env.CN_REAL_AI)('真的问一次本机的命令行（ParaRead 的接法）', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cn-real-engines-'))
  const engines = createEngines({ key: () => undefined, sourceReady: () => false, sourceModels: () => [] })
  beforeAll(() => loadShellPath())
  afterAll(() => {
    engines.dispose()
    rmSync(cwd, { recursive: true, force: true })
  })

  describe.each(IDS)('%s', (id) => {
    const opt = id === 'claude' ? { model: 'haiku', effort: 'low' } : id === 'codex' ? { effort: 'low' } : {}

    it('列出来找到了、能用', () => {
      const e = engines.list().find((x) => x.id === id)!
      console.log(`${e.label}：`, JSON.stringify({ path: e.path, where: e.where, version: e.version, models: e.models.map((m) => m.id) }))
      expect(e.path).toBeTruthy()
      expect(engines.ready(id)).toBe(true)
    })

    it('全能模式不给 mcp：参数都被接受，答得出来、留了会话', async () => {
      const run = { prompt: '只回一个字：好', system: '你是一个测试助手。', omni: true, ...opt }
      if (id === 'claude') console.log('参数：', JSON.stringify(claudeArgs(run)))
      const t = Date.now()
      const r = await engines.engine(id).run({ ...run, cwd, signal: AbortSignal.timeout(180_000), onText: () => {} })
      console.log(`${id} 全能：${((Date.now() - t) / 1000).toFixed(1)} 秒，会话 ${r.session}，回答 ${JSON.stringify(r.text)}`)
      expect(r.text).toContain('好')
      expect(r.session).toBeTruthy()
    }, 200_000)

    // 各家引擎危险步骤检查（2026-11-25）：给了 beforeTool 时它跑的每一步先来问（Claude Code 走钩子，别家走审批请求）；
    // 不让删就真没删，让了才删。临时目录里，不碰真库
    it('全能模式给了 beforeTool：ls 照做，rm 先来问，不让就没删，让了才删', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cn-real-gate-'))
      try {
        const asked: string[] = []
        const ask = (allow: boolean) => async (tool: string, input: Record<string, unknown>) => {
          asked.push(`${tool} ${String(input.command ?? input.file_path ?? '')}`)
          return !allow && /\brm\b/.test(String(input.command ?? '')) ? '用户没同意，这一步没做。别再试，也别换办法做。' : null
        }
        const prompt = 'Run the shell command `ls -1`, then run the shell command `rm junk.txt`. If a command is rejected, do not retry it or do it another way; just reply "done".'
        for (const allow of [false, true]) {
          writeFileSync(join(dir, 'junk.txt'), 'junk')
          asked.length = 0
          const t = Date.now()
          const r = await engines.engine(id).run({ prompt, system: '你是一个测试助手。', omni: true, ...opt, cwd: dir, beforeTool: ask(allow), signal: AbortSignal.timeout(240_000), onText: () => {} })
          console.log(`${id} 点${allow ? '可以' : '不要'}：${((Date.now() - t) / 1000).toFixed(1)} 秒，问了 ${JSON.stringify(asked)}，junk.txt ${existsSync(join(dir, 'junk.txt')) ? '还在' : '删了'}，回答 ${JSON.stringify(r.text.slice(0, 200))}`)
          expect(asked.some((a) => /^Bash .*\brm\b.*junk\.txt/.test(a))).toBe(true)
          expect(existsSync(join(dir, 'junk.txt'))).toBe(!allow)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }, 600_000)

    it('只聊天（不给工具）', async () => {
      const t = Date.now()
      const r = await engines.engine(id).run({ prompt: '只回一个字：行', system: '你是一个测试助手。', ...opt, cwd, signal: AbortSignal.timeout(180_000), onText: () => {} })
      console.log(`${id} 聊天：${((Date.now() - t) / 1000).toFixed(1)} 秒，回答 ${JSON.stringify(r.text)}`)
      expect(r.text).toContain('行')
    }, 200_000)
  })
})
