import type { ChatMsg } from './glm'

export function translateSystem(lang: string): string {
  return [
    `你是学术论文翻译。把用户给的英文论文片段译成${lang}。`,
    '要求：',
    `1. 用规范的学术${lang}书面语，忠实原文，不增不减，不添加任何解释或注释。`,
    '2. 专业术语第一次出现时括注英文，例如「存内计算（in-memory computing）」。同一批里同一术语只注一次。',
    '3. 公式（$...$、$$...$$）、HTML 标签（<sub>、<sup> 等）、引用编号如 [12]、[3]–[5] 原样保留，不翻译、不改写。',
    '4. 人名、软件名、缩写保持英文。句子里不要用破折号（——），改用逗号、冒号或括号；引用编号里的范围符号照原样。',
    '5. 输入里每段用 <seg id="N">...</seg> 包着，输出也必须用同样的 <seg id="N">译文</seg> 一一对应，不要输出其他任何内容。'
  ].join('\n')
}

export function buildTranslateBatch(items: { id: string; text: string }[], lang: string): ChatMsg[] {
  const user = items.map((it) => `<seg id="${it.id}">${it.text}</seg>`).join('\n\n')
  return [
    { role: 'system', content: translateSystem(lang) },
    { role: 'user', content: user }
  ]
}

// 解析 <seg id="N">...</seg>；缺的段返回 undefined，调用方当作失败
export function parseTranslateBatch(output: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /<seg\s+id="([^"]+)"\s*>([\s\S]*?)<\/seg>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(output))) map.set(m[1], cleanTranslation(m[2]))
  return map
}

// 删掉汉字和西文、数字之间的半角空格，交给 text-autospace 补间距；公式里的空格不动
export function cleanTranslation(s: string): string {
  const cjk = '\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef'
  return s
    .trim()
    .replace(new RegExp(`([${cjk}])[ \\t]+(?=[A-Za-z0-9[(<$])`, 'g'), '$1')
    .replace(new RegExp(`([A-Za-z0-9\\])>$])[ \\t]+(?=[${cjk}])`, 'g'), '$1')
}

export function selectionTranslateMessages(text: string, lang: string): ChatMsg[] {
  return [
    {
      role: 'system',
      content: `把用户选中的论文文字译成${lang}。学术书面语，术语第一次出现时括注英文，公式和引用编号原样保留。只输出译文。`
    },
    { role: 'user', content: text }
  ]
}

export function explainMessages(o: { text: string; paragraph: string; title: string; lang: string }): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        `你在给一位计算机工程硕士讲论文。用${o.lang}解释他选中的那部分内容。`,
        '先一句话说它在这篇论文里是什么意思，再讲清楚背后的概念、为什么这么做；必要时举一个具体的小例子。',
        '术语保留英文原文，公式用 LaTeX（$...$）。不超过 300 字，不要客套话，不用破折号。'
      ].join('\n')
    },
    {
      role: 'user',
      content: `论文标题：${o.title}\n\n所在段落：\n${o.paragraph || '（无）'}\n\n选中的内容：\n${o.text}`
    }
  ]
}

export function chatSystem(o: { title: string; context: string; truncated: boolean; lang: string }): string {
  return [
    `你是论文阅读助手，帮一位计算机工程硕士读这篇论文：《${o.title}》。`,
    `用${o.lang}回答，术语保留英文，公式用 LaTeX（行内 $...$，独立 $$...$$）。`,
    '回答基于论文内容；论文里没有的要说明是你的补充。引用论文位置时写小节号，例如 §III-B。',
    '用 Markdown，条理清楚，不要客套话，不用破折号。',
    o.truncated ? '注意：下面的论文全文太长，只给了前一部分。' : '',
    '',
    '论文全文：',
    o.context
  ]
    .filter((l) => l !== '')
    .join('\n')
}

// 放在用户这条消息末尾：系统提示后面跟着整篇论文，放在那里模型常常忘
export const FOLLOWUP_HINT = '\n\n（回答完以后，最后单独一行写「接着问：」，后面跟 2 到 3 个我可能接着问的短问题，每个不超过 20 字，用「|」分隔，不加编号。）'

export const PRESET_QUESTIONS: Record<string, string> = {
  summary: '总结全文',
  contrib: '这篇论文研究什么问题，主要贡献是什么？',
  method: '方法是怎么做的？请按步骤讲。',
  results: '实验结果怎么样？关键数字有哪些？',
  limits: '这篇论文有哪些局限，可以怎么改进？'
}

export function glanceMessages(o: { title: string; context: string; lang: string }): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        `你帮读者快速了解一篇论文。用${o.lang}输出一个 JSON 对象，不要输出其他内容。字段：`,
        '"tldr": 一句话总结（不超过 60 字）；',
        '"question": 研究问题，2 到 3 条；',
        '"method": 方法要点，3 到 5 条；',
        '"findings": 主要结论，3 到 5 条，带具体数字；',
        '以上三项每条都是 {"text": 要点, "sec": 出处小节编号如 "III-B" 或 "IV", "title": 出处小节在论文里的原标题，如 "B. Mapping Execution Sequence"}；',
        '"keywords": 5 到 8 个关键词（英文术语）；',
        '"worth": 值得精读的部分，2 到 4 个 {"section": 小节名（用论文里的原标题）, "reason": 一句理由}。',
        '术语保留英文，不用破折号。'
      ].join('\n')
    },
    { role: 'user', content: `论文标题：${o.title}\n\n${o.context}` }
  ]
}

export function metadataMessages(firstPage: string): ChatMsg[] {
  return [
    {
      role: 'system',
      content:
        '从论文第一页文字里抽取元数据，只输出 JSON：{"title": 标题, "authors": [作者姓名], "year": 发表年份数字或 null}。作者只要姓名，不要单位和头衔（如 Fellow, IEEE）。'
    },
    { role: 'user', content: firstPage.slice(0, 6000) }
  ]
}

export function majorPointsMessages(o: { title: string; paragraphs: string; count: number }): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        `你帮读者标出一篇论文里最关键的句子。下面是论文的段落，每段前面有编号 [N]。挑出大约 ${o.count} 句，分四类：`,
        'objective（研究目标、要解决的问题）、method（方法、关键设计）、result（主要结论、关键数字）、novelty（创新点、和已有工作的不同）。',
        '每类至少一句。句子必须从原文一字不改地复制（包括标点和大小写），只抄一句，不要拼接、不要改写、不要翻译。',
        '只输出 JSON：{"points": [{"p": 段落编号, "s": "原文句子", "t": "objective|method|result|novelty"}]}，按在论文里出现的顺序。'
      ].join('\n')
    },
    { role: 'user', content: `论文标题：${o.title}\n\n${o.paragraphs}` }
  ]
}

export function conceptsMessages(o: { title: string; context: string; lang: string }): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        `你帮读者读一篇论文。用${o.lang}输出 JSON，不要输出其他内容：`,
        '"concepts": 读懂这篇论文必须先懂的 6 到 8 个核心概念，每个 {"term": 术语（保留英文原文）, "explain": 用${o.lang}写一句话，说它在这篇论文里指什么，不超过 40 字}；',
        `"questions": 4 个读者最可能想问的具体问题，用${o.lang}写，每个不超过 24 字。`,
        `除了术语本身，所有文字都用${o.lang}。`,
        '不用破折号。'
      ].join('\n')
    },
    { role: 'user', content: `论文标题：${o.title}\n\n${o.context}` }
  ]
}
