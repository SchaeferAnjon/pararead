import { describe, expect, it } from 'vitest'
import { entryOf, mapOf, parseYaml, plain, removeEntry, renameKey, setBlock, setList, setNested, setScalar, stripComment, type YMap, YamlEdit, yamlScalar } from '../src/base-yaml'

const root = (e: YamlEdit) => (e.root?.kind === 'map' ? e.root : null)

describe('base 块里的 YAML：读成带行号的树', () => {
  it('缩进的映射、列表、「- 键: 值」、一行的 [a, b]、引号里的字', () => {
    const src = [
      'filters:',
      '  and:',
      '    - file.inFolder("课程/ecp/课程计划")',
      '    - 状态 != "学完"',
      'properties:',
      '  状态:',
      '    type: status',
      '    groups:',
      '      待开始: [未开始]',
      '      进行中: [在学, "a, b"]',
      'views:',
      '  - type: table',
      '    name: 全部',
      '    order:',
      '      - file.name',
      '  - type: kanban',
      "    name: '看板 ''2'''",
      '    groupBy:',
      '      property: 状态',
    ].join('\n')
    expect(plain(parseYaml(src).root)).toEqual({
      filters: { and: ['file.inFolder("课程/ecp/课程计划")', '状态 != "学完"'] },
      properties: { 状态: { type: 'status', groups: { 待开始: ['未开始'], 进行中: ['在学', 'a, b'] } } },
      views: [
        { type: 'table', name: '全部', order: ['file.name'] },
        { type: 'kanban', name: "看板 '2'", groupBy: { property: '状态' } },
      ],
    })
  })

  it('行尾注释去掉，引号里的 # 不算注释；整行注释、空行跳过', () => {
    expect(stripComment('    - 名字.contains(" #1")  # 找第一个')).toBe('    - 名字.contains(" #1")')
    expect(stripComment("    name: '#话题'")).toBe("    name: '#话题'")
    const src = '# 开头的注释\nviews:\n\n  # 第一个视图\n  - type: table # 表格\n    name: "全部 #1"\n'
    expect(plain(parseYaml(src).root)).toEqual({ views: [{ type: 'table', name: '全部 #1' }] })
  })

  it('四个空格缩进、「键:」下面不缩进的列表、| 多行字、接着下一行写的长字', () => {
    const src = ['views:', '- type: table', '  name: 全部', '  order:', '  - file.name', '  - 状态', 'formulas:', '    说明: |', '        第一行', '        第二行', '    长的: if(已看 >= 节数, "学完",', '        "还差")'].join('\n')
    expect(plain(parseYaml(src).root)).toEqual({
      views: [{ type: 'table', name: '全部', order: ['file.name', '状态'] }],
      formulas: { 说明: '第一行\n第二行', 长的: 'if(已看 >= 节数, "学完", "还差")' },
    })
  })

  it('引号：双引号转义、单引号里 \'\' 是一个、引号后面还有字的当普通字', () => {
    const src = 'a: "x \\"y\\" z"\nb: \'it\'\'s\'\nc: "学完" + 已看\nd: "多行的\n  字"'
    expect(plain(parseYaml(src).root)).toEqual({ a: 'x "y" z', b: "it's", c: '"学完" + 已看', d: '多行的 字' })
  })

  it('每一项记着哪几行：键那一行、到哪一行为止、上面贴着的注释', () => {
    const src = ['views:', '  # 第一个', '  - type: table', '    name: 全部', '    # 名字下面的注释', '', '  - type: kanban', '    name: 看板'].join('\n')
    const { root } = parseYaml(src)
    const seq = entryOf(root, 'views')!.value!
    expect(seq.kind).toBe('seq')
    if (seq.kind !== 'seq') return
    expect(seq.items.map((it) => [it.lead, it.line, it.end])).toEqual([
      [1, 2, 5],
      [6, 6, 8],
    ])
  })

  it('认不出的行跳过、后面照读；空块读成 null', () => {
    expect(plain(parseYaml('a: 1\n这一行不对\nb: 2').root)).toEqual({ a: '1', b: '2' })
    expect(parseYaml('').root).toBeNull()
    expect(parseYaml('# 只有注释\n').root).toBeNull()
  })
})

