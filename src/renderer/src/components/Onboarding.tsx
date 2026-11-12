import { Check, Cloud, Download, Eye, EyeOff, FileText, KeyRound, Languages, Layers, LibraryBig, MessagesSquare, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t, UI_LANG_NAMES, UI_LANGS } from '@shared/i18n'
import { PROVIDERS, providerOf } from '@shared/providers'
import type { ScholareadPreview, SettingsView } from '@shared/types'
import { api, errText, type MineruInstallState } from '../api'
import { AppLogo, money, useMember } from '../lib/member'
import { useToast } from '../lib/ui'
import { logoOf, TARGET_LANGS } from './SettingsPage'

const STEPS = (): [string, string][] => [
  [t('欢迎'), t('看一眼怎么用')],
  [t('AI'), t('选怎么用 AI')],
  [t('语言'), t('读什么、翻成什么')],
  [t('重排'), t('装本地引擎')],
  [t('导入'), t('放进第一篇论文')]
]

// 首次引导：左边步骤清单（能点着跳），右边一屏一件事，底部「上一步 / 先跳过 / 继续」。照会议字幕的引导。
// 没有 MinerU 的电脑一打开就开始下载（主进程），第 4 步只是显示进度，不用等它。
export function Onboarding(props: { settings: SettingsView; onPricing: () => void; onDone: (then?: 'zotero') => void }) {
  const [n, setN] = useState(0)
  const [seen, setSeen] = useState(0)
  const go = (i: number): void => {
    setN(i)
    setSeen((x) => Math.max(x, i))
  }
  const steps = STEPS()
  const last = n === steps.length - 1
  const finish = (then?: 'zotero'): void => {
    void api.setSettings({ onboarded: true })
    props.onDone(then)
  }
  return (
    <div className="onb">
      <aside className="onb-side">
        <div className="onb-top drag" />
        <div className="onb-brand">
          <AppLogo size={36} />
          <div>
            <div style={{ fontWeight: 600 }}>ParaRead</div>
            <div className="hint">{t('第一次设置')}</div>
          </div>
        </div>
        <div className="onb-steps">
          {steps.map(([title, d], i) => (
            <button key={i} className={'ostep' + (i === n ? ' on' : '') + (i < seen && i !== n ? ' done' : '')} onClick={() => go(i)}>
              <span className="on2">{i < seen && i !== n ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
              <span>
                <span className="ot">{title}</span>
                <span className="od">{d}</span>
              </span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn ghost sm onb-skip" onClick={() => finish()}>
          {t('跳过，之后在设置里继续')}
        </button>
      </aside>
      <main className="onb-main">
        <div className="onb-top drag" />
        <div className="ob">
          {n === 0 && <Welcome />}
          {n === 1 && <AiStep s={props.settings} onPricing={props.onPricing} />}
          {n === 2 && <LangStep s={props.settings} />}
          {n === 3 && <ReflowStep s={props.settings} />}
          {n === 4 && <ImportStep onDone={finish} />}
        </div>
        <div className="of">
          <span className="spacer" />
          {n > 0 && (
            <button className="btn" onClick={() => go(n - 1)}>
              {t('上一步')}
            </button>
          )}
          {last ? (
            <button className="btn primary" onClick={() => finish()}>
              {t('打开文献库')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => go(n + 1)}>
              {n === 0 ? t('开始设置') : t('继续')}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

function Welcome() {
  const tiles: [typeof Layers, string, string][] = [
    [Layers, t('重排'), t('PDF 转成网页，公式、表格都在')],
    [Languages, t('逐段翻译'), t('译文紧跟原段，划词也能翻')],
    [MessagesSquare, t('问 AI'), t('问这篇，或几篇一起问')],
    [LibraryBig, t('文献库'), t('Zotero、Scholaread 一键搬过来')]
  ]
  return (
    <>
      <div className="illu">
        <div className="illu-doc">
          <p lang="en">Given a logical function, SIMPLER automatically generates a sequence of atomic MAGIC NOR operations…</p>
          <p className="zh">{t('给定一个逻辑函数，SIMPLER 自动生成一串原子的 MAGIC NOR 操作……')}</p>
        </div>
        <div className="illu-chat">
          <span className="ubub">{t('方法怎么做的？')}</span>
          <span>{t('把 NOR 网表按依赖图排序，再给中间结果分配单元…')}</span>
        </div>
      </div>
      <h2>{t('英文论文，逐段对照着读')}</h2>
      <div className="lead">{t('左边目录和笔记，中间原文或对照，右边随时问 AI。接下来 5 步，大约 2 分钟。')}</div>
      <div className="tiles">
        {tiles.map(([Icon, title, d]) => (
          <div className="tile" key={title}>
            <Icon size={16} />
            <div>
              <div className="ct2">{title}</div>
              <div className="cd2">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function AiStep({ s, onPricing }: { s: SettingsView; onPricing: () => void }) {
  const toast = useToast()
  const m = useMember()
  const [mode, setMode] = useState<'member' | 'own' | 'code'>(s.provider === 'member' ? 'member' : 'own')
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const own = s.provider === 'member' ? 'deepseek' : s.provider
  const prov = providerOf(own)
  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    await api.setApiKey(key.trim())
    const r = await api.testKey()
    setCheck(r)
    setBusy(false)
    if (r.ok) toast(t('Key 可用'))
  }
  const price = m.st?.prices ? money(m.st.prices.month[m.cur], m.cur) : '$4.99'
  return (
    <>
      <h2>{t('AI 用谁的')}</h2>
      <div className="lead">{t('翻译、解释、问答都要用 AI。以后在设置里随时能换。')}</div>
      <button className={'choice' + (mode === 'member' ? ' on' : '')} onClick={() => setMode('member')}>
        <span className={'radio' + (mode === 'member' ? ' on' : '')} />
        <div style={{ flex: 1 }}>
          <div className="ct2">
            <Star size={14} /> {t('会员')} <span className="tag accent sm">{t('省心')}</span>
          </div>
          <div className="cd2">{m.isMember ? t('你已经是会员，AI 走会员通道，不用 Key') : t('不用申请 Key，装好就能用；{0} / 月，随时取消', price)}</div>
          {mode === 'member' && !m.isMember && (
            <span className="btn sm" style={{ marginTop: 8 }} onClick={onPricing}>
              {t('看看会员')}
            </span>
          )}
        </div>
      </button>
      <div className={'choice' + (mode === 'own' ? ' on' : '')} onClick={() => setMode('own')}>
        <span className={'radio' + (mode === 'own' ? ' on' : '')} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ct2">
            <KeyRound size={14} /> {t('自带 Key')} <span className="tag sm">{t('永久免费')}</span>
          </div>
          <div className="cd2">{t('用你自己的 AI 服务，选一家填 Key，费用走你的账户')}</div>
          {mode === 'own' && (
            <>
              <div className="prov-mini">
                {PROVIDERS.filter((p) => !p.hidden && p.id !== 'custom').map((p) => {
                  const logo = logoOf(p.icon)
                  return (
                    <button
                      key={p.id}
                      className={'pm' + (p.id === own ? ' on' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setCheck(null)
                        void api.setSettings({ provider: p.id })
                      }}
                    >
                      <span className={'logo sm' + (p.mono ? ' mono' : '')}>{logo ? <img src={logo} alt="" /> : <Cloud size={12} />}</span>
                      {p.name}
                    </button>
                  )
                })}
              </div>
              <div className="line" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                <input
                  className="input mono"
                  type={show ? 'text' : 'password'}
                  placeholder={s.apiKeySource !== 'none' && s.provider === own ? s.apiKeyMasked : t('粘贴 {0} 的 API Key', prov.name)}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
                />
                <button className="icon-btn" title={show ? t('隐藏') : t('显示')} onClick={() => setShow((v) => !v)}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button className="btn" disabled={busy || !key.trim()} onClick={() => void saveKey()}>
                  {busy && <span className="spin spin-12" />}
                  {t('验证')}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {check ? (
                  check.ok ? (
                    <span className="ok-t">
                      <Check size={12} /> {t('可用')}
                    </span>
                  ) : (
                    <span className="err-t">{t('不可用：{0}', check.error ?? '')}</span>
                  )
                ) : (
                  prov.keyPage && (
                    <a href={prov.keyPage} target="_blank" rel="noreferrer" className="text-btn" style={{ padding: 0 }} onClick={(e) => e.stopPropagation()}>
                      {t('去 {0} 拿 Key', prov.name)}
                    </a>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className={'choice' + (mode === 'code' ? ' on' : '')} onClick={() => setMode('code')}>
        <span className={'radio' + (mode === 'code' ? ' on' : '')} />
        <div style={{ flex: 1 }}>
          <div className="ct2">{t('我有授权码')}</div>
          <div className="cd2">{t('买过会员，粘贴授权码激活')}</div>
          {mode === 'code' && (
            <div className="line" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              <input className="input mono" placeholder="PR-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn" disabled={!code.trim() || !!m.busy} onClick={() => void m.activate(code.trim()).catch((e) => toast(errText(e)))}>
                {m.busy === 'code' && <span className="spin spin-12" />}
                {t('激活')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function LangStep({ s }: { s: SettingsView }) {
  return (
    <>
      <h2>{t('语言')}</h2>
      <div className="lead">{t('界面用什么语言，论文翻成什么语言。以后在设置里随时能换。')}</div>
      <div className="sec-t">{t('界面语言')}</div>
      <div className="lang-grid">
        <button className={'pm' + (s.uiLang === 'auto' ? ' on' : '')} onClick={() => void api.setSettings({ uiLang: 'auto' })}>
          {t('跟随系统')}
        </button>
        {UI_LANGS.map((l) => (
          <button key={l} className={'pm' + (s.uiLang === l ? ' on' : '')} onClick={() => void api.setSettings({ uiLang: l })}>
            {UI_LANG_NAMES[l]}
          </button>
        ))}
      </div>
      <div className="sec-t" style={{ marginTop: 8 }}>
        {t('论文翻译成')}
      </div>
      <div className="lang-grid">
        {TARGET_LANGS.map((l) => (
          <button key={l} className={'pm' + (s.targetLang === l ? ' on' : '')} onClick={() => void api.setSettings({ targetLang: l })}>
            {l}
          </button>
        ))}
      </div>
    </>
  )
}

export const PHASE_NAME = (): Record<MineruInstallState['phase'], string> => ({
  none: t('还没装'),
  uv: t('下载安装工具'),
  python: t('准备 Python 环境'),
  packages: t('下载 MinerU 和 PyTorch'),
  models: t('下载识别模型'),
  done: t('装好了'),
  failed: t('没装成')
})

export function useMineruInstall(): MineruInstallState | null {
  const [st, setSt] = useState<MineruInstallState | null>(null)
  useEffect(() => {
    void api.mineruInstallState().then(setSt)
    return api.onMineruInstall(setSt)
  }, [])
  return st
}

function ReflowStep({ s }: { s: SettingsView }) {
  const st = useMineruInstall()
  const working = st && ['uv', 'python', 'packages', 'models'].includes(st.phase)
  return (
    <>
      <h2>{t('重排引擎')}</h2>
      <div className="lead">{t('论文导入后转成网页，才能逐段对照和划词。精细重排用本地的 MinerU：公式转成 LaTeX，表格能复制，论文不出电脑。')}</div>
      <div className="choice on" style={{ cursor: 'default' }}>
        <Layers size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {s.mineruInstalled ? (
            <>
              <div className="ct2">
                <span className="ok-t">
                  <Check size={14} />
                </span>{' '}
                {t('MinerU 已经装好')}
              </div>
              <div className="cd2 mono ellipsis">{s.mineruPath.replace(/^\/Users\/[^/]+/, '~')}</div>
            </>
          ) : (
            <>
              <div className="ct2">{working ? t('正在下载 MinerU：{0}', PHASE_NAME()[st.phase]) : st?.phase === 'failed' ? t('MinerU 没装成') : t('下载 MinerU（约 2.2 GB）')}</div>
              {working && (
                <>
                  <span className="bar accent" style={{ margin: '8px 0 6px' }}>
                    <i style={{ width: `${st.percent}%` }} />
                  </span>
                  <div className="cd2 num ellipsis">
                    {st.percent}% · {st.line}
                  </div>
                </>
              )}
              {st?.phase === 'failed' && <div className="err-t">{st.error}</div>}
              {!working && (
                <span className="btn sm" style={{ marginTop: 8 }} onClick={() => void api.mineruInstall()}>
                  <Download size={14} />
                  {st?.phase === 'failed' ? t('再试一次') : t('开始下载')}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {!s.mineruInstalled && <div className="callout">{t('不用等它：下载在后台进行，可以继续下一步。装好之前导入的论文先用简单重排（只有文字），装好后自动换成精细的。')}</div>}
    </>
  )
}

function ImportStep(props: { onDone: (then?: 'zotero') => void }) {
  const toast = useToast()
  const [zotero, setZotero] = useState<number | null>(null)
  const [sr, setSr] = useState<ScholareadPreview | null>(null)
  const [drag, setDrag] = useState(false)
  const [added, setAdded] = useState(0)
  useEffect(() => {
    void api.srPreview().then(setSr)
    void api
      .zoteroScan()
      .then((z) => setZotero(z.found ? (z.items?.length ?? 0) : null))
      .catch(() => setZotero(null))
  }, [])
  const imp = async (paths?: string[]): Promise<void> => {
    try {
      const r = await api.importPdfs(paths)
      const n = r.filter((x) => x.status === 'added').length
      setAdded((a) => a + n)
      const bad = r.find((x) => x.status === 'failed')
      if (bad && bad.status === 'failed') toast(t('没导入：{0}', bad.error))
    } catch (e) {
      toast(errText(e))
    }
  }
  return (
    <>
      <h2>{t('放进第一篇论文')}</h2>
      <div className="lead">{t('拖 PDF 进来，或者从你原来用的软件搬过来。也可以先跳过，之后在文献库右上角「导入」。')}</div>
      <button
        className={'onb-drop' + (drag ? ' on' : '')}
        onClick={() => void imp()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const paths = [...e.dataTransfer.files].filter((f) => /\.(pdf|epub)$/i.test(f.name)).map((f) => api.filePath(f))
          if (paths.length) void imp(paths)
        }}
      >
        <FileText size={32} strokeWidth={1.5} />
        <span>{added ? t('已导入 {0} 篇，还能接着拖', added) : t('把 PDF 或 EPUB 拖到这里，或点一下选文件')}</span>
      </button>
      {zotero !== null && (
        <div className="choice" style={{ alignItems: 'center' }}>
          <LibraryBig size={18} />
          <div style={{ flex: 1 }}>
            <div className="ct2">Zotero</div>
            <div className="cd2">{t('找到 {0} 篇，可以按文件夹挑', zotero)}</div>
          </div>
          <span className="btn sm" onClick={() => props.onDone('zotero')}>
            {t('选文件夹…')}
          </span>
        </div>
      )}
      {sr?.found && (
        <div className="choice" style={{ alignItems: 'center' }}>
          <Download size={18} />
          <div style={{ flex: 1 }}>
            <div className="ct2">Scholaread</div>
            <div className="cd2">{t('找到 {0} 篇论文和 {1} 条笔记，高亮颜色原样保留', sr.papers, sr.notes)}</div>
          </div>
          <span
            className="btn sm"
            onClick={() =>
              void api
                .srImport()
                .then((r) => (setAdded((a) => a + r.papersAdded), toast(t('导入了 {0} 篇和 {1} 条笔记', r.papersAdded, r.notesAdded))))
                .catch((e) => toast(errText(e)))
            }
          >
            {t('全部导入')}
          </span>
        </div>
      )}
    </>
  )
}
