import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getAnnotation, listAnnotations, openDb, saveAnnotation, setLabelState } from '../src/main/db'
import { exportMarkdown } from '../src/main/exporter'
import {
  askList,
  askMarkdown,
  citedIn,
  isOpen,
  isSettled,
  litQuery,
  openCounts,
  parseConfused,
  parseDoubt,
  parseGroup,
  sections,
  senseChunks,
  statusOf,
  summaryOf,
  walkOrder
} from '../src/shared/explain'
import type { Annotation, Paper } from '../src/shared/types'

const ann = (o: Partial<Annotation>): Annotation => ({
  id: 'a1',
  paperId: 'p1',
  mode: 'reflow',
  color: 'yellow',
  label: 'confused',
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

const CONFUSED = `<focus>
complete logic function
为什么只要 NOR
</focus>
<one>只用 NOR 一种门就能拼出所有逻辑。</one>
<chunks>
Since NOR is a complete logic function || 因为 NOR 是完备的
a MAGIC NOR gate is sufficient || 有 NOR 这一种门就够了
</chunks>
<pre>
1. NOR（或非） || 两个输入都是 0 才输出 1。
- 功能完备 || 一组运算能拼出所有布尔函数。
</pre>
<example>$\\neg A = A \\downarrow A$</example>
<refs>
§II-A 图 2 || 两个 MAGIC NOR 先后执行 || the two MAGIC NOR gates are executed
</refs>
<quiz>
只用 NOR，怎么得到 NOT A？
+ A NOR A || 对，两个输入都接 A。
- A NOR 1 || 有一个输入是 1，永远输出 0。
- 做不到 || 做得到。
</quiz>`

describe('讲解的分节格式', () => {
  it('看不懂：六节都认出来，编号和项目符号去掉', () => {
    const v = parseConfused(CONFUSED)
    expect(v.focus).toEqual(['complete logic function', '为什么只要 NOR'])
    expect(v.one).toBe('只用 NOR 一种门就能拼出所有逻辑。')
    expect(v.chunks).toEqual([
      { en: 'Since NOR is a complete logic function', zh: '因为 NOR 是完备的' },
      { en: 'a MAGIC NOR gate is sufficient', zh: '有 NOR 这一种门就够了' }
    ])
    expect(v.pre?.map((p) => p.term)).toEqual(['NOR（或非）', '功能完备'])
    expect(v.example).toContain('\\downarrow')
    expect(v.refs).toEqual([{ where: '§II-A 图 2', what: '两个 MAGIC NOR 先后执行', quote: 'the two MAGIC NOR gates are executed' }])
    expect(v.quiz?.options.map((o) => o.ok)).toEqual([true, false, false])
    expect(v.quiz?.q).toBe('只用 NOR，怎么得到 NOT A？')
  })

  it('流式到一半：只认闭合了的节，没到的是 null', () => {
    const half = CONFUSED.slice(0, CONFUSED.indexOf('<pre>') + 20)
    const v = parseConfused(half)
    expect(v.one).not.toBeNull()
    expect(v.chunks).toHaveLength(2)
    expect(v.pre).toBeNull()
    expect(v.quiz).toBeNull()
    expect([...sections(half).keys()]).toEqual(['focus', 'one', 'chunks'])
  })

  it('模型漏了题干给一句通用的；两处写在一行也拆开；题干前的「问题：」去掉', () => {
    const v = parseConfused('<focus>stateful logic || 为什么叫 stateful</focus><quiz>+ a || x\n- b || y\n- c || z</quiz>')
    expect(v.focus).toEqual(['stateful logic', '为什么叫 stateful'])
    expect(v.quiz?.q).toBe('下面哪一个说得对？')
    expect(parseConfused('<quiz>问题：哪个对？\n+ a || x\n- b || y</quiz>').quiz?.q).toBe('哪个对？')
  })

  it('题目不对（没有正确项、两个正确项）就不出题', () => {
    expect(parseConfused('<quiz>问？\n- a || x\n- b || y</quiz>').quiz).toBeNull()
    expect(parseConfused('<quiz>问？\n+ a || x\n+ b || y</quiz>').quiz).toBeNull()
  })

  it('有质疑：主张带类型、依据带强弱、文献按编号、AI 倾向', () => {
    const d = parseDoubt(`<says>推算，不是实测 || 512 行同时算，总吞吐高 128 倍。</says>
<evidence>
y || 只是算术 || 512 ÷ 4 = 128 ||
r || 削弱这句 || 旧工具也并行时只高 5 倍 || at least 5x
x || 引用 || [16]
</evidence>
<assume>真有 512 份一样的计算
没算读写时间</assume>
<lit>L2 || 被比较的旧方法 || 引言里比的就是它
3 || 支持 || 同组的前作
无</lit>
<asks>负载填不满时还剩多少？</asks>
<lean>upheld || 128 倍是理想上限</lean>`)
    expect(d.says).toEqual({ tag: '推算，不是实测', text: '512 行同时算，总吞吐高 128 倍。' })
    expect(d.evidence?.map((e) => e.level)).toEqual(['y', 'r', 'y'])
    expect(d.evidence?.[1].quote).toBe('at least 5x')
    expect(d.assume).toHaveLength(2)
    expect(d.lit).toEqual([
      { n: 2, rel: '被比较的旧方法', note: '引言里比的就是它' },
      { n: 3, rel: '支持', note: '同组的前作' }
    ])
    expect(d.asks).toEqual(['负载填不满时还剩多少？'])
    expect(d.lean).toEqual({ v: 'upheld', why: '128 倍是理想上限' })
  })

  it('一起讲：共同卡点、几步、回到每一处按编号', () => {
    const g = parseGroup('<root>有状态逻辑</root><steps>1. 忆阻器\n2. NOR</steps><back>#1 || 就是这件事\n2 || 输入是原来的电阻\nx || 不认</back>')
    expect(g.root).toBe('有状态逻辑')
    expect(g.steps).toEqual(['忆阻器', 'NOR'])
    expect(g.back).toEqual([
      { n: 1, text: '就是这件事' },
      { n: 2, text: '输入是原来的电阻' }
    ])
  })
})

describe('状态', () => {
  it('没存过的状态：看不懂是还没懂，有质疑是待判断；和标签不配的状态不认', () => {
    expect(statusOf(ann({}))).toBe('open')
    expect(statusOf(ann({ label: 'doubt' }))).toBe('pending')
    expect(statusOf(ann({ label: 'doubt', labelStatus: 'understood' }))).toBe('pending')
    expect(statusOf(ann({ label: null }))).toBeNull()
  })

  it('还要处理的和了结了的', () => {
    expect([ann({}), ann({ labelStatus: 'understood' })].map(isOpen)).toEqual([true, false])
    expect(['pending', 'upheld', 'dismissed', 'checking'].map((s) => isOpen(ann({ label: 'doubt', labelStatus: s as Annotation['labelStatus'] })))).toEqual([true, false, false, true])
    expect(['understood', 'open'].map((s) => isSettled(ann({ labelStatus: s as Annotation['labelStatus'] })))).toEqual([true, false])
    expect(isSettled(ann({ label: 'doubt', labelStatus: 'dismissed' }))).toBe(true)
    expect(isSettled(ann({ label: 'doubt', labelStatus: 'upheld' }))).toBe(false)
    expect(openCounts([ann({}), ann({ label: 'doubt' }), ann({ label: 'doubt', labelStatus: 'dismissed' }), ann({ label: null })])).toEqual({ confused: 1, doubt: 1 })
  })

  it('过一遍按文中的先后，跳过已了结的', () => {
    const order = new Map([
      ['b1', 0],
      ['b2', 1]
    ])
    const list = walkOrder(
      [
        ann({ id: 'late', blockId: 'b2', start: 0 }),
        ann({ id: 'tr', blockId: 'b1:tr', start: 40 }),
        ann({ id: 'early', blockId: 'b1', start: 3 }),
        ann({ id: 'done', blockId: 'b1', start: 1, labelStatus: 'understood' }),
        ann({ id: 'plain', label: null })
      ],
      order
    )
    expect(list.map((a) => a.id)).toEqual(['early', 'tr', 'late'])
  })
})

describe('学术检索词、引用号', () => {
  it('先取这句里的术语（长的先），再补实词，最多 6 个词', () => {
    const q = litQuery('Even at 4× longer latency, the system provides an astonishing 128× higher throughput for stateful logic.', ['stateful logic', 'logic', 'MAGIC'], 'SIMPLER MAGIC')
    expect(q.startsWith('stateful logic')).toBe(true)
    expect(q.split(' ').length).toBeLessThanOrEqual(6)
    expect(q).toContain('latency')
    expect(q).not.toMatch(/\bprovides\b.*\bprovides\b/)
  })

  it('句子里没词就用题名补', () => {
    expect(litQuery('It is 5×.', [], 'Synthesis and Mapping of In-Memory Logic')).toBe('Synthesis Mapping In-Memory Logic')
  })

  it('认出 [16]、[3]–[5]、[1, 4]', () => {
    expect(citedIn('MAGIC [16] beats [3]–[5] and [1, 4].')).toEqual(['16', '3', '4', '5', '1'])
  })
})

describe('问作者清单', () => {
  const doubt = (id: string, status: Annotation['labelStatus'], paperTitle: string, asks: string) =>
    ({ ...ann({ id, label: 'doubt', labelStatus: status, explain: { versions: [{ focus: '', raw: `<asks>${asks}</asks>`, at: 1 }], misses: 0 } }), paperTitle })
  it('只放质疑成立和还要查的，按论文分组，复制成 Markdown', () => {
    const g = askList([doubt('1', 'upheld', 'A', '问一\n问二'), doubt('2', 'dismissed', 'A', '不放'), doubt('3', 'checking', 'B', '问三'), doubt('4', null, 'B', '没判断')])
    expect(g).toEqual([
      { paperTitle: 'A', items: [{ q: '问一', status: 'upheld' }, { q: '问二', status: 'upheld' }] },
      { paperTitle: 'B', items: [{ q: '问三', status: 'checking' }] }
    ])
    expect(askMarkdown(g)).toBe('# 问作者清单\n\n## A\n\n1. 问一（质疑成立）\n2. 问二（质疑成立）\n\n## B\n\n1. 问三（还要查）\n')
  })

  it('一句话讲解：看不懂取「一句话」，有质疑取 AI 的看法', () => {
    expect(summaryOf(ann({ explain: { versions: [{ focus: '', raw: CONFUSED, at: 1 }], misses: 0 } }))).toBe('只用 NOR 一种门就能拼出所有逻辑。')
    expect(summaryOf(ann({ label: 'doubt', explain: { versions: [{ focus: '', raw: '<lean>dismissed || 有定理撑着</lean>', at: 1 }], misses: 0 } }))).toBe('有定理撑着')
    expect(summaryOf(ann({}))).toBe('')
  })
})

describe('标签状态和讲解存在标注上', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-explain-'))
  const db = openDb(join(dir, 'lib.db'))
  // Windows 上开着的库文件删不掉：先关再删
  afterAll(() => (db.close(), rmSync(dir, { recursive: true, force: true })))
  const rec = { versions: [{ focus: '', raw: CONFUSED, at: 5 }], misses: 1 }

  it('状态和讲解存得下、读得回，改动时间往后走', () => {
    saveAnnotation(db, ann({}))
    const a = setLabelState(db, 'a1', { status: 'understood', explain: rec }, 10)!
    expect(a.labelStatus).toBe('understood')
    expect(a.explain).toEqual(rec)
    expect(a.updatedAt).toBe(10)
    expect(setLabelState(db, 'a1', { status: 'open' }, 3)!.updatedAt).toBe(11)
    expect(getAnnotation(db, 'a1')!.explain).toEqual(rec)
  })

  it('界面再存这条（改颜色、写批注）不动状态和讲解；换了标签就清空', () => {
    saveAnnotation(db, ann({ color: 'blue', note: '批注', labelStatus: null, explain: null, updatedAt: 20 }))
    let a = listAnnotations(db, 'p1')[0]
    expect([a.color, a.note, a.labelStatus, a.explain?.misses]).toEqual(['blue', '批注', 'open', 1])
    saveAnnotation(db, ann({ label: 'doubt', updatedAt: 21 }))
    a = listAnnotations(db, 'p1')[0]
    expect([a.label, a.labelStatus, a.explain]).toEqual(['doubt', null, null])
  })

  it('同步来的新的一条带着状态和讲解；没标签的标注改不了状态', () => {
    saveAnnotation(db, ann({ id: 'a2', label: 'doubt', labelStatus: 'upheld', explain: rec }))
    expect(getAnnotation(db, 'a2')!.labelStatus).toBe('upheld')
    saveAnnotation(db, ann({ id: 'a3', label: null }))
    expect(setLabelState(db, 'a3', { status: 'understood' })).toBeNull()
  })

  it('导出 Markdown：摘录后面跟状态和一句话讲解', () => {
    const paper = { id: 'p1', title: 'T', authors: [], year: 2020 } as unknown as Paper
    const md = exportMarkdown(paper, [ann({ labelStatus: 'understood', explain: rec })], ['I. INTRODUCTION'])
    expect(md).toContain('**【看不懂】**')
    expect(md).toContain('> （黄）\n\n状态：懂了。讲解：只用 NOR 一种门就能拼出所有逻辑。')
  })
})

describe('拆开看用意群对齐', () => {
  it('只取和标的字沾边的那一句，一块原文对一块译文', () => {
    const md = 'Memory is slow. Since NOR is complete, NOR is enough.'
    const zh = '存储很慢。因为 NOR 完备，有 NOR 就够了。'
    const i = md.indexOf('Since')
    const j = zh.indexOf('因为')
    const S = (a: number, b: number): [number, number] => [a, b]
    const sens = [
      { en: S(0, i), zh: S(0, j), chunks: [{ en: S(0, 15), zh: [S(0, 5)] }] },
      { en: S(i, md.length), zh: S(j, zh.length), chunks: [{ en: S(i, i + 22), zh: [S(j, j + 10)] }, { en: S(i + 23, md.length), zh: [S(j + 10, zh.length)] }] }
    ]
    expect(senseChunks(sens, md, zh, 'NOR is complete, NOR is enough')).toEqual([
      { en: 'Since NOR is complete,', zh: '因为 NOR 完备，' },
      { en: 'NOR is enough.', zh: '有 NOR 就够了。' }
    ])
    expect(senseChunks(sens, md, zh, 'abc')).toEqual([])
  })
})
