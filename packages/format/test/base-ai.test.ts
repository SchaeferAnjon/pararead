/**
 * 数据库 AI 列（task-i921u「AI 生成一列」）：写法读写、只换那几行、一格怎么写、手改、整列重跑不动手改的、删列。
 */
import { describe, expect, it } from 'vitest'
import { parseAiCalloutHead } from '../src/ai-callout'
import {
  aiAsk,
  aiCellOf,
  aiCellWrites,
  aiColOf,
  aiDropColumn,
  aiHandEdit,
  aiNoteFolder,
  aiNoteSummary,
  aiParse,
  aiQueue,
  aiSourceKey,
  type AiColDef,
  guessColName,
  guessOutput,
} from '../src/base-ai'
import { parseBaseDoc, setPropDef, setViewOrder } from '../src/base-doc'
import { baseContext, colTypeOf, queryView } from '../src/base-rows'
import { type FileWrite, undoWrites } from '../src/base-write'
import { aiFilled, prop } from '../src/props'
import { AI_BASE, AI_LECTURE, AI_NOTE, ECP_BASE, LECTURES, records } from './base-samples'
import { lineDiff } from './line-diff'

const DEF: AiColDef = { type: 'ai', prompt: '每一讲的练习题', output: 'note', folder: '课程/ecp/练习题', twoWay: '所属讲', reads: 'note', newRows: 'auto', ai: null }
const BY = 'Claude Code · Opus 5.5'

/** 课程计划那一块加一列 AI 列（和界面「先跑前 3 条」时写的一样） */
const withCol = (src: string, name: string, def: AiColDef) => setViewOrder(setPropDef(src, name, def), 0, [...parseBaseDoc(src).views[0]!.columns, name])

function ctxOf(src: string, files: Record<string, string>) {
  const doc = parseBaseDoc(src)
  const folders = Object.values(doc.props).flatMap((d) => (d.type === 'ai' && d.folder ? [d.folder] : []))
  const related = Object.fromEntries(folders.map((f) => [f, records(Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(f + '/'))))]))
  return baseContext(doc, records(files), { related, today: '2026-11-22' })
}

/** 写完以后的样子 */
function apply(files: Record<string, string>, ws: FileWrite[]): Record<string, string> {
  const out = { ...files }
  for (const w of ws) {
    expect(out[w.path] ?? '').toBe(w.before)
    if (w.after === '') delete out[w.path]
    else out[w.path] = w.after
  }
  return out
}

describe('写法：base 块里 type: ai 那一段', () => {
  it('读：要求、放成什么、放哪、连回来那一行、读什么、新加的自动填、单独选的家', () => {
    const doc = parseBaseDoc(AI_BASE)
    expect(doc.props['练习题']).toEqual(DEF)
    expect(doc.props['难度']).toEqual({ type: 'ai', prompt: '这一讲对初学者难不难：易、中、难', output: 'select', folder: null, twoWay: null, reads: 'note', newRows: 'manual', ai: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'high' } })
  })

  it('写：加一列只多那几行，和设计页的一字不差；原样写回去一个字不动', () => {
    const src = withCol(ECP_BASE, '练习题', DEF)
    const d = lineDiff(ECP_BASE, src)
    expect(d.added).toEqual(['  练习题:', '    type: ai', '    prompt: 每一讲的练习题', '    output: note', '    folder: 课程/ecp/练习题', '    twoWay: 所属讲', '    reads: note', '    newRows: auto', '      - 练习题'])
    expect(d.removed).toEqual([])
    expect(setPropDef(src, '练习题', parseBaseDoc(src).props['练习题']!)).toBe(src)
    expect(setPropDef(AI_BASE, '难度', parseBaseDoc(AI_BASE).props['难度']!)).toBe(AI_BASE)
  })

  it('改要求只换 prompt 那一行；关「新加的自动填」只换 newRows 那一行；选了家多一行 ai，换回跟 AI 对话拿掉', () => {
    const d = parseBaseDoc(AI_BASE).props['练习题'] as AiColDef
    const a = setPropDef(AI_BASE, '练习题', { ...d, prompt: '每一讲出 5 道题' })
    expect(lineDiff(AI_BASE, a)).toEqual({ removed: ['    prompt: 每一讲的练习题'], added: ['    prompt: 每一讲出 5 道题'] })
    const b = setPropDef(AI_BASE, '练习题', { ...d, newRows: 'manual' })
    expect(lineDiff(AI_BASE, b)).toEqual({ removed: ['    newRows: auto'], added: ['    newRows: manual'] })
    const c = setPropDef(AI_BASE, '练习题', { ...d, ai: { engine: 'codex' } })
    expect(lineDiff(AI_BASE, c)).toEqual({ removed: [], added: ['    ai: codex'] })
    expect(setPropDef(c, '练习题', d)).toBe(AI_BASE)
  })

  it('格子的类型按放成什么：练习题当文字、难度当单选（排序、筛选、看板照这个）', () => {
    const ctx = ctxOf(AI_BASE, {})
    expect(colTypeOf(ctx, '练习题')).toBe('text')
    expect(colTypeOf(ctx, '难度')).toBe('select')
    expect(aiColOf(ctx, '练习题')?.output).toBe('note')
    expect(aiColOf(ctx, '状态')).toBeNull()
  })
})

