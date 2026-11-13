import { randomUUID } from 'node:crypto'
import { providerOf } from '../shared/providers'
import { ccStream, ccTools, claudeFound, type CcCall } from './claudeCode'
import { chatOnce, chatStream, chatTools, type ChatMsg, type ToolDef } from './glm'
import type { SettingsStore } from './settings'
import { t } from '../shared/i18n'

export type AiKind = 'text' | 'vision'

export interface AiCall {
  kind?: AiKind
  json?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  thinking?: boolean
  maxTokens?: number
  useId?: string // 会员通道的用量号：同一个号下的请求只算一次
  onReasoning?: (t: string) => void
}

export interface AiConf {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  serial: boolean
  headers: Record<string, string>
}

// 所有 AI 请求的入口：按设置选服务、Key、模型。会员通道（member）的令牌由 memberAuth 给。
// 选的是本机 Claude Code 时不发 HTTP，跑命令行（claudeCode.ts），localDir 是给它当工作目录的空文件夹。
export class Ai {
  constructor(
    private settings: SettingsStore,
    private memberAuth: () => { provider: string; token: string } | null = () => null,
    private localDir = ''
  ) {}

  private local(messages: ChatMsg[], o: AiCall): CcCall | null {
    const c = this.conf(o.kind)
    if (!providerOf(c.provider).local) return null
    return { dir: this.localDir, model: c.model, messages, thinking: o.thinking, timeoutMs: o.timeoutMs, signal: o.signal, onReasoning: o.onReasoning }
  }

  conf(kind: AiKind = 'text'): AiConf {
    const s = this.settings.get()
    const m = this.memberAuth()
    const id = m ? m.provider : s.provider
    const p = providerOf(id)
    const baseUrl = id === 'custom' ? s.customBaseUrl : (p.baseUrl ?? '')
    const model = m ? (kind === 'vision' ? p.vision! : p.text!) : kind === 'vision' ? s.visionModel : s.textModel
    return {
      provider: id,
      apiKey: m ? m.token : this.settings.apiKey(id).key,
      baseUrl,
      model,
      serial: !!p.serial,
      headers: {}
    }
  }

  // 翻译的并发：串行化的账号、本机命令行（一路一个进程）2 路，别家 4 路
  concurrency(): number {
    const c = this.conf()
    return c.serial || providerOf(c.provider).local ? 2 : 4
  }

  private opts(messages: ChatMsg[], o: AiCall) {
    const c = this.conf(o.kind)
    if (!c.baseUrl) throw new Error(t('自定义服务没有填地址：在设置里填写'))
    return {
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      model: c.model,
      serial: c.serial,
      // 会员通道每个请求都要带用量号；同一个号下的请求只算一次（全文翻译整篇共用一个）
      headers: c.provider === 'member' ? { ...c.headers, 'X-Use-Id': o.useId ?? randomUUID() } : c.headers,
      messages,
      jsonMode: o.json,
      timeoutMs: o.timeoutMs,
      signal: o.signal,
      thinking: o.thinking,
      maxTokens: o.maxTokens,
      onReasoning: o.onReasoning
    }
  }

  once(messages: ChatMsg[], o: AiCall = {}): Promise<string> {
    const cc = this.local(messages, o)
    return cc ? ccStream(cc) : chatOnce(this.opts(messages, o))
  }

  stream(messages: ChatMsg[], onDelta: (t: string) => void, o: AiCall = {}): Promise<string> {
    const cc = this.local(messages, o)
    return cc ? ccStream(cc, onDelta) : chatStream(this.opts(messages, o), onDelta)
  }

  tools(messages: ChatMsg[], tools: ToolDef[], o: AiCall = {}) {
    const cc = this.local(messages, o)
    return cc ? ccTools({ ...cc, tools }) : chatTools({ ...this.opts(messages, o), tools })
  }

  // 给 AI 的论文全文最多多少字：按服务的上下文窗口
  ctxChars(): number {
    return providerOf(this.conf().provider).ctx ?? 60000
  }

  ready(): boolean {
    const c = this.conf()
    return providerOf(c.provider).local ? claudeFound() : !!c.apiKey
  }

  model(kind: AiKind = 'text'): string {
    return this.conf(kind).model
  }
}
