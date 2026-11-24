import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { git, GitError, init, lineTimes, parseBlame } from '../src'

let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cn-blame-'))
  await init(dir)
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const commitAt = async (sec: number, msg: string) => {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-q', `--date=@${sec} +0800`, '-m', msg])
}

it('每一行是哪次提交写的：两次提交各自的作者时间，还没提交的行是 0', async () => {
  writeFileSync(join(dir, '学习笔记.md'), '# 学习笔记\n第一段\n')
  await commitAt(1_700_000_000, '第一次')
  writeFileSync(join(dir, '学习笔记.md'), '# 学习笔记\n第一段\n> [!ai] 讲解一下\n> 回答\n')
  await commitAt(1_700_086_400, '第二次')
  writeFileSync(join(dir, '学习笔记.md'), '# 学习笔记\n还没提交的一行\n第一段\n> [!ai] 讲解一下\n> 回答\n')
  expect(await lineTimes(dir, '学习笔记.md')).toEqual({
    lines: ['# 学习笔记', '还没提交的一行', '第一段', '> [!ai] 讲解一下', '> 回答'],
    at: [1_700_000_000_000, 0, 1_700_000_000_000, 1_700_086_400_000, 1_700_086_400_000],
  })
})

it('库里没有这个文件的历史：还没有任何提交、没跟踪的文件返回 null；别的错照常抛', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  expect(await lineTimes(dir, 'a.md')).toBeNull()
  await commitAt(1_700_000_000, '第一次')
  writeFileSync(join(dir, '新的.md'), '新的一篇\n')
  expect(await lineTimes(dir, '新的.md')).toBeNull()
  await expect(lineTimes(join(dir, '不存在的目录'), 'a.md')).rejects.toThrow()
  await expect(lineTimes(tmpdir(), 'a.md')).rejects.toBeInstanceOf(GitError)
})

it('解析：同一提交第二次出现不带 author-time，按提交号记；字里有 tab、空行照原样', () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)
  const z = '0'.repeat(40)
  const out = [
    `${a} 1 1 1`,
    'author T',
    'author-time 100',
    'summary 一',
    'filename x.md',
    '\t头一行',
    `${b} 1 2 1`,
    'author T',
    'author-time 200',
    'previous ' + a + ' x.md',
    'filename x.md',
    '\t\t缩进的一行',
    `${z} 3 3 1`,
    'author Not Committed Yet',
    'author-time 999',
    'filename x.md',
    '\t',
    `${a} 2 4 1`,
    '\tauthor-time 5',
    '',
  ].join('\n')
  expect(parseBlame(out)).toEqual({ lines: ['头一行', '\t缩进的一行', '', 'author-time 5'], at: [100_000, 200_000, 0, 100_000] })
})
