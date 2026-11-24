/**
 * 共用包里的界面字：中文原句当键，{name} 放变量，由宿主交翻译（画布笔记、画布今日中英两种，ParaRead 九种）。
 * 宿主启动时 setI18n 一次；没交的时候（单元测试）照中文原句填变量。
 */
/** 和画布笔记的 Params 一样：null、undefined 的占位原样留着；ctx 是「用在哪」，不填进句子 */
export type Params = { ctx?: string } & Record<string, string | number | boolean | null | undefined>

export interface I18n {
  t(key: string, p?: Params): string
  /** 列举：中文「A、B、C」，英文「A, B, and C」 */
  list(items: readonly string[]): string
}

const fill = (key: string, p?: Params): string =>
  p ? key.replace(/\{(\w+)\}/g, (m, k: string) => (p[k] === undefined || p[k] === null || k === 'ctx' ? m : String(p[k]))) : key

let impl: I18n = { t: fill, list: (items) => items.join('、') }

export function setI18n(i: I18n) {
  impl = i
}

export const t = (key: string, p?: Params): string => impl.t(key, p)
export const list = (items: readonly string[]): string => impl.list(items)
