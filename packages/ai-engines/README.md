# @cn/ai-engines

AI 引擎的主进程那一层，画布笔记、画布今日、ParaRead 共用。2026-11-23 从画布笔记 `apps/notes/src/main/agent/` 搬来（`git mv`，历史跟着走），画布笔记、画布今日改成调它，行为不变。计划和理由在联动设计页 `20-pararead联动`「共用代码」一节。

规矩：只用 Node（child_process、fs、os、path、crypto）；不引 Electron（`packages/ai-chat/test/no-electron.test.ts`），不引哪个软件自己的文件（`test/no-apps.test.ts`：src 里的相对引用不出包、不引 `apps/`）；界面字一律 `t()`，从包内 `./shared/i18n` 引，宿主启动时 `setI18n` 交翻译。`process.env.CN_*` 这些测试开关照留，宿主不设就是默认。许可证 GPL-3.0-or-later。

## 有什么

两个入口：

- `@cn/ai-engines/shared`：不碰 Node 的那一半，主进程、界面、ParaRead 的渲染进程都能引。哪一家（`EngineId`、`CliId`、`ApiId`、`LocalId`、`ALL_IDS`、`isCli` …）、各家能选的模型和 effort（`features.ts`：`modelsOf`、`fitPick`、`pickLabel`、`resolvePick` …）、自查的话（`health.ts`）、`EngineInfo`、`setI18n`。
- `@cn/ai-engines`：Node 那一半。

| 文件 | 做什么 |
| --- | --- |
| `engines.ts` | `Engine`、`EngineRun`：Claude Code（`claude -p` stream-json）、Codex（app-server）、Gemini 和 OpenCode（ACP）各一个；全能模式的参数（`claudeArgs`、`CODEX_LOCKED`、`geminiArgs`、`opencodeConfig`） |
| `engine-api.ts` | API Key 四家直接问接口（Anthropic Messages、OpenAI 兼容），要动手时交给自带的 OpenCode；本机模型（Ollama、LM Studio）；验 Key、找本机模型 |
| `engine-list.ts` | `createEngines(deps)`：引擎表（下面） |
| `cli.ts` | 找命令行（登录 shell 的 PATH、常见目录、Codex.app 里的）、跑 `--version`、「装在别处？」 |
| `engine-watch.ts`、`engine-check.ts`、`engine-models.ts`、`engine-update.ts`、`engine-proc.ts` | 盯各家命令行：版本、自查、拉模型、看新版本、更新（`startEngineWatch` 由宿主起，记在宿主给的目录的 `engines.json`） |
| `jsonrpc.ts` | 一行一条的 JSON-RPC 进程（Codex、ACP 用） |
| `keys.ts` | `KeyStore`（Key 加密存、只露尾号，加密由宿主交）；借画布笔记的 Key；画布笔记设置目录 |
| `side-prompt.ts` | 旁支里问一句时交给 AI 的话 |

画布笔记留着的（会话那一层）：`apps/notes/src/main/agent/index.ts`（IPC、一轮对话、提交）、`store.ts`、`tools.ts`、`mcp-server.ts`（给 AI 动手的 MCP 工具）、`sources.ts`（Key 用 Electron safeStorage、本机模型找到的、自带 OpenCode 在哪）、`cc-setup.ts`、`fake-engine.ts`（`CN_AI_FAKE=1` 的假引擎）。

## 引擎表：`createEngines`

```ts
export type CliFound = Pick<EngineInfo, 'path' | 'where' | 'broken' | 'custom' | 'hint'>

export interface EnginesDeps {
  key(id: ApiId): string | undefined
  keyTail?(id: ApiId): string | undefined
  opencode?(): { path: string; dataDir: string } | null
  sourceReady(id: EngineId): boolean
  sourceModels(id: EngineId): ModelOption[]
  fake?(id: CliId): Engine | null
  fakeCli?(id: CliId): CliFound | undefined
  fallbackModels?(id: CliId): ModelOption[]
  changed?(): void
}

export interface Engines {
  engine(id: EngineId): Engine
  list(): EngineInfo[]
  models(id: EngineId): ModelOption[]
  ready(id: EngineId): boolean
  dispose(): void
}

export function createEngines(deps: EnginesDeps): Engines
```

