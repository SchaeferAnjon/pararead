import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'

// 共用包不引哪个软件自己的文件（画布笔记、画布今日、ParaRead 都要能拿去用）：src 里的相对引用不出包，也不引 apps/ 下的东西
it('packages/ai-engines/src 里没有引到 apps/ 的相对路径', () => {
  const src = join(__dirname, '..', 'src')
  const pkg = join(__dirname, '..')
  for (const f of readdirSync(src, { recursive: true }) as string[]) {
    if (!/\.(ts|tsx)$/.test(f)) continue
    const code = readFileSync(join(src, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = m[1]!
      expect(spec, f).not.toMatch(/(^|\/)apps\//)
      if (!spec.startsWith('.')) continue
      const to = relative(pkg, resolve(dirname(join(src, f)), spec))
      expect(to.startsWith('..'), `${f} 引了包外的 ${spec}`).toBe(false)
    }
  }
})
