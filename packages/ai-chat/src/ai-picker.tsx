/**
 * 选 AI 的选择器，一个到处用（task-m55m7，偏好「选 AI 先选家再选模型」，用户 r20「这里同一家没必要都列出来，你可以像我们对话框一样去选」）：
 * 先选家（同一家只列一次：标志、名字，右边写版本和在哪 / 没装 / 自查出的问题），再选这一家的模型（从命令行拉的，底下写什么时候拉的），
 * 再选想多久（这家这个模型有档才出）。两种样子：
 * - bar：AI 输入框底下三颗（CN-91 方向 C，24 高无框，菜单往上弹），AI 对话、读 PDF 用；
 * - box：设置 › AI 的默认和五个功能那一列（28 高的一个框里三段，菜单往下弹，放不下往上），前面能多一项「跟默认」「按顺序」。
 * 菜单挂在 body 上（右栏有磨砂、设置的内容区会滚），点外面、esc、失焦收起（use-dismiss），设置里滚动也收。
 */
import { Fragment, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CLAUDE_EFFORTS, effortOption, findModel, modelLabel as nameOf, type ModelOption, problemText, t as tNow } from '@cn/ai-engines/shared'
import { Icon, useUi } from './context'
import { EngineLogo } from './engine-logo'
import type { ChatEngine } from './host'
import { useDismiss } from './use-dismiss'
import './ai-picker.css'

/** 家这一列的一项 */
export interface Family {
  id: string
  /** 菜单里的名字（翻译那一行是「只用Codex」） */
  label: string
  /** 按钮上的名字（「Codex」）；不给同 label */
  name?: string
  logo: string
  /** 菜单右边的小字：「2.1.330 · ~/.local/bin」「没装」「API · 自己的Key」 */
  note: string
  /** 装着的版本（自查出问题时右边写「9.9.0 · 有一个参数不认了」） */
  version?: string
  /** 自查查出来的问题（标红，菜单那一行右边、按钮上的小红点和悬停提示） */
  warn?: string
  /** 灰掉不能选（没装、运行不了） */
  off?: boolean
  /** 悬停看的（没装时怎么装、在哪） */
  title?: string
  /** 这一家的模型（第一项是它的默认）；空的就没有模型那一段 */
  models: ModelOption[]
  /** 模型菜单底下那句「刚拉的」「上次拉的 11-20 09:14」 */
  pulled?: string
  /** 哪条路（task-587os）：菜单按它分组，组名写谁付钱（订阅 / 按用量 / 不花钱）；「装在别处？」只列命令行 */
  route?: 'cli' | 'api' | 'local'
}

/** 三条路的组名（设计页第 4 节：组名写谁付钱） */
const ROUTE_HEAD = () => ({ cli: tNow('本机命令行 · 订阅'), api: tNow('API Key · 按用量'), local: tNow('本机模型 · 不花钱') })

/** 家前面多出来的一项：跟默认、按顺序（翻译） */
export interface FamilyLead {
  label: string
  /** 右边、按钮上跟着的小字：「Claude Code · Opus 5.5」「Claude Code Haiku → Codex → …」 */
  sub: string
  logo: string | null
}

export interface PickerValue {
  /** null：选的是前面那一项（跟默认、按顺序） */
  family: string | null
  /** 空串是这家自己的默认模型 */
  model?: string
  /** 不给：没选档 */
  effort?: string
}

export interface AiPickerProps {
  look: 'bar' | 'box'
  /** 三段按钮的 data-testid */
  ids: { family: string; model: string; effort: string }
  /** 家那一列的菜单名（无障碍名字）和菜单头：「AI 引擎」「谁来答」/「AI对话用哪一家」「AI对话用哪一家」 */
  familyMenu: string
  familyHead: string
  /** 按钮的无障碍名字前缀（设置里「AI对话」，输入框里不给） */
  label?: string
  families: Family[]
  lead?: FamilyLead | null
  value: PickerValue
  /** 没选档时按钮上写什么、菜单里有没有「默认档」：设置里有（不指定就用它自己的）；输入框里 Claude Code、Codex 一直有一档 */
  unsetEffort?: { label: string; note: string } | null
  /** effort 菜单最下面一句（输入框里：只管这个对话…） */
  effortFoot?: string
  /** 不放家那一段（旁支：跟主对话） */
  hideFamily?: boolean
  onFamily(id: string | null): void
  onModel(id: string): void
  onEffort(id: string | null): void
  /** 家那一列最下面「装在别处？指定位置…」（输入框里有）：只有一家没找到时直接给它选，不然先问是哪一家 */
  locate?(id: string): void
}

