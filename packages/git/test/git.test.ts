import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAll, commitPaths, currentBranch, git, headState, gitPath, init, isRepo, lastCommitOf, log, parseStatus, remote, revert, revertPaths, setRemote, status } from '../src'

let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cn-git-'))
  await init(dir)
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('新库：是仓库、分支 main、没有提交', async () => {
  expect(await isRepo(dir)).toBe(true)
  expect(await currentBranch(dir)).toBe('main')
  expect(await log(dir)).toEqual([])
  expect(await isRepo(tmpdir())).toBe(false)
})

it('状态、提交、历史里有改了哪些文件（中文文件名不转义）', async () => {
  writeFileSync(join(dir, '所思所想.md'), '# 所思所想\n第一行\n')
  writeFileSync(join(dir, 'b.md'), 'b\n')
  expect((await status(dir)).map((s) => [s.code, s.path]).sort()).toEqual([
    ['??', 'b.md'],
    ['??', '所思所想.md'],
  ])
  const h1 = await commitAll(dir, '第一次')
  expect(h1).toMatch(/^[0-9a-f]{40}$/)
  expect(await commitAll(dir, '没有改动')).toBeNull()

  writeFileSync(join(dir, '所思所想.md'), '# 所思所想\n第一行改了\n第二行\n')
  expect(await status(dir)).toEqual([{ code: ' M', path: '所思所想.md' }])
  await commitAll(dir, '改了一篇')

  const commits = await log(dir)
  expect(commits.map((c) => c.subject)).toEqual(['改了一篇', '第一次'])
  expect(commits[0]!.files).toEqual([{ path: '所思所想.md', added: 2, removed: 1 }])
  expect(commits[1]!.files.map((f) => f.path).sort()).toEqual(['b.md', '所思所想.md'])
})

it('挪了文件夹的那次提交：历史里列出挪到的新路径（以前改名那一条被丢掉，AI 挪完写「改了0个文件」）', async () => {
  mkdirSync(join(dir, '收件箱'))
  writeFileSync(join(dir, '收件箱/票.md'), '# 票\n机票订好了。\n')
  writeFileSync(join(dir, 'b.md'), 'b\n')
  await commitAll(dir, '起点')
  mkdirSync(join(dir, '周记'))
  const { renameSync } = await import('node:fs')
  renameSync(join(dir, '收件箱/票.md'), join(dir, '周记/票.md'))
  writeFileSync(join(dir, 'b.md'), 'b\n改了\n')
  await commitPaths(dir, ['收件箱/票.md', '周记/票.md', 'b.md'], 'AI：挪进周记')
  expect((await log(dir, 1))[0]!.files).toEqual([
    { path: 'b.md', added: 1, removed: 0 },
    { path: '周记/票.md', added: 0, removed: 0 },
  ])
})

it('只提交 AI 改的那几个文件；撤回是一次反向提交', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  writeFileSync(join(dir, 'b.md'), 'b\n')
  await commitAll(dir, '起点')
  writeFileSync(join(dir, 'a.md'), 'a\nAI 加的\n')
  writeFileSync(join(dir, 'b.md'), 'b 用户正在改\n')
  writeFileSync(join(dir, 'new.md'), '新的\n')
  const h = await commitPaths(dir, ['a.md', 'new.md'], 'AI：加一行')
  expect(h).toMatch(/^[0-9a-f]{40}$/)
  expect(await status(dir)).toEqual([{ code: ' M', path: 'b.md' }])
  expect((await log(dir, 1))[0]!.files.map((f) => f.path).sort()).toEqual(['a.md', 'new.md'])
  expect(await commitPaths(dir, ['a.md'], '没改')).toBeNull()

  const r = await revert(dir, h!)
  expect(r).not.toBe(h)
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('a\n')
  expect(existsSync(join(dir, 'new.md'))).toBe(false)
  expect(readFileSync(join(dir, 'b.md'), 'utf8')).toBe('b 用户正在改\n')
  // 撤回的说明是中文「撤回」+ 原来那次的说明（以前是 git 自己的英文「Revert "…"」）
  expect((await log(dir, 1))[0]!.subject).toBe('撤回AI：加一行')
})

