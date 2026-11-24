/**
 * 设置 › 软件家族（2026-11-23 用户选方向 A「一张表看全」，原型 25-软件家族/proto.html#dir=a，task-59o3v）：
 * 画布笔记、画布今日一个样子（ParaRead 照抄一份，见 docs/DEVELOPMENT.md「软件家族」）。
 * 能和本软件接上的：一个软件一张细线表，头一行图标、一句话、「● 已装 0.3.0 · 打开」或「下载」；下面每样联动一行，左边 112×64 小图、
 * 中间一两句、右边开关（没装写「装了以后能开」，开关在别处的链过去）。家族里还有：一行一个。最下面一句名单从哪来。
 * 拨开关马上存进库里那份，底下提示条说「已存 · 会怎样」带「撤回」；点「下载」那一格变成「等你装好 · 装好了，再看一下」，
 * 认出来了整张表闪一下。给人看的字：名单里的（家族名单 FamilyView）和软件自己翻好的（text），这里不翻。样式在 settings.css 末尾（fm-*）。
 */
import type { FamilyView, ViewApp, ViewRow } from '@cn/family'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Codicon } from './index'
import { useSaid } from './settings'

export interface FamilyText {
  /** 「能和画布笔记接上的」 */
  linked: string
  /** 「开关存在库里，两边看到的是同一个」 */
  linkedNote: string
  /** 「家族里还有」 */
  more: string
  /** 「暂时不和画布笔记联动」 */
  moreNote: string
  installed(version: string | null): string
  open: string
  download: string
  waiting: string
  recheck: string
  after: string
  update(name: string): string
  novault: string
  /** 最下面那一句（名单从哪来、上次几点看的）；接着放「去总站看看 ›」 */
  source: string
  hub: string
  /** 提示条的话 */
  opened(name: string): string
  openFailed(name: string): string
  downloadOpened(name: string, url: string): string
  found(name: string, version: string | null, linked: boolean): string
  notYet(name: string): string
}

export interface FamilyPageProps {
  view: FamilyView
  /** 软件 id → 图标的地址（各软件从 @cn/family/icons 打包进来） */
  icons: Record<string, string>
  text: FamilyText
  onToggle(id: string, on: boolean): Promise<void>
  /** 打开那个软件；打不开（挪走了、刚扔进废纸篓）返回 false */
  onOpen(app: string): Promise<boolean>
  onDownload(app: string): void
  /** 再问一次系统装了哪些（父组件换掉 view）；返回这一个现在的样子 */
  onRecheck(app: string): Promise<{ version: string | null } | null>
  /** 链到本软件设置里别的那一行（「在插件里设 ›」「去库 ›」） */
  onGo(go: string): void
  onHub(): void
}