/** 谁来答这一列的一家（task-m55m7）：右边写版本和在哪找到（没找到、运行不了灰掉），自查出问题的标红 */
export function engineFamily(e: ChatEngine): Family {
  const bad = e.health?.state === 'bad' ? problemText(e.health.problems) : undefined
  const where = e.path || !e.broken ? e.where : tNow('运行不了')
  // API Key：「Key · 钥匙串」/「没填 Key」；本机模型：「本机 · 3个模型」/「没找到」（task-587os）
  const note =
    e.route === 'api'
      ? e.path
        ? tNow('Key · 钥匙串')
        : tNow('没填Key')
      : e.route === 'local'
        ? e.path
          ? tNow('本机 · {n}个模型', { n: e.models.filter((m) => m.id).length })
          : tNow('没找到')
        : e.path && e.version
          ? `${e.version} · ${where}`
          : where
  return {
    id: e.id,
    label: e.label,
    logo: e.id,
    ...(e.route ? { route: e.route } : {}),
    note,
    ...(e.version ? { version: e.version } : {}),
    ...(bad ? { warn: bad } : {}),
    off: !e.path,
    title: e.broken ? tNow('{a}。{b}', { a: e.broken, b: e.hint ?? '' }) : (e.hint ?? e.path ?? ''),
    models: e.models,
    ...(e.pulled ? { pulled: e.pulled } : {}),
  }
}

type Which = 'family' | 'model' | 'effort'

/** 「换一家」（AI 出错时）：打开正看着的那个输入框底下的家那一列 */
/** 「换一家」：看得见的那个输入框开谁来答那一列；没有看得见的（旁支、视频问框不放谁来答）就开设置 › AI */
export const openEnginePick = () => {
  if (window.dispatchEvent(new CustomEvent('cn:engine-pick', { cancelable: true }))) window.dispatchEvent(new CustomEvent('cn:open-settings', { detail: 'ai' }))
}

