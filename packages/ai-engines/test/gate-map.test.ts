// 各家审批请求换成 Claude Code 叫法的那一步（gate-map.ts）：样本是真命令行录的（fixtures/gate：Codex 0.163.0、OpenCode 1.19.3 真跑录的，
// Gemini 0.64.0 没登录、照它的源码写的），$CWD 是库、$OUT 是库外
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type AcpCall, codexGate, geminiGate, inDir, opencodeGate, shellQuote, stripEnvPrefix, unwrapShell } from '../src/gate-map'

const ROOT = '/srv/someone/notes'
const OUT = '/srv/someone/elsewhere'
const samples = <T>(name: string): T[] => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'gate', name), 'utf8').split('$CWD').join(ROOT).split('$OUT').join(OUT)) as T[]

type CodexSample = { request: { method: string; params: Record<string, unknown> }; item: Record<string, unknown> | null }
type AcpSample = { request: { params: { toolCall: AcpCall } }; known: AcpCall | null }

describe('换成 stepDanger 认的那一步', () => {
  it('Codex：拆掉 /bin/zsh -lc 那层；改文件从 item/started 的 changes 里拿路径（新建 Write、改 Edit）', () => {
    const got = samples<CodexSample>('codex-0.163.0.json').map((s) => codexGate(s.request.method, s.request.params, s.item ?? undefined, ROOT))
    expect(got).toEqual([
      [{ tool: 'Bash', input: { command: 'ls -1' } }],
      [{ tool: 'Write', input: { file_path: `${ROOT}/note.md` } }],
      [{ tool: 'Edit', input: { file_path: `${ROOT}/a.txt` } }],
      [{ tool: 'Bash', input: { command: 'rm junk.txt' } }],
      [{ tool: 'Bash', input: { command: 'git push origin main' } }],
    ])
  })

  it('Codex：删文件写成 rm、改名写成 mv、一次改几个文件就几步；在库外跑的命令前面加 cd；老写法（execCommandApproval 数组、applyPatchApproval）也认', () => {
    const item = { changes: [{ path: `${ROOT}/a.md`, kind: { type: 'delete' } }, { path: `${ROOT}/b.md`, kind: { type: 'update', move_path: `${OUT}/b.md` } }] }
    expect(codexGate('item/fileChange/requestApproval', { itemId: 'x' }, item, ROOT)).toEqual([
      { tool: 'Bash', input: { command: `rm ${ROOT}/a.md` } },
      { tool: 'Bash', input: { command: `mv ${ROOT}/b.md ${OUT}/b.md` } },
    ])
    expect(codexGate('item/commandExecution/requestApproval', { command: "/bin/zsh -lc 'touch x'", cwd: OUT }, undefined, ROOT)).toEqual([{ tool: 'Bash', input: { command: `cd ${OUT} && touch x` } }])
    expect(codexGate('execCommandApproval', { command: ['/bin/zsh', '-lc', 'git push'], cwd: ROOT }, undefined, ROOT)).toEqual([{ tool: 'Bash', input: { command: 'git push' } }])
    expect(codexGate('execCommandApproval', { command: ['rm', 'a b.md'], cwd: ROOT }, undefined, ROOT)).toEqual([{ tool: 'Bash', input: { command: "rm 'a b.md'" } }])
    expect(codexGate('applyPatchApproval', { fileChanges: { [`${OUT}/x.md`]: { type: 'add', content: 'hi' } } }, undefined, ROOT)).toEqual([{ tool: 'Write', input: { file_path: `${OUT}/x.md` } }])
    // 看不到改哪些文件：按要写的目录问；什么都没给就是一个空路径（stepDanger 放行）
    expect(codexGate('item/fileChange/requestApproval', { grantRoot: OUT }, undefined, ROOT)).toEqual([{ tool: 'Edit', input: { file_path: OUT } }])
    expect(codexGate('item/fileChange/requestApproval', {}, undefined, ROOT)).toEqual([{ tool: 'Edit', input: { file_path: '' } }])
  })

  it('OpenCode：rawInput.command（git 前面那段 export 去掉）、cwd 从前面那条 tool_call_update 来；改文件 rawInput.filepath（diff 从 0 行起是新建）', () => {
    const got = samples<AcpSample>('opencode-1.19.3.json').map((s) => opencodeGate(s.request.params.toolCall, s.known ?? undefined, ROOT))
    expect(got).toEqual([
      { tool: 'Bash', input: { command: 'ls -1' } },
      { tool: 'Write', input: { file_path: `${ROOT}/note.md` } },
      { tool: 'Edit', input: { file_path: `${ROOT}/a.txt` } },
      { tool: 'Bash', input: { command: 'rm junk.txt' } },
      { tool: 'Bash', input: { command: 'git push origin main' } },
      { tool: 'Write', input: { file_path: `${OUT}/x.txt` } },
      { tool: 'Bash', input: { command: `cp a.txt ${OUT}/y.txt` } },
    ])
  })

  it('Gemini：跑命令的 title 是整行命令，「[in 目录]」在库外的前面加 cd；改文件的路径在 diff 里；读网页是 WebFetch', () => {
    const got = samples<AcpSample>('gemini-0.64.0.json').map((s) => geminiGate(s.request.params.toolCall, s.known ?? undefined, ROOT))
    expect(got).toEqual([
      { tool: 'Bash', input: { command: 'ls -1' } },
      { tool: 'Write', input: { file_path: `${ROOT}/note.md` } },
      { tool: 'Edit', input: { file_path: `${ROOT}/a.txt` } },
      { tool: 'Bash', input: { command: 'rm junk.txt' } },
      { tool: 'Bash', input: { command: 'git push origin main' } },
      { tool: 'Bash', input: { command: `cd ${OUT} && touch y.txt` } },
      { tool: 'WebFetch', input: { url: 'Fetching content from: https://example.com' } },
    ])
  })

  it('ACP 的删、挪写成 rm、mv', () => {
    expect(geminiGate({ kind: 'delete', locations: [{ path: `${ROOT}/a.md` }] }, undefined, ROOT)).toEqual({ tool: 'Bash', input: { command: `rm ${ROOT}/a.md` } })
    expect(opencodeGate({ kind: 'move', locations: [{ path: `${ROOT}/a.md` }, { path: `${OUT}/a.md` }] }, undefined, ROOT)).toEqual({ tool: 'Bash', input: { command: `mv ${ROOT}/a.md ${OUT}/a.md` } })
  })

  it('小工具：拆 shell 包装、去 export 前缀、库里不加 cd（/private/var 和 /var 算同一个）、引号', () => {
    expect(unwrapShell("/bin/zsh -lc 'rm '\\''a b'\\'''")).toBe("rm 'a b'")
    expect(unwrapShell('bash -c "git push"')).toBe('git push')
    expect(unwrapShell('ls -1')).toBe('ls -1')
    expect(stripEnvPrefix("export CI=true GIT_EDITOR=: VISUAL='' PAGER=cat; git push origin main")).toBe('git push origin main')
    expect(stripEnvPrefix('export FOO=1 && rm x')).toBe('export FOO=1 && rm x')
    expect(inDir('ls', '/private/var/folders/x/库', '/var/folders/x/库')).toBe('ls')
    expect(inDir('ls', '子目录', ROOT)).toBe(`cd '${ROOT}/子目录' && ls`)
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})
