/**
 * 跑一次命令行、等它跑完（task-m55m7：拉模型、自查、更新都用）：给一段标准输入、限时，超时整个杀掉，标准输出和错误都收回来。
 * 子进程的环境用 cliEnv（PATH 补全，和真问 AI 时一样）。
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { cliEnv } from './cli'

export interface ProcResult {
  /** 退出码；被杀、起不来是 null */
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** 起不来（ENOENT、没权限） */
  error?: string
}

/** 收的输出最多这么多（opencode models --verbose 二百多个模型三四百 KB） */
const MAX_OUT = 8 * 1024 * 1024

export function runProc(exe: string, args: string[], o: { input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(exe, args, { cwd: o.cwd ?? homedir(), env: o.env ?? cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    const finish = (r: Omit<ProcResult, 'stdout' | 'stderr' | 'timedOut'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...r, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, o.timeoutMs ?? 30_000)
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      if (stdout.length < MAX_OUT) stdout += d
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (stderr = (stderr + d).slice(-64_000)))
    child.on('error', (e) => finish({ code: null, error: e.message }))
    child.on('close', (code) => finish({ code }))
    // 起来就退出的写不进去（EPIPE）：退出的原因由 close 报
    child.stdin!.on('error', () => undefined)
    child.stdin!.end(o.input ?? '')
  })
}

/** 输出里最后一行有字的（报错时给人看的原话） */
export function lastLine(s: string): string {
  return (
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? ''
  ).slice(0, 300)
}
