// 主进程里用 pdf.js 读 PDF：元数据、每页文字和位置。给导入、AI 上下文和「简单重排」用。

export interface TextItem {
  str: string
  x: number
  y: number // 从页面顶部往下量
  w: number
  h: number // 字号
}

export interface PageText {
  width: number
  height: number
  items: TextItem[]
}

export interface PdfExtract {
  pageCount: number
  info: Record<string, unknown>
  pages: PageText[]
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<PdfjsModule> | null = null
function pdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

export async function extractPdf(data: Uint8Array): Promise<PdfExtract> {
  const lib = await pdfjs()
  const task = lib.getDocument({ data, useSystemFonts: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const meta = await doc.getMetadata().catch(() => ({ info: {} }))
    const pages: PageText[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const items: TextItem[] = []
      for (const it of tc.items) {
        if (!('str' in it) || !it.str) continue
        const [a, b, , , e, f] = it.transform as number[]
        const size = Math.hypot(a, b) || it.height
        items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, h: size })
      }
      pages.push({ width: vp.width, height: vp.height, items })
      page.cleanup()
    }
    return { pageCount: doc.numPages, info: (meta.info ?? {}) as Record<string, unknown>, pages }
  } finally {
    await task.destroy()
  }
}

export interface Line {
  text: string
  x: number
  y: number
  w: number
  h: number
}

// 同一基线的文字项拼成行；行内按 x 排序，间距大于半个字宽补空格
export function itemsToLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: (Line & { main: number })[] = []
  for (const it of sorted) {
    const tol = Math.max(2, it.h * 0.4)
    const line = lines.find(
      (l) =>
        Math.abs(l.y - it.y) <= tol &&
        // 字号差太多的不拼（首字下沉的大写字母会把旁边的行吞掉）
        Math.abs(l.h - it.h) < Math.max(l.h, it.h) * 0.35 &&
        ((it.x >= l.x + l.w - it.h * 0.5 && it.x - (l.x + l.w) < it.h * 0.9) || (it.x + it.w <= l.x && l.x - (it.x + it.w) < it.h * 0.9))
    )
    if (line) {
      const gap = it.x - (line.x + line.w)
      if (it.x >= line.x + line.w - 1) {
        line.text += (gap > it.h * 0.15 && !line.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str
        line.w = Math.max(line.w, it.x + it.w - line.x)
      } else {
        line.text = it.str + ' ' + line.text
        line.w = line.x + line.w - it.x
        line.x = it.x
      }
      // 行高取字数最多的那一项，上下标和特殊符号不把整行撑大
      if (it.str.length > line.main) {
        line.main = it.str.length
        line.h = it.h
      }
    } else lines.push({ text: it.str, x: it.x, y: it.y, w: it.w, h: it.h, main: it.str.length })
  }
  return lines.map(({ main: _m, ...l }) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text)
}

export function pageToText(p: PageText): string {
  return orderedLines(p)
    .map((l) => l.text)
    .join('\n')
}

// 阅读顺序：通栏行（标题、摘要）在前，之后左栏、右栏；按栏内 y 排
export function orderedLines(p: PageText): Line[] {
  const lines = itemsToLines(p.items)
  const mid = p.width / 2
  const isFull = (l: Line): boolean => l.x < mid - 20 && l.x + l.w > mid + 20
  const twoCol = lines.filter((l) => !isFull(l)).length > lines.length * 0.5
  if (!twoCol) return lines.sort((a, b) => a.y - b.y || a.x - b.x)
  const full = lines.filter(isFull)
  // 页眉页码这类短行不算栏的开始
  const colYs = lines.filter((l) => !isFull(l) && l.w > p.width * 0.25).map((l) => l.y)
  const firstColY = colYs.length ? Math.min(...colYs) : 0
  const head = full.filter((l) => l.y < firstColY)
  const tail = full.filter((l) => l.y >= firstColY)
  const left = lines.filter((l) => !isFull(l) && l.x < mid).sort((a, b) => a.y - b.y)
  const right = lines.filter((l) => !isFull(l) && l.x >= mid).sort((a, b) => a.y - b.y)
  return [...head.sort((a, b) => a.y - b.y), ...left, ...right, ...tail.sort((a, b) => a.y - b.y)]
}

const BAD_TITLE = /^(untitled|microsoft word|document\d*|paper|main|manuscript|\S+\.(pdf|docx?|tex|dvi))/i

export interface GuessedMeta {
  title: string | null
  authors: string[]
  year: number | null
}

