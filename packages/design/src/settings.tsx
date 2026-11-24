/**
 * 设置的框架（画布笔记设置方向 A「分组侧栏」，task-f7rib；2026-11-22 抽出来给画布今日一起用，task-ykkoz）：
 * B 里是居中弹窗、A 里可以开成中间的一个标签；左边侧栏（「设置」、可选的搜索、分段的分页），右边一页：页头、按组一张细线表、
 * 一行左边名字和说明、右边 220 一列（下拉、分段 220 宽，开关、按钮贴右）。改了马上存，底下提示条一句说会怎样、带「撤回」（SaidContext）。
 * 每一行带 data-row，从别处跳过来（focus）时翻到它、闪 1.6 秒。样式在 settings.css（类名 set-*、sa-*、sw-toggle）。
 * 不碰各软件的翻译：给人看的字都从参数进来。
 */
import { createContext, Fragment, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { applyGlass, GLASS_DEFAULT, GLASS_MAX, GLASS_MIN, glassPct } from './glass'
import { Codicon } from './index'

/** 设置里改了一项之后，底下提示条说的话：已存 · 会怎样，带「撤回」；别的事（存好了、导入了）只说一句 */
export interface Said {
  /** 改了一项：hint 是这次改了会怎样，undo 撤回成原来的值 */
  saved(hint: string, undo?: () => void): void
  /** 只说一句（不带撤回） */
  say(text: string): void
  /** 成了一件事（不是改设置）：带对勾、不加「已存」（软件家族「认出来了」）；undo 给了带「撤回」，act 给了前面多一颗（同步来源拉了几篇：「看是哪几篇」「撤回」） */
  ok(text: string, undo?: () => void, act?: { label: string; run(): void }): void
}
export const SaidContext = createContext<Said>({ saved: () => undefined, say: () => undefined, ok: () => undefined })
export const useSaid = () => useContext(SaidContext)

export interface SetPage {
  id: string
  name: string
  icon: ReactNode
  /** 名字后面的小东西（「新版本已下好」的小点） */
  after?: ReactNode
}
export interface SetSection {
  /** 段名；不给就不写段头 */
  name?: string
  pages: SetPage[]
}

export interface SettingsShellProps {
  /** 给人看的字：标题「设置」、侧栏的名字、× 的名字和悬停、「已存 · {hint}」、「撤回」 */
  text: { title: string; nav: string; close: string; closeTip: string; saved: (hint: string) => string; undo: string }
  sections: SetSection[]
  page: string
  onPage(id: string): void
  onClose(): void
  /** 开成中间的一个标签（画布笔记 A），不是弹窗 */
  asTab?: boolean
  /** 侧栏标题下面的东西（搜索框） */
  navTop?: ReactNode
  /** 给了就代替分页列表（搜索结果） */
  navBody?: ReactNode
  /** 要翻到、闪一下的那一行（data-row）；seq 变了就再闪一次 */
  focus?: { row: string; seq: number } | null
  /** 软件这会儿说的话：设置开着时（弹窗盖住了底栏）在设置底下的提示条里说 */
  appNotice?: string | null
  /** 右边这一页：页头（PageHead）和内容 */
  children: ReactNode
}

export function SettingsShell(props: SettingsShellProps) {
  const body = useRef<HTMLDivElement>(null)
  /** 底下的提示条：一句说这次改了会怎样，带「撤回」，4 秒后收起（鼠标停在上面不计时） */
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: () => void; act?: { label: string; run(): void }; seq: number } | null>(null)
  const [toastHover, setToastHover] = useState(false)
  const savedText = props.text.saved
  const said = useMemo<Said>(
    () => ({
      saved: (hint, undo) => setToast({ text: savedText(hint), ok: true, undo, seq: Date.now() }),
      say: (text) => setToast({ text, ok: false, seq: Date.now() }),
      ok: (text, undo, act) => setToast({ text, ok: true, undo, act, seq: Date.now() }),
    }),
    [savedText],
  )
  useEffect(() => {
    if (!toast || toastHover) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast, toastHover])
  useEffect(() => {
    if (props.appNotice) said.say(props.appNotice)
  }, [props.appNotice])

  useEffect(() => {
    if (props.asTab) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose, props.asTab])

  // 换页：从顶上看起；带着要闪的那一行（搜索回车、从用的地方跳过来）时翻到那一行、--acc-soft 闪 1.6 秒，
  // 那一页的内容是读出来的就等它画出来。两件事在一处：先后各做会互相盖掉
  const flashedSeq = useRef(0)
  useEffect(() => {
    const f = props.focus
    const b = body.current
    if (!f || f.seq === flashedSeq.current) {
      if (b) b.scrollTop = 0
      return
    }
    flashedSeq.current = f.seq
    let tries = 0
    let off: ReturnType<typeof setTimeout> | undefined
    const find = () => {
      const row = body.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(f.row)}"]`)
      const bb = body.current
      if (!bb || !row) {
        if (tries++ < 40) off = setTimeout(find, 50)
        return
      }
      // 已经整个看得见就不滚（不把页头滚走）；看不全才滚到正中
      const r = row.getBoundingClientRect()
      const box = bb.getBoundingClientRect()
      if (r.top < box.top || r.bottom > box.bottom) {
        const top = r.top - box.top + bb.scrollTop
        bb.scrollTop = Math.max(0, top - bb.clientHeight / 2 + row.offsetHeight / 2)
      }
      row.classList.remove('sa-flash')
      void row.offsetWidth
      row.classList.add('sa-flash')
      off = setTimeout(() => row.classList.remove('sa-flash'), 1600)
    }
    find()
    return () => clearTimeout(off)
  }, [props.page, props.focus?.seq])

  const T = props.text
  return (
    <SaidContext.Provider value={said}>
      <div className={props.asTab ? 'pane setpane' : 'set-back'} onMouseDown={(e) => !props.asTab && e.target === e.currentTarget && props.onClose()}>
        <div className={'set' + (props.asTab ? ' set-tab' : '')} role={props.asTab ? 'region' : 'dialog'} aria-label={T.title}>
          <nav className="set-nav" aria-label={T.nav}>
            <h3>{T.title}</h3>
            {props.navTop}
            {props.navBody ?? (
              <div className="sa-navlist">
                {props.sections.map((sec, i) => (
                  <Fragment key={sec.name ?? i}>
                    {sec.name && <div className="sa-sec">{sec.name}</div>}
                    {sec.pages.map((p) => (
                      <button key={p.id} className={'si' + (props.page === p.id ? ' on' : '')} aria-current={props.page === p.id ? 'page' : undefined} onClick={() => props.onPage(p.id)}>
                        {p.icon}
                        {p.name}
                        {p.after}
                      </button>
                    ))}
                  </Fragment>
                ))}
              </div>
            )}
          </nav>
          {/* × 在滚动区外面：页面滚动、有没有滚动条它都不动 */}
          <button className="iconbtn set-x" hidden={props.asTab} aria-label={T.close} title={T.closeTip} onClick={props.onClose}>
            <Codicon name="close" size={16} />
          </button>
          <div className="set-body" ref={body}>
            {props.children}
          </div>
          <div className={'sa-toast' + (toast ? ' show' : '') + (toast?.undo || toast?.act ? ' with-act' : '')} role="status" data-testid="settings-toast" onMouseEnter={() => setToastHover(true)} onMouseLeave={() => setToastHover(false)}>
            {toast && (
              <>
                <Codicon name={toast.ok ? 'pass-filled' : 'info'} size={14} className={toast.ok ? 'ok' : undefined} />
                <span>{toast.text}</span>
                {toast.act && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.act!.run()
                      setToast(null)
                      setToastHover(false)
                    }}
                  >
                    {toast.act.label}
                  </button>
                )}
                {toast.undo && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.undo!()
                      setToast(null)
                      setToastHover(false)
                    }}
                  >
                    {T.undo}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </SaidContext.Provider>
  )
}

