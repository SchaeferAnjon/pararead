// 假的 AI 命令行（task-m55m7）：一个脚本演 claude、codex、gemini、opencode 四家，测拉模型、读版本、自查、更新，不联网、不花钱。
// 用法：node fake-cli.mjs <claude|codex|gemini|opencode> 参数…（e2e 在临时家目录的 ~/.local/bin 放一个 sh 包一层）。
// 状态在 FAKE_CLI_STATE 目录的 <家>.json 里，测试中途改它就是「命令行换了」：
//   version 版本；unknown 不认的参数（claude 照 commander 的原话报 unknown option）；models 模型列表；
//   update 跑「更新」时：{ to: 新版本, then: 换完以后改哪些字段, fail: 失败时的原话 }；missing 没有了的 app-server 方法（codex）
// 每次被调都在 <家>.log 里记一行参数（测试看软件真跑了什么）。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const [name, ...argv] = process.argv.slice(2)
const dir = process.env.FAKE_CLI_STATE
const file = dir ? join(dir, `${name}.json`) : null
const state = (() => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
})()
const version = state.version ?? { claude: '2.1.330', codex: '0.163.0', gemini: '0.64.0', opencode: '1.19.3' }[name]
if (dir) appendFileSync(join(dir, `${name}.log`), JSON.stringify(argv) + '\n')
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const say = (s) => process.stdout.write(s + '\n')
/** 报错退出：写完再退（管道是异步的，直接 process.exit 会丢字）；调的地方 return 它 */
const fail = (s, code = 1) => {
  process.stderr.write(s + '\n')
  process.exitCode = code
}

function update() {
  const u = state.update ?? {}
  if (u.fail) return fail(u.fail)
  const to = u.to ?? version
  writeFileSync(file, JSON.stringify({ ...state, ...(u.then ?? {}), version: to, update: {} }))
  say(to === version ? `${name} is up to date (${version})` : `Successfully updated from ${version} to version ${to}`)
}

// ---------------------------------------------------------------- claude
const CLAUDE_FLAGS = ['-p, --print', '--output-format <format>', '--input-format <format>', '--verbose', '--include-partial-messages', '--model <model>', '--append-system-prompt <prompt>', '--system-prompt <prompt>', '--setting-sources <sources>', '--settings <file-or-json>', '--strict-mcp-config', '--permission-mode <mode>', '--disallowedTools, --disallowed-tools <tools...>', '--allowedTools, --allowed-tools <tools...>', '--mcp-config <configs...>', '--tools <tools...>', '--no-session-persistence', '--effort <level>', '-r, --resume [value]', '--fork-session', '-v, --version', '-h, --help']
const MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const CLAUDE_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-9', displayName: 'Default (recommended)', description: 'Opus 9', supportsEffort: true, supportedEffortLevels: LEVELS },
  { value: 'opus', resolvedModel: 'claude-opus-9', displayName: 'Opus 9', description: 'For complex work', supportsEffort: true, supportedEffortLevels: LEVELS },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-9', displayName: 'Sonnet 9', description: 'Efficient', supportsEffort: true, supportedEffortLevels: LEVELS },
  { value: 'haiku', resolvedModel: 'claude-haiku-9', displayName: 'Haiku 9', description: 'Fastest', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
]

function claude() {
  if (argv[0] === '--version' || argv[0] === '-v') return say(`${version} (Claude Code)`)
  if (argv[0] === '--help' || argv[0] === '-h') {
    const unknown = new Set(state.unknown ?? [])
    say('Usage: claude [options] [command] [prompt]\n\nOptions:')
    for (const f of CLAUDE_FLAGS) if (!f.split(/[ ,]+/).some((x) => unknown.has(x))) say(`  ${f}`)
    say('\nCommands:\n  update|upgrade   Check for updates and install if available')
    return
  }
  if (argv[0] === 'update' || argv[0] === 'upgrade') return update()
  // commander 先认参数：不认的、值不对的直接报，和真的一样
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const flag = a.split('=')[0]
    if ((state.unknown ?? []).includes(flag)) return fail(`error: unknown option '${flag}'`)
    if (flag === '--permission-mode' && !MODES.includes(argv[i + 1])) return fail(`error: option '--permission-mode <mode>' argument '${argv[i + 1]}' is invalid. Allowed choices are ${MODES.join(', ')}.`)
  }
  const flagOf = (n) => {
    const i = argv.indexOf(n)
    return i === -1 ? undefined : argv[i + 1]
  }
  const effort = flagOf('--effort')
  if (effort && !LEVELS.includes(effort)) process.stderr.write(`Warning: Unknown --effort value '${effort}' — ignoring it and using the default effort. Valid values: ${LEVELS.join(', ')}.\n`)
  const model = flagOf('--model') ?? 'default'
  const session = flagOf('--resume') ?? `fake-${process.pid}`
  const answer = (prompt) => {
    if (state.silent) return
    out({ type: 'system', subtype: 'init', session_id: session, model })
    const text = /只回一个字/.test(`${flagOf('--system-prompt') ?? ''}${prompt}`) ? '好' : `这是假 Claude Code ${version} 的回答（模型 ${model}，effort ${effort ?? '没给'}）。`
    if (state.noStream) out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text }] } })
    else {
      out({ type: 'stream_event', session_id: session, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
      for (const part of text.match(/.{1,6}/gsu) ?? []) out({ type: 'stream_event', session_id: session, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } } })
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session })
  }
  if (flagOf('--input-format') === 'stream-json') {
    // 控制请求 initialize：报有哪些模型（不调模型）；一条用户消息：答一次
    const rl = createInterface({ input: process.stdin })
    rl.on('line', (line) => {
      if (!line.trim()) return
      const m = JSON.parse(line)
      if (m.type === 'control_request' && m.request?.subtype === 'initialize')
        out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { models: state.models ?? CLAUDE_MODELS, claude_code_version: version } } })
      else if (m.type === 'user') {
        const c = m.message?.content
        answer(typeof c === 'string' ? c : (c ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''))
        rl.close()
        process.stdin.destroy()
      }
    })
    return
  }
  let prompt = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => (prompt += d))
  process.stdin.on('end', () => {
    if (!prompt.trim()) return fail('Error: Input must be provided either through stdin or as a prompt argument when using --print')
    if (flagOf('--resume') === 'gone') return fail(`No conversation found with session ID: gone`)
    answer(prompt)
  })
}

