// 同步来源 · Get笔记 的纯函数（设计页 61-同步来源第 1、4、5 节）：转换、去重、对账、四处老毛病不再出现。
// 样本照 Get笔记 开放接口回来的样子造的（字段、大整数 id、没转义的换行都照真的），内容是编的。
import { describe, expect, it } from 'vitest'
import {
  cleanSourceUrl,
  defaultSourceFolder,
  gnFixBody,
  gnImages,
  gnIsEmpty,
  gnItem,
  gnMarkdown,
  gnNoteOf,
  imageExt,
  indexVault,
  knownIds,
  looseJson,
  newSyncState,
  nextPull,
  parseSyncState,
  planFirst,
  planFull,
  planNew,
  prop,
  pullDue,
  sourceFileName,
  sourceIdsOf,
  syncStateText,
  textPrint,
} from '../src'

const ID = '1927296063601909568'

/** 接口原样的一段：id 是裸的大整数，content 里夹着真的换行 */
const RAW_LIST = `{"success":true,"data":{"notes":[{"id":${ID},"note_id":"${ID}","title":"鼠标垫","content":"### 📑 智能总结
- **时长**：0 秒","note_type":"meeting","tags":[{"id":"1","name":"录音笔记","type":"system"}],"children_count":0,"is_child_note":false,"created_at":"2026-11-18 00:21:13","updated_at":"2026-11-18 00:21:13"}],"has_more":true,"next_cursor":1921504753322828008,"total":567}}`

const link = (over: Record<string, unknown> = {}) =>
  gnNoteOf({
    note: {
      id: '1925789669321169464',
      note_url: 'https://www.biji.com/note/1925789669321169464',
      title: '旧 Kindle 越狱：装上读书插件',
      content:
        '### 一台闲置的 Kindle\n\n![](https://get-notes.umiwi.com/board/a.png?Expires=1795884145&OSSAccessKeyId=x)\n\n[00:02:08](https://getnotes.seek:128) 说到越狱\n对比如下：\n| 项 | 值 |\n| --- | --- |\n| 屏幕 | 墨水屏 |\n\n```\n|不是表格\n```',
      note_type: 'link',
      tags: [
        { id: '1', name: 'AI链接笔记', type: 'system' },
        { id: '2', name: 'Kindle 越狱', type: 'ai' },
        { id: '3', name: '我的标签', type: 'manual' },
      ],
      attachments: [{ type: 'link', url: 'https://mp.weixin.qq.com/s?x=1' }],
      web_page: {
        url: 'https://mp.weixin.qq.com/s?__biz=MzA5&mid=2448525734&idx=1&sn=863f&chksm=84fa&pass_ticket=abc&sessionid=1&devicetype=iOS&scene=21#rd',
        content: '手上的这台 Kindle 是2016年买的\n\n后来转用读书',
      },
      created_at: '2026-11-01 19:09:53',
      updated_at: '2026-11-01 19:09:53',
      ...over,
    },
  })

const NOW = new Date(2026, 10, 23, 17, 51, 55)

describe('宽松 JSON', () => {
  it('大整数 id 不丢精度，正文里没转义的换行照读', () => {
    const j = looseJson(RAW_LIST) as { data: { notes: unknown[]; next_cursor: string; total: number } }
    expect(j.data.next_cursor).toBe('1921504753322828008')
    expect(j.data.total).toBe(567)
    const n = gnNoteOf(j.data.notes[0])
    expect(n.id).toBe(ID)
    expect(n.content).toBe('### 📑 智能总结\n- **时长**：0 秒')
    // 不用 looseJson 时 id 读歪（说明这一步是必要的）
    expect(String((JSON.parse(`{"id":${ID}}`) as { id: number }).id)).not.toBe(ID)
  })
  it('字符串里的数字、转义的引号不动', () => {
    expect(looseJson('{"a":"x 12345678901234567 \\" y","b":-1.5e3,"c":[12345678901234567890]}')).toEqual({ a: 'x 12345678901234567 " y', b: -1500, c: ['12345678901234567890'] })
  })
})

