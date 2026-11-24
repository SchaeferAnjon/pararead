// 子进程：另一个程序（Git、同步盘、Obsidian）一直在读这个文件。读到的每一份都该是一整份：全是同一个字、长度对。
// node reader.mjs <文件> <应有的字节数> <毫秒>；结束时打印 JSON { reads, torn, missing }
import { readFileSync } from 'node:fs'

const [file, size, ms] = process.argv.slice(2)
const until = Date.now() + Number(ms)
let reads = 0
let torn = 0
let missing = 0
while (Date.now() < until) {
  let b
  try {
    b = readFileSync(file)
  } catch (e) {
    if (e.code === 'ENOENT') {
      missing++
      continue
    }
    throw e
  }
  reads++
  const first = b[0]
  if (b.length !== Number(size) || b.indexOf(first === 0x61 ? 0x62 : 0x61) !== -1) torn++
}
process.stdout.write(JSON.stringify({ reads, torn, missing }) + '\n')
