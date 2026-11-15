import { describe, expect, it } from 'vitest'
import { bibFile } from '../src/shared/bib'
import { plainText, quotePages, ruleCheck, toLatex, wordSegments } from '../src/shared/draft'
import { cleanTopics, groupIdeas, ideaLatex, ideaPlain, ideaSegments, ideasMarkdown, matchIdea, recentTopics, secondaryCites } from '../src/shared/ideas'
import { ideaCellId, isIdea } from '../src/shared/matrix'
import { check, citeTag, fitsTag, idsOfTag, inText, inTextHtml, numbering, pageOfTag, type Items } from '../src/shared/wordCite'
import type { IdeaEntry } from '../src/shared/types'
import { listPapers, openDb, type DB } from '../src/main/db'
import { allIdeas, deleteIdea, getIdea, listIdeas, saveIdea } from '../src/main/ideasDb'
import { makeSnapshot, mergeSnapshot } from '../src/main/sync'
import { exportMarkdown } from '../src/main/exporter'

// BST-GATNet 第 6 页结论里的真句子
const S1 = 'From a biomedical and health informatics perspective, the proposed approach enables privacy-preserving, on-device stress monitoring on low-cost edge devices, reducing deployment and operational costs and facilitating scalable applications across diverse resource settings.'
const NOW = new Date(2026, 10, 15, 12).getTime()
const DAY = 86_400_000

const entry = (id: string, o: Partial<IdeaEntry> = {}): IdeaEntry => ({
  id, paperId: 'bst', mode: 'reflow', text: S1, page: 6, rects: null, blockId: 'b1', blockHash: 'h1', start: 0, end: 10, section: 'V. CONCLUSION',
  use: '', topics: [], how: 'quote', paraphrase: null, createdAt: NOW, updatedAt: NOW,
  paperTitle: 'BST-GATNet: Bidirectional Spatio-Temporal Graph Attention Network for Driver Stress Detection', paperAuthors: ['Mostafa Haghi', 'Nima TaheriNejad', 'Chenpei Xie', 'Yiting Wei'], paperYear: 2026, bibKey: 'haghi2026gatnet',
  ...o
})