export function AiPicker(p: AiPickerProps) {
  const { t } = useUi()
  const [open, setOpen] = useState<Which | null>(null)
  const famBtn = useRef<HTMLButtonElement>(null)
  const fam = p.value.family === null ? null : (p.families.find((f) => f.id === p.value.family) ?? null)
  const models = fam?.models ?? []
  const model = fam ? (findModel(models, p.value.model ?? '') ?? (p.value.model ? undefined : models[0])) : undefined
  // 选的模型不在拉到的列表里（设置里存的是具体型号、命令行换了别名指向）：Claude Code 的模型都认那五档
  const efforts = model?.efforts ?? (fam?.id === 'claude' ? CLAUDE_EFFORTS : [])
  const toggle = (w: Which) => setOpen((v) => (v === w ? null : w))
  const close = () => setOpen(null)
  const box = p.look === 'box'

  // 「换一家」：只开看得见的那个输入框的
  useEffect(() => {
    if (p.hideFamily || box) return
    const h = (e: Event) => {
      if (!famBtn.current?.offsetParent || e.defaultPrevented) return
      e.preventDefault()
      setOpen('family')
    }
    window.addEventListener('cn:engine-pick', h)
    return () => window.removeEventListener('cn:engine-pick', h)
  }, [p.hideFamily, box])

  // 名字：拉到的列表里的；不在列表里时 Claude Code 用自带的叫法（Opus 5.5），再没有写型号本身
  const modelLabel = model?.label ?? (p.value.model ? (fam?.id === 'claude' ? nameOf('claude', p.value.model) : p.value.model) : t('默认模型'))
  // 这一档的名字：这个模型自己给的（宿主多出来的那一家有自己的叫法，如 ParaRead 的「关 / 开」），没有用 Claude Code 那套
  const effortLabel = p.value.effort ? (efforts.find((e) => e.id === p.value.effort)?.label ?? effortOption(p.value.effort).label) : (p.unsetEffort?.label ?? '')
  const showModel = !!fam && models.length > 0
  const showEffort = !!fam && efforts.length > 0 && !!effortLabel

  const famMenu = <FamilyMenu {...p} current={fam?.id ?? null} close={close} />
  const segs: ReactNode[] = []
  if (!p.hideFamily) {
    segs.push(
      <PickBtn
        key="family"
        which="family"
        open={open}
        btnRef={famBtn}
        onToggle={toggle}
        onClose={close}
        look={p.look}
        label={p.label ? t('{name}用哪一家', { name: p.label }) : t('选 AI 引擎')}
        tip={fam?.warn ? warnTip(fam) : box ? undefined : fam ? t('谁来答：{name}', { name: fam.name ?? fam.label }) : t('谁来答')}
        testid={p.ids.family}
        className={box ? 'fam' + (fam ? '' : ' lead') : 'eng'}
        warn={fam?.warn}
        width={320}
        menuLabel={p.familyMenu}
        menu={famMenu}
      >
        {fam ? (
          <>
            <EngineLogo id={fam.logo} size={box ? 14 : 13} />
            <span className="lb">{fam.name ?? fam.label}</span>
          </>
        ) : (
          <>
            {p.lead?.logo ? <EngineLogo id={p.lead.logo} size={14} /> : <span className="nologo" />}
            <span className="lb">{p.lead?.label}</span>
            <span className="m">{p.lead?.sub}</span>
          </>
        )}
      </PickBtn>,
    )
  }
  if (showModel) {
    if (box) segs.push(<i key="d1" className="aipk-div" />)
    segs.push(
      <PickBtn
        key="model"
        which="model"
        open={open}
        onToggle={toggle}
        onClose={close}
        look={p.look}
        label={p.label ? t('{name}用哪个模型', { name: p.label }) : t('选模型')}
        tip={box ? undefined : t('模型')}
        testid={p.ids.model}
        className="mdl"
        width={models.some((m) => m.group) ? 300 : 280}
        menuLabel={t('模型')}
        menu={<ModelMenu family={fam!} value={model?.id ?? p.value.model ?? ''} current={model ? null : modelLabel} close={close} onModel={p.onModel} />}
      >
        <span className="lb">{modelLabel}</span>
      </PickBtn>,
    )
  }
  if (showEffort) {
    if (box) segs.push(<i key="d2" className="aipk-div" />)
    segs.push(
      <PickBtn
        key="effort"
        which="effort"
        open={open}
        onToggle={toggle}
        onClose={close}
        look={p.look}
        label={p.label ? t('{name}想多久', { name: p.label }) : t('选想多久（effort）')}
        tip={box ? undefined : t('想多久（effort）')}
        testid={p.ids.effort}
        className="eff"
        width={280}
        menuLabel={t('想多久（effort）')}
        menu={
          <>
            <div className="mh">{t('想多久（effort）')}</div>
            {p.unsetEffort && (
              <button className="it" role="menuitemradio" aria-checked={!p.value.effort} onClick={() => (close(), p.onEffort(null))}>
                <span className="ck">{!p.value.effort && <Icon name="check" size={14} />}</span>
                <span className="nm">{p.unsetEffort.label}</span>
                <span className="r">{p.unsetEffort.note}</span>
              </button>
            )}
            {efforts.map((e) => (
              <button key={e.id} className="it" role="menuitemradio" aria-checked={e.id === p.value.effort} onClick={() => (close(), p.onEffort(e.id))}>
                <span className="ck">{e.id === p.value.effort && <Icon name="check" size={14} />}</span>
                <span className="nm">{e.label}</span>
                {e.note && <span className="r">{e.note}</span>}
              </button>
            ))}
            {p.effortFoot && <div className="sub">{p.effortFoot}</div>}
          </>
        }
      >
        <span className="lb">{effortLabel}</span>
      </PickBtn>,
    )
  }
  if (!box) return <>{segs}</>
  return (
    <div className={'aipk' + (fam ? '' : ' leading')} role="group" aria-label={p.label ? t('{name}用哪个AI', { name: p.label }) : t('用哪个AI')}>
      {segs}
    </div>
  )
}

function PickBtn(p: {
  which: Which
  open: Which | null
  onToggle(w: Which): void
  onClose(): void
  look: 'bar' | 'box'
  label: string
  tip?: string
  testid: string
  className?: string
  warn?: string
  width: number
  menuLabel: string
  menu: ReactNode
  btnRef?: RefObject<HTMLButtonElement | null>
  children: ReactNode
}) {
  const own = useRef<HTMLButtonElement>(null)
  const btn = p.btnRef ?? own
  const on = p.open === p.which
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={(p.look === 'bar' ? 'pick' : 'aipk-seg') + (p.className ? ' ' + p.className : '') + (on ? ' open' : '')}
        data-testid={p.testid}
        data-warn={p.warn || undefined}
        aria-label={p.label}
        aria-haspopup="menu"
        aria-expanded={on}
        data-tip={on ? undefined : p.tip}
        data-side={p.look === 'bar' ? 'above' : undefined}
        onClick={() => p.onToggle(p.which)}
      >
        {p.children}
        {p.warn && <span className="aipk-warn" aria-hidden="true" />}
        <Icon name="chevron-down" size={12} className="cv" />
      </button>
      {on && (
        <PickMenu anchor={btn} width={p.width} label={p.menuLabel} up={p.look === 'bar'} onClose={p.onClose}>
          {p.menu}
        </PickMenu>
      )}
    </>
  )
}

