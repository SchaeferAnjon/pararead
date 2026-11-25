// 假的 codex app-server：测引擎接法用，不联网。消息不带 "jsonrpc"，和真的一样
// 给了 FAKE_CLI_STATE（fake-cli.mjs 演整个 codex 时）：model/list 照 <目录>/codex.json 的 models 给，每问一次重新读（测试中途换列表）
// 给了 FAKE_CODEX_GATE=<样本.json>（gate/codex-0.163.0.json，真 codex 录的）：这一问照样本一步一步做；批准方式是 untrusted 时每一步先发
// 样本里那条审批请求（$CWD 换成线程的 cwd、$OUT 换成 FAKE_GATE_OUT），批了才真做（在 cwd 里跑那行命令、照 diff 写文件），没批的报 declined；
// never 时不问、直接做（和真的一样）。回答写每一步做没做
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'

let id = 1000
const waiting = new Map()
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const ask = (method, params) =>
  new Promise((resolve) => {
    const i = ++id
    waiting.set(i, resolve)
    send({ id: i, method, params })
  })
const args = process.argv.slice(2)
let threads = 0
let instructions = ''
/** 线程开的时候（thread/start、thread/resume、thread/fork）给的沙箱、批准方式、配置 */
let opened = {}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.jsonrpc) return send({ id: m.id, error: { code: -1, message: '不该带 jsonrpc' } })
  if (m.id !== undefined && !m.method) return waiting.get(m.id)?.(m.result)
  if (m.method === 'initialize') return send({ id: m.id, result: { userAgent: 'fake' } })
  if (m.method === 'initialized') return
  // 模型列表分两页给；默认的那个在第二页（CN-91）
  if (m.method === 'model/list') {
    const effort = (e) => ({ reasoningEffort: e, description: `${e} effort` })
    if (process.env.FAKE_CLI_STATE) {
      const listed = JSON.parse(readFileSync(join(process.env.FAKE_CLI_STATE, 'codex.json'), 'utf8')).models ?? []
      return send({ id: m.id, result: { data: listed.map((x) => ({ hidden: false, ...x, supportedReasoningEfforts: (x.efforts ?? ['low', 'medium', 'high']).map(effort) })), nextCursor: null } })
    }
    const luna = { id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'GPT-6-Luna', hidden: false, isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'].map(effort) }
    const hidden = { ...luna, id: 'old', model: 'old', displayName: 'Old', hidden: true }
    const terra = { id: 'gpt-6.1-terra', model: 'gpt-6.1-terra', displayName: 'GPT-6.1 Terra', hidden: false, isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'high', 'xhigh', 'ultra'].map(effort) }
    if (!m.params.cursor) return send({ id: m.id, result: { data: [luna, hidden], nextCursor: 'p2' } })
    return send({ id: m.id, result: { data: [terra], nextCursor: null } })
  }
  if (m.method === 'thread/start') {
    instructions = m.params.developerInstructions
    opened = { sandbox: m.params.sandbox, approval: m.params.approvalPolicy, config: m.params.config, cwd: m.params.cwd }
    return send({ id: m.id, result: { thread: { id: `th${++threads}` }, sandbox: m.params.sandbox } })
  }
  // 接着用一个线程（进程换过、线程不在手上时）：照样记下这次给的沙箱
  if (m.method === 'thread/resume') {
    instructions = m.params.developerInstructions
    opened = { sandbox: m.params.sandbox, approval: m.params.approvalPolicy, config: m.params.config, cwd: m.params.cwd }
    return send({ id: m.id, result: { thread: { id: m.params.threadId } } })
  }
  // 旁支：从一个线程整段分叉出新线程（找不到的线程报错）
  if (m.method === 'thread/fork') {
    if (m.params.threadId === 'gone') return send({ id: m.id, error: { code: -32600, message: `thread not found: ${m.params.threadId}` } })
    instructions = m.params.developerInstructions
    opened = { sandbox: m.params.sandbox, approval: m.params.approvalPolicy, config: m.params.config }
    return send({ id: m.id, result: { thread: { id: `${m.params.threadId}-fork` }, sandbox: m.params.sandbox } })
  }
  if (m.method === 'turn/start') {
    const threadId = m.params.threadId
    // turn/start 上带的批准方式管这一问和后面几问（和真的一样）
    if (m.params.approvalPolicy) opened.approval = m.params.approvalPolicy
    send({ id: m.id, result: { turn: { id: 'u1' } } })
    const delta = (d) => send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'u1', itemId: 'i1', delta: d } })
    if (process.env.FAKE_CODEX_GATE) {
      const said = await gate(threadId)
      delta(said)
      return send({ method: 'turn/completed', params: { threadId, turn: { id: 'u1', status: 'completed' } } })
    }
    const mcp = await ask('mcpServer/elicitation/request', { threadId, turnId: 'u1', serverName: 'canvas', mode: 'form', message: '可以调吗', requestedSchema: {} })
    const patch = await ask('item/fileChange/requestApproval', { threadId, turnId: 'u1', itemId: 'p1' })
    const cmd = await ask('item/commandExecution/requestApproval', { threadId, turnId: 'u1', itemId: 'c1' })
    // 全能模式的步骤（FAKE_CODEX_STEPS=1）：跑命令（做完）、改文件（失败）、上网搜、调我们的 MCP（不该报成步骤）
    if (process.env.FAKE_CODEX_STEPS) {
      const item = (method, it) => send({ method, params: { threadId, turnId: 'u1', item: it } })
      item('item/started', { type: 'commandExecution', id: 'c1', command: 'ls -1 /Users', status: 'inProgress' })
      item('item/completed', { type: 'commandExecution', id: 'c1', command: 'ls -1 /Users', status: 'completed', exitCode: 0 })
      item('item/started', { type: 'fileChange', id: 'f1', changes: [{ path: '/tmp/x.md', kind: { type: 'add' }, diff: '' }], status: 'inProgress' })
      item('item/completed', { type: 'fileChange', id: 'f1', changes: [{ path: '/tmp/x.md', kind: { type: 'add' }, diff: '' }], status: 'failed' })
      item('item/started', { type: 'webSearch', id: 'w1', query: '天气' })
      item('item/completed', { type: 'webSearch', id: 'w1', query: '天气' })
      item('item/started', { type: 'mcpToolCall', id: 'm1', server: 'canvas', tool: 'notes_list', status: 'inProgress' })
      item('item/completed', { type: 'mcpToolCall', id: 'm1', server: 'canvas', tool: 'notes_list', status: 'completed' })
    }
    delta(`线程 ${threadId}；`)
    delta(`配置 ${args.filter((a) => a.startsWith('mcp_servers')).join(' ')}；`)
    delta(`令牌 ${process.env.CN_MCP_TOKEN ? '在环境变量里' : '没有'}；`)
    delta(`我们的工具 ${mcp.action}；它自己改文件 ${patch.decision}；它自己跑命令 ${cmd.decision}；`)
    delta(`沙箱 ${opened.sandbox}；批准 ${opened.approval}；上网搜 ${opened.config?.web_search ?? '没给'}；`)
    delta(`关掉的 ${args.filter((a) => /^features\.|^web_search=/.test(a)).join(',') || '没有'}；`)
    delta(`系统提示 ${instructions}`)
    const imgs = m.params.input.filter((i) => i.type === 'localImage')
    if (imgs.length) delta(`；图 ${imgs.map((i) => i.path).join(',')}`)
    if (m.params.model || m.params.effort) delta(`；模型 ${m.params.model ?? '没给'}；effort ${m.params.effort ?? '没给'}`)
    if (process.env.FAKE_CODEX_ECHO) delta(`；话 ${m.params.input[0].text.replace(/\n/g, '/')}`)
    // 别的线程的字不该混进来
    send({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'x', itemId: 'x', delta: '串了' } })
    send({ method: 'turn/completed', params: { threadId, turn: { id: 'u1', status: 'completed' } } })
  }
})

