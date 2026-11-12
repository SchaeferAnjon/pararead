import Database from 'better-sqlite3'
import { strToU8, zipSync } from 'fflate'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readEpub } from '../src/main/epub'
import { citationMeta, parseInput } from '../src/main/urlImport'
import { readZotero } from '../src/main/zotero'

describe('网址导入', () => {
  it('认出 arXiv、DOI 和普通网址', () => {
    expect(parseInput('1706.03762')).toEqual({ kind: 'arxiv', value: '1706.03762' })
    expect(parseInput('https://arxiv.org/abs/1706.03762v7')).toEqual({ kind: 'arxiv', value: '1706.03762' })
    expect(parseInput('arXiv:2401.01234')).toEqual({ kind: 'arxiv', value: '2401.01234' })
    expect(parseInput('https://doi.org/10.1109/TCAD.2019.2931188')).toEqual({ kind: 'doi', value: '10.1109/TCAD.2019.2931188' })
    expect(parseInput('10.1145/3460120.3484765')).toEqual({ kind: 'doi', value: '10.1145/3460120.3484765' })
    expect(parseInput('https://ieeexplore.ieee.org/document/8789590')).toEqual({ kind: 'url', value: 'https://ieeexplore.ieee.org/document/8789590' })
    expect(parseInput('hello')).toBeNull()
  })
  it('论文网页的 citation_* 元数据', () => {
    const html = `<head><meta name="citation_title" content="SIMPLER MAGIC"><meta name="citation_author" content="Ben-Hur, Rotem"><meta name="citation_author" content="Ronen, Ronny">
      <meta name="citation_pdf_url" content="/pdf/x.pdf"><meta name="citation_doi" content="10.1109/x"><meta name="citation_publication_date" content="2020/10/01"></head>`
    const r = citationMeta(html, 'https://example.org/paper/1')
    expect(r.pdfUrl).toBe('https://example.org/pdf/x.pdf')
    expect(r.meta).toMatchObject({ title: 'SIMPLER MAGIC', authors: ['Ben-Hur, Rotem', 'Ronen, Ronny'], doi: '10.1109/x', year: 2020 })
  })
})

describe('EPUB', () => {
  it('按 spine 顺序转成 Markdown，章名降一级，图片内嵌，封面取出', () => {
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>
      <dc:title>Deep Book</dc:title><dc:creator>Ada Lovelace</dc:creator><dc:date>1843-01-01</dc:date></metadata>
      <manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="img" href="img/fig.png" media-type="image/png" properties="cover-image"/></manifest>
      <spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>`
    const ch1 = `<html><body><h1>Chapter One</h1><p>First <em>idea</em> here.</p><ul><li>a</li><li>b</li></ul><p><img src="../img/fig.png" alt="fig"/></p></body></html>`
    const ch2 = `<html><body><section><h1>Preface</h1><p>Before all.</p></section></body></html>`
    const zip = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/text/ch1.xhtml': strToU8(ch1),
      'OEBPS/text/ch2.xhtml': strToU8(ch2),
      'OEBPS/img/fig.png': new Uint8Array([137, 80, 78, 71])
    })
    const b = readEpub(zip)
    expect(b).toMatchObject({ title: 'Deep Book', authors: ['Ada Lovelace'], year: 1843 })
    expect(b.md.indexOf('## Preface')).toBeLessThan(b.md.indexOf('## Chapter One'))
    expect(b.md).toContain('First *idea* here.')
    expect(b.md).toContain('- a\n- b')
    expect(b.md).toContain('![fig](data:image/png;base64,')
    expect(b.cover?.type).toBe('image/png')
  })
})

describe('Zotero', () => {
  it('列出文件夹和带 PDF 的条目，跳过回收站里的', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-'))
    const db = new Database(join(dir, 'zotero.sqlite'))
    db.exec(`
      CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
      CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, key TEXT);
      CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT, contentType TEXT, path TEXT, linkMode INT);
      CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
      CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value);
      CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
      CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
      CREATE TABLE itemCreators (itemID INT, creatorID INT, orderIndex INT);
      CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INT);
      CREATE TABLE collectionItems (collectionID INT, itemID INT);
      CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
      INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment'), (3, 'note');
      INSERT INTO items VALUES (10, 1, 'PARENT1'), (11, 2, 'ATT11'), (20, 1, 'PARENT2'), (21, 2, 'ATT21'), (30, 1, 'GONE');
      INSERT INTO itemAttachments VALUES (11, 10, 'application/pdf', 'storage:paper.pdf', 1), (21, 20, 'text/html', 'storage:page.html', 1);
      INSERT INTO fields VALUES (1, 'title'), (2, 'date'), (3, 'DOI'), (4, 'publicationTitle');
      INSERT INTO itemDataValues VALUES (1, 'SIMPLER MAGIC'), (2, '2020-10-01 2020-10-01'), (3, '10.1109/x'), (4, 'IEEE TCAD'), (5, 'Web page');
      INSERT INTO itemData VALUES (10, 1, 1), (10, 2, 2), (10, 3, 3), (10, 4, 4), (20, 1, 5);
      INSERT INTO creators VALUES (1, 'Rotem', 'Ben-Hur'), (2, 'Shahar', 'Kvatinsky');
      INSERT INTO itemCreators VALUES (10, 2, 1), (10, 1, 0);
      INSERT INTO collections VALUES (1, '存内计算', NULL), (2, 'MAGIC', 1);
      INSERT INTO collectionItems VALUES (2, 10), (1, 20);
      INSERT INTO deletedItems VALUES (30);
    `)
    db.close()
    mkdirSync(join(dir, 'storage/ATT11'), { recursive: true })
    writeFileSync(join(dir, 'storage/ATT11/paper.pdf'), '%PDF-1.4')
    const lib = readZotero(dir)
    expect(lib.collections).toEqual([
      { id: 1, name: '存内计算', parentId: null, count: 0 },
      { id: 2, name: 'MAGIC', parentId: 1, count: 1 }
    ])
    const it = lib.items.find((i) => i.itemId === 10)!
    expect(it).toMatchObject({ title: 'SIMPLER MAGIC', authors: ['Rotem Ben-Hur', 'Shahar Kvatinsky'], year: 2020, doi: '10.1109/x', venue: 'IEEE TCAD', collections: [2] })
    expect(it.file).toBe(join(dir, 'storage/ATT11/paper.pdf'))
    expect(lib.items.find((i) => i.itemId === 20)!.file).toBeNull()
    expect(lib.items.some((i) => i.itemId === 30)).toBe(false)
  })
})