/**
 * 弹出的菜单：bar 往上弹（输入框在底下），box 往下弹、下面放不下而上面放得下时往上；左边和按钮对齐（放不下往里挪），离按钮 6（往下 4）；
 * 太长自己滚。点外面、esc、失焦收起，按钮也算里面（再点是收起）；外面滚动（设置的内容区）时跟着按钮挪，按钮滚出去了才收
 */
function PickMenu(p: { anchor: RefObject<HTMLButtonElement | null>; width: number; label: string; up: boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number; width: number } | null>(null)
  /** 照按钮现在在哪摆；往上还是往下第一次定了就不再变（滚动时只跟着按钮挪） */
  const dir = useRef<'up' | 'down' | null>(null)
  const place = useRef(() => {})
  place.current = () => {
    const a = p.anchor.current
    if (!a) return
    const r = a.getBoundingClientRect()
    // 限在所在的那一块里（设置弹窗、AI 那一栏），不伸出去盖住别的；设置里的框（box）右边和框的右边对齐
    const c = (a.closest('[role="dialog"], [role="complementary"], aside, .setpane') ?? document.body).getBoundingClientRect()
    const box = p.up ? null : a.closest('.aipk')?.getBoundingClientRect()
    // 那一块比菜单还窄（AI 栏 300）：菜单收到那一块减两边各 8，不伸出栏外（task-c22p9）
    const width = Math.min(p.width, Math.min(window.innerWidth, c.right) - Math.max(0, c.left) - 16)
    const want0 = box ? box.right - width : r.left
    const left = Math.max(Math.max(8, c.left + 8), Math.min(want0, Math.min(window.innerWidth, c.right) - width - 8))
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const want = ref.current?.scrollHeight ?? 300
    dir.current ??= p.up || (below < Math.min(want, 320) && above > below) ? 'up' : 'down'
    setPos(dir.current === 'up' ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: above } : { left, width, top: r.bottom + 4, maxHeight: below })
  }
  useLayoutEffect(() => place.current(), [p.anchor, p.width, p.up])
  useDismiss(true, [ref, p.anchor], p.onClose)
  // 外面滚动（设置的内容区）：菜单跟着按钮挪；按钮滚出看得见的地方就收起。菜单自己里面滚不算
  useEffect(() => {
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      const r = p.anchor.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return p.onClose()
      place.current()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [p.onClose, p.anchor])
  return createPortal(
    <div ref={ref} className="ai-menu aipk-menu" role="menu" aria-label={p.label} data-composer-pop="" style={{ width: p.width, ...(pos ?? { visibility: 'hidden' }) }}>
      {p.children}
    </div>,
    document.body,
  )
}

/** 自查出问题的那一家悬停说的：「Claude Code 9.9.0 有一个参数不认了：--mcp-config，AI 对话可能出错」 */
const warnTip = (f: Family) => `${f.name ?? f.label}${f.version ? ` ${f.version}` : ''} ${f.warn}`

