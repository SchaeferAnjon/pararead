#!/usr/bin/env node
// 界面文案的翻译表：收集源码里所有 t('…') 的键，补齐 src/i18n/<语言>.json 里缺的（用 DeepSeek 翻），删掉不再用的。
//   node scripts/i18n.mjs --check     只列出每种语言缺多少、多出多少，不联网
//   DEEPSEEK_API_KEY=… node scripts/i18n.mjs            补齐缺的
//   … node scripts/i18n.mjs --lang de --redo '键'        重翻某一条（--redo 可以写多次）
//   … node scripts/i18n.mjs --renote                    重翻 NOTES 里有说明的那些条
// 键是简体中文原文（前后空白不算）。{0} {1} 是占位，译文里要原样保留。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const LANGS = { 'zh-Hant': '繁體中文（台灣用語）', en: 'English', ja: '日本語', ko: '한국어', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano' }
const check = process.argv.includes('--check')
const only = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : null

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []))
const keys = new Set()
for (const f of walk(path.join(ROOT, 'src'))) {
  const ast = parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  traverse(ast, {
    CallExpression(p) {
      const c = p.node.callee
      if (c.type !== 'Identifier' || (c.name !== 't' && c.name !== 'i18n')) return
      const a = p.node.arguments[0]
      const v = a?.type === 'StringLiteral' ? a.value : a?.type === 'TemplateLiteral' && !a.expressions.length ? a.quasis[0].value.cooked : null
      if (v === null) return
      const k = v.trim()
      if (k && /[一-鿿]/.test(k)) keys.add(k)
    }
  })
}
const all = [...keys].sort()
console.log(`源码里 ${all.length} 条文案`)

// 单看字面翻不对的文案：告诉翻译它用在哪。改了这里的说明后 --renote 重翻这些条
const NOTES = {
  '本机 Claude Code': 'AI 服务列表里的一项：用这台电脑上用户自己装好的 Claude Code 命令行。Claude Code 是产品名，原样保留',
  '用它的订阅，不用 Key': '「本机 Claude Code」这一项下面的一句说明：用的是 Claude Code 自己的订阅，不需要填 API Key。位置很窄，尽量短',
  '没找到': '输入框里的占位字：这台电脑上没找到 claude 命令',
  '正在找…': '输入框里的占位字：正在这台电脑上找 claude 命令',
  '找到了，版本 {0}': '在这台电脑上找到了 Claude Code，{0} 是版本号',
  '还没登录：在终端里运行 claude auth login，再点「重新检测」': 'claude auth login 是要在终端里原样输入的命令，不要翻译、不要改动；「重新检测」是旁边按钮的名字',
  '还没登录：在终端里运行 claude auth login，再点「验证」': 'claude auth login 是要在终端里原样输入的命令，不要翻译、不要改动；「验证」是旁边按钮的名字',
  '怎么安装': '链接文字：点了打开 Claude Code 的安装说明',
  '重新检测': '按钮的提示：重新在这台电脑上找一遍 claude 命令',
  '一次买 1 个月': '按钮：一次性付款买 1 个月会员，到期不自动续费（和自动续费的订阅相对）',
  '一次买 1 年': '按钮：一次性付款买 1 年会员，到期不自动续费（和自动续费的订阅相对）',
  '一次买': '一次性付款买一段时间的会员，不自动续费',
  '{0} 等': '作者列表超过 3 人时的「等」，学术写法 et al.',
  '第 {0}': '阅读顺序里排第几（很窄的位置，尽量短，如 #{0}）',
  '新': '文件列表里的小标记：这一轮新建的文件',
  '改': '文件列表里的小标记：这一轮改过的文件（形容词，不是动词）',
  '多': '让 AI 在论文里标重点的数量三档里的「多标一些」',
  '少': '让 AI 在论文里标重点的数量三档里的「少标一些」',
  '适中': '让 AI 在论文里标重点的数量三档里的中间一档',
  '标多少': '标签：AI 标重点标多少（后面是 少 / 适中 / 多 三档）',
  '读了': '标签，后面跟阅读时长，如「读了 12 分钟」的「读了」，写成名词「已读时长」',
  '添加于': '标签，后面跟加入文献库的日期',
  '放进': '标签，后面跟一个文件夹选择框：导入后放进哪个文件夹',
  '问你': '研究 Agent 的一个步骤名：Agent 向用户提问',
  '精细': '重排质量两档之一：精细重排（用 MinerU，慢、质量高）',
  '简单': '重排质量两档之一：简单重排（快、质量一般）',
  '纸张': '导出 PDF 时的纸张大小',
  '阅读': '菜单栏里的菜单名：阅读（缩放、翻页、对照这些命令）',
  '省心': '收费页会员一栏的小标签：不用自己配 Key，省事',
  '不买了': '按钮：正在等付款时点它取消这次购买',
  '卡片': '文献库两种视图之一：卡片视图（另一种是列表）',
  '出处': 'AI 回答里引用的原文位置',
  '还原': '按钮：把设置恢复成默认值',
  '最近打开': '文献库列表的列标题（也是排序项），列很窄，最多 14 个字符，如 Last opened',
  '添加时间': '文献库列表的列标题（也是排序项），列很窄，最多 14 个字符，如 Date added',
  '目录': '阅读页左栏四个标签之一，位置很窄，用最短的词，如 Contents',
  '图表': '阅读页左栏四个标签之一：论文里的图和表，用最短的词，如 Figures',
  '重点': '阅读页左栏四个标签之一：AI 标出的重点，用最短的词，如 Key points',
  '打开阅读': '文献库右侧速览栏底部的主按钮，位置窄，最多 12 个字符，如 Open',
  '继续阅读': '文献库右侧速览栏底部的主按钮（读到一半的论文），位置窄，最多 12 个字符，如 Continue',
  '看原文': '按钮：切到原始 PDF 或原文，位置窄，最多 12 个字符，如 Original'
}

