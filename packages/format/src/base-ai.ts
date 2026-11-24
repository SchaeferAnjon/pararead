/**
 * 数据库的 AI 列（第三批 task-i921u，设计「AI 生成一列」方向 B）：说一句要什么，AI 逐条读那一条的笔记，填进这一列。
 *
 * 写法（base 块 properties 里这一列；`ai:` 只在给这一列单独选了家时才写，跟 AI 对话时不写）：
 *
 *   练习题:
 *     type: ai
 *     prompt: 每一讲的练习题
 *     output: note                 text / select / multi / number / note（新建一篇笔记，关联过来）
 *     folder: 课程/ecp/练习题       output 是 note 时新建的笔记放哪
 *     twoWay: 所属讲               新建那篇开头连回这一条的那一行
 *     reads: note                  note：只读那一条的笔记全文；attached：再加它配着的 PDF、网页
 *     newRows: auto                auto：新加的一条自动填；manual：点了才填
 *     ai: claude/sonnet/high       单独选的家 / 模型 / 想多久（不写：跟 AI 对话）
 *
 * 每格的值写在那一条开头一行（`难度: 中`、`关键词: [边际产量, 短期]`、`练习题: "[[第3讲 生产 练习题]]"`），
 * 再在「AI填的」那一行（props.ts AI_KEY，拍导图、读 PDF 记笔记也用它）记一笔；用户手改过的从里面去掉，整列重跑不动它。
 * output 是 note 时新建 `<folder>/<这一条> <列名>.md`：开头「所属讲」连回来，正文是带引擎标志的 [!ai] 块（ai-callout.ts 那一套）；
 * 重跑只换那篇里这一列的 [!ai] 块，块下面用户写的答案不动。
 *
 * 打开再保存不变：读（aiColOf、aiCellOf）不改字；写（aiCellWrites、aiHandEdit）只换那一条开头两行、那篇里那一块。
 * AI 读的时候那篇长什么样（说「原文改过」用的 aiSourceKey）记在这台 Mac 上，不写进文件。
 * 纯函数，不依赖 Electron 和 Node：主进程（跑 AI、写盘）、界面（画格子）、手机版共用。
 */
import { aiCallout } from './ai-callout'
import { isAiHead, isEdited } from './ai-block'
import type { BaseDoc, PropDef } from './base-doc'
import type { BaseCtx, BaseRec } from './base-rows'
import { listOf } from './base-types'
import type { FileWrite } from './base-write'
import { AI_KEY, aiFilled, readPropList, setProp, setPropList } from './props'

/** 放成什么：文字、单选、多选、数字，或者每条新建一篇笔记、关联过来 */
export type AiOutput = 'text' | 'select' | 'multi' | 'number' | 'note'
/** 读什么：只读那一条的笔记全文；笔记加它配着的 PDF、网页 */
export type AiReads = 'note' | 'attached'

/** 单独给这一列选的家、模型、想多久（没选是 null：跟 AI 对话） */
export interface AiColPick {
  engine: string
  model?: string
  effort?: string
}

export interface AiColDef {
  type: 'ai'
  prompt: string
  output: AiOutput
  /** output 是 note 时新建的笔记放哪个文件夹 */
  folder: string | null
  /** 新建那篇开头连回来的那一行（「所属讲」） */
  twoWay: string | null
  reads: AiReads
  newRows: 'auto' | 'manual'
  ai: AiColPick | null
}

export const AI_OUTPUTS: { output: AiOutput; label: string; icon: string }[] = [
  { output: 'text', label: '文字', icon: 'symbol-string' },
  { output: 'select', label: '单选', icon: 'arrow-circle-down' },
  { output: 'multi', label: '多选', icon: 'list-unordered' },
  { output: 'number', label: '数字', icon: 'symbol-numeric' },
  { output: 'note', label: '新建一篇笔记，关联过来', icon: 'new-file' },
]