describe('一篇写成 md', () => {
  const images = new Map([['https://get-notes.umiwi.com/board/a.png?Expires=1795884145&OSSAccessKeyId=x', '附件/剪藏/Get笔记/旧 Kindle 越狱：装上读书插件/图1.png']])
  const md = gnMarkdown(link(), [], { path: '剪藏/Get笔记/旧 Kindle 越狱：装上读书插件.md', images, transcript: true, original: true, now: NOW })

  it('属性名、顺序照用户库里的写法，多一个 getnote_url', () => {
    expect(md.split('\n---\n')[0]).toBe(
      [
        '---',
        'title: "旧 Kindle 越狱：装上读书插件"',
        'note_type: link',
        'getnote_id: 1925789669321169464',
        'url: "https://mp.weixin.qq.com/s?__biz=MzA5&mid=2448525734&idx=1&sn=863f"',
        'getnote_url: https://www.biji.com/note/1925789669321169464',
        'tags: ["Kindle 越狱", "我的标签"]',
        'created: 2026-11-01 19:09:53',
        'updated: 2026-11-01 19:09:53',
        'synced: 2026-11-23 17:51:55',
      ].join('\n'),
    )
    expect(prop(md, 'getnote_id')).toBe('1925789669321169464')
    expect(md).toContain('\n---\n# 🔗 旧 Kindle 越狱：装上读书插件\n\n### 一台闲置的 Kindle')
  })
  it('老毛病一：图片不链到会过期的地址，写库里的相对链接', () => {
    expect(md).not.toMatch(/umiwi\.com|Expires=/)
    expect(md).toContain('![](../../附件/剪藏/Get笔记/旧%20Kindle%20越狱：装上读书插件/图1.png)')
  })
  it('老毛病二：没有 getnotes.seek 假链接，时间点写成代码', () => {
    expect(md).not.toContain('getnotes.seek')
    expect(md).toContain('`00:02:08` 说到越狱')
  })
  it('老毛病三：微信网址只留 __biz、mid、idx、sn', () => {
    expect(md).not.toMatch(/pass_ticket|sessionid|devicetype|chksm|scene=/)
    expect(cleanSourceUrl('https://mp.weixin.qq.com/s?__biz=MzA5&mid=1&idx=1&sn=ab&pass_ticket=x#rd')).toBe('https://mp.weixin.qq.com/s?__biz=MzA5&mid=1&idx=1&sn=ab')
    expect(cleanSourceUrl('https://mp.weixin.qq.com/s?__biz=Mzg2OTA1OTAxNA==&mid=22&idx=1&sn=95&sessionid=9')).toBe('https://mp.weixin.qq.com/s?__biz=Mzg2OTA1OTAxNA==&mid=22&idx=1&sn=95')
    expect(cleanSourceUrl('https://example.com/a?utm=1')).toBe('https://example.com/a?utm=1')
    // 只有跟踪参数、没有认文章的：缩不了，原样
    expect(cleanSourceUrl('https://mp.weixin.qq.com/s?chksm=1&exptype=2')).toBe('https://mp.weixin.qq.com/s?chksm=1&exptype=2')
  })
  it('老毛病四：表格前补空行，代码块里的竖线不动', () => {
    expect(md).toContain('对比如下：\n\n| 项 | 值 |')
    expect(md).toContain('```\n|不是表格\n```')
  })
  it('原文收在文末折起的提示块，来源行在最后', () => {
    expect(md).toContain('> [!quote]- 原文（29 字）\n> 手上的这台 Kindle 是2016年买的\n>\n> 后来转用读书')
    expect(md.trimEnd().split('\n').pop()).toBe('来源：[原文](https://mp.weixin.qq.com/s?__biz=MzA5&mid=2448525734&idx=1&sn=863f) · [在 Get笔记 里打开](https://www.biji.com/note/1925789669321169464)')
    expect(gnMarkdown(link(), [], { path: 'a.md', images, transcript: true, original: false, now: NOW })).not.toContain('[!quote]')
  })
  it('录音：逐句转写折起带时长，只留「在 Get笔记 里听」，系统标签不要', () => {
    const a = gnNoteOf({
      id: '1922998432353637632',
      note_id: '1922998432353637632',
      title: '对人骨的疑问',
      content: '### 📑 智能总结\n- **时长**：7 分钟 51 秒',
      note_type: 'class_audio',
      tags: [{ name: '录音笔记', type: 'system' }],
      attachments: [{ type: 'audio', url: 'https://mediacdn.umiwi.com/x.mp3?Expires=1', duration: 471000 }],
      audio: { original: '🟣 说话人2 [00:00:34]\n哦。\n\n🟣 说话人2 [00:02:08]\n这是真的人骨头吗？' },
      created_at: '2026-10-01 17:02:53',
      updated_at: '2026-10-01 17:02:53',
    })
    const out = gnMarkdown(a, [], { path: 'x.md', images: new Map(), transcript: true, original: true, now: NOW })
    expect(out).toContain('# 🎓 对人骨的疑问')
    expect(out).toContain('tags: []')
    expect(out).toContain('> [!note]- 录音转写（7:51）\n> 🟣 说话人2 [00:00:34]\n> 哦。\n>\n> 🟣 说话人2 [00:02:08]')
    expect(out).not.toContain('.mp3')
    expect(out).toContain('来源：[在 Get笔记 里听](https://www.biji.com/note/1922998432353637632)')
    expect(out).not.toMatch(/^url: /m)
  })
  it('图片笔记：附件里的图排在「图片」下面；子笔记按时间接在后面', () => {
    const p = gnNoteOf({
      id: '5',
      title: '',
      content: '多 Agent 配置\n要点',
      note_type: 'img_text',
      attachments: [
        { type: 'image', url: 'https://x/1.jpg' },
        { type: 'image', url: 'https://x/2.jpg' },
      ],
      created_at: '2026-11-02 08:00:00',
    })
    const kids = [gnNoteOf({ id: '7', title: '', content: '第二次补充', created_at: '2026-11-04 10:00:00' }), gnNoteOf({ id: '6', title: '补一句', content: '第一次补充 ![](https://x/3.png)', created_at: '2026-11-03 09:00:00' })]
    expect(gnImages(p, kids)).toEqual(['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.png'])
    const out = gnMarkdown(p, kids, { path: '剪藏/多 Agent 配置.md', images: new Map([['https://x/1.jpg', '附件/剪藏/多 Agent 配置/图1.jpg']]), transcript: true, original: true, now: NOW })
    expect(out).toContain('title: "多 Agent 配置"')
    expect(out).toContain('## 图片\n\n![](../附件/剪藏/多%20Agent%20配置/图1.jpg)\n\n![](https://x/2.jpg)')
    expect(out.indexOf('## 补一句 · 2026-11-03 09:00')).toBeLessThan(out.indexOf('## 追加 · 2026-11-04 10:00'))
  })
  it('链接原文里的图也下进附件（真拉时微信原文里的图都是会过期的地址）', () => {
    const n = link({ web_page: { url: 'https://example.com/a', content: '第一段\n> ![x.jpg](https://get-notes.umiwi.com/p/1?Expires=1)\*图注' } })
    expect(gnImages(n)).toContain('https://get-notes.umiwi.com/p/1?Expires=1')
    expect(gnImages(n, [], false)).not.toContain('https://get-notes.umiwi.com/p/1?Expires=1')
    const out = gnMarkdown(n, [], { path: 'G/a.md', images: new Map([['https://get-notes.umiwi.com/p/1?Expires=1', '附件/G/a/图2.jpg']]), transcript: true, original: true, now: NOW })
    expect(out).toContain('> > ![x.jpg](../附件/G/a/图2.jpg)')
    expect(out).not.toContain('p/1?Expires')
  })
  it('标题里的括号转义，链接不被截断', () => {
    expect(gnFixBody('![](https://a/b.png)', '剪藏/OCR (v2).md', new Map([['https://a/b.png', '附件/剪藏/OCR (v2)/图1.png']]))).toBe('![](../附件/剪藏/OCR%20%28v2%29/图1.png)')
  })
})

