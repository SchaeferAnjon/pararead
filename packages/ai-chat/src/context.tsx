/**
 * 宿主交进来的那一份放在哪：一个模块里的变量 + 订阅。宿主启动时（第一次画之前）setAiChatHost 一次，界面语言换了再交一次，用到的组件跟着重画。
 * 不只用 React context：画布笔记的编辑器部件（文档里的旁支、预览卡）各自 createRoot 另起一棵树，context 传不进去。
 * AiChatProvider 留着给一个窗口里要两种宿主的（测试、ParaRead 的某一格换一套图标）：它里面的组件优先用它给的。
 */
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react'
import type { ChatHost, IconName, Params, UiHost } from './host'

const fill = (key: string, p?: Params) => (p ? key.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : key)

/** 没交之前（单元测试）：中文原句、没有图标、没有快捷键 */
const BARE_UI: UiHost = { t: fill, icon: () => null, iconEl: () => document.createElement('span'), isKey: () => false, keyLabel: () => null }

let ui: UiHost = BARE_UI
let chat: ChatHost | null = null
const subs = new Set<() => void>()

/** 宿主交一份（启动时、换了界面语言时） */
export function setAiChatHost(u: UiHost, c?: ChatHost) {
  ui = u
  if (c) chat = c
  for (const f of [...subs]) f()
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))

const Ctx = createContext<{ ui?: UiHost; chat?: ChatHost } | null>(null)

/** 这一块里的组件用另一份宿主 */
export function AiChatProvider(p: { ui?: UiHost; chat?: ChatHost; children: ReactNode }) {
  return <Ctx.Provider value={{ ...(p.ui ? { ui: p.ui } : {}), ...(p.chat ? { chat: p.chat } : {}) }}>{p.children}</Ctx.Provider>
}

/** 组件里取文案、图标、快捷键；宿主换了一份（换语言）这个组件重画 */
export function useUi(): UiHost {
  const g = useSyncExternalStore(subscribe, () => ui, () => ui)
  return useContext(Ctx)?.ui ?? g
}

/** 组件里取对话的宿主 */
export function useChat(): ChatHost {
  const g = useSyncExternalStore(subscribe, () => chat, () => chat)
  const c = useContext(Ctx)?.chat ?? g
  if (!c) throw new Error('@cn/ai-chat：宿主还没交 ChatHost（setAiChatHost）') // 不翻：只给开发者看
  return c
}

/** 不在组件里（DOM 小工具、事件回调）：这会儿的那一份 */
export const uiNow = (): UiHost => ui

/** 组件里画一个图标的简写 */
export function Icon(p: { name: IconName | (string & {}); size?: number; className?: string }) {
  const u = useUi()
  return <>{u.icon(p.name, { ...(p.size ? { size: p.size } : {}), ...(p.className ? { className: p.className } : {}) })}</>
}
