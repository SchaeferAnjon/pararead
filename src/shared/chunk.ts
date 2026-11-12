import type { Block, BlockType } from './types'
import { paraHash } from './hash'

// 把 MinerU 输出的 Markdown 切成块：标题、段落、图注、公式块、图片、表格、details。
// MinerU 用空行分块；$$ 公式、<table>、<details> 内部可能有空行，要整体收进一块。
export function chunkMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const raw: { type: BlockType; md: string; level?: number }[] = []
  let buf: string[] = []

  const flush = (): void => {
    const text = buf.join('\n').trim()
    buf = []
    if (!text) return
    raw.push(classify(text))
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (t.startsWith('$$')) {
      flush()
      const body: string[] = [line]
      const closedOnSameLine = t.length > 2 && t.endsWith('$$') && t !== '$$'
      if (!closedOnSameLine) {
        while (++i < lines.length) {
          body.push(lines[i])
          if (lines[i].trim().endsWith('$$')) break
        }
      }
      raw.push({ type: 'equation', md: body.join('\n').trim() })
      continue
    }
    const tag = /^<(table|details)\b/i.exec(t)
    if (tag) {
      flush()
      const close = new RegExp(`</${tag[1]}>`, 'i')
      const body: string[] = [line]
      if (!close.test(t)) {
        while (++i < lines.length) {
          body.push(lines[i])
          if (close.test(lines[i])) break
        }
      }
      raw.push({ type: tag[1].toLowerCase() === 'table' ? 'table' : 'details', md: body.join('\n').trim() })
      continue
    }
    if (/^#{1,6}\s/.test(t)) {
      flush()
      raw.push(classify(t))
      continue
    }
    if (t === '') flush()
    else buf.push(line)
  }
  flush()

  const seen = new Map<string, number>()
  return raw.map((b) => {
    const hash = paraHash(b.md)
    const n = seen.get(hash) ?? 0
    seen.set(hash, n + 1)
    return {
      id: n === 0 ? hash : `${hash}-${n}`,
      hash,
      type: b.type,
      level: b.level,
      md: b.md,
      translatable: (b.type === 'paragraph' || b.type === 'heading' || b.type === 'caption') && hasWords(b.md, b.type === 'heading' ? 1 : 2)
    }
  })
}

function classify(text: string): { type: BlockType; md: string; level?: number } {
  const h = /^(#{1,6})\s+(.*)$/.exec(text)
  if (h && !text.includes('\n')) return { type: 'heading', level: h[1].length, md: h[2].trim() }
  if (/^!\[[^\]]*\]\([^)]*\)$/.test(text) || /^(!\[[^\]]*\]\([^)]*\)\s*)+$/.test(text)) return { type: 'image', md: text }
  if (/^<table\b/i.test(text)) return { type: 'table', md: text }
  if (/^(Fig\.|Figure|TABLE|Table)\s*[IVX\d]+\b/.test(text)) return { type: 'caption', md: text }
  return { type: 'paragraph', md: text }
}

// 只有公式、编号或很短的碎片不值得翻译
function hasWords(md: string, min: number): boolean {
  const plain = md.replace(/\$[^$]*\$/g, '').replace(/<[^>]+>/g, '')
  const words = plain.match(/[A-Za-z]{2,}/g)
  return !!words && words.length >= min
}

// 给 AI 的上下文：去掉内嵌图片和 details，必要时截断。
export function markdownForContext(md: string, limit = 60000): { text: string; truncated: boolean; ratio: number } {
  const clean = md
    .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '[图]')
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    // HTML 表格压成竖线分隔的行，省掉标签占的字数
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<\/tr>\s*<tr[^>]*>/gi, '\n')
    .replace(/<\/?(table|tbody|thead|tr|td|th)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length <= limit) return { text: clean, truncated: false, ratio: 1 }
  return { text: clean.slice(0, limit), truncated: true, ratio: limit / clean.length }
}

// 每块所属小节：最近的上一个标题
export function sectionsOf(blocks: Block[]): Map<string, string> {
  const map = new Map<string, string>()
  let cur = ''
  for (const b of blocks) {
    if (b.type === 'heading') cur = b.md
    map.set(b.id, cur)
  }
  return map
}

// basic 结果替换 flash 时找回阅读位置：先找同哈希的块，再找文字前缀相同的段落，最后找同名标题。
export function alignPosition(
  blocks: Block[],
  pos: { blockHash?: string; textPrefix?: string; heading?: string }
): string | null {
  if (pos.blockHash) {
    const hit = blocks.find((b) => b.hash === pos.blockHash)
    if (hit) return hit.id
  }
  if (pos.textPrefix) {
    const p = squash(pos.textPrefix).slice(0, 60)
    if (p.length >= 12) {
      const hit = blocks.find((b) => squash(b.md).startsWith(p.slice(0, 40)))
      if (hit) return hit.id
    }
  }
  if (pos.heading) {
    const h = squash(pos.heading)
    const hit = blocks.find((b) => b.type === 'heading' && squash(b.md) === h)
    if (hit) return hit.id
  }
  return null
}

// 只留字母数字，抹掉两档输出在公式、上下标写法上的差别
export function squash(s: string): string {
  return s
    .replace(/\$[^$]*\$/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase()
}

// 原文模式的高亮在重排结果里找所在小节：按字母数字串匹配段落，找不到返回 null
export function sectionForText(blocks: Block[], sections: Map<string, string>, text: string): string | null {
  const n = squash(text).slice(0, 40)
  if (n.length < 6) return null
  const hit = blocks.find((b) => b.type !== 'heading' && squash(b.md).includes(n))
  return hit ? (sections.get(hit.id) ?? null) : null
}
