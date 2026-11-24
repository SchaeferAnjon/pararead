// 不用 React 的地方（网页里的预加载、主进程画的占位图）要一段 Codicon 的 SVG 字符串
import { CODICONS, type CodiconName } from './codicons.gen'

/** 一个 Codicon 的 <svg>：默认填色跟着字的颜色，size 写成宽高（不写就由样式定） */
export function codiconSvg(name: CodiconName, opts: { size?: number; color?: string } = {}): string {
  const [vb, inner] = CODICONS[name]
  const wh = opts.size ? ` width="${opts.size}" height="${opts.size}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${wh} fill="${opts.color ?? 'currentColor'}">${inner}</svg>`
}
