import { dupTokens } from './terms'

/**
 * 找讲同一件事的笔记：去掉停用词以后按 3 个记号切片（dupShingles），用 MinHash 签名加分段（LSH）先挑出候选对，
 * 再对候选对算真的 Jaccard 相似度。纯函数，不读文件，手机版也能用。
 */

export interface SimilarDoc {
  id: string
  /** md 原文（frontmatter、排版注释、记号会先去掉） */
  text: string
}

export interface SimilarPair {
  a: string
  b: string
  /** 两篇 3-gram 集合的 Jaccard 相似度，0 到 1 */
  score: number
  /** 短的那篇有多少落在长的那篇里，0 到 1 */
  containment: number
  /** 两篇都有的最长一段（去掉记号后的文字，最多 40 个字） */
  passage: string
}

export interface SimilarOptions {
  /** Jaccard 到这个数就算可能重复（默认 0.4） */
  threshold?: number
  /** 短的那篇这么多落在长的那篇里也算（默认 0.8） */
  containment?: number
  /** 切片少于这个数的笔记太短，不比（默认 20） */
  minShingles?: number
}

const N = 3
/** 签名长度 = 分段数 × 每段行数；64 段 × 2 行，Jaccard 0.15 以上的几乎都会成为候选 */
const BANDS = 64
const ROWS = 2
const K = BANDS * ROWS

/** 去掉 frontmatter、排版注释、网址和 md 记号，标点和空白并成一个空格，转小写（keepCase 时不转，给人看的那段用） */
export function plainText(md: string, keepCase = false): string {
  const s = md
    .replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#^]+)[^\]]*\]\]/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`~#>=]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    // 汉字之间的空白（原来的标点）不算，中文按连着的字切
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
    .trim()
  return keepCase ? s : s.toLowerCase()
}

/** 按字（不是字节）切成连续 3 个字一片 */
export function shingles(text: string, n = N): Set<string> {
  const chars = Array.from(text)
  const out = new Set<string>()
  for (let i = 0; i + n <= chars.length; i++) out.add(chars.slice(i, i + n).join(''))
  return out
}

/**
 * 找重复用的切片（task-eler2）：停用词、序数词、数字去掉以后，连着三个记号一片；中文一个字一个记号（和以前按字切三个一片一样），
 * 英文一个词一个记号（以前按字母切，什么英文都有「the」「ion」，不相干的两篇英文也能「像」）
 */
export function dupShingles(md: string, n = N): Set<string> {
  const t = dupTokens(md)
  const out = new Set<string>()
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(' '))
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0
  let inter = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const s of small) if (big.has(s)) inter++
  return inter / (a.size + b.size - inter)
}

function overlap(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  if (!small.size) return 0
  let inter = 0
  for (const s of small) if (big.has(s)) inter++
  return inter / small.size
}