it('提交完到取提交号之间别处又提交了一次（视频条存字幕全文）：返回的还是自己那次，不是最新那次', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  await commitAll(dir, '起点')
  // 提交一完成，钩子马上在别的文件上再提交一次（演软件里另一处同时提交）
  await git(dir, ['config', 'core.hooksPath', '.git/hooks'])
  const hook = join(dir, '.git/hooks/post-commit')
  writeFileSync(hook, '#!/bin/sh\n[ -n "$CN_HOOKED" ] && exit 0\necho x >> other.md\nCN_HOOKED=1 git add other.md && CN_HOOKED=1 git commit -q -m 别处那次 -- other.md\n', { mode: 0o755 })
  writeFileSync(join(dir, 'a.md'), 'a\nAI 加的\n')
  const h = await commitPaths(dir, ['a.md'], 'AI：加一行')
  expect((await log(dir, 1))[0]!.subject).toBe('别处那次')
  const mine = (await log(dir, 1, h!))[0]!
  expect(mine.subject).toBe('AI：加一行')
  expect(mine.files.map((f) => f.path)).toEqual(['a.md'])
})

it('自动提交把 AI 改的和别处的字一起收进去了：找得到是哪次，只撤回 AI 的那几个文件，别处的字和之后的改动不动', async () => {
  writeFileSync(join(dir, '白板.md'), '卡一\n')
  writeFileSync(join(dir, '日记.md'), '今天\n')
  await commitAll(dir, '起点')
  // AI 改了白板、加了一篇；用户在日记里接着写；自动提交一次全收走
  writeFileSync(join(dir, '白板.md'), '卡一\nAI 的卡\n')
  writeFileSync(join(dir, 'AI新的.md'), 'AI 写的\n')
  writeFileSync(join(dir, '日记.md'), '今天\n下午\n')
  const auto = await commitAll(dir, '更新 3 个文件')
  expect(await commitPaths(dir, ['白板.md', 'AI新的.md'], 'AI：存成卡片')).toBeNull()
  expect(await lastCommitOf(dir, ['白板.md', 'AI新的.md'])).toBe(auto)
  expect((await log(dir, 1, auto!))[0]!.subject).toBe('更新 3 个文件')
  // 之后日记又写了一句（没提交）
  writeFileSync(join(dir, '日记.md'), '今天\n下午\n晚上\n')
  const r = await revertPaths(dir, auto!, ['白板.md', 'AI新的.md'], '撤回AI：存成卡片')
  expect(readFileSync(join(dir, '白板.md'), 'utf8')).toBe('卡一\n')
  expect(existsSync(join(dir, 'AI新的.md'))).toBe(false)
  expect(readFileSync(join(dir, '日记.md'), 'utf8')).toBe('今天\n下午\n晚上\n')
  const [c] = await log(dir, 1)
  expect(c!.hash).toBe(r)
  expect(c!.subject).toBe('撤回AI：存成卡片')
  expect(c!.files.map((f) => f.path).sort()).toEqual(['AI新的.md', '白板.md'])
  expect(await status(dir)).toEqual([{ code: ' M', path: '日记.md' }])
  // 白板之后又被改过同一处：打不回去，什么都不动
  writeFileSync(join(dir, '白板.md'), '卡一\nAI 的卡\n')
  const again = await commitAll(dir, '又加回来')
  writeFileSync(join(dir, '白板.md'), '卡一改了\nAI 的卡改了\n')
  await commitAll(dir, '又改')
  await expect(revertPaths(dir, again!, ['白板.md'], '撤回')).rejects.toThrow('撤回不了')
  expect(readFileSync(join(dir, '白板.md'), 'utf8')).toBe('卡一改了\nAI 的卡改了\n')
})

it('提交时别的 git 进程正占着 index.lock（终端、编辑器里的 git status 会短暂占着）：等它放开再提交，不丢下一个暂存了没提交的删除', async () => {
  mkdirSync(join(dir, '写作/冰岛'), { recursive: true })
  writeFileSync(join(dir, '写作/冰岛/.gitkeep'), '')
  writeFileSync(join(dir, 'a.md'), 'a\n')
  await commitAll(dir, '起点')
  rmSync(join(dir, '写作/冰岛'), { recursive: true })
  writeFileSync(join(dir, 'a.md'), 'a 改了\n')
  // 删文件夹那次（commitPaths）和全部提交（commitAll）各撞一次锁，锁 300ms 后放开
  for (const commit of [() => commitPaths(dir, ['写作/冰岛/.gitkeep'], '移到废纸篓：写作/冰岛'), () => commitAll(dir, '更新 1 个文件：a')]) {
    writeFileSync(join(dir, '.git/index.lock'), '')
    const t = setTimeout(() => rmSync(join(dir, '.git/index.lock')), 300)
    try {
      expect(await commit()).toMatch(/^[0-9a-f]{40}$/)
    } finally {
      clearTimeout(t)
    }
  }
  expect(await status(dir)).toEqual([])
  expect((await log(dir, 2)).map((c) => c.subject)).toEqual(['更新 1 个文件：a', '移到废纸篓：写作/冰岛'])
})