describe('说要什么：猜列名、猜放成什么、默认放哪', () => {
  it('照原型的几句', () => {
    expect(guessColName('每一讲的练习题')).toBe('练习题')
    expect(guessOutput('每一讲的练习题')).toBe('note')
    expect(guessColName('这一讲的 2 到 3 个关键词')).toBe('关键词')
    expect(guessOutput('这一讲的 2 到 3 个关键词')).toBe('multi')
    expect(guessOutput('这一讲对初学者难不难：易、中、难')).toBe('select')
    expect(guessColName('每一讲出 3 道练习题，由浅到深')).toBe('练习题')
    expect(guessOutput('用一句话概括这一讲讲了什么')).toBe('text')
    expect(guessOutput('这一讲有几个公式')).toBe('number')
    expect(aiNoteFolder('课程/ecp/课程计划', '练习题')).toBe('课程/ecp/练习题')
    expect(aiNoteFolder('书单', '摘要')).toBe('摘要')
  })
})

describe('一格怎么写', () => {
  const src = withCol(ECP_BASE, '练习题', DEF)
  const P3 = '课程/ecp/课程计划/第3讲 生产.md'
  const N3 = '课程/ecp/练习题/第3讲 生产 练习题.md'

  it('练习题：那一讲开头多「练习题」「AI填的」两行，新建一篇：开头所属讲、正文 [!ai] 块（哪家、哪个模型、读了哪篇）', () => {
    const ctx = ctxOf(src, LECTURES)
    const ws = aiCellWrites(ctx, { path: P3, col: '练习题', value: '1. 短期里为什么只有劳动能变？\n2. 边际产量为什么先升后降？\n3. 平均产量最高点为什么正好和边际产量相交？', by: BY, read: '读了《第3讲 生产》', noteText: null })
    expect(ws.map((w) => w.path)).toEqual([P3, N3])
    expect(lineDiff(LECTURES[P3]!, ws[0]!.after)).toEqual({ removed: [], added: ['练习题: "[[第3讲 生产 练习题]]"', 'AI填的: 练习题'] })
    expect(ws[1]!.before).toBe('')
    expect(ws[1]!.after).toBe(
      '---\n所属讲: "[[第3讲 生产]]"\n---\n\n> [!ai] 练习题 · Claude Code · Opus 5.5 · 读了《第3讲 生产》\n> 1. 短期里为什么只有劳动能变？\n> 2. 边际产量为什么先升后降？\n> 3. 平均产量最高点为什么正好和边际产量相交？\n',
    )
    expect(parseAiCalloutHead('练习题 · Claude Code · Opus 5.5 · 读了《第3讲 生产》').by).toContain('Claude Code')
    // 格子：AI 写的，「3 道」、第一题
    const after = apply(LECTURES, ws)
    const ctx2 = ctxOf(src, after)
    const cell = aiCellOf(ctx2, ctx2.recs.find((r) => r.path === P3)!, '练习题')
    expect(cell).toEqual({ state: 'ai', text: '第3讲 生产 练习题', items: [], note: { name: '第3讲 生产 练习题', path: N3, count: 3, first: '短期里为什么只有劳动能变？' } })
  })

  it('重跑：只换那篇里这一块（第 2 版），块下面自己写的答案不动；那一讲一个字不动', () => {
    const files = { ...LECTURES, [P3]: AI_LECTURE, [N3]: AI_NOTE }
    const ctx = ctxOf(src, files)
    const ws = aiCellWrites(ctx, { path: P3, col: '练习题', value: '1. 新的一题\n2. 又一题', by: BY, read: '读了《第3讲 生产》', noteText: AI_NOTE })
    expect(ws.map((w) => w.path)).toEqual([N3])
    expect(lineDiff(AI_NOTE, ws[0]!.after)).toEqual({
      removed: ['> [!ai] 练习题 · Claude Code · Opus 5.5 · 读了《第3讲 生产》', '> 1. 短期里为什么只有劳动能变？', '> 2. 边际产量为什么先升后降？', '> 3. 平均产量最高点为什么正好和边际产量相交？'],
      added: ['> [!ai] 练习题（第 2 版） · Claude Code · Opus 5.5 · 读了《第3讲 生产》', '> 1. 新的一题', '> 2. 又一题'],
    })
    expect(ws[0]!.after).toContain('我的答案：第 1 题，因为厂房一时改不了。')
    // 撤回回到原样
    expect(apply(apply(files, ws), undoWrites(ws))).toEqual(files)
  })

  it('单选、多选、数字：只写那一行和「AI填的」；已经记着的不重复记', () => {
    const s2 = withCol(withCol(ECP_BASE, '难度', { ...DEF, output: 'select', folder: null, twoWay: null }), '关键词', { ...DEF, output: 'multi', folder: null, twoWay: null })
    const ctx = ctxOf(s2, LECTURES)
    const a = aiCellWrites(ctx, { path: P3, col: '难度', value: '中', by: BY, read: '' })
    expect(lineDiff(LECTURES[P3]!, a[0]!.after).added).toEqual(['难度: 中', 'AI填的: 难度'])
    const ctx2 = ctxOf(s2, apply(LECTURES, a))
    const b = aiCellWrites(ctx2, { path: P3, col: '关键词', value: ['边际产量', '短期'], by: BY, read: '' })
    expect(lineDiff(a[0]!.after, b[0]!.after)).toEqual({ removed: ['AI填的: 难度'], added: ['AI填的: 难度, 关键词', '关键词: [边际产量, 短期]'] })
    const ctx3 = ctxOf(s2, apply(apply(LECTURES, a), b))
    expect(aiCellOf(ctx3, ctx3.recs.find((r) => r.path === P3)!, '关键词')).toEqual({ state: 'ai', text: '边际产量, 短期', items: ['边际产量', '短期'] })
    // 再跑一次写一样的：一个字不动
    expect(aiCellWrites(ctx3, { path: P3, col: '难度', value: '中', by: BY, read: '' })).toEqual([])
  })

  it('手改：值换掉，「AI填的」里去掉这一列（算你写的）；整列重跑跳过它，只跑空着的也跳过', () => {
    const s2 = withCol(ECP_BASE, '难度', { ...DEF, output: 'select', folder: null, twoWay: null })
    let files = { ...LECTURES }
    for (const p of Object.keys(LECTURES)) files = apply(files, aiCellWrites(ctxOf(s2, files), { path: p, col: '难度', value: '易', by: BY, read: '' }))
    const ctx = ctxOf(s2, files)
    const P5 = '课程/ecp/课程计划/第5讲 博弈初步.md'
    const w = aiHandEdit(ctx, P5, '难度', '中')
    expect(lineDiff(files[P5]!, w[0]!.after)).toEqual({ removed: ['难度: 易', 'AI填的: 难度'], added: ['难度: 中'] })
    files = apply(files, w)
    const ctx2 = ctxOf(s2, files)
    const rec5 = ctx2.recs.find((r) => r.path === P5)!
    expect(aiCellOf(ctx2, rec5, '难度').state).toBe('mine')
    expect(aiFilled(rec5.text)).toEqual([])
    const order = queryView(ctx2, 0).rows.map((r) => r.path)
    expect(aiQueue(ctx2, '难度', 'all', order)).toHaveLength(7)
    expect(aiQueue(ctx2, '难度', 'all', order)).not.toContain(P5)
    expect(aiQueue(ctx2, '难度', 'empty', order)).toEqual([])
    expect(aiQueue(ctxOf(s2, LECTURES), '难度', 'sample', order)).toEqual(order.slice(0, 3))
  })

  it('练习题那篇头上写着「改过」：算你写的，整列重跑跳过', () => {
    const files = { ...LECTURES, [P3]: AI_LECTURE, [N3]: AI_NOTE.replace('读了《第3讲 生产》', '读了《第3讲 生产》 · 改过') }
    const ctx = ctxOf(src, files)
    expect(aiCellOf(ctx, ctx.recs.find((r) => r.path === P3)!, '练习题').state).toBe('mine')
    expect(aiQueue(ctx, '练习题', 'all', Object.keys(LECTURES))).not.toContain(P3)
  })

  it('删除这一列（连 AI 建的笔记）：每一讲拿掉那两行，AI 建的那篇删掉；块下面写过答案的单独列出来', () => {
    const files = { ...LECTURES, [P3]: AI_LECTURE.replace('难度: 中\nAI填的: 练习题, 难度', 'AI填的: 练习题'), [N3]: AI_NOTE }
    const ctx = ctxOf(src, files)
    const { writes, written } = aiDropColumn(ctx, '练习题', { [N3]: AI_NOTE })
    expect(writes.map((w) => [w.path, w.after === ''])).toEqual([
      [P3, false],
      [N3, true],
    ])
    expect(prop(writes[0]!.after, '练习题')).toBeUndefined()
    expect(prop(writes[0]!.after, 'AI填的')).toBeUndefined()
    expect(written).toEqual([N3])
    expect(aiDropColumn(ctx, '练习题', { [N3]: AI_NOTE.replace('\n我的答案：第 1 题，因为厂房一时改不了。\n', '') }).written).toEqual([])
  })
})

