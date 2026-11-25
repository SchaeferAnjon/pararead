// 哪些不是笔记、不是附件（app-files.ts）：扫库的地方都用这一个判断
import { describe, expect, it } from 'vitest'
import { APP_DIRS, APP_FILE_NAMES, INK_FILE, inkPathOf, isAppFile, isHiddenPath, isNoteSideFile, NOTE_SIDE_FILES } from '../src'

describe('isAppFile', () => {
  it('软件自己的、一切 . 开头的、白板笔迹都算', () => {
    for (const p of [
      '.canvas-notes/左栏.json',
      '.canvas-notes/对话/Lecture05-p5-1.md',
      '.canvas-tasks/提醒/mac/2026-11.jsonl',
      '.canvas-feeds/MacBook-Pro-1a2b.jsonl',
      '收件箱/.首页.json',
      '课程/.首页模板.json',
      '课程/ecpc/.gitkeep',
      '.git/HEAD',
      '.DS_Store',
      '课程/.DS_Store',
      '.obsidian/workspace.json',
      '课程/.obsidian/笔记.md',
      '收件箱/.藏起来.md',
      '附件/.obsidian/图.png',
      '附件/白板/计划/笔迹.ink',
      inkPathOf('项目/组会/11.24 组会准备.md'),
    ])
      expect(isAppFile(p), p).toBe(true)
  })

  it('笔记、附件、名字里带点的不算', () => {
    for (const p of ['收件箱/冰岛行程.md', '附件/课程/ecp/图 1.png', '附件/白板/计划/卡.png', 'canvas-notes.md', '写作/首页.json', '收件箱/待办.md', '剪藏/canvas-feeds 说明.md', '课程/v1.2 说明.md', '笔迹.ink', '白板/笔迹.ink', '附件/笔迹.ink', '附件/白板/计划/旧笔迹.ink'])
      expect(isAppFile(p), p).toBe(false)
  })

  it('清单：软件自己的文件夹和文件名都是 . 开头的（隐藏的那一条就盖住了），笔迹在笔记旁边那一份里', () => {
    for (const p of [...APP_DIRS, ...APP_FILE_NAMES]) expect(isHiddenPath(p), p).toBe(true)
    expect(NOTE_SIDE_FILES).toContain(INK_FILE)
    expect(isNoteSideFile(inkPathOf('白板.md'))).toBe(true)
  })
})
