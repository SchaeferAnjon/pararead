import { Check, ChevronDown, Copy, Download, ExternalLink, FileText, Mail, Star, Users, Cloud, Eye, EyeOff, FolderOpen, HardDrive, Info, Languages, Layers, MessageCircleQuestion, Monitor, Moon, RefreshCw, Settings, Sun, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PROVIDERS, providerOf } from '@shared/providers'
import type { SettingsView, WordStatus } from '@shared/types'
import { WORD_STYLES } from '@shared/wordCite'
import { t, UI_LANG_NAMES, UI_LANGS, uiLocale } from '@shared/i18n'
import { api, errText, type MemberStatus, type SyncStatus, type UpdateState } from '../api'
import { AppLogo } from '../lib/member'
import { PHASE_NAME, useMineruInstall } from './Onboarding'
import { MenuHost, showMenu } from '../lib/menu'
import { Segmented, Switch, ToastProvider, useToast } from '../lib/ui'

const LOGOS = import.meta.glob('../assets/providers/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
export const logoOf = (icon?: string): string | null => (icon ? (LOGOS[`../assets/providers/${icon}`] ?? null) : null)

// 翻译目标语言和 AI 回答语言：名字直接写进给 AI 的提示里，每种语言写它自己的名字，不翻译
export const TARGET_LANGS = ['简体中文', '繁體中文', 'English', '日本語', '한국어', 'Deutsch', 'Français', 'Español', 'Italiano']
const LANGS = TARGET_LANGS

type Sec = 'general' | 'ai' | 'member' | 'translate' | 'reflow' | 'storage' | 'sync' | 'word' | 'us' | 'about'
const SECS: { id: Sec; name: string; icon: typeof Settings; color: string }[] = [
  { id: 'general', name: t('通用'), icon: Settings, color: 'var(--c-gray)' },
  { id: 'ai', name: t('AI 服务'), icon: MessageCircleQuestion, color: 'var(--c-indigo)' },
  { id: 'member', name: t('会员'), icon: Star, color: 'var(--c-orange)' },
  { id: 'translate', name: t('翻译'), icon: Languages, color: 'var(--c-blue)' },
  { id: 'reflow', name: t('重排'), icon: Layers, color: 'var(--c-teal)' },
  { id: 'storage', name: t('存储'), icon: HardDrive, color: 'var(--c-gray)' },
  { id: 'sync', name: t('同步'), icon: RefreshCw, color: 'var(--c-green)' },
  { id: 'word', name: t('Word 插件'), icon: FileText, color: 'var(--c-blue)' },
  { id: 'us', name: t('关于我们'), icon: Users, color: 'var(--c-pink)' },
  { id: 'about', name: t('关于'), icon: Info, color: 'var(--c-gray)' }
]

// 设置窗：照会议字幕，左边带彩色方块的分区，右边「左标签、右控件」，组之间用分隔线
export function SettingsPage() {
  return (
    <ToastProvider>
      <Settings2 />
      <MenuHost />
    </ToastProvider>
  )
}

function Settings2() {
  const [s, setS] = useState<SettingsView | null>(null)
  const first = location.hash.split('/')[1] as Sec | undefined
  const [sec, setSec] = useState<Sec>(first && SECS.some((x) => x.id === first) ? first : 'general')
  useEffect(() => {
    void api.getSettings().then(setS)
    const offs = [api.onSettings(setS), api.onSettingsSection((x) => SECS.some((y) => y.id === x) && setSec(x as Sec))]
    return () => offs.forEach((f) => f())
  }, [])
  if (!s) return null
  const set = (p: Parameters<typeof api.setSettings>[0]): void => void api.setSettings(p).then(setS)
  const cur = SECS.find((x) => x.id === sec)!
  return (
    <div className="set-win">
      <aside className="set-nav">
        <div className="set-nav-top drag" />
        {SECS.map((x) => (
          <button key={x.id} className={'nav-item' + (x.id === sec ? ' on' : '')} onClick={() => setSec(x.id)}>
            <span className="ib" style={{ background: x.color }}>
              <x.icon size={14} />
            </span>
            <span className="l">{x.name}</span>
          </button>
        ))}
      </aside>
      <main className="set-main">
        <div className="set-hd drag">{cur.name}</div>
        <div className="set-bd">
          {sec === 'general' && <General s={s} set={set} />}
          {sec === 'ai' && <Ai s={s} set={set} setS={setS} />}
          {sec === 'member' && <Member s={s} set={set} />}
          {sec === 'translate' && <Translate s={s} set={set} />}
          {sec === 'reflow' && <Reflow s={s} setS={setS} />}
          {sec === 'storage' && <Storage s={s} set={set} />}
          {sec === 'sync' && <Sync s={s} set={set} />}
          {sec === 'word' && <WordPlugin s={s} set={set} />}
          {sec === 'us' && <AboutUs />}
          {sec === 'about' && <About s={s} set={set} />}
        </div>
      </main>
    </div>
  )
}

type P = { s: SettingsView; set: (p: Parameters<typeof api.setSettings>[0]) => void }

function FSec(props: { title?: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="fsec">
      {props.title && <h3>{props.title}</h3>}
      {props.desc && <div className="fd">{props.desc}</div>}
      {props.children}
    </section>
  )
}
function Row(props: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="frow">
      <div className="fl">{props.label}</div>
      <div className="fc">
        <div className="line">{props.children}</div>
        {props.hint && <div className="hint">{props.hint}</div>}
      </div>
    </div>
  )
}
function Pick<T extends string>(props: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; width?: number }) {
  const cur = props.options.find((o) => o.id === props.value)
  return (
    <button
      className="btn"
      style={{ width: props.width ?? 220, justifyContent: 'space-between' }}
      onClick={async (e) => {
        const act = await showMenu(
          props.options.map((o) => ({ id: o.id, label: o.label, checked: o.id === props.value })),
          { el: e.currentTarget }
        )
        if (act) props.onChange(act as T)
      }}
    >
      <span className="ellipsis">{cur?.label ?? props.value}</span>
      <ChevronDown size={14} />
    </button>
  )
}