// ---------------------------------------------------------------- codex
const CODEX_METHODS = {
  ClientRequest: ['initialize', 'thread/start', 'thread/resume', 'thread/fork', 'turn/start', 'turn/interrupt', 'model/list'],
  ServerNotification: ['item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed', 'error'],
  ServerRequest: ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'mcpServer/elicitation/request', 'execCommandApproval', 'applyPatchApproval'],
  ClientNotification: ['initialized'],
}
const CODEX_PARAMS = {
  ThreadStartParams: ['cwd', 'sandbox', 'approvalPolicy', 'config', 'developerInstructions', 'model'],
  ThreadResumeParams: ['threadId', 'cwd', 'sandbox', 'approvalPolicy', 'config', 'developerInstructions'],
  ThreadForkParams: ['threadId', 'cwd', 'sandbox', 'approvalPolicy', 'config', 'developerInstructions'],
  TurnStartParams: ['threadId', 'input', 'model', 'effort'],
  ModelListParams: ['cursor', 'includeHidden'],
}
const CODEX_FEATURES = ['shell_tool', 'apps', 'browser_use', 'in_app_browser', 'computer_use', 'multi_agent']

function schema(outDir) {
  const missing = new Set(state.missing ?? [])
  mkdirSync(join(outDir, 'v2'), { recursive: true })
  for (const [f, methods] of Object.entries(CODEX_METHODS))
    writeFileSync(join(outDir, `${f}.json`), JSON.stringify({ oneOf: methods.filter((m) => !missing.has(m)).map((m) => ({ type: 'object', properties: { method: { type: 'string', enum: [m] } } })) }))
  for (const [f, props] of Object.entries(CODEX_PARAMS)) writeFileSync(join(outDir, 'v2', `${f}.json`), JSON.stringify({ type: 'object', properties: Object.fromEntries(props.filter((p) => !missing.has(`${f}.${p}`)).map((p) => [p, {}])) }))
  writeFileSync(join(outDir, 'codex_app_server_protocol.v2.schemas.json'), JSON.stringify({ definitions: { SandboxMode: { enum: ['read-only', 'workspace-write', 'danger-full-access'] }, AskForApproval: { enum: ['untrusted', 'on-request', 'never'] } } }))
}

async function codex() {
  if (argv[0] === '--version' || argv[0] === '-V') return say(`codex-cli ${version}`)
  if (argv[0] === '--help' || argv[0] === '-h') return say('Codex CLI\n\nCommands:\n  app-server   [experimental] Run the app server\n  update       Update Codex to the latest version\n  features     Inspect feature flags')
  if (argv[0] === 'update') return update()
  if (argv[0] === 'features' && argv[1] === 'list') {
    for (const f of CODEX_FEATURES) if (!(state.missing ?? []).includes(`features.${f}`)) say(`${f.padEnd(40)} stable             true`)
    return
  }
  if (argv[0] !== 'app-server') return fail(`error: unrecognized subcommand '${argv[0]}'`, 2)
  if (argv[1] === '--help') return say('Usage: codex app-server [OPTIONS] [COMMAND]\n\nOptions:\n  -c, --config <key=value>\n          Override a configuration value')
  if (argv[1] === 'generate-json-schema') {
    const i = argv.indexOf('--out')
    return schema(argv[i + 1])
  }
  // 真跑一轮：交给原来那个假 app-server（模型列表从状态文件里拿）
  await import('./fake-codex.mjs')
}

// ---------------------------------------------------------------- gemini、opencode（ACP）
async function gemini() {
  if (argv[0] === '--version' || argv[0] === '-v') return say(version)
  if (argv[0] === '--help' || argv[0] === '-h') {
    const unknown = new Set(state.unknown ?? [])
    for (const f of ['-m, --model', '--approval-mode  [choices: "default", "auto_edit", "yolo", "plan"]', '--policy', '--acp', '--allowed-mcp-server-names']) if (!f.split(/[ ,]+/).some((x) => unknown.has(x))) say(`  ${f}`)
    return
  }
  if (argv.includes('--acp')) return import('./fake-acp.mjs')
  return fail('不认这个用法')
}

async function opencode() {
  if (argv[0] === '--version' || argv[0] === '-v') return say(version)
  if (argv[0] === 'upgrade') return update()
  if (argv[0] === 'acp' && argv[1] === '--help') return say('opencode acp\n\nOptions:\n  --cwd  working directory')
  if (argv[0] === '--help' || argv[0] === '-h') return say('Commands:\n  opencode acp      start ACP (Agent Client Protocol) server\n  opencode models   list all available models\n  opencode upgrade  upgrade opencode')
  if (argv[0] === 'models') {
    for (const m of state.models ?? [{ id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', variants: {} }]) {
      say(`${m.providerID}/${m.id}`)
      if (argv.includes('--verbose')) say(JSON.stringify(m, null, 2))
    }
    return
  }
  if (argv[0] === 'acp') return import('./fake-acp.mjs')
  return fail('不认这个用法')
}

const run = { claude, codex, gemini, opencode }[name]
if (run) await run()
else fail(`不认识的命令行 ${name}`)
