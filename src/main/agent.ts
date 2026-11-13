// 研究 Agent 工作区：一个项目就是磁盘上的一个文件夹（默认 文稿/ParaRead 项目/<名字>），项目设置和会话在里面的 .scholar/。
// Agent 用工具调用一步一步做事：看文件、读写文件、跑命令（每次先问用户，可以本次会话都允许）、查文献库、读论文、全网检索、读网页、把论文加进库、向用户提问。
// 每一步发 agent:event 给界面；要用户拍板的发 agent:ask，等 agent:answer 回来。
import { ipcMain, shell, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Ctx } from './ctx'
import { getPaper, listPapers } from './db'
import type { ChatMsg, ToolCall, ToolDef } from './glm'
import { newId } from './library'
import { getText, searchWeb } from './meta'
import { t } from '../shared/i18n'
import { killTree, SHELL_NAME, shellOf } from './platform'

export interface Project {
  id: string
  name: string
  dir: string
  createdAt: number
  instructions: string // 项目说明，每次都给 Agent
}

export interface AgentSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AgentStep[]
}

// 界面显示的一步：用户的话、Agent 的话、调用了什么工具和结果
export type AgentStep =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | { kind: 'tool'; callId: string; name: string; args: Record<string, unknown>; result?: string; error?: string; denied?: boolean; at: number }

const MAX_STEPS = 30
const READ_LIMIT = 40_000

export const TOOLS: ToolDef[] = [
  fn('list_files', '列出项目文件夹里的文件和子文件夹（最多两层）', { path: { type: 'string', description: '相对项目根目录的路径，默认 .' } }),
  fn('read_file', '读项目里的一个文本文件（代码、Markdown、CSV、JSON 等）', { path: { type: 'string' } }, ['path']),
  fn('write_file', '在项目里新建或覆盖一个文本文件', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  fn('run_command', `在项目文件夹里跑一条 ${SHELL_NAME} 命令（比如 python3 analyze.py），最长 2 分钟。会先问用户同意`, { command: { type: 'string' } }, ['command']),
  fn('search_library', '在用户的文献库里按关键词找论文，返回编号、标题、年份、摘要开头', { query: { type: 'string' } }, ['query']),
  fn('read_paper', '读文献库里一篇论文的全文（重排后的 Markdown）。长论文分段读：offset 是从第几个字开始，每次最多 4 万字', { paper_id: { type: 'string' }, offset: { type: 'number' } }, ['paper_id']),
  fn('search_web', '在全网学术数据库（OpenAlex）检索论文，返回标题、年份、期刊、被引数、摘要、有没有开放获取 PDF', { query: { type: 'string' }, year_from: { type: 'number' } }, ['query']),
  fn('fetch_url', '读一个网页的文字（去掉 HTML），最多 2 万字', { url: { type: 'string' } }, ['url']),
  fn('add_to_library', '把一篇论文加进用户的文献库（arXiv 号、DOI 或 PDF 链接）', { id: { type: 'string', description: 'arXiv 号、DOI 或网址' } }, ['id']),
  fn('ask_user', '有拿不准、需要用户决定的事时问用户一句，等他回答', { question: { type: 'string' } }, ['question'])
]

function fn(name: string, description: string, props: Record<string, unknown>, required: string[] = []): ToolDef {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties: props, required } } }
}

