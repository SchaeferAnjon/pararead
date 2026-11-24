// AI 回答里没写成链接的路径、名字也认成链接（task-3e53q 设计页「二、a」后半）：每条防认错的规则正反各一例
import { describe, expect, it } from 'vitest'
import { codeCite, type CiteRun, findAutoCites, linkedSeen, longEnough, nameIndex, pathCite } from '../src/cite-names'

const FILES = [
  '课程/小论文计划.md',
  '课程/小论文计划书.md',
  '课程/线代/第3讲.pdf',
  '课程/线代/第3讲 笔记.md',
  '阅读/书单合集.md',
  '日记/书单合集.md',
  '收件箱/计划.md',
  '收件箱/README.md',
  '英文/Lecture.md',
  '英文/Lectures.md',
  '课程/study project 2/J52 SAGE.pdf',
  '收件箱/周报草稿.md',
]
const CTX = { base: '', root: '/Users/me/笔记库', files: FILES }

function run(o: { touched?: string[]; rejected?: string[]; common?: string[]; off?: boolean; seen?: Set<string> } = {}): CiteRun {
  return {
    ctx: CTX,
    index: nameIndex(FILES, o.common ?? []),
    names: !o.off,
    touched: new Set(o.touched ?? []),
    rejected: new Set(o.rejected ?? []),
    seen: o.seen ?? new Set(),
  }
}
const hits = (text: string, r: CiteRun = run()) => findAutoCites(text, r).map((h) => ({ text: text.slice(h.from, h.to), href: h.href, why: h.why }))

describe('认路径（AI 写了路径没写成链接）', () => {
  it('库根相对路径、绝对路径、路径:42、路径#page= 认成链接；指的就是写的那截', () => {
    expect(hits('见 课程/小论文计划.md 第二段')).toEqual([{ text: '课程/小论文计划.md', href: '课程/小论文计划.md', why: 'path' }])
    expect(hits('原文 /Users/me/笔记库/课程/小论文计划.md:42-43，')).toEqual([{ text: '/Users/me/笔记库/课程/小论文计划.md:42-43', href: '/Users/me/笔记库/课程/小论文计划.md:42-43', why: 'path' }])
    expect(hits('在 课程/线代/第3讲.pdf#page=4 上')[0]!.text).toBe('课程/线代/第3讲.pdf#page=4')
  })
  it('文件夹名里带空格：往左把整段认成一个路径（「**课程/study project 2/J52 SAGE.pdf**」「见 课程/study project 2/J52 SAGE.pdf 第 4 页」）', () => {
    expect(hits('**课程/study project 2/J52 SAGE.pdf**').map((h) => h.text)).toEqual(['课程/study project 2/J52 SAGE.pdf'])
    expect(hits('见 课程/study project 2/J52 SAGE.pdf 第 4 页').map((h) => h.text)).toEqual(['课程/study project 2/J52 SAGE.pdf'])
    // 前面的词不是路径的一截：不往左吃
    expect(hits('打开 课程/小论文计划.md 看看').map((h) => h.text)).toEqual(['课程/小论文计划.md'])
  })
  it('中文里不空格：「在小论文计划.md里」只认「小论文计划.md」；找不到的不认', () => {
    expect(hits('在小论文计划.md里写着')).toEqual([{ text: '小论文计划.md', href: '小论文计划.md', why: 'path' }])
    expect(hits('在没有这篇.md里写着')).toEqual([])
  })
  it('写错的路径：带文件夹的、库里的绝对路径照样认成链接（卡上说没找到）；光一个文件名找不到的、库外的不认', () => {
    expect(pathCite('课程/没有这篇.md', CTX)).toBe(true)
    expect(pathCite('/Users/me/笔记库/没有.md', CTX)).toBe(true)
    expect(pathCite('没有这篇.md', CTX)).toBe(false)
    expect(pathCite('/etc/notes.md', CTX)).toBe(false)
  })
  it('行内代码整段是路径的认；带空格的只认找得到的；命令、不是 md / pdf 的不认', () => {
    expect(codeCite('课程/小论文计划.md', CTX)).toBe('课程/小论文计划.md')
    expect(codeCite('课程/study project 2/J52 SAGE.pdf', CTX)).toBe('课程/study project 2/J52 SAGE.pdf')
    expect(codeCite('cat 课程/小论文计划.md', CTX)).toBeNull()
    expect(codeCite('课程/小论文计划.txt', CTX)).toBeNull()
    expect(codeCite('npm test', CTX)).toBeNull()
  })
})

