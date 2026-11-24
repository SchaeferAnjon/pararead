// 图标：全软件一律用 Codicons（VS Code 的图标库，2026-11-16 用户定 `图标用 Codicons`）
import { CODICONS, type CodiconName } from './codicons.gen'

export type { CodiconName }

/** 这个名字在常用的那套里（不在的要从整套 @cn/design/codicons-all 里拿） */
export const hasCodicon = (name: string): name is CodiconName => Object.hasOwn(CODICONS, name)

/** 同一个图标的 DOM 版（编辑器里的小部件不走 React） */
export function codiconEl(name: CodiconName, size = 16, className?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'ci' + (className ? ' ' + className : ''))
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', CODICONS[name][0])
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = CODICONS[name][1]
  return svg
}

/** Codicons：填色跟着字的颜色。名字在 scripts/codicons.mjs 的 USED 里，加了要重新生成 codicons.gen.ts */
export function Codicon({ name, size = 16, className, title }: { name: CodiconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={'ci' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox={CODICONS[name][0]}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: CODICONS[name][1] }}
    />
  )
}
