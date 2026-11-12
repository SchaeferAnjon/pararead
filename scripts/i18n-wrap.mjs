#!/usr/bin/env node
// 把源码里写死的中文界面文案包上 t()（一次性的改造脚本，也能在加了新文案后再跑，已经包过的不动）：
//   '中文'                → t('中文')
//   title="中文"          → title={t('中文')}
//   <b>中文</b>           → <b>{t('中文')}</b>
//   `找到 ${n} 篇`        → t('找到 {0} 篇', n)
// 用法：node scripts/i18n-wrap.mjs [--main] 文件…      --dry 只打印不写
// 界面文件（renderer）全包；主进程（--main）只包肯定给人看的：new Error(…) 的消息、菜单和对话框的 label / title / message / detail / buttonLabel。
// 不包：比较用的字符串（=== 两边、case）、对象的键、类型、已经在 t() 里的、SKIP 里的（语言自己的名字，要原样写进给 AI 的提示）。
// 文件里叫 t 的局部变量会改名成 t_，免得盖住翻译函数。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

const HAN = /[一-鿿]/
const SKIP = new Set(['简体中文', '繁體中文', '日本語'])
const MAIN_KEYS = new Set(['label', 'title', 'message', 'detail', 'buttonLabel'])
const args = process.argv.slice(2)
const dry = args.includes('--dry')
const mainMode = args.includes('--main')
const files = args.filter((a) => !a.startsWith('--'))

// JSX 文本的空白规则（同 Babel）：每行去掉行首行尾空白（第一行留行首、最后一行留行尾），空行丢掉，行之间用一个空格连
function cleanJsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/)
  let last = 0
  lines.forEach((l, i) => /[^ \t]/.test(l) && (last = i))
  let out = ''
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ')
    if (i !== 0) l = l.replace(/^ +/, '')
    if (i !== lines.length - 1) l = l.replace(/ +$/, '')
    if (l) out += l + (i !== last ? ' ' : '')
  })
  return out
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