- `key`：真要问时才调（宿主这时才解密）。`keyTail`：设置里「••••3kQa」。
- `opencode`：软件自带的 OpenCode 和它自己的设置目录；不给，Key 那几家只能聊天（给了 `mcp` 要动手时报一句「软件自带的OpenCode不在」，只开全能模式不给 `mcp` 时照旧直接问接口）。
- `sourceReady`、`sourceModels`：Key 填过没有、本机模型开没开，和它们的模型（宿主验 Key、找本机模型时记下的；包里有 `verifyKey`、`probeLocal`、`localModels` 帮着做）。
- `fake`、`fakeCli`、`fallbackModels`：测试用（画布笔记 `CN_AI_FAKE=1`、`CN_AI_FAKE_CLI`）；不给就是真的。
- `changed`：后台跑完 `--version` 发现先前当能用的那个跑不了，叫界面再要一次。
- 拉到的模型、版本、自查（`list()` 里的 `version`、`health`、`pulled`、`latest`、`updateWith`）要宿主先 `startEngineWatch({ dir, changed, enabled })`；不起就只有自带的模型。

跑一问：`engines.engine(id).run({ prompt, system, cwd, signal, onText, model?, effort?, session?, images?, omni?, mcp? … })`，返回 `{ text, session? }`。全能模式（`omni: true`）不给 `mcp` 也照全能跑，只是不接 MCP：Claude Code `bypassPermissions`、自带工具全给只拿掉 AskUserQuestion、`--append-system-prompt`、`--setting-sources=`、`--strict-mcp-config`、留会话；Codex danger-full-access；Gemini yolo；OpenCode 全放行。

## Key：`keys.ts`

```ts
export interface Cipher { encrypt(plain: string): Buffer; decrypt(data: Buffer): string }
export class KeyStore {
  constructor(file: string | null, cipher: Cipher | null) // 任一个 null：只放内存（e2e）
  has(id: string): boolean
  get(id: string): string | undefined   // 用的时候才解密
  tail(id: string): string | undefined
  set(id: string, key: string): void
  delete(id: string): void
}
export const keyTail: (key: string) => string
export function cleanKey(raw: unknown): string

export const notesSettingsDir: (home?: string) => string   // ~/Library/Application Support/canvas-notes
export const NOTES_SAFE_STORAGE = 'Canvas Notes Safe Storage'
export interface NotesKeys { dir: string | null; test?: Record<string, string> | null }
export function parseTestKeys(raw: string | undefined): Record<string, string> | null
export function notesHasKey(o: NotesKeys, id: string): boolean
export function readNotesKey(o: NotesKeys, id: string): Promise<string>
export function decryptSafeStorage(data: Buffer, password: string): string
export function keychainPassword(service: string): Promise<string>
```

借画布笔记那把：`notesHasKey` 只看画布笔记设置目录的 `ai/keys.json` 里有没有这一家的密文（不解、不碰钥匙串）；`readNotesKey` 用 `security find-generic-password` 取「Canvas Notes Safe Storage」的密码（系统弹一次「允许访问」）、按 Chromium OSCrypt（v10、AES-128-CBC、PBKDF2-SHA1 saltysalt 1003 次）解出来。`test` 给了就只认它：测试实例不读用户真的设置、不碰钥匙串。各家自己的环境变量名由宿主读（画布今日 `CT_TEST_NOTES_KEYS`）再经 `parseTestKeys` 交进来。

## 宿主交什么

