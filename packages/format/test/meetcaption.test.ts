import { describe, expect, it } from 'vitest'
import {
  canvasNotesMcUrl,
  clockToSession,
  cueAt,
  isMcRecord,
  lineAtTime,
  mcOpenUrl,
  mcStartUrl,
  mcTimeLink,
  parseCanvasNotesMc,
  parseMcOpen,
  parseVtt,
  readMcRecord,
  writeMcRecord,
  writeVtt,
} from '../src/meetcaption'

const draft = {
  path: '30-Courses/ECP/上课的录音和转录/2026-11-04 近似加法器.md',
  title: '2026-11-04 近似加法器',
  course: 'ecp',
  mode: 'class' as const,
  sessions: ['2026-11-04 09.29', '2026-11-04 11.05'],
  duration: '2:30',
  overview: { text: '本节课从 CMOS scaling 讲起。', engine: 'DeepSeek' },
  todos: [{ text: '列出 full adder 的真值表', session: '2026-11-04 09.29', t: 840, due: '2026-11-11' }],
  parts: [
    { session: '2026-11-04 09.29', sections: [{ title: '近似计算的动机', t: 0, points: [{ text: 'dark silicon', t: 360 }], frames: [9 * 3600 + 41 * 60 + 12] }, { title: 'Full adder', t: 1200 }] },
    { session: '2026-11-04 11.05', sections: [{ title: '乘法器', t: 0 }] },
  ],
}

describe('MeetCaption 上课记录的写法', () => {
  it('深链：开始、打开那一刻；空格写成 %20', () => {
    expect(mcStartUrl({ project: 'ecp', mode: 'class', back: '30-Courses/ECP' })).toBe('meetcaption://start?project=ecp&mode=class&source=mic&back=30-Courses%2FECP')
    expect(mcStartUrl({ project: 'hiwi2', mode: 'online' })).toBe('meetcaption://start?project=hiwi2&mode=online&source=system')
    expect(mcOpenUrl({ session: '2026-11-04 09.29', t: 830 })).toBe('meetcaption://open?session=2026-11-04%2009.29&t=830')
    expect(parseMcOpen('meetcaption://open?session=2026-11-04%2009.29&t=830')).toEqual({ session: '2026-11-04 09.29', t: 830 })
    expect(parseMcOpen('https://x')).toBeNull()
    expect(mcTimeLink('2026-11-04 09.29', 840)).toBe('[▶ 09:43](meetcaption://open?session=2026-11-04%2009.29&t=840)')
  })

  it('MeetCaption 跳过来的两种深链', () => {
    const a = canvasNotesMcUrl({ file: 'a/b.md', t: 830, session: '2026-11-04 09.29', back: 'a' })
    expect(parseCanvasNotesMc(a)).toEqual({ file: 'a/b.md', t: 830, session: '2026-11-04 09.29', back: 'a' })
    const b = canvasNotesMcUrl({ session: '2026-11-04 09.29', t: 5 })
    expect(b.startsWith('canvas-notes://meetcaption?')).toBe(true)
    expect(parseCanvasNotesMc(b)).toEqual({ session: '2026-11-04 09.29', t: 5 })
    expect(parseCanvasNotesMc('canvas-notes://meetcaption?t=5')).toBeNull()
    expect(parseCanvasNotesMc('canvas-notes://commit/abc')).toBeNull()
  })

  it('写出来再读回来：几场、录音、字幕、每个 ▶、关键画面；时间放在 📅 前面', () => {
    const md = writeMcRecord(draft)
    expect(isMcRecord(md)).toBe(true)
    expect(md).toContain('- [ ] 列出 full adder 的真值表 [▶ 09:43](meetcaption://open?session=2026-11-04%2009.29&t=840) 📅 2026-11-11')
    expect(md).toContain('> [!ai] 这节课讲了什么 · MeetCaption · DeepSeek')
    const r = readMcRecord(md)!
    expect(r.sessions).toEqual(draft.sessions)
    expect(r.recordings).toEqual(['.canvas-notes/录音/30-Courses/ECP/上课的录音和转录/2026-11-04 近似加法器/录音-1.webm', '.canvas-notes/录音/30-Courses/ECP/上课的录音和转录/2026-11-04 近似加法器/录音-2.webm'])
    expect(r.subtitles).toEqual(['.canvas-notes/字幕/meetcaption/2026-11-04 09.29.vtt', '.canvas-notes/字幕/meetcaption/2026-11-04 11.05.vtt'])
    expect(r.mode).toBe('class')
    expect(r.duration).toBe('2:30')
    expect(r.times.map((x) => x.label)).toEqual(['09:43', '09:29', '09:35', '09:49', '11:05'])
    expect(r.frames).toHaveLength(1)
    expect(r.frames[0]!.clock).toBe(9 * 3600 + 41 * 60 + 12)
    expect(decodeURI(r.frames[0]!.path)).toBe('../../../.canvas-notes/录音/30-Courses/ECP/上课的录音和转录/2026-11-04 近似加法器/画面-09.41.12.jpg')
    // 落在哪一行：09.29 那场第 1000 秒在「dark silicon」(360) 之后、「Full adder」(1200) 之前 → 作业那行 840 最近
    const line = lineAtTime(r, '2026-11-04 09.29', 1000)!
    expect(md.split('\n')[line - 1]).toContain('t=840')
    expect(md.split('\n')[lineAtTime(r, '2026-11-04 11.05', 99)! - 1]).toContain('乘法器')
    expect(lineAtTime(r, '2026-11-05 10.00', 1)).toBeNull()
  })

  it('不是上课记录', () => {
    expect(isMcRecord('# 随便一篇\n')).toBe(false)
    expect(readMcRecord('---\n类型: 笔记\n---\n')).toBeNull()
  })

  it('关键画面的钟点落到哪一场', () => {
    expect(clockToSession(draft.sessions, 11 * 3600 + 10 * 60)).toEqual({ session: '2026-11-04 11.05', t: 300 })
    expect(clockToSession(draft.sessions, 9 * 3600 + 30 * 60)).toEqual({ session: '2026-11-04 09.29', t: 60 })
    expect(clockToSession(draft.sessions, 8 * 3600)).toBeNull()
  })

  it('字幕全文：双语、说话人，写了再读一样', () => {
    const cues = [
      { start: 0, end: 4.2, text: 'Today: dark silicon.', tr: '今天讲 dark silicon。', who: 'Prof' },
      { start: 4.2, end: 9, text: 'Why approximate?', tr: '为什么要近似？' },
    ]
    const vtt = writeVtt(cues)
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:04.200\n<v Prof>Today')).toBe(true)
    expect(parseVtt(vtt)).toEqual(cues)
    expect(cueAt(cues, 5)).toBe(1)
    expect(cueAt(cues, 0)).toBe(0)
    expect(cueAt([], 3)).toBe(-1)
  })
})
