import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { bundle, commitAll, commitPending, countCommitsSince, describeChanges, git, log, pull, status, sync } from '../src'

let root: string
let a: string
let b: string
let bare: string

async function clone(to: string) {
  await git(root, ['clone', '-q', bare, to])
  await git(to, ['config', 'user.name', 'Test'])
  await git(to, ['config', 'user.email', 'test@example.com'])
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cn-sync-'))
  bare = join(root, 'remote.git')
  await git(root, ['init', '-q', '--bare', '-b', 'main', bare])
  a = join(root, 'a')
  b = join(root, 'b')
  await clone(a)
  writeFileSync(join(a, '旅行.md'), '第一段\n\n第二段\n')
  await commitAll(a, '第一次')
  await git(a, ['push', '-q', '-u', 'origin', 'main'])
  await clone(b)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('没有远程时说清楚', async () => {
  const solo = join(root, 'solo')
  await git(root, ['init', '-q', '-b', 'main', solo])
  expect(await sync(solo)).toEqual({ kind: 'no-remote' })
})

it('同步：提交本地改动、拉下别处的、推上去', async () => {
  writeFileSync(join(b, '旅行.md'), '第一段（另一台电脑改的）\n\n第二段\n')
  await commitAll(b, 'b 改的')
  await git(b, ['push', '-q'])

  writeFileSync(join(a, '旅行.md'), '第一段\n\n第二段，本机改的\n')
  const r = await sync(a)
  expect(r).toMatchObject({ kind: 'ok', pulled: 1, pushed: true })
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段（另一台电脑改的）\n\n第二段，本机改的\n')
  expect(await status(a)).toEqual([])

  await git(b, ['pull', '-q'])
  expect(readFileSync(join(b, '旅行.md'), 'utf8')).toBe('第一段（另一台电脑改的）\n\n第二段，本机改的\n')
})

it('两边改了同一行：退回同步前，本地的字不丢', async () => {
  writeFileSync(join(b, '旅行.md'), '第一段 b\n\n第二段\n')
  await commitAll(b, 'b')
  await git(b, ['push', '-q'])
  writeFileSync(join(a, '旅行.md'), '第一段 a\n\n第二段\n')
  const r = await sync(a)
  expect(r.kind).toBe('conflict')
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段 a\n\n第二段\n')
  expect((await log(a))[0]!.subject).toMatch(/^更新 1 个文件：旅行/)
})

it('拉（打开库时先拉一次）：先提交本机的，再拿到别处推上去的，不推', async () => {
  writeFileSync(join(b, '旅行.md'), '第一段（另一台电脑改的）\n\n第二段\n')
  await commitAll(b, 'b 改的')
  await git(b, ['push', '-q'])
  writeFileSync(join(a, '新的.md'), '本机新写的\n')
  const r = await pull(a)
  expect(r).toMatchObject({ kind: 'ok', pulled: 1 })
  expect(r.kind === 'ok' && r.committed).toMatch(/^[0-9a-f]{40}$/)
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段（另一台电脑改的）\n\n第二段\n')
  // 本机的那次提交还在本机，远程上没有
  expect((await git(bare, ['log', '--format=%s', 'main'])).trim().split('\n')).toEqual(['b 改的', '第一次'])
  expect((await log(a, 1))[0]!.subject).toMatch(/新的/)
})

it('拉：没有远程、两边改了同一行时和同步一样说清楚，本机的字不丢', async () => {
  const solo = join(root, 'solo')
  await git(root, ['init', '-q', '-b', 'main', solo])
  expect(await pull(solo)).toEqual({ kind: 'no-remote' })
  writeFileSync(join(b, '旅行.md'), '第一段 b\n\n第二段\n')
  await commitAll(b, 'b')
  await git(b, ['push', '-q'])
  writeFileSync(join(a, '旅行.md'), '第一段 a\n\n第二段\n')
  expect((await pull(a)).kind).toBe('conflict')
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段 a\n\n第二段\n')
})

it('备份：整个库的历史打成一个文件，clone 回来什么都在；再备一次换掉上一份', async () => {
  const file = join(root, 'a.bundle')
  await bundle(a, file)
  const back = join(root, 'back')
  await git(root, ['clone', '-q', file, back])
  expect(readFileSync(join(back, '旅行.md'), 'utf8')).toBe('第一段\n\n第二段\n')
  writeFileSync(join(a, '旅行.md'), '改过\n')
  await commitAll(a, '第二次')
  await bundle(a, file)
  const back2 = join(root, 'back2')
  await git(root, ['clone', '-q', file, back2])
  expect((await log(back2)).map((c) => c.subject)).toEqual(['第二次', '第一次'])
})

it('commitPending：先暂存再写说明，在外面改了名写「挪了」（不是新增一个、删除一个）；没东西可提交给 null', async () => {
  renameSync(join(a, '旅行.md'), join(a, '旅行攻略.md'))
  expect(await commitPending(a)).toMatch(/^[0-9a-f]{40}$/)
  expect((await log(a))[0]!.subject).toBe('挪了 1 个文件：旅行 → 旅行攻略')
  expect(await status(a)).toEqual([])
  expect(await commitPending(a)).toBeNull()
})

it('提交说明和本周提交数', async () => {
  expect(describeChanges([{ path: '收件箱/a.md', code: '??' }])).toBe('新增 1 个文件：收件箱/a')
  expect(
    describeChanges([
      { path: 'a.md', code: ' M' },
      { path: 'b.md', code: '??' },
      { path: 'c.md', code: ' M' },
      { path: 'd.md', code: ' M' },
    ]),
  ).toBe('更新 3 个文件：a、c、d；新增 1 个：b')
  expect(describeChanges([{ path: 'a.md', code: ' M' }, { path: 'b.md', code: ' M' }, { path: 'c.md', code: ' M' }, { path: 'd.md', code: 'M ' }])).toBe('更新 4 个文件：a、b、c 等')
  expect(describeChanges([{ path: '写作/冰岛旅游 3.md', code: ' D' }, { path: '附件/写作/冰岛旅游 3/截图 1.png', code: 'D ' }])).toBe('删除 2 个文件：写作/冰岛旅游 3、附件/写作/冰岛旅游 3/截图 1.png')
  // 又改又删：删掉的不列进「更新」，分开写
  expect(
    describeChanges([
      { path: '写作/投稿清单.md', code: ' M' },
      { path: '写作/游记/东京-大阪 对比 2.md', code: ' D' },
      { path: '写作/折叠测试.md', code: ' M' },
      { path: '素材/冰岛物价参考.md', code: 'D ' },
    ]),
  ).toBe('更新 2 个文件：写作/投稿清单、写作/折叠测试；删除 2 个：写作/游记/东京-大阪 对比 2、素材/冰岛物价参考')
  // 新加的写「新增」，不写成「更新」
  expect(describeChanges([{ path: 'rt/rt-nbsp.md', code: ' D' }, { path: 'rt/新的.md', code: '??' }])).toBe('新增 1 个文件：rt/新的；删除 1 个：rt/rt-nbsp')
  // 只挪了一篇（这边删、那边同名新加）：写「挪了」，不写成一删一更新
  expect(describeChanges([{ path: '删测/丁.md', code: ' D' }, { path: '写作/丁.md', code: '??' }])).toBe('挪了 1 个文件：删测/丁 → 写作/丁')
  expect(describeChanges([{ path: '写作/丙.md', code: 'R ', from: '删测/丙.md' }])).toBe('挪了 1 个文件：删测/丙 → 写作/丙')
  expect(
    describeChanges([
      { path: '删测/甲.md', code: ' M' },
      { path: '删测/丙.md', code: ' D' },
      { path: '写作/丙.md', code: '??' },
      { path: '删测/新来的.md', code: '??' },
      { path: '删测/戊.md', code: ' D' },
    ]),
  ).toBe('更新 1 个文件：删测/甲；新增 1 个：删测/新来的；挪了 1 个：删测/丙 → 写作/丙；删除 1 个：删测/戊')
  expect(await countCommitsSince(a, new Date(Date.now() - 3600_000))).toBe(1)
  expect(await countCommitsSince(a, new Date(Date.now() + 3600_000))).toBe(0)
})

it('两边都往白板笔迹里加了笔（同一处、按行合不了）：交给 resolve 合好，接着 rebase、推上去；不给 resolve 时照旧退回', async () => {
  const head = '{"ink":1}\n{"g":"g0","x":0,"y":0}\n{"id":"s0","g":"g0","p":"0,0,250,500,0"}\n'
  const lb = '{"id":"sb","g":"g0","p":"1,1,250,500,0"}\n'
  const la = '{"id":"sa","g":"g0","p":"2,2,250,500,0"}\n'
  writeFileSync(join(a, '笔迹.ink'), head)
  await commitAll(a, '笔迹')
  await git(a, ['push', '-q'])
  await git(b, ['pull', '-q'])
  writeFileSync(join(b, '笔迹.ink'), head + lb)
  await commitAll(b, 'b 写了一笔')
  await git(b, ['push', '-q'])
  writeFileSync(join(a, '笔迹.ink'), head + la)
  await commitAll(a, 'a 写了一笔')
  writeFileSync(join(a, '旅行.md'), '第一段\n\n第二段，a 又改的\n')
  await commitAll(a, 'a 又改了一段')

  expect((await pull(a)).kind).toBe('conflict')
  expect(readFileSync(join(a, '笔迹.ink'), 'utf8')).toBe(head + la)

  const seen: string[][] = []
  const r = await sync(a, {
    resolve: (path, base, remote, local) => {
      seen.push([path, base, remote, local])
      if (!path.endsWith('.ink')) return null
      // 测试里的合法：base 之后两边各加的行都留下，远程的在前
      return remote + local.slice(base.length)
    },
  })
  expect(r).toMatchObject({ kind: 'ok', pulled: 1, pushed: true })
  expect(seen).toEqual([['笔迹.ink', head, head + lb, head + la]])
  expect(readFileSync(join(a, '笔迹.ink'), 'utf8')).toBe(head + lb + la)
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段\n\n第二段，a 又改的\n')
  expect(await status(a)).toEqual([])
  expect((await git(bare, ['log', '--format=%s', 'main'])).trim().split('\n')).toEqual(['a 又改了一段', 'a 写了一笔', 'b 写了一笔', '笔迹', '第一次'])
})

it('resolve 合不了（返回 null）：照旧退回同步前，本机的字都在', async () => {
  writeFileSync(join(b, '旅行.md'), '第一段 b\n\n第二段\n')
  await commitAll(b, 'b')
  await git(b, ['push', '-q'])
  writeFileSync(join(a, '旅行.md'), '第一段 a\n\n第二段\n')
  const r = await sync(a, { resolve: () => null })
  expect(r.kind).toBe('conflict')
  expect(readFileSync(join(a, '旅行.md'), 'utf8')).toBe('第一段 a\n\n第二段\n')
  expect(await git(a, ['status', '--porcelain'])).toBe('')
})
