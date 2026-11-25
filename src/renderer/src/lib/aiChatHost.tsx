// ParaRead 交给 @cn/ai-chat 的宿主（2026-11-23 起 AI 问答照画布笔记，组件和画布笔记读 PDF 的对话同一套）：
// 文案走 ParaRead 的九种语言 t()（组件里写 {name}，这里按名字填）；图标照 ICON_NAMES 对到 lucide；样子用 ParaRead 自己的 tokens.css；
// 引擎、全能开关、贴图、拷贝走 window.api。贴的图存在主进程的数据目录 pasted/ 里，界面上按名字记一份 data URL（没有自定义协议）。
import { renderToStaticMarkup } from 'react-dom/server'
import { ArrowDown, ArrowLeftRight, ArrowUp, Bookmark, Check, ChevronDown, ChevronRight, CircleAlert, CircleHelp, Copy, Cpu, Ellipsis, FileCode, FileDown, FileText, FileType, GitCompare, Globe, Image as ImageIcon, LayoutDashboard, LoaderCircle, MessageSquare, MessagesSquare, Pencil, Play, Plus, Quote, RefreshCw, Reply, Settings, Sparkles, Square, SquareTerminal, StickyNote, Trash2, Undo2, X, type LucideIcon } from 'lucide-react'
import { setAiChatHost } from '@cn/ai-chat/context'
import type { AiErrorView, ChatHost, UiHost } from '@cn/ai-chat/host'
import { splitFollowups } from '@shared/followups'
import { t } from '@shared/i18n'
import { kbd } from '@shared/kbd'
import { api } from '../api'
import { logoOf } from '../components/SettingsPage'
import { Markdown } from './Markdown'

/** 共用组件用到的图标名（Codicons 的叫法，@cn/ai-chat 的 ICON_NAMES）和回答下面那排交进去的几个 → lucide */
const ICONS: Record<string, LucideIcon> = {
  add: Plus,
  'arrow-down': ArrowDown,
  'arrow-swap': ArrowLeftRight,
  'file-media': ImageIcon,
  'arrow-up': ArrowUp,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  chip: Cpu,
  close: X,
  comment: MessageSquare,
  'comment-discussion': MessagesSquare,
  copy: Copy,
  discard: Undo2,
  edit: Pencil,
  ellipsis: Ellipsis,
  error: CircleAlert,
  'git-compare': GitCompare,
  // @ 点名的文档（胶囊、候选）：文档、白板、PDF、网页、HTML
  'file-text': FileText,
  layout: LayoutDashboard,
  'file-pdf': FileType,
  globe: Globe,
  'file-code': FileCode,
  loading: LoaderCircle,
  note: StickyNote,
  play: Play,
  question: CircleHelp,
  'primitive-square': Square,
  quote: Quote,
  refresh: RefreshCw,
  reply: Reply,
  settings: Settings,
  'settings-gear': Settings,
  terminal: SquareTerminal,
  // 回答下面那排（ParaRead 交的）
  bookmark: Bookmark,
  'file-down': FileDown,
  trash: Trash2
}

/** 'ai'：AI 问答现在用的那一家；ParaRead 自己那家（设置里的服务商）画服务商的标志，会员画闪光 */
let ownLogo: { icon?: string; member: boolean } = { member: false }
export function setOwnLogo(o: { icon?: string; member: boolean }): void {
  ownLogo = o
}

function OwnLogo({ size }: { size: number }) {
  const src = ownLogo.member ? null : logoOf(ownLogo.icon)
  return src ? <img src={src} alt="" width={size} height={size} style={{ borderRadius: 3, flex: 'none' }} /> : <Sparkles size={size} />
}

const icon: UiHost['icon'] = (name, o = {}) => {
  const size = o.size ?? 16
  if (name === 'ai') return <Sparkles size={size} className={o.className} />
  const I = ICONS[name]
  // 画布笔记的 .spin 是让图标转；ParaRead 的 .spin 是一个转圈的小圆，换成 .spin-icon
  const cls = [...(o.className ?? '').split(/\s+/).filter((c) => c && c !== 'spin'), ...(name === 'loading' || /\bspin\b/.test(o.className ?? '') ? ['spin-icon'] : [])].join(' ')
  return I ? <I size={size} {...(cls ? { className: cls } : {})} /> : null
}

const ui: UiHost = {
  t: (key, p) => {
    const out = t(key)
    return p ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : out
  },
  icon,
  iconEl: (name, size) => {
    const box = document.createElement('span')
    box.innerHTML = renderToStaticMarkup(<>{icon(name, { size })}</>)
    return box.firstElementChild ?? box
  },
  // ParaRead 的键：⌘L 把选中的字带进输入框，⌘↵ 选着时也是引用
  isKey: (e, id) => (id === 'quote' ? (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l' : (e.metaKey || e.ctrlKey) && e.key === 'Enter'),
  keyLabel: (id) => kbd(id === 'quote' ? '⌘L' : '⌘↵'),
  engineLogo: (id, size) => (id === 'pararead' ? <OwnLogo size={size} /> : <SquareTerminal size={size} />)
}

/** 贴的图：名字 → data URL（贴的那一下就有；以前存的打开对话时取） */
const pasted = new Map<string, string>()
const pastedSubs = new Set<() => void>()
export function onPastedLoaded(f: () => void): () => void {
  pastedSubs.add(f)
  return () => void pastedSubs.delete(f)
}
/** 对话里用到的这几张：还没有的去主进程取，取到了叫一声重画 */
export function loadPasted(names: readonly string[]): void {
  const want = names.filter((n) => !pasted.has(n))
  if (!want.length) return
  for (const n of want) pasted.set(n, '')
  void Promise.all(want.map((n) => api.chatPasted(n).then((u) => pasted.set(n, u), () => pasted.delete(n)))).then(() => pastedSubs.forEach((f) => f()))
}

const toDataUrl = (bytes: Uint8Array, mime: string): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(s)}`
}

/** AI 没答出来：一句话说明原因（ParaRead 的出错原话本来就是人话），能重试、能换一家 */
function errorView(raw: string): AiErrorView {
  const line = raw.trim().split('\n')[0] ?? ''
  return { code: 'other', title: line || t('没有回答'), acts: ['retry', 'switch'], raw: raw.includes('\n') ? raw : null }
}

const chat: ChatHost = {
  aiEngines: () => api.chatEngines().then((r) => ({ engines: r.list, chat: r.pick, omni: r.omni, none: false, intro: { ai: true } })),
  onAiPrefsChanged: (cb) => api.onChatEnginesChanged(cb),
  aiSetEngine: (id) => api.chatSetPick({ engine: id }),
  aiSetOmni: (on) => api.chatSetOmni(on),
  aiPaste: async (bytes, mime) => {
    const name = await api.chatPaste(bytes, mime)
    pasted.set(name, toDataUrl(bytes, mime))
    return name
  },
  aiPickImages: async (room) => {
    const got = await api.chatPickImages(room)
    loadPasted(got.map((g) => g.name))
    return got
  },
  pastedUrl: (name) => pasted.get(name) ?? '',
  renderMarkdown: (text) => <Markdown text={splitFollowups(text).body} className="md" />,
  plainAnswer: (text) => splitFollowups(text).body,
  copy: (text) => navigator.clipboard.writeText(text),
  openAiSettings: () => void api.openSettings('ai'),
  aiErrorView: (raw) => errorView(raw)
}

setAiChatHost(ui, chat)