describe('灵感：主题、分组、搜索', () => {
  it('主题去掉 #、空白和重名（不分大小写），太长的截短', () => {
    expect(cleanTopics([' #端侧部署 ', '隐私', '', '端侧部署', 'Privacy', 'privacy', 'x'.repeat(40)])).toEqual(['端侧部署', '隐私', 'Privacy', 'x'.repeat(24)])
  })
  it('最近用过的主题在前', () => {
    expect(recentTopics([{ topics: ['数据集'], updatedAt: 1 }, { topics: ['隐私', '端侧部署'], updatedAt: 3 }, { topics: ['数据集'], updatedAt: 5 }])).toEqual(['数据集', '隐私', '端侧部署'])
  })
  it('按主题：一条两个主题两组都有，没打主题的放最后；组按条数排', () => {
    const g = groupIdeas([entry('a', { topics: ['端侧部署', '隐私'] }), entry('b', { topics: ['端侧部署'] }), entry('c')], 'topic', NOW)
    expect(g.map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([['端侧部署', ['a', 'b']], ['隐私', ['a']], ['没打主题', ['c']]])
  })
  it('按论文：一篇里按页码排；按时间：今天、本周、本月、更早', () => {
    const list = [entry('p6', { page: 6, createdAt: NOW }), entry('p1', { page: 1, createdAt: NOW - 2 * DAY }), entry('k', { paperId: 'koe', paperTitle: 'Recent Trends', createdAt: NOW - 40 * DAY })]
    expect(groupIdeas(list, 'paper', NOW).map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([[list[0].paperTitle, ['p1', 'p6']], ['Recent Trends', ['k']]])
    expect(groupIdeas(list, 'time', NOW).map((x) => x.title)).toEqual(['今天', '本周', '更早'])
  })
  it('搜原句、用法、主题、论文和作者，每个词都要有', () => {
    const i = entry('a', { use: '引言第二段', topics: ['端侧部署'] })
    expect(matchIdea(i, 'privacy-preserving 引言')).toBe(true)
    expect(matchIdea(i, '#端侧部署 haghi')).toBe(true)
    expect(matchIdea(i, 'privacy 数据集')).toBe(false)
  })
  it('原句里转引了别的文献要提醒', () => {
    expect(secondaryCites('stress impairs executive functions [1]–[3].')).toEqual(['[1]–[3]'])
    expect(secondaryCites('as shown in [2, 4] and [7]')).toEqual(['[2, 4]', '[7]'])
    expect(secondaryCites(S1)).toEqual([])
  })
})

describe('灵感：复制和送出', () => {
  it('LaTeX：直接引带页码，西文用 ``…\'\'，特殊字符转义；转述不带页码，引用在句末标点前', () => {
    expect(ideaLatex({ text: 'Accuracy is 88.43% & fast.', page: 1 }, 'haghi2026gatnet', 'quote')).toBe("``Accuracy is 88.43\\% \\& fast.''~\\cite[p.~1]{haghi2026gatnet}")
    expect(ideaLatex({ text: '压力会损害执行功能。', page: null }, 'k', 'quote')).toBe('“压力会损害执行功能。”~\\cite{k}')
    expect(ideaLatex({ text: S1, page: 6 }, 'haghi2026gatnet', 'paraphrase', 'On-device detection keeps data private.')).toBe('On-device detection keeps data private~\\cite{haghi2026gatnet}.')
  })
  it('复制文字照 APA', () => {
    expect(ideaPlain(entry('a', { text: 'Short.' }), 'quote')).toBe('“Short.” (Haghi et al., 2026, p. 6)')
    expect(ideaPlain(entry('a'), 'paraphrase', 'It keeps data private.')).toBe('It keeps data private (Haghi et al., 2026).')
  })
  it('送进 Word 的片段：直接引带页码，转述的引用在句末标点前', () => {
    expect(ideaSegments({ paperId: 'bst', text: 'Short.', page: 6 }, 'quote')).toEqual([{ text: '“Short.” ' }, { cite: ['bst'], page: 6 }])
    expect(ideaSegments({ paperId: 'bst', text: 'x', page: 6 }, 'paraphrase', '在端侧检测。')).toEqual([{ text: '在端侧检测' }, { cite: ['bst'] }, { text: '。' }])
  })
  it('导出 Markdown 带上灵感一节', () => {
    const md = ideasMarkdown([entry('a', { use: '引言第二段', topics: ['端侧部署'], paraphrase: { en: 'It keeps data private.' } })]).join('\n')
    expect(md).toContain('## 灵感')
    expect(md).toContain(`> ${S1}`)
    expect(md).toContain('想怎么用：引言第二段')
    expect(md).toContain('#端侧部署')
    expect(md).toContain('转述（English）：It keeps data private.')
    expect(ideasMarkdown([])).toEqual([])
  })
})

describe('对比表写一段里的灵感', () => {
  const cell = ideaCellId('i1')
  it('用到直接引的灵感的那句，引用带页码（LaTeX、Word、纯文本）；没用到、没引这篇的不带', () => {
    const s = quotePages(
      [{ t: `As noted, “${S1}”`, cites: ['bst'], src: [cell] }, { t: 'Other.', cites: ['bst'], src: ['bst:m'] }, { t: '没引这篇。', cites: [], src: [cell] }],
      [{ cellId: cell, paperId: 'bst', page: 6 }]
    )
    expect(s[0].pages).toEqual({ bst: 6 })
    expect(s[1].pages).toBeUndefined()
    expect(s[2].pages).toBeUndefined()
    expect(toLatex(s.slice(0, 1), () => 'haghi2026gatnet', 'en')).toContain('\\cite[p.~6]{haghi2026gatnet}')
    expect(wordSegments(s.slice(0, 1), 'en')).toContainEqual({ cite: ['bst'], page: 6 })
    expect(plainText(s.slice(0, 1), () => 1, 'en')).toContain('[1, p. 6]')
  })
  it('规则查证认得灵感是哪篇的', () => {
    expect(isIdea(cell)).toBe(true)
    expect(ruleCheck({ t: 'x', cites: ['bst'], src: [cell] }, () => 'bst')).toBeNull()
    expect(ruleCheck({ t: 'x', cites: ['other'], src: [cell] }, () => 'bst')).toEqual({ ok: false, why: 'stray' })
  })
})

describe('Word 里带页码的引用', () => {
  const items: Items = { bst: { id: 'bst', title: 'BST-GATNet', authors: ['Mostafa Haghi', 'Nima TaheriNejad', 'Chenpei Xie'], year: 2026, venue: null, volume: null, issue: null, pages: null, doi: null, url: null, publisher: null, arxiv: null } }
  it('tag 带页码来回转', () => {
    expect(citeTag(['bst'], 6)).toBe('prcite:bst#p6')
    expect(idsOfTag('prcite:bst#p6')).toEqual(['bst'])
    expect(pageOfTag('prcite:bst#p6')).toBe(6)
    expect(pageOfTag('prcite:bst')).toBeNull()
    expect(fitsTag(['bst'], 6)).toBe(true)
  })
  it('四种格式写页码；几篇并在一起的不写', () => {
    const num = numbering([['bst']])
    expect(inText(['bst'], 'ieee', num, items, 6)).toBe('[1, p. 6]')
    expect(inText(['bst'], 'gbt', num, items, 6)).toBe('[1]6')
    expect(inTextHtml(['bst'], 'gbt', num, items, 6)).toBe('[1]<sup>6</sup>')
    expect(inTextHtml(['bst'], 'ieee', num, items, 6)).toBeNull()
    expect(inText(['bst'], 'apa', num, items, 6)).toBe('(Haghi et al., 2026, p. 6)')
    expect(inText(['bst'], 'mla', num, items, 6)).toBe('(Haghi et al. 6)')
  })
  it('格式检查不把带页码的引用当成手改或手打', () => {
    const issues = check({ cites: [['bst']], pages: [6], texts: ['[1, p. 6]'], items, style: 'ieee', hasBib: true, bibIds: ['bst'], bodyText: 'x “q” [1, p. 6]\n[1] Haghi' })
    expect(issues.filter((x) => x.level === 'error')).toEqual([])
    const gbt = check({ cites: [['bst']], pages: [6], texts: ['[1]6'], items, style: 'gbt', hasBib: true, bibIds: ['bst'], bodyText: 'x “q”[1]6\n[1] Haghi' })
    expect(gbt.filter((x) => x.text.includes('手打') || x.level === 'error')).toEqual([])
  })
})

function addPaper(db: DB, id: string, hash: string, title: string, authors: string[], year: number, at = 1000): void {
  db.prepare("INSERT INTO papers (id, title, authors, year, tags, file_name, file_hash, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 'f.pdf', ?, ?, ?)").run(id, title, JSON.stringify(authors), year, hash, at, at)
}
const idea = (id: string, paperId: string, at: number, o = {}) => ({ ...entry(id, { paperId, createdAt: at, updatedAt: at }), ...o })
const strip = <T extends IdeaEntry>(i: T) => {
  const { paperTitle: _a, paperAuthors: _b, paperYear: _c, bibKey: _d, ...rest } = i
  return rest
}

describe('灵感的存取和同步', () => {
  it('存了能读回来；改用法和主题不动位置；key 和 .bib 里的一致', () => {
    const db = openDb(':memory:')
    addPaper(db, 'bst', 'H1', 'BST-GATNet: Bidirectional Spatio-Temporal Graph Attention Network for Driver Stress Detection', ['Mostafa Haghi'], 2026)
    addPaper(db, 'dup', 'H2', 'GATNet again', ['Max Haghi'], 2026)
    saveIdea(db, strip(idea('i1', 'bst', 1000, { topics: ['隐私', ' 隐私 '] })))
    saveIdea(db, { ...strip(idea('i1', 'bst', 2000)), use: '引言', topics: ['端侧部署'], blockId: 'changed' })
    const got = getIdea(db, 'i1')!
    expect(got.use).toBe('引言')
    expect(got.topics).toEqual(['端侧部署'])
    expect(got.blockId).toBe('b1')
    const all = allIdeas(db)
    expect(all[0].bibKey).toMatch(/^haghi2026gatnet/)
    expect(bibFile(listPapers(db))).toContain(`{${all[0].bibKey},`)
  })
  it('一句话可以同时是「有质疑」的标注和灵感', () => {
    const db = openDb(':memory:')
    addPaper(db, 'bst', 'H1', 'BST', ['A B'], 2026)
    db.prepare("INSERT INTO annotations (id, paper_id, mode, color, label, text, block_id, start, \"end\", created_at, updated_at) VALUES ('a1', 'bst', 'reflow', 'yellow', 'doubt', ?, 'b1', 0, 10, 1, 1)").run(S1)
    saveIdea(db, strip(idea('i1', 'bst', 1000)))
    expect(listIdeas(db, 'bst')).toHaveLength(1)
    expect((db.prepare('SELECT label FROM annotations WHERE id = ?').get('a1') as { label: string }).label).toBe('doubt')
  })
  it('灵感跟着同步：新的、改的过去，删了的也删；早的不覆盖晚的', () => {
    const a = openDb(':memory:')
    const b = openDb(':memory:')
    addPaper(a, 'pa', 'H1', 'P', ['A B'], 2026)
    addPaper(b, 'pb', 'H1', 'P', ['A B'], 2026)
    saveIdea(a, strip(idea('i1', 'pa', 1000, { use: '旧用法' })))
    saveIdea(a, strip(idea('i2', 'pa', 1000)))
    mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    expect(listIdeas(b, 'pb').map((x) => x.id).sort()).toEqual(['i1', 'i2'])
    // B 晚一点改了 i1，A 删了 i2
    saveIdea(b, { ...getIdea(b, 'i1')!, use: '新用法', updatedAt: 5000 })
    deleteIdea(a, 'i2', 6000)
    mergeSnapshot(a, makeSnapshot(b, 'devB', 'B'))
    mergeSnapshot(b, makeSnapshot(a, 'devA', 'A'))
    for (const [db, pid] of [[a, 'pa'], [b, 'pb']] as const) {
      expect(listIdeas(db, pid).map((x) => [x.id, x.use])).toEqual([['i1', '新用法']])
    }
  })
  it('老版本的快照没有灵感，照样能合', () => {
    const a = openDb(':memory:')
    addPaper(a, 'pa', 'H1', 'P', ['A B'], 2026)
    const snap = makeSnapshot(a, 'devA', 'A')
    delete (snap as { ideas?: unknown }).ideas
    expect(() => mergeSnapshot(openDb(':memory:'), snap)).not.toThrow()
  })
  it('导出 Markdown 带上这篇的灵感', () => {
    const md = exportMarkdown({ title: 'BST', authors: ['A B'], year: 2026, doi: null } as never, [], [], [strip(idea('i1', 'bst', 1000, { use: '引言' }))])
    expect(md).toContain('1 条灵感')
    expect(md).toContain('## 灵感')
    expect(md).toContain('想怎么用：引言')
  })
})
