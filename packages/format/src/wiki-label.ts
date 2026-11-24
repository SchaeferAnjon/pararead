/**
 * 双链 [[…]] 露给人看的字，文档和白板卡一个认法：有别名露别名，没有露路径最后一截（[[课程/ecp/第五讲]] 只露「第五讲」，
 * 不带 .md），#标题 照留着。
 * Obsidian 写法的图片 ![[图.png]]、![[图.png|300]]：单独一行时画成图（文档里和 ![](…) 一样）。
 */
import { resolveLink } from './blocks'

/** inner 是 [[ 和 ]] 中间的字；返回露出来的那一截在 inner 里的起止 */
export function wikiShown(inner: string): { from: number; to: number } {
  const bar = inner.indexOf('|')
  if (bar !== -1 && inner.slice(bar + 1).trim()) return { from: bar + 1, to: inner.length }
  const end = bar === -1 ? inner.length : bar
  const hash = inner.indexOf('#')
  const pathEnd = hash === -1 || hash > end ? end : hash
  const from = pathEnd > 0 ? inner.lastIndexOf('/', pathEnd - 1) + 1 : 0
  const to = pathEnd === end && /\.md$/i.test(inner.slice(from, end)) ? end - 3 : end
  return to > from ? { from, to } : { from: 0, to: end }
}

/** 双链露出来的字 */
export function wikiLabel(inner: string): string {
  const r = wikiShown(inner)
  return inner.slice(r.from, r.to).trim() || inner
}

const IMAGE_EMBED = /^ {0,3}!\[\[([^\]|\n#]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|heic))(?:\|([^\]\n]*))?\]\][ \t]*$/i

/** 单独一行的 ![[图.png]] / ![[图.png|300]]：target 是写着的文件（名字或路径），alt 是 | 后面那截（宽度或说明） */
export function imageEmbed(line: string): { target: string; alt: string } | null {
  const m = IMAGE_EMBED.exec(line)
  return m ? { target: m[1]!.trim(), alt: (m[2] ?? '').trim() } : null
}

/**
 * ![[图.png]] 指的是库里哪个文件（Obsidian 的找法）：先按这篇笔记的相对路径、再按库根目录的路径，
 * 都没有就按名字（或路径的后几截）在全库找，同一个文件夹里的先，路径短的先。paths 是库里的文件（相对库根目录）
 */
export function pickEmbed(paths: readonly string[], notePath: string, link: string): string | null {
  const have = new Set(paths)
  const rel = resolveLink(notePath, link)
  if (rel && have.has(rel)) return rel
  const want = link.replace(/^\.?\//, '')
  if (have.has(want)) return want
  const low = want.toLowerCase()
  const hits = paths.filter((p) => {
    const l = p.toLowerCase()
    return l === low || l.endsWith('/' + low)
  })
  if (!hits.length) return null
  const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : ''
  return hits.sort((a, b) => Number(!a.startsWith(dir)) - Number(!b.startsWith(dir)) || a.length - b.length || a.localeCompare(b))[0]!
}