describe('问 AI、认回答', () => {
  const ctx = ctxOf(withCol(ECP_BASE, '练习题', DEF), LECTURES)
  const rec = ctx.recs.find((r) => r.name === '第3讲 生产')!

  it('问的话：要求、放成什么、这一讲的正文（开头属性不给），第一行是命令名', () => {
    const a = aiAsk(DEF, '练习题', rec, [])
    expect(a.prompt.split('\n')[0]).toBe('命令：数据库AI列')
    expect(a.prompt).toContain('要求：每一讲的练习题')
    expect(a.prompt).toContain('短期只有劳动能变，边际产量先升后降。')
    expect(a.prompt).not.toContain('状态: 在学')
    expect(a.read).toBe('读了《第3讲 生产》')
  })

  it('太长：读目录和每节开头，头上写明', () => {
    const long = { ...rec, text: '# 长\n\n## 一\n\n' + '字'.repeat(60_000) + '\n\n## 二\n\n第二节开头。\n' }
    const a = aiAsk(DEF, '练习题', long, [])
    expect(a.prompt.length).toBeLessThan(5_000)
    expect(a.prompt).toContain('## 二')
    expect(a.read).toBe('读了《第3讲 生产》的目录和每节开头')
  })

  it('认回答：单选认现有选项，多选拆开，数字写不出给原因，空的给原因', () => {
    const sel = { ...DEF, output: 'select' as const }
    expect(aiParse(sel, '难度：中。', ['易', '中', '难'])).toEqual({ value: '中' })
    expect(aiParse({ ...DEF, output: 'multi' }, '边际产量、短期，长期')).toEqual({ value: ['边际产量', '短期', '长期'] })
    expect(aiParse({ ...DEF, output: 'number' }, '大约 3 个')).toEqual({ value: '3' })
    expect(aiParse({ ...DEF, output: 'number' }, '写不出：笔记里没有公式')).toEqual({ error: '写不出数：笔记里没有公式' })
    expect(aiParse(DEF, '   ')).toEqual({ error: 'AI 没写出来（答回来是空的）' })
    expect(aiParse({ ...DEF, output: 'text' }, '「讲机会成本\n和边际思考」')).toEqual({ value: '讲机会成本 和边际思考' })
  })

  it('原文改过：只比正文，开头属性改了（写了格子）不算', () => {
    const k = aiSourceKey(rec.text)
    expect(aiSourceKey(rec.text.replace('状态: 在学', '状态: 学完\n练习题: x'))).toBe(k)
    expect(aiSourceKey(rec.text + '\n多写一句。\n')).not.toBe(k)
  })

  it('那篇的几道题、第一题', () => {
    expect(aiNoteSummary(AI_NOTE, '练习题')).toEqual({ count: 3, first: '短期里为什么只有劳动能变？', edited: false, items: ['短期里为什么只有劳动能变？', '边际产量为什么先升后降？', '平均产量最高点为什么正好和边际产量相交？'] })
    expect(aiNoteSummary('> [!ai] 摘要 · Codex\n> 一段话。\n', '摘要')).toEqual({ count: 0, first: '一段话。', edited: false, items: ['一段话。'] })
  })
})
