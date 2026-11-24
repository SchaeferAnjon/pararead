// 子进程：照 argv 写一个文件，写之前在 stdout 说一声。父进程在写到一半时 kill -9 它（模拟断电、崩溃）。
// node writer.mjs <atomic|plain> <目标> <兆字节数> <填充字符>
import { writeFile } from 'node:fs/promises'

const [mode, target, mb, ch] = process.argv.slice(2)
const { atomicWrite } = await import(new URL('../../src/index.ts', import.meta.url).href)
const big = Buffer.alloc(Number(mb) * 1024 * 1024, ch)
process.stdout.write('start\n')
// 一直写：被杀之前不会停（父进程在临时文件出现、长到一半时动手）
for (;;) {
  if (mode === 'atomic') await atomicWrite(target, big)
  else await writeFile(target, big)
}
