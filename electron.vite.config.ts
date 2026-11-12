import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// pdf.js 的字体映射、标准字体、wasm 解码器放进界面的 public 目录，运行时按相对路径加载
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const dest = resolve('src/renderer/public/pdfjs', dir)
  if (!existsSync(dest)) cpSync(resolve('node_modules/pdfjs-dist', dir), dest, { recursive: true })
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // 翻译表打成 JSON.parse("…")：写成对象字面量时，以 import 结尾的译文（"Release to import"）后面紧跟引号，
    // 会被 electron-vite 找「最后一条 import 语句」的正则当成 import，把 CommonJS 垫片插进字符串中间
    json: { stringify: true, namedExports: false },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    base: './',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    // word.html：Word 引用插件的任务窗格，由主进程的本机 HTTPS 服务发给 Word（src/main/wordAddin.ts）
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html'), word: resolve('src/renderer/word.html') } } }
  }
})