// 从 PDF 元数据和第一页取标题、作者、年份；取不到的字段留空，交给 GLM
export function guessMetadata(info: Record<string, unknown>, first: PageText | undefined): GuessedMeta {
  let title: string | null = null
  const infoTitle = typeof info.Title === 'string' ? info.Title.trim() : ''
  if (infoTitle.length > 8 && !BAD_TITLE.test(infoTitle)) title = infoTitle
  let authors: string[] = []
  const infoAuthor = typeof info.Author === 'string' ? info.Author.trim() : ''
  if (infoAuthor && !/^(user|admin|author|unknown)$/i.test(infoAuthor)) authors = splitAuthors(infoAuthor)

  if (!title && first) {
    // 第一页上半部分字号最大的连续几行当标题
    const lines = itemsToLines(first.items).filter((l) => l.y < first.height * 0.45 && l.text.length > 2)
    if (lines.length) {
      const maxH = Math.max(...lines.map((l) => l.h))
      const big = lines.filter((l) => l.h >= maxH * 0.92).sort((a, b) => a.y - b.y)
      const joined = big.map((l) => l.text).join(' ').trim()
      if (joined.length > 8 && maxH >= 12) title = joined
    }
  }

  let year: number | null = null
  const date = typeof info.CreationDate === 'string' ? /D:(\d{4})/.exec(info.CreationDate) : null
  const firstText = first ? first.items.map((i) => i.str).join(' ') : ''
  const pub = /(?:published|publication|accepted|©|copyright)[^0-9]{0,40}((?:19|20)\d{2})/i.exec(firstText)
  if (pub) year = Number(pub[1])
  else if (date) year = Number(date[1])
  return { title, authors, year }
}

function splitAuthors(s: string): string[] {
  return s
    .split(/\s*(?:;|,|\band\b|&)\s*/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1 && !/^(fellow|member|senior|student|ieee)/i.test(a))
}

// 简单重排：MinerU 失败时的退路。按行距和栏位拼段落，字号明显大的或「I. INTRODUCTION」样式的行当标题。
export function simpleReflow(pages: PageText[], title: string): string {
  const out: string[] = [`# ${title}`]
  const allH = pages.flatMap((p) => p.items.map((i) => Math.round(i.h * 2) / 2))
  const bodyH = mode(allH) || 10
  for (const p of pages) {
    const lines = orderedLines(p)
    let para: string[] = []
    let prev: Line | null = null
    let prevHeading: Line | null = null
    const flush = (): void => {
      if (para.length) out.push(joinLines(para))
      para = []
    }
    for (const l of lines) {
      const startsUpper = /^[A-Z0-9]/.test(l.text)
      // 以小写、逗号、连字符结尾的大字行多半是正文接着往下走，不当标题
      const continues = /[a-z,-]$/.test(l.text)
      const numbered = /^([IVX]+\.|\d+(\.\d+)*\.?)\s+[A-Z][A-Za-z ,\-:]{2,}$/.test(l.text) || (/^[A-Z]\.\s+[A-Z][a-z]/.test(l.text) && l.text.length < 60)
      const isHeading = startsUpper && l.text.length < 90 && ((l.h > bodyH * 1.18 && !continues) || numbered)
      if (isHeading) {
        flush()
        // 连续几行同样大的字（多行标题）拼成一个标题
        const last = out[out.length - 1]
        if (prevHeading && last.startsWith('## ') && Math.abs(prevHeading.h - l.h) < 0.5 && l.y - prevHeading.y < l.h * 2) out[out.length - 1] = `${last} ${l.text}`
        else out.push(`## ${l.text}`)
        prevHeading = l
        prev = null
        continue
      }
      prevHeading = null
      if (prev) {
        const gap = l.y - prev.y
        const newCol = gap < 0 || Math.abs(l.x - prev.x) > p.width * 0.3
        const bigGap = gap > Math.max(prev.h, l.h) * 1.7
        const indent = l.x - prev.x > l.h * 0.8 && l.x - prev.x < l.h * 3
        if ((bigGap && !newCol) || indent) flush()
      }
      para.push(l.text)
      prev = l
    }
    flush()
  }
  return out.join('\n\n') + '\n'
}

function joinLines(lines: string[]): string {
  let s = ''
  for (const l of lines) {
    if (!s) s = l
    else if (/[A-Za-z]-$/.test(s)) s = s.slice(0, -1) + l
    else s += ' ' + l
  }
  return s
}

function mode(xs: number[]): number {
  const c = new Map<number, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  let best = 0
  let n = 0
  for (const [k, v] of c) if (v > n) [best, n] = [k, v]
  return best
}