/** 页头：图标、名字、一句这页管什么 */
export function PageHead({ icon, title, desc }: { icon: ReactNode; title: ReactNode; desc: ReactNode }) {
  return (
    <div className="sa-head" data-testid="settings-head">
      <span className="pi">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
  )
}

/** 一组：组名 + 一张细线表。row：整组就是设置索引里的一项（搜到、跳过来时翻到这张表、闪一下） */
export function Group(props: { title: ReactNode; children: ReactNode; label?: string; row?: string }) {
  return (
    <>
      <div className="sa-grph">{props.title}</div>
      <div className="sa-card" role="group" aria-label={props.label ?? (typeof props.title === 'string' ? props.title : undefined)} data-row={props.row}>
        {props.children}
      </div>
    </>
  )
}

/** 一行：左边名字和说明，右边 220 一列放控件。full：控件在说明下面整行宽；info：只有字；more：整行宽、跟在说明下面的一句 */
export function Row(props: { id: string; label: ReactNode; desc?: ReactNode; children?: ReactNode; full?: boolean; info?: boolean; dim?: boolean; more?: ReactNode }) {
  return (
    <div className={'sa-row' + (props.full ? ' full' : '') + (props.info ? ' info' : '') + (props.dim ? ' dim' : '')} data-row={props.id}>
      <div className="sa-txt">
        <div className="sa-lb">{props.label}</div>
        {props.desc ? <div className="sa-ds">{props.desc}</div> : null}
      </div>
      {!props.info && <div className="sa-cc">{props.children}</div>}
      {props.more && <div className="sa-more">{props.more}</div>}
    </div>
  )
}

