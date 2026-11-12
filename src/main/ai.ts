import { randomUUID } from 'node:crypto'
import { providerOf } from '../shared/providers'
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
export class Ai {
  constructor(
    private settings: SettingsStore,
    private memberAuth: () => { provider: string; token: string } | null = () => null
  ) {}

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

  // 翻译的并发：串行化的账号 2 路，别家 4 路
  concurrency(): number {
    return this.conf().serial ? 2 : 4
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
    return chatOnce(this.opts(messages, o))
  }

  stream(messages: ChatMsg[], onDelta: (t: string) => void, o: AiCall = {}): Promise<string> {
    return chatStream(this.opts(messages, o), onDelta)
  }

  tools(messages: ChatMsg[], tools: ToolDef[], o: AiCall = {}) {
    return chatTools({ ...this.opts(messages, o), tools })
  }

  // 给 AI 的论文全文最多多少字：按服务的上下文窗口
  ctxChars(): number {
    return providerOf(this.conf().provider).ctx ?? 60000
  }

  ready(): boolean {
    return !!this.conf().apiKey
  }

  model(kind: AiKind = 'text'): string {
    return this.conf(kind).model
  }
}