export function registerAgent(c: Ctx, importUrl: (input: string) => Promise<{ status: string; paper?: { id: string; title: string }; error?: string }>): void {
  const root = (): string => c.settings.get().agentDir || join(homedir(), 'Documents', 'ParaRead 项目')
  const meta = (dir: string): string => join(dir, '.scholar')

  const listProjects = (): Project[] => {
    const r = root()
    if (!existsSync(r)) return []
    const out: Project[] = []
    for (const name of readdirSync(r)) {
      const f = join(r, name, '.scholar', 'project.json')
      if (!existsSync(f)) continue
      const p = JSON.parse(readFileSync(f, 'utf8')) as Omit<Project, 'dir' | 'name'>
      out.push({ ...p, name, dir: join(r, name) })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }
  const project = (id: string): Project => {
    const p = listProjects().find((x) => x.id === id)
    if (!p) throw new Error(t('项目不存在'))
    return p
  }
  const saveProject = (p: Project): void => {
    mkdirSync(meta(p.dir), { recursive: true })
    writeFileSync(join(meta(p.dir), 'project.json'), JSON.stringify({ id: p.id, createdAt: p.createdAt, instructions: p.instructions }, null, 2))
  }
  const sessionFile = (p: Project, sid: string): string => join(meta(p.dir), 'sessions', `${sid}.json`)
  const loadSession = (p: Project, sid: string): AgentSession & { history: ChatMsg[] } => JSON.parse(readFileSync(sessionFile(p, sid), 'utf8'))
  const saveSession = (p: Project, s: AgentSession & { history: ChatMsg[] }): void => {
    mkdirSync(join(meta(p.dir), 'sessions'), { recursive: true })
    s.updatedAt = Date.now()
    writeFileSync(sessionFile(p, s.id), JSON.stringify(s))
  }

  // 路径只能在项目里
  const inside = (p: Project, rel: string): string => {
    const abs = resolve(p.dir, rel || '.')
    if (abs !== p.dir && !abs.startsWith(p.dir + sep)) throw new Error(t('只能访问项目文件夹里的文件'))
    if (relative(p.dir, abs).split(sep)[0] === '.scholar') throw new Error(t('.scholar 是项目自己的设置，不能动'))
    return abs
  }

  ipcMain.handle('agent:projects', () => listProjects())
  ipcMain.handle('agent:createProject', (_e, name: string) => {
    const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || '新项目'
    let dir = join(root(), clean)
    for (let i = 2; existsSync(dir); i++) dir = join(root(), `${clean} ${i}`)
    mkdirSync(dir, { recursive: true })
    const p: Project = { id: newId(), name: dir.split(sep).pop()!, dir, createdAt: Date.now(), instructions: '' }
    saveProject(p)
    writeFileSync(join(dir, 'README.md'), `# ${p.name}\n\n这个文件夹是 ParaRead 的研究项目。草稿、数据、代码、Agent 写的结果都放在这里。\n`)
    return p
  })
  ipcMain.handle('agent:renameProject', (_e, id: string, name: string) => {
    const p = project(id)
    const dest = join(dirname(p.dir), name.replace(/[\\/:*?"<>|]+/g, ' ').trim())
    if (existsSync(dest)) throw new Error(t('已有同名项目'))
    renameSync(p.dir, dest)
  })
  ipcMain.handle('agent:deleteProject', async (_e, id: string) => {
    await shell.trashItem(project(id).dir)
  })
  ipcMain.handle('agent:setInstructions', (_e, id: string, text: string) => {
    const p = project(id)
    saveProject({ ...p, instructions: text })
  })
  ipcMain.handle('agent:files', (_e, id: string) => {
    const p = project(id)
    const walk = (d: string, depth: number): { path: string; dir: boolean; size: number; mtime: number }[] =>
      readdirSync(d)
        .filter((n) => !n.startsWith('.'))
        .flatMap((n) => {
          const f = join(d, n)
          const st = statSync(f)
          const me = { path: relative(p.dir, f), dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs }
          return st.isDirectory() && depth < 4 ? [me, ...walk(f, depth + 1)] : [me]
        })
    return walk(p.dir, 0)
  })
  ipcMain.handle('agent:readFile', (_e, id: string, rel: string) => {
    const f = inside(project(id), rel)
    const st = statSync(f)
    if (st.size > 5_000_000) throw new Error(t('文件太大，用别的程序打开'))
    return readFileSync(f, 'utf8')
  })
  ipcMain.handle('agent:reveal', (_e, id: string, rel?: string) => shell.showItemInFolder(rel ? inside(project(id), rel) : project(id).dir))
  ipcMain.handle('agent:openFile', (_e, id: string, rel: string) => shell.openPath(inside(project(id), rel)))
  ipcMain.handle('agent:sessions', (_e, id: string) => {
    const p = project(id)
    const d = join(meta(p.dir), 'sessions')
    if (!existsSync(d)) return []
    return readdirSync(d)
      .filter((n) => n.endsWith('.json'))
      .map((n) => {
        const s = JSON.parse(readFileSync(join(d, n), 'utf8')) as AgentSession
        return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, messages: s.messages }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })
  ipcMain.handle('agent:newSession', (_e, id: string) => {
    const p = project(id)
    const s = { id: newId(), title: t('新会话'), createdAt: Date.now(), updatedAt: Date.now(), messages: [], history: [] }
    saveSession(p, s)
    return s
  })
  ipcMain.handle('agent:deleteSession', (_e, id: string, sid: string) => rmSync(sessionFile(project(id), sid), { force: true }))

  // 运行中的会话：停止、权限、提问
  const running = new Map<string, { stop: boolean; allowCommands: boolean; waiters: Map<string, (v: string) => void> }>()

  ipcMain.handle('agent:stop', (_e, sid: string) => {
    const r = running.get(sid)
    if (!r) return
    r.stop = true
    for (const w of r.waiters.values()) w('deny')
  })
  ipcMain.handle('agent:answer', (_e, sid: string, callId: string, answer: string) => {
    const r = running.get(sid)
    const w = r?.waiters.get(callId)
    if (!w) return
    if (answer === 'always') r!.allowCommands = true
    r!.waiters.delete(callId)
    w(answer)
  })

  ipcMain.handle('agent:send', async (e, projectId: string, sid: string, text: string) => {
    const p = project(projectId)
    const s = loadSession(p, sid)
    if (running.has(sid)) throw new Error(t('这个会话还在做上一件事'))
    const wc = e.sender
    const emit = (ev: Record<string, unknown>): void => {
      if (!wc.isDestroyed()) wc.send('agent:event', { sessionId: sid, ...ev })
    }
    s.messages.push({ kind: 'user', text, at: Date.now() })
    if (s.title === t('新会话')) s.title = text.slice(0, 40)
    s.history.push({ role: 'user', content: text })
    saveSession(p, s)
    const state = { stop: false, allowCommands: false, waiters: new Map<string, (v: string) => void>() }
    running.set(sid, state)
    void loop(p, s, wc, emit, state).finally(() => {
      running.delete(sid)
      saveSession(p, s)
      emit({ type: 'done' })
    })
  })

  async function loop(p: Project, s: AgentSession & { history: ChatMsg[] }, wc: WebContents, emit: (ev: Record<string, unknown>) => void, state: { stop: boolean; allowCommands: boolean; waiters: Map<string, (v: string) => void> }): Promise<void> {
    const sys: ChatMsg = {
      role: 'system',
      content: [
        `你是研究助手 Agent，在用户的研究项目「${p.name}」里干活。项目文件夹就是你的工作区；用工具看文件、写文件、跑代码、查文献。`,
        `用${c.settings.get().aiLang || c.settings.get().targetLang}和用户说话，术语保留英文。先想清楚步骤，一步一步做；改文件前先读；写代码就写成项目里的文件再用 run_command 跑。`,
        '引用文献时写清标题和年份；不编造数字和文献。做完用几句话说结果和产出的文件。不用破折号。',
        p.instructions ? `\n项目说明（用户写的）：\n${p.instructions}` : ''
      ].join('\n')
    }
    for (let step = 0; step < MAX_STEPS && !state.stop; step++) {
      emit({ type: 'thinking' })
      let r
      try {
        r = await c.ai.tools([sys, ...s.history.slice(-60)], TOOLS, { timeoutMs: 240_000 })
      } catch (err) {
        emit({ type: 'error', error: (err as Error).message })
        s.messages.push({ kind: 'assistant', text: `出错了：${(err as Error).message}`, at: Date.now() })
        return
      }
      s.history.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.length ? r.toolCalls : undefined })
      if (r.content) {
        s.messages.push({ kind: 'assistant', text: r.content, at: Date.now() })
        emit({ type: 'text', text: r.content })
      }
      if (!r.toolCalls.length) return
      for (const call of r.toolCalls) {
        if (state.stop) {
          s.history.push({ role: 'tool', tool_call_id: call.id, content: '用户停止了' })
          continue
        }
        const stepRec: AgentStep & { kind: 'tool' } = { kind: 'tool', callId: call.id, name: call.function.name, args: safeArgs(call), at: Date.now() }
        s.messages.push(stepRec)
        emit({ type: 'tool', step: stepRec })
        let out: string
        try {
          out = await runTool(p, call, stepRec, wc, emit, state)
          stepRec.result = out.slice(0, 4000)
        } catch (err) {
          out = `错误：${(err as Error).message}`
          stepRec.error = (err as Error).message
        }
        emit({ type: 'tool', step: stepRec })
        s.history.push({ role: 'tool', tool_call_id: call.id, content: out.slice(0, READ_LIMIT) })
      }
      saveSession(p, s)
    }
    if (!state.stop) s.messages.push({ kind: 'assistant', text: `已经做了 ${MAX_STEPS} 步，先停在这里。要继续就再说一声。`, at: Date.now() })
  }

  const ask = (state: { waiters: Map<string, (v: string) => void> }, emit: (ev: Record<string, unknown>) => void, callId: string, payload: Record<string, unknown>): Promise<string> =>
    new Promise((res) => {
      state.waiters.set(callId, res)
      emit({ type: 'ask', callId, ...payload })
    })

  async function runTool(
    p: Project,
    call: ToolCall,
    rec: AgentStep & { kind: 'tool' },
    _wc: WebContents,
    emit: (ev: Record<string, unknown>) => void,
    state: { stop: boolean; allowCommands: boolean; waiters: Map<string, (v: string) => void> }
  ): Promise<string> {
    const a = rec.args as Record<string, string & number>
    switch (call.function.name) {
      case 'list_files': {
        const base = inside(p, a.path ?? '.')
        const lines: string[] = []
        const walk = (d: string, depth: number): void => {
          for (const n of readdirSync(d).filter((x) => !x.startsWith('.'))) {
            const f = join(d, n)
            const st = statSync(f)
            lines.push(`${'  '.repeat(depth)}${n}${st.isDirectory() ? '/' : `  (${st.size} 字节)`}`)
            if (st.isDirectory() && depth < 1) walk(f, depth + 1)
          }
        }
        walk(base, 0)
        return lines.join('\n') || '（空文件夹）'
      }
      case 'read_file': {
        const f = inside(p, a.path)
        const t_ = readFileSync(f, 'utf8')
        return t_.length > READ_LIMIT ? t_.slice(0, READ_LIMIT) + `\n…（文件共 ${t_.length} 字，只给了前 ${READ_LIMIT}）` : t_
      }
      case 'write_file': {
        const f = inside(p, a.path)
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, String(a.content ?? ''))
        emit({ type: 'files' })
        return `已写入 ${a.path}（${String(a.content ?? '').length} 字）`
      }
      case 'run_command': {
        if (!state.allowCommands) {
          const ans = await ask(state, emit, call.id, { tool: 'run_command', command: a.command })
          if (ans === 'deny') {
            rec.denied = true
            return '用户没有同意运行这条命令'
          }
        }
        const out = await runShell(String(a.command), p.dir, 120_000)
        emit({ type: 'files' })
        return out
      }
      case 'search_library': {
        const q = String(a.query).toLowerCase()
        const words = q.split(/\s+/).filter((w) => w.length > 1)
        const hits = listPapers(c.db)
          .filter((x) => x.kind !== 'link')
          .map((x) => ({ x, s: words.filter((w) => `${x.title} ${x.abstract ?? ''} ${x.authors.join(' ')}`.toLowerCase().includes(w)).length }))
          .filter((h) => h.s > 0)
          .sort((a2, b) => b.s - a2.s)
          .slice(0, 10)
        return hits.length ? hits.map(({ x }) => `paper_id=${x.id}\n《${x.title}》（${x.year ?? '?'}）\n${(x.abstract ?? '').slice(0, 300)}`).join('\n\n') : '文献库里没有匹配的论文'
      }
      case 'read_paper': {
        const paper = getPaper(c.db, String(a.paper_id))
        if (!paper) throw new Error(t('没有这篇论文'))
        const full = c.library.contextText(paper.id, Number.MAX_SAFE_INTEGER).text
        const from = Math.max(0, Number(a.offset) || 0)
        const part = full.slice(from, from + READ_LIMIT)
        const more = from + part.length < full.length
        return `《${paper.title}》全文共 ${full.length} 字，这次是第 ${from} 到 ${from + part.length} 字${more ? `，后面还有，接着读用 offset=${from + part.length}` : '，已到结尾'}\n\n${part}`
      }
      case 'search_web': {
        const r = await searchWeb(String(a.query), 10, { yearFrom: Number(a.year_from) || undefined })
        return r.hits.length
          ? r.hits.map((h, i) => `[${i + 1}] ${h.title}（${h.year ?? '?'}，${h.venue ?? ''}，被引 ${h.citations ?? '?'}）${h.doi ? ` DOI ${h.doi}` : ''}${h.arxiv ? ` arXiv ${h.arxiv}` : ''}${h.pdfUrl ? ' 有PDF' : ''}\n${(h.abstract ?? '').slice(0, 500)}`).join('\n\n')
          : `没有结果${r.error ? `：${r.error}` : ''}`
      }
      case 'fetch_url': {
        const html = await getText(String(a.url), 20_000)
        return html
          .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 20_000)
      }
      case 'add_to_library': {
        const r = await importUrl(String(a.id))
        c.broadcast('library:changed', null)
        if (r.status === 'added' || r.status === 'duplicate') return `已${r.status === 'added' ? '加入' : '在'}文献库：《${r.paper!.title}》 paper_id=${r.paper!.id}`
        return `没加进去：${r.error ?? '找不到能下载的 PDF'}`
      }
      case 'ask_user': {
        const ans = await ask(state, emit, call.id, { tool: 'ask_user', question: a.question })
        return ans === 'deny' ? '用户没有回答' : `用户回答：${ans}`
      }
      default:
        throw new Error(t('没有这个工具：{0}', call.function.name))
    }
  }
}

function safeArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
  } catch {
    return { raw: call.function.arguments }
  }
}

// 跑命令：Mac 上 zsh -lc，Windows 上 PowerShell；项目文件夹里，超时整组杀；输出截到 2 万字
export function runShell(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((res) => {
    const [sh, argv] = shellOf(command)
    const child = spawn(sh, argv, { cwd, detached: true, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
    let out = ''
    const add = (b: Buffer): void => {
      out += b.toString('utf8')
      if (out.length > 40_000) out = out.slice(0, 20_000) + '\n…\n' + out.slice(-20_000)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const t_ = setTimeout(() => {
      out += `\n超时：超过 ${timeoutMs / 1000} 秒，已停止`
      killTree(child)
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(t_)
      res(`启动失败：${e.message}`)
    })
    child.on('close', (code) => {
      clearTimeout(t_)
      res(`退出码 ${code}\n${out.trim() || '（没有输出）'}`)
    })
  })
}