const host = (u: string) => u.replace(/^https:\/\//, '').replace(/\/$/, '')

export function FamilyPage(props: FamilyPageProps) {
  const said = useSaid()
  const T = props.text
  /** 点了「下载」、还没认出装好的 */
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(new Set())
  const root = useRef<HTMLDivElement>(null)
  const flash = (app: string) => {
    const el = root.current?.querySelector<HTMLElement>(`[data-app="${CSS.escape(app)}"]`)
    if (!el) return
    el.classList.remove('sa-flash')
    void el.offsetWidth
    el.classList.add('sa-flash')
    setTimeout(() => el.classList.remove('sa-flash'), 1600)
  }
  // 装好了的就不等了（设置窗口重新拿到焦点时软件自己又问了一次）
  useEffect(() => {
    const all = [...props.view.linked, ...props.view.more]
    const done = [...waiting].filter((id) => all.find((a) => a.id === id)?.installed)
    if (!done.length) return
    setWaiting((w) => new Set([...w].filter((id) => !done.includes(id))))
    for (const id of done) {
      flash(id)
      const a = all.find((x) => x.id === id)!
      said.ok(T.found(a.name, a.installed!.version, props.view.linked.some((x) => x.id === id)))
    }
  }, [props.view])

  const act = (a: ViewApp, small: boolean) => {
    if (a.installed)
      return (
        <>
          <span className="fm-st">
            <i className="dot" />
            {T.installed(a.installed.version)}
          </span>
          <button
            type="button"
            className="sa-btn"
            onClick={async () => {
              if (await props.onOpen(a.id)) said.say(T.opened(a.name))
              else said.say(T.openFailed(a.name))
            }}
          >
            {T.open}
          </button>
        </>
      )
    if (waiting.has(a.id))
      return (
        <span className="fm-wait">
          <span className="fm-spin" aria-hidden="true" />
          <span className="fm-st">{T.waiting}</span>
          <button
            type="button"
            className="sa-lnk"
            onClick={async () => {
              const now = await props.onRecheck(a.id)
              if (!now) said.say(T.notYet(a.name))
            }}
          >
            {T.recheck}
          </button>
        </span>
      )
    return (
      <button
        type="button"
        className={'sa-btn' + (small ? ' sm' : '')}
        onClick={() => {
          props.onDownload(a.id)
          setWaiting((w) => new Set(w).add(a.id))
          said.say(T.downloadOpened(a.name, host(a.download)))
        }}
      >
        <Codicon name="cloud-download" size={14} />
        {T.download}
      </button>
    )
  }

  const right = (r: ViewRow) => {
    const x = r.right
    if (!x) return null
    if (x.type === 'toggle')
      return (
        <button
          type="button"
          className={'sw-toggle' + (x.on ? ' on' : '')}
          role="switch"
          aria-checked={x.on}
          aria-label={r.label}
          onClick={() => {
            const now = !x.on
            void props.onToggle(r.id, now)
            said.saved(now ? r.on : r.offDone, () => void props.onToggle(r.id, !now))
          }}
        />
      )
    if (x.type === 'go')
      return (
        <button type="button" className="sa-lnk" onClick={() => props.onGo(x.go)}>
          {x.text}
          <Codicon name="chevron-right" size={12} />
        </button>
      )
    return <span className="fm-val">{x.type === 'after' ? T.after : x.type === 'update' ? T.update(x.name) : T.novault}</span>
  }

  const icon = (a: ViewApp, size: number) => <img src={props.icons[a.id]} alt="" width={size} height={size} draggable={false} />

  return (
    <div className="fm" ref={root}>
      <div className="sa-grph">
        {T.linked}
        <small>{T.linkedNote}</small>
      </div>
      {props.view.linked.map((a) => (
        <div key={a.id} className="sa-card fm-card" role="group" aria-label={a.name} data-app={a.id} data-row={`fam-${a.id}`}>
          <div className="fm-app">
            {icon(a, 32)}
            <div className="fm-txt">
              <div className="fm-nm">{a.name}</div>
              <div className="sa-ds">{a.one}</div>
            </div>
            <div className="sa-cc">{act(a, false)}</div>
          </div>
          {a.rows.map((r) => (
            <div key={r.id} className="fm-link" data-row={r.id}>
              <FamilyPic name={r.pic} />
              <div className="fm-txt">
                <div className="sa-lb">{r.label}</div>
                <div className="sa-ds">
                  {r.dot && <i className="dot" />}
                  {r.desc}
                </div>
              </div>
              <div className="sa-cc">{right(r)}</div>
            </div>
          ))}
        </div>
      ))}
      <div className="sa-grph">
        {T.more}
        <small>{T.moreNote}</small>
      </div>
      <div className="sa-card fm-more" role="group" aria-label={T.more}>
        {props.view.more.map((a) => (
          <div key={a.id} className="fm-row" data-app={a.id} data-row={`fam-${a.id}`}>
            {icon(a, 20)}
            <div className="fm-t">
              <b>{a.name}</b>
              <span>{a.one}</span>
            </div>
            <div className="sa-cc">{act(a, true)}</div>
          </div>
        ))}
      </div>
      <div className="sa-note fm-note">
        {T.source}
        <button type="button" className="sa-lnk" onClick={props.onHub}>
          {T.hub}
          <Codicon name="chevron-right" size={12} />
        </button>
      </div>
    </div>
  )
}

// ---------- 小图：112 × 64，颜色全用主题变量；鼠标放在那一行上时一个强调色的小点沿箭头走 ----------

const doc = (x: number, y: number, w: number, h: number, n: number, head: boolean, k: string) => (
  <g key={k}>
    <rect x={x} y={y} width={w} height={h} rx={4} fill="var(--card)" stroke="var(--line2)" />
    {head && <rect x={x + 5} y={y + 6} width={w * 0.5} height={4} rx={2} fill="var(--w3)" />}
    {Array.from({ length: n }, (_, i) => (
      <rect key={i} x={x + 5} y={y + (head ? 15 : 7) + i * 7} width={(w - 10) * (i % 2 ? 0.7 : 0.9)} height={3} rx={1.5} fill="var(--w2)" />
    ))}
  </g>
)
const arrow = (x1: number, x2: number, y: number, k: string) => (
  <g key={k}>
    <path d={`M${x1} ${y}H${x2}`} stroke="var(--w2)" strokeWidth={1.5} strokeDasharray="2 3" />
    <path d={`M${x2 - 3} ${y - 3}l3 3-3 3`} fill="none" stroke="var(--w3)" strokeWidth={1.5} strokeLinecap="round" />
    <circle className="fm-flow" style={{ ['--d' as string]: `${x2 - x1}px` }} cx={x1} cy={y} r={2.5} fill="var(--acc)" />
  </g>
)
const r = (x: number, y: number, w: number, h: number, rx: number, fill: string, k: string | number, extra: Record<string, string | number> = {}) => <rect key={k} x={x} y={y} width={w} height={h} rx={rx} fill={fill} {...extra} />
const box = (x: number, y: number, k: string, accent: boolean) => <rect key={k} x={x} y={y} width={6} height={6} rx={1.5} fill="none" stroke={accent ? 'var(--acc)' : 'var(--w3)'} strokeWidth={1.3} />

const PICS: Record<string, () => ReactNode[]> = {
  today: () => [
    doc(8, 10, 40, 44, 2, true, 'd'),
    box(13, 38, 'b', true),
    r(22, 39.5, 20, 3, 1.5, 'var(--w3)', 'l'),
    arrow(51, 62, 32, 'a'),
    r(66, 10, 38, 44, 4, 'var(--card)', 'c', { stroke: 'var(--line2)' }),
    r(66, 10, 38, 9, 4, 'var(--w1)', 'h'),
    ...[0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((c) => r(69 + c * 8.6, 23 + row * 10, 6.6, 7, 1.5, 'var(--fill2)', `g${row}${c}`))),
    r(77.6, 33, 15.2, 7, 1.5, 'var(--acc)', 'on'),
  ],
  vault: () => [
    r(44, 20, 24, 18, 3, 'var(--w1)', 'f', { stroke: 'var(--w3)' }),
    <path key="t" d="M44 23h9l2-3" stroke="var(--w3)" fill="none" />,
    r(10, 18, 22, 22, 6, 'var(--card)', 'a1', { stroke: 'var(--line2)' }),
    r(80, 18, 22, 22, 6, 'var(--card)', 'a2', { stroke: 'var(--line2)' }),
    r(15, 25, 12, 2.5, 1.25, 'var(--w2)', 'l1'),
    r(15, 30, 9, 2.5, 1.25, 'var(--w2)', 'l2'),
    r(85, 24, 5, 5, 1, 'none', 'b1', { stroke: 'var(--acc)' }),
    r(85, 31, 5, 5, 1, 'none', 'b2', { stroke: 'var(--w3)' }),
    arrow(33, 42, 29, 'a'),
    <g key="m" transform="translate(112 0) scale(-1 1)">
      {arrow(33, 42, 29, 'b')}
    </g>,
  ],
  prmenu: () => [
    doc(8, 8, 50, 48, 4, true, 'd'),
    r(46, 12, 56, 40, 6, 'var(--pop)', 'm', { stroke: 'var(--line2)' }),
    r(52, 18, 34, 3, 1.5, 'var(--w2)', 'l1'),
    r(49, 26, 50, 10, 3, 'var(--acc-soft)', 's'),
    r(53, 29.5, 38, 3, 1.5, 'var(--acc)', 'l2'),
    r(52, 42, 28, 3, 1.5, 'var(--w2)', 'l3'),
  ],
  prnote: () => [
    r(8, 8, 42, 48, 4, 'var(--card)', 'p', { stroke: 'var(--line2)' }),
    ...[0, 1, 2].flatMap((i) => [r(13, 14 + i * 13, 32, 3, 1.5, 'var(--w2)', `o${i}`), r(13, 19 + i * 13, 26, 3, 1.5, 'var(--acc)', `t${i}`, { opacity: 0.55 })]),
    arrow(53, 63, 32, 'a'),
    doc(66, 8, 38, 48, 4, true, 'd'),
  ],
  mc: () => [
    r(8, 12, 40, 14, 7, 'var(--card)', 'b1', { stroke: 'var(--line2)' }),
    r(14, 17.5, 26, 3, 1.5, 'var(--w3)', 'l1'),
    r(8, 30, 40, 14, 7, 'var(--card)', 'b2', { stroke: 'var(--line2)' }),
    r(14, 35.5, 20, 3, 1.5, 'var(--acc)', 'l2', { opacity: 0.6 }),
    arrow(51, 62, 30, 'a'),
    doc(66, 8, 38, 48, 4, true, 'd'),
  ],
  mctodo: () => [
    r(8, 12, 40, 14, 7, 'var(--card)', 'b1', { stroke: 'var(--line2)' }),
    r(14, 17.5, 26, 3, 1.5, 'var(--w3)', 'l1'),
    r(8, 30, 40, 14, 7, 'var(--card)', 'b2', { stroke: 'var(--line2)' }),
    r(14, 35.5, 24, 3, 1.5, 'var(--w3)', 'l2'),
    arrow(51, 62, 30, 'a'),
    r(66, 8, 38, 48, 4, 'var(--card)', 'c', { stroke: 'var(--line2)' }),
    ...[0, 1, 2].flatMap((i) => [box(71, 15 + i * 12, `x${i}`, i === 1), r(80, 16.5 + i * 12, 18, 3, 1.5, 'var(--w2)', `t${i}`)]),
  ],
  bk: () => [
    r(8, 8, 96, 48, 5, 'var(--card)', 'w', { stroke: 'var(--line2)' }),
    r(30, 13, 52, 6, 3, 'var(--fill2)', 's'),
    ...[0, 1].flatMap((row) => [0, 1, 2, 3].map((c) => r(15 + c * 21, 25 + row * 14, 17, 10, 2.5, row === 0 && c === 1 ? 'var(--acc-soft)' : 'var(--fill2)', `g${row}${c}`, row === 0 && c === 1 ? { stroke: 'var(--acc)' } : {}))),
  ],
  cc: () => [
    r(10, 10, 40, 44, 5, 'var(--card)', 'c1', { stroke: 'var(--line2)' }),
    r(15, 16, 24, 3.5, 1.75, 'var(--w3)', 'h1'),
    <path key="s1" d="M15 29h30" stroke="var(--line2)" />,
    r(15, 35, 28, 3, 1.5, 'var(--w2)', 'l1'),
    r(15, 41, 20, 3, 1.5, 'var(--w2)', 'l2'),
    r(70, 14, 32, 38, 5, 'var(--fill2)', 'sh'),
    r(66, 10, 32, 38, 5, 'var(--card)', 'c2', { stroke: 'var(--line2)' }),
    r(71, 16, 18, 3.5, 1.75, 'var(--w3)', 'h2'),
    <path key="s2" d="M71 27h22" stroke="var(--line2)" />,
    r(71, 32, 20, 3, 1.5, 'var(--w2)', 'l3'),
    <text key="eq" x={58} y={36} fontSize={9} textAnchor="middle" fill="var(--t3)">
      =
    </text>,
  ],
  open: () => [
    r(8, 10, 40, 44, 4, 'var(--card)', 'c', { stroke: 'var(--line2)' }),
    ...[0, 1, 2].flatMap((i) => [box(13, 17 + i * 11, `x${i}`, i === 1), r(22, 18.5 + i * 11, 20, 3, 1.5, 'var(--w2)', `t${i}`)]),
    arrow(51, 62, 32, 'a'),
    doc(66, 8, 38, 48, 4, true, 'd'),
    r(68, 28, 34, 8, 2, 'var(--acc-soft)', 'hl'),
  ],
  look: () =>
    [8, 60].flatMap((x) => [
      r(x, 12, 44, 40, 5, 'var(--title)', `w${x}`, { stroke: 'var(--line2)' }),
      r(x + 4, 20, 12, 28, 2, 'var(--fill2)', `s${x}`),
      r(x + 19, 20, 21, 28, 2, 'var(--card)', `m${x}`),
      r(x + 21, 23, 10, 3, 1.5, 'var(--acc)', `a${x}`),
    ]).concat(
      <text key="eq" x={56} y={35} fontSize={9} textAnchor="middle" fill="var(--t3)">
        =
      </text>,
    ),
}

/** 一样联动的小图（名单里写 pic 的名字；名单里新出现、这一版还不会画的，空着一块底色） */
export function FamilyPic({ name }: { name: string }) {
  return (
    <span className="fm-pic" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 112 64" preserveAspectRatio="xMidYMid meet">
        {PICS[name]?.()}
      </svg>
    </span>
  )
}
