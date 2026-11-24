/**
 * 文档里「回到 AI 对话」那条链接（canvas-notes://chat?key=…&msg=…，写法和认法在 @cn/format 的 chatLink / parseChatLink）点了以后：
 * AI 格换到那段对话（AiDock：不是这里的就当「看别处的对话」打开），AiPanel 滚到那条回答、闪一下。
 * 放在模块里：App 开 AI 标签、AiDock 换对话、AiPanel 滚动是三处，不一层层传 props。
 */
import { useSyncExternalStore } from 'react'

let want: { key: string; msg: number; seq: number } | null = null
let seq = 0
const subs = new Set<() => void>()

export function jumpToChat(key: string, msg: number) {
  want = { key, msg, seq: ++seq }
  for (const s of subs) s()
}

/** 还没滚到的那一次（滚到了 done 清掉） */
export function useChatJump() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => want,
  )
}

export function jumpDone(s: number) {
  if (want?.seq !== s) return
  want = null
  for (const f of subs) f()
}
