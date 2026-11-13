// Mac 和 Windows 不一样的地方收在这里：杀进程树、Python 环境里可执行文件的位置、跑命令用的 shell、
// 量文件夹大小、退出看门狗、设备标识、打开浏览器的扩展页。
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { opendir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const IS_WIN = process.platform === 'win32'

/** 子进程连同它起的进程一起停。Mac 上子进程是 detached 起的、自成一组；Windows 用 taskkill /T */
export function killTree(child: ChildProcess, sig: NodeJS.Signals = 'SIGKILL'): void {
  if (!child.pid) return
  if (IS_WIN) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill())
    return
  }
  try {
    process.kill(-child.pid, sig)
  } catch {
    child.kill(sig)
  }
}

/** Python 虚拟环境里的可执行文件：Mac 在 bin/，Windows 在 Scripts/、带 .exe */
export const venvExe = (venv: string, name: string): string => (IS_WIN ? join(venv, 'Scripts', `${name}.exe`) : join(venv, 'bin', name))

/** 研究 Agent 跑命令用的 shell */
export const shellOf = (command: string): [string, string[]] => (IS_WIN ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]] : ['/bin/zsh', ['-lc', command]])
export const SHELL_NAME = IS_WIN ? 'Windows PowerShell' : 'zsh（macOS）'

async function walkKb(dir: string): Promise<number> {
  let bytes = 0
  const go = async (d: string): Promise<void> => {
    for await (const e of await opendir(d).catch(() => [])) {
      const f = join(d, e.name)
      if (e.isDirectory()) await go(f)
      else if (e.isFile()) bytes += (await stat(f).catch(() => ({ size: 0 }))).size
    }
  }
  await go(dir)
  return Math.round(bytes / 1024)
}

/** 文件夹多大（KB）：装 MinerU 时按下载目录长到多大算进度 */
export function dirKb(dir: string): Promise<number> {
  if (IS_WIN) return walkKb(dir)
  return new Promise((res) => execFile('/usr/bin/du', ['-sk', dir], { timeout: 10_000 }, (_e, out) => res(Number(String(out).split(/\s/)[0]) || 0)))
}

/** 退出看门狗：1.5 秒后还没退完就强杀自己（见 index.ts will-quit） */
export function quitWatchdog(): void {
  if (IS_WIN) {
    spawn('cmd.exe', ['/d', '/c', `ping -n 3 127.0.0.1 >nul & taskkill /F /PID ${process.pid}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  spawn('/bin/sh', ['-c', 'sleep 1.5; [ "$(ps -p "$1" -o comm=)" = "$2" ] && kill -9 "$1"', 'sh', String(process.pid), process.execPath], { detached: true, stdio: 'ignore' }).unref()
}

/** 这台电脑的硬件标识（拿不到是 undefined）：Mac 的 IOPlatformUUID，Windows 的 MachineGuid */
export function machineId(): Promise<string | undefined> {
  const [cmd, args, re] = IS_WIN
    ? ['reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], /MachineGuid\s+REG_SZ\s+(\S+)/]
    : ['ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], /"IOPlatformUUID" = "([^"]+)"/]
  return new Promise((res) => execFile(cmd as string, args as string[], { timeout: 5000, windowsHide: true }, (err, out) => res(err ? undefined : ((re as RegExp).exec(String(out))?.[1] ?? undefined))))
}

/** 打开 Chrome / Edge 的扩展管理页（装浏览器插件那三步里用） */
export function openExtensionsPage(browser: 'Google Chrome' | 'Microsoft Edge'): void {
  const page = browser === 'Google Chrome' ? 'chrome://extensions' : 'edge://extensions'
  const child = IS_WIN
    ? // start 的第一个带引号的参数是窗口标题；参数原样交给 cmd，不让 Node 给 "" 加转义
      spawn('cmd.exe', ['/d', '/c', `start "" ${browser === 'Google Chrome' ? 'chrome' : 'msedge'} ${page}`], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
    : spawn('/usr/bin/open', ['-a', browser, page], { stdio: 'ignore' })
  child.on('error', () => {})
}

/** 菜单的快捷键写法换成 Windows 的：Cmd 换成 Ctrl，Ctrl+Cmd 换成 Ctrl+Alt */
export const winAcc = (a: string): string => a.replace('Ctrl+Cmd+', 'Ctrl+Alt+').replace(/Cmd/g, 'Ctrl')

/** 窗口收到的按键（Electron 的 before-input-event）是不是这个快捷键，比如 Ctrl+Shift+F */
export function keyMatches(input: { type: string; key: string; control: boolean; shift: boolean; alt: boolean }, acc: string): boolean {
  const parts = acc.split('+')
  const key = parts.pop()!.toLowerCase()
  return input.type === 'keyDown' && input.control === parts.includes('Ctrl') && input.shift === parts.includes('Shift') && input.alt === parts.includes('Alt') && input.key.toLowerCase() === key
}
