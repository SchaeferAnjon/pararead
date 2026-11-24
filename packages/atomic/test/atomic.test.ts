import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicAppend, atomicCopy, atomicWrite, atomicWriteSync, ChangedOutsideError, isTempName, readStamped, RECYCLE_DIR, sweepTemps, TEMP_RE, tempPathFor, writeQueued } from '../src'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-atomic-'))
})
afterEach(() => {
  chmodSync(dir, 0o755)
  rmSync(dir, { recursive: true, force: true })
})

const temps = (d = dir) => readdirSync(d).filter(isTempName)
const FIX = join(import.meta.dirname, 'fixtures')

describe('原子写', () => {
  it('写进去、不留临时文件；新文件、盖旧文件都行', async () => {
    const p = join(dir, '笔记.md')
    await atomicWrite(p, '第一版\n')
    expect(readFileSync(p, 'utf8')).toBe('第一版\n')
    await atomicWrite(p, Buffer.from('第二版\n'))
    expect(readFileSync(p, 'utf8')).toBe('第二版\n')
    atomicWriteSync(p, '第三版\n')
    expect(readFileSync(p, 'utf8')).toBe('第三版\n')
    expect(temps()).toEqual([])
  })

  it('CRLF、BOM、没有结尾换行：字节原样', async () => {
    const p = join(dir, 'win.md')
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 标题\r\n\r\n一行\r\n没有结尾换行')])
    await atomicWrite(p, bytes)
    expect(Buffer.compare(readFileSync(p), bytes)).toBe(0)
  })

  it('保留原文件的权限（0600、0755），新文件照 mode', async () => {
    const a = join(dir, 'a.md')
    writeFileSync(a, 'x')
    chmodSync(a, 0o600)
    await atomicWrite(a, 'y')
    expect(statSync(a).mode & 0o777).toBe(0o600)
    const b = join(dir, 'run.sh')
    writeFileSync(b, 'x')
    chmodSync(b, 0o755)
    atomicWriteSync(b, 'y')
    expect(statSync(b).mode & 0o777).toBe(0o755)
    const c = join(dir, 'secret.json')
    await atomicWrite(c, '{}', { mode: 0o600 })
    expect(statSync(c).mode & 0o777).toBe(0o600)
  })

  it.runIf(process.platform === 'darwin')('macOS：盖过去以后创建时间还是原来的', async () => {
    const p = join(dir, 'old.md')
    writeFileSync(p, 'x')
    const { utimesSync } = await import('node:fs')
    utimesSync(p, new Date(2020, 0, 1), new Date(2020, 0, 1))
    const born = statSync(p).birthtimeMs
    await atomicWrite(p, 'y')
    expect(statSync(p).birthtimeMs).toBe(born)
    expect(statSync(p).mtimeMs).toBeGreaterThan(born)
  })

  it('软链接：写到它指着的文件，链接还是链接', async () => {
    mkdirSync(join(dir, 'real'))
    const real = join(dir, 'real', 'n.md')
    writeFileSync(real, 'old')
    const link = join(dir, 'link.md')
    symlinkSync(real, link)
    await atomicWrite(link, 'new')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(real)
    expect(readFileSync(real, 'utf8')).toBe('new')
  })

  it('只建新文件（exclusive）：已经有了报 EEXIST，原文件不动；同时建同一个名字只有一个成功', async () => {
    const p = join(dir, 'n.md')
    writeFileSync(p, 'mine')
    await expect(atomicWrite(p, 'theirs', { exclusive: true })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(p, 'utf8')).toBe('mine')
    const q = join(dir, 'race.md')
    const rs = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => atomicWrite(q, `第${i}个`, { exclusive: true })))
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(rs.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'EEXIST')).toBe(true)
    expect(temps()).toEqual([])
  })

  it('外面改过（expect 对不上）：不写，抛 ChangedOutsideError；没改过照常写', async () => {
    const p = join(dir, 'n.md')
    writeFileSync(p, 'v1')
    const r = (await readStamped(p))!
    writeFileSync(p, 'v1 外面改的')
    await expect(atomicWrite(p, 'v2', { expect: r.stamp })).rejects.toBeInstanceOf(ChangedOutsideError)
    expect(readFileSync(p, 'utf8')).toBe('v1 外面改的')
    const r2 = (await readStamped(p))!
    await atomicWrite(p, 'v2', { expect: r2.stamp })
    expect(readFileSync(p, 'utf8')).toBe('v2')
    // expect: null = 必须还不存在
    await expect(atomicWrite(p, 'v3', { expect: null })).rejects.toBeInstanceOf(ChangedOutsideError)
    expect(temps()).toEqual([])
  })

  it('锁成只读的文件不换掉（改名本来能成）', async () => {
    const p = join(dir, 'locked.md')
    writeFileSync(p, 'keep')
    chmodSync(p, 0o444)
    await expect(atomicWrite(p, 'x')).rejects.toMatchObject({ code: 'EACCES' })
    expect(readFileSync(p, 'utf8')).toBe('keep')
    expect(temps()).toEqual([])
  })

  it('临时文件名：点开头、.tmp 结尾、和目标同一个文件夹；很长的名字截短后不超过 255 字节', () => {
    const t = tempPathFor(join(dir, '笔记.md'))
    const name = t.slice(dir.length + 1)
    expect(name.startsWith('.笔记.md.cn-')).toBe(true)
    expect(name.endsWith('.tmp')).toBe(true)
    expect(TEMP_RE.exec(name)?.[2]).toBe(String(process.pid))
    const long = tempPathFor(join(dir, '长'.repeat(80) + '.md'))
    expect(Buffer.byteLength(long.slice(dir.length + 1))).toBeLessThanOrEqual(255)
    expect(isTempName('.a.md.cn-12-abc.tmp')).toBe(true)
    expect(isTempName('a.md')).toBe(false)
    expect(isTempName('a.tmp')).toBe(false)
  })

  it('拷大文件（附件）：拷完一次换上，权限跟源文件；exclusive 不盖', async () => {
    const src = join(dir, 'src.bin')
    writeFileSync(src, Buffer.alloc(3 * 1024 * 1024, 7))
    const dest = join(dir, '附件', 'a.bin')
    await atomicCopy(src, dest, { mkdir: true })
    expect(Buffer.compare(readFileSync(dest), readFileSync(src))).toBe(0)
    await expect(atomicCopy(src, dest, { exclusive: true })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(temps(join(dir, '附件'))).toEqual([])
  })

  it('往末尾加一段：读出、接上、原子写回', async () => {
    const p = join(dir, 'log.jsonl')
    await atomicAppend(p, 'a\n')
    await atomicAppend(p, 'b\n')
    expect(readFileSync(p, 'utf8')).toBe('a\nb\n')
  })

  it('排队写：同一个文件后写的最后落盘；内容一样不写（修改时间不变）', async () => {
    const p = join(dir, 'q.json')
    await Promise.all(['1', '2', '3', '4'].map((x) => writeQueued(p, x)))
    expect(readFileSync(p, 'utf8')).toBe('4')
    const m = statSync(p).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await writeQueued(p, '4')
    expect(statSync(p).mtimeMs).toBe(m)
  })
})