function General({ s, set }: P) {
  return (
    <>
      <FSec title={t('语言')}>
        <Row label={t('界面语言')} hint={t('换了以后窗口会重新加载')}>
          <Pick value={s.uiLang} options={[{ id: 'auto', label: t('跟随系统') }, ...UI_LANGS.map((l) => ({ id: l as string, label: UI_LANG_NAMES[l] }))]} onChange={(v) => set({ uiLang: v })} />
        </Row>
      </FSec>
      <FSec title={t('外观')}>
        <Row label={t('外观')}>
          <Segmented
            value={s.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'system', label: <><Monitor size={14} />{t('跟随系统')}</> },
              { value: 'light', label: <><Sun size={14} />{t('浅色')}</> },
              { value: 'dark', label: <><Moon size={14} />{t('深色')}</> }
            ]}
          />
        </Row>
      </FSec>
      <FSec title={t('文献库')}>
        <Row label={t('默认视图')}>
          <Segmented
            className="sm"
            value={s.libView}
            onChange={(v) => set({ libView: v })}
            options={[
              { value: 'table', label: t('列表') },
              { value: 'card', label: t('卡片') }
            ]}
          />
        </Row>
        <Row label={t('标题翻译')} hint={t('列表里标题下面放译名，或者译名在前')}>
          <Segmented
            className="sm"
            value={s.titleTr}
            onChange={(v) => set({ titleTr: v })}
            options={[
              { value: 'off', label: t('不翻译') },
              { value: 'orig', label: t('原标题在前') },
              { value: 'tr', label: t('译名在前') }
            ]}
          />
        </Row>
      </FSec>
      <FSec title={t('阅读')}>
        <Row label={t('正文字号')}>
          <button className="btn icon" onClick={() => set({ readSize: Math.max(14, s.readSize - 1) })}>
            A
          </button>
          <span className="num" style={{ width: 28, textAlign: 'center' }}>
            {s.readSize}
          </span>
          <button className="btn icon" style={{ fontSize: 16 }} onClick={() => set({ readSize: Math.min(24, s.readSize + 1) })}>
            A
          </button>
        </Row>
        <Row label={t('AI 回答字号')}>
          <button className="btn icon" onClick={() => set({ chatSize: Math.max(12, s.chatSize - 1) })}>
            A
          </button>
          <span className="num" style={{ width: 28, textAlign: 'center' }}>
            {s.chatSize}
          </span>
          <button className="btn icon" style={{ fontSize: 16 }} onClick={() => set({ chatSize: Math.min(18, s.chatSize + 1) })}>
            A
          </button>
        </Row>
        <Row label={t('AI 问答')} hint={t('悬浮窗能拖到任意位置，不占右栏')}>
          <Segmented
            className="sm"
            value={s.chatFloat ? 'float' : 'side'}
            onChange={(v) => set({ chatFloat: v === 'float' })}
            options={[
              { value: 'side', label: t('右栏') },
              { value: 'float', label: t('悬浮窗') }
            ]}
          />
        </Row>
      </FSec>
    </>
  )
}

