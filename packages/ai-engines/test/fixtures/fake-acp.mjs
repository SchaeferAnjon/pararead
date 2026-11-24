// 假的 ACP 程序（像 gemini --acp / opencode acp）：测引擎接法用，不联网
// FAKE_ACP_MODELS=config：session/new 回 configOptions（模型、effort，像 OpenCode），session/set_config_option 换；
// FAKE_ACP_MODELS=models：回 models（像 Gemini），session/set_model 换。回答末尾写这个会话现在的模型和 effort
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
