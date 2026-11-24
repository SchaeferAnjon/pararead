/**
 * 配对笔记：画布笔记库里 PDF 旁边那篇「<PDF 名> 笔记.md」，画布笔记读 PDF 时问一处记一段，ParaRead 往同一篇里写。
 * 段落的写法、读法、按身份整段替换一律调 @cn/format（画布笔记自己记一段用的同一份代码），这里只把 ParaRead 的数据换成它的 AskSection。
 * 不自己拼 md：联动设计（canvas-notes 20-pararead联动）真跑时，ParaRead 试过两种照着样子拼的近似写法，画布笔记都认错了。
 * 契约测试在 packages/format/test/pararead-contract.test.ts（样本由这里的函数生成），改了 @cn/format 的读法这边当场红。
 *
 * 一段的身份是第二行行尾的 <!-- cn:thread=<名字> -->。ParaRead 写的名字是「<PDF 名>-p<页>-pr-<记录号>」：
 * 记录号取标注、对话的 id，同一处再写一次就按它整段替换，不重复；画布笔记自己起的名字以数字结尾（-p28-1），两边不撞。
 *
 * 写进文件的字（「看不懂」「有质疑」）照画布笔记写进库里的说法，不跟 ParaRead 的界面语言走。
 */
import { type AskQa, type AskSection, attachDirFor, cleanQuestion, clockOf, confusedQ, demoteHeadings, newReadingNote, parseReadingNote, type Rect, threadId, upsertSection, withDerived } from '@cn/format'
import { latest, plainExplain } from './explainText'
import { splitFollowups } from './followups'
import type { Annotation, ChatMessage } from './types'

const stem = (pdf: string) => (pdf.split('/').pop() ?? pdf).replace(/\.[^.]+$/, '')
const short = (id: string) => id.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'x'
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
/** 截到 n 个字加「…」；截在英文词中间时退到前一个空格（models 不截成 model） */
const cut = (s: string, n: number) => {
  const t = oneLine(s)
  if (t.length <= n) return t
  let head = t.slice(0, n - 1)
  if (/[A-Za-z0-9]$/.test(head) && /^[A-Za-z0-9]/.test(t.slice(n - 1))) {
    const sp = head.lastIndexOf(' ')
    if (sp > n / 2) head = head.slice(0, sp)
  }
  return head.replace(/[\s,，、;；:：]+$/, '') + '…'
}