| | 画布笔记 | 画布今日 | ParaRead（照这个接） |
| --- | --- | --- | --- |
| 翻译 | `shared/i18n/index.ts` 末尾 `setI18n` | 引画布笔记的 `store.ts` 时一起交了 | 主进程启动时 `setI18n({ t, list })` 交它的 i18next |
| Key | `agent/sources.ts`：`KeyStore` + safeStorage，`apiKey`、`apiKeyTail` | `main/ai-keys.ts`：自己一份 `KeyStore`，`todayKey`；借画布笔记那把用 `readNotesKey` | 自己一份 `KeyStore`（safeStorage 交 `Cipher`），借画布笔记那把同画布今日 |
| 本机模型 | `probeAll` 找，`sourceReady`、`sourceModels` | 不列（`canAsk` 时现找） | `probeLocal` + `localModels` |
| 自带 OpenCode | `bundledOpencode()` | 不给（只问不动手） | 没打包就不给 |
| 盯命令行 | `startEngineWatch`（userData/ai） | 读画布笔记的 `ai/engines.json` | 自己的 userData 下起一份 |
| 测试 | `fake`、`fakeCli`、`fallbackModels` | `CT_AI_FAKE` 在调引擎之前短路 | 自己的假开关 |

## ParaRead 怎么接

2026-11-23 已接上：`apps/pararead/src/main/ipcChat.ts`（`createEngines`、`startEngineWatch`、`probeLocal`、借 Key 那几个）和 `chatAi.ts`（跑一问、会话、贴图）。ParaRead 的 Key 存在它自己的 settings.json（providers.ts 的 id：anthropic 对 claude），不用 KeyStore；不给 `opencode`：Key 那几家只聊天（借用户自己装的 OpenCode 动手，实测 `deepseek/deepseek-chat` 换不成模型）。

```ts
import { createEngines, KeyStore, notesHasKey, notesSettingsDir, parseTestKeys, probeLocal, localModels, readNotesKey, startEngineWatch } from '@cn/ai-engines'
import { setI18n, isApi, isLocal, LOCAL_IDS } from '@cn/ai-engines/shared'

setI18n({ t: (k, p) => i18n.t(k, p), list: (xs) => new Intl.ListFormat(lang).format(xs) })
const keys = new KeyStore(join(userData, 'ai-keys.json'), { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) })
const local = {} // probeLocal 找到的
const engines = createEngines({
  key: (id) => keys.get(id),
  keyTail: (id) => keys.tail(id),
  sourceReady: (id) => (isApi(id) ? keys.has(id) : isLocal(id) ? !!local[id]?.on && !!local[id]?.models.length : false),
  sourceModels: (id) => (isLocal(id) && local[id] ? localModels(local[id]) : []),
  changed: () => win.webContents.send('ai:engines:changed'),
})
startEngineWatch({ dir: join(userData, 'ai'), changed: () => win.webContents.send('ai:engines:changed'), enabled: true })
// 列：engines.list()；问：await engines.engine(id).run({ prompt, system, cwd, omni: true, signal, onText })
// 借画布笔记的 Key：const notes = { dir: notesSettingsDir(), test: E2E ? parseTestKeys(process.env.PR_TEST_NOTES_KEYS ?? '{}') : null }
//   notesHasKey(notes, 'anthropic') 时问一句，同意后 keys.set('anthropic', await readNotesKey(notes, 'anthropic'))
```

还没搬的（下一步）：读 PDF 问一次的提示词和写一段（`apps/notes/src/main/reading/prompts.ts`、`section.ts`）、ParaRead 的 11 家服务商（`src/shared/providers.ts`、`src/main/stream.ts`、`src/shared/thinking.ts`）、Windows 上找命令行（ParaRead `src/main/platform.ts`）。

## 测试

`packages/ai-engines/test/`：各家接法（假的 codex app-server、ACP 命令行、`fake-cli.mjs` 在 `test/fixtures/`）、API 和本机模型（本机假接口）、找命令行、盯版本和模型、引擎表、Key 借用、不引 apps。Claude Code 接画布笔记 MCP 服务的那组在 `apps/notes/test/engines-claude.test.ts`。根上 `pnpm vitest run packages/ai-engines`。
