/**
 * 面板透明度（设置 › 外观，task-jgely，用户「你可以在设置里面加一个透明度调整的选项」「默认的话就是我给你发的这个文档中的样子」）：
 * 有窗口背景时几块半透明面板（themes.css 的 --isle*）透多少。滑杆上的数就是存的数，和滑块位置一样：0 最实（面板完全不透）、100 最透，
 * 中间 50 是每套主题的默认（用户认可的那版：浅色透 20%、深色透 18%）。0 到 50 不透明度匀着降到默认，50 到 100 再匀着降 16 个百分点
 * （浅色 64%、深色 66%，深湖 72%、松林 77%，十套主题 × 极光 / 冰洞 / 主题渐变量过正文 ≥ 7、次要字 ≥ 4.5，e2e/jgely-contrast.spec.ts）。画布笔记、画布今日共用。
 *
 * 2026-11-24 改（bug 一组，用户「当我选到最透的时候 反而越来越实了」）：以前存的是在主题默认上再透几个百分点（-16…12，键名 glass），
 * 往透那边同时把透上来的背景每格提亮 4%（浅色主题），浅色渐变背景亮处被提成一片白，面板反倒更像实底；滑杆中间写 23%、最右只到 32%，和位置对不上。
 * 现在浅色主题只把暗处往白托、白的不再变白（themes.css --isle-tone）；老的 glass 读进来按浅色主题的不透明度换成新数（glassFromOld）。
 */
export const GLASS_MIN = 0
export const GLASS_MAX = 100
export const GLASS_DEFAULT = 50

/** 读进来的值：不是数就看老键 glass（-16…12）换过来，都没有用默认；超出范围的收到两头，取整 */
export function normalizeGlass(v: unknown, old?: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(GLASS_MAX, Math.max(GLASS_MIN, Math.round(v)))
  if (typeof old === 'number' && Number.isFinite(old)) return glassFromOld(old)
  return GLASS_DEFAULT
}

/** 老的「在默认上再透几个百分点」（-16…12）换成新数：照浅色主题（默认不透明 80%）对上同样的不透明度，0 → 50、-16 → 10、8 → 75、12 → 88 */
export function glassFromOld(old: number): number {
  const o = Math.min(12, Math.max(-16, Math.round(old)))
  return o <= 0 ? Math.round(((20 + o) * GLASS_DEFAULT) / 20) : Math.round(GLASS_DEFAULT + (o * (GLASS_MAX - GLASS_DEFAULT)) / 16)
}

/**
 * 套到窗口上：<html style="--isle-p: v; --isle-n: …">。--isle-p 给 themes.css 算不透明度；
 * --isle-n 是往透那边走了多少（50 → 0、100 → 12，往实那边是负的），次要字往正文色靠、勾选框边加深、饱和度减一点都跟它走
 */
export function applyGlass(v: number, el: HTMLElement = document.documentElement) {
  if (v === GLASS_DEFAULT) {
    el.style.removeProperty('--isle-p')
    el.style.removeProperty('--isle-n')
  } else {
    el.style.setProperty('--isle-p', String(v))
    el.style.setProperty('--isle-n', String(((v - GLASS_DEFAULT) * 12) / (GLASS_MAX - GLASS_DEFAULT)))
  }
}