const apply = (src, reps) => {
  let out = src
  for (const r of [...reps].sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + r.text + out.slice(r.end)
  return out
}

// 第一遍：文件里叫 t 的局部变量（参数、const、解构）都改名 t_，免得盖住翻译函数
function renameLocals(src, file, notes) {
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const reps = new Map()
  traverse(ast, {
    'Identifier|JSXIdentifier'(p) {
      if (p.node.name !== 't') return
      const par = p.parentPath
      // 不是变量的 t：a.t、{ t: 1 } 的键、<x.t>
      if ((par.isMemberExpression() || par.isJSXMemberExpression()) && par.node.property === p.node && !par.node.computed) return
      if (par.isObjectProperty() && par.node.key === p.node && !par.node.shorthand && !par.node.computed) return
      const b = p.scope.getBinding('t')
      if (!b || b.kind === 'module') return
      // { t } 这种简写（解构或对象字面量）：键还得叫 t
      if (par.isObjectProperty() && par.node.shorthand) reps.set(par.node.start, { start: par.node.start, end: par.node.end, text: 't: t_' })
      else reps.set(p.node.start, { start: p.node.start, end: p.node.start + 1, text: 't_' })
      if (b.identifier === p.node) notes.push(`${file}:${p.node.loc.start.line} 局部变量 t 改名 t_`)
    }
  })
  return reps.size ? apply(src, [...reps.values()]) : src
}

for (const file of files) {
  const notes = []
  const src = renameLocals(fs.readFileSync(file, 'utf8'), file, notes)
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  let reps = [] // { start, end, text }

  // 把 [start, end) 里已经记下的替换先应用掉，返回这段的新文字，并把它们从清单里拿走（外层的替换会盖住它们）
  const render = (start, end) => {
    const inner = reps.filter((r) => r.start >= start && r.end <= end).sort((a, b) => a.start - b.start)
    reps = reps.filter((r) => !(r.start >= start && r.end <= end))
    let out = ''
    let at = start
    for (const r of inner) {
      out += src.slice(at, r.start) + r.text
      at = r.end
    }
    return out + src.slice(at, end)
  }

  const inT = (p) => p.findParent((x) => x.isCallExpression() && x.node.callee.type === 'Identifier' && (x.node.callee.name === 't' || x.node.callee.name === 'log')) || p.findParent((x) => x.isCallExpression() && x.get('callee').isMemberExpression() && x.node.callee.object.name === 'console')
  const inType = (p) => p.findParent((x) => x.node.type.startsWith('TS') && x.node.type !== 'TSAsExpression' && x.node.type !== 'TSNonNullExpression' && x.node.type !== 'TSSatisfiesExpression')
  // 主进程：只包 new Error(…) 的消息和菜单、对话框那几个键的值
  const mainOk = (p) => {
    if (!mainMode) return true
    const par = p.parentPath
    if (par.isObjectProperty() && par.node.value === p.node && MAIN_KEYS.has(par.node.key.name ?? par.node.key.value)) return true
    const call = p.findParent((x) => x.isNewExpression() || x.isCallExpression())
    if (call?.isNewExpression() && /Error$/.test(call.node.callee.name ?? '')) return true
    if (call?.isCallExpression() && call.node.callee.name === 'c' && call.node.arguments[0] === p.node) return true // 菜单项 c('导入…', 快捷键, 命令)
    return false
  }
  const logic = (p) => {
    const par = p.parentPath
    if (par.isBinaryExpression() && ['===', '!==', '==', '!='].includes(par.node.operator)) return true
    if (par.isSwitchCase() && par.node.test === p.node) return true
    if (par.isObjectProperty() && par.node.key === p.node && !par.node.computed) return true
    if (par.isTSLiteralType?.()) return true
    return false
  }
  const shadow = (p) => {
    const b = p.scope.getBinding('t')
    if (b && b.kind !== 'module') throw new Error(`${file}:${p.node.loc.start.line} 这里的 t 还是局部变量`)
  }

  traverse(ast, {
    ImportDeclaration(p) {
      p.skip()
    },
    StringLiteral: {
      exit(p) {
        const v = p.node.value
        if (!HAN.test(v) || SKIP.has(v) || inT(p) || inType(p)) return
        if (logic(p)) return void notes.push(`${file}:${p.node.loc.start.line} 没包（比较或键）：${v.slice(0, 30)}`)
        if (!mainOk(p)) return
        shadow(p)
        const raw = src.slice(p.node.start, p.node.end)
        if (p.parentPath.isJSXAttribute()) reps.push({ start: p.node.start, end: p.node.end, text: `{t(${quote(v)})}` })
        else reps.push({ start: p.node.start, end: p.node.end, text: `t(${raw})` })
      }
    },
    TemplateLiteral: {
      exit(p) {
        const n = p.node
        if (!n.quasis.some((q) => HAN.test(q.value.cooked ?? '')) || inT(p) || inType(p) || p.parentPath.isTaggedTemplateExpression()) return
        if (logic(p)) return void notes.push(`${file}:${n.loc.start.line} 没包（比较或键）`)
        if (!mainOk(p)) return
        shadow(p)
        let key = ''
        const argv = []
        n.quasis.forEach((q, i) => {
          key += q.value.cooked
          if (i < n.expressions.length) {
            key += `{${i}}`
            argv.push(render(n.expressions[i].start, n.expressions[i].end))
          }
        })
        reps.push({ start: n.start, end: n.end, text: `t(${[quote(key), ...argv].join(', ')})` })
      }
    },
    JSXText(p) {
      const raw = p.node.value
      if (mainMode || !HAN.test(raw)) return
      shadow(p)
      const text = cleanJsxText(raw)
      const lead = /^\s*\n\s*/.exec(raw)?.[0] ?? ''
      const trail = /\n\s*$/.exec(raw)?.[0] ?? ''
      reps.push({ start: p.node.start, end: p.node.end, text: `${lead}{t(${quote(text)})}${trail}` })
    }
  })

  if (!reps.length) continue
  let out = apply(src, reps)
  if (!/import \{[^}]*\bt\b[^}]*\} from ['"][^'"]*i18n['"]/.test(out)) {
    const spec = mainMode ? path.relative(path.dirname(file), 'src/shared/i18n').replace(/^(?!\.)/, './') : '@shared/i18n'
    // 放在最后一条 import 后面（import 前面没有被改动的内容时位置不变），否则放最前面
    let idx = 0
    for (const node of ast.program.body) if (node.type === 'ImportDeclaration') idx = Math.max(idx, node.end)
    if (reps.some((r) => r.start < idx)) idx = 0
    out = out.slice(0, idx) + (idx ? '\n' : '') + `import { t } from '${spec}'` + (idx ? '' : '\n') + out.slice(idx)
  }
  console.log(`${file}：${reps.length} 处`)
  for (const n of notes) console.log('  ' + n)
  if (!dry) fs.writeFileSync(file, out)
}