it('删除已经暂存了（上次 add 成功、commit 撞锁）：再提交这个路径照样提交上，不报「pathspec did not match」', async () => {
  mkdirSync(join(dir, '写作/冰岛'), { recursive: true })
  writeFileSync(join(dir, '写作/冰岛/.gitkeep'), '')
  writeFileSync(join(dir, '新.md'), '新\n')
  await commitAll(dir, '起点')
  rmSync(join(dir, '写作/冰岛'), { recursive: true })
  await git(dir, ['add', '-A', '--', '写作/冰岛/.gitkeep'])
  expect(await status(dir)).toEqual([{ code: 'D ', path: '写作/冰岛/.gitkeep' }])
  writeFileSync(join(dir, '另一篇.md'), '另\n')
  expect(await commitPaths(dir, ['写作/冰岛/.gitkeep', '另一篇.md'], '移到废纸篓：写作/冰岛')).toMatch(/^[0-9a-f]{40}$/)
  expect(await status(dir)).toEqual([])
  expect((await log(dir, 1))[0]!.files.map((f) => f.path).sort()).toEqual(['写作/冰岛/.gitkeep', '另一篇.md'])
})

it('锁一直不放（上次 git 崩了留下的）：试几次后照样报错，不一直等', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  writeFileSync(join(dir, '.git/index.lock'), '')
  const t0 = Date.now()
  await expect(commitPaths(dir, ['a.md'], '加 a')).rejects.toThrow('index.lock')
  expect(Date.now() - t0).toBeLessThan(5_000)
})

it('撤回可以给自己的提交说明；同一行两边改的不是同一处时，resolve 按字合并后照样撤回，合不了就退回原样', async () => {
  writeFileSync(join(dir, 'a.md'), '一行：旧链接\n')
  await commitAll(dir, '起点')
  writeFileSync(join(dir, 'a.md'), '一行：新链接\n')
  const h = (await commitPaths(dir, ['a.md'], '梦游：改链接'))!
  // 改链接以后在同一行后面接着打了字
  writeFileSync(join(dir, 'a.md'), '一行：新链接 后来打的字\n')
  await commitAll(dir, '更新 1 个文件：a')
  // 不给 resolve：按行合不了，照旧报错、什么都不动
  await expect(revert(dir, h)).rejects.toThrow('撤回不了')
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('一行：新链接 后来打的字\n')
  // 给 resolve（按字合并）：撤得回，说明是给的那句
  const fine = (base: string, ours: string, theirs: string) => (base === '一行：新链接\n' && ours === '一行：新链接 后来打的字\n' && theirs === '一行：旧链接\n' ? '一行：旧链接 后来打的字\n' : null)
  await revert(dir, h, { message: '撤回梦游：改链接', resolve: fine })
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('一行：旧链接 后来打的字\n')
  expect((await log(dir, 1))[0]!.subject).toBe('撤回梦游：改链接')
  expect(await status(dir)).toEqual([])
  // resolve 也合不了：退回原样，报给的那句
  writeFileSync(join(dir, 'a.md'), '一行：又改 后来打的字\n')
  await commitAll(dir, '再改')
  await expect(revert(dir, h, { resolve: () => null, conflict: (files) => `合不了：${files.join('、')}` })).rejects.toThrow('合不了：a.md')
  expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('一行：又改 后来打的字\n')
  expect(await status(dir)).toEqual([])
})

it('远程地址：没有时是 null，设了是 origin，再设改的是同一个', async () => {
  expect(await remote(dir)).toBeNull()
  await setRemote(dir, 'ssh://example.com/me/notes.git')
  expect(await remote(dir)).toEqual({ name: 'origin', url: 'ssh://example.com/me/notes.git' })
  await setRemote(dir, ' https://example.com/me/notes.git ')
  expect(await remote(dir)).toEqual({ name: 'origin', url: 'https://example.com/me/notes.git' })
  await expect(setRemote(dir, '--upload-pack=x')).rejects.toThrow('远程地址不对')
  await expect(setRemote(dir, 'a b')).rejects.toThrow('远程地址不对')
})

