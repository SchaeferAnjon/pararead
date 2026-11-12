import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFolder, deleteAnnotation, listAnnotations, openDb, renameFolder, saveAnnotation, setPaperFolders, type DB } from '../src/main/db'
import { makeSnapshot, mergeSnapshot } from '../src/main/sync'
import type { Annotation } from '../src/shared/types'

function addPaper(db: DB, id: string, hash: string, title: string, at: number): void {
  db.prepare("INSERT INTO papers (id, title, authors, tags, file_name, file_hash, created_at, updated_at) VALUES (?, ?, '[]', '[]', 'f.pdf', ?, ?, ?)").run(id, title, hash, at, at)
}
const ann = (id: string, paperId: string, at: number, note = ''): Annotation => ({
  id, paperId, mode: 'reflow', color: 'yellow', text: 'abc', note, page: null, rects: null, blockId: 'b1', blockHash: 'h1', start: 0, end: 3, section: '', createdAt: at, updatedAt: at
})

afterEach(() => vi.useRealTimers())

describe('多设备同步', () => {
  it('一台在读、另一台在整理：阅读进度和文件夹各自合并，互不覆盖', () => {
    const a = openDb(':memory:')
    const b = openDb(':memory:')
    addPaper(a, 'pa', 'H1', 'P', 1000)
    addPaper(b, 'pb', 'H1', 'P', 1000)
    createFolder(a, 'f1', 'F', null)
    mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    setPaperFolders(a, 'pa', ['f1'], []) // A 整理
    b.prepare('UPDATE papers SET progress = 0.4, read_updated_at = ? WHERE id = ?').run(Date.now() + 1000, 'pb') // B 稍后在读
    mergeSnapshot(a, makeSnapshot(b, 'devB', 'B'))
    mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    for (const [db, id] of [[a, 'pa'], [b, 'pb']] as const) {
      expect((db.prepare('SELECT progress FROM papers WHERE id = ?').get(id) as { progress: number }).progress).toBe(0.4)
      expect((db.prepare('SELECT folder_id FROM paper_folders WHERE paper_id = ?').all(id) as { folder_id: string }[]).map((x) => x.folder_id)).toEqual(['f1'])
    }
  })
  it('另一台的进度、文件夹、笔记合进来；本机缺的论文要文件', () => {
    const a = openDb(':memory:')
    const b = openDb(':memory:')
    addPaper(a, 'pa', 'H1', 'Paper One', 1000)
    addPaper(a, 'pa2', 'H2', 'Only on A', 1000)
    addPaper(b, 'pb', 'H1', 'Paper One', 1000) // 同一个文件，两边 id 不同
    createFolder(a, 'f1', '存内计算', null)
    setPaperFolders(a, 'pa', ['f1'], [])
    a.prepare('UPDATE papers SET progress = 0.6, read_updated_at = 5000 WHERE id = ?').run('pa')
    saveAnnotation(a, ann('n1', 'pa', 4000, '要点'))
    const r = mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    expect(r.needFiles.map((x) => x.hash)).toEqual(['H2'])
    const pb = b.prepare('SELECT progress FROM papers WHERE id = ?').get('pb') as { progress: number }
    expect(pb.progress).toBe(0.6)
    expect((b.prepare('SELECT folder_id FROM paper_folders WHERE paper_id = ?').all('pb') as { folder_id: string }[]).map((x) => x.folder_id)).toEqual(['f1'])
    expect(listAnnotations(b, 'pb').map((x) => x.note)).toEqual(['要点'])
  })
  it('晚的改动赢，删除记录传过去，早的不覆盖晚的', () => {
    const a = openDb(':memory:')
    const b = openDb(':memory:')
    addPaper(a, 'pa', 'H1', 'P', 1000)
    addPaper(b, 'pb', 'H1', 'P', 1000)
    createFolder(a, 'f1', '旧名', null)
    saveAnnotation(a, ann('n1', 'pa', 2000))
    mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    // B 上稍后改文件夹名、删笔记
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    renameFolder(b, 'f1', '新名')
    deleteAnnotation(b, 'n1')
    mergeSnapshot(a, makeSnapshot(b, 'devB', 'B'))
    expect((a.prepare('SELECT name FROM folders WHERE id = ?').get('f1') as { name: string }).name).toBe('新名')
    expect(listAnnotations(a, 'pa')).toHaveLength(0)
    // A 的旧快照再合进 B：笔记不会复活，名字不会改回去
    mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    expect(listAnnotations(b, 'pb')).toHaveLength(0)
    expect((b.prepare('SELECT name FROM folders WHERE id = ?').get('f1') as { name: string }).name).toBe('新名')
  })
})
