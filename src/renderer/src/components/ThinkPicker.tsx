import { ChevronDown } from 'lucide-react'
import { levelHint, levelName, thinkKey, thinkLevel, thinkSpec, type ThinkLevel, type ThinkSpec } from '@shared/thinking'
import { t } from '@shared/i18n'
import type { SettingsView } from '@shared/types'
import { api } from '../api'
import { showMenu, type MenuEntry } from '../lib/menu'

// 思考强度（2026-11-15 用户挑了方向 A）：问答输入框里「思考 · 中」，点开是这个模型能选的全部档、每档一句说明；
// 设置 › AI 服务 › 回答 里同一个菜单，两边是同一个值，每个模型记一份。

// 格子图：一格一档（不算「关」），亮到第几格就是第几档；总会先想的模型三格都是半亮
export function Meter(props: { spec: ThinkSpec; level: ThinkLevel | null }) {
  if (props.spec.kind === 'always')
    return (
      <span className="meter always" aria-hidden>
        {[5, 8, 11].map((h) => (
          <i key={h} style={{ height: h }} />
        ))}
      </span>
    )
  const steps: ThinkLevel[] = props.spec.levels.filter((l) => l !== 'off')
  const k = props.level ? steps.indexOf(props.level) + 1 : 0
  return (
    <span className="meter" aria-hidden>
      {steps.map((l, i) => (
        <i key={l} className={i < k ? 'f' : ''} style={{ height: Math.round(4 + (8 * (i + 1)) / steps.length) }} />
      ))}
    </span>
  )
}

export function thinkState(s: SettingsView): { spec: ThinkSpec; level: ThinkLevel | null; model: string } {
  return { spec: thinkSpec(s.provider, s.textModel), level: thinkLevel(s.thinkLevels, s.provider, s.textModel), model: s.provider === 'claude-code' ? `Claude Code ${s.textModel}` : s.textModel }
}

// 弹出档位菜单；选了就存（这个模型的那一份）。返回 'settings' 表示点了「在设置里改」
export async function pickThink(s: SettingsView, el: Element, opts: { settingsLink: boolean }): Promise<void> {
  const { spec, level, model } = thinkState(s)
  const head: MenuEntry = {
    type: 'section',
    label: (
      <>
        {t('思考强度')}
        <span className="r">{spec.levels.length ? t('{0} · {1} 档', model, spec.levels.length) : model}</span>
      </>
    )
  }
  const items: MenuEntry[] = [head]
  if (spec.kind === 'always') {
    items.push({ id: 'always', icon: <Meter spec={spec} level={null} />, label: t('总会先想'), desc: t('每次都先想再答。接口没有档位可选，也关不掉。'), checked: true, enabled: false })
    items.push({ type: 'separator' }, { type: 'note', label: t('想答得快一点，可以在设置里换个能选档的模型。') })
  } else {
    for (const l of spec.levels) items.push({ id: l, icon: <Meter spec={spec} level={l} />, label: levelName(l), desc: levelHint(l), checked: l === level })
    const note = spec.kind === 'switch' ? t('这个模型只能开或关，没有档位。') : !spec.levels.includes('off') ? t('这个模型关不掉思考，最省的一档是「{0}」。', levelName(spec.levels[0])) : ''
    items.push({ type: 'separator' })
    if (note) items.push({ type: 'note', label: note })
    items.push({ type: 'note', label: t('每个模型记住自己的档。') })
  }
  if (opts.settingsLink) items.push({ id: 'settings', label: t('在设置里改…'), hint: '' })
  const id = await showMenu(items, { el, align: 'left' })
  if (!id) return
  if (id === 'settings') return void api.openSettings('ai')
  if (spec.levels.includes(id as ThinkLevel)) void api.setSettings({ thinkLevels: { ...s.thinkLevels, [thinkKey(s.provider, s.textModel)]: id as ThinkLevel } })
}

// 问答输入框里的那一格
export function ThinkChip(props: { settings: SettingsView }) {
  const { spec, level } = thinkState(props.settings)
  if (spec.kind === 'unknown') return null
  const on = spec.kind !== 'always' && level !== 'off'
  return (
    <button
      className={'tchip think-chip' + (on ? ' on' : '')}
      title={spec.kind === 'always' ? t('这个模型每次都会先想再答') : t('思考强度：{0}', levelHint(level!))}
      onClick={(e) => void pickThink(props.settings, e.currentTarget, { settingsLink: true })}
    >
      <Meter spec={spec} level={level} />
      {spec.kind === 'always' ? t('总会先想') : t('思考 · {0}', levelName(level!))}
      {spec.kind !== 'always' && <ChevronDown size={12} />}
    </button>
  )
}
