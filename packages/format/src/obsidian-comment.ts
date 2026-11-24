/**
 * 从 Obsidian 导入时的 `%%注释%%`（我们不认这个写法）：整段的（开头的 %% 在行首、收尾的 %% 在行尾）变成收起的提示块
 * `> [!note]- 注释`，正文一行行放进去；一行里夹着的、没收尾的原样留着，数出几处（导入结果里列出来）。
 * 代码块、行内代码、开头的属性里的 %% 不算。紧挨着正文的提示块前后补一个空行（不然下一行会并进提示块）。
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const OPEN = /^[ \t]*%%/

const count = (line: string) => (line.replace(/`[^`\n]*`/g, '').match(/%%/g) ?? []).length

export interface ObsidianComments {
  text: string
  /** 变成提示块的 */
  blocks: number
  /** 一行里夹着的、没收尾的：原样留着 */
  inline: number
}

export function obsidianComments(text: string): ObsidianComments {
  if (!text.includes('%%')) return { text, blocks: 0, inline: 0 }
  const lines = text.split('\n')
  const out: string[] = []
  let blocks = 0
  let loose = 0
  let i = 0
  // 开头的属性原样
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      out.push(...lines.slice(0, end + 1))
      i = end + 1
    }
  }
  let fence: string | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) {
      fence = f[1]!
      out.push(line)
      continue
    }
    const body = blockAt(lines, i)
    if (!body) {
      loose += count(line)
      out.push(line)
      continue
    }
    blocks++
    const content = body.content
    while (content.length && !content[0]!.trim()) content.shift()
    while (content.length && !content[content.length - 1]!.trim()) content.pop()
    if (!content.length) out.push('')
    else {
      if (out.length && out[out.length - 1]!.trim()) out.push('')
      out.push('> [!note]- 注释', ...content.map((l) => (l.trim() ? `> ${l}` : '>')))
      const next = lines[body.end + 1]
      if (next !== undefined && next.trim()) out.push('')
    }
    i = body.end
  }
  return { text: blocks ? out.join('\n') : text, blocks, inline: Math.ceil(loose / 2) }
}

/** 从第 i 行开始的整段注释：到哪一行为止、里面的几行；不是整段的返回 null */
function blockAt(lines: string[], i: number): { end: number; content: string[] } | null {
  const first = lines[i]!
  if (!OPEN.test(first)) return null
  const rest = first.replace(OPEN, '')
  const n = count(rest)
  if (n === 1) {
    // 一行写完：收尾的 %% 在行尾，中间没有别的 %%
    const m = /^(.*)%%[ \t]*$/.exec(rest)
    return m && !m[1]!.includes('%%') ? { end: i, content: [m[1]!] } : null
  }
  if (n > 1) return null
  // 几行夹着：往下找第一个带 %% 的行，%% 在它的行尾才算
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!
    if (FENCE.test(l)) return null
    const k = count(l)
    if (!k) continue
    const m = /^(.*)%%[ \t]*$/.exec(l)
    if (k !== 1 || !m) return null
    return { end: j, content: [rest, ...lines.slice(i + 1, j), m[1]!] }
  }
  return null
}