/** 回答的第一句（小结用）：到第一个句号、问号、叹号或换行 */
const firstSentence = (a: string) => cut(/^[^\n]*?(?:[。！？!?]|\.(?=\s|$)|$)/m.exec(a.replace(/^#+\s.*\n?/gm, '').trim())?.[0] ?? '', 40)

/** 这一处在笔记里的身份（.canvas-notes/对话/<名字>.md，和画布笔记同一种写法） */
export const pairedThreadId = (pdf: string, page: number, recordId: string) => threadId(`${stem(pdf)}-p${Math.max(1, Math.floor(page))}-pr-${short(recordId)}`)

// 不翻：写进库里笔记的字，跟库的语言（画布笔记的写法），不跟 ParaRead 的界面语言
const LABEL_WORD = { confused: '看不懂', doubt: '有质疑' } as const
// 不翻：标签处理到哪了，写在这一段的小结前面（画布笔记按「看懂了」不再数这一处看不懂）
const STATUS_WORD: Partial<Record<NonNullable<Annotation['labelStatus']>, string>> = { understood: '看懂了', upheld: '质疑成立', dismissed: '质疑不成立', checking: '还要查' }

/**
 * 一问一答：问题、回答照画布笔记记一段时的处理（apps/notes 的 main/reading/section.ts）：问题去掉多余的空行，
 * 回答里的 # 、## 降到 ### 以下，不然这一段在 ## 那里被切成两段（契约测试里真出过）
 */
const qa = (q: string, a: string): AskQa => ({ q: cleanQuestion(q), a: demoteHeadings(a.trim()), sides: [] })

const base = (pdf: string, id: string, page: number, title: string, at: number): AskSection => ({
  id,
  file: pdf,
  page,
  title,
  time: clockOf(new Date(at)),
  figures: [],
  doubts: [],
  good: '',
  points: [],
  failed: [],
  rounds: 0,
  links: [],
  qas: [],
})

/**
 * 打了「看不懂」「有质疑」的一处 → 一段问题段（联动设计页「两边看到的完全一样」的写法）：
 * 标题写标签和卡在哪（没有就用标注上自己写的话，再没有用原文）；问题块头一行是标签，下面是原文、自己写的话；
 * 回答是最新一版讲解，讲解卡里接着问的几轮跟在后面；小结是处理到哪了（看懂了、质疑不成立……）加回答的第一句。
 * 原文写在问题块里、不另起引用块：这样不算选字问，画布笔记打开 PDF 时照框的位置补「我框的」截图。
 * 没打标签、没有页码的（对照模式里摘的是译文、找不到页）不写。
 */
export function annotationSection(pdf: string, a: Annotation, name?: string): AskSection | null {
  if (!a.label || !a.page || a.page < 1) return null
  const word = (a.label === 'confused' && name?.trim()) || LABEL_WORD[a.label]
  const v = latest(a.explain)
  const own = a.note.trim()
  const s = base(pdf, pairedThreadId(pdf, a.page, a.id), a.page, `${word}：${cut(v?.focus.trim() || own || a.text, 40)}`, a.createdAt)
  const r = a.mode === 'pdf' ? a.rects?.[0] : undefined
  if (r && r.length === 4) s.rect = r.map((n) => Math.round(n * 1000) / 1000) as Rect
  // 看不懂写进笔记里划线那一份以后（有 hl）：问题是「看不懂」加原文和划线的身份（@cn/format 的 confusedQ），画布笔记当它是红色波浪线那一条
  const q = a.label === 'confused' && a.hl ? [confusedQ({ id: a.hl, text: a.text }, word), own].filter(Boolean).join('\n') : [word, oneLine(a.text), own].filter(Boolean).join('\n')
  s.qas = [qa(q, v ? plainExplain(v.raw) : ''), ...(a.explain?.chat ?? []).map((t) => qa(t.q, t.a))]
  const status = a.labelStatus ? STATUS_WORD[a.labelStatus] : undefined
  const lead = firstSentence(s.qas.find((x) => x.a)?.a ?? '')
  const recap = [status, lead].filter(Boolean).join('：')
  if (recap) s.recap = recap
  return withDerived(s)
}

/** 对照、译文看法里框了一块问的：截图放进库里的哪个路径（原文那张不加后缀，译文那张加 .zh，同一个附件文件夹） */
export function boxCropPaths(pdf: string, m: Pick<ChatMessage, 'id' | 'box'>): { src?: string; tr?: string } {
  const b = m.box
  if (!b) return {}
  const base = `${attachDirFor(pdf)}/p${Math.max(1, Math.floor(b.page))}-pr-${short(m.id)}`
  return { ...(b.side !== 'tr' && b.src ? { src: `${base}.png` } : {}), ...(b.side !== 'src' && b.tr ? { tr: `${base}.zh.png` } : {}) }
}

/**
 * 一篇论文的 AI 问答 → 几段：带着摘录问的一问开一段（页码按摘录在原文里找，pageOf 找不到时记第 1 页），
 * 在对照、译文看法里框了一块问的也开一段：页码、框照原 PDF（两边版面一样），截图照截的那边（译文的图注「我框的 · 译文」，两边都带时原文在前），
 * 后面没带摘录的接着问并进同一段；第一次带摘录之前问的（问整篇）也是一段。出错没回答的那一问不写。
 * 小结是第一个回答的第一句（画布笔记是让 AI 另写一句；ParaRead 这一步不为它再问一次 AI）。
 */
export function chatSections(pdf: string, msgs: ChatMessage[], pageOf: (quote: string) => number | null): AskSection[] {
  const out: AskSection[] = []
  let cur: AskSection | null = null
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!
    if (m.role !== 'user') continue
    const reply = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1]! : null
    if (reply?.error || !m.content.trim()) continue
    // 回答末尾的「接着问：a|b|c」是 ParaRead 界面上的建议按钮，不进笔记
    const turn = qa(m.content, splitFollowups(reply?.content ?? '').body)
    if (m.quote?.trim() || m.box || !cur) {
      const page = m.box ? Math.max(1, Math.floor(m.box.page)) : (m.quote && pageOf(m.quote)) || 1
      cur = base(pdf, pairedThreadId(pdf, page, m.id), page, cut(turn.q.split('\n')[0]!, 40), m.createdAt)
      if (m.quote?.trim()) cur.quote = oneLine(m.quote)
      if (m.box) {
        cur.rect = m.box.rect.map((n) => Math.round(n * 1000) / 1000) as Rect
        const p = boxCropPaths(pdf, m)
        if (p.src) cur.crop = p.src
        if (p.tr && p.src) cur.cropTr = p.tr
        else if (p.tr) ((cur.crop = p.tr), (cur.cropSide = 'tr'))
      }
      out.push(cur)
    }
    cur.qas!.push(turn)
  }
  for (const s of out) {
    const lead = firstSentence(s.qas!.find((x) => x.a)?.a ?? '')
    if (lead) s.recap = lead
  }
  return out.map(withDerived)
}

/**
 * 把几段写进那篇笔记：还没有这篇就照画布笔记新建（属性、一级标题）；同一处整段换掉，别的段落、用户另起标题写的一个字不动。
 * 这一步 ParaRead 的数据为准：在画布笔记里改了 ParaRead 写的那一段（比如在它的问题下面接着写字），ParaRead 再写这一处时会被换回去。
 * 笔记成为两边唯一的一份、ParaRead 先读回来再改，是「ParaRead 接库」那一步的事。
 */
export function writeSections(md: string | null, pdf: string, note: string, sections: AskSection[], now = new Date()): string {
  let text = md ?? newReadingNote(pdf, now)
  for (const s of sections) text = upsertSection(text, s, note)
  return text
}

/** 读回来（画布笔记读这一篇用的同一个函数） */
export const readSections = (md: string, note: string) => parseReadingNote(md, note)
