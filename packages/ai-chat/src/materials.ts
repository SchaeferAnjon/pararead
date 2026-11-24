/**
 * 输入框里收进来的材料（多段引用方向 B「材料一排加编号」）：引用的一段字，或一张图。
 * 输入框顶上一排小卡，字里在当时的光标处留一个编号 ①②③；发出去时交给 AI 的话里照旧是 ①②，后面按同一套编号列出每块材料（图叫「图②」）。
 * 读 PDF 的这一问把材料列表带在 AskRequest.mats 里，后面记笔记用（第 3 段写成 md 脚注 [^1]）。界面、主进程共用，不碰 Electron；
 * 几句界面字（「3段引用」「引用的材料不对」）走 @cn/ai-engines/shared 的 t()，宿主 setI18n 交翻译。主进程从 @cn/ai-chat/materials 引（不带组件；画布笔记经 src/shared/materials.ts 转引）。
 */
import { list, t } from '@cn/ai-engines/shared'

/**
 * 一块材料。src 是来源（「AI的回答 · 第28页」「《随手记》」「粘贴的图」「第28页 · 我框的」）；
 * 图是软件设置目录 pasted/ 里的名字（和粘贴的图同一个地方），发给引擎时作为图片一起附上；page：PDF 上框的那页
 */
export type Material = { kind: 'quote'; text: string; src: string; /** 网页上引的（task-6cxtc）：那一页的网址，问完写进笔记时块头带回到那一段的链接 */ url?: string } | { kind: 'image'; name: string; src: string; page?: number; url?: string }

/** 字里的编号：①…⑳，一次最多 20 块 */
export const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
export const MAX_MATERIALS = MARKS.length

/** pasted/ 里的文件名（主进程起的 uuid） */
export const PASTED_NAME = /^[0-9a-f-]{36}\.(png|jpg)$/

/** 第 n 块的编号（从 1 数） */
export const markOf = (n: number): string => MARKS[n - 1] ?? ''
/** 这个字是第几个编号；不是编号是 0 */
export const numberOf = (ch: string): number => MARKS.indexOf(ch) + 1

/**
 * 材料删了、换了顺序：字里的编号跟着改。to[i] 是原来第 i+1 块现在是第几块（从 1 数），0 是删掉了（字里那个编号去掉）；
 * 比原来块数大的编号（自己打的 ⑨）不动。at：原来字里的位置在新字里是哪儿（删掉的编号在它前面就往前挪）
 */
export function renumberMarks(text: string, to: number[]): { text: string; at(pos: number): number } {
  let out = ''
  const gone: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    const n = numberOf(ch)
    if (!n || n > to.length) {
      out += ch
      continue
    }
    const m = to[n - 1]!
    if (m === 0) gone.push(i)
    else out += markOf(m)
  }
  return { text: out, at: (pos) => pos - gone.filter((i) => i < pos).length }
}

/** 一段字里的编号往后挪 by 个（排着的那一问退回输入框、接在已经有的材料后面） */
export const shiftMarks = (text: string, count: number, by: number): string =>
  renumberMarks(
    text,
    Array.from({ length: count }, (_, i) => i + 1 + by),
  ).text

/**
 * 交给 AI 的话：字里照旧是 ①②（和用户在输入框、发出去那条里看到的同一套），后面一行一块列出材料：引文写「引文②」加原文和来源，
 * 图写「图①」加来源和它在附图里排第几（AI 好对上是哪张）；叫 AI 提材料时用编号说（以前写「附上的第 2 张图」，AI 回答里说
 * 「你粘贴的第 2 张图」，和字里的 ② 混，真 AI 那一遍看到的）。images：这一问前面已经附了几张图（读 PDF 框的那块），材料里的图接着往后排
 */
export function withMaterials(text: string, mats: Material[] | undefined, images = 0): string {
  if (!mats?.length) return text
  let k = images
  const lines = mats.map((m, i) => {
    const n = markOf(i + 1)
    // 不翻：给 AI 的话（材料一行一块）
    return m.kind === 'quote' ? `${n} 引文${n}「${m.text}」（${m.src}）` : `${n} 图${n}（${m.src}；附图里排第 ${++k}）`
  })
  const head = text.trim()
  // 不翻：给 AI 的话
  return `${head ? head + '\n\n' : ''}我引用的材料（字里的 ①② 是它们的位置。回答里提到哪一块就用它的编号说，比如「引文②」「图①」，不要说「第几张图」「第几段」）：\n${lines.join('\n')}`
}

/** 底行提示的前半句：「3段引用、2张图」 */
export function countLine(mats: readonly Material[]): string {
  const q = mats.filter((m) => m.kind === 'quote').length
  const g = mats.length - q
  return list([q ? t('{n}段引用', { n: q }) : '', g ? t('{n}张图', { n: g }) : ''].filter(Boolean))
}

/** 材料里的图（pasted/ 里的名字，按顺序） */
export const imageNames = (mats: readonly Material[] | undefined): string[] => (mats ?? []).flatMap((m) => (m.kind === 'image' ? [m.name] : []))

/** 界面给的材料（主进程收到时查一遍）：不对的整个不收 */
export function checkMaterials(x: unknown): Material[] | undefined {
  if (x === undefined) return undefined
  if (!Array.isArray(x) || x.length > MAX_MATERIALS) throw new Error(t('引用的材料不对'))
  return x.map((m): Material => {
    const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
    if (typeof o.src !== 'string' || o.src.length > 300) throw new Error(t('引用的材料不对'))
    const url = typeof o.url === 'string' && o.url.length <= 4000 && /^https?:\/\//i.test(o.url) ? { url: o.url } : {}
    if (o.kind === 'quote' && typeof o.text === 'string' && o.text.length <= 20_000) return { kind: 'quote', text: o.text, src: o.src, ...url }
    if (o.kind === 'image' && typeof o.name === 'string' && PASTED_NAME.test(o.name))
      return { kind: 'image', name: o.name, src: o.src, ...(typeof o.page === 'number' && Number.isFinite(o.page) ? { page: o.page } : {}), ...url }
    throw new Error(t('引用的材料不对'))
  })
}
