import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { canvasNotesVaults, vaultFolders } from '../src/node'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

it('ParaRead「放到画布笔记…」：画布笔记开过的库（还在的）、库里的目录树（不列点开头的、附件）', () => {
  dir = mkdtempSync(join(tmpdir(), 'cn-place-'))
  const vault = join(dir, '笔记库')
  for (const d of ['课程/ecp', '课程/study project 2', '阅读', '附件/x', '.canvas-notes', '.git']) mkdirSync(join(vault, d), { recursive: true })
  writeFileSync(join(vault, '课程/ecp/Lecture05.pdf'), '')
  const ud = join(dir, 'ud')
  mkdirSync(ud)
  expect(canvasNotesVaults(ud)).toEqual([])
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ lastVault: vault, knownVaults: [vault, join(dir, '没了')] }))
  expect(canvasNotesVaults(ud)).toEqual([{ name: '笔记库', path: vault, open: true }])
  const tree = vaultFolders(vault)
  expect(tree.map((f) => f.path)).toEqual(['课程', '阅读'])
  expect(tree[0]!.children.map((f) => [f.path, f.pdfs])).toEqual([
    ['课程/ecp', 1],
    ['课程/study project 2', 0],
  ])
  expect(vaultFolders(vault, 1)[0]!.children).toEqual([])
})