/** 220 宽的下拉：选项是 [值, 写给人看的字, 停用] */
export function Sel<T extends string | number>(props: { label: string; value: T; options: readonly (readonly [T, string, boolean?])[]; onChange(v: T): void; disabled?: boolean }) {
  return (
    <select
      className="sa-sel"
      aria-label={props.label}
      value={String(props.value)}
      disabled={props.disabled}
      onChange={(e) => {
        const o = props.options.find(([v]) => String(v) === e.currentTarget.value)
        if (o) props.onChange(o[0])
      }}
    >
      {props.options.map(([v, text, off]) => (
        <option key={String(v)} value={String(v)} disabled={off}>
          {text}
        </option>
      ))}
    </select>
  )
}

/** 220 宽的分段（两三样里挑一样） */
export function Seg<T extends string>(props: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(v: T): void }) {
  return (
    <div className="sa-seg" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={props.value === v} className={props.value === v ? 'on' : ''} onClick={() => props.value !== v && props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** 说明里的小链接（「排顺序 ›」「去Git和同步 ›」） */
export function Lnk(props: { children: ReactNode; onClick(): void; label?: string }) {
  return (
    <button type="button" className="sa-lnk" aria-label={props.label} onClick={props.onClick}>
      {props.children}
      <Codicon name="chevron-right" size={12} />
    </button>
  )
}

// ---------- 外观页的几块（画布笔记、画布今日一个样子） ----------

/** 一套主题的小窗口预览：用那套主题自己的变量画（data-skin），结构也照它（标题栏、图标栏、侧栏、标签条和当前标签的标记、卡片、底栏） */
export function ThemeMini({ id, tab }: { id: string; tab: string }) {
  return (
    <div className="mini" data-skin={id} data-tabmark={tab} aria-hidden="true">
      <i className="m-title" />
      <div className="m-body">
        <div className="m-bar">
          <i className="on" />
          <i />
          <i />
        </div>
        <div className="m-side">
          <i />
          <i className="on" />
          <i />
          <i />
        </div>
        <div className="m-main">
          <div className="m-tabs">
            <i className="on" />
            <i />
          </div>
          <div className="m-doc">
            <em />
            <s />
            <s className="short" />
            <b />
            <u />
          </div>
        </div>
      </div>
      <i className="m-status" />
    </div>
  )
}

/** 界面风格 A 的小图：用现在这套主题的颜色画出 VS Code 的样子（标题栏、左右图标栏、侧栏、标签条和当前标签的标记、面包屑、底栏一条） */
export function FrameMiniA({ tab }: { tab: string }) {
  return (
    <span className="mini fr-mini-a" data-tabmark={tab} aria-hidden="true">
      <i className="m-title" />
      <span className="m-body">
        <span className="m-bar">
          <i className="on" />
          <i />
          <i />
        </span>
        <span className="m-side">
          <i />
          <i className="on" />
          <i />
          <i />
        </span>
        <span className="m-main">
          <span className="m-tabs">
            <i className="on" />
            <i />
          </span>
          <span className="m-crumb">
            <i />
          </span>
          <span className="m-doc">
            <em />
            <s />
            <s className="short" />
          </span>
        </span>
        <span className="m-bar m-rbar">
          <i />
          <i />
        </span>
      </span>
      <i className="m-status" />
    </span>
  )
}

/** 主题卡：上面小窗口，下面名字（跟着系统时后面写「白天」「夜里」）；导入的主题右上角能删 */
export function ThemeCard(props: { id: string; tab: string; name: string; note?: string; on: boolean; slot?: string | null; onPick(): void; remove?: { label: string; tip: string; onClick(): void } }) {
  return (
    <div className={'sk' + (props.on ? ' on' : '')}>
      <button className="sk-pick" role="radio" aria-checked={props.on} aria-label={props.name} aria-description={props.note} data-tip={props.note} data-side="below" data-skin-card={props.id} onClick={props.onPick}>
        <ThemeMini id={props.id} tab={props.tab} />
        <span className="nm">
          <span className="t">{props.name}</span>
          {props.slot && <em className="slot">{props.slot}</em>}
        </span>
      </button>
      {props.remove && (
        <button className="iconbtn sk-x" aria-label={props.remove.label} data-tip={props.remove.tip} onClick={props.remove.onClick}>
          <Codicon name="trash" size={14} />
        </button>
      )}
    </div>
  )
}

/** 界面风格两张大图：A 照 VS Code（小图用现在这套主题的颜色和标签标记）、B 浮岛书桌（pv 是那张背景图的 CSS 值） */
export function FramePicker(props: { label: string; value: 'a' | 'b'; tab: string; pv: string; a: { name: string; note: string }; b: { name: string; note: string }; onChange(v: 'a' | 'b'): void }) {
  return (
    <div className="hstyles frames" role="radiogroup" aria-label={props.label} data-row="frame">
      {(['a', 'b'] as const).map((id) => (
        <button key={id} role="radio" aria-checked={props.value === id} className={'hs' + (props.value === id ? ' on' : '')} onClick={() => props.onChange(id)}>
          {id === 'a' ? (
            <FrameMiniA tab={props.tab} />
          ) : (
            <span className={'fr-pv ' + id} style={{ ['--pv' as string]: props.pv }}>
              <i className="ab" />
              <i className="sd" />
              <i className="md" />
              <i className="sd" />
              <i className="ab" />
            </span>
          )}
          <span className="nm">
            {id.toUpperCase()} · {props[id].name}
          </span>
          <span className="ds">{props[id].note}</span>
        </button>
      ))}
    </div>
  )
}

/** 窗口背景：一张张缩略图（bg 是那一格的 CSS background）；children 接在后面（画布笔记的「从电脑选」） */
export function WinBgPicker<T extends string>(props: { label: string; value: T; options: readonly { id: T; name: string; bg: string }[]; onChange(v: T): void; children?: ReactNode }) {
  return (
    <div className="bgs" role="radiogroup" aria-label={props.label} data-row="winbg">
      {props.options.map((b) => (
        <button key={b.id} role="radio" aria-checked={props.value === b.id} className={props.value === b.id ? 'on' : ''} onClick={() => props.onChange(b.id)}>
          <i style={{ background: b.bg }} />
          {b.name}
        </button>
      ))}
      {props.children}
    </div>
  )
}

export { FamilyPage, FamilyPic, type FamilyPageProps, type FamilyText } from './family'

/** 主题渐变的两行（画布笔记、画布今日一份）：字是各软件翻好的 */
export interface WallRowsProps {
  mix: 'soft' | 'mid' | 'rich'
  move: boolean
  speed: 'slow' | 'mid' | 'fast'
  onMix(v: 'soft' | 'mid' | 'rich'): void
  onMove(v: boolean): void
  onSpeed(v: 'slow' | 'mid' | 'fast'): void
  text: { move: string; speed: string; slow: string; mid: string; fast: string; mix: string; soft: string; normal: string; rich: string; reduced: string; still: string }
}

/** 渐变：一张浅底卡片两行（设计复审：和外观页别的行一样名字在左、控件在右）——「慢慢动」开关（开着时右边快慢三格），浓淡三格。关着、系统开了「减少动态效果」时名字后面说一句为什么不动 */
export function WallRows(props: WallRowsProps) {
  const T = props.text
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const h = () => setReduced(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  return (
    <div className="wall-rows" data-row="wall">
      <div className="wrow" data-row="wallMove">
        <span className="wlb">{T.move}</span>
        <span className="note wall-why">{props.move ? (reduced ? T.reduced : '') : T.still}</span>
        <span className="sp" />
        <Toggle on={props.move} label={T.move} onChange={props.onMove} />
        {props.move && (
          <Seg
            label={T.speed}
            value={props.speed}
            options={[
              ['slow', T.slow],
              ['mid', T.mid],
              ['fast', T.fast],
            ]}
            onChange={props.onSpeed}
          />
        )}
      </div>
      <div className="wrow" data-row="wallMix">
        <span className="wlb">{T.mix}</span>
        <span className="sp" />
        <Seg
          label={T.mix}
          value={props.mix}
          options={[
            ['soft', T.soft],
            ['mid', T.normal],
            ['rich', T.rich],
          ]}
          onChange={props.onMix}
        />
      </div>
    </div>
  )
}

/** 方角开关（用户偏好：开关的轨道和滑块都是小圆角方形） */
export function Toggle(props: { on: boolean; label: string; onChange(v: boolean): void; disabled?: boolean }) {
  return <button className={'sw-toggle' + (props.on ? ' on' : '')} role="switch" aria-checked={props.on} aria-label={props.label} disabled={props.disabled} onClick={() => props.onChange(!props.on)} />
}

/** 外观页里的一套主题：名字、卡片悬停那句都是翻好的；导入的 VS Code 主题能删 */
export interface LookSkin {
  id: string
  tab: string
  tone: 'light' | 'dark'
  name: string
  note?: string
  imported?: boolean
}

/** 外观页给人看的字（各软件自己翻） */
export interface LookText {
  /** 「主题」和后面那句：不跟系统时 themeHint，跟系统时 themeHintSys */
  theme: string
  themeHint: string
  themeHintSys: string
  light: string
  dark: string
  /** 「导入的VS Code主题」那一排的小标题 */
  imported: string
  /** 跟着系统时卡片名字后面的「白天」「夜里」 */
  day: string
  night: string
  follow: string
  dayUse: string
  nightUse: string
  frame: string
  frameHint: string
  winBg: string
  /** 窗口背景后面那句：B 浮岛书桌时、A 照 VS Code 时 */
  winBgHintA: string
  winBgHintB: string
}

/** 面板透明度那一行的字（各软件自己翻） */
export interface GlassText {
  label: string
  /** 滑杆两头 */
  solid: string
  clear: string
  /** 现在透多少：{n} 是百分数 */
  value(n: number): string
  def: string
  reset: string
  /** 这会儿面板不透（A、不用图）时下面那句 */
  off: string
  /** 透着时下面那句 */
  on: string
}

/**
 * 面板透明度（task-jgely）：有窗口背景时几块半透明面板透多少。滑杆两头是量过对比度的范围（@cn/design/glass），中间那道刻度是默认（用户认可的那版）。
 * 拖的时候直接套到窗口上（<html> 的 --isle-shift），停手 300ms 才存；enabled 为 false 时滑杆变灰（面板这会儿是实的）
 */
export function GlassRow(props: { text: GlassText; value: number; enabled: boolean; onChange(v: number): void }) {
  const T = props.text
  const [v, setV] = useState(props.value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<number | null>(null)
  const save = useRef(props.onChange)
  save.current = props.onChange
  useEffect(() => {
    if (pending.current === null) setV(props.value)
  }, [props.value])
  // 关设置时还没存的那一下也存上
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current !== null) save.current(pending.current)
    },
    [],
  )
  const set = (n: number) => {
    setV(n)
    applyGlass(n)
    pending.current = n
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = null
      save.current(n)
    }, 300)
  }
  // 现在这套主题默认透多少（--isle-k）：换了主题时 <html> 上的主题是软件在这一帧之后才套的，下一帧再读一次
  const [base, setBase] = useState(() => glassPct(0))
  useEffect(() => {
    const id = requestAnimationFrame(() => setBase(glassPct(0)))
    return () => cancelAnimationFrame(id)
  })
  const pct = base + v
  const span = GLASS_MAX - GLASS_MIN
  return (
    <>
      <div className={'pair glass-row' + (props.enabled ? '' : ' off')} data-row="glass">
        <span>{T.label}</span>
        <span className="gl-end">{T.solid}</span>
        <span className="gl-track" style={{ ['--at' as string]: `${((v - GLASS_MIN) / span) * 100}%`, ['--def-k' as string]: (GLASS_DEFAULT - GLASS_MIN) / span }}>
          <input
            type="range"
            min={GLASS_MIN}
            max={GLASS_MAX}
            step={1}
            value={v}
            disabled={!props.enabled}
            aria-label={T.label}
            aria-valuetext={T.value(pct) + (v === GLASS_DEFAULT ? ` · ${T.def}` : '')}
            onChange={(e) => set(Number(e.currentTarget.value))}
          />
          <i className="gl-def" aria-hidden />
        </span>
        <span className="gl-end">{T.clear}</span>
        {/* 轨道右头已经写着「透」，这里只写数 */}
        <output className="gl-val num">{pct}%</output>
        <button className="gl-reset" disabled={!props.enabled || v === GLASS_DEFAULT} onClick={() => set(GLASS_DEFAULT)}>
          {T.reset}
        </button>
      </div>
      <p className="note gl-note">{props.enabled ? T.on : T.off}</p>
    </>
  )
}

