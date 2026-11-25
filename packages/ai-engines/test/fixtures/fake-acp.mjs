// 假的 ACP 程序（像 gemini --acp / opencode acp）：测引擎接法用，不联网
// FAKE_ACP_MODELS=config：session/new 回 configOptions（模型、effort，像 OpenCode），session/set_config_option 换；
// FAKE_ACP_MODELS=models：回 models（像 Gemini），session/set_model 换。回答末尾写这个会话现在的模型和 effort
// FAKE_ACP_GATE=<样本.json>（gate/opencode-1.19.3.json 真 opencode 录的、gate/gemini-0.64.0.json 照 gemini 源码写的）：这一问照样本一步一步做；
// 要不要先问照起进程时的设置（gemini 的 --approval-mode，opencode 的 OPENCODE_CONFIG_CONTENT 的 permission）：要问的先发样本里那条
// session/request_permission（$CWD 换成会话的 cwd、$OUT 换成 FAKE_GATE_OUT），批了才真做（在那个目录里跑命令、照 diff 写文件），
// 不问的直接做，拒的不做。回答写每一步做没做
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

let id = 1000
const waiting = new Map()
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
const ask = (method, params) =>
  new Promise((resolve) => {
    const i = ++id
    waiting.set(i, resolve)
    send({ id: i, method, params })
  })
const chunk = (sessionId, text) => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } })
const options = [
  { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
  { optionId: 'a2', name: 'Always', kind: 'allow_always' },
  { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
]
let mcp = []
let sessions = 0
/** 每个会话开的时候给的 cwd */
const cwds = new Map()
const MODELS = process.env.FAKE_ACP_MODELS
/** 每个会话现在的模型、effort */
const current = new Map()
const MODEL_LIST = [
  { value: 'zai/glm-5', name: 'Z.AI/GLM-5', efforts: ['low', 'high'] },
  { value: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle', efforts: [] },
]
const configOptions = (sid) => {
  const c = current.get(sid)
  const model = MODEL_LIST.find((m) => m.value === c.model)
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: c.model, options: MODEL_LIST.map((m) => ({ value: m.value, name: m.name })) },
    ...(model?.efforts.length ? [{ id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: c.effort ?? model.efforts[0], options: model.efforts.map((e) => ({ value: e, name: e })) }] : []),
  ]
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.id !== undefined && !m.method) return waiting.get(m.id)?.(m.result)
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: Number(process.env.FAKE_ACP_PROTOCOL ?? 1), agentCapabilities: { mcpCapabilities: { http: process.env.FAKE_ACP_NO_HTTP ? false : true }, promptCapabilities: { image: true } } } })
  if (m.method === 'session/new') {
    mcp = m.params.mcpServers
    if (process.env.FAKE_ACP_NO_LOGIN) return send({ id: m.id, error: { code: -32000, message: 'Gemini API key is missing or not configured.' } })
    const sessionId = `s${++sessions}`
    cwds.set(sessionId, m.params.cwd)
    current.set(sessionId, { model: MODELS === 'models' ? 'auto' : 'zai/glm-5' })
    if (MODELS === 'config') return send({ id: m.id, result: { sessionId, configOptions: configOptions(sessionId) } })
    if (MODELS === 'models')
      return send({ id: m.id, result: { sessionId, models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }, { modelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' }, { modelId: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' }] } } })
    return send({ id: m.id, result: { sessionId } })
  }
  if (m.method === 'session/set_config_option') {
    const c = current.get(m.params.sessionId)
    if (m.params.configId === 'model') {
      if (!MODEL_LIST.some((x) => x.value === m.params.value)) return send({ id: m.id, error: { code: -32602, message: `Invalid params: model not found: ${m.params.value}` } })
      current.set(m.params.sessionId, { model: m.params.value })
    } else if (m.params.configId === 'effort') {
      if (!configOptions(m.params.sessionId).some((o) => o.id === 'effort' && o.options.some((x) => x.value === m.params.value))) return send({ id: m.id, error: { code: -32602, message: `Invalid params: effort not found: ${m.params.value}` } })
      current.set(m.params.sessionId, { ...c, effort: m.params.value })
    }
    return send({ id: m.id, result: { configOptions: configOptions(m.params.sessionId) } })
  }
  if (m.method === 'session/set_model') {
    current.set(m.params.sessionId, { model: m.params.modelId })
    return send({ id: m.id, result: {} })
  }
  if (m.method === 'session/prompt') {
    const sid = m.params.sessionId
    const prompt = m.params.prompt[0].text
    if (process.env.FAKE_ACP_GATE) {
      chunk(sid, await gate(sid))
      return send({ id: m.id, result: { stopReason: 'end_turn' } })
    }
    const ours = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 't1', title: 'board_add_card (canvas MCP Server)' }, options })
    const theirs = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 't2', title: 'WriteFile 笔记.md', kind: 'edit' }, options })
    // 全能模式的步骤（FAKE_ACP_STEPS=1）：跑命令（做完）、读文件（失败）、调我们的 MCP（不该报成步骤）
    if (process.env.FAKE_ACP_STEPS) {
      const up = (update) => send({ method: 'session/update', params: { sessionId: sid, update } })
      up({ sessionUpdate: 'tool_call', toolCallId: 'x1', title: 'ls -1 /Users', kind: 'execute', status: 'pending', rawInput: { command: 'ls -1 /Users' } })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'x1', status: 'completed' })
      up({ sessionUpdate: 'tool_call', toolCallId: 'x2', title: 'ReadFile', kind: 'read', status: 'in_progress', locations: [{ path: '/etc/hosts' }] })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'x2', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: '读不了' } }] })
      up({ sessionUpdate: 'tool_call', toolCallId: 'x3', title: 'notes_list (canvas MCP Server)', kind: 'other', status: 'pending' })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'x3', status: 'completed' })
    }
    chunk(sid, `会话 ${sid}；`)
    chunk(sid, `MCP ${mcp.map((s) => `${s.type}:${s.name}:${s.headers[0].value.startsWith('Bearer ') ? '有令牌' : '没令牌'}`).join(',')}；`)
    chunk(sid, `我们的工具 ${ours.outcome.optionId}；它自己写文件 ${theirs.outcome.optionId}；`)
    chunk(sid, `开头是系统提示 ${prompt.startsWith('系统') ? '是' : '否'}`)
    if (process.env.FAKE_ACP_ARGS) chunk(sid, `；参数 ${process.argv.slice(2).join(' ')}；设置 ${process.env.OPENCODE_CONFIG_CONTENT ?? '没给'}`)
    const imgs = m.params.prompt.filter((b) => b.type === 'image')
    if (imgs.length) chunk(sid, `；图 ${imgs.map((b) => `${b.mimeType}:${b.data}`).join(',')}`)
    if (process.env.FAKE_ACP_ECHO) chunk(sid, `；话 ${prompt.replace(/\n/g, '/')}`)
    // 现在那一档：和 configOptions 里报的一样（换了模型没选档时是这个模型的第一档；这个模型没有档就没给）
    if (MODELS) chunk(sid, `；模型 ${current.get(sid).model}；effort ${MODELS === 'config' ? (configOptions(sid).find((o) => o.id === 'effort')?.currentValue ?? '没给') : '没给'}`)
    return send({ id: m.id, result: { stopReason: 'end_turn' } })
  }
})