describe('gitPath', () => {
  it('从访达打开时 PATH 很短：补上 Homebrew 的目录（git-lfs 这类钩子要用），继承来的排前面、不重复', () => {
    expect(gitPath('/usr/bin:/bin:/usr/sbin:/sbin')).toBe('/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin')
    expect(gitPath('/my/bin:/opt/homebrew/bin')).toBe('/my/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
  })
})

describe('parseStatus', () => {
  it('认改动、新文件、改名（改名后面那段是旧路径，记在 from）', () => {
    expect(parseStatus(' M a.md\0?? 新 文件.md\0R  b.md\0old.md\0')).toEqual([
      { path: 'a.md', code: ' M' },
      { path: '新 文件.md', code: '??' },
      { path: 'b.md', code: 'R ', from: 'old.md' },
    ])
    expect(parseStatus('')).toEqual([])
  })
})

it('原子写的临时文件、崩溃残留的回收处不进 Git（task-8dula）：状态里没有、全部提交也不带，写在 .git/info/exclude', async () => {
  writeFileSync(join(dir, 'a.md'), 'a\n')
  writeFileSync(join(dir, '.a.md.cn-123-abc.tmp'), '半截')
  mkdirSync(join(dir, '.canvas-notes', '回收', '2026-11-23'), { recursive: true })
  writeFileSync(join(dir, '.canvas-notes', '回收', '2026-11-23', 'a.md.cn-1-x.tmp'), '半截')
  writeFileSync(join(dir, '.canvas-notes', '首页.json'), '{}')
  expect((await status(dir)).map((s) => s.path).sort()).toEqual(['.canvas-notes/首页.json', 'a.md'])
  await commitAll(dir, '第一次')
  const files = (await git(dir, ['show', '--name-only', '--format=', 'HEAD'])).trim().split('\n').sort()
  expect(files).toEqual(['.canvas-notes/首页.json', 'a.md'])
  const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
  expect(exclude).toContain('.*.cn-*.tmp')
  expect(exclude).toContain('/.canvas-notes/回收/')
  // 只写一次：再查状态不再追加
  await status(dir)
  expect(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')).toBe(exclude)
})

describe('同步途中的库（git:state 不抛「HEAD is not a symbolic ref」）', () => {
  /** main 和 other 改同一行，各提交一次：rebase / merge 都会停在冲突上 */
  async function forked() {
    writeFileSync(join(dir, 'a.md'), '第一行\n')
    await commitAll(dir, '起头')
    await git(dir, ['checkout', '-q', '-b', 'other'])
    writeFileSync(join(dir, 'a.md'), '别处改的\n')
    await commitAll(dir, '别处')
    await git(dir, ['checkout', '-q', 'main'])
    writeFileSync(join(dir, 'a.md'), '这里改的\n')
    await commitAll(dir, '这里')
  }

  it('rebase 停在冲突上（同 pull --rebase 途中，HEAD 分离）：分支照样是 main，busy 是 rebase，状态照样读得到', async () => {
    await forked()
    await expect(git(dir, ['rebase', 'other'])).rejects.toThrow()
    expect(existsSync(join(dir, '.git', 'rebase-merge'))).toBe(true)
    // 以前 git:state 就是这一步抛的
    await expect(currentBranch(dir)).rejects.toThrow(/not a symbolic ref/)
    expect(await headState(dir)).toEqual({ branch: 'main', busy: 'rebase' })
    expect((await status(dir)).map((s) => s.path)).toEqual(['a.md'])
    await git(dir, ['rebase', '--abort'])
    expect(await headState(dir)).toEqual({ branch: 'main', busy: null })
  })

  it('merge 停在冲突上：busy 是 merge；检出某个提交（分离 HEAD、没在同步）：分支是 null', async () => {
    await forked()
    await expect(git(dir, ['merge', 'other'])).rejects.toThrow()
    expect(await headState(dir)).toEqual({ branch: 'main', busy: 'merge' })
    await git(dir, ['merge', '--abort'])
    await git(dir, ['checkout', '-q', '--detach', 'HEAD~1'])
    expect(await headState(dir)).toEqual({ branch: null, busy: null })
  })
})
