// CN-116：自动提交的说明不写软件自己的设置文件；历史默认跳过只动了设置的提交
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitPending, describeChanges, git, HIDE_INTERNAL, init, isInternalPath, log } from '../src'

describe('isInternalPath', () => {
  it('.canvas-notes 下面的全部、各文件夹的首页设置和首页模板、.gitkeep 是软件自己的', () => {
    for (const p of ['.canvas-notes/左栏.json', '.canvas-notes/置顶.json', '.canvas-notes/首页.json', '.canvas-notes/对话/Lecture05-p5-1.md', '.canvas-notes/字幕/yt-abc.vtt', '课程/ecp/.首页.json', '课程/.首页模板.json', '课程/ecpc/.gitkeep', '.canvas-tasks/提醒/mac/2026-11.jsonl'])
      expect(isInternalPath(p), p).toBe(true)
    for (const p of ['课程/ecp/Lecture05 笔记.md', '收件箱/冰岛行程.md', '附件/课程/ecp/图 1.png', 'canvas-notes.md', '写作/首页.json', '收件箱/待办.md', 'canvas-tasks.md'])
      expect(isInternalPath(p), p).toBe(false)
  })
})

describe('describeChanges 不写内部文件', () => {
  it('有自己的文件时只写自己的，计数也不算设置文件', () => {
    expect(describeChanges([{ path: '课程/ecpc/Lecture05.pdf', code: '??' }, { path: '.canvas-notes/左栏.json', code: ' M' }])).toBe('新增 1 个文件：课程/ecpc/Lecture05.pdf')
    expect(
      describeChanges([
        { path: '课程/ecp/a.md', code: ' D' },
        { path: '课程/ecp/b.md', code: ' D' },
        { path: '课程/ecp/.首页.json', code: ' D' },
        { path: '课程/ecp/.gitkeep', code: ' D' },
        { path: '.canvas-notes/置顶.json', code: ' M' },
      ]),
    ).toBe('删除 2 个文件：课程/ecp/a、课程/ecp/b')
  })
  it('只动了设置时写人话', () => {
    expect(describeChanges([{ path: '.canvas-notes/左栏.json', code: ' M' }])).toBe('改了左栏设置')
    expect(describeChanges([{ path: '课程/ecp/.首页.json', code: ' M' }])).toBe('改了「ecp」的首页')
    expect(describeChanges([{ path: '.canvas-notes/置顶.json', code: '??' }])).toBe('改了置顶')
    expect(describeChanges([{ path: '.canvas-notes/首页.json', code: ' M' }])).toBe('改了首页')
    expect(describeChanges([{ path: '课程/.首页模板.json', code: ' M' }])).toBe('改了「课程」的首页模板')
    expect(describeChanges([{ path: '课程/ecpc/.gitkeep', code: '??' }])).toBe('新建文件夹：课程/ecpc')
    expect(describeChanges([{ path: '课程/ecp/.gitkeep', code: ' D' }])).toBe('删了文件夹：课程/ecp')
    expect(describeChanges([{ path: '.canvas-notes/对话/Lecture05-p5-1.md', code: '??' }, { path: '.canvas-notes/对话/Lecture05-p6-1.md', code: '??' }])).toBe('存了AI对话')
    expect(describeChanges([{ path: '.canvas-notes/左栏.json', code: ' M' }, { path: '课程/ecp/.首页.json', code: ' M' }])).toBe('改了左栏设置；改了「ecp」的首页')
    // 画布今日的提醒记录（响过、推迟、勾掉）
    expect(describeChanges([{ path: '.canvas-tasks/提醒/mac/2026-11.jsonl', code: '??' }])).toBe('记了提醒')
    expect(describeChanges([{ path: '收件箱/待办.md', code: ' M' }, { path: '.canvas-tasks/提醒/mac/2026-11.jsonl', code: ' M' }])).toBe('更新 1 个文件：收件箱/待办')
  })
})

describe('log 跳过只动了设置的提交', () => {
  let root: string
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'cn-internal-'))
    await init(root)
    await git(root, ['config', 'user.name', 'Test'])
    await git(root, ['config', 'user.email', 'test@example.com'])
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const put = (p: string, text: string) => {
    mkdirSync(join(root, p, '..'), { recursive: true })
    writeFileSync(join(root, p), text)
  }

  it('排除路径：只动设置的提交整次不出现，混着的只列自己的文件；新建文件夹那次（只有 .gitkeep）照样在', async () => {
    put('课程/ecp/a.md', '# a\n')
    put('课程/ecp/.首页.json', '{}\n')
    await commitPending(root)
    put('.canvas-notes/左栏.json', '{"左边":["课程"]}\n')
    await commitPending(root)
    put('课程/ecpc/.gitkeep', '')
    await commitPending(root)
    put('收件箱/b.md', '# b\n')
    put('.canvas-notes/左栏.json', '{"左边":["课程","收件箱"]}\n')
    await commitPending(root)
    const all = await log(root, 50)
    expect(all.map((c) => c.subject)).toEqual(['新增 1 个文件：收件箱/b', '新建文件夹：课程/ecpc', '改了左栏设置', '新增 1 个文件：课程/ecp/a'])
    const mine = await log(root, 50, undefined, HIDE_INTERNAL)
    expect(mine.map((c) => c.subject)).toEqual(['新增 1 个文件：收件箱/b', '新建文件夹：课程/ecpc', '新增 1 个文件：课程/ecp/a'])
    expect(mine[0]!.files.map((f) => f.path)).toEqual(['收件箱/b.md'])
    expect(mine[1]!.files.map((f) => f.path)).toEqual(['课程/ecpc/.gitkeep'])
    expect(mine[2]!.files.map((f) => f.path)).toEqual(['课程/ecp/a.md'])
  })
})
