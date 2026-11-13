// 本机 Claude Code：把用户自己装好、自己登录的 claude 命令行当子进程跑（-p 模式），不走 HTTP，不碰它的登录信息。
// 关掉它的工具、MCP、各级设置、技能和会话存档，系统提示词换成我们的：一次调用就是一问一答，约 1 秒起步。
// 输入输出都用 stream-json：一行一个 JSON，图片按内容块给，回答的增量和思考内容一段一段出来。
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { GlmError, type ChatMsg, type ToolCall, type ToolDef } from './glm'
import { t } from '../shared/i18n'
import type { LocalCliStatus } from '../shared/types'

interface Cli {
  path: string
  version: string
  env: NodeJS.ProcessEnv
}

// 从访达打开的应用拿不到终端里的 PATH（claude 常装在 ~/.local/bin，或者跟着 nvm 的 node 走）：问一次登录 shell
function loginPath(): Promise<string> {
  return new Promise((res) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'echo "__PATH__${PATH}__END__"'], { timeout: 5000, encoding: 'utf8' }, (_e, out) => res(/__PATH__(.*?)__END__/.exec(out ?? '')?.[1] ?? ''))
  })
}

const run = (file: string, argv: string[], env: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((res, rej) => execFile(file, argv, { timeout: 15_000, encoding: 'utf8', env }, (e, out) => (e && !out ? rej(e) : res(out))))

const KNOWN_DIRS = [join(homedir(), '.local/bin'), join(homedir(), '.claude/local'), join(homedir(), '.npm-global/bin'), join(homedir(), '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin']

let finding: Promise<Cli | null> | null = null
let known: Cli | null = null

async function find(): Promise<Cli | null> {
  const dirs = [...new Set([...(process.env.PATH ?? '').split(delimiter), ...(await loginPath()).split(delimiter), ...KNOWN_DIRS])].filter(Boolean)
  const path = dirs.map((d) => join(d, 'claude')).find((f) => existsSync(f))
  if (!path) return null
  // 老的 npm 装法里 claude 是个 node 脚本，要在 PATH 里找得到 node
  const env = { ...process.env, PATH: dirs.join(delimiter) }
  const version = (await run(path, ['--version'], env)).trim().split(/\s/)[0]
  return { path, version, env }
}

/** 找这台电脑上的 claude；找过的记着，again 时重新找（用户刚装好、刚登录） */
export function findClaude(again = false): Promise<Cli | null> {
  if (!finding || again) finding = find().then((c) => (known = c))
  return finding
}

/** 已经找到过（同步问）：没找过或者没找到都是 false */
export const claudeFound = (): boolean => !!known

export async function claudeStatus(again = false): Promise<LocalCliStatus> {
  const c = await findClaude(again)
  if (!c) return { found: false, path: '', version: '', loggedIn: null }
  // claude auth status 打一段 JSON；没登录时退出码不是 0 但 JSON 照样有。读不出来就不下结论
  let loggedIn: boolean | null = null
  const m = /\{[\s\S]*\}/.exec(await run(c.path, ['auth', 'status'], c.env).catch(() => ''))
  if (m) loggedIn = !!(JSON.parse(m[0]) as { loggedIn?: boolean }).loggedIn
  return { found: true, path: c.path.replace(homedir(), '~'), version: c.version, loggedIn }
}

type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

const textOf = (c: ChatMsg['content']): string => (typeof c === 'string' ? c : (c ?? []).flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n'))

/** 我们的消息（OpenAI 的样子）变成一段系统提示词加一条用户消息。多轮对话写成对话记录；图片按出现的先后跟在文字后面 */
export function toPrompt(messages: ChatMsg[], tools?: ToolDef[]): { system: string; content: Block[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content))
  const rest = messages.filter((m) => m.role !== 'system')
  const images: Block[] = []
  const withImages = (m: ChatMsg): string => {
    let s = textOf(m.content)
    if (Array.isArray(m.content))
      for (const p of m.content) {
        if (p.type !== 'image_url') continue
        const d = /^data:([\w/.+-]+);base64,(.+)$/s.exec(p.image_url.url)
        if (!d) throw new GlmError(t('这张图不是内嵌的图片数据，本机 Claude Code 读不了'))
        images.push({ type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } })
        if (rest.length > 1) s += `\n（附图 ${images.length}）`
      }
    return s
  }
  let text: string
  if (rest.length === 1 && rest[0].role === 'user') text = withImages(rest[0])
  else {
    const nameOf = new Map<string, string>()
    const lines = rest.map((m) => {
      if (m.role === 'user') return `[用户]\n${withImages(m)}`
      if (m.role === 'tool') return `[工具结果 ${nameOf.get(m.tool_call_id ?? '') ?? ''}]\n${textOf(m.content)}`
      const calls = (m.tool_calls ?? []).map((c) => (nameOf.set(c.id, c.function.name), `[助手调用工具 ${c.function.name}] ${c.function.arguments}`))
      return [textOf(m.content) && `[助手]\n${textOf(m.content)}`, ...calls].filter(Boolean).join('\n')
    })
    text = `下面是到现在为止的对话。直接写你（助手）接下来要说的话，不要带「[助手]」这样的标记。\n\n${lines.join('\n\n')}${tools ? '\n\n接着做下一步。' : ''}`
  }
  if (tools) system.push(toolGuide(tools))
  return { system: system.join('\n\n'), content: [{ type: 'text', text }, ...images] }
}

// 命令行自己的工具都关着，我们的工具用文字约定：要用工具就在回答最后写 tool 代码块，我们执行了下一步把结果给它
function toolGuide(tools: ToolDef[]): string {
  return [
    '你自己不能直接动手，要用工具时由系统替你执行。做法：这一步要用工具，就在回答的最后写一个或几个这样的代码块（一个代码块一次调用），然后停下，不要猜结果；系统执行后在下一步把结果给你。',
    '```tool\n{"name": "工具名", "arguments": {参数}}\n```',
    '这一步不需要工具时，不写代码块，直接写给用户的话。',
    '可用工具：',
    ...tools.map((x) => `- ${x.function.name}：${x.function.description}。参数：${JSON.stringify(x.function.parameters)}`)
  ].join('\n')
}

// 从 at（一个左花括号）起找到配对的右花括号，字符串里的括号不算。找不到返回 -1
function objectEnd(text: string, at: number): number {
  let depth = 0
  let inStr = false
  for (let i = at; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * 从回答里拆出工具调用和剩下的话。认的是 {"name": 工具名, "arguments": …} 这个 JSON，不认代码块的围栏：
 * 模型偶尔会少写开头的 ```tool 那一行，或者写成 ```json。名字是已有的工具、或者写在 tool 代码块里的，都算调用。
 */
export function parseToolCalls(text: string, tools: ToolDef[]): { content: string; toolCalls: ToolCall[] } {
  const names = new Set(tools.map((x) => x.function.name))
  const toolCalls: ToolCall[] = []
  let content = ''
  let from = 0
  const re = /\{\s*"name"\s*:\s*"([^"]+)"/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const fence = /```[\w-]*[ \t]*\n\s*$/.exec(text.slice(from, m.index))
    if (!names.has(m[1]) && !fence?.[0].startsWith('```tool')) continue
    const end = objectEnd(text, m.index)
    let j: { arguments?: unknown } | null = null
    try {
      if (end > 0) j = JSON.parse(text.slice(m.index, end + 1))
    } catch {
      // 下面一起报
    }
    if (!j) throw new GlmError(t('Claude Code 写的工具调用不是合法的 JSON：{0}', text.slice(m.index, m.index + 120)))
    toolCalls.push({ id: `cc_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: m[1], arguments: JSON.stringify(j.arguments ?? {}) } })
    // 这次调用连同它前后的围栏从给用户看的话里拿掉
    content += text.slice(from, fence ? from + fence.index : m.index)
    from = end + 1 + (/^\s*```/.exec(text.slice(end + 1))?.[0].length ?? 0)
    re.lastIndex = from
  }
  return { content: (content + text.slice(from)).trim(), toolCalls }
}

export interface CcCall {
  dir: string // 跑命令行的文件夹（空的，不是哪个项目），系统提示词的临时文件也放这里
  model: string
  messages: ChatMsg[]
  tools?: ToolDef[]
  thinking?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  onReasoning?: (text: string) => void
}

interface Line {
  type?: string
  event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } }
  is_error?: boolean
  result?: string
  subtype?: string
}

