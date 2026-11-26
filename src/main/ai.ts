import { randomUUID } from 'node:crypto'
import { providerOf } from '../shared/providers'
import { ccStream, ccTools, claudeFound, findClaude, type CcCall } from './claudeCode'
import { chatOnce, chatStream, chatTools, type ChatMsg, type ToolDef } from './glm'
import type { SettingsStore } from './settings'
import { t } from '../shared/i18n'
import { levelName, type ThinkLevel } from '../shared/thinking'

/** 翻译用本机 Claude Code 时能选的模型（别的值当 haiku） */
const ccModel = (m: string | undefined): string => (['haiku', 'sonnet', 'opus'].includes(m ?? '') ? m! : providerOf('claude-code').text!)
const ccModelName = (m: string): string => m[0].toUpperCase() + m.slice(1)

export type AiKind = 'text' | 'vision'

export interface AiCall {
  kind?: AiKind
  json?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  think?: ThinkLevel // 思考强度；不给是最省的一档
  maxTokens?: number
  useId?: string // 会员通道的用量号：同一个号下的请求只算一次
  noRetry?: boolean // 限流不在这里等（保版面翻译在 trProxy 里按错的种类自己重试）
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
    private localDir = '',
    private memberToken: () => string | null = () => null
  ) {}

  /**
   * 翻译、意群这类批量小请求用哪家（设置 › 翻译 › 翻译用，trService）。2026-11-23 定：默认走会员或 DeepSeek，不占 Claude 订阅；
   * 能改成本机 Claude Code，或跟「AI 服务」一样。空是自动：会员 → DeepSeek（有 Key）→「AI 服务」里选的（不是本机命令行时）。
   */
  trConf(): AiConf {
    const s = this.settings.get()
    const want = s.trService
    const tok = this.memberToken()
    const deep = this.settings.apiKey('deepseek').key
    const dsModel = s.provider === 'deepseek' ? s.textModel : providerOf('deepseek').text!
    if (want === 'member' || (!want && tok)) {
      if (!tok) throw new Error(t('翻译用 ParaRead 会员，但还没登录会员：设置 › 会员'))
      const p = providerOf('member')
      return { provider: 'member', apiKey: tok, baseUrl: p.baseUrl!, model: p.text!, serial: false, headers: {} }
    }
    if (want === 'deepseek' || (!want && deep)) {
      if (!deep) throw new Error(t('翻译用 DeepSeek，但没填 DeepSeek 的 Key：设置 › AI 服务'))
      return { provider: 'deepseek', apiKey: deep, baseUrl: providerOf('deepseek').baseUrl!, model: dsModel, serial: false, headers: {} }
    }
    if (want === 'claude-code') return { provider: 'claude-code', apiKey: '', baseUrl: '', model: ccModel(s.trCcModel), serial: false, headers: {} }
    const c = this.conf()
    if (!want && providerOf(c.provider).local) throw new Error(t('翻译要会员或 DeepSeek 的 Key；想用本机 Claude Code 翻，在设置 › 翻译里选'))
    return c
  }

  /** 翻译用的那一家能不能用（界面上提示去设置） */
  trReady(): string | null {
    try {
      const c = this.trConf()
      if (providerOf(c.provider).local) return claudeFound() ? null : t('没找到本机的 claude 命令')
      return c.apiKey ? null : t('翻译用的服务没填 Key：设置 › AI 服务')
    } catch (e) {
      return (e as Error).message
    }
  }

  /** 批量翻译、意群走这里（trConf 选的那一家） */
  trOnce(messages: ChatMsg[], o: AiCall = {}): Promise<string> {
    const c = this.trConf()
    if (providerOf(c.provider).local) return ccStream({ dir: this.localDir, model: c.model, messages, think: o.think ?? this.settings.get().trCcEffort, timeoutMs: o.timeoutMs, signal: o.signal })
    if (!c.baseUrl) throw new Error(t('自定义服务没有填地址：在设置里填写'))
    return chatOnce({
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      model: c.model,
      serial: c.serial,
      headers: c.provider === 'member' ? { 'X-Use-Id': o.useId ?? randomUUID() } : c.headers,
      messages,
      jsonMode: o.json,
      timeoutMs: o.timeoutMs,
      signal: o.signal,
      maxTokens: o.maxTokens,
      ...(o.noRetry ? { retryDelays: [] } : {})
    })
  }

  /** 批量翻译的并发：串行化的账号、本机命令行 2 路，别家 4 路 */
  trConcurrency(): number {
    try {
      const c = this.trConf()
      return c.serial || providerOf(c.provider).local ? 2 : 4
    } catch {
      return 2
    }
  }

  /**
   * 保版面翻译（BabelDOC 的 --qps，它同时也是同一时间发几个请求）：DeepSeek 等 API 16 路（2026-11-25 实测一个请求约 1 秒，
   * 4 路时一批 12 页、92 个请求光排队就要 26 秒）；会员服务器 8 路；本机 Claude Code 一路一个进程，4 路；串行化的账号 2 路。
   * 限流了 trProxy 会退避重试，不会因为路数多就丢段。
   */
  trQps(): number {
    try {
      const c = this.trConf()
      if (c.serial) return 2
      if (providerOf(c.provider).local) return 4
      return c.provider === 'member' ? 8 : 16
    } catch {
      return 2
    }
  }

  /** 翻译用本机 Claude Code 时先找到 claude 命令（刚在设置里换过来时还没找完，trReady 会误报没找到） */
  async trWarm(): Promise<void> {
    if (this.trLocal()) await findClaude()
  }

  /** 翻译用的是本机命令行（一次请求起一个进程，要等得久一点） */
  trLocal(): boolean {
    try {
      return !!providerOf(this.trConf().provider).local
    } catch {
      return false
    }
  }

  /** 翻译用的是哪家（设置页、标题栏菜单上写） */
  trName(): string {
    try {
      const c = this.trConf()
      if (c.provider !== 'claude-code') return providerOf(c.provider).name
      return `${providerOf(c.provider).name} · ${ccModelName(c.model)} · ${levelName(this.settings.get().trCcEffort)}`
    } catch {
      return ''
    }
  }

  private local(messages: ChatMsg[], o: AiCall): CcCall | null {
    const c = this.conf(o.kind)
    if (!providerOf(c.provider).local) return null
    return { dir: this.localDir, model: c.model, messages, think: o.think, timeoutMs: o.timeoutMs, signal: o.signal, onReasoning: o.onReasoning }
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
      think: o.think,
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
