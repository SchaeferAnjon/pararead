// CN-87：找得到用户装的 Codex（登录 shell 的 PATH、App 包里带的、npm prefix、fnm、asdf、mise、n），找到了还要能跑才算装好
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkCli, cliEnv, locateCli, loginShellPath, pickedCli, searchDirs, whereOf } from '../src/cli'

const base = mkdtempSync(join(tmpdir(), 'cn-cli-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

/** 放一个能执行的小脚本 */
function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}
/** 一个假的家目录：只在 rel 这个位置放一个 codex */
function home(name: string, rel: string, extra?: (h: string) => void): string {
  const h = join(base, name)
  script(join(h, rel), 'echo "codex-cli 9.9.9"')
  extra?.(h)
  return h
}
/** 只在假家目录里找：这台 Mac 的 /opt/homebrew/bin、/Applications 里可能真装着 codex */
const look = (h: string, more: NodeJS.ProcessEnv = {}, shell: string[] = []) => locateCli('codex', { env: { HOME: h, PATH: '/usr/bin:/bin', ...more }, shell, custom: {}, homeOnly: true })

describe('找命令行（CN-87）', () => {
  it('App 包、~/.npmrc 的 prefix、fnm、mise、asdf、n 各一个假家目录：都找得到，「在哪找到」家目录写成 ~，App 包里的写「在 Codex.app 里找到」', () => {
    const cases: [string, string, string, ((h: string) => void)?, NodeJS.ProcessEnv?][] = [
      ['app', 'Applications/Codex.app/Contents/Resources/codex', '在 Codex.app 里找到'],
      ['chatgpt', 'Applications/ChatGPT.app/Contents/Resources/codex', '在 ChatGPT.app 里找到'],
      ['npm', '.npm-packages/bin/codex', '~/.npm-packages/bin', (h) => writeFileSync(join(h, '.npmrc'), 'registry=https://registry.npmjs.org/\nprefix = ~/.npm-packages\n')],
      ['npm2', 'global-npm/bin/codex', '~/global-npm/bin', (h) => writeFileSync(join(h, '.npmrc'), 'prefix=${HOME}/global-npm\n')],
      ['fnm', 'Library/Application Support/fnm/node-versions/v22.11.0/installation/bin/codex', '~/Library/Application Support/fnm/node-versions/v22.11.0/installation/bin'],
      ['fnm-xdg', '.local/share/fnm/aliases/default/bin/codex', '~/.local/share/fnm/aliases/default/bin'],
      ['mise', '.local/share/mise/shims/codex', '~/.local/share/mise/shims'],
      ['asdf', '.asdf/shims/codex', '~/.asdf/shims'],
    ]
    for (const [name, rel, where, extra] of cases) {
      const h = home(name, rel, extra)
      const hit = look(h)
      expect(hit, name).toEqual({ path: join(h, rel), where })
      if (!rel.includes('.app/')) expect(searchDirs({ HOME: h, PATH: '' }, [])).toContain(dirname(join(h, rel)))
    }
    // n：N_PREFIX 指到哪就在哪的 bin
    const n = home('n', 'n-prefix/bin/codex')
    expect(look(n, { N_PREFIX: join(n, 'n-prefix') })).toEqual({ path: join(n, 'n-prefix/bin/codex'), where: '~/n-prefix/bin' })
    // 哪都没有
    expect(look(join(base, 'empty'))).toBeNull()
  })

  it('登录 shell 的 PATH 排最前；用户指定的位置排第一；不能执行的、目录不算', () => {
    const h = home('order', '.local/bin/codex')
    const tools = script(join(h, 'tools/codex'), 'echo codex-cli 1.0.0')
    expect(look(h, {}, [join(h, 'tools')])?.path).toBe(tools)
    const mine = script(join(base, 'elsewhere/my-codex'), 'echo codex-cli 2.0.0')
    expect(locateCli('codex', { env: { HOME: h, PATH: '' }, shell: [join(h, 'tools')], custom: { codex: mine }, homeOnly: true })).toEqual({ path: mine, where: join(base, 'elsewhere'), custom: true })
    // 指定的文件不在了：照常找
    expect(locateCli('codex', { env: { HOME: h, PATH: '' }, shell: [], custom: { codex: join(base, 'gone/codex') }, homeOnly: true })?.path).toBe(join(h, '.local/bin/codex'))
    // 不能执行的文件、同名的目录跳过
    const odd = join(base, 'odd')
    mkdirSync(join(odd, 'a/codex'), { recursive: true })
    mkdirSync(join(odd, 'b'), { recursive: true })
    writeFileSync(join(odd, 'b/codex'), 'not executable')
    const ok = script(join(odd, 'c/codex'), 'echo ok')
    expect(look(join(base, 'empty'), {}, [join(odd, 'a'), join(odd, 'b'), join(odd, 'c')])?.path).toBe(ok)
  })

  it('选的是 Codex.app 这个包：用包里带的命令行；选的文件能执行才收', () => {
    const app = join(base, 'pick/Codex.app')
    script(join(app, 'Contents/Resources/codex'), 'echo codex-cli 3.0.0')
    expect(pickedCli('codex', app)).toBe(join(app, 'Contents/Resources/codex'))
    expect(pickedCli('codex', join(app, 'Contents/Resources/codex'))).toBe(join(app, 'Contents/Resources/codex'))
    writeFileSync(join(base, 'pick/readme.txt'), 'x')
    expect(pickedCli('codex', join(base, 'pick/readme.txt'))).toBeNull()
    expect(pickedCli('claude', app)).toBeNull()
  })

  it('「在哪找到」：家目录下写成 ~，别的写原样', () => {
    expect(whereOf('/Users/a/.local/bin/claude', '/Users/a')).toBe('~/.local/bin')
    expect(whereOf('/opt/homebrew/bin/codex', '/Users/a')).toBe('/opt/homebrew/bin')
    expect(whereOf('/Users/ab/bin/codex', '/Users/a')).toBe('/Users/ab/bin')
    expect(whereOf('/Applications/ChatGPT.app/Contents/Resources/codex', '/Users/a')).toBe('在 ChatGPT.app 里找到')
  })

  it('登录 shell 取 PATH：.zshrc 里打印的杂字不算，取标记中间那段；卡住了到时间就放弃，用原来的目录', async () => {
    const chatty = script(join(base, 'shells/chatty'), 'echo "Welcome back!"\nPATH="/my/tools:/opt/x/bin:$PATH"; export PATH\nexec /bin/sh -c "$2"')
    expect(await loginShellPath({ shell: chatty, env: { PATH: '/usr/bin:/bin' } })).toEqual(['/my/tools', '/opt/x/bin', '/usr/bin', '/bin'])
    const stuck = script(join(base, 'shells/stuck'), 'sleep 30')
    const t = Date.now()
    expect(await loginShellPath({ shell: stuck, env: { PATH: '/usr/bin:/bin' }, timeoutMs: 300 })).toEqual([])
    expect(Date.now() - t).toBeLessThan(3000)
    expect(await loginShellPath({ shell: join(base, 'shells/none'), env: {} })).toEqual([])
  })

  it('子进程的 PATH：登录 shell 的目录在最前', () => {
    const p = cliEnv({}, ['/from/zshrc']).PATH!.split(delimiter)
    expect(p[0]).toBe('/from/zshrc')
    expect(p).toContain('/usr/bin')
  })

  it('找到了还要能跑：--version 跑得通算装好；退出码不是 0、3 秒没反应、跑不起来都算运行不了，说一句中文', async () => {
    const good = script(join(base, 'check/good'), 'echo "codex-cli 0.163.0"')
    expect(await checkCli(good)).toEqual({ ok: true, version: 'codex-cli 0.163.0' })
    const bad = script(join(base, 'check/bad'), 'echo "dyld: Library not loaded: libssl.3.dylib" >&2\nexit 134')
    expect(await checkCli(bad)).toEqual({ ok: false, why: '运行 bad --version 出错（退出码 134）：dyld: Library not loaded: libssl.3.dylib' })
    const slow = script(join(base, 'check/slow'), 'sleep 30')
    expect(await checkCli(slow, 300)).toEqual({ ok: false, why: '运行 slow --version 0.3 秒没反应' })
    writeFileSync(join(base, 'check/broken'), '#!/nonexistent/interpreter\n')
    chmodSync(join(base, 'check/broken'), 0o755)
    expect((await checkCli(join(base, 'check/broken'))).ok).toBe(false)
  })
})
