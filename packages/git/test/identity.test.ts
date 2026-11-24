import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAll, ensureIdentity, git, GitError, identity, init, setIdentity } from '../src'

describe('这台 Mac 上 git 没有署名（全局、库里都没设）', () => {
  const saved: Record<string, string | undefined> = {}
  let home: string
  let dir: string
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'cn-home-'))
    // 临时 HOME：没有 ~/.gitconfig、不读系统配置；useConfigOnly 让 git 不从机器名猜邮箱（新 Mac 上就是猜不出来、报「作者身份未知」）
    const env = {
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.useConfigOnly',
      GIT_CONFIG_VALUE_0: 'true',
    }
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
    dir = mkdtempSync(join(tmpdir(), 'cn-noid-'))
    await init(dir)
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(home, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('没署名时提交失败；ensureIdentity 在库里补上名字和邮箱，之后提交成功，不碰全局', async () => {
    writeFileSync(join(dir, 'a.md'), 'a\n')
    await expect(commitAll(dir, '第一次')).rejects.toThrow(GitError)
    expect(await identity(dir)).toBeNull()
    expect(await ensureIdentity(dir, { name: '小明', email: 'xm@xiaoming-mac.local' })).toEqual({ name: '小明', email: 'xm@xiaoming-mac.local' })
    expect(await identity(dir)).toEqual({ name: '小明', email: 'xm@xiaoming-mac.local', local: true })
    expect(await commitAll(dir, '第一次')).toMatch(/^[0-9a-f]{40}$/)
    expect((await git(dir, ['log', '-1', '--format=%an <%ae>'])).trim()).toBe('小明 <xm@xiaoming-mac.local>')
    // 已经有了：不再改
    expect(await ensureIdentity(dir, { name: '别人', email: 'b@c.local' })).toBeNull()
    expect(existsSync(join(home, '.gitconfig'))).toBe(false)
  })

  it('全局设了名字没设邮箱：只在库里补邮箱', async () => {
    await git(dir, ['config', '--global', 'user.name', '全局名'])
    expect(await ensureIdentity(dir, { name: '小明', email: 'xm@mac.local' })).toEqual({ email: 'xm@mac.local' })
    expect(await identity(dir)).toEqual({ name: '全局名', email: 'xm@mac.local', local: false })
  })

  it('setIdentity 只改这个库；名字空着、邮箱不像邮箱时不改', async () => {
    await setIdentity(dir, ' 新名字 ', 'new@x.local')
    expect(await identity(dir)).toEqual({ name: '新名字', email: 'new@x.local', local: true })
    await expect(setIdentity(dir, '  ', 'a@b')).rejects.toThrow('名字不能空着')
    await expect(setIdentity(dir, '甲', '没有at')).rejects.toThrow('邮箱')
    expect(await identity(dir)).toEqual({ name: '新名字', email: 'new@x.local', local: true })
    expect(existsSync(join(home, '.gitconfig'))).toBe(false)
  })
})
