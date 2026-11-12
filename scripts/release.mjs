#!/usr/bin/env node
// 发一个新版本（照会议字幕的 scripts/release.mjs，只有 Mac）。安装包放在公开的发布仓库 SchaeferAnjon/pararead，
// 装着的正式版从那里查更新（src/main/updater.ts）。
//   1. 改 package.json 的 version，提交。
//   2. node scripts/release.mjs：用钥匙串里的 Developer ID 打 dmg + zip（自动更新要求新旧版本同一张证书），
//      核对签名和更新要的文件，放在 release/<版本>/。
//   3. 发布说明写在 release/<版本>/notes.md，看过没问题：node scripts/release.mjs --publish，
//      上传第 2 步核对过的那一份，在发布仓库建 Release（不是草稿）。
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEAM = '3H5S5NXPXS' // Developer ID Application: zonghan jia
const REPO = 'SchaeferAnjon/pararead'
const publish = process.argv.includes('--publish')
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const tag = `v${version}`
const out = path.join(ROOT, 'release', version)
const notes = path.join(out, 'notes.md')
const checked = path.join(out, 'checked.json')

const run = (cmd, argv, opts = {}) => (execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', ...opts }) ?? '').trim()
const fail = (msg) => {
  console.error(`没发：${msg}`)
  process.exit(1)
}

// 打的包要和提交对得上：工作区干净，发布仓库里还没有这个版本
if (run('git', ['status', '--porcelain'])) fail('工作区有没提交的改动')
const head = run('git', ['rev-parse', 'HEAD'])
if (spawnSync('gh', ['release', 'view', tag, '--repo', REPO], { cwd: ROOT }).status === 0) fail(`${REPO} 里已经有 ${tag}`)

if (publish) {
  // 只上传第 2 步核对过的那一份，不重新打包
  const prev = fs.existsSync(checked) ? JSON.parse(fs.readFileSync(checked, 'utf8')) : null
  if (prev?.head !== head) fail(`${out} 不是这个提交核对过的：先跑 node scripts/release.mjs`)
  if (!fs.existsSync(notes)) fail(`还没写发布说明：${notes}`)
  const files = prev.files.map((f) => path.join(out, f))
  for (const f of files) if (!fs.existsSync(f)) fail(`核对过的文件不见了：${f}`)
  run('gh', ['release', 'create', tag, '--repo', REPO, '--title', `ParaRead ${version}`, '--notes-file', notes, ...files], { stdio: 'inherit' })
  console.log(`已发布 ${tag}：装着旧版的会在启动 30 秒内、或者 6 小时内查到并下载`)
  process.exit(0)
}

const keptNotes = fs.existsSync(notes) ? fs.readFileSync(notes) : null
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
if (keptNotes) fs.writeFileSync(notes, keptNotes)

// 签不上 Developer ID 时 electron-builder 默认只打一条警告、照样出包：强制签名，签不上就失败
console.log('打 Mac 包（Developer ID 签名，Apple 芯片，dmg + zip）…')
if (spawnSync('npx', ['electron-vite', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) fail('界面没编过')
const mac = spawnSync('npx', ['electron-builder', '--mac', '--arm64', '--publish', 'never', '-c.forceCodeSigning=true', `-c.directories.output=${out}`], { cwd: ROOT, stdio: 'inherit' })
if (mac.status !== 0) fail('Mac 包没打成')
const appDir = path.join(out, 'mac-arm64')
const app = path.join(appDir, fs.readdirSync(appDir).find((f) => f.endsWith('.app')) ?? '')
if (spawnSync('codesign', ['--verify', '--deep', '--strict', app]).status !== 0) fail('签名校验没过')
const info = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' }).stderr
if (!/Authority=Developer ID Application:/.test(info) || !info.includes(`TeamIdentifier=${TEAM}`)) fail(`不是团队 ${TEAM} 的 Developer ID 签的`)

// 更新要的文件：latest-mac.yml 指着这一版的 zip；另放一份不带版本号的 dmg，官网链到 releases/latest/download/ParaRead-mac-arm64.dmg
const files = []
const need = (re, label) => {
  const hit = fs.readdirSync(out).filter((f) => re.test(f))
  if (!hit.length) fail(`少了${label}`)
  files.push(...hit)
  return hit
}
const [dmg] = need(new RegExp(`^ParaRead-${version}-mac-arm64\\.dmg$`), ' dmg')
need(new RegExp(`^ParaRead-${version}-mac-arm64\\.(dmg\\.blockmap|zip|zip\\.blockmap)$`), ' zip 和 blockmap')
need(/^latest-mac\.yml$/, ' latest-mac.yml')
const yml = fs.readFileSync(path.join(out, 'latest-mac.yml'), 'utf8')
if (!yml.includes(`version: ${version}`) || !yml.includes(`ParaRead-${version}-mac-arm64.zip`)) fail('latest-mac.yml 和这一版对不上')
fs.copyFileSync(path.join(out, dmg), path.join(out, 'ParaRead-mac-arm64.dmg'))
files.push('ParaRead-mac-arm64.dmg')
fs.writeFileSync(checked, JSON.stringify({ head, files }, null, 1))
console.log(`\n${tag} 要上传的文件（${out}）：`)
for (const f of files) console.log(`  ${f}  ${(fs.statSync(path.join(out, f)).size / 1e6).toFixed(1)} MB`)
console.log(`\n核对过了，还没上传。发布说明写在 ${notes}，确认后：node scripts/release.mjs --publish`)
