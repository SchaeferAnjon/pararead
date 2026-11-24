// 名字、Bundle ID、仓库、网址、许可证只写在 brand.json：package.json、打包配置、README 都和它一样（同画布今日的 test/release.test.ts）。
// 只读 apps/pararead 里的文件，导出到公开仓库（文件挪到根上）照样能跑。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = join(__dirname, '..')
const read = (f: string) => readFileSync(join(APP, f), 'utf8')
const brand = JSON.parse(read('brand.json'))
const pkg = JSON.parse(read('package.json'))
const builder = read('electron-builder.yml')

describe('ParaRead 的名字和许可证只写在 brand.json', () => {
  it('package.json', () => {
    expect(pkg.productName).toBe(brand.name)
    expect(pkg.author).toBe(brand.author)
    expect(pkg.license).toBe(brand.license)
    expect(pkg.homepage).toBe(brand.site)
  })

  it('打包配置：Bundle ID、版权行、查更新的仓库', () => {
    expect(builder).toMatch(new RegExp(`^appId: ${brand.appId.replace(/\./g, '\\.')}$`, 'm'))
    expect(builder).toMatch(new RegExp(`^copyright: Copyright © ${brand.year} ${brand.author}$`, 'm'))
    const [owner, repo] = brand.repo.split('/')
    expect(builder).toMatch(new RegExp(`^ {2}owner: ${owner}\\n {2}repo: ${repo}$`, 'm'))
    expect(builder).toMatch(new RegExp(`schemes: \\[${brand.scheme}\\]`))
  })

  it('README 写的许可证和 LICENSE 是 GPL 第 3 版的原文', () => {
    expect(read('README.md')).toContain(`许可 / License：${brand.license}`)
    expect(read('LICENSE')).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/)
    expect(brand.license).toBe('GPL-3.0-or-later')
  })
})
