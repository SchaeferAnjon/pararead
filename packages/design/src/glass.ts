/**
 * 面板透明度（设置 › 外观，task-jgely，用户「你可以在设置里面加一个透明度调整的选项」「默认的话就是我给你发的这个文档中的样子」）：
 * 有窗口背景时几块半透明面板（themes.css 的 --isle*）在每套主题默认透明度上再透一点或实一点，单位是百分点，正数更透。
 * 0 是用户认可的那版（浅色主题透 20%、深色透 18%）。往实最多 16（浅色 96% 不透明、深色 98%），往透最多 12（浅色透 32%、深色 30%）；
 * 往透那边 themes.css 同时压照片亮度、次要字往正文色靠，两头和默认在十套主题 × 两张自带照片里正文 ≥ 7、次要字 ≥ 4.5
 * （e2e/jgely-contrast.spec.ts 量），拉到哪都看得清。画布笔记、画布今日共用。
 */
export const GLASS_MIN = -16
export const GLASS_MAX = 12
export const GLASS_DEFAULT = 0

/** 读进来的值：不是数就用默认，超出范围的收到两头，取整 */
export function normalizeGlass(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : GLASS_DEFAULT
  return Math.min(GLASS_MAX, Math.max(GLASS_MIN, n))
}

/** 套到窗口上：<html style="--isle-shift: v%; --isle-n: v">（百分比给 color-mix，纯数给 brightness） */
export function applyGlass(v: number, el: HTMLElement = document.documentElement) {
  if (v === GLASS_DEFAULT) {
    el.style.removeProperty('--isle-shift')
    el.style.removeProperty('--isle-n')
  } else {
    el.style.setProperty('--isle-shift', `${v}%`)
    el.style.setProperty('--isle-n', String(v))
  }
}

/** 透明度 v 时面板透多少（百分数，给人看）：现在这套主题的默认（themes.css 的 --isle-k，浅色 80%、深色 82%，导入的主题没写是 82%）再加 v */
export function glassPct(v: number, el: HTMLElement = document.documentElement): number {
  const k = parseFloat(getComputedStyle(el).getPropertyValue('--isle-k')) || 82
  return Math.round(100 - k + v)
}
