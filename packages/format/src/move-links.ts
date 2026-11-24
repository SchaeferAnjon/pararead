/**
 * 文件夹改名、文件挪走以后，md 里写着旧路径的地方跟着改：相对链接（图片、PDF、别的笔记）和带路径的双链 [[课程/ecp/第一讲]]。
 * 只看路径，不改别的字；指的东西没挪、这篇自己也没挪的链接一个字不动（打开再保存文件不变）。
 */
import { relativeLink, resolveLink } from './blocks'

/** 库里的旧路径 → 新路径；不受影响的返回 null */
export type PathMap = (path: string) => string | null

/** 文件夹 from 改成 to：它自己和里面的东西都换前缀 */
export function folderMap(from: string, to: string): PathMap {
  return (p) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : null)
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * 一篇 md 里的链接按挪动改好。
 * oldPath / newPath：这篇自己挪之前 / 之后的路径（没挪就一样）；map：别的东西挪到了哪。
 */
export function remapLinks(text: string, oldPath: string, newPath: string, map: PathMap): string {
  const sameDir = dirOf(oldPath) === dirOf(newPath)
  let out = text.replace(/(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g, (all, a: string, url: string, b: string) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return all
    const cut = url.search(/[#?]/)
    const path = cut === -1 ? url : url.slice(0, cut)
    const suffix = cut === -1 ? '' : url.slice(cut)
    if (!path) return all
    const abs = resolveLink(oldPath, path)
    if (!abs) return all
    const target = map(abs) ?? abs
    if (sameDir && target === abs) return all
    return a + relativeLink(newPath, target) + suffix + b
  })
  // 双链平时只写名字（改名时 relink 管）；写了路径的才看
  out = out.replace(/\[\[([^\]|#^\n]+\/[^\]|#^\n]*)(?=[\]|#^])/g, (all, inner: string) => {
    const t = inner.trim()
    const direct = map(t)
    if (direct !== null) return `[[${direct}`
    const md = map(t + '.md')
    return md !== null && md.endsWith('.md') ? `[[${md.slice(0, -3)}` : all
  })
  // 数据库（```base 代码块）的数据源 file.inFolder("文件夹")：文件夹改名、挪走时跟着换，不然表变成 0 条；
  // 关联列连到的文件夹（properties 里的 to: 课程/ecp/练习）也一样，不然关联、汇总全空（数据库第三批）
  out = out.replace(/^(```base[^\n]*\n)([\s\S]*?)(^```)/gm, (_all, open: string, body: string, close: string) => {
    const next = body
      .replace(/(file\.inFolder\(\s*)(["'])([^"'\n]+)\2/g, (m, a: string, q: string, folder: string) => {
        const to = map(folder)
        return to === null ? m : a + q + to + q
      })
      .replace(/^([ \t]+to:[ \t]+)(["']?)([^"'\n#]*?[^"'\n#\s])\2([ \t]*(?:#.*)?)$/gm, (m, a: string, q: string, folder: string, tail: string) => {
        const to = map(folder.replace(/\/+$/, ''))
        return to === null ? m : a + q + to + q + tail
      })
    return open + next + close
  })
  return out
}