describe('按名字认：防认错的规则（每条正反各一例）', () => {
  it('只认整个名字：「小论文计划」认，「论文计划」（名字的一半）不认；更长的名字优先', () => {
    expect(hits('《小论文计划》')).toEqual([{ text: '小论文计划', href: '课程/小论文计划.md', why: 'quoted' }])
    expect(hits('《论文计划》')).toEqual([])
    expect(hits('《小论文计划书》')[0]!.href).toBe('课程/小论文计划书.md')
  })
  it('中文 3 个字以上、英文 4 个字母以上', () => {
    expect(longEnough('小论文')).toBe(true)
    expect(longEnough('书单')).toBe(false)
    expect(longEnough('Plan')).toBe(true)
    expect(longEnough('J52')).toBe(false)
    expect(hits('「Lecture」')).toEqual([{ text: 'Lecture', href: '英文/Lecture.md', why: 'quoted' }])
  })
  it('英文名字前后不能紧挨字母：「Lecture」不认「Lectures」里那截，「Lectures」自己认', () => {
    expect(hits('Lectures 里写了', run({ touched: ['英文/Lecture.md'] }))).toEqual([])
    expect(hits('Lectures 里写了', run({ touched: ['英文/Lectures.md'] }))).toEqual([{ text: 'Lectures', href: '英文/Lectures.md', why: 'touched' }])
  })
  it('库里同名只有一篇才认：书单合集（两篇）不认，小论文计划（一篇）认', () => {
    const r = run({ touched: ['阅读/书单合集.md', '课程/小论文计划.md'] })
    expect(hits('书单合集和小论文计划都看了', r).map((h) => h.text)).toEqual(['小论文计划'])
  })
  it('这一轮读过的文件光写名字就认；没碰过的光写名字不认', () => {
    expect(hits('小论文计划里排第 2', run({ touched: ['课程/小论文计划.md'] }))).toEqual([{ text: '小论文计划', href: '课程/小论文计划.md', why: 'touched' }])
    expect(hits('小论文计划里排第 2')).toEqual([])
  })
  it('没碰过的在《》「」“”"" 里认；只包了一边、两边对不上的不认', () => {
    for (const [a, b] of [['《', '》'], ['「', '」'], ['“', '”'], ['"', '"']]) expect(hits(`看${a}小论文计划${b}`)).toHaveLength(1)
    expect(hits('看《小论文计划')).toEqual([])
    expect(hits('看「小论文计划》')).toEqual([])
  })
  it('PDF 名不带 .pdf 也认；带扩展名的整个文件名（中间有空格）按路径认，不用包着、设置关了也认', () => {
    expect(hits('《J52 SAGE》')).toEqual([{ text: 'J52 SAGE', href: '课程/study project 2/J52 SAGE.pdf', why: 'quoted' }])
    expect(hits('J52 SAGE')).toEqual([])
    expect(hits('看 J52 SAGE.pdf 那篇', run({ off: true }))).toEqual([{ text: 'J52 SAGE.pdf', href: '课程/study project 2/J52 SAGE.pdf', why: 'path' }])
  })
  it('常见名不认（计划、README）；用户在设置里加的也不认；没加的照认', () => {
    expect(hits('「README」和「计划」', run({ touched: ['收件箱/README.md', '收件箱/计划.md'] }))).toEqual([])
    expect(hits('《周报草稿》', run({ common: ['周报草稿'] }))).toEqual([])
    expect(hits('《周报草稿》')).toHaveLength(1)
  })
  it('点过「不是这篇」的名字这段对话里不认；没点过的照认', () => {
    expect(hits('《小论文计划》', run({ rejected: ['小论文计划'] }))).toEqual([])
    expect(hits('《小论文计划》', run({ rejected: ['周报草稿'] }))).toHaveLength(1)
  })
  it('一条回答里同一个名字只认第一次（几段共用一份 seen）；换一条回答重新认', () => {
    const seen = new Set<string>()
    const r = run({ touched: ['课程/小论文计划.md'], seen })
    expect(hits('小论文计划和小论文计划', r)).toHaveLength(1)
    expect(hits('第二段又提小论文计划', r)).toHaveLength(0)
    expect(hits('第二段又提小论文计划', run({ touched: ['课程/小论文计划.md'] }))).toHaveLength(1)
  })
  it('AI 自己写成链接的那篇，后面光写名字的不再认；没写成链接的照认', () => {
    const r = run({ touched: ['课程/小论文计划.md', '课程/小论文计划书.md'] })
    linkedSeen({ href: '课程/小论文计划.md#L3' }, r)
    expect(hits('标题是「小论文计划」，另见小论文计划书', r).map((h) => h.text)).toEqual(['小论文计划书'])
    linkedSeen({ wiki: '小论文计划书' }, r)
    expect(hits('小论文计划书', r)).toEqual([])
  })
  it('设置里关了按名字认：名字不认，路径照认', () => {
    const r = run({ off: true, touched: ['课程/小论文计划.md'] })
    expect(hits('小论文计划', r)).toEqual([])
    expect(hits('课程/小论文计划.md', r)).toHaveLength(1)
  })
  it('路径的一截不按名字认（交给认路径）', () => {
    expect(hits('课程/小论文计划书/附件', run({ touched: ['课程/小论文计划书.md'] }))).toEqual([])
  })
})

describe('大库、长回答', () => {
  it('5000 篇（一半以「第」开头）、3 万字的回答：建索引 + 认一遍不到 2 秒（防退化成逐字逐名比；这台 Mac 上量到 0.2–0.4 秒，机器忙时更长）', () => {
    const files = Array.from({ length: 5000 }, (_, i) => (i % 2 ? `课程/第${i}讲 笔记.md` : `收件箱/剪藏 ${i} 号.md`))
    const text = Array.from({ length: 1500 }, (_, i) => `第${i}讲 笔记里写了《剪藏 ${i} 号》，见 课程/第${i}讲.md。`).join('\n').slice(0, 30_000)
    const t0 = performance.now()
    const r: CiteRun = { ctx: { base: '', root: '/r', files }, index: nameIndex(files), names: true, touched: new Set(), rejected: new Set(), seen: new Set() }
    const n = findAutoCites(text, r).length
    const ms = performance.now() - t0
    console.log(`5000 篇、${text.length} 字：认出 ${n} 处，${ms.toFixed(0)} 毫秒`)
    expect(n).toBeGreaterThan(100)
    expect(ms).toBeLessThan(2000)
  })
})
