/**
 * 笔记里「算得上证据」的词（task-eler2）：梦游补双链、找重复之前先把停用词、高频虚词、序数词去掉，
 * 两篇不会再因为都写了「the second」「第三方」「我们」就被当成讲同一件事。
 * 英文按词切（小写、去掉复数的 s）；中文没有空格，按连着的汉字切成两个字一片，遇到虚词断开；数字不算。
 * 纯函数，不读文件，手机版也能用。
 */

/** 英文停用词：虚词、代词、助动词，加上什么话题都会出现的高频词（时间、数量、程度、最高级） */
const EN_STOP = new Set(
  `a about above after again against ago all almost along already also although always am among an and another any anyone anything are around as at away
back be became because become been before being below best better between big both but by can cannot could did do does doing done down during each
either else enough even ever every everyone everything few for from further get gets getting give given go goes going gone good got great had has have
having he her here hers herself him himself his how however i if in into is it its itself just know large largest last least less let like little long
longest look made make makes many may maybe me might more most much must my myself near need never new next no nor not nothing now of off often old
on once one only or other others our ours out over own part people per perhaps put quite rather really right said same say says see seem seems several
shall she should since small so some something sometimes still such sure take than that the their theirs them then there these they thing things think
this those though through thus till time times to together too took toward under until up upon us use used using very want was way ways we well went
were what when where whether which while who whom whose why will with within without would yes yet you your yours yourself
day days week weeks month months year years today tomorrow yesterday tonight morning evening night hour hours minute minutes
half whole lot lots kind sort bit number numbers end start began begin least highest tallest biggest smallest worst
via etc vs ok okay oh hi hello thanks thank please st nd rd th
untitled note notes`.split(/\s+/),
)

/** 英文序数词：first、second、twenty-first 拆开后的每一段、21st */
const EN_ORDINAL = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|twentieth|hundredth|\d+(st|nd|rd|th))$/

/** 中文停用词：代词、连词、副词、什么话题都会出现的词；「未命名」是新建笔记的默认名 */
const ZH_STOP = `我们 你们 他们 她们 它们 咱们 自己 大家 别人 人家 这个 那个 这些 那些 这样 那样 这里 那里 这种 那种 这么 那么 这次 那次 这边 那边
一个 一些 一下 一样 一点 一直 一起 一定 一般 一种 一次 一天 一下子 有点 有些 有的 什么 怎么 怎样 为什么 为何 如何 哪里 哪个 多少
因为 所以 但是 可是 不过 而且 并且 或者 还是 如果 要是 虽然 然后 于是 然而 只要 只有 不但 不仅 除了 以及 关于 对于 通过 进行 根据 按照
已经 现在 时候 以后 以前 之后 之前 后来 最后 最近 当时 今天 明天 昨天 今年 去年 明年 刚才 马上 终于 突然 一会儿
可以 可能 应该 需要 能够 没有 不是 就是 还有 只是 也是 都是 就会 不会 不要 觉得 知道 认为 发现 看到 看看 说明 表示 其实 当然 比如 例如 确实 真的 好像 似乎
非常 特别 比较 很多 许多 不少 有时 总是 经常 常常 往往 几乎 大概 也许 或许 稍微 尤其 主要 重要 一边 东西 事情 问题 方面 情况 部分 地方 方法 办法 意思 结果 原因
以上 以下 之间 左右 等等 上午 下午 中午 晚上 早上 记下 时刻
相关 未命名 无标题 笔记 记录 备注`.split(/\s+/)

/** 中文序数：第一、第二次、第三方、第 3 页 */
const ZH_ORDINAL = /第\s*[一二三四五六七八九十百千万两几零〇\d]+\s*[个次名位条章节讲天年月周号方期页轮批步类种部集回点项]?/gu

/** 断开中文的虚字：一个字的助词、介词、连词、代词 */
const ZH_STOP_CHAR = /[的了着过吗呢吧啊呀哦嘛么之也都就而不把被让给向从对到与及或很太更又还才只是在和跟同我你他她它们这那其该此各每些]/u

const HAN = /\p{Script=Han}/u
/** 一个英文词（只要字母：2010、21st 里的数字都不算）或一串汉字 */
const TOKEN = /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*|\p{Script=Han}+/gu
const ZH_STOP_RE = new RegExp(`(${[...ZH_STOP].sort((a, b) => b.length - a.length).join('|')})`, 'gu')

/** 一段：一个英文词（term），或一串连着的汉字（han，切片前） */
export type TermRun = { kind: 'word'; term: string; surface: string } | { kind: 'han'; text: string }

/** 去掉 frontmatter、注释、网址、图片和 md 记号，链接只留文字 */
function stripMd(md: string): string {
  return md
    .replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#^]+)[^\]]*\]\]/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
}

/** 英文词的原形：小写、去掉 's 和复数的 s（waterfalls → waterfall，glass 不动） */
function stem(w: string): string {
  const s = w.toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '')
  if (s.length > 4 && s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) return s.slice(0, -1)
  return s
}

/** 这个英文词算不算证据（停用词、序数词、太短的都不算） */
export function isEnStop(w: string): boolean {
  const s = stem(w)
  return s.length < 2 || EN_STOP.has(s) || EN_STOP.has(w.toLowerCase()) || EN_ORDINAL.test(s)
}

/**
 * 把笔记切成一段段：英文的每个词（去掉停用词、序数词、数字），中文按虚词、停用词、序数词断开的一串串汉字（一个字的串不要）。
 * 顺序照原文，补双链拿它数词、拼给人看的关键词
 */
export function termRuns(md: string): TermRun[] {
  const out: TermRun[] = []
  const text = stripMd(md).replace(ZH_ORDINAL, ' ').replace(ZH_STOP_RE, ' ')
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0]
    if (HAN.test(tok)) {
      for (const seg of tok.split(ZH_STOP_CHAR)) if (Array.from(seg).length >= 2) out.push({ kind: 'han', text: seg })
    } else if (!isEnStop(tok)) out.push({ kind: 'word', term: stem(tok), surface: tok })
  }
  return out
}

/** 一串汉字切成两个字一片 */
export function hanBigrams(s: string): string[] {
  const c = Array.from(s)
  const out: string[] = []
  for (let i = 0; i + 2 <= c.length; i++) out.push(c[i]! + c[i + 1]!)
  return out
}

/** 每个词出现几次（英文词、中文两字片） */
export function termCounts(md: string): Map<string, number> {
  const tf = new Map<string, number>()
  const add = (t: string) => tf.set(t, (tf.get(t) ?? 0) + 1)
  for (const r of termRuns(md)) {
    if (r.kind === 'word') add(r.term)
    else for (const b of hanBigrams(r.text)) add(b)
  }
  return tf
}

/**
 * 找重复用的一串记号：英文一个词一个记号，汉字一个字一个记号（停用词、序数词、数字、标点都不要）。
 * 英文以前按字母切三个一片，什么英文都有「the」「ion」，一篇短的英文笔记十有八九「落在」随便哪篇长的英文里
 */
export function dupTokens(md: string): string[] {
  const out: string[] = []
  const text = stripMd(md).replace(ZH_ORDINAL, ' ').replace(ZH_STOP_RE, ' ')
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0]
    if (HAN.test(tok)) out.push(...Array.from(tok))
    else if (!isEnStop(tok)) out.push(stem(tok))
  }
  return out
}
