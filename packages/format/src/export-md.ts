/**
 * 导出为 Markdown（文档「⋯」、文件树右键「导出为 Markdown…」）：一篇笔记变成别的软件能直接打开的一个文件夹
 *   <标题>/<标题>.md
 *   <标题>/附件/<用到的图和文件>
 * 定法（2026-11-24）：
 * - 库里的图、附件（![](…)、![[…]]、[字](x.pdf)、[[x.pdf]]）拷进「附件/」，链接改成相对路径 `附件/名字`（空格、括号转成 %20 这类）；
 *   重名的第二份叫「名字 2.png」。网址、data: 原样。
 * - [[双链]] 和指向库里别的笔记的 [字](x.md)：那篇不在导出的文件夹里，只留字（有别名留别名，「笔记#标题」写成「笔记 › 标题」）；
 *   ![[笔记]] 嵌入一篇也只留字。库里找不到的图、链接原样留着。
 * - 我们自己的写法去掉：白板的位置行 `<!-- card … -->` `<!-- column … -->`、行尾的块编号 ` ^abc123`。
 *   属性（frontmatter）、提示块 `> [!note]`、高亮 `==…==`、公式、表格是别的软件也认的写法，照留。
 * - 代码块、行内代码里的字一个不动。
 */
import { resolveLink } from './blocks'
import { pickEmbed, wikiLabel } from './wiki-label'

export const EXPORT_ASSETS = '附件'

export interface MdExport {
  text: string
  /** 要拷的文件：from 是库里的路径，to 是导出文件夹里的路径（附件/名字） */
  copies: { from: string; to: string }[]
}

const IMG = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i
const MD = /\.md$/i
const LAYOUT_LINE = /^\s*<!--\s*(card|column)\b.*-->\s*$/
const LINKS = /(!?)\[\[([^\]\n]+)\]\]|(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?)\)/g
const BLOCK_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/

/** 链接里的路径：别的软件按网址读，空格、括号、% 这几个要转 */
export const linkPath = (p: string) => p.replace(/[%() <>#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stemOf = (n: string) => (n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n)

/** 双链露出来的字：有别名露别名；「笔记#标题」→「笔记 › 标题」；#^块号 不露 */
function wikiText(inner: string): string {
  const shown = wikiLabel(inner).replace(/\s*#\^[^#|]*$/, '')
  return shown.startsWith('#') ? shown.slice(1).trim() : shown.replace(/\s*#\s*/, ' › ')
}

/**
 * text：笔记全文；notePath：它在库里的路径；files：库里所有文件（相对库根目录，找 ![[图.png]] 和判断链接指向的文件在不在用）
 */
export function exportMarkdown(text: string, notePath: string, files: readonly string[]): MdExport {
  const have = new Set(files)
  const copies: MdExport['copies'] = []
  const taken = new Map<string, string>()
  /** 库里这个文件拷进附件/，返回在导出文件夹里的路径 */
  const asset = (from: string): string => {
    const hit = copies.find((c) => c.from === from)
    if (hit) return hit.to
    const name = nameOf(from)
    let pick = name
    for (let n = 2; taken.has(pick.toLowerCase()); n++) pick = name.includes('.') ? `${stemOf(name)} ${n}${name.slice(name.lastIndexOf('.'))}` : `${name} ${n}`
    taken.set(pick.toLowerCase(), from)
    const to = `${EXPORT_ASSETS}/${pick}`
    copies.push({ from, to })
    return to
  }
  /** 库里的一个非 md 文件（图、PDF……）：在就拷 */
  const inVault = (p: string | null): p is string => !!p && have.has(p) && !MD.test(p)

  const wiki = (embed: boolean, inner: string): string => {
    const bar = inner.indexOf('|')
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
    const alias = bar === -1 ? '' : inner.slice(bar + 1).trim()
    const file = target.replace(/#.*$/, '').trim()
    const hit = file && !MD.test(file) && /\.[a-z0-9]+$/i.test(file) ? pickEmbed(files, notePath, file) : null
    if (inVault(hit)) {
      const to = linkPath(asset(hit))
      const frag = target.slice(file.length)
      if (embed && IMG.test(hit)) {
        // ![[图.png|300]]：| 后面是数字的是宽度，不当说明
        const alt = alias && !/^\d+(x\d+)?$/.test(alias) ? alias : stemOf(nameOf(hit))
        return `![${alt}](${to})`
      }
      return `[${alias || nameOf(hit)}](${to}${frag.replace(/ /g, '%20')})`
    }
    return wikiText(inner)
  }

  const link = (all: string, bang: string, label: string, raw: string, title: string): string => {
    const angle = raw.startsWith('<')
    const url = angle ? raw.slice(1, -1) : raw
    const hashAt = url.search(/[#?]/)
    const bare = hashAt === -1 ? url : url.slice(0, hashAt)
    const frag = hashAt === -1 ? '' : url.slice(hashAt)
    if (!bare) return all
    const target = resolveLink(notePath, bare)
    if (!target) return all
    if (MD.test(target)) return have.has(target) && !bang ? label : all
    if (!inVault(target)) return all
    return `${bang}[${label}](${linkPath(asset(target))}${frag}${title})`
  }

  // 一遍认完：改出来的「附件/…」不会再被当成库里的链接认一次
  const rewrite = (s: string): string =>
    s.replace(LINKS, (all, wb: string | undefined, inner: string | undefined, lb: string, label: string, raw: string, title: string) =>
      inner !== undefined ? wiki(wb === '!', inner) : link(all, lb, label, raw, title),
    )

  /** 行内代码不动：按反引号切开，只改代码外面的 */
  const outsideCode = (line: string): string => line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : rewrite(part))).join('')

  const out: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && !line.trim().slice(f[1]!.length).trim()) fence = null
      continue
    }
    if (f) {
      fence = f[1]!
      out.push(line)
      continue
    }
    if (LAYOUT_LINE.test(line)) continue
    out.push(outsideCode(line.replace(BLOCK_ID, '')))
  }
  return { text: out.join('\n'), copies }
}