// 译文里只写了 {0|单|复} 没写数字 {0} 的，把数字补在前面
function fixPlural(key, text) {
  let out = text
  for (const [, i] of key.matchAll(/\{(\d+)\}/g)) {
    if (out.includes(`{${i}}`)) continue
    out = out.replace(new RegExp(`\\{${i}\\|[^}]*\\}`), (m) => `{${i}} ${m}`)
  }
  return out
}

async function translate(lang, batch) {
  const body = {
    model: 'deepseek-flash',
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: [
          `你在给一个 Mac 上读英文论文的软件 ParaRead 翻译界面文案，从简体中文翻成${LANGS[lang]}。`,
          '要求：简短、自然，照 macOS 应用在这种语言里的惯用说法（按钮用动词，菜单项句末的 … 保留）。',
          '占位 {0} {1} 原样保留，位置按目标语言的语序放。要分单复数时在数字后面写 {0|单数词|复数词}，程序按第 0 个参数选一个词；它只输出词、不输出数字，所以数字的 {0} 仍然要写，例如 "{0} {0|paper|papers}"。',
          '「」换成目标语言的引号；⌘ ⌥ ⇧ ↩ 这些键位符号、产品名（ParaRead、MinerU、Zotero、Scholaread、DeepSeek、PDF、EPUB、Key、API Key、LaTeX、Markdown、Finder）不翻。',
          '术语：重排 = reflow（把 PDF 转成能逐段对照的网页排版）；对照 = side-by-side / bilingual（原文和译文逐段对照）；速览 = glance（一页看完论文要点的视图，标签上用一个短词）；文献库 = library；自带 Key = bring your own key；授权码 = license code；会员 = membership。',
          '文案可能是句子的一段（前后接变量），照字面翻，不要补全句子，不要加句号。',
          '只输出 JSON：{"1": "译文", "2": "译文", …}，编号和输入一一对应。',
          ...batch.filter((k) => NOTES[k]).map((k) => `「${k}」用在：${NOTES[k]}`)
        ].join('\n')
      },
      { role: 'user', content: JSON.stringify(Object.fromEntries(batch.map((k, i) => [i + 1, k]))) }
    ]
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) })
    if (!r.ok) {
      if (attempt === 2) throw new Error(`DeepSeek ${r.status}：${(await r.text()).slice(0, 200)}`)
      continue
    }
    const out = JSON.parse((await r.json()).choices[0].message.content)
    const got = batch.map((_, i) => out[String(i + 1)])
    if (got.every((x) => typeof x === 'string' && x)) return got
  }
  throw new Error(`${lang}：一批文案三次都没翻全`)
}

// 占位对不上的译文不要（{0} 少了、多了）
const holes = (s) => [...new Set([...s.matchAll(/\{(\d+)[|}]/g)].map((m) => m[1]))].sort().join(',')

for (const lang of Object.keys(LANGS)) {
  if (only && only !== lang) continue
  const file = path.join(ROOT, 'src/i18n', `${lang}.json`)
  const dict = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [i, a] of process.argv.entries()) if (a === '--redo') delete dict[process.argv[i + 1]]
  if (process.argv.includes('--renote')) for (const k of Object.keys(NOTES)) delete dict[k]
  const missing = all.filter((k) => dict[k] === undefined)
  const extra = Object.keys(dict).filter((k) => !keys.has(k))
  console.log(`${lang}：缺 ${missing.length}，多 ${extra.length}`)
  if (check) continue
  if (missing.length && !process.env.DEEPSEEK_API_KEY) throw new Error('要 DEEPSEEK_API_KEY')
  const batches = []
  for (let i = 0; i < missing.length; i += 40) batches.push(missing.slice(i, i + 40))
  let bad = 0
  // 一次 6 批并发
  for (let i = 0; i < batches.length; i += 6) {
    const res = await Promise.all(batches.slice(i, i + 6).map((b) => translate(lang, b).then((got) => [b, got])))
    for (const [b, got] of res)
      b.forEach((k, j) => {
        if (holes(k) === holes(got[j])) dict[k] = fixPlural(k, got[j])
        else bad++
      })
  }
  for (const k of extra) delete dict[k]
  for (const k of Object.keys(dict)) dict[k] = fixPlural(k, dict[k])
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]])), null, 2) + '\n')
  if (bad) console.log(`  ${bad} 条占位对不上，没收，再跑一次`)
}