/** FNV-1a，32 位 */
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 把一个 32 位数打散（当作一个随机排列） */
function mix(x: number): number {
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

const SEEDS = Array.from({ length: K }, (_, i) => mix(Math.imul(i + 1, 0x9e3779b9)))

/** MinHash 签名：K 个排列下各自最小的哈希 */
export function minhash(set: Set<string>, k = K): Uint32Array {
  const sig = new Uint32Array(k).fill(0xffffffff)
  for (const s of set) {
    const h = fnv(s)
    for (let i = 0; i < k; i++) {
      const v = mix(h ^ SEEDS[i]!)
      if (v < sig[i]!) sig[i] = v
    }
  }
  return sig
}

/** 两个签名估出来的 Jaccard */
export function estimate(a: Uint32Array, b: Uint32Array): number {
  let same = 0
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++
  return same / a.length
}

/**
 * 两段文字都有的最长一段（只看前 3000 个字），用来告诉人为什么像；一样长的取在 a 里最靠前的那段。
 * 用 a 的后缀自动机走一遍 b，两段长度之和的线性时间（以前是 3000 × 3000 的表，一对 30 多毫秒，
 * 大库「找重复」上万对光这一步就要 10 分钟）。
 */
export function commonPassage(a: string, b: string, max = 40): string {
  const x = Array.from(a.slice(0, 3000))
  const y = Array.from(b.slice(0, 3000))
  const cap = 2 * x.length + 2
  const len = new Int32Array(cap)
  const link = new Int32Array(cap)
  /** 每个状态的字串在 x 里最早结束在哪（下标） */
  const first = new Int32Array(cap)
  const next: Map<string, number>[] = [new Map()]
  link[0] = -1
  let size = 1
  let last = 0
  for (let p = 0; p < x.length; p++) {
    const c = x[p]!
    const cur = size++
    next.push(new Map())
    len[cur] = len[last]! + 1
    first[cur] = p
    let q = last
    while (q !== -1 && !next[q]!.has(c)) {
      next[q]!.set(c, cur)
      q = link[q]!
    }
    if (q === -1) link[cur] = 0
    else {
      const r = next[q]!.get(c)!
      if (len[q]! + 1 === len[r]) link[cur] = r
      else {
        const clone = size++
        next.push(new Map(next[r]!))
        len[clone] = len[q]! + 1
        link[clone] = link[r]!
        first[clone] = first[r]!
        while (q !== -1 && next[q]!.get(c) === r) {
          next[q]!.set(c, clone)
          q = link[q]!
        }
        link[r] = clone
        link[cur] = clone
      }
    }
    last = cur
  }
  let v = 0
  let l = 0
  let best = 0
  /** 最长那段在 x 里结束的位置（不含） */
  let end = 0
  for (const c of y) {
    while (v !== 0 && !next[v]!.has(c)) {
      v = link[v]!
      l = len[v]!
    }
    const to = next[v]!.get(c)
    if (to !== undefined) {
      v = to
      l++
    } else {
      v = 0
      l = 0
    }
    if (l > best) {
      best = l
      end = first[v]! + 1
    } else if (l === best && l > 0 && first[v]! + 1 < end) end = first[v]! + 1
  }
  const s = x
    .slice(end - best, end)
    .join('')
    .trim()
  return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') + '…' : s
}

/** 一对笔记有多像（不经过 MinHash，直接算） */
export function similarity(a: string, b: string): { score: number; containment: number; passage: string } {
  const sa = dupShingles(a)
  const sb = dupShingles(b)
  return { score: round(jaccard(sa, sb)), containment: round(overlap(sa, sb)), passage: commonPassage(plainText(a, true), plainText(b, true)) }
}

const round = (x: number) => Math.round(x * 100) / 100

/**
 * 找重复的准备：每篇的 3-gram 换成整数编号（排好序，比两篇的交集只要并着走一遍，比 Set 查字串快好几倍，结果一样），
 * 再算 MinHash 签名分段。几千篇的库这一步一两秒；后面的 scanSimilar 可以拆成几份在几个线程里一起比。
 */
export interface SimilarPrep {
  /** 参加比的那几篇（太短的已经去掉） */
  ids: string[]
  /** 第 i 篇的编号在 grams 里是 [off[i], off[i + 1]) */
  off: Int32Array
  grams: Int32Array
  /** 第 i 篇的签名是 sigs[i * K, (i + 1) * K) */
  sigs: Uint32Array
  /** 给人看的那段用的字（plainText 不转小写，前 3000 个字） */
  plain: string[]
  threshold: number
  containment: number
  minShingles: number
}

export function prepareSimilar(docs: SimilarDoc[], opts: SimilarOptions = {}): SimilarPrep {
  const minShingles = opts.minShingles ?? 20
  const dict = new Map<string, number>()
  const kept: { id: string; text: string; set: Set<string>; grams: Int32Array }[] = []
  for (const d of docs) {
    const set = dupShingles(d.text)
    if (set.size < minShingles) continue
    const grams = new Int32Array(set.size)
    let k = 0
    for (const g of set) {
      let n = dict.get(g)
      if (n === undefined) dict.set(g, (n = dict.size))
      grams[k++] = n
    }
    grams.sort()
    kept.push({ id: d.id, text: d.text, set, grams })
  }
  const off = new Int32Array(kept.length + 1)
  for (let i = 0; i < kept.length; i++) off[i + 1] = off[i]! + kept[i]!.grams.length
  const grams = new Int32Array(off[kept.length]!)
  const sigs = new Uint32Array(kept.length * K)
  kept.forEach((d, i) => {
    grams.set(d.grams, off[i]!)
    sigs.set(minhash(d.set), i * K)
  })
  return {
    ids: kept.map((d) => d.id),
    off,
    grams,
    sigs,
    plain: kept.map((d) => plainText(d.text, true).slice(0, 3000)),
    threshold: opts.threshold ?? 0.4,
    containment: opts.containment ?? 0.8,
    minShingles,
  }
}

/**
 * 比一份：第 i 篇（i 除以 parts 余 part 的那些）和它的候选（MinHash 分段里同桶的）一对对算真的 Jaccard。
 * 每一对只比一次（i + j 是偶数从小的那篇比，奇数从大的那篇比，几份的活差不多一样多）。
 * 像的一对交给 onPair（先找到的先给），每比完一篇叫一次 onDoc。
 */
export function scanSimilar(prep: SimilarPrep, part: number, parts: number, onPair: (p: SimilarPair) => void, onDoc?: () => void): void {
  const { ids, off, grams, sigs, plain, threshold, containment: contain, minShingles } = prep
  const n = ids.length
  /** 每段：第 i 篇落在哪个桶 */
  const bucketOf: number[][][] = []
  for (let band = 0; band < BANDS; band++) {
    const buckets = new Map<string, number[]>()
    const of: number[][] = new Array(n)
    for (let i = 0; i < n; i++) {
      let key = ''
      for (let r = 0; r < ROWS; r++) key += sigs[i * K + band * ROWS + r]!.toString(36) + ','
      let list = buckets.get(key)
      if (!list) buckets.set(key, (list = []))
      list.push(i)
      of[i] = list
    }
    bucketOf.push(of)
  }
  const seen = new Int32Array(n)
  for (let i = part; i < n; i += parts) {
    const a0 = off[i]!
    const a1 = off[i + 1]!
    const na = a1 - a0
    for (let band = 0; band < BANDS; band++) {
      const list = bucketOf[band]![i]!
      if (list.length < 2 || list.length > 200) continue
      for (const j of list) {
        if (j === i || ((i + j) % 2 === 0 ? j < i : j > i) || seen[j] === i + 1) continue
        seen[j] = i + 1
        const b0 = off[j]!
        const b1 = off[j + 1]!
        const nb = b1 - b0
        const small = Math.min(na, nb)
        // 交集至少要这么大才可能算像：比到一半就知道够不上的不往下比（只是省时间，算像不算像照下面原来的式子）
        const need = Math.min((threshold * (na + nb)) / (1 + threshold), small >= minShingles * 1.5 ? contain * small : Infinity) - 1e-6
        let x = a0
        let y = b0
        let inter = 0
        while (x < a1 && y < b1) {
          const u = grams[x]!
          const w = grams[y]!
          if (u === w) {
            inter++
            x++
            y++
          } else if (u < w) x++
          else y++
          if (inter + Math.min(a1 - x, b1 - y) < need) break
        }
        const score = inter / (na + nb - inter)
        const containment = inter / small
        if (score < threshold && !(containment >= contain && small >= minShingles * 1.5)) continue
        const [p, q] = ids[i]! < ids[j]! ? [i, j] : [j, i]
        onPair({ a: ids[p]!, b: ids[q]!, score: round(score), containment: round(containment), passage: commonPassage(plain[p]!, plain[q]!) })
      }
    }
    onDoc?.()
  }
}

/** 像的在前（一样像的按名字排，结果固定） */
export function sortSimilar(pairs: SimilarPair[]): SimilarPair[] {
  return pairs.sort((x, y) => y.score - x.score || y.containment - x.containment || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
}

/** 在一堆笔记里找可能重复的对，像的在前（在这个线程里一口气算完；软件里大库拆到几个线程，见 apps/notes 的 similar/worker） */
export function findSimilarPairs(docs: SimilarDoc[], opts: SimilarOptions = {}): SimilarPair[] {
  const out: SimilarPair[] = []
  scanSimilar(prepareSimilar(docs, opts), 0, 1, (p) => out.push(p))
  return sortSimilar(out)
}
