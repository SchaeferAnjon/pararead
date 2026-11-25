/**
 * 全能模式下各家命令行要做的一步（审批请求）换成 Claude Code 的叫法，交给 EngineRun.beforeTool（画布笔记用 stepDanger 判：
 * 安全的直接放行，删、推送、发消息、上传、改库外东西的先问）。stepDanger 只认 Bash {command}、Write / Edit {file_path}，
 * 所以这里把各家的样子都换成这两种：删文件写成 `rm '路径'`、挪文件写成 `mv '从' '到'`，跑在别的目录写成 `cd '目录' && …`。
 *
 * 各家真实的样子录在 test/fixtures/gate/ 里（Codex 0.163.0、OpenCode 1.19.3 真跑录的；Gemini 0.64.0 没登录，照它的源码写的）：
 * - Codex app-server：item/commandExecution/requestApproval 带 command（包了一层 `/bin/zsh -lc '…'`）和 cwd；
 *   item/fileChange/requestApproval 只带 itemId，改哪些文件在它前面那条 item/started 的 fileChange.changes 里
 * - Gemini --acp：session/request_permission 的 toolCall 没有 rawInput；跑命令时 title 就是整行命令，在哪跑写在 content 的
 *   「[in 目录]」「[current working directory 目录]」里；改文件的路径在 content 的 diff.path 和 locations 里
 * - OpenCode acp：toolCall.rawInput 有 command（git 那几样前面加了一段 `export CI=true …;`）、filepath；在哪跑在它前面那条
 *   tool_call_update 的 rawInput.cwd 里
 */
import { isAbsolute, resolve } from 'node:path'

/** 交给 beforeTool 的一步（Claude Code 的叫法） */
export interface GateStep {
  tool: string
  input: Record<string, unknown>
}

/** 交给 sh 的一个词：单引号包起来 */
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

const str = (...v: unknown[]) => String(v.find((x) => typeof x === 'string' && x) ?? '')

/** 一段 shell 的第一个词（认单双引号、反斜杠），rest 是剩下的 */
function firstWord(s: string): { word: string; rest: string } {
  let word = ''
  let i = 0
  while (i < s.length && /\s/.test(s[i]!)) i++
  for (; i < s.length; i++) {
    const c = s[i]!
    if (/\s/.test(c)) break
    if (c === "'") {
      const end = s.indexOf("'", i + 1)
      if (end < 0) return { word: word + s.slice(i + 1), rest: '' }
      word += s.slice(i + 1, end)
      i = end
    } else if (c === '"') {
      i++
      for (; i < s.length && s[i] !== '"'; i++) word += s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1]!) ? s[++i] : s[i]
    } else if (c === '\\' && i + 1 < s.length) word += s[++i]
    else word += c
  }
  return { word, rest: s.slice(i) }
}

/** Codex 跑命令都包了一层 `/bin/zsh -lc '…'`（bash -c、sh -c 也是）：拆掉，判里面那行 */
export function unwrapShell(cmd: string): string {
  const m = /^\s*(?:\S*\/)?(?:ba|z)?sh\s+(?:-l\s+)?-l?c\s+/.exec(cmd)
  if (!m) return cmd
  const inner = firstWord(cmd.slice(m[0].length)).word
  return inner || cmd
}

