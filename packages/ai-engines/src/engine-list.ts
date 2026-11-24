/**
 * 引擎表（画布笔记、ParaRead 共用）：按哪一家造 Engine 并留着（一家一个，接着用同一个进程），
 * 列出这台 Mac 上各家的样子（EngineInfo：命令行找没找到、能不能跑、版本和自查、模型、effort、Key 尾号），
 * 说这一家现在能不能用。Key 存哪、本机模型开没开、测试换假的这些由宿主交进来（EnginesDeps），这里只用 Node。
 *
 * 命令行盯着的那部分（版本、自查、拉到的模型、新版本）在 engine-watch.ts：宿主自己 startEngineWatch，这里只读它记下的。
 */
import { type ApiId, type CliId, type EngineId, type EngineInfo, isApi, isCli, isLocal, type ModelOption, modelsOf, routeOf, ALL_IDS, ENGINE_LABEL } from './shared'
import { checkCli, checkedCli, COMMAND, findCli, INSTALL_HINT, locateCli } from './cli'
import { apiEngine, localEngine } from './engine-api'
import { claudeEngine, codexEngine, type Engine, geminiEngine, opencodeEngine } from './engines'
import { noteVersion, pulledModels, watchInfo } from './engine-watch'

/** 这一家的命令行在哪、能不能跑（EngineInfo 里这几项） */
export type CliFound = Pick<EngineInfo, 'path' | 'where' | 'broken' | 'custom' | 'hint'>

export interface EnginesDeps {
  /** API Key：这一家的 Key（真要问时才要，宿主从钥匙串解出来）；没有是 undefined */
  key(id: ApiId): string | undefined
  /** Key 的最后 4 位（界面「能用 · ••••3kQa」）；不给就不写 */
  keyTail?(id: ApiId): string | undefined
  /** 软件自带的 OpenCode（API Key 那几家要动手时交给它）；不给或 null：Key 那几家只能聊天 */
  opencode?(): { path: string; dataDir: string } | null
  /** API Key、本机模型这一家能不能用：Key 填过（验过）、本机模型开着有模型。命令行四家不问它 */
  sourceReady(id: EngineId): boolean
  /** API Key、本机模型这一家能选的模型（验 Key、找本机模型时拉到的） */
  sourceModels(id: EngineId): ModelOption[]
  /** 测试换假引擎（命令行四家）：给了、返回了就用它，不起真的命令行 */
  fake?(id: CliId): Engine | null
  /** 测试演的命令行在哪：给了、返回了就不真找（CN_AI_FAKE_CLI 那种）；返回 undefined 照真的找 */
  fakeCli?(id: CliId): CliFound | undefined
  /** 命令行没拉到过模型时补的（测试给 Codex 一份固定的）；不给是自带的那几个 */
  fallbackModels?(id: CliId): ModelOption[]
  /** 后台跑完 `--version` 发现先前当它能用报出去的其实运行不了：叫界面再要一次 */
  changed?(): void
}

export interface Engines {
  /** 这一家的引擎（造一次留着，dispose 时一起关） */
  engine(id: EngineId): Engine
  /** 各家的样子，顺序照 ALL_IDS（命令行四家、API Key 四家、本机模型两家） */
  list(): EngineInfo[]
  /** 这一家能选的模型，第一项是默认 */
  models(id: EngineId): ModelOption[]
  /** 这一家现在能不能用：命令行找到了、Key 填过、本机模型开着有模型 */
  ready(id: EngineId): boolean
  /** 关掉开着的进程（退出时） */
  dispose(): void
}

/** 找到了但运行不了时说一句怎么办 */
export const brokenHint = (id: CliId): string => `找到了 ${COMMAND[id]}，但运行不了。在终端里运行一次 ${COMMAND[id]} --version 看看哪里不对，或者重新装一遍。`

export function createEngines(deps: EnginesDeps): Engines {
  let made: Partial<Record<EngineId, Engine>> = {}
  const verifying = new Set<string>()

  function engine(id: EngineId): Engine {
    // API Key、本机模型（task-587os）：测试也走真的 HTTP（CN_API_BASE_*、CN_LOCAL_BASE_* 指到本机假的服务，或者真 Key 真问一句）
    if (isApi(id)) return (made[id] ??= apiEngine(id, { key: deps.key, ...(deps.opencode ? { opencode: deps.opencode } : {}) }))
    if (isLocal(id)) return (made[id] ??= localEngine(id))
    if (!made[id]) {
      const f = deps.fake?.(id)
      made[id] = f ?? (id === 'claude' ? claudeEngine() : id === 'codex' ? codexEngine() : id === 'gemini' ? geminiEngine() : opencodeEngine())
    }
    return made[id]!
  }

  /**
   * 这家能选的模型（task-m55m7）：从命令行拉到的（engine-watch.ts 记下的）；没拉到过用自带的（Claude Code 三个、别家只有「某家默认模型」）
   */
  function models(id: EngineId): ModelOption[] {
    if (!isCli(id)) return modelsOf(id, deps.sourceModels(id))
    const pulled = pulledModels(id)
    if (pulled) return modelsOf(id, pulled)
    return modelsOf(id, deps.fallbackModels?.(id) ?? [])
  }

  /** 后台跑一次 `--version`；运行不了时叫界面再要一次（先前当它能用报出去了）；能跑的记下版本（变了就自查、重拉模型） */
  function verify(id: CliId, path: string) {
    if (verifying.has(path)) return
    verifying.add(path)
    void checkCli(path)
      .then((c) => {
        if (!c.ok) deps.changed?.()
        else noteVersion(id, c.version)
      })
      .finally(() => verifying.delete(path))
  }

  function found(id: EngineId): CliFound {
    // API Key、本机模型：没有命令行，能用时给一个记号（界面照旧按 path 认能不能用）
    if (!isCli(id)) return deps.sourceReady(id) ? { path: `${routeOf(id)}:${id}`, where: '' } : { path: null, where: isApi(id) ? '没填Key' : '没找到' }
    const fake = deps.fakeCli?.(id)
    if (fake) return fake
    const hit = locateCli(id)
    if (!hit) return { path: null, where: '没找到', hint: INSTALL_HINT[id] }
    const mine = hit.custom ? { custom: true } : {}
    const c = checkedCli(hit.path)
    // 还没跑过 --version（或者文件换过了）：先当它能用，后台跑完运行不了再改口
    if (!c) verify(id, hit.path)
    if (c && !c.ok) return { path: null, where: hit.where, broken: c.why, hint: brokenHint(id), ...mine }
    return { path: hit.path, where: hit.where, ...mine }
  }

  function list(): EngineInfo[] {
    return ALL_IDS.map((id) => {
      const ms = models(id)
      const where = found(id)
      const tail = isApi(id) && deps.sourceReady(id) ? deps.keyTail?.(id) : undefined
      return { id, label: ENGINE_LABEL[id], route: routeOf(id), ...where, models: ms, efforts: ms[0]?.efforts ?? [], ...(tail ? { tail } : {}), ...(isCli(id) ? watchInfo(id, where.path) : {}) }
    })
  }

  function ready(id: EngineId): boolean {
    if (!isCli(id)) return deps.sourceReady(id)
    const fake = deps.fakeCli?.(id)
    return fake ? !!fake.path : !!findCli(id)
  }

  return {
    engine,
    list,
    models,
    ready,
    dispose() {
      for (const e of Object.values(made)) e.dispose?.()
      made = {}
    },
  }
}
