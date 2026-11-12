import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mapNote, mapPaper, readScholaread, type SrNoteRow, type SrPaperRow } from '../src/main/scholaread'

const paperRow = (o: Partial<SrPaperRow>): SrPaperRow => ({
  _id: 3,
  reading_id: 'r',
  title: 'An Efficient Robust Serial IMPLY-based In-Memristor Adder',
  name: null,
  authors: '[{"name":"Fabian Seiler","author_id":""},{"author_id":"","name":"Gulafshan"}]',
  tags: '[]',
  file_path: '',
  cache_path: '8799852b95af9e20cf4e6f80e874d791.pdf',
  doi: '10.1109/X',
  read_at: '2026-10-06T11:37:05.490Z',
  create_at: '2026-07-01T21:37:02Z',
  read_mode: 'web:reflow',
  ...o
})

const noteRow = (o: Partial<SrNoteRow>): SrNoteRow => ({
  _id: 1,
  note_id: 'zXVv',
  paper_row_id: 3,
  type: 'mark',
  text: 'promising candidates for post-CMOS computing',
  lines: '[{"ld":{"5":[66]},"p":1,"r":[65,71],"bb":0,"lb":2}]',
  note_content: null,
  create_at: '2026-07-15T15:56:22.227Z',
  update_at: null,
  mark_style: '{"color":"","shape":""}',
  ...o
})

describe('mapPaper', () => {
  it('file_path 不存在时找 files/pdf/<cache_path>', () => {
    const m = mapPaper(paperRow({}), '/SR', (p) => p === '/SR/files/pdf/8799852b95af9e20cf4e6f80e874d791.pdf')
    expect(m.file).toBe('/SR/files/pdf/8799852b95af9e20cf4e6f80e874d791.pdf')
    expect(m.authors).toEqual(['Fabian Seiler', 'Gulafshan'])
    expect(m.readMode).toBe('reflow')
    expect(m.createdAt).toBe(Date.parse('2026-07-01T21:37:02Z'))
  })
  it('file_path 存在就用它', () => {
    const m = mapPaper(paperRow({ file_path: '/a/b.pdf' }), '/SR', () => true)
    expect(m.file).toBe('/a/b.pdf')
  })
  it('两个都没有时 file 为空', () => {
    expect(mapPaper(paperRow({ cache_path: null }), '/SR', () => false).file).toBeNull()
  })
  it('坏 JSON 的作者和标签不报错', () => {
    const m = mapPaper(paperRow({ authors: 'oops', tags: '["ML",{"name":"IMC"}]' }), '/SR', () => false)
    expect(m.authors).toEqual([])
    expect(m.tags).toEqual(['ML', 'IMC'])
  })
})

describe('mapNote', () => {
  it('mark 默认色映射成黄，页码取 lines[0].p', () => {
    const n = mapNote(noteRow({}))
    expect(n).toMatchObject({ kind: 'mark', color: 'yellow', page: 1, note: '', sourceId: 'scholaread:zXVv' })
  })
  it('note 带笔记内容，黄色下划线按黄色高亮', () => {
    const n = mapNote(noteRow({ type: 'note', note_content: '最先进的加法器\n', mark_style: '{"color":"yellow","shape":"straight_line"}' }))
    expect(n).toMatchObject({ kind: 'note', color: 'yellow', note: '最先进的加法器' })
  })
  it('其他颜色保留', () => {
    expect(mapNote(noteRow({ mark_style: '{"color":"green"}' })).color).toBe('green')
  })
})

describe('readScholaread', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-db-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('读同结构的库', () => {
    const f = join(dir, 'scholaread.sqlite')
    const db = new Database(f)
    db.exec(`CREATE TABLE reading_list (_id INTEGER PRIMARY KEY AUTOINCREMENT, reading_id TEXT, type TEXT, name TEXT, title TEXT, authors TEXT, url TEXT,
      link TEXT, hash TEXT, content_type TEXT, paper_id TEXT, share_id TEXT, blob_upload_id TEXT, total_num INTEGER, read_mode TEXT, read_progress INTEGER,
      read_point TEXT, read_state TEXT, read_at TEXT, create_at TEXT, update_at TEXT, tags TEXT, file_path TEXT, size TEXT, cache_path TEXT, picture TEXT,
      doi TEXT, arxiv_id TEXT, preset INTEGER, doc_type TEXT);
      CREATE TABLE notes (_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, note_id TEXT, paper_row_id INTEGER NOT NULL, reading_id TEXT, share_id TEXT, type TEXT,
      text TEXT, lines TEXT, note_content TEXT, create_at INTEGER, update_at INTEGER, mark_style TEXT);
      INSERT INTO reading_list (title, authors, file_path) VALUES ('T', '[]', '/x.pdf');
      INSERT INTO notes (note_id, paper_row_id, type, text) VALUES ('n1', 1, 'mark', 'hello');`)
    db.close()
    const r = readScholaread(f)
    expect(r.papers).toHaveLength(1)
    expect(r.notes[0].text).toBe('hello')
  })

  const real = join(homedir(), 'Library/Application Support/scholaread/scholaread.sqlite')
  it.skipIf(!existsSync(real))('只读打开用户真实的库：3 篇、11 条，文件不被改动', () => {
    const before = statSync(real).mtimeMs
    const r = readScholaread(real)
    expect(r.papers).toHaveLength(3)
    expect(r.notes).toHaveLength(11)
    const notes = r.notes.map(mapNote)
    expect(notes.filter((n) => n.kind === 'note')).toHaveLength(3)
    expect(notes.every((n) => n.color === 'yellow')).toBe(true)
    const files = r.papers.map((p) => mapPaper(p, join(homedir(), 'Library/Application Support/scholaread')).file)
    expect(files.every((f) => f && existsSync(f))).toBe(true)
    expect(statSync(real).mtimeMs).toBe(before)
  })
})
