// 对照、译文看法里的两种卡：页上面浮的一张（先装组件 / 这一篇还没翻过），还没翻到的译页上的小卡（翻到哪了）
import { Languages } from 'lucide-react'
import { BABELDOC_MB, type BabelInstallState, type LayoutTrState } from '@shared/layoutTr'
import type { SettingsView } from '@shared/types'
import { api } from '../api'
import { t } from '@shared/i18n'

// 估时间和花费（设计页 51 实测：每次起 BabelDOC 约 45 秒；43 页课件翻译约 ¥0.3，按页摊）
const START_S = 45
const S_PER_PAGE = 4
const YUAN_PER_PAGE = 0.0075

export const trLangWord = (target: string): string => (/^(简体|繁體|繁体)/.test(target) ? t('中文') : target)

function costLine(pages: number, s: SettingsView): string {
  const min = Math.max(1, Math.round((START_S + pages * S_PER_PAGE) / 60))
  const svc = s.trServiceName
  const money =
    s.trService === 'claude-code'
      ? t('用你的订阅额度，比较慢')
      : svc === t('ParaRead 会员')
        ? t('算进会员每月用量')
        : t('{0} 约 ¥{1}', svc || 'DeepSeek', Math.max(0.1, Math.round(pages * YUAN_PER_PAGE * 10) / 10).toFixed(1))
  return [t('{0} 页', pages), t('约 {0} 分钟', min), money].join(' · ')
}

/** 页上面浮的一张：组件没装先装；装了、这一篇没翻过（「打开就翻」关着）给「翻成对照」 */
// 装到哪一步（不给界面看英文的安装日志，日志放在悬停提示里）
const PHASE: Record<string, string> = { uv: t('准备安装工具'), python: t('装 Python 环境'), packages: t('下载 BabelDOC'), models: t('下载版面模型和字体') }

export function TrBanner(props: { inst: BabelInstallState | null; state: LayoutTrState | null; total: number; settings: SettingsView; paperId: string; onTrSide: boolean; onLater: () => void }) {
  const { inst, state, settings } = props
  if (!inst) return null
  const cls = 'tr-banner' + (props.onTrSide ? ' on-tr' : '')
  if (inst.phase !== 'done') {
    const working = ['uv', 'python', 'packages', 'models'].includes(inst.phase)
    return (
      <div className={cls} data-testid="tr-install">
        <div className="tb-title">{t('先装保版面翻译组件')}</div>
        <div className="tb-desc">{t('译文页和原页版面一样，图和表格不动。约 {0} MB，只装一次，放在缓存文件夹里。', BABELDOC_MB)}</div>
        {(working || inst.percent > 0) && (
          <>
            <div className="tb-bar">
              <span style={{ width: `${inst.percent}%` }} />
            </div>
            <div className="tb-meta num">
              <span className="tb-line" title={inst.line}>{working ? [PHASE[inst.phase], t('{0} / {1} MB', inst.mb, BABELDOC_MB)].filter(Boolean).join(' · ') : t('已暂停 · {0} / {1} MB', inst.mb, BABELDOC_MB)}</span>
              <span>{inst.percent}%</span>
            </div>
          </>
        )}
        {inst.phase === 'failed' && (
          <div className="tb-err">
            <span className="dot err sm" />
            {t('没装成：{0}', inst.error ?? '')}
          </div>
        )}
        <div className="tb-actions">
          {working ? (
            <button className="btn" onClick={() => void api.layoutTrStopInstall()}>
              {t('暂停')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => void api.layoutTrInstall()}>
              {inst.phase === 'failed' ? t('重试') : inst.percent > 0 ? t('接着装') : t('下载组件（约 {0} MB）', BABELDOC_MB)}
            </button>
          )}
        </div>
      </div>
    )
  }
  if (state && !state.started) {
    return (
      <div className={cls} data-testid="tr-first">
        <div className="tb-title">{t('翻成同版面的{0}页', trLangWord(settings.targetLang))}</div>
        <div className="tb-desc">{t('图、色块、表格不动，字在原位换成译文，左边原页、右边译文页。先翻你在看的这几页，后面边看边翻。')}</div>
        <div className="tb-row">
          <span className="tb-meta num" title={costLine(props.total, settings)}>{costLine(props.total, settings)}</span>
          <span className="spacer" />
          <button className="btn" onClick={props.onLater}>
            {t('以后再说')}
          </button>
          <button className="btn primary" onClick={() => void api.layoutTrResume(props.paperId)}>
            {t('翻成对照')}
          </button>
        </div>
      </div>
    )
  }
  return null
}

/** 还没翻到的译页上的小卡。组件没装时不出（页上面那张卡说清楚了），只把页变灰 */
export function PendingCard(props: { n: number; inst: BabelInstallState | null; state: LayoutTrState | null; paperId: string }) {
  const { n, state } = props
  if (props.inst?.phase !== 'done' || !state) return null
  if (state.error)
    return (
      <div className="tr-pend-card">
        <span className="dot err sm" />
        <span className="tp-text">{t('翻译出错：{0}', state.error)}</span>
        <button className="text-btn" onClick={() => void api.layoutTrResume(props.paperId)}>
          {t('重试')}
        </button>
      </div>
    )
  const i = state.busy.indexOf(n)
  if (i >= 0) {
    // 还要多久：有上一批的用时按它算；第一批按实测（起 BabelDOC 约 45 秒，每页约 4 秒）
    const need = state.msPerPage ? state.msPerPage * (i + 1) : (START_S + S_PER_PAGE * (i + 1)) * 1000
    const left = state.busySince ? Math.round((need - (Date.now() - state.busySince)) / 1000) : null
    return (
      <div className="tr-pend-card">
        <span className="spin spin-12" />
        <span className="tp-text">{left && left > 0 ? t('正在翻第 {0} 页，约 {1} 秒', n, left) : t('正在翻第 {0} 页', n)}</span>
      </div>
    )
  }
  // 「翻成对照」那张卡露着：页上只写灰字，不重复按钮
  if (state.paused && !state.started) return <div className="tr-pend-card muted">{t('第 {0} 页还没翻', n)}</div>
  if (state.paused)
    return (
      <div className="tr-pend-card">
        <Languages size={14} />
        <span className="tp-text">{t('第 {0} 页还没翻', n)}</span>
        <button className="text-btn" onClick={() => void api.layoutTrResume(props.paperId)}>
          {t('继续翻译')}
        </button>
      </div>
    )
  return <div className="tr-pend-card muted">{t('排着队，翻到第 {0} 页自动换上', n)}</div>
}