/** 照录下来的样本一步一步做（见文件头） */
async function gate(threadId) {
  const cwd = opened.cwd
  const text = readFileSync(process.env.FAKE_CODEX_GATE, 'utf8').split('$CWD').join(cwd).split('$OUT').join(process.env.FAKE_GATE_OUT ?? '/nonexistent')
  const done = []
  for (const s of JSON.parse(text)) {
    const item = (method, it) => send({ method, params: { threadId, turnId: 'u1', item: it } })
    if (s.item) item('item/started', s.item)
    let ok = true
    if (opened.approval === 'untrusted') {
      const r = await ask(s.request.method, { ...s.request.params, threadId, turnId: 'u1' })
      ok = r.decision === 'accept'
    }
    const cmd = s.request.method === 'item/commandExecution/requestApproval' ? (/-lc '(.*)'$/s.exec(s.request.params.command)?.[1] ?? s.request.params.command) : null
    if (ok && cmd) {
      try {
        execFileSync('/bin/sh', ['-c', cmd], { cwd, stdio: 'ignore' })
      } catch {
        // 命令自己失败（推不上）：照样算做了
      }
    }
    if (ok && !cmd)
      for (const c of s.item?.changes ?? []) {
        if (c.kind.type === 'delete') rmSync(c.path, { force: true })
        else writeFileSync(c.path, c.kind.type === 'add' ? c.diff : c.diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1) + '\n').join(''))
      }
    if (s.item) item('item/completed', { ...s.item, status: ok ? 'completed' : 'declined' })
    done.push(`${cmd ?? `改 ${(s.item?.changes ?? []).map((c) => basename(c.path)).join(',')}`} ${ok ? '做了' : '没做'}`)
  }
  return `批准 ${opened.approval}；${done.join('；')}`
}