type TestResult = { ok: boolean; error?: string } | null

function Ai({ s, set, setS }: P & { setS: (v: SettingsView) => void }) {
  const toast = useToast()
  const [keyInput, setKeyInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [reveal, setReveal] = useState<string | null>(null)
  const [check, setCheck] = useState<TestResult>(null)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const prov = providerOf(s.provider)
  const list = PROVIDERS.filter((p) => !p.hidden)
  const textModels = models.length ? models.filter((m) => !/(^glm-[\d.]+v)|vision|embed|tts|whisper|ocr/i.test(m)) : [prov.text ?? s.textModel]
  const visionModels = models.length ? models.filter((m) => !/embed|tts|whisper/i.test(m)) : [prov.vision ?? s.visionModel]

  const test = async (): Promise<void> => {
    setBusy(true)
    const r = await api.testKey()
    setCheck(r)
    if (r.ok) setModels(r.models)
    setBusy(false)
  }

  return (
    <>
      <FSec title={t('服务商')} desc={t('翻译、解释、问答、速览、学术 AI 和研究 Agent 都用它。你的 Key 直连服务商，费用走你的账户。')}>
        <div className="prov">
          {list.map((p) => {
            const logo = logoOf(p.icon)
            return (
              <button
                key={p.id}
                className={'p' + (p.id === s.provider ? ' on' : '')}
                onClick={() => {
                  setModels([])
                  setCheck(null)
                  set({ provider: p.id })
                }}
              >
                <span className={'logo' + (p.mono ? ' mono' : '')}>{logo ? <img src={logo} alt="" /> : <Cloud size={16} />}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="pn">{p.name}</span>
                  <span className="pd">{p.blurb}</span>
                </span>
              </button>
            )
          })}
        </div>
      </FSec>
      <FSec>
        {s.provider === 'custom' && (
          <Row label={t('接口地址')} hint={t('OpenAI 兼容的 /v1 地址')}>
            <input className="input mono" style={{ width: 360 }} defaultValue={s.customBaseUrl} placeholder="https://example.com/v1" onBlur={(e) => set({ customBaseUrl: e.target.value.trim() })} />
          </Row>
        )}
        <Row
          label="API Key"
          hint={
            check ? (
              check.ok ? (
                <span className="ok-t">
                  <Check size={12} />{t(' 可用')}
                </span>
              ) : (
                <span className="err-t">{t('不可用：')}{check.error}</span>
              )
            ) : s.apiKeySource === 'env' ? (
              t('用的是环境变量 {0}', s.apiKeyEnv)
            ) : prov.keyPage ? (
              <a href={prov.keyPage} target="_blank" rel="noreferrer" className="text-btn" style={{ padding: 0 }}>
                {t('去 {0} 拿 Key', prov.name)}
              </a>
            ) : undefined
          }
        >
          {editing ? (
            <input
              autoFocus
              className="input mono"
              style={{ width: 300 }}
              type="password"
              value={keyInput}
              placeholder={t('粘贴 API Key')}
              onChange={(e) => setKeyInput(e.target.value)}
              onBlur={() => {
                if (keyInput.trim())
                  void api.setApiKey(keyInput).then((v) => {
                    setS(v)
                    setCheck(null)
                    void test()
                  })
                setEditing(false)
                setKeyInput('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <input className="input mono" style={{ width: 300 }} readOnly value={reveal ?? s.apiKeyMasked} placeholder={t('还没填')} onFocus={() => setEditing(true)} />
          )}
          <button
            className="icon-btn"
            title={reveal ? t('隐藏') : t('显示')}
            onClick={async () => setReveal(reveal ? null : await api.revealApiKey())}
            disabled={s.apiKeySource === 'none'}
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button className="btn" disabled={busy || s.apiKeySource === 'none'} onClick={() => void test().catch((e) => toast(errText(e)))}>
            {busy && <span className="spin spin-12" />}
            {t('验证')}
          </button>
        </Row>
        <Row label={t('文本模型')} hint={models.length ? undefined : t('点「验证」后能从服务商的模型列表里选')}>
          <Pick value={s.textModel} options={[...new Set([s.textModel, ...textModels])].map((m) => ({ id: m, label: m }))} onChange={(v) => set({ textModel: v })} width={260} />
        </Row>
        <Row label={t('看图模型')} hint={t('截图翻译、图的 AI 解释用它')}>
          <Pick value={s.visionModel} options={[...new Set([s.visionModel, ...visionModels])].map((m) => ({ id: m, label: m }))} onChange={(v) => set({ visionModel: v })} width={260} />
        </Row>
      </FSec>
      <FSec title={t('回答')}>
        <Row label={t('深度思考默认开')} hint={t('先想清楚再答，慢一些；问答输入框里也能临时开关')}>
          <Switch on={s.thinking} onChange={(v) => set({ thinking: v })} label={t('深度思考默认开')} />
        </Row>
        <Row label={t('回答语言')}>
          <Pick value={s.aiLang || '__same'} options={[{ id: '__same', label: t('跟翻译目标语言一样') }, ...LANGS.map((l) => ({ id: l, label: l }))]} onChange={(v) => set({ aiLang: v === '__same' ? '' : v })} />
        </Row>
      </FSec>
    </>
  )
}

function Translate({ s, set }: P) {
  return (
    <>
      <FSec title={t('翻译成')}>
        <Row label={t('目标语言')} hint={t('段落译文、划词翻译、标题译名都翻成它')}>
          <Pick value={s.targetLang} options={[...new Set([s.targetLang, ...LANGS])].map((l) => ({ id: l, label: l }))} onChange={(v) => set({ targetLang: v })} />
        </Row>
      </FSec>
      <FSec title={t('对照模式')}>
        <Row label={t('显示')}>
          <Segmented
            className="sm"
            value={s.display}
            onChange={(v) => set({ display: v })}
            options={[
              { value: 'src', label: t('只看原文') },
              { value: 'both', label: t('双语') },
              { value: 'tr', label: t('只看译文') }
            ]}
          />
        </Row>
        <Row label={t('译文样式')}>
          <Segmented
            className="sm"
            value={s.trStyle}
            onChange={(v) => set({ trStyle: v })}
            options={[
              { value: 'text', label: t('浅色字') },
              { value: 'fill', label: t('浅底色') }
            ]}
          />
        </Row>
        <Row label={t('英文字体')}>
          <Segmented
            className="sm"
            value={s.srcFont}
            onChange={(v) => set({ srcFont: v })}
            options={[
              { value: 'serif', label: t('衬线') },
              { value: 'sans', label: t('无衬线') }
            ]}
          />
        </Row>
      </FSec>
    </>
  )
}

function Reflow({ s, setS }: { s: SettingsView; setS: (v: SettingsView) => void }) {
  const [check, setCheck] = useState<TestResult>(null)
  const [busy, setBusy] = useState(false)
  const mu = s.mineruPath.replace(/^\/Users\/[^/]+/, '~')
  const inst = useMineruInstall()
  const working = !!inst && ['uv', 'python', 'packages', 'models'].includes(inst.phase)
  return (
    <>
      <FSec title={t('重排引擎')} desc={t('论文导入后转成网页，才能逐段对照和划词。先用快速重排，几秒就能读；精细重排好了自动换上。')}>
        <div className="choice">
          <Zap size={18} />
          <div>
            <div className="ct2">{t('快速 · 本地')}</div>
            <div className="cd2">{t('几秒好；公式是图片，双栏偶尔串行')}</div>
          </div>
        </div>
        <div className="choice">
          <Layers size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ct2">{t('精细 · 本地 MinerU')}</div>
            <div className="cd2">{t('公式转 LaTeX、表格能复制；一篇 1 到 3 分钟，占本机算力')}</div>
            {!s.mineruInstalled && (
              <div style={{ marginTop: 8 }}>
                {working ? (
                  <>
                    <span className="bar accent" style={{ marginBottom: 6 }}>
                      <i style={{ width: `${inst.percent}%` }} />
                    </span>
                    <div className="line">
                      <span className="hint num ellipsis" style={{ flex: 1 }}>
                        {PHASE_NAME()[inst.phase]} · {inst.percent}% · {inst.line}
                      </span>
                      <button className="btn sm" onClick={() => void api.mineruStopInstall()}>
                        {t('停止')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="line">
                    <span className={inst?.phase === 'failed' ? 'err-t' : 'hint'} style={{ flex: 1 }}>
                      {inst?.phase === 'failed' ? t('没装成：{0}', inst.error ?? '') : t('这台电脑还没有 MinerU，现在只能用简单重排（只有文字）')}
                    </span>
                    <button className="btn sm" onClick={() => void api.mineruInstall()}>
                      <Download size={14} />
                      {inst?.phase === 'failed' ? t('再试一次') : t('下载 MinerU（约 2.2 GB）')}
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="line" style={{ marginTop: 8 }}>
              <span className="mono hint ellipsis" style={{ flex: 1 }}>
                {mu || t('没设置')}
              </span>
              <button className="btn sm" onClick={() => void api.chooseMineru().then(setS)}>
                {t('更改…')}
              </button>
              <button
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setCheck(await api.testMineru())
                  setBusy(false)
                }}
              >
                {busy && <span className="spin spin-12" />}
                {t('检测')}
              </button>
            </div>
            {check && <div className={check.ok ? 'ok-t' : 'err-t'}>{check.ok ? t('能用') : t('不能用：{0}', check.error)}</div>}
          </div>
        </div>
        <div className="choice off">
          <Cloud size={18} />
          <div>
            <div className="ct2">{t('云端精细 · 会员')}</div>
            <div className="cd2">{t('效果同精细，在服务器上跑，不占电脑。会员开放后能选。')}</div>
          </div>
        </div>
      </FSec>
    </>
  )
}

function Storage({ s, set }: P) {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  useEffect(() => void api.appInfo().then(setInfo), [])
  const home = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
  const agentDir = s.agentDir || t('~/Documents/ParaRead 项目')
  return (
    <>
      <FSec title={t('数据位置')}>
        <Row label={t('文献库')} hint={t('论文、笔记、AI 会话和缓存都在这里')}>
          <span className="mono hint ellipsis" style={{ maxWidth: 360 }}>
            {info ? home(info.dataDir) : ''}
          </span>
          <button className="btn sm" disabled={!info} onClick={() => info && void api.reveal(info.dataDir)}>
            <FolderOpen size={14} />
            {t('打开')}
          </button>
        </Row>
        <Row label={t('研究项目')} hint={t('每个研究项目是这里面的一个文件夹，Agent 只能读写自己的项目文件夹')}>
          <span className="mono hint ellipsis" style={{ maxWidth: 360 }}>
            {home(agentDir)}
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              const d = await api.chooseDir(t('研究项目放在哪个文件夹'))
              if (d) set({ agentDir: d })
            }}
          >
            {t('更改…')}
          </button>
        </Row>
        <Row label={t('Zotero 数据目录')} hint={t('从 Zotero 导入时读它，只读不改')}>
          <span className="mono hint ellipsis" style={{ maxWidth: 360 }}>
            {s.zoteroDir ? home(s.zoteroDir) : t('自动找 ~/Zotero')}
          </span>
          <button className="btn sm" onClick={() => void api.zoteroChooseDir()}>
            {t('更改…')}
          </button>
        </Row>
      </FSec>
    </>
  )
}

function Sync({ s, set }: P) {
  const toast = useToast()
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.syncStatus().then(setSt)
    return api.onSyncStatus(setSt)
  }, [])
  const when = (ms: number | null): string => (ms ? new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('还没同步过'))
  return (
    <>
      <FSec title={t('多台电脑同步')} desc={t('同步文献和 PDF、文件夹、高亮和笔记、速览、阅读进度。不用登录，走 iCloud 云盘。')}>
        <button className={'choice' + (!s.syncEnabled ? ' on' : '')} onClick={() => set({ syncEnabled: false })}>
          <span className={'radio' + (!s.syncEnabled ? ' on' : '')} />
          <div>
            <div className="ct2">{t('不同步')}</div>
            <div className="cd2">{t('只在这台电脑上')}</div>
          </div>
        </button>
        <button className={'choice' + (s.syncEnabled ? ' on' : '')} onClick={() => set({ syncEnabled: true })}>
          <span className={'radio' + (s.syncEnabled ? ' on' : '')} />
          <div style={{ flex: 1 }}>
            <div className="ct2">{t('iCloud 云盘')}</div>
            <div className="cd2">{t('同一个 Apple ID 的 Mac 之间同步，存在 iCloud 云盘的「{0}」文件夹', (s.syncDir || t('ParaRead 同步')).split('/').pop())}</div>
          </div>
        </button>
      </FSec>
      {s.syncEnabled && (
        <FSec title={t('状态')}>
          <Row label={t('上次同步')} hint={st?.error ? <span className="err-t">{st.error}</span> : st?.waiting ? t('还有 {0} 个文件在等 iCloud 下载', st.waiting) : undefined}>
            <span className="num">{when(st?.lastSync ?? null)}</span>
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  setSt(await api.syncNow())
                } catch (e) {
                  toast(errText(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? <span className="spin spin-12" /> : <RefreshCw size={14} />}
              {t('现在同步')}
            </button>
          </Row>
          {!!st?.devices.length && (
            <Row label={t('同步的电脑')}>
              <span>{st.devices.map((d) => d.name).join('、')}</span>
            </Row>
          )}
        </FSec>
      )}
    </>
  )
}

const SITE_URL = 'https://pararead.us-cloud.uk'
const APPS_URL = 'https://apps.us-cloud.uk'
const CONTACT_EMAIL = 'infoschaeferanjon@gmail.com'

// 关于我们：总官网和联系邮箱（照会议字幕）
function AboutUs() {
  const toast = useToast()
  return (
    <>
      <FSec title={t('官网')}>
        <Row label={t('软件官网')} hint={t('这个网站列着我们做的所有软件。')}>
          <span className="mono">{APPS_URL}</span>
          <a className="btn sm" href={APPS_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t('打开')}
          </a>
        </Row>
        <Row label="ParaRead">
          <span className="mono">{SITE_URL}</span>
          <a className="btn sm" href={SITE_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t('打开')}
          </a>
        </Row>
      </FSec>
      <FSec title={t('联系方式')}>
        <Row label={t('邮箱')} hint={t('用得不顺手、想要什么功能，都可以写信告诉我们。')}>
          <span className="mono">{CONTACT_EMAIL}</span>
          <a className="btn sm" href={`mailto:${CONTACT_EMAIL}`}>
            <Mail size={14} />
            {t('发邮件')}
          </a>
          <button
            className="btn sm ghost"
            onClick={() => {
              void navigator.clipboard.writeText(CONTACT_EMAIL)
              toast(t('邮箱已复制'))
            }}
          >
            <Copy size={14} />
            {t('复制')}
          </button>
        </Row>
      </FSec>
    </>
  )
}

// 关于：版本、自动更新（正式版才有）、再走一遍引导
// Word 引用插件：装 / 移除、默认引用格式、要不要格式检查
function WordPlugin({ s, set }: P) {
  const [st, setSt] = useState<WordStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.wordStatus().then(setSt)
  }, [])
  const act = async (fn: () => Promise<WordStatus>): Promise<void> => {
    setBusy(true)
    try {
      setSt(await fn())
    } finally {
      setBusy(false)
    }
  }
  const good = !!st && st.installed && st.trusted && st.running && !st.error
  return (
    <>
      <div className="word-hero">
        <div className="word-ribbon" aria-hidden>
          <div className="wr-tabs">
            <span>{t('开始')}</span>
            <span>{t('插入')}</span>
            <span>{t('引用')}</span>
            <span className="on">ParaRead</span>
          </div>
          <div className="wr-btns">
            <span className="on">{t('插入引用')}</span>
            <span>{t('参考文献表')}</span>
            <span>{t('格式检查')}</span>
          </div>
        </div>
        <p>{t('在 Word 里写论文时，从文献库插入引用，自动生成参考文献表；换格式时全文跟着变。')}</p>
      </div>
      <FSec title={t('插件')}>
        <Row
          label="Microsoft Word"
          hint={
            !st || !st.word
              ? undefined
              : st.error
                ? st.error
                : good
                  ? t('重开 Word，在「开始 › 加载项」里点 ParaRead。用的时候要开着本应用。')
                  : t('安装时系统会问一次这台 Mac 的密码：Word 的加载项只认 HTTPS，要让系统信任一张只给本机用的证书。')
          }
        >
          {!st ? (
            <span className="spin spin-12" />
          ) : !st.word ? (
            <span className="hint">{t('没找到 Word')}</span>
          ) : (
            <>
              <span className={'dot ' + (good ? 'ok' : st.installed ? 'warn' : '')} />
              <span>{good ? t('已装好') : st.installed ? t('装了但没在工作') : t('没装')}{st.wordVersion ? ` · ${st.wordVersion}` : ''}</span>
              <span className="spacer" />
              {st.installed && (
                <button className="btn" disabled={busy} onClick={() => void act(api.wordRemove)}>
                  {t('移除')}
                </button>
              )}
              {!good && (
                <button className="btn primary" disabled={busy} onClick={() => void act(api.wordInstall)}>
                  {busy && <span className="spin spin-12" />}
                  {st.installed ? t('修复') : t('安装')}
                </button>
              )}
            </>
          )}
        </Row>
        <Row label={t('WPS 文字')}>
          <span className="hint">{st?.wps ? t('还不支持 WPS') : t('没找到 WPS')}</span>
        </Row>
      </FSec>
      <FSec title={t('引用')}>
        <Row label={t('默认格式')} hint={t('新文档用它；已经有引用的文档在插件里换，全文跟着变')}>
          <Pick value={s.wordStyle} options={WORD_STYLES.map((x) => ({ id: x.id, label: x.name }))} onChange={(v) => set({ wordStyle: v })} width={260} />
        </Row>
        <Row label={t('论文格式检查')} hint={t('检查参考文献缺项、编号被改、正文引了但表里没有')}>
          <Switch on={s.wordCheck} onChange={(v) => set({ wordCheck: v })} label={t('论文格式检查')} />
        </Row>
      </FSec>
    </>
  )
}

function About({ s, set }: P) {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  const [up, setUp] = useState<UpdateState | null>(null)
  useEffect(() => {
    void api.appInfo().then(setInfo)
    void api.updateStatus().then(setUp)
    return api.onUpdateState(setUp)
  }, [])
  const text = !up
    ? ''
    : up.phase === 'off'
      ? t('开发版不自动更新')
      : up.phase === 'checking'
        ? t('正在检查…')
        : up.phase === 'downloading'
          ? t('正在下载 {0}：{1}%', up.version, up.percent)
          : up.phase === 'ready'
            ? t('{0} 已下载好，重启就更新', up.version)
            : up.phase === 'latest'
              ? t('已是最新')
              : up.phase === 'error'
                ? t('没查成：{0}', up.error)
                : ''
  return (
    <>
      <FSec>
        <div className="about">
          <AppLogo size={44} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-lg)' }}>ParaRead</div>
            <div className="hint num">{t('版本 {0}', info?.version ?? '')}</div>
          </div>
        </div>
      </FSec>
      <FSec title={t('更新')}>
        <Row label={t('自动更新')} hint={t('有新版在后台下载，下好后下次打开就是新版')}>
          <Switch on={s.autoUpdate} onChange={(v) => set({ autoUpdate: v })} label={t('自动更新')} />
        </Row>
        <Row label={t('检查更新')} hint={text || undefined}>
          {up?.phase === 'ready' ? (
            <button className="btn primary" onClick={() => void api.updateInstall()}>
              {t('重启更新')}
            </button>
          ) : (
            <button className="btn" disabled={!up || ['off', 'checking', 'downloading'].includes(up.phase)} onClick={() => void api.updateCheck().then(setUp)}>
              {up?.phase === 'checking' && <span className="spin spin-12" />}
              {t('检查更新')}
            </button>
          )}
        </Row>
      </FSec>
      <FSec title={t('帮助')}>
        <Row label={t('首次引导')} hint={t('回到主窗口重新走一遍：AI、语言、重排、导入')}>
          <button className="btn" onClick={() => set({ onboarded: false })}>
            {t('再走一遍')}
          </button>
        </Row>
      </FSec>
    </>
  )
}

const money = (cents: number, cur: string): string => (cur === 'cny' ? `¥${(cents / 100).toFixed(cents % 100 ? 1 : 0)}` : `$${(cents / 100).toFixed(2)}`)
const day = (ms: number): string => new Date(ms).toLocaleDateString(uiLocale(), { year: 'numeric', month: 'long', day: 'numeric' })

// 会员：不送免费额度；买了以后 AI 走我们的服务器，不用 Key。授权码能在别的电脑上激活
function Member({ s, set }: P) {
  const toast = useToast()
  const [st, setSt] = useState<MemberStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [cur, setCur] = useState<'cny' | 'usd'>(navigator.language.startsWith('zh') ? 'cny' : 'usd')
  useEffect(() => {
    api.memberStatus().then(setSt).catch((e) => setErr(errText(e)))
    return api.onMemberStatus(setSt)
  }, [])
  const act = async (name: string, f: () => Promise<unknown>): Promise<void> => {
    setBusy(name)
    try {
      await f()
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(null)
    }
  }
  const buy = (plan: 'month' | 'year', mode: 'sub' | 'pass'): Promise<void> =>
    act(plan + mode, async () => {
      const r = await api.memberCheckout(plan, cur, mode)
      toast(r === 'paid' ? t('已成为会员，AI 改走会员通道') : r === 'expired' ? t('付款页过期了，没扣钱') : t('已取消'))
    })
  const isMember = st?.plan === 'member'
  return (
    <>
      <FSec title={isMember ? t('你是会员') : t('会员')} desc={t('会员不用 Key：翻译、问答、速览、学术 AI 和研究 Agent 都走我们的服务器。不想买就在「AI 服务」里填自己的 Key，永久免费。')}>
        {err && <div className="callout warn" style={{ marginTop: 12 }}>{err}</div>}
        {st && isMember && (
          <>
            <Row label={t('会员到期')} hint={st.autoRenew ? t('自动续费，随时能在「管理订阅」里取消') : st.expiring ? t('快到期了，续买一次就接上') : undefined}>
              <span>{st.memberUntil ? day(st.memberUntil) : ''}</span>
              {st.subscription && (
                <button className="btn sm" disabled={!!busy} onClick={() => void act('portal', api.memberPortal)}>
                  {t('管理订阅')}
                </button>
              )}
            </Row>
            {st.month && (
              <Row label={t('本月用量')} hint={t('每月有成本上限，{0}恢复；到了上限可以先填自己的 Key', day(st.month.resetAt))}>
                <span className="bar accent" style={{ width: 200 }}>
                  <i style={{ width: `${Math.min(100, (st.month.used / st.month.costCap) * 100)}%` }} />
                </span>
                <span className="hint num">{Math.round((st.month.used / st.month.costCap) * 100)}%</span>
              </Row>
            )}
            <Row label={t('AI 用谁的')}>
              <Segmented
                className="sm"
                value={s.provider === 'member' ? 'member' : 'own'}
                onChange={(v) => set({ provider: v === 'member' ? 'member' : 'deepseek' })}
                options={[
                  { value: 'member', label: t('会员') },
                  { value: 'own', label: t('自己的 Key') }
                ]}
              />
            </Row>
          </>
        )}
        {st && !isMember && (
          st.prices ? (
            <div className="buy">
              <div className="line">
                <Segmented
                  className="sm"
                  value={cur}
                  onChange={setCur}
                  options={[
                    { value: 'cny', label: t('人民币') },
                    { value: 'usd', label: t('美元') }
                  ]}
                />
              </div>
              <div className="buy-row">
                {(['month', 'year'] as const).map((p) => (
                  <button key={p} className="choice" disabled={!!busy} onClick={() => void buy(p, 'sub')}>
                    <div style={{ flex: 1 }}>
                      <div className="ct2">{p === 'month' ? t('按月') : t('按年')} · {money(st.prices![p][cur], cur)}</div>
                      <div className="cd2">{p === 'month' ? t('自动续费，随时取消') : t('自动续费，比按月省两个月')}</div>
                    </div>
                    {busy === p + 'sub' && <span className="spin spin-12" />}
                  </button>
                ))}
              </div>
              {cur === 'cny' && st.passPrices && (
                <div className="hint">
                  {t('用微信付：')}
                  {(['month', 'year'] as const).map((p) => (
                    <button key={p} className="text-btn" disabled={!!busy} onClick={() => void buy(p, 'pass')}>
                      {p === 'month' ? t('一次买 1 个月') : t('一次买 1 年')} {money(st.passPrices![p].cny, 'cny')}
                    </button>
                  ))}
                  {t('，不自动续费')}
                </div>
              )}
              {busy && (
                <div className="hint">
                  {t('在浏览器里付款，付好这里几秒内自动生效。')}
                  <button className="text-btn" onClick={() => void api.memberCancelWait()}>
                    {t('不买了')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="callout" style={{ marginTop: 12 }}>{t('购买还没开放，现在先在「AI 服务」里填自己的 Key。')}</div>
          )
        )}
        {!st && !err && <span className="spin spin-12" style={{ marginTop: 12 }} />}
      </FSec>
      <FSec title={t('授权码')} desc={t('买会员后邮件里会收到，在这台电脑上买的会自动填好。一个码最多用在 2 台电脑上。')}>
        <Row label={t('授权码')}>
          {st?.code ? (
            <>
              <span className="mono">{st.code}</span>
              <span className="hint num">
                {t('已用在 {0} / {1} 台', st.devices, st.maxDevices)}
              </span>
              <button className="btn sm" disabled={!!busy} onClick={() => void act('unbind', api.memberUnbind)}>
                {t('从这台电脑移除')}
              </button>
            </>
          ) : (
            <>
              <input className="input mono" style={{ width: 240 }} placeholder="PR-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn" disabled={!code.trim() || !!busy} onClick={() => void act('code', () => api.memberActivate(code.trim()).then(() => set({ provider: 'member' })))}>
                {busy === 'code' && <span className="spin spin-12" />}
                {t('激活')}
              </button>
            </>
          )}
        </Row>
      </FSec>
    </>
  )
}