describe('改 YAML：只换动到的那几行', () => {
  const SRC = ['views:', '  - type: table', '    name: 全部   # 主视图', '    order:', '      - file.name', '      # 状态这一列先藏着', '      - 日期', '  - type: kanban', '    name: 看板'].join('\n')
  const view = (e: YamlEdit, i: number) => () => {
    const s = entryOf(root(e), 'views')?.value
    const v = s?.kind === 'seq' ? s.items[i]?.value : null
    return v?.kind === 'map' ? v : null
  }
  const ORDER = ['type', 'name', 'order', 'filters', 'sort', 'groupBy'] as const

  it('改一个值：只换值，键和行尾注释原样；值一样不动', () => {
    const e = new YamlEdit(SRC)
    setScalar(e, view(e, 0), 'name', '全部的')
    expect(e.text()).toBe(SRC.replace('name: 全部   # 主视图', 'name: 全部的   # 主视图'))
    setScalar(e, view(e, 0), 'name', '全部的')
    expect(e.text()).toBe(SRC.replace('name: 全部   # 主视图', 'name: 全部的   # 主视图'))
  })

  it('加一个键：照先后插在该在的地方（sort 在 order 后面、groupBy 前面）', () => {
    const e = new YamlEdit(SRC)
    setScalar(e, view(e, 1), 'groupBy', '状态', { order: ORDER })
    setBlock(e, view(e, 1), 'sort', (col) => [`${' '.repeat(col + 2)}- property: 日期`, `${' '.repeat(col + 4)}direction: ASC`], { order: ORDER })
    expect(e.text()).toBe(SRC + '\n    sort:\n      - property: 日期\n        direction: ASC\n    groupBy: 状态')
  })

  it('拿掉一个键连同贴在上面的注释；和「-」同一行的第一个键拿掉时下一个键接上「-」', () => {
    const e = new YamlEdit(SRC)
    const m = view(e, 0)()!
    removeEntry(e, m, entryOf(m, 'order')!)
    expect(e.text()).toBe(['views:', '  - type: table', '    name: 全部   # 主视图', '  - type: kanban', '    name: 看板'].join('\n'))
    const m2 = view(e, 1)()!
    removeEntry(e, m2, entryOf(m2, 'type')!)
    expect(e.text()).toBe(['views:', '  - type: table', '    name: 全部   # 主视图', '  - name: 看板'].join('\n'))
  })

  it('换列表：没变的项原样留着（连上面的注释），只加、只去变了的', () => {
    const e = new YamlEdit(SRC)
    const o = { same: (a: string, b: unknown) => a === b, emit: (a: string, dash: number) => [`${' '.repeat(dash)}- ${yamlScalar(a)}`] }
    setList(e, view(e, 0), 'order', ['file.name', '日期', '进度'], o)
    expect(e.text()).toBe(SRC.replace('      - 日期', '      - 日期\n      - 进度'))
    setList(e, view(e, 0), 'order', ['file.name', '进度'], o)
    expect(e.text()).toBe(SRC.replace('      # 状态这一列先藏着\n      - 日期', '      - 进度'))
  })

  it('一行的 [a, b] 照旧写成一行，原来的项照原样', () => {
    const src = "views:\n  - type: table\n    order: [file.name, '日期']  # 列"
    const e = new YamlEdit(src)
    setList(e, view(e, 0), 'order', ['file.name', '日期', '进度'], { same: (a: string, b: unknown) => a === b, emit: () => [], flow: (a: string) => a })
    expect(e.text()).toBe("views:\n  - type: table\n    order: [file.name, '日期', 进度]  # 列")
  })

  it('两层的键：没有外层连外层一起写；拿空了外层一起拿掉，回到原样', () => {
    const e = new YamlEdit(SRC)
    setNested(e, view(e, 1), 'columnSize', '评分', '140')
    expect(e.text()).toBe(SRC + '\n    columnSize:\n      评分: 140')
    setNested(e, view(e, 1), 'columnSize', '名字', '200')
    setNested(e, view(e, 1), 'columnSize', '评分', null)
    expect(e.text()).toBe(SRC + '\n    columnSize:\n      名字: 200')
    setNested(e, view(e, 1), 'columnSize', '名字', null)
    expect(e.text()).toBe(SRC)
  })

  it('手改过的四格缩进：新写的几行跟着用四格', () => {
    const src = 'views:\n    - type: table\n      name: 全部'
    const e = new YamlEdit(src)
    expect(e.step).toBe(4)
    setBlock(e, view(e, 0), 'order', (col) => [`${' '.repeat(e.dashCol(col))}- file.name`])
    expect(e.text()).toBe(src + '\n      order:\n          - file.name')
  })

  it('键改名只换键', () => {
    const e = new YamlEdit('properties:\n  练习:   # 关联\n    type: relation')
    const p = mapOf(root(e), 'properties') as YMap
    renameKey(e, entryOf(p, '练习')!, '题 目')
    expect(e.text()).toBe('properties:\n  题 目:   # 关联\n    type: relation')
  })

  it('值写成 YAML：会读歪的加引号', () => {
    expect(yamlScalar('(已看 / 节数 * 100).round() + "%"')).toBe('(已看 / 节数 * 100).round() + "%"')
    expect(yamlScalar('!日期.isEmpty()')).toBe("'!日期.isEmpty()'")
    expect(yamlScalar('"还差 " + 节数')).toBe('\'"还差 " + 节数\'')
    expect(yamlScalar('a: b')).toBe("'a: b'")
    expect(yamlScalar('x #1')).toBe("'x #1'")
    expect(yamlScalar('两行\n字')).toBe('"两行\\n字"')
    expect(yamlScalar('')).toBe("''")
  })
})
