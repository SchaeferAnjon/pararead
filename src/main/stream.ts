import type { WebContents } from 'electron'
import type { StreamEvent } from '../shared/types'
import type { Ai, AiKind } from './ai'
import { putAiCache, type DB } from './db'
import type { ChatMsg } from './glm'

export interface StreamOpts {
  kind?: AiKind
  cacheKey?: string | null
  thinking?: boolean
  useId?: string
  maxTokens?: number
  onFinish?: (full: string, info: { reasoning: string; thinkMs: number | null }) => void
}

// 流式请求：增量和思考内容按 reqId 发给界面（ai:stream），能中途停；结束后可缓存
export function makeStreamer(ai: Ai, db: DB, log: (m: string) => void) {
  const aborts = new Map<string, AbortController>()
  const streamTo = (wc: WebContents, reqId: string, messages: ChatMsg[], o: StreamOpts = {}): void => {
    const ctl = new AbortController()
    aborts.set(reqId, ctl)
    const send = (e: StreamEvent): void => {
      if (!wc.isDestroyed()) wc.send('ai:stream', e)
    }
    let reasoning = ''
    const t0 = Date.now()
    let thinkEnd: number | null = null
    ai.stream(
      messages,
      (delta) => {
        if (reasoning && thinkEnd === null) thinkEnd = Date.now()
        send({ reqId, delta })
      },
      {
        kind: o.kind ?? 'text',
        signal: ctl.signal,
        thinking: o.thinking,
        useId: o.useId,
        maxTokens: o.maxTokens,
        // 关着深度思考时不给界面看思考：GLM-5.3、Gemini 3 关不掉，只是压到最浅
        onReasoning: (r) => {
          if (!o.thinking) return
          reasoning += r
          send({ reqId, reasoning: r })
        }
      }
    )
      .then((full) => {
        if (o.cacheKey && full) putAiCache(db, o.cacheKey, full)
        o.onFinish?.(full, { reasoning, thinkMs: reasoning ? (thinkEnd ?? Date.now()) - t0 : null })
        send({ reqId, done: true })
      })
      .catch((e: Error) => {
        log(`AI 请求失败 ${reqId}：${e.message}`)
        send({ reqId, error: e.message })
      })
      .finally(() => aborts.delete(reqId))
  }
  const sendCached = (wc: WebContents, reqId: string, text: string): void => {
    setTimeout(() => {
      if (wc.isDestroyed()) return
      wc.send('ai:stream', { reqId, delta: text })
      wc.send('ai:stream', { reqId, done: true })
    }, 0)
  }
  return { streamTo, sendCached, aborts }
}

export type Streamer = ReturnType<typeof makeStreamer>
