// Word 文档这一头（Office.js，要求集 WordApi 1.1；1.3 有的话多做两件小事）：
// 每处引用是一个内容控件，tag = prcite:<文献 id>,…；参考文献表是 tag = prbib 的内容控件；
// 引到的文献信息、当前格式、参考文献表的顺序存在文档自己的设置里（跟着 .docx 走）。
import { t } from '@shared/i18n'
import { BIB_TAG, bibEntries, bibHtml, bibOrder, citeTag, fitsTag, idsOfTag, inText, numbering, type CiteItem, type Items, type WordStyle } from '@shared/wordCite'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Office: any
declare const Word: any

const store = (): any => Office.context.document.settings
const save = (): Promise<void> => new Promise((res, rej) => store().saveAsync((r: any) => (r.status === 'succeeded' ? res() : rej(new Error(r.error?.message ?? t('文档设置没存上'))))))

export const docItems = (): Items => (store().get('pr.items') as Items | null) ?? {}
export const docStyle = (): WordStyle | null => (store().get('pr.style') as WordStyle | null) ?? null
const docBibIds = (): string[] => (store().get('pr.bib') as string[] | null) ?? []

export interface DocState {
  cites: string[][] // 每处引用引的文献 id，按在正文里的先后
  texts: string[] // 每处引用现在的文字
  hasBib: boolean
  bibIds: string[]
  bodyText: string
  items: Items
}

interface Scan {
  cites: string[][]
  ctrls: any[]
  bib: any | null
}
// 正文里的内容控件按出现的先后排好了：挑出引用和参考文献表
async function scan(ctx: any): Promise<Scan> {
  const ccs = ctx.document.body.contentControls
  ccs.load('items/tag,items/text')
  await ctx.sync()
  const out: Scan = { cites: [], ctrls: [], bib: null }
  for (const cc of ccs.items) {
    const ids = idsOfTag(cc.tag ?? '')
    if (ids) (out.cites.push(ids), out.ctrls.push(cc))
    else if (cc.tag === BIB_TAG && !out.bib) out.bib = cc
  }
  return out
}

async function read(ctx: any, s: Scan): Promise<DocState> {
  const body = ctx.document.body
  body.load('text')
  for (const cc of s.ctrls) cc.load('text')
  await ctx.sync()
  return { cites: s.cites, texts: s.ctrls.map((cc) => cc.text as string), hasBib: !!s.bib, bibIds: docBibIds(), bodyText: body.text as string, items: docItems() }
}

export const readDoc = (): Promise<DocState> => Word.run(async (ctx: any) => read(ctx, await scan(ctx)))

/** 更新全文：重新编号、改每处引用的文字、重排参考文献表 */
export function refresh(style: WordStyle): Promise<DocState> {
  const items = docItems()
  return Word.run(async (ctx: any) => {
    const s = await scan(ctx)
    const num = numbering(s.cites)
    s.ctrls.forEach((cc, i) => {
      const want = inText(s.cites[i], style, num, items)
      if (cc.text !== want) cc.insertText(want, 'Replace')
    })
    if (s.bib) s.bib.insertHtml(bibHtml(bibEntries(s.cites, style, items)), 'Replace')
    await ctx.sync()
    store().set('pr.style', style)
    store().set('pr.bib', s.bib ? bibOrder(s.cites, style, items) : [])
    await save()
    return read(ctx, s)
  })
}

/** 在光标处插入一处引用；光标正在一处引用里就把这几篇加进去 */
export async function insertCitation(picked: CiteItem[], style: WordStyle): Promise<DocState> {
  const items = { ...docItems() }
  for (const it of picked) items[it.id] = it
  store().set('pr.items', items)
  await save()
  const v13 = Office.context.requirements.isSetSupported('WordApi', '1.3')
  await Word.run(async (ctx: any) => {
    const sel = ctx.document.getSelection()
    if (v13) {
      const parent = sel.parentContentControlOrNullObject
      parent.load('tag')
      await ctx.sync()
      const had = parent.isNullObject ? null : idsOfTag(parent.tag ?? '')
      if (had) {
        const ids = [...new Set([...had, ...picked.map((p) => p.id)])]
        if (!fitsTag(ids)) throw new Error(t('一处引用里放不下这么多篇，分两处插'))
        parent.tag = citeTag(ids)
        await ctx.sync()
        return
      }
    }
    const ids = picked.map((p) => p.id)
    if (!fitsTag(ids)) throw new Error(t('一处引用里放不下这么多篇，分两处插'))
    // 选中了字就插在选区后面，不替换选中的字
    const cc = sel.insertText('[…]', 'End').insertContentControl()
    cc.tag = citeTag(ids)
    cc.title = t('ParaRead 引用')
    await ctx.sync()
    // 光标放到引用后面，接着打字
    if (v13) (cc.getRange('After').select('End'), await ctx.sync())
  })
  return refresh(style)
}

/** 在光标后面插入参考文献表；已经有了就跳过去并更新 */
export async function insertBib(style: WordStyle): Promise<DocState> {
  await Word.run(async (ctx: any) => {
    const s = await scan(ctx)
    if (s.bib) {
      s.bib.select()
      return ctx.sync()
    }
    const cc = ctx.document.getSelection().insertParagraph('', 'After').insertContentControl()
    cc.tag = BIB_TAG
    cc.title = t('参考文献表')
    return ctx.sync()
  })
  return refresh(style)
}

/** 跳到第 i 处引用 */
export const selectCite = (i: number): Promise<void> =>
  Word.run(async (ctx: any) => {
    const s = await scan(ctx)
    s.ctrls[i]?.select()
    await ctx.sync()
  })
