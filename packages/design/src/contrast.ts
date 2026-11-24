/**
 * 量界面上非文字元素（勾选框的边）对它挨着的底色的对比度（task-gr4sx）：画布笔记、画布今日的 e2e 共用。
 * 颜色是 getComputedStyle 给的（rgb() / rgba() / color(srgb …)），底色是真截出来的像素（半透明面板透出的背景图各处不一样）；
 * 半透明的边按浏览器的做法在 sRGB 里叠到底色上再算。只用在测试里，不进软件。
 */
export type Rgba = [number, number, number, number]
export type Rgb = [number, number, number]

/** getComputedStyle 的颜色 → 0–255 的 rgba */
export function parseColor(s: string): Rgba {
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s.trim())
  if (rgb) {
    const p = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
    return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]
  }
  const srgb = /^color\(srgb ([^)]+)\)$/.exec(s.trim())
  if (srgb) {
    const p = srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number)
    return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p[3] ?? 1]
  }
  throw new Error(`认不出的颜色：${s}`)
}

export function over(fg: Rgba, bg: Rgb): Rgb {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
}

function lum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** 边叠在框里、框外两处底色上，取差的那一处 */
export function edgeContrast(border: string, inside: Rgb, outside: Rgb): number {
  const c = parseColor(border)
  return Math.min(contrast(over(c, inside), inside), contrast(over(c, outside), outside))
}