/** 这一步按起进程时的设置是问、直接做还是不做（gemini 看 --approval-mode，opencode 看 permission，后写的赢） */
function policy(kind) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--approval-mode')
  if (i >= 0) return argv[i + 1] === 'yolo' ? 'allow' : 'ask'
  const perm = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? '{}').permission ?? {}
  const key = { execute: 'bash', edit: 'edit', fetch: 'webfetch' }[kind] ?? kind
  return perm[key] ?? perm['*'] ?? 'allow'
}

/** 照录下来的样本一步一步做（见文件头） */
async function gate(sid) {
  const cwd = cwds.get(sid)
  const text = readFileSync(process.env.FAKE_ACP_GATE, 'utf8').split('$CWD').join(cwd).split('$OUT').join(process.env.FAKE_GATE_OUT ?? '/nonexistent')
  const done = []
  for (const s of JSON.parse(text)) {
    const call = s.request.params.toolCall
    const up = (update) => send({ method: 'session/update', params: { sessionId: sid, update } })
    up({ sessionUpdate: 'tool_call', toolCallId: call.toolCallId, title: call.kind === 'execute' && s.known ? 'bash' : call.title, kind: call.kind, status: 'pending', locations: [], rawInput: {} })
    if (s.known) up(s.known)
    const how = policy(call.kind)
    let ok = how === 'allow'
    if (how === 'ask') {
      const r = await ask('session/request_permission', { ...s.request.params, sessionId: sid })
      ok = r.outcome.outcome === 'selected' && s.request.params.options.find((o) => o.optionId === r.outcome.optionId)?.kind.startsWith('allow')
    }
    const said = (call.content ?? []).map((c) => c.content?.text ?? '').join('\n')
    const command = call.kind === 'execute' ? (call.rawInput?.command ?? call.title) : null
    if (ok && command) {
      const dir = s.known?.rawInput?.cwd ?? /\[in ([^\]]+)\]/.exec(said)?.[1] ?? cwd
      try {
        execFileSync('/bin/sh', ['-c', command], { cwd: dir, stdio: 'ignore' })
      } catch {
        // 命令自己失败（推不上）：照样算做了
      }
    }
    const diff = (call.content ?? []).find((c) => c.type === 'diff')
    if (ok && call.kind === 'edit' && diff) writeFileSync(diff.path, diff.newText)
    up({ sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: ok ? 'completed' : 'failed' })
    done.push(`${command ?? `${call.kind} ${diff ? basename(diff.path) : ''}`.trim()} ${ok ? '做了' : '没做'}`)
  }
  return done.join('；')
}
