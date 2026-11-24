/**
 * 图片说明里的宽度（Obsidian 的写法）：`![我框的|268](…)`、`![图|300x200](…)`。
 * 读 PDF 的笔记把「我框的」写成框在 PDF 上 100% 时的宽（CN-111），文档里显示时照这个宽、说明只露前半。
 */
export interface ImageAlt {
  caption: string
  width?: number
  height?: number
  /** 原样的「|268」「|300x200」，改说明时接回去 */
  size: string
}

export function splitImageAlt(alt: string): ImageAlt {
  const m = /^(.*?)\|(\d{1,5})(?:x(\d{1,5}))?$/.exec(alt)
  if (!m) return { caption: alt, size: '' }
  return { caption: m[1]!, width: Number(m[2]), ...(m[3] ? { height: Number(m[3]) } : {}), size: alt.slice(m[1]!.length) }
}
