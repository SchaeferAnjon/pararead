// 界面语言：九种。表在 src/i18n/<语言>.json，以简体中文原文为键（简体中文不用表），照会议字幕的做法。
// 主进程按设置里的 uiLang（auto 跟系统）定下来；各窗口的 preload 启动时同步问主进程要，所以模块顶层的常量也能用 t()。
// 改了界面语言，各窗口重新加载。给 AI 的提示词不翻译（回答用什么语言由设置里的「回答语言」定）。
import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import fr from '../i18n/fr.json'
import it from '../i18n/it.json'
import ja from '../i18n/ja.json'
import ko from '../i18n/ko.json'
import zhHant from '../i18n/zh-Hant.json'
import { kbd } from './kbd'

export const UI_LANGS = ['zh', 'zh-Hant', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it'] as const
export type UiLang = (typeof UI_LANGS)[number]
// 每种语言写它自己的名字
export const UI_LANG_NAMES: Record<UiLang, string> = { zh: '简体中文', 'zh-Hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano' }
const DICTS: Record<Exclude<UiLang, 'zh'>, Record<string, string>> = { 'zh-Hant': zhHant, en, ja, ko, de, fr, es, it }

let lang: UiLang = 'zh'
let dict: Record<string, string> = {}

/** 系统语言（如 zh-Hans-CN、de-DE）→ 九种之一，别的语言用英语。 */
export function systemUiLang(locale = 'en'): UiLang {
  const l = locale.toLowerCase()
  if (l.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(l) ? 'zh-Hant' : 'zh'
  const base = l.split(/[-_]/)[0] as UiLang
  return UI_LANGS.includes(base) ? base : 'en'
}

export function setUiLang(setting: string, locale?: string): UiLang {
  lang = UI_LANGS.includes(setting as UiLang) ? (setting as UiLang) : systemUiLang(locale)
  dict = lang === 'zh' ? {} : DICTS[lang]
  return lang
}

export const uiLang = (): UiLang => lang
/** 日期、数字按界面语言排 */
export const uiLocale = (): string => ({ zh: 'zh-CN', 'zh-Hant': 'zh-TW' })[lang as 'zh'] ?? lang

const one = (n: unknown): boolean => (lang === 'fr' ? Math.abs(Number(n)) < 2 : Number(n) === 1)

/**
 * t('找到 {0} 篇', n)：查不到就用原文；前后的空白不算在键里，原样带回。
 * 译文里的 {0|paper|papers} 按第 0 个参数选单复数（法语 0 和 1 都用单数）。
 */
export function t(s: string, ...args: unknown[]): string {
  let out = s
  if (lang !== 'zh') {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!
    const hit = dict[m[2]]
    if (hit !== undefined) out = m[1] + hit + m[3]
  }
  if (!args.length) return kbd(out)
  out = out.replace(/\{(\d+)\|([^|}]*)\|([^}]*)\}/g, (_, i: string, a: string, b: string) => (one(args[Number(i)]) ? a : b))
  for (let i = 0; i < args.length; i++) out = out.split(`{${i}}`).join(String(args[i]))
  return kbd(out)
}

// 窗口里：preload 已经把主进程定下来的语言放在 window.__uiLang
declare const window: { __uiLang?: string } | undefined
if (typeof window !== 'undefined' && window.__uiLang) setUiLang(window.__uiLang)