export async function ccStream(o: CcCall, onDelta?: (text: string) => void): Promise<string> {
  const cli = await findClaude()
  if (!cli) throw new GlmError(t('这台电脑上没找到 Claude Code（claude 命令）：装好并登录后，到设置里点「重新检测」'))
  const { system, content } = toPrompt(o.messages, o.tools)
  mkdirSync(o.dir, { recursive: true })
  const sysFile = join(o.dir, `${randomUUID()}.txt`)
  // 不给系统提示词的话它会用自己写代码的那一套
  writeFileSync(sysFile, system || 'You are a helpful assistant.')
  // prettier-ignore
  const argv = ['-p', '--system-prompt-file', sysFile, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
    '--model', o.model, '--effort', o.thinking ? 'high' : 'low', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cli.path, argv, { cwd: o.dir, env: cli.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    let errOut = ''
    let result: Line | null = null
    let stopped: GlmError | null = null
    const stop = (why: string): void => {
      stopped = new GlmError(why)
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000).unref()
    }
    const timer = setTimeout(() => stop(t('请求超时')), o.timeoutMs ?? 180_000)
    const onAbort = (): void => stop(t('已停止'))
    if (o.signal?.aborted) onAbort()
    else o.signal?.addEventListener('abort', onAbort, { once: true })
    const line = (s: string): void => {
      if (!s.trim()) return
      const j = JSON.parse(s) as Line
      if (j.type === 'result') result = j
      const d = j.type === 'stream_event' && j.event?.type === 'content_block_delta' ? j.event.delta : undefined
      if (d?.type === 'text_delta' && d.text) onDelta?.(d.text)
      if (d?.type === 'thinking_delta' && d.thinking) o.onReasoning?.(d.thinking)
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      parts.forEach(line)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (errOut = (errOut + chunk).slice(-2000)))
    const done = (fn: () => void): void => {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      rmSync(sysFile, { force: true })
      fn()
    }
    child.on('error', (e) => done(() => reject(new GlmError(t('Claude Code 没跑起来：{0}', e.message)))))
    child.on('close', (code) =>
      done(() => {
        if (stopped) return reject(stopped)
        line(buf)
        const r = result as Line | null
        if (r && !r.is_error && typeof r.result === 'string') return resolve(r.result)
        reject(new GlmError(t('Claude Code：{0}', (r?.result || r?.subtype || errOut.trim().split('\n').pop() || `exit ${code}`).slice(0, 300))))
      })
    )
    // 它没起来或者先退了的时候这里会报 EPIPE：真正的原因在上面的 close 里报
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
  })
}

export async function ccTools(o: CcCall): Promise<{ content: string; toolCalls: ToolCall[]; reasoning: string }> {
  let reasoning = ''
  const text = await ccStream({ ...o, onReasoning: (r) => (reasoning += r) })
  return { ...parseToolCalls(text, o.tools ?? []), reasoning }
}