export interface AppearancePageProps<W extends string> {
  text: LookText
  /** 自带的十套在前，导入的在后 */
  skins: readonly LookSkin[]
  /** 现在用的这套 */
  current: string
  followSystem: boolean
  day: string
  night: string
  onPick(s: LookSkin): void
  onFollow(on: boolean): void
  onDay(id: string): void
  onNight(id: string): void
  frame: { value: 'a' | 'b'; pv: string; a: { name: string; note: string }; b: { name: string; note: string }; onChange(v: 'a' | 'b'): void }
  /** extra 接在缩略图后面（画布笔记的「从电脑选」） */
  winBg: { value: W; options: readonly { id: W; name: string; bg: string }[]; onChange(v: W): void; extra?: ReactNode }
  /** 窗口背景选了主题渐变时下面多两行：动不动、动多快，浓淡（task-aph2j）。不给就没有 */
  wall?: WallRowsProps
  /** 面板透明度（接在窗口背景缩略图下面） */
  glass?: { text: GlassText; value: number; enabled: boolean; onChange(v: number): void }
  /** 能力：导入 VS Code 主题。不给就没有导入那一行，导入的主题也不能删 */
  importTheme?: { label: string; note: string; run(): Promise<void>; remove(s: LookSkin): void; removeLabel(name: string): string; removeTip: string }
  /** 能力：首页样式（画布笔记有，画布今日没有）：小标题、后面那句和下面的内容 */
  home?: { title: string; hint: string; body: ReactNode }
}

