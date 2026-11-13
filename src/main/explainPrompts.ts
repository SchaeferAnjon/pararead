// 按标签讲解的提示词：看不懂、有质疑、几处一起讲。输出一节一个标签，格式见 shared/explain.ts。
import type { LitItem } from '../shared/types'
import type { ChatMsg } from './glm'

export interface ExplainInput {
  title: string
  lang: string
  text: string // 打了标签的那几个字
  onTr: boolean // 打在译文上（text 是译文）
  paragraph: string // 所在段落的原文
  around: string // 前后两段的原文
  context: string // 全文（按服务的上下文窗口截过）
  terms: string // 这篇的术语表里和这段有关的
  senses: string // 意群对齐（有就带上）
  focus: string // 这次只围着它讲；空是整句
  before: string[] // 前面几版的「一句话」（换个讲法时别重复）
}

const RULES = (lang: string): string =>
  `用${lang}讲，术语保留英文，公式用 LaTeX（$...$）。不用破折号，不要客套话，不要 Markdown 标题。严格按下面的格式输出：每节用标签包住，标签外不写任何字，节里一行一条，字段之间用 || 隔开。`

// 题目的格式写成样子给模型看：只说规则时它常常漏了题干
const QUIZ = [
  '<quiz>一道检验懂没懂的三选一题，照这个样子写四行（第一行是题干，必须有）：',
  '问题：……？',
  '+ 对的选项 || 为什么对',
  '- 错的选项 || 为什么不对',
  '- 错的选项 || 为什么不对',
  '</quiz>'
].join('\n')

function material(o: ExplainInput, extra = ''): string {
  return [
    `论文：《${o.title}》`,
    o.terms && `这篇的术语表（相关的几条）：\n${o.terms}`,
    `所在段落：\n${o.paragraph || '（没找到）'}`,
    o.around && `前后两段：\n${o.around}`,
    o.senses && `这段原文和译文的意群对齐：\n${o.senses}`,
    extra,
    `他标的这处${o.onTr ? '（标在译文上）' : ''}：\n${o.text}`,
    `论文全文（供参考）：\n${o.context}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

function angle(o: ExplainInput): string {
  const a: string[] = []
  if (o.focus) a.push(`这次只围着「${o.focus}」讲：一句话、例子、题目都围着它。`)
  if (o.before.length) a.push(`他看了前面的讲法还是没懂（前面的一句话是：${o.before.map((b) => `「${b}」`).join('、')}）。这次换一个角度，别重复前面的说法和例子。`)
  return a.join('\n')
}

export function confusedMessages(o: ExplainInput & { needChunks: boolean }): ChatMsg[] {
  const system = [
    '你在给一位读英文论文的研究生讲他标了「看不懂」的一处。目标是让他真弄懂，不是复述原文。',
    RULES(o.lang),
    '<focus>两行，一行一处：这处最可能卡住人的两个地方。第一行是一个难词或短语（原文照抄），第二行是一个「为什么」问题，不超过 16 个字。</focus>',
    '<one>一句话讲明白这处在说什么，不超过 80 个字，最要紧的放前面。</one>',
    o.needChunks ? '<chunks>把这处按意群切成 2 到 5 块，每行一块：原文这一块（照抄） || 这块的意思</chunks>' : '',
    '<pre>读懂它先要知道的 1 到 3 个概念，每行：概念 || 一句解释。术语表里有的照术语表的意思讲。</pre>',
    '<example>一个具体的小例子或类比，2 到 4 行，能算的给算式。</example>',
    '<refs>这篇论文里能帮着看懂它的 1 到 3 处（定义、公式、图、后文），每行：位置（如 §II-A 图 2） || 那里讲了什么 || 那里原文的一小段（照抄 6 到 15 个词）</refs>',
    QUIZ,
    angle(o)
  ]
  return [
    { role: 'system', content: system.filter(Boolean).join('\n') },
    { role: 'user', content: material(o) }
  ]
}

export function litBlock(lit: LitItem[]): string {
  if (!lit.length) return '检索到的文献：没有'
  return (
    '检索到的文献（学术检索的结果和本文自己的引用；编号给 <lit> 用）：\n' +
    lit.map((x) => `L${x.n}. ${x.title}${x.year ? `（${x.year}）` : ''}${x.venue ? ` · ${x.venue}` : ''}${x.cited ? ` · 本文引用 ${x.cited}` : ''}`).join('\n')
  )
}

export function doubtMessages(o: ExplainInput & { lit: LitItem[] }): ChatMsg[] {
  const system = [
    '一位读英文论文的研究生对下面这处标了「有质疑」。你帮他查证：说清它的主张、论文自己拿什么撑着、靠了哪些没说出来的前提、别的文献怎么说，最后给出你的倾向，但判断留给他。',
    RULES(o.lang),
    '<focus>两行，一行一处：这处最可疑的两个地方。第一行是一个词或短语（原文照抄），第二行是一个问题，不超过 16 个字。</focus>',
    '<says>类型（推算、实测、引用、定义、有依据的推论、观点 选一个） || 用一句大白话说它的主张</says>',
    '<evidence>论文自己给的依据 2 到 4 条，每行：强弱（g 有力、y 一般或没展开、r 削弱这句） || 小标签，不超过 6 个字（如 有实测、只是算术、引用、削弱这句） || 说明，指明在论文哪里 || 那里原文的一小段（照抄 6 到 15 个词，没有就空着）</evidence>',
    '<assume>这句没说出来的前提 1 到 3 条，每行一条</assume>',
    '<lit>从「检索到的文献」里挑和这句有关的，最多 4 篇，每行：编号（如 L2） || 关系（支持、反驳、被比较的旧方法、相关 选一个） || 一句说明；都无关就只写「无」。不要写列表里没有的文献。</lit>',
    '<asks>可以问作者的问题 1 到 3 个，每行一个，具体、作者能回答</asks>',
    '<lean>upheld（质疑成立）或 dismissed（质疑不成立）或 checking（还要查） || 一句理由</lean>',
    angle(o)
  ]
  return [
    { role: 'system', content: system.filter(Boolean).join('\n') },
    { role: 'user', content: material(o, litBlock(o.lit)) }
  ]
}

export function groupMessages(o: { lang: string; items: { text: string; paragraph: string; paperTitle: string }[]; terms: string }): ChatMsg[] {
  const system = [
    '一位研究生在读论文时把下面几处都标了「看不懂」。先找出这几处共同卡在哪一件事上，把这一件事讲清楚，再逐处说懂了以后这里是什么意思，最后出一道题。',
    RULES(o.lang),
    '<root>这几处共同卡在哪一件事上，一句话，不超过 60 个字</root>',
    '<steps>把这件事讲清楚，3 到 5 步，每行一步，从最基础的讲起</steps>',
    '<back>回到每一处，每行：编号（如 #1） || 懂了上面那件事以后，这处在说什么（一两句）</back>',
    QUIZ
  ]
  const user = [
    o.terms && `术语表（相关的几条）：\n${o.terms}`,
    ...o.items.map((x, i) => `#${i + 1}（${x.paperTitle}）\n标的这处：${x.text}\n所在段落：${x.paragraph || '（没找到）'}`)
  ]
  return [
    { role: 'system', content: system.join('\n') },
    { role: 'user', content: user.filter(Boolean).join('\n\n') }
  ]
}
