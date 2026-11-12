#!/usr/bin/env node
// 应用图标：和软件里的标志（lib/member.tsx 的 AppLogo）同一个图形，一页纸四行字，墨黑。
// node scripts/icon.mjs → build/icon.svg、build/icon.png（1024）、build/icon.icns。要 rsvg-convert（brew install librsvg）和系统自带的 iconutil。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INK = '#1d1d1f'
const GRAY = '#9c9ca2'

// macOS 的连续圆角（超椭圆），底板占 1024 画布的 100..924
function squircle(x, y, s, n = 5, steps = 240) {
  const a = s / 2
  let d = ''
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t)
    const sn = Math.sin(t)
    const px = x + a + a * Math.sign(c) * Math.abs(c) ** (2 / n)
    const py = y + a + a * Math.sign(sn) * Math.abs(sn) ** (2 / n)
    d += (i ? 'L' : 'M') + px.toFixed(2) + ' ' + py.toFixed(2)
  }
  return d + 'Z'
}

const plate = squircle(100, 100, 824)
// AppLogo 的 30×30 坐标放大到底板的 68%
const k = (824 * 0.68) / 30
const o = 100 + (824 - 30 * k) / 2
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
<linearGradient id="bg" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e6eb"/></linearGradient>
<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity=".25"/></filter>
</defs>
<path d="${plate}" fill="url(#bg)" filter="url(#sh)"/>
<path d="${plate}" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="2"/>
<g transform="translate(${o.toFixed(2)} ${o.toFixed(2)}) scale(${k.toFixed(4)})">
<rect x="6" y="3" width="18" height="24" rx="2.5" fill="#fff" stroke="${INK}" stroke-width="1.6"/>
<rect x="9.5" y="8" width="11" height="1.8" rx=".9" fill="${INK}"/>
<rect x="9.5" y="11.6" width="9" height="1.8" rx=".9" fill="${INK}"/>
<rect x="9.5" y="16.4" width="11" height="1.8" rx=".9" fill="${GRAY}"/>
<rect x="9.5" y="20" width="7" height="1.8" rx=".9" fill="${GRAY}"/>
</g>
</svg>
`
const build = path.join(ROOT, 'build')
fs.writeFileSync(path.join(build, 'icon.svg'), svg)
const png = (size, file) => execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), path.join(build, 'icon.svg'), '-o', file])
png(1024, path.join(build, 'icon.png'))
const set = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-icon-')) + '/icon.iconset'
fs.mkdirSync(set)
for (const s of [16, 32, 128, 256, 512]) {
  png(s, path.join(set, `icon_${s}x${s}.png`))
  png(s * 2, path.join(set, `icon_${s}x${s}@2x.png`))
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(build, 'icon.icns')])
// Word 插件在功能区和加载项列表里用的图标（清单里按网址取，放界面的 public 目录）
for (const s of [16, 32, 64, 80]) png(s, path.join(ROOT, 'src/renderer/public', `word-icon-${s}.png`))
fs.rmSync(path.dirname(set), { recursive: true })
console.log('build/icon.svg、icon.png、icon.icns 已生成')
