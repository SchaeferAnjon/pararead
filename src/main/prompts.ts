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

// 意群对照（照会议字幕的 enhance 请求）：一段原文和它的译文，按句子切开、每句按意群切块，给出每块的原文片段和译文片段。
// 字段固定叫 en / zh（原文、译文是别的语言时也叫这两个名字）。
const SENSES_EXAMPLE = {
  en: 'If you increase the learning rate too much, the loss $L$ will start to diverge [3]. Could you tell me why the new model converges faster on the small dataset?',
  zh: '学习率调得太大，损失 $L$ 就会开始发散[3]。你能说说为什么新模型在小数据集上收敛更快吗？',
  out: {
    sentences: [
      [
        { en: 'If you increase the learning rate too much,', zh: '学习率调得太大，' },
        { en: 'the loss $L$ will start to diverge [3].', zh: '损失 $L$ 就会开始发散[3]。' }
      ],
      [
        { en: 'Could you tell me', zh: '你能说说' },
        { en: 'why the new model converges faster', zh: ['为什么新模型', '收敛更快'] },
        { en: 'on the small dataset?', zh: '在小数据集上' }
      ]
    ]
  }
}
export function sensesMessages(en: string, zh: string): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        '你做双语对照的意群对齐。给你一段原文（en）和它的译文（zh），把原文按句子切开，每一句再按意群切成几块，给出每块的原文片段 en 和它在译文里对应的片段 zh。',
        '- 一句 2 到 5 块：主干、从句、介词短语、插入语各自一块；很短的句子可以只有 1 块。',
        '- en 从原文里原样复制（公式 $…$、引用号 [3]、标点都照抄，不改一个字），按原文顺序首尾相接：所有 en 连起来就是整段原文，开头和结尾都不能漏。',
        '- zh 必须是译文里连续的原样子串，各块的 zh 互不重叠；译文的语序和原文不同没关系。',
        '- 一块原文对应的译文被别的内容隔开了，zh 就给数组，列出译文里的这几段，每段都是译文的原样子串。',
        '- 不要把一个 $…$ 公式切成两块。',
        '只输出 JSON：{"sentences": [[{"en": "…", "zh": "…"}]]}。外层一项是一句，里层是这一句的各块。',
        '',
        '示例',
        `en：${SENSES_EXAMPLE.en}`,
        `zh：${SENSES_EXAMPLE.zh}`,
        `输出：${JSON.stringify(SENSES_EXAMPLE.out)}`
      ].join('\n')
    },
    { role: 'user', content: `en：${en}\nzh：${zh}` }
  ]
}

// 术语表：读这篇论文要懂的术语和缩写，原文原样、译名、一句解释
export function termsMessages(o: { title: string; context: string; lang: string }): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        `你帮读者读一篇论文，列出读懂它要知道的术语。只输出 JSON：{"terms": [{"term": "…", "zh": "…", "explain": "…"}]}。`,
        '- 挑 12 到 20 个：这个领域的专业术语、方法和模型名、文中自己起的名字、缩写（缩写和全称各算一条，都要在文中出现过）。',
        '- 人人都懂的学术用语不挑（paper、experiment、results、dataset 这类）。',
        '- term 从正文里原样复制：大小写、单复数、连字符都不改，不加引号。',
        `- zh 是它的${o.lang}译名（通行的说法；人名、模型名、缩写没有通行译名的照抄原文）。`,
        `- explain 用${o.lang}写一句话，说它在这篇论文里指什么，不超过 40 字，不用破折号。`,
        '- 按在文中第一次出现的先后排。'
      ].join('\n')
    },
    { role: 'user', content: `论文标题：${o.title}\n\n${o.context}` }
  ]
}

