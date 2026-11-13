import { describe, expect, it } from 'vitest'
import { parseToolCalls, toPrompt } from '../src/main/claudeCode'
import type { ChatMsg, ToolDef } from '../src/main/glm'

const PNG = 'data:image/png;base64,AAAA'

describe('本机 Claude Code：消息怎么变成一次命令行调用', () => {
  it('一问一答：系统提示词合在一起，用户的话原样给', () => {
    const r = toPrompt([
      { role: 'system', content: '你是论文阅读助手' },
      { role: 'system', content: '论文全文：……' },
      { role: 'user', content: '这篇讲了什么' }
    ])
    expect(r.system).toBe('你是论文阅读助手\n\n论文全文：……')
    expect(r.content).toEqual([{ type: 'text', text: '这篇讲了什么' }])
  })

  it('带截图：图片变成内容块跟在文字后面', () => {
    const r = toPrompt([{ role: 'user', content: [{ type: 'image_url', image_url: { url: PNG } }, { type: 'text', text: '解释这张图' }] }])
    expect(r.content).toEqual([
      { type: 'text', text: '解释这张图' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ])
  })

  it('不是内嵌数据的图片报错，不悄悄丢掉', () => {
    expect(() => toPrompt([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }])).toThrow()
  })

  it('多轮对话写成对话记录，图片标上是第几张', () => {
    const r = toPrompt([
      { role: 'system', content: 'S' },
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: [{ type: 'text', text: '看这张图' }, { type: 'image_url', image_url: { url: PNG } }] }
    ])
    const text = (r.content[0] as { text: string }).text
    expect(text).toContain('[用户]\n第一问\n\n[助手]\n第一答\n\n[用户]\n看这张图\n（附图 1）')
    expect(text).not.toContain('接着做下一步')
    expect(r.content).toHaveLength(2)
  })

  it('带工具：系统提示词里写上工具和约定，工具调用和结果写进对话记录', () => {
    const tools: ToolDef[] = [{ type: 'function', function: { name: 'read_file', description: '读文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }]
    const history: ChatMsg[] = [
      { role: 'system', content: 'S' },
      { role: 'user', content: '读一下 README' },
      { role: 'assistant', content: '我先读。', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '# demo' }
    ]
    const r = toPrompt(history, tools)
    expect(r.system).toContain('- read_file：读文件。参数：{"type":"object"')
    expect(r.system).toContain('```tool')
    const text = (r.content[0] as { text: string }).text
    expect(text).toContain('[助手]\n我先读。\n[助手调用工具 read_file] {"path":"README.md"}\n\n[工具结果 read_file]\n# demo\n\n接着做下一步。')
  })
})

describe('本机 Claude Code：从回答里拆工具调用', () => {
  const tool = (name: string): ToolDef => ({ type: 'function', function: { name, description: '', parameters: {} } })
  const TOOLS = [tool('read_file'), tool('list_files'), tool('write_file')]
  const calls = (text: string): [string, string][] => parseToolCalls(text, TOOLS).toolCalls.map((c) => [c.function.name, c.function.arguments])

  it('没有调用就是普通回答', () => {
    expect(parseToolCalls('做完了，结果在 out.csv。', TOOLS)).toEqual({ content: '做完了，结果在 out.csv。', toolCalls: [] })
  })

  it('一个回答里几次调用，按先后；剩下的话留着', () => {
    const r = parseToolCalls('我先看两个地方。\n\n```tool\n{"name": "read_file", "arguments": {"path": "a.py"}}\n```\n\n```tool\n{"name": "list_files", "arguments": {"path": "data"}}\n```', TOOLS)
    expect(r.content).toBe('我先看两个地方。')
    expect(r.toolCalls.map((c) => [c.function.name, c.function.arguments])).toEqual([
      ['read_file', '{"path":"a.py"}'],
      ['list_files', '{"path":"data"}']
    ])
    expect(new Set(r.toolCalls.map((c) => c.id)).size).toBe(2)
  })

  it('少写了开头那行围栏、写成 json 代码块、什么围栏都没有：都认', () => {
    const want = [['list_files', '{"path":"."}']]
    for (const text of ['{"name": "list_files", "arguments": {"path": "."}}\n```', '```json\n{"name": "list_files", "arguments": {"path": "."}}\n```', '{"name":"list_files","arguments":{"path":"."}}']) {
      expect(calls(text)).toEqual(want)
      expect(parseToolCalls(text, TOOLS).content).toBe('')
    }
  })

  it('参数里有花括号、引号、代码围栏也不会切错', () => {
    const body = { name: 'write_file', arguments: { path: 'a.md', content: '```js\nconst o = {"a": "}"}\n```\n他说："好"' } }
    const r = parseToolCalls('写进去。\n```tool\n' + JSON.stringify(body) + '\n```', TOOLS)
    expect(r.content).toBe('写进去。')
    expect(JSON.parse(r.toolCalls[0].function.arguments)).toEqual(body.arguments)
  })

  it('别的代码块、不是工具名的 JSON 不算调用', () => {
    const text = '这样写：\n```python\nprint(1)\n```\n配置是 {"name": "demo", "version": 1}'
    expect(parseToolCalls(text, TOOLS)).toEqual({ content: text, toolCalls: [] })
  })

  it('tool 代码块里写了不存在的工具：照样交出去，由执行的那头告诉它没有', () => {
    expect(calls('```tool\n{"name": "delete_all", "arguments": {}}\n```')).toEqual([['delete_all', '{}']])
  })

  it('没写参数的当成空参数；写坏的 JSON 报错', () => {
    expect(calls('```tool\n{"name": "list_files"}\n```')).toEqual([['list_files', '{}']])
    expect(() => parseToolCalls('```tool\n{"name": "read_file", "arguments": {path: 1}}\n```', TOOLS)).toThrow()
    expect(() => parseToolCalls('```tool\n{"name": "read_file", "arguments": {"path": "a"\n```', TOOLS)).toThrow()
  })
})
