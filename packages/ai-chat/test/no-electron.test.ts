import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// 共用包在画布笔记、ParaRead、以后的 iPad 版里都要能用：三个新包都不依赖 Electron，界面包也不碰 Node 模块和 window.cn、window.api（走宿主接口）
const PKGS = { 'ai-engines': { node: true }, 'ai-chat': { node: false }, editor: { node: false } }

// 画布笔记、画布今日的公开仓库不带 packages/editor（只有 ParaRead 用），那边跳过
for (const [name, o] of Object.entries(PKGS)) {
  it.skipIf(!existsSync(join(__dirname, '../..', name)))(`packages/${name} 不依赖 Electron${o.node ? '' : '、Node 模块和软件自己的全局'}`, () => {
    const dir = join(__dirname, '../..', name)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter((d) => /electron/i.test(d))).toEqual([])
    for (const f of readdirSync(join(dir, 'src'), { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(f)) continue
      // 注释里说「不调 window.cn」不算
      const code = readFileSync(join(dir, 'src', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(code, f).not.toMatch(/from ['"]electron['"]/)
      if (!o.node) expect(code, f).not.toMatch(/from ['"](node:|fs|path|child_process)|window\.(cn|api)\b|\bapp\(\)/)
    }
  })
}