/** OpenCode 给 git 这几样命令前面加的那段环境变量（`export CI=true … ;`）：不是 AI 写的，判和显示都去掉 */
export function stripEnvPrefix(cmd: string): string {
  return cmd.replace(/^\s*export\s+(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s;'"]*)\s*)+;\s*/, '')
}

const plain = (p: string) => p.replace(/\/+$/, '').replace(/^\/private(?=\/(?:var|tmp)\/)/, '')

/** 在别的目录跑：前面加上 `cd '目录' &&`（stepDanger 照 cd 认在哪）；就在库里跑不加 */
export function inDir(cmd: string, cwd: string, root: string): string {
  if (!cwd) return cmd
  const abs = isAbsolute(cwd) ? cwd : resolve(root, cwd)
  return plain(abs) === plain(root) ? cmd : `cd ${shellQuote(abs)} && ${cmd}`
}

/** 改一个文件的那一步：新建 Write、改 Edit、删 rm、改名挪地方 mv */
function fileStep(kind: string, path: string, to?: string | null): GateStep {
  if (kind === 'delete') return { tool: 'Bash', input: { command: `rm ${shellQuote(path)}` } }
  if (to) return { tool: 'Bash', input: { command: `mv ${shellQuote(path)} ${shellQuote(to)}` } }
  return { tool: kind === 'add' ? 'Write' : 'Edit', input: { file_path: path } }
}

// ---------------------------------------------------------------- Codex

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

/**
 * Codex 的一个审批请求换成几步（一次改好几个文件就是几步，一步一步问）。item：它前面那条 item/started 里的那一条（改文件要它）。
 * 也认老写法 execCommandApproval（command 是数组）、applyPatchApproval（fileChanges 是路径 → 改法）
 */
export function codexGate(method: string, params: Obj, item: Obj | undefined, root: string): GateStep[] {
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
    const raw = Array.isArray(params.command) ? (params.command as unknown[]).map(String) : null
    const cmd = raw ? (raw.length === 3 && /(?:^|\/)(?:ba|z)?sh$/.test(raw[0]!) && /^-l?c$/.test(raw[1]!) ? raw[2]! : raw.map(shellQuote).join(' ')) : unwrapShell(str(params.command, item?.command))
    return [{ tool: 'Bash', input: { command: inDir(cmd, str(params.cwd, item?.cwd), root) } }]
  }
  if (method === 'item/fileChange/requestApproval') {
    const changes = (Array.isArray(item?.changes) ? item.changes : []) as { path?: unknown; kind?: { type?: unknown; move_path?: unknown } }[]
    const steps = changes.flatMap((c) => (typeof c.path === 'string' && c.path ? [fileStep(String(c.kind?.type ?? 'update'), c.path, typeof c.kind?.move_path === 'string' ? c.kind.move_path : null)] : []))
    // 要往一个目录写（grantRoot）、或者看不到改哪些文件：照它说的目录问
    const grant = str(params.grantRoot)
    if (grant) steps.push({ tool: 'Edit', input: { file_path: grant } })
    return steps.length ? steps : [{ tool: 'Edit', input: { file_path: '' } }]
  }
  if (method === 'applyPatchApproval') {
    return Object.entries(obj(params.fileChanges)).map(([path, c]) => {
      const ch = obj(c)
      return fileStep(str(ch.type) || 'update', path, typeof ch.move_path === 'string' ? ch.move_path : null)
    })
  }
  return []
}

// ---------------------------------------------------------------- ACP（Gemini、OpenCode）

/** ACP 的 toolCall（session/request_permission 里的，和它前面 session/update 里同一个 toolCallId 的） */
export interface AcpCall {
  toolCallId?: string
  title?: string
  kind?: string
  rawInput?: unknown
  content?: unknown
  locations?: { path?: string }[]
}

const paths = (c: AcpCall | undefined) => (c?.locations ?? []).flatMap((l) => (typeof l?.path === 'string' && l.path ? [l.path] : []))
const diffs = (c: AcpCall | undefined) => (Array.isArray(c?.content) ? (c.content as Obj[]) : []).filter((x) => x?.type === 'diff')

/** 删、挪、别的（两家一样）：删写成 rm，挪写成 mv（到哪在第二个位置），别的照它的名字（stepDanger 不认就放行） */
function acpOther(call: AcpCall, known: AcpCall | undefined): GateStep {
  const at = paths(call).length ? paths(call) : paths(known)
  if (call.kind === 'delete' && at.length) return { tool: 'Bash', input: { command: `rm ${at.map(shellQuote).join(' ')}` } }
  if (call.kind === 'move' && at.length) return { tool: 'Bash', input: { command: `mv ${at.map(shellQuote).join(' ')}` } }
  if (call.kind === 'fetch') return { tool: 'WebFetch', input: { url: str(obj(call.rawInput).url, call.title) } }
  return { tool: str(call.kind, call.title) || 'other', input: obj(call.rawInput) }
}

/**
 * Gemini（0.64.0）的一个权限请求。跑命令：title 是整行命令，content 里「[in 目录]」是它给的 dir_path（相对的照库），
 * 「[current working directory 目录]」是它自己的工作目录（就是库）。改文件：diff 的 path（_meta.kind add 是新建）
 */
export function geminiGate(call: AcpCall, known: AcpCall | undefined, root: string): GateStep {
  if (call.kind === 'execute') {
    const said = (Array.isArray(call.content) ? (call.content as Obj[]) : []).map((x) => str(obj(x.content).text)).join('\n')
    const dir = /\[(?:in|current working directory) ([^\]\n]+)\]/.exec(said)?.[1] ?? ''
    return { tool: 'Bash', input: { command: inDir(str(obj(call.rawInput).command, call.title, known?.title), dir, root) } }
  }
  if (call.kind === 'edit') {
    const d = diffs(call)[0]
    const path = str(d?.path, paths(call)[0], paths(known)[0])
    return fileStep(obj(d?._meta).kind === 'add' ? 'add' : 'update', path)
  }
  return acpOther(call, known)
}

/**
 * OpenCode（1.19.3）的一个权限请求（bash、edit、webfetch、external_directory 设成 ask 时来）。跑命令：rawInput.command，
 * 在哪跑在前面那条 tool_call_update 的 rawInput.cwd；改文件：rawInput.filepath；库外的目录（external_directory）：照读算，
 * 真要往那里写、跑命令时它另有 edit、bash 那一问
 */
export function opencodeGate(call: AcpCall, known: AcpCall | undefined, root: string): GateStep {
  const raw = { ...obj(known?.rawInput), ...obj(call.rawInput) }
  if (call.kind === 'execute') return { tool: 'Bash', input: { command: inDir(stripEnvPrefix(str(raw.command, call.title)), str(raw.cwd, raw.workdir), root) } }
  if (call.kind === 'edit') return fileStep(/^@@ -0,0 /m.test(str(raw.diff)) ? 'add' : 'update', str(raw.filepath, raw.filePath, raw.file_path, paths(call)[0], paths(known)[0]))
  if (/external_directory/.test(str(call.title))) return { tool: 'Read', input: { file_path: str(raw.filepath, raw.parentDir, paths(call)[0]) } }
  return acpOther(call, known)
}

/**
 * 一步一步问（beforeTool 返回一句话就是不让做）；问出了错也当不让做（宁可不做，也不在没点头时动手）。全都放行才返回 true
 */
export async function passGate(steps: GateStep[], ask: (tool: string, input: Record<string, unknown>, id?: string) => Promise<string | null>, id?: string): Promise<boolean> {
  for (const s of steps) {
    const no = await ask(s.tool, s.input, id).catch(() => 'err')
    if (no) return false
  }
  return true
}