describe('名字、空录音、图的格式', () => {
  it('文件名：不能用的字换全角，开头的点去掉，太长截断', () => {
    expect(sourceFileName('a/b:c*d?"e"<f>|g')).toBe('a／b：c＊d？＂e＂＜f＞｜g')
    expect(sourceFileName('.hidden\nline')).toBe('hidden line')
    expect([...sourceFileName('长'.repeat(200))].length).toBe(80)
  })
  it('空录音：AI 说 0 秒、无有效内容的；有话的、链接不算', () => {
    expect(gnIsEmpty({ note_type: 'meeting', title: '鼠标垫', content: '- **时长**：0 秒' })).toBe(true)
    expect(gnIsEmpty({ note_type: 'local_audio', title: '无有效语音笔记内容', content: '' })).toBe(true)
    expect(gnIsEmpty({ note_type: 'class_audio', title: '开场问候', content: '- **时长**：1 分钟 22 秒\n本次课堂仅记录到开篇问候' })).toBe(false)
    expect(gnIsEmpty({ note_type: 'link', title: '空白', content: '时长：0 秒' })).toBe(false)
  })
  it('图按文件头认格式', () => {
    expect(imageExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png')
    expect(imageExt(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('gif')
    expect(imageExt(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('webp')
    expect(imageExt(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpg')
  })
})

describe('认重复', () => {
  it('getnote_id 一篇、getnote_ids 合并的几篇（行内和一行一个都认）', () => {
    expect(sourceIdsOf('---\ntitle: a\ngetnote_id: 123\n---\n', 'getnote_id', 'getnote_ids')).toEqual({ ids: ['123'], merged: false })
    expect(sourceIdsOf('---\ngetnote_ids: [1, 2, 3]\n---\n', 'getnote_id', 'getnote_ids')).toEqual({ ids: ['1', '2', '3'], merged: true })
    expect(sourceIdsOf('---\ngetnote_ids:\n  - 4\n  - 5\ntags: []\n---\n', 'getnote_id', 'getnote_ids')).toEqual({ ids: ['4', '5'], merged: true })
    expect(sourceIdsOf('正文里写 getnote_id: 9', 'getnote_id', 'getnote_ids').ids).toEqual([])
  })
  it('整个库里找：挪进别的文件夹、改了名照样认得', () => {
    const idx = indexVault(
      [
        ['40-Clippings/Getnotes/AI-Tech/a.md', '---\ngetnote_id: 1\n---\n'],
        ['30-Courses/某课/录音/改过名.md', '---\ngetnote_id: 2\n---\n'],
        ['40-Clippings/Getnotes/合并.md', '---\ngetnote_ids: [3, 4]\n---\n'],
        ['随手.md', '没有属性'],
      ],
      'getnote_id',
      'getnote_ids',
    )
    expect([...idx.keys()].sort()).toEqual(['1', '2', '3', '4'])
    expect(idx.get('2')!.path).toBe('30-Courses/某课/录音/改过名.md')
    expect(idx.get('4')!.merged).toBe(true)
  })
  it('默认文件夹：九成以上都在它下面的最深那层（不选只占六七成的 AI-Tech）', () => {
    const paths = [...Array(300).fill('40-Clippings/Getnotes/AI-Tech/x.md'), ...Array(194).fill('40-Clippings/Getnotes/Life/y.md'), ...Array(5).fill('40-Clippings/Getnotes/z.md'), '30-Courses/a/b.md', '30-Courses/a/c.md']
    expect(defaultSourceFolder(paths)).toBe('40-Clippings/Getnotes')
    expect(defaultSourceFolder([])).toBeNull()
    expect(defaultSourceFolder(['a/1.md', 'b/2.md', 'b/3.md'])).toBe('b')
  })
})

const item = (id: string, created: string, over: Partial<ReturnType<typeof gnItem>> = {}) => ({ id, title: id, kind: 'link', created, updated: created, empty: false, ...over })

describe('该拉哪几篇', () => {
  const vault = indexVault([['G/a.md', '---\ngetnote_id: 1\n---\n'], ['G/b.md', '---\ngetnote_id: 2\ncreated: 2026-09-07 10:00:00\n---\n']], 'getnote_id', 'getnote_ids')
  const remote = [item('5', '2026-11-18 00:00:00', { empty: true, kind: 'meeting' }), item('4', '2026-10-01 00:00:00'), item('2', '2026-09-07 10:00:00'), item('3', '2026-08-01 00:00:00'), item('1', '2026-07-01 00:00:00')]

  it('第一次连上：比库里最新那篇还新的、更早的、库里已有几篇', () => {
    const p = planFirst(remote, vault, NOW)
    expect(p).toMatchObject({ total: 5, inVault: 2, newest: '2026-09-07 10:00:00' })
    expect(p.newer.map((r) => r.id)).toEqual(['5', '4'])
    expect(p.older.map((r) => r.id)).toEqual(['3'])
    // 库里一篇都没有：最近 30 天的算「新的」
    const empty = planFirst(remote, new Map(), NOW)
    expect(empty.newest).toBeNull()
    expect(empty.newer.map((r) => r.id)).toEqual(['5'])
  })
  it('拉两遍不重复：库里有的、删过的、说过不拉的都跳过；空录音照设置', () => {
    const st = newSyncState('G')
    st.skipped = ['3']
    st.dropped = ['9']
    const known = knownIds(st, vault)
    const p = planNew([...remote, item('9', '2026-11-20 00:00:00')], known, true)
    expect(p.pull.map((r) => r.id)).toEqual(['4'])
    expect(p.empty.map((r) => r.id)).toEqual(['5'])
    expect(planNew(remote, known, false).pull.map((r) => r.id)).toEqual(['5', '4'])
  })
})

describe('每天对账', () => {
  const pulled = '---\ngetnote_id: 10\nupdated: 2026-11-01 00:00:00\n---\n拉进来的样子\n'
  const st = () => {
    const s = newSyncState('G')
    s.notes = { '10': { u: '2026-11-01 00:00:00', h: textPrint(pulled) }, '11': { u: '2026-11-01 00:00:00', h: 'x' }, '99': { u: '2026-11-01 00:00:00', h: 'y' } }
    return s
  }
  const props = { deleted: 'getnote_deleted', newer: 'getnote_newer' }

  it('那边改了：没人动过的换，动过的只标；那边删了只标；库里删了的记下不再拉', () => {
    const vault = indexVault(
      [
        ['G/10.md', pulled],
        ['G/11.md', '---\ngetnote_id: 11\n---\n我改过\n'],
        ['G/12.md', '---\ngetnote_id: 12\nupdated: 2026-06-01 00:00:00\n---\n老笔记\n'],
        ['G/13.md', '---\ngetnote_id: 13\n---\n那边删了\n'],
        ['G/m.md', '---\ngetnote_ids: [14, 15]\n---\n合并的\n'],
      ],
      'getnote_id',
      'getnote_ids',
    )
    const remote = [item('10', '2026-10-01 00:00:00', { updated: '2026-11-20 00:00:00' }), item('11', '2026-10-01 00:00:00', { updated: '2026-11-20 00:00:00' }), item('12', '2026-06-01 00:00:00', { updated: '2026-11-20 00:00:00' }), item('14', '2026-01-01 00:00:00', { updated: '2026-11-20 00:00:00' })]
    const p = planFull(remote, vault, st(), props)
    expect(p.replace).toEqual([{ id: '10', path: 'G/10.md' }])
    expect(p.mark.map((m) => m.id)).toEqual(['11', '12'])
    expect(p.deleted).toEqual([{ id: '13', path: 'G/13.md' }])
    expect(p.dropped).toEqual(['99'])
  })
  it('标过的不再标；那边没改的不动', () => {
    const vault = indexVault([['G/11.md', '---\ngetnote_id: 11\ngetnote_newer: 2026-11-20 00:00:00\n---\n'], ['G/13.md', '---\ngetnote_id: 13\ngetnote_deleted: 2026-11-22\n---\n'], ['G/10.md', pulled]], 'getnote_id', 'getnote_ids')
    const remote = [item('11', '2026-10-01 00:00:00', { updated: '2026-11-20 00:00:00' }), item('10', '2026-10-01 00:00:00', { updated: '2026-11-01 00:00:00' })]
    expect(planFull(remote, vault, st(), props)).toEqual({ replace: [], mark: [], deleted: [], dropped: ['99'] })
  })
})

describe('记录和定时', () => {
  it('记录读写来回不变，坏了的补默认', () => {
    const s = newSyncState('40-Clippings/Getnotes')
    s.notes = { '2': { u: 'b', h: 'h2' }, '1': { u: 'a', h: 'h1' } }
    s.skipped = ['3', '3']
    const text = syncStateText(s)
    expect(parseSyncState(text, 'x')).toEqual({ ...s, skipped: ['3'] })
    expect(syncStateText(parseSyncState(text, 'x')!)).toBe(text)
    expect(parseSyncState('{坏了', 'F')!.settings.folder).toBe('F')
    expect(parseSyncState('{"settings":{"every":"x","folder":"../外面"}}', 'F')!.settings).toMatchObject({ every: 'open+2h', folder: 'F' })
    expect(parseSyncState(null, 'F')).toBeNull()
  })
  it('开软件时 + 每 2 小时 / 每天 22:00 / 只手动', () => {
    const last = new Date(2026, 10, 23, 17, 48)
    expect(nextPull('open+2h', last, NOW)!.getHours()).toBe(19)
    expect(pullDue('open+2h', last, new Date(2026, 10, 23, 19, 47))).toBe(false)
    expect(pullDue('open+2h', last, new Date(2026, 10, 23, 19, 48))).toBe(true)
    expect(nextPull('open+22', last, NOW)!.getHours()).toBe(22)
    expect(pullDue('open+22', last, new Date(2026, 10, 23, 22, 0, 30))).toBe(true)
    expect(pullDue('open+22', new Date(2026, 10, 23, 22, 1), new Date(2026, 10, 23, 23, 0))).toBe(false)
    expect(pullDue('manual', last, new Date(2027, 0, 1))).toBe(false)
    expect(nextPull('open', last, NOW)).toBeNull()
  })
})
