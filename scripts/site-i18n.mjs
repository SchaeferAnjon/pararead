#!/usr/bin/env node
// 官网的翻译表：收集 website/index.html 里的文案（脚本里的 t('…')，导航和页脚写死的字，标题），
// 补齐 website/i18n/<语言>.json 里缺的（DeepSeek 翻），删掉不再用的。键是简体中文原文。
//   node scripts/site-i18n.mjs --check                    只列每种语言缺多少、多出多少
//   DEEPSEEK_API_KEY=… node scripts/site-i18n.mjs          补齐缺的（--lang de 只做一种）
// 文案里常带 HTML 标签、{0} 占位和 {{名}}（产品名）：译文的标签序列、占位、{{名}} 的个数要和原文一样，对不上的不收。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SITE = path.join(ROOT, 'website')
const LANGS = { 'zh-Hant': '繁體中文（台灣用語）', en: 'English', ja: '日本語', ko: '한국어', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano' }
const check = process.argv.includes('--check')
const only = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : null
const zh = (s) => /[一-鿿]/.test(s)

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
const keys = new Set()
// 1. 最后一个 <script>（页面内容）里的 t(…)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
traverse(parse(scripts.at(-1), { sourceType: 'script' }), {
  CallExpression(p) {
    if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== 't') return
    const a = p.node.arguments[0]
    const v = a?.type === 'StringLiteral' ? a.value : a?.type === 'TemplateLiteral' && !a.expressions.length ? a.quasis[0].value.cooked : null
    if (v === null) throw new Error(`t() 的第一个参数要是不带 \${} 的字符串：第 ${p.node.loc.start.line} 行`)
    if (zh(v)) keys.add(v)
  }
})
// 2. 写死在页面里的字（导航、页脚）：文字节点整段、title / aria-label；3. 网页标题
const body = html.slice(html.indexOf('<header'), html.indexOf('<div class="dlsheet"'))
for (const m of body.matchAll(/>([^<>]+)</g)) if (zh(m[1].trim())) keys.add(m[1].trim())
for (const m of body.matchAll(/(?:title|aria-label)="([^"]+)"/g)) if (zh(m[1])) keys.add(m[1])
keys.add(html.match(/<title>([^<]+)<\/title>/)[1])
const all = [...keys]
console.log(`官网 ${all.length} 条文案，共 ${all.reduce((n, k) => n + k.length, 0)} 字`)

const shape = (s) => JSON.stringify([(s.match(/<[^>]+>/g) ?? []).map((x) => x.replace(/\s+/g, ' ')), (s.match(/\{\d+\}/g) ?? []).sort(), (s.match(/\{\{名\}\}/g) ?? []).length])

const RULES = (lang) => [
  `你在翻译 Mac 读论文软件 ParaRead 的官网，从简体中文翻成${LANGS[lang]}。写给这种语言的读者看的营销和说明文字：自然、简洁，像母语者写的，不要逐字硬翻。`,
  '不翻的名字：ParaRead、MinerU、Zotero、DeepSeek、Stripe、iCloud、PDF、EPUB、API Key、Key、arXiv、GB/T 7714、APA、MLA、IEEE、BibTeX、Markdown、Apple Pay；支付宝 = Alipay，微信 = WeChat Pay；智谱 = Zhipu，通义 = Qwen，豆包 = Doubao。',
  '术语：重排 = reflow（把 PDF 重新排成能逐段对照的版面）；对照 = side by side；速览 = glance（一页要点）；文献库 = library；自带 Key = bring your own key；授权码 = license code；会员 = membership。',
  '{0} {1} 这样的占位和 {{名}}（产品名）原样保留；⌘ 这类键位符号不翻；「」换成这种语言的引号；价格数字、货币符号、网址、邮箱不改。'
]

// 不带 HTML 的文案（标签、表格里的格子、问答）：一批一起翻，用 JSON 对号，免得模型把很短的词当成在跟它说话
async function translateBatch(lang, batch) {
  const body = {
    model: 'deepseek-flash',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: [...RULES(lang), '输入是 JSON：编号 → 一条文案（导航和页脚的标签、按钮、价格对照表的格子、常见问题的问和答）。很短的词照它在官网上的意思翻（「不用」是「不需要申请」，「一样」是「两种方式没有区别」，「月」「年」是价格的周期）。只输出 JSON：{"1": "译文", …}，编号一一对应。'].join('\n') },
      { role: 'user', content: JSON.stringify(Object.fromEntries(batch.map((k, i) => [i + 1, k]))) }
    ]
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })
    if (!r.ok) {
      if (attempt === 2) throw new Error(`DeepSeek ${r.status}：${(await r.text()).slice(0, 200)}`)
      continue
    }
    const out = JSON.parse((await r.json()).choices[0].message.content)
    const got = batch.map((k, i) => (typeof out[String(i + 1)] === 'string' && out[String(i + 1)] && shape(out[String(i + 1)]) === shape(k) ? out[String(i + 1)] : null))
    if (got.every(Boolean) || attempt === 2) return got
  }
  return batch.map(() => null)
}

async function translate(lang, text) {
  const body = {
    model: 'deepseek-flash',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: [
          ...RULES(lang),
          '输入是一段带 HTML 的文案。所有 HTML 标签原样保留（一个不多、一个不少、顺序和属性都不变），只翻标签之间的文字。只输出译文本身，不要解释，不要加代码块。'
        ].join('\n')
      },
      { role: 'user', content: text }
    ]
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })
    if (!r.ok) {
      if (attempt === 2) throw new Error(`DeepSeek ${r.status}：${(await r.text()).slice(0, 200)}`)
      continue
    }
    const out = String((await r.json()).choices[0].message.content ?? '').trim().replace(/^```(?:html)?\n?|\n?```$/g, '')
    if (out && shape(out) === shape(text)) return out
  }
  return null
}

for (const lang of Object.keys(LANGS)) {
  if (only && only !== lang) continue
  const file = path.join(SITE, 'i18n', `${lang}.json`)
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const missing = all.filter((k) => dict[k] === undefined)
  const extra = Object.keys(dict).filter((k) => !keys.has(k))
  console.log(`${lang}：缺 ${missing.length}，多 ${extra.length}`)
  if (check) continue
  if (missing.length && !process.env.DEEPSEEK_API_KEY) throw new Error('要 DEEPSEEK_API_KEY')
  let bad = 0
  // 带 HTML 的一条一次请求（长的是整节的页面），8 条并发；不带 HTML 的 20 条一批
  const rich = missing.filter((k) => k.includes('<'))
  const plain = missing.filter((k) => !k.includes('<'))
  for (let i = 0; i < rich.length; i += 8) {
    const got = await Promise.all(rich.slice(i, i + 8).map((k) => translate(lang, k)))
    got.forEach((v, j) => (v ? (dict[rich[i + j]] = v) : bad++))
  }
  const batches = []
  for (let i = 0; i < plain.length; i += 20) batches.push(plain.slice(i, i + 20))
  for (const [b, got] of await Promise.all(batches.map((b) => translateBatch(lang, b).then((g) => [b, g])))) got.forEach((v, j) => (v ? (dict[b[j]] = v) : bad++))
  for (const k of extra) delete dict[k]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(all.filter((k) => dict[k] !== undefined).map((k) => [k, dict[k]])), null, 1) + '\n')
  if (bad) console.log(`  ${bad} 条标签或占位对不上，没收（页面上这几条显示中文），再跑一次`)
}
