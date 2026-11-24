import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// packages/format 要给手机版复用：不能依赖 Electron，也不能用 Node 专有模块。
it('packages/format 不依赖 Electron 和 Node 模块', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })
  expect(deps.filter((d) => /electron/i.test(d))).toEqual([])
  const src = join(__dirname, '../src')
  for (const f of readdirSync(src)) {
    const code = readFileSync(join(src, f), 'utf8')
    expect(code, f).not.toMatch(/from ['"](electron|node:|fs|path|child_process)/)
  }
})
