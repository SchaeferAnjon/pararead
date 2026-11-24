// 真跑本机的命令行（要联网、花一点额度），照 ParaRead 的接法：createEngines 列出各家、拿 Engine，
// 全能模式不给 mcp（Claude Code bypassPermissions、Codex danger-full-access……不接 MCP、留会话）问一句，再只聊天问一句。
// 默认只跑 Claude Code（haiku、low）；CN_REAL_ENGINES=claude,codex 多跑几家（别家用它自己的默认模型、low）。
// 在 Claude Code 的终端里跑时去掉父会话的 CLAUDE_* 环境变量（像从访达打开的软件一样）：
// env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx vitest run packages/ai-engines/test/real-engines.test.ts
// 全能那一问留下的会话记录（Claude Code 在 ~/.claude/projects/ 下名字带 cn-real-engines- 的文件夹，Codex 在 ~/.codex/sessions）跑完挪走。
import { mkdtempSync, rmSync } from 'node:fs'
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

    it('只聊天（不给工具）', async () => {
      const t = Date.now()
      const r = await engines.engine(id).run({ prompt: '只回一个字：行', system: '你是一个测试助手。', ...opt, cwd, signal: AbortSignal.timeout(180_000), onText: () => {} })
      console.log(`${id} 聊天：${((Date.now() - t) / 1000).toFixed(1)} 秒，回答 ${JSON.stringify(r.text)}`)
      expect(r.text).toContain('行')
    }, 200_000)
  })
})