/**
 * 外观整页（画布笔记、画布今日一份，task-wxr2a）：主题（浅色、深色、导入的三排卡片）、导入 VS Code 主题、跟着系统换浅深（白天用、夜里用），
 * 界面风格两张大图、窗口背景缩略图，有首页的软件再加首页样式。外面包一层 .sa-keep 由各软件自己放
 */
export function AppearancePage<W extends string>(props: AppearancePageProps<W>) {
  const T = props.text
  const [importing, setImporting] = useState(false)
  const imp = props.importTheme
  const user = props.skins.filter((s) => s.imported)
  const card = (s: LookSkin) => (
    <ThemeCard
      key={s.id}
      id={s.id}
      tab={s.tab}
      name={s.name}
      note={s.note}
      on={props.current === s.id}
      slot={props.followSystem ? (props.day === s.id ? T.day : props.night === s.id ? T.night : null) : null}
      onPick={() => props.onPick(s)}
      remove={s.imported && imp ? { label: imp.removeLabel(s.name), tip: imp.removeTip, onClick: () => imp.remove(s) } : undefined}
    />
  )
  const pick = (tone: 'light' | 'dark', label: string, value: string, onChange: (id: string) => void) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {props.skins
          .filter((s) => s.tone === tone)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
    </label>
  )
  return (
    <>
      <h4>
        {T.theme}
        <span>{props.followSystem ? T.themeHintSys : T.themeHint}</span>
      </h4>
      <div role="radiogroup" aria-label={T.theme} data-row="skin">
        <div className="skins-h">{T.light}</div>
        <div className="skins">{props.skins.filter((s) => !s.imported && s.tone === 'light').map(card)}</div>
        <div className="skins-h">{T.dark}</div>
        <div className="skins">{props.skins.filter((s) => !s.imported && s.tone === 'dark').map(card)}</div>
        {user.length > 0 && (
          <>
            <div className="skins-h">{T.imported}</div>
            <div className="skins">{user.map(card)}</div>
          </>
        )}
      </div>
      {imp && (
        <div className="pair plain imp-theme" data-row="importTheme">
          <button
            className="btn"
            disabled={importing}
            onClick={async () => {
              setImporting(true)
              try {
                await imp.run()
              } finally {
                setImporting(false)
              }
            }}
          >
            <Codicon name={importing ? 'loading' : 'add'} size={14} className={importing ? 'spin' : undefined} />
            {imp.label}
          </button>
          <span className="note">{imp.note}</span>
        </div>
      )}

      <div className="pair" data-row="follow">
        <Toggle on={props.followSystem} label={T.follow} onChange={props.onFollow} />
        <span>{T.follow}</span>
        {props.followSystem && (
          <>
            <span className="sp" />
            {pick('light', T.dayUse, props.day, props.onDay)}
            {pick('dark', T.nightUse, props.night, props.onNight)}
          </>
        )}
      </div>

      <h4>
        {T.frame}
        <span>{T.frameHint}</span>
      </h4>
      <FramePicker label={T.frame} value={props.frame.value} tab={(props.skins.find((s) => s.id === props.current) ?? props.skins[0]!).tab} pv={props.frame.pv} a={props.frame.a} b={props.frame.b} onChange={props.frame.onChange} />

      <h4>
        {T.winBg}
        <span>{props.frame.value === 'b' ? T.winBgHintB : T.winBgHintA}</span>
      </h4>
      <WinBgPicker label={T.winBg} value={props.winBg.value} options={props.winBg.options} onChange={props.winBg.onChange}>
        {props.winBg.extra}
      </WinBgPicker>
      {props.wall && <WallRows {...props.wall} />}
      {props.glass && <GlassRow {...props.glass} />}

      {props.home && (
        <>
          <h4>
            {props.home.title}
            <span>{props.home.hint}</span>
          </h4>
          {props.home.body}
        </>
      )}
    </>
  )
}
