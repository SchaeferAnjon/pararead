/**
 * 各家 AI 自己的标志（偏好「Agent 用自己的图标」，DESIGN.v3 2.1）：引擎菜单、回答头上那一行、输入框底行谁来答都用它。
 * 画布笔记那十家（EngineId）和翻译多出来的智谱自带标志；没有现成标志的 OpenCode 画终端、本机模型（Ollama、LM Studio）画芯片（图标走宿主）；
 * 宿主自己多出来的那一家（ParaRead）由 UiHost.engineLogo 画。
 * 「各功能现在用哪家」那一摊（AiIcon、右下角圆钮）在宿主那边（画布笔记 renderer/engine-logo.tsx）。
 */
import { engineOfLabel } from '@cn/ai-engines/shared'
import claudeSvg from './assets/engine-logos/claude.svg?raw'
import codexSvg from './assets/engine-logos/codex.svg?raw'
import deepseekSvg from './assets/engine-logos/deepseek.svg?raw'
import geminiPng from './assets/engine-logos/gemini.png'
import openrouterSvg from './assets/engine-logos/openrouter.svg?raw'
import zhipuSvg from './assets/engine-logos/zhipu.svg?raw'
import { useUi } from './context'
import type { IconName } from './host'

/** 带 SVG 标志的那几家（Claude API 画 Claude 的标志，OpenAI API 画 OpenAI 的，和 Codex 同一个，task-587os）：宿主画系统菜单、文档里的图标也用这一份 */
export const LOGO_SVG: Readonly<Record<string, string>> = { claude: claudeSvg, anthropic: claudeSvg, codex: codexSvg, openai: codexSvg, deepseek: deepseekSvg, openrouter: openrouterSvg, zhipu: zhipuSvg }
/** Gemini 的标志是一张 PNG */
export const GEMINI_PNG: string = geminiPng

/** 自带画法的那几家：有 SVG 的、Gemini、画图标的三家 */
const OWN = new Set([...Object.keys(LOGO_SVG), 'gemini', 'opencode', 'ollama', 'lmstudio'])

/** 没有现成标志的：本机模型画芯片，别的（OpenCode）画终端 */
export const logoIcon = (id: string): IconName => (id === 'ollama' || id === 'lmstudio' ? 'chip' : 'terminal')

export function EngineLogo({ id, size = 14, className }: { id: string; size?: number; className?: string }) {
  const ui = useUi()
  const svg = LOGO_SVG[id]
  const cls = 'eng-logo' + (className ? ' ' + className : '')
  if (svg) return <span className={cls} data-engine={id} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  if (id === 'gemini') return <img className={cls} data-engine={id} src={geminiPng} width={size} height={size} alt="" />
  const own = !OWN.has(id) ? ui.engineLogo?.(id, size) : undefined
  return (
    <span className={cls} data-engine={id} style={{ width: size, height: size, display: 'inline-grid' }} aria-hidden="true">
      {own ?? ui.icon(logoIcon(id), { size })}
    </span>
  )
}

/** 「Claude Code · Opus 5.5」前面那一家的标志 12（AI 回答头上那一行，偏好「Agent 用自己的图标」）；认不出是哪家不画 */
export function ByLogo({ by }: { by: string }) {
  const id = engineOfLabel(by)
  return id ? <EngineLogo id={id} size={12} className="by-logo" /> : null
}