/** 常用的 5 个（点一下就填好要求、列名、放成什么；照原型） */
export const AI_PRESETS: { key: string; label: string; prompt: string; name: string; output: AiOutput }[] = [
  { key: 'sum', label: '摘要', prompt: '用一句话概括这一讲讲了什么', name: '摘要', output: 'text' },
  { key: 'kw', label: '关键词', prompt: '这一讲的 2 到 3 个关键词', name: '关键词', output: 'multi' },
  { key: 'ex', label: '练习题', prompt: '每一讲出 3 道练习题，由浅到深', name: '练习题', output: 'note' },
  { key: 'diff', label: '难度', prompt: '这一讲对初学者难不难：易、中、难', name: '难度', output: 'select' },
  { key: 'en', label: '翻译标题', prompt: '把这一讲的标题翻成英文', name: '英文标题', output: 'text' },
]

/** 一次几格同时写 */
export const AI_BATCH = 3
/** 样例跑几条 */
export const AI_SAMPLE = 3
/** 笔记超过这么多字时只读目录和每节开头 */
export const AI_READ_MAX = 50_000

const OUTPUTS = AI_OUTPUTS.map((o) => o.output)
/** 双链写的是哪一篇（同 base-rows 的 linkTarget；这里另写一行，免得和 base-doc 绕成一圈） */
const linkTarget = (raw: string) => (/^\[\[([^\]|#^]*)/.exec(raw.trim())?.[1] ?? raw.trim()).trim().replace(/\.md$/i, '')

// ---------------------------------------------------------------- 写法：读、写 properties 里这一列

/** properties 里这一列（parseBaseDoc 的 propDefOf 调）：认不出的值当默认 */
export function aiDefOf(y: Record<string, unknown>): AiColDef {
  const s = (k: string) => (typeof y[k] === 'string' ? (y[k] as string).trim() : '')
  const out = s('output') as AiOutput
  return {
    type: 'ai',
    prompt: s('prompt'),
    output: OUTPUTS.includes(out) ? out : 'text',
    folder: s('folder').replace(/\/+$/, '') || null,
    twoWay: s('twoWay') || null,
    reads: s('reads') === 'attached' ? 'attached' : 'note',
    newRows: s('newRows') === 'manual' ? 'manual' : 'auto',
    ai: pickOf(s('ai')),
  }
}

/** `claude/sonnet/high` → 家、模型、想多久（空的段不算） */
export function pickOf(s: string): AiColPick | null {
  const [engine, model, effort] = s.split('/').map((x) => x.trim())
  if (!engine) return null
  return { engine, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}

/** 写回去的样子：家/模型/想多久（模型空着、想多久有时留一个空段） */
export const pickText = (p: AiColPick) => [p.engine, p.model ?? '', p.effort ?? ''].join('/').replace(/\/+$/, '')

/** 这一列写成 properties 里的几个键（顺序照设计：type、prompt、output、folder、twoWay、reads、newRows、ai） */
export function aiDefFields(d: AiColDef): { key: string; value: string }[] {
  return [
    { key: 'type', value: 'ai' },
    { key: 'prompt', value: d.prompt },
    { key: 'output', value: d.output },
    ...(d.output === 'note' && d.folder ? [{ key: 'folder', value: d.folder }] : []),
    ...(d.output === 'note' && d.twoWay ? [{ key: 'twoWay', value: d.twoWay }] : []),
    { key: 'reads', value: d.reads },
    { key: 'newRows', value: d.newRows },
    ...(d.ai ? [{ key: 'ai', value: pickText(d.ai) }] : []),
  ]
}

/** 这一列是 AI 列：给它的设置，不是给 null */
export function aiColOf(doc: BaseDoc | BaseCtx, col: string): AiColDef | null {
  const d = ('doc' in doc ? doc.doc : doc).props[col.replace(/^note\./, '')]
  return d?.type === 'ai' ? d : null
}

/** 这一列的值按哪种类型读（排序、筛选、看板分组用）：练习题那种是一个双链，当文字 */
export function aiStoredType(d: AiColDef): 'text' | 'select' | 'multi' | 'number' {
  return d.output === 'note' ? 'text' : d.output
}

// ---------------------------------------------------------------- 说要什么：猜列名、猜放成什么

/** 照写的要求猜放成什么（原型 kindOf）：练习题、出题 → 新建一篇笔记；关键词、标签 → 多选；难度 → 单选；几个、多少 → 数字；别的文字 */
export function guessOutput(prompt: string): AiOutput {
  const p = prompt.trim()
  const preset = AI_PRESETS.find((x) => x.prompt === p)
  if (preset) return preset.output
  if (/练习|习题|出题|题目|考题|笔记|提纲|大纲/.test(p)) return 'note'
  if (/关键词|标签|分类/.test(p)) return 'multi'
  if (/难度|难不难|多难|等级|优先/.test(p)) return 'select'
  if (/几个|多少|评分|打分|分数|几分|数量/.test(p)) return 'number'
  return 'text'
}

/** 照写的要求起列名（原型 nameOf）：「每一讲的练习题」→「练习题」 */
export function guessColName(prompt: string): string {
  const p = prompt.trim()
  const preset = AI_PRESETS.find((x) => x.prompt === p)
  if (preset) return preset.name
  let s = p
    .replace(/^(给|帮我|请)?(每一讲|每一篇|每一条|每条|每讲|每篇|这一讲|这一篇)(的|都)?/, '')
    .replace(/^(出|写|生成|列出|总结|概括)/, '')
    .replace(/[，,。.：:；;（(].*$/, '')
    .trim()
  s = s.replace(/^\d+\s*(道|个|句)/, '').replace(/^几(道|个)/, '').replace(/^的/, '')
  return s.slice(0, 8).replace(/[:/\\]/g, '') || 'AI 列'
}

/** 新建的笔记默认放哪：和数据源文件夹同一层的「<列名>」文件夹（课程/ecp/课程计划 → 课程/ecp/练习题） */
export function aiNoteFolder(source: string | null, col: string): string {
  const parent = source && source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
  return parent ? `${parent}/${col}` : col
}

/** 新建那篇的名字：「第3讲 生产 练习题」 */
export const aiNoteName = (recName: string, col: string) => `${recName} ${col}`.replace(/[\\/:]/g, ' ').trim()

/** 新建那篇开头连回来那一行默认叫什么：数据源文件夹是「课程计划」→「所属讲」，别的「所属」+ 数据库名 */
export function aiTwoWayName(source: string | null): string {
  const name = source ? source.split('/').pop()! : ''
  if (/课程|讲/.test(name)) return '所属讲'
  return name ? `所属${name}` : '所属'
}

// ---------------------------------------------------------------- 一格：现在是什么样

/** 一格的样子：AI 写的（带引擎标志）、你改过的（灰点）、空着 */
export type AiCellState = 'ai' | 'mine' | 'empty'

export interface AiCellView {
  state: AiCellState
  /** 格子里的字（单选、文字、数字）；多选是 items；练习题那种是那篇的名字 */
  text: string
  items: string[]
  /** 练习题那种：连到的那篇（路径；那边没有这篇时是 null）、几道题、第一题 */
  note?: { name: string; path: string | null; count: number; first: string }
}

/** 一条记录这一列现在的值（只看不写） */
export function aiCellOf(ctx: BaseCtx, rec: BaseRec, col: string): AiCellView {
  const d = aiColOf(ctx, col)
  const key = col.replace(/^note\./, '')
  const items = rec.lists[key] ?? (rec.props[key] ? (d?.output === 'multi' ? listOf(rec.props[key]!) : []) : [])
  const raw = (rec.props[key] ?? '').trim()
  const text = d?.output === 'multi' ? items.join(', ') : raw
  if (!text && !items.length) return { state: 'empty', text: '', items: [] }
  let state: AiCellState = aiFilled(rec.text).includes(key) ? 'ai' : 'mine'
  if (d?.output === 'note') {
    const name = linkTarget(raw).split('/').pop()!
    const pool = d.folder ? (ctx.related.get(d.folder) ?? []) : []
    const hit = pool.find((r) => r.name === name) ?? null
    const sum = hit ? aiNoteSummary(hit.text, key) : { count: 0, first: '', edited: false }
    if (state === 'ai' && sum.edited) state = 'mine'
    return { state, text: name, items: [], note: { name, path: hit?.path ?? null, count: sum.count, first: sum.first } }
  }
  return { state, text, items: d?.output === 'multi' ? items : [] }
}

/** 这一列的 [!ai] 块在那篇里的哪几行（头一行写着列名的那一块；没有就是第一个 [!ai] 块） */
function aiBlockLines(text: string, col: string): { from: number; to: number; head: string } | null {
  const lines = text.split('\n')
  let found: { from: number; to: number; head: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    if (!isAiHead(lines[i]!)) continue
    let j = i + 1
    while (j < lines.length && /^ {0,3}>/.test(lines[j]!)) j++
    const head = lines[i]!.replace(/^ {0,3}>[ \t]*\[!ai\][+-]?[ \t]*/i, '')
    const label = head.split(' · ')[0]!.replace(/（第\s*\d+\s*版）|\s*\(v\d+\)/, '').trim()
    const b = { from: i, to: j, head }
    if (label === col) return b
    found ??= b
  }
  return found
}

/** 那篇练习题笔记：这一列的 [!ai] 块里有几道（编号或圆点的一项算一道）、第一道、头上有没有「改过」；items 是每一道（右栏样例整段摊开），没有列表时是正文每一段 */
export function aiNoteSummary(text: string, col: string): { count: number; first: string; edited: boolean; items: string[] } {
  const b = aiBlockLines(text, col)
  if (!b) return { count: 0, first: '', edited: false, items: [] }
  const body = text
    .split('\n')
    .slice(b.from + 1, b.to)
    .map((l) => l.replace(/^ {0,3}> ?/, ''))
  const items = body.filter((l) => /^\s{0,3}(\d+[.)、]|[-*+])\s+\S/.test(l)).map((l) => l.replace(/^\s*(\d+[.)、]|[-*+])\s+/, '').trim())
  const first = items[0] ?? body.find((l) => l.trim())?.trim() ?? ''
  return { count: items.length, first, edited: isEdited(b.head), items: items.length ? items : body.map((l) => l.trim()).filter(Boolean) }
}

/** 这一块是第几版（头上「练习题（第 2 版）」）；没有写是 1 */
function versionOf(head: string): number {
  const m = /（第\s*(\d+)\s*版）|\(v(\d+)\)/.exec(head.split(' · ')[0] ?? '')
  return m ? Number(m[1] ?? m[2]) : 1
}

// ---------------------------------------------------------------- 跑哪几格

/** 跑哪几格：sample 前 3 条（照视图的顺序）；rest、empty 空着的；all 整列（你改过的不动）；one 指定那一条 */
export type AiRunMode = 'sample' | 'rest' | 'empty' | 'all'

/** order：当前视图看到的先后（路径）；返回要跑的路径 */
export function aiQueue(ctx: BaseCtx, col: string, mode: AiRunMode, order: string[]): string[] {
  const recs = order.map((p) => ctx.recs.find((r) => r.path === p)).filter((r): r is BaseRec => !!r)
  if (mode === 'sample') return recs.slice(0, AI_SAMPLE).filter((r) => aiCellOf(ctx, r, col).state !== 'mine').map((r) => r.path)
  return recs
    .filter((r) => {
      const s = aiCellOf(ctx, r, col).state
      return mode === 'all' ? s !== 'mine' : s === 'empty'
    })
    .map((r) => r.path)
}

// ---------------------------------------------------------------- 问 AI：要读什么、怎么问、答回来怎么认

/** 笔记的正文（开头一串属性去掉）：AI 读的、说「原文改过」比的都是它 */
export const noteBody = (text: string) => text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')

/** 正文记下来比的那个值（不写进文件，记在这台 Mac 上）：前后空白不算 */
export function aiSourceKey(text: string): string {
  const s = noteBody(text).trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${s.length}:${h.toString(36)}`
}

/** 太长时读什么：目录（标题）和每节开头一段 */
function outline(body: string): string {
  const out: string[] = []
  let take = 0
  for (const l of body.split('\n')) {
    if (/^#{1,6}\s/.test(l)) {
      out.push(l)
      take = 3
    } else if (take > 0 && l.trim()) {
      out.push(l.slice(0, 400))
      take--
    }
  }
  return out.join('\n')
}

export interface AiAsk {
  system: string
  prompt: string
  /** 头上「读了《第3讲 生产》」那一截 */
  read: string
  /** 读了多少字 */
  chars: number
}

/** 读了什么怎么写：「读了《第3讲 生产》」，太长时「读了《第3讲 生产》的目录和每节开头」，加了配着的「和 2 个 PDF、网页」 */
const readText = (name: string, short: boolean, extra: number) => `读了《${name}》${short ? '的目录和每节开头' : ''}${extra ? `和 ${extra} 个 PDF、网页` : ''}`

/**
 * 给一格问 AI 的话：要求、放成什么、这一条的名字和笔记全文（太长读目录和每节开头）；attached 是配着的 PDF、网页的字（reads: attached 时给）。
 * 提示第一行是「命令：数据库AI列」（假 AI 照这个答，测试用）
 */
export function aiAsk(d: AiColDef, col: string, rec: BaseRec, options: string[], attached: { name: string; text: string }[] = []): AiAsk {
  let body = noteBody(rec.text).trim()
  const short = body.length > AI_READ_MAX
  if (short) body = outline(body)
  const kind: Record<AiOutput, string> = {
    text: '一段话（一行，不换行，最多 120 字）',
    select: `从选项里挑一个，只写这个选项${options.length ? `（现有选项：${options.join('、')}；都不合适时可以新起一个，两三个字）` : '（两三个字）'}`,
    multi: `1 到 3 个短词，用「、」隔开${options.length ? `（用过的优先：${options.join('、')}）` : ''}`,
    number: '只写一个数（阿拉伯数字）；实在写不出数就写「写不出：」加一句原因',
    note: '一篇笔记的正文（Markdown；题目、要点用编号列表，不要标题，不要开场白和结尾的客套话）',
  }
  const system =
    '你在帮一个人填他笔记数据库里的一列。每次给你一条记录（一篇笔记），照这一列的要求写这一格要放的内容。' +
    '只回答这一格的内容本身：不要解释你在做什么，不要客套，不要用代码块包起来。用这条笔记的语言回答。'
  const files = attached.filter((a) => a.text.trim())
  const prompt = [
    '命令：数据库AI列',
    `列名：${col}`,
    `要求：${d.prompt}`,
    `放成：${kind[d.output]}`,
    `这一条：${rec.name}`,
    `${short ? '笔记太长，这里是目录和每节开头' : '笔记全文'}：`,
    '<<<',
    body || '（这一篇还没有正文）',
    '>>>',
    ...files.flatMap((f) => [`配着的《${f.name}》：`, '<<<', f.text.length > AI_READ_MAX ? f.text.slice(0, AI_READ_MAX) + '\n……（后面太长，没给）' : f.text, '>>>']),
  ].join('\n')
  return { system, prompt, read: readText(rec.name, short, files.length), chars: body.length + files.reduce((n, f) => n + Math.min(f.text.length, AI_READ_MAX), 0) }
}

/** AI 答回来的一格：认成要写的值；认不出（数字列没写数、空的）给一句为什么 */
export function aiParse(d: AiColDef, answer: string, options: string[] = []): { value: string | string[] } | { error: string } {
  let a = answer.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim()
  if (!a) return { error: 'AI 没写出来（答回来是空的）' }
  const clean = (s: string) =>
    s
      .trim()
      .replace(/^["'“”「『]+|["'“”」』。.]+$/g, '')
      .trim()
  switch (d.output) {
    case 'note':
      return { value: a.replace(/^#\s+.*\n+/, '') }
    case 'text': {
      a = a.replace(/\s*\n+\s*/g, ' ')
      return { value: clean(a).slice(0, 500) }
    }
    case 'select': {
      const first = clean(a.split(/\n/)[0]!.replace(/^(选项|答案|难度)[:：]\s*/, ''))
      const hit = options.find((o) => o === first) ?? options.find((o) => first.includes(o))
      return { value: hit ?? first.slice(0, 12) }
    }
    case 'multi': {
      const items = [...new Set(a.split(/[,，、;；\n]/).map((x) => clean(x.replace(/^[-*\d.)\s]+/, ''))).filter(Boolean))].slice(0, 5)
      return items.length ? { value: items.map((x) => x.slice(0, 16)) } : { error: 'AI 没写出来' }
    }
    case 'number': {
      const m = /-?\d+(?:\.\d+)?/.exec(a)
      if (!m || /^写不出/.test(a)) return { error: a.replace(/^写不出[:：]?\s*/, '写不出数：').slice(0, 80) }
      return { value: m[0] }
    }
  }
}

// ---------------------------------------------------------------- 写一格（改前改后的字，写盘、提交由主进程做）

export interface AiCellInput {
  /** 那一条 */
  path: string
  col: string
  /** aiParse 认好的值 */
  value: string | string[]
  /** 「Claude Code · Opus 5.5」 */
  by: string
  /** 「读了《第3讲 生产》」 */
  read: string
  /** output 是 note 时：那篇现在的字（没有这篇是 null） */
  noteText?: string | null
}

/** 新建那篇的路径 */
export function aiNotePath(d: AiColDef, recName: string, col: string): string {
  return `${d.folder ?? ''}${d.folder ? '/' : ''}${aiNoteName(recName, col)}.md`
}

/** 「AI填的」加上这一列（已经有了不动） */
function markAi(text: string, key: string): string {
  const ai = aiFilled(text)
  return ai.includes(key) ? text : setProp(text, AI_KEY, [...ai, key].join(', '))
}

/**
 * 写一格：那一条开头这一列一行 + 「AI填的」记一笔；output 是 note 时那篇新建（开头连回来、正文 [!ai] 块）或只换它这一列的 [!ai] 块（第几版加一）。
 * 返回要写的文件（那篇原来没有时 before 是空字）；那一条找不到返回空
 */
export function aiCellWrites(ctx: BaseCtx, input: AiCellInput): FileWrite[] {
  const d = aiColOf(ctx, input.col)
  const rec = ctx.recs.find((r) => r.path === input.path)
  if (!d || !rec) return []
  const key = input.col.replace(/^note\./, '')
  const out: FileWrite[] = []
  let after: string
  if (d.output === 'note') {
    const name = aiNoteName(rec.name, key)
    const path = aiNotePath(d, rec.name, key)
    const before = input.noteText ?? ''
    const body = Array.isArray(input.value) ? input.value.join('\n') : input.value
    const old = before ? aiBlockLines(before, key) : null
    const block = aiCallout({ label: key, by: input.by, seen: input.read, text: body, ...(old ? { version: versionOf(old.head) + 1 } : {}) })
    let note: string
    if (old) {
      const lines = before.split('\n')
      note = [...lines.slice(0, old.from), block, ...lines.slice(old.to)].join('\n')
    } else if (before) {
      // 那篇在、但没有 AI 块（用户自己建的同名笔记）：块插在开头属性后面，原来的字留着
      const fm = /^---\n[\s\S]*?\n---\n?/.exec(before)?.[0] ?? ''
      note = fm + (fm ? '\n' : '') + block + '\n\n' + before.slice(fm.length).replace(/^\n+/, '')
    } else note = `${d.twoWay ? `---\n${d.twoWay}: "[[${rec.name}]]"\n---\n\n` : ''}${block}\n`
    if (note !== before) out.push({ path, before, after: note })
    after = markAi(setProp(rec.text, key, `[[${name}]]`), key)
  } else if (d.output === 'multi') after = markAi(setPropList(rec.text, key, Array.isArray(input.value) ? input.value : listOf(input.value)), key)
  else after = markAi(setProp(rec.text, key, Array.isArray(input.value) ? input.value.join(', ') : input.value), key)
  if (after !== rec.text) out.unshift({ path: rec.path, before: rec.text, after })
  return out
}

/**
 * 手改一格（文字、单选、多选、数字）：值换成用户写的，「AI填的」里去掉这一列（算你写的，整列重跑不动它）。
 * 空字拿掉这一行。练习题那种不在这里改：打开那篇直接改
 */
export function aiHandEdit(ctx: BaseCtx, path: string, col: string, value: string | string[]): FileWrite[] {
  const d = aiColOf(ctx, col)
  const rec = ctx.recs.find((r) => r.path === path)
  if (!d || !rec || d.output === 'note') return []
  const key = col.replace(/^note\./, '')
  let after = d.output === 'multi' ? setPropList(rec.text, key, Array.isArray(value) ? value : listOf(value)) : setProp(rec.text, key, (Array.isArray(value) ? value.join(', ') : value).trim() || undefined)
  const left = aiFilled(after).filter((k) => k !== key)
  if (left.length !== aiFilled(after).length) after = setProp(after, AI_KEY, left.length ? left.join(', ') : undefined)
  return after === rec.text ? [] : [{ path, before: rec.text, after }]
}

/** 列改名：「AI填的」里记着的旧列名换成新的（每一条开头那一行的键由 renameProp 换） */
export function aiRenameFilled(text: string, from: string, to: string): string {
  const ai = aiFilled(text)
  return ai.includes(from) ? setProp(text, AI_KEY, ai.map((k) => (k === from ? to : k)).join(', ')) : text
}

/**
 * 删除这一列（连 AI 建的笔记）：每一条开头这一列那一行、「AI填的」里这一笔拿掉；AI 建的那几篇删掉（after 空字 = 删掉这个文件）。
 * notes：AI 建的那几篇现在的字（路径 → 字）。返回要写的文件，和那几篇里用户在 AI 块下面写过字的（问的时候单独列出来）
 */
export function aiDropColumn(ctx: BaseCtx, col: string, notes: Record<string, string>): { writes: FileWrite[]; written: string[] } {
  const d = aiColOf(ctx, col)
  if (!d) return { writes: [], written: [] }
  const key = col.replace(/^note\./, '')
  const writes: FileWrite[] = []
  const written: string[] = []
  for (const rec of ctx.recs) {
    let after = d.output === 'multi' && readPropList(rec.text, key) ? setPropList(rec.text, key, []) : setProp(rec.text, key, undefined)
    const left = aiFilled(after).filter((k) => k !== key)
    if (left.length !== aiFilled(after).length) after = setProp(after, AI_KEY, left.length ? left.join(', ') : undefined)
    if (after !== rec.text) writes.push({ path: rec.path, before: rec.text, after })
    if (d.output !== 'note') continue
    const p = aiNotePath(d, rec.name, key)
    const t = notes[p]
    if (t === undefined) continue
    writes.push({ path: p, before: t, after: '' })
    const b = aiBlockLines(t, key)
    const rest = b ? [...t.split('\n').slice(0, b.from), ...t.split('\n').slice(b.to)].join('\n') : t
    if (noteBody(rest).replace(new RegExp(`^${d.twoWay ?? '\\u0000'}:.*$`, 'm'), '').trim()) written.push(p)
  }
  return { writes, written }
}

/** 一个 PropDef 是 AI 列 */
export const isAiDef = (d: PropDef | undefined): d is AiColDef => d?.type === 'ai'
