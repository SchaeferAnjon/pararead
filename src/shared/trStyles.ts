// 对照模式的译文样式（2026-11-15 用户挑了方向 A：照沉浸式翻译的那一组，加上原来的「浅底色」）。
// 线、框、底用 --tr-mark（译文记号色）。意群用下划线显示时，画在字底下的四种（三种下划线、马克笔）让位不画，
// 免得中文底下两条线；选中的样式不丢，意群关掉或换成文字着色就回来。
import { t } from './i18n'

export type TrStyle = 'text' | 'fill' | 'dash' | 'solid' | 'dot' | 'line' | 'dbox' | 'box' | 'hl' | 'marker' | 'blur' | 'fade'
export type SenseStyle = 'text' | 'underline'

export const TR_STYLES: TrStyle[] = ['text', 'fill', 'dash', 'solid', 'dot', 'line', 'dbox', 'box', 'hl', 'marker', 'blur', 'fade']
// 画在字底下的：意群下划线开着时不画
export const UNDER_STYLES: ReadonlySet<TrStyle> = new Set(['dash', 'solid', 'dot', 'marker'])
// 学习用的：鼠标移到那一段上才看清
export const STUDY_STYLES: ReadonlySet<TrStyle> = new Set(['blur', 'fade'])

export const isTrStyle = (v: unknown): v is TrStyle => TR_STYLES.includes(v as TrStyle)

// 和意群下划线撞了：这一种先不画
export const trStyleYields = (style: TrStyle, senseOn: boolean, sense: SenseStyle): boolean => senseOn && sense === 'underline' && UNDER_STYLES.has(style)

// 正文实际画哪一种
export const shownTrStyle = (style: TrStyle, senseOn: boolean, sense: SenseStyle): TrStyle => (trStyleYields(style, senseOn, sense) ? 'text' : style)

export function trStyleName(s: TrStyle): string {
  return {
    text: t('浅色字'),
    fill: t('浅底色'),
    dash: t('虚线下划线'),
    solid: t('直线下划线'),
    dot: t('点状下划线'),
    line: t('分割线'),
    dbox: t('虚线边框'),
    box: t('实线边框'),
    hl: t('高亮'),
    marker: t('马克笔'),
    blur: t('模糊'),
    fade: t('透明')
  }[s]
}
