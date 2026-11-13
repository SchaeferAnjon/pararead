import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  addChat,
  getCachedTranslation,
  listAnnotations,
  listChats,
  openDb,
  putTranslation,
  reflowState,
  saveAnnotation,
  setReflow,
  deleteAnnotation
} from '../src/main/db'
import { exportMarkdown } from '../src/main/exporter'
import { maskKey, SettingsStore } from '../src/main/settings'
import type { Annotation, Paper } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'sr-store-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const ann = (o: Partial<Annotation>): Annotation => ({
  id: 'a1',
  paperId: 'p1',
  mode: 'reflow',
  color: 'yellow',
  text: 'some text',
  note: '',
  page: null,
  rects: null,
  blockId: 'b1',
  blockHash: 'b1',
  start: 0,
  end: 9,
  section: 'I. INTRODUCTION',
  createdAt: 1,
  updatedAt: 1,
  ...o
})

describe('sqlite 库', () => {
  const db = openDb(join(dir, 'library.sqlite'))
  // Windows 上开着的库文件删不掉：先关再删临时目录
  afterAll(() => db.close())

  it('译文按键缓存', () => {
    expect(getCachedTranslation(db, 'k')).toBeNull()
    putTranslation(db, 'k', '简体中文', '译文', 'glm-5.3-flash')
    expect(getCachedTranslation(db, 'k')).toBe('译文')
  })

  it('高亮存取、改颜色和笔记、删除', () => {
    saveAnnotation(db, ann({}))
    saveAnnotation(db, ann({ id: 'a2', mode: 'pdf', page: 3, rects: [[0.1, 0.2, 0.3, 0.02]], blockId: null }))
    saveAnnotation(db, ann({ color: 'blue', note: '笔记', updatedAt: 2 }))
    const list = listAnnotations(db, 'p1')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ color: 'blue', note: '笔记', mode: 'reflow' })
    expect(list[1]).toMatchObject({ mode: 'pdf', page: 3, rects: [[0.1, 0.2, 0.3, 0.02]] })
    deleteAnnotation(db, 'a2')
    expect(listAnnotations(db, 'p1')).toHaveLength(1)
  })

  it('重排状态：basic 好了优先用 basic', () => {
    setReflow(db, 'p1', 'flash', 'done')
    setReflow(db, 'p1', 'basic', 'running', { log: 'MFR Predict: 40%' })
    let s = reflowState(db, 'p1')
    expect(s).toMatchObject({ ready: 'flash', running: 'basic', logLine: 'MFR Predict: 40%' })
    setReflow(db, 'p1', 'basic', 'done')
    s = reflowState(db, 'p1')
    expect(s.ready).toBe('basic')
    setReflow(db, 'p2', 'flash', 'failed', { error: '退出码 1' })
    expect(reflowState(db, 'p2')).toMatchObject({ ready: null, error: '退出码 1' })
  })

  it('对话历史按时间', () => {
    addChat(db, { id: 'c1', paperId: 'p1', role: 'user', content: '总结全文', quote: null, image: null, createdAt: 1 })
    addChat(db, { id: 'c2', paperId: 'p1', role: 'assistant', content: '答', quote: null, image: null, createdAt: 2 })
    expect(listChats(db, 'p1').map((c) => c.role)).toEqual(['user', 'assistant'])
  })
})

describe('设置文件', () => {
  it('权限 0600，Key 先读设置再读这家服务的环境变量', () => {
    const f = join(dir, 'settings.json')
    const old = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'env-key-1234'
    const s = new SettingsStore(f)
    expect(s.apiKey()).toEqual({ key: 'env-key-1234', source: 'env', env: 'DEEPSEEK_API_KEY' })
    s.set({ readSize: 20 })
    // Windows 没有 POSIX 权限位，文件只在用户自己的目录里
    if (process.platform !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600)
    s.setKey('file-key-abcd')
    expect(s.apiKey().source).toBe('settings')
    const v = s.view()
    expect(v.apiKeyMasked).toBe('••••••••abcd')
    expect(JSON.stringify(v)).not.toContain('file-key')
    expect(new SettingsStore(f).get().readSize).toBe(20)
    process.env.DEEPSEEK_API_KEY = old
  })
  it('0.1 的 apiKey 迁成智谱 Coding Plan 的 Key', () => {
    const f = join(dir, 'old.json')
    writeFileSync(f, '{"apiKey":"old-key-9999","textModel":"glm-5.3-flash"}')
    const s = new SettingsStore(f)
    expect(s.get().provider).toBe('zhipu-coding')
    expect(s.apiKey()).toMatchObject({ key: 'old-key-9999', source: 'settings' })
    expect(s.get().textModel).toBe('glm-5.3-flash')
  })
  it('已有文件权限过宽时改回 0600', () => {
    const f = join(dir, 'loose.json')
    writeFileSync(f, '{"theme":"dark"}', { mode: 0o644 })
    const s = new SettingsStore(f)
    expect(s.get().theme).toBe('dark')
    // Windows 没有 POSIX 权限位，文件只在用户自己的目录里
    if (process.platform !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(readFileSync(f, 'utf8')).toContain('dark')
  })
  it('遮挡显示', () => {
    expect(maskKey('')).toBe('')
    expect(maskKey('abcdefa1B2')).toBe('••••••••a1B2')
  })
})

describe('导出 Markdown', () => {
  it('按小节分组，原文模式的按页码，笔记跟在引用后', () => {
    const paper = { title: 'SIMPLER MAGIC', authors: ['A', 'B'], year: 2019, doi: '10.1/x' } as Paper
    const md = exportMarkdown(
      paper,
      [
        ann({ id: '1', section: 'II. PRELIMINARIES', text: 'second', start: 5 }),
        ann({ id: '2', section: 'I. INTRODUCTION', text: 'first', note: '我的笔记' }),
        ann({ id: '3', mode: 'pdf', section: '', page: 2, text: 'on page', color: 'green' })
      ],
      ['SIMPLER MAGIC', 'I. INTRODUCTION', 'II. PRELIMINARIES']
    )
    const i1 = md.indexOf('## I. INTRODUCTION')
    const i2 = md.indexOf('## II. PRELIMINARIES')
    const i3 = md.indexOf('## 第 2 页')
    expect(i1).toBeGreaterThan(0)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    expect(md).toContain('> first\n> （黄）\n\n我的笔记')
    expect(md).toContain('（原文 第 2 页，绿）')
    expect(md).toContain('作者：A, B')
    expect(md).not.toMatch(/[—–]/)
  })
})