/** 起一个子进程一直写大文件，临时文件长到一半时 kill -9（模拟写到一半断电、崩溃） */
async function killMidWrite(target: string, mb: number) {
  const child = spawn(process.execPath, [join(FIX, 'writer.mjs'), 'atomic', target, String(mb), 'x'], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>((r) => child.stdout!.once('data', () => r()))
  const full = mb * 1024 * 1024
  let caught = 0
  const until = Date.now() + 10_000
  while (Date.now() < until) {
    const t = temps(join(target, '..'))[0]
    if (t) {
      const size = (() => {
        try {
          return statSync(join(target, '..', t)).size
        } catch {
          return 0
        }
      })()
      if (size > 0 && size < full) {
        caught = size
        break
      }
    }
    await new Promise((r) => setImmediate(r))
  }
  child.kill('SIGKILL')
  await new Promise((r) => child.once('exit', r))
  return { caught, pid: child.pid! }
}

describe('写到一半进程被杀', () => {
  it('原文件完整、没有半截文件；残留的临时文件下次打开时挪进回收处、记一行', async () => {
    const target = join(dir, '大笔记.md')
    const original = Buffer.alloc(2 * 1024 * 1024, 'o')
    writeFileSync(target, original)
    const { caught, pid } = await killMidWrite(target, 64)
    // 真的是在写到一半时杀掉的
    expect(caught).toBeGreaterThan(0)
    const now = readFileSync(target)
    // 盘上是完整的一份：要么还是原来的，要么是写完的新的（被杀前已经换上去过一轮），绝不是半截
    const whole = Buffer.compare(now, original) === 0 || (now.length === 64 * 1024 * 1024 && now.indexOf('o') === -1)
    expect(whole).toBe(true)
    const left = temps()
    expect(left).toHaveLength(1)
    expect(left[0]).toContain(`.cn-${pid}-`)

    // 下次打开：写它的进程已经不在，挪走
    const moved = await sweepTemps(dir, { minAgeMs: 0 })
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ from: left[0], target: '大笔记.md', targetExists: true })
    expect(temps()).toEqual([])
    expect(existsSync(join(dir, moved[0]!.to))).toBe(true)
    expect(moved[0]!.to.startsWith(RECYCLE_DIR + '/')).toBe(true)
    const log = readFileSync(join(dir, RECYCLE_DIR, '记录.txt'), 'utf8')
    expect(log.trim().split('\n')).toHaveLength(1)
    expect(log).toContain(left[0])
    expect(Buffer.compare(readFileSync(target), now)).toBe(0)
  }, 30_000)

  it('写它的进程还在、或者刚写的：不动（画布今日和画布笔记同时开着一个库）', async () => {
    writeFileSync(join(dir, `.a.md.cn-${process.pid}-x1.tmp`), 'live')
    writeFileSync(join(dir, '.b.md.cn-999999-x2.tmp'), 'fresh')
    expect(await sweepTemps(dir)).toEqual([])
    // 不在的进程、放了一分钟以上：挪走；软件自己的文件夹里的也找
    mkdirSync(join(dir, '.canvas-notes'), { recursive: true })
    writeFileSync(join(dir, '.canvas-notes', '.首页.json.cn-999999-x3.tmp'), '{')
    const later = Date.now() + 120_000
    const moved = await sweepTemps(dir, { now: later })
    expect(moved.map((m) => m.from).sort()).toEqual(['.b.md.cn-999999-x2.tmp', '.canvas-notes/.首页.json.cn-999999-x3.tmp'])
    expect(moved.every((m) => !m.targetExists)).toBe(true)
    expect(existsSync(join(dir, `.a.md.cn-${process.pid}-x1.tmp`))).toBe(true)
    // 回收处里的不再扫第二遍
    expect(await sweepTemps(dir, { now: later })).toEqual([])
  })
})

describe('保存时别的程序正在读', () => {
  it('读到的每一份都是整份（全是 a 或全是 b、长度对），没有一次读不到文件', async () => {
    const p = join(dir, 'busy.md')
    const size = 4 * 1024 * 1024
    const A = Buffer.alloc(size, 'a')
    const B = Buffer.alloc(size, 'b')
    await atomicWrite(p, A)
    const reader = spawn(process.execPath, [join(FIX, 'reader.mjs'), p, String(size), '1500'], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    reader.stdout!.on('data', (d) => (out += d))
    const done = new Promise((r) => reader.once('exit', r))
    let writes = 0
    const stop = Date.now() + 1500
    while (Date.now() < stop) await atomicWrite(p, writes++ % 2 ? A : B)
    await done
    const r = JSON.parse(out) as { reads: number; torn: number; missing: number }
    expect(writes).toBeGreaterThan(10)
    expect(r.reads).toBeGreaterThan(10)
    expect(r.torn).toBe(0)
    expect(r.missing).toBe(0)
  }, 20_000)
})
