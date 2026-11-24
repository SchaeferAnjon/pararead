// 引擎表（createEngines）：宿主交 Key、本机模型、测试用的假引擎，列出来的和造出来的照它们（ParaRead 照这个接）
import { describe, expect, it } from 'vitest'
import { createEngines, type CliFound, type Engine, type EnginesDeps } from '../src'
import { ALL_IDS, type CliId, type EngineId } from '../src/shared'

function fakeEngine(id: EngineId, log: string[]): Engine {
  return {
    id,
    label: `假的 ${id}`,
    dispose: () => void log.push(`关 ${id}`),
    run: async () => ({ text: `${id} 答` }),
  }
}

const FOUND: Record<CliId, CliFound> = {
  claude: { path: '/fake/claude', where: '~/.local/bin' },
  codex: { path: null, where: '没找到', hint: '装一下' },
  gemini: { path: null, where: '/opt/homebrew/bin', broken: '跑不了', hint: '重装' },
  opencode: { path: '/fake/opencode', where: '~/.opencode/bin' },
}

function deps(log: string[], over: Partial<EnginesDeps> = {}): EnginesDeps {
  return {
    key: (id) => (id === 'anthropic' ? 'sk-ant-12345678' : undefined),
    keyTail: (id) => (id === 'anthropic' ? '5678' : undefined),
    sourceReady: (id) => id === 'anthropic' || id === 'ollama',
    sourceModels: (id) => (id === 'ollama' ? [{ id: 'qwen3:8b', label: 'qwen3:8b', efforts: [] }] : []),
    fake: (id) => fakeEngine(id, log),
    fakeCli: (id) => FOUND[id],
    fallbackModels: (id) => (id === 'codex' ? [{ id: 'gpt-9', label: 'GPT-9', efforts: [] }] : []),
    ...over,
  }
}

describe('createEngines', () => {
  it('列出十家，顺序照 ALL_IDS；命令行照 fakeCli 写在哪、能不能跑，Key 那家给记号和尾号，本机模型给它的模型', () => {
    const list = createEngines(deps([])).list()
    expect(list.map((e) => e.id)).toEqual(ALL_IDS)
    const by = Object.fromEntries(list.map((e) => [e.id, e]))
    expect(by.claude).toMatchObject({ label: 'Claude Code', route: 'cli', path: '/fake/claude', where: '~/.local/bin' })
    expect(by.codex).toMatchObject({ path: null, where: '没找到', hint: '装一下' })
    expect(by.codex!.models.map((m) => m.id)).toContain('gpt-9')
    expect(by.gemini).toMatchObject({ path: null, broken: '跑不了' })
    expect(by.anthropic).toMatchObject({ route: 'api', path: 'api:anthropic', where: '', tail: '5678' })
    expect(by.openai).toMatchObject({ path: null, where: '没填Key' })
    expect(by.openai!.tail).toBeUndefined()
    expect(by.ollama).toMatchObject({ route: 'local', path: 'local:ollama' })
    expect(by.ollama!.models.map((m) => m.id)).toEqual(['qwen3:8b'])
    expect(by.lmstudio).toMatchObject({ path: null, where: '没找到' })
    // Claude Code 自带的几个模型、默认那个的 effort
    expect(by.claude!.models.length).toBeGreaterThan(1)
    expect(by.claude!.efforts.length).toBeGreaterThan(0)
  })

  it('能不能用：命令行照 fakeCli 的 path，Key、本机模型照 sourceReady', () => {
    const e = createEngines(deps([]))
    expect(ALL_IDS.filter((id) => e.ready(id))).toEqual(['claude', 'opencode', 'anthropic', 'ollama'])
  })

  it('命令行四家用 fake 给的引擎，一家造一次留着；dispose 一起关', async () => {
    const log: string[] = []
    const e = createEngines(deps(log))
    const a = e.engine('claude')
    expect(e.engine('claude')).toBe(a)
    expect((await a.run({ prompt: '', system: '', cwd: '/', signal: new AbortController().signal, onText: () => {} })).text).toBe('claude 答')
    e.engine('codex')
    e.dispose()
    expect(log).toEqual(['关 claude', '关 codex'])
    expect(e.engine('claude')).not.toBe(a)
  })

  it('Key 那几家、本机模型不走 fake：造的是直接问接口的引擎，Key 没填时问一句就说清楚', async () => {
    const e = createEngines(deps([]))
    const api = e.engine('openai')
    expect(api.label).not.toMatch(/^假的/)
    await expect(api.run({ prompt: '你好', system: '', cwd: '/', signal: new AbortController().signal, onText: () => {} })).rejects.toThrow(/Key/)
    expect(e.engine('ollama').label).not.toMatch(/^假的/)
  })

  it('fake 返回 null 时起真的命令行引擎（不跑，只看造出来的是哪家）', () => {
    const e = createEngines(deps([], { fake: () => null }))
    expect(e.engine('gemini').id).toBe('gemini')
    expect(e.engine('gemini').label).toBe('Gemini')
    e.dispose()
  })
})