/** 家这一列：（跟默认 / 按顺序）· 每家一行：勾 · 标志 · 名字 · 右边版本和在哪（没装、运行不了灰掉；自查出问题的标红，照样能选）；输入框里最下面「装在别处？指定位置…」 */
function FamilyMenu(p: AiPickerProps & { current: string | null; close(): void }) {
  const { t } = useUi()
  const [which, setWhich] = useState(false)
  if (which)
    return (
      <>
        <div className="mh">{t('指定哪一家装在哪')}</div>
        {p.families.filter((f) => !f.route || f.route === 'cli').map((f) => (
          <button key={f.id} className="it" role="menuitem" data-tip={f.title} data-side="left" onClick={() => (p.close(), p.locate!(f.id))}>
            <span className="ck" />
            <EngineLogo id={f.logo} size={14} />
            <span className="nm">{f.label}</span>
            <span className="r truncate">{f.note}</span>
          </button>
        ))}
      </>
    )
  // 分了组的（AI 的各家）组名就是头，不再另写「谁来答」
  const grouped = p.families.some((f) => f.route)
  return (
    <>
      {!grouped && <div className="mh">{p.familyHead}</div>}
      {p.lead && (
        <>
          <button className="it" role="menuitemradio" aria-checked={p.current === null} onClick={() => (p.close(), p.current !== null && p.onFamily(null))}>
            <span className="ck">{p.current === null && <Icon name="check" size={14} />}</span>
            {p.lead.logo ? <EngineLogo id={p.lead.logo} size={14} /> : <span className="nologo" />}
            <span className="nm">{p.lead.label}</span>
            <span className="r truncate">{p.lead.sub}</span>
          </button>
          <div className="sep" />
        </>
      )}
      {p.families.map((f, i) => (
        <Fragment key={f.id}>
        {/* 按三条路分组（task-587os）：组名写谁付钱；没有 route 的（翻译那一行）不分组 */}
        {f.route && f.route !== p.families[i - 1]?.route && (
          <>
            {i > 0 && <div className="sep" />}
            <div className="mh grp">{ROUTE_HEAD()[f.route]}</div>
          </>
        )}
        <button
          key={f.id}
          className={'it' + (f.warn ? ' warn' : '')}
          role="menuitemradio"
          aria-checked={f.id === p.current}
          disabled={f.off}
          data-tip={f.warn ? warnTip(f) : f.title}
          data-side="left"
          onClick={() => {
            p.close()
            if (f.id !== p.current) p.onFamily(f.id)
          }}
        >
          <span className="ck">{f.id === p.current && <Icon name="check" size={14} />}</span>
          <EngineLogo id={f.logo} size={14} />
          <span className="nm">{f.label}</span>
          {/* 自查出问题的：右边写版本和问题的头一截（「9.9.0 · 有一个参数不认了」），全文悬停看 */}
          <span className="r truncate">{f.warn ? `${f.version ? `${f.version} · ` : ''}${f.warn.split(/[：:]/)[0]}` : f.note}</span>
        </button>
        </Fragment>
      ))}
      {p.locate && (
        <>
          <div className="sep" />
          <button
            className="it dim"
            role="menuitem"
            onClick={() => {
              const missing = p.families.filter((f) => f.off && (!f.route || f.route === 'cli'))
              if (missing.length !== 1) return setWhich(true)
              p.close()
              p.locate!(missing[0]!.id)
            }}
          >
            <span className="ck" />
            {t('装在别处？指定位置…')}
          </button>
        </>
      )}
    </>
  )
}

/** 默认模型（id 是空串）在列表里的 React key */
const DEFAULT_KEY = '(默认)' // 不翻：React 的 key，不显示

/** 模型这一列：头「Claude Code的模型」、多于 12 个时顶上一个找模型的框、按分组（OpenCode 按服务商）列，底下一句什么时候拉的 */
function ModelMenu(p: { family: Family; value: string; /** 选着的不在拉到的列表里：它的名字（放在第一行打勾，右边写「这次没拉到」） */ current: string | null; close(): void; onModel(id: string): void }) {
  const { t } = useUi()
  const [q, setQ] = useState('')
  const find = useRef<HTMLInputElement>(null)
  const long = p.family.models.length > 12
  useEffect(() => {
    if (long) find.current?.focus()
  }, [long])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = p.family.models.filter((m) => words.every((w) => `${m.label} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(w)))
  let group: string | undefined
  return (
    <>
      <div className="mh">{t('{name}的模型', { name: p.family.name ?? p.family.label })}</div>
      {long && <input ref={find} className="aipk-find" placeholder={t('找模型（{n} 个）', { n: p.family.models.length })} aria-label={t('找模型')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />}
      <div className="aipk-list">
        {p.current && p.value && !q && (
          <button className="it" role="menuitemradio" aria-checked="true" title={p.value} onClick={p.close}>
            <span className="ck">
              <Icon name="check" size={14} />
            </span>
            <span className="nm">{p.current}</span>
            <span className="r">{t('这次没拉到')}</span>
          </button>
        )}
        {shown.map((m) => {
          const head = m.group && m.group !== group ? m.group : null
          group = m.group
          return (
            <div key={m.id || DEFAULT_KEY} className="aipk-gr">
              {head && <div className="mh">{head}</div>}
              <button className="it" role="menuitemradio" aria-checked={m.id === p.value} title={m.id || undefined} onClick={() => (p.close(), p.onModel(m.id))}>
                <span className="ck">{m.id === p.value && <Icon name="check" size={14} />}</span>
                <span className="nm">{m.label}</span>
              </button>
            </div>
          )
        })}
        {!shown.length && <div className="sub">{t('没有叫这个的')}</div>}
      </div>
      {p.family.pulled && <div className="sub foot">{p.family.pulled}</div>}
    </>
  )
}
