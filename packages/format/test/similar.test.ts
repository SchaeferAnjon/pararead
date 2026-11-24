import { describe, expect, it } from 'vitest'
import { commonPassage, dupShingles, estimate, findSimilarPairs, jaccard, minhash, plainText, prepareSimilar, scanSimilar, shingles, similarity, type SimilarPair } from '../src'

const PARIS_A = `---
created: 2026-11-08 10:00
source: https://example.com/paris-a
---
# 巴黎深度漫游指南（上）

第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。
<!-- card id=a1 x=10 y=20 -->
晚上去圣日耳曼的小酒馆吃饭。
`

const PARIS_B = `# 巴黎自由行全景指南

第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。
第二天去卢浮宫，留一整天。
`

const ICELAND = `# 冰岛自驾

一号公路一圈大约 1330 公里，冬天很多路段会封，出发前每天看 road.is 的路况，风大的时候不要开车门太猛。
`

const RICH = `# 所思所想

Seek wealth, not money or status. Wealth is having assets that earn while you sleep.
`

describe('找重复：3-gram + MinHash', () => {
  it('去掉 frontmatter、注释、网址和记号，按字切 3-gram', () => {
    expect(plainText(PARIS_A)).not.toMatch(/created|card id|https/)
    expect(plainText('**财富**靠[专长](https://x.y)，见 [[工作流|这里]]。')).toBe('财富靠专长见工作流')
    expect([...shingles('冰岛自驾')]).toEqual(['冰岛自', '岛自驾'])
    expect(shingles('ab').size).toBe(0)
  })

  it('MinHash 估出来的相似度和真的 Jaccard 差不多', () => {
    const a = shingles(plainText(PARIS_A))
    const b = shingles(plainText(PARIS_B))
    const real = jaccard(a, b)
    expect(Math.abs(estimate(minhash(a), minhash(b)) - real)).toBeLessThan(0.15)
    expect(estimate(minhash(a), minhash(a))).toBe(1)
  })

  it('同一段内容的两篇找得出来，不相干的不报；结果固定、像的在前', () => {
    const docs = [
      { id: '素材/巴黎/巴黎深度漫游指南（上）.md', text: PARIS_A },
      { id: '收件箱/巴黎自由行全景指南.md', text: PARIS_B },
      { id: '冰岛自驾.md', text: ICELAND },
      { id: '所思所想.md', text: RICH },
      { id: '短.md', text: '极光' },
    ]
    const pairs = findSimilarPairs(docs)
    expect(pairs).toHaveLength(1)
    const p = pairs[0]!
    expect([p.a, p.b]).toEqual(['收件箱/巴黎自由行全景指南.md', '素材/巴黎/巴黎深度漫游指南（上）.md'])
    expect(p.score).toBeGreaterThan(0.4)
    expect(p.score).toBeLessThanOrEqual(1)
    expect(p.passage).toContain('先贤祠')
    expect(Array.from(p.passage.replace(/…$/, '')).length).toBeLessThanOrEqual(40)
    expect(findSimilarPairs([...docs].reverse())).toEqual(pairs)
  })

  it('一模一样的两篇相似度接近 1', () => {
    const pairs = findSimilarPairs([
      { id: 'a.md', text: ICELAND },
      { id: 'b.md', text: ICELAND.replace('# 冰岛自驾', '# 冰岛自驾（副本）') },
    ])
    expect(pairs).toHaveLength(1)
    // 停用词去掉以后正文短了，标题多出来的「副本」占的比例大一点
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.8)
  })

  it('短的那篇几乎整段在长的那篇里，也算可能重复', () => {
    const long = PARIS_B + '\n' + ICELAND + '\n' + RICH + '\n第三天去奥赛博物馆和蒙马特高地，晚上在塞纳河上坐游船，船上风很大要多穿一件。第四天去凡尔赛宫，花园很大，租一辆自行车骑一圈，傍晚坐郊区快线回城，路上买两个可颂。'
    const pairs = findSimilarPairs([
      { id: 'long.md', text: long },
      { id: 'clip.md', text: PARIS_B },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.containment).toBeGreaterThanOrEqual(0.8)
    expect(pairs[0]!.score).toBeLessThan(0.4)
  })

  it('两篇没共同的字时相似度是 0，最长共同段是空的', () => {
    expect(similarity(ICELAND, '财富是睡觉时也在赚钱的资产').score).toBe(0)
    expect(commonPassage('abc', 'xyz')).toBe('')
    expect(similarity(PARIS_A, PARIS_B).passage).toContain('卢森堡公园')
    // 给人看的那段保留原来的大小写
    expect(similarity('云量低于三成、KP 指数到 3 以上就出门', '云量低于三成、KP 指数到 3 以上就开车').passage).toBe('云量低于三成 KP 指数到 3 以上就')
  })

  // 单独跑约几百毫秒；整套单元测试并行跑、CPU 忙时会到两秒上下，所以上限放到 6 秒：防的是退化成逐对比较（那样要几十秒）
  it('一千篇几秒内比完（不是逐对比较）', () => {
    const docs = Array.from({ length: 1000 }, (_, i) => ({
      id: `n${i}.md`,
      text: `第 ${i} 篇：${'随手记下的一句话，'.repeat(1 + (i % 5))}编号 ${i * 7919} 结尾 ${String(i).repeat(6)}`,
    }))
    const t = performance.now()
    findSimilarPairs(docs)
    expect(performance.now() - t).toBeLessThan(6000)
  })

  /** 以前的写法（3000 × 3000 的表），新写法要和它一模一样 */
  function passageByTable(a: string, b: string, max = 40): string {
    const x = Array.from(a.slice(0, 3000))
    const y = Array.from(b.slice(0, 3000))
    let best = 0
    let end = 0
    let prev = new Uint16Array(y.length + 1)
    let cur = new Uint16Array(y.length + 1)
    for (let i = 1; i <= x.length; i++) {
      for (let j = 1; j <= y.length; j++) {
        cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1]! + 1 : 0
        if (cur[j]! > best) {
          best = cur[j]!
          end = i
        }
      }
      ;[prev, cur] = [cur, prev]
      cur.fill(0)
    }
    const s = x.slice(end - best, end).join('').trim()
    return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') + '…' : s
  }

  function rng(seed: number) {
    let s = seed >>> 0
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32)
  }

  it('两篇都有的最长一段：和以前逐格算的结果一模一样（一样长的取前面那段、超过 40 字截断、emoji 不拆开）', () => {
    const r = rng(3)
    const alpha = ['冰', '岛', '自', '驾', '极', '光', 'a', 'b', ' ', '😀', '路']
    const make = (n: number) => Array.from({ length: n }, () => alpha[Math.floor(r() * alpha.length)]).join('')
    for (let k = 0; k < 300; k++) {
      const a = make(Math.floor(r() * 120))
      const b = r() < 0.5 ? make(Math.floor(r() * 120)) : a.slice(Math.floor(r() * 20)) + make(10)
      expect(commonPassage(a, b)).toBe(passageByTable(a, b))
    }
    const long = '第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃。'
    expect(commonPassage('前' + long + '后', '另' + long)).toBe(passageByTable('前' + long + '后', '另' + long))
    expect(commonPassage('', 'abc')).toBe('')
  })

  /** 以前的写法：Set 里的字串一对对算，新写法（编号、提前停、分几份）结果要一样 */
  function pairsBySets(docs: { id: string; text: string }[]): SimilarPair[] {
    const items = docs.map((d) => ({ id: d.id, text: d.text, set: dupShingles(d.text) })).filter((d) => d.set.size >= 20)
    const sigs = items.map((d) => minhash(d.set))
    const cands = new Set<string>()
    for (let band = 0; band < 64; band++) {
      const buckets = new Map<string, number[]>()
      items.forEach((_, i) => {
        const key = sigs[i]![band * 2]!.toString(36) + ',' + sigs[i]![band * 2 + 1]!.toString(36) + ','
        buckets.set(key, [...(buckets.get(key) ?? []), i])
      })
      for (const l of buckets.values()) if (l.length >= 2 && l.length <= 200) for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) cands.add(`${l[x]} ${l[y]}`)
    }
    const out: SimilarPair[] = []
    for (const c of cands) {
      const [i, j] = c.split(' ').map(Number) as [number, number]
      const a = items[i]!
      const b = items[j]!
      const score = jaccard(a.set, b.set)
      const [sm, bg] = a.set.size <= b.set.size ? [a.set, b.set] : [b.set, a.set]
      let inter = 0
      for (const g of sm) if (bg.has(g)) inter++
      const containment = inter / sm.size
      if (score < 0.4 && !(containment >= 0.8 && sm.size >= 30)) continue
      const [f, s2] = a.id < b.id ? [a, b] : [b, a]
      out.push({ a: f.id, b: s2.id, score: Math.round(score * 100) / 100, containment: Math.round(containment * 100) / 100, passage: passageByTable(plainText(f.text, true), plainText(s2.text, true)) })
    }
    return out.sort((x, y) => y.score - x.score || y.containment - x.containment || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
  }

  it('随机拼的一堆笔记：找出来的对、相似度、那一段和以前的写法一样；拆成几份比再合起来也一样', () => {
    const r = rng(11)
    const words = '冰岛 自驾 极光 预报 读书 笔记 产品 设计 卡片 白板 整理 素材 写作 习惯 时间'.split(' ')
    const para = (n: number) => Array.from({ length: n }, () => words[Math.floor(r() * words.length)]).join('')
    const docs: { id: string; text: string }[] = []
    for (let i = 0; i < 160; i++) {
      const base = i > 0 && r() < 0.3 ? docs[Math.floor(r() * docs.length)]!.text : `# 第${i}篇\n\n${para(20 + Math.floor(r() * 60))}`
      docs.push({ id: `n${String(i).padStart(3, '0')}.md`, text: r() < 0.5 ? base + para(5) : para(10) + base.slice(0, 200) })
    }
    const want = pairsBySets(docs)
    expect(want.length).toBeGreaterThan(20)
    expect(findSimilarPairs(docs)).toEqual(want)
    const prep = prepareSimilar(docs)
    const got: SimilarPair[] = []
    let done = 0
    for (let part = 0; part < 3; part++) scanSimilar(prep, part, 3, (p) => got.push(p), () => done++)
    expect(done).toBe(prep.ids.length)
    expect(got.sort((x, y) => y.score - x.score || y.containment - x.containment || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))).toEqual(want)
  })
})

