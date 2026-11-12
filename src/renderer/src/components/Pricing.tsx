import { ArrowRight, Check, KeyRound, Star, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { api } from '../api'
import { money, useMember } from '../lib/member'
import { Segmented } from '../lib/ui'

// 收费页：盖在主窗口上，两栏。不送免费额度：要么买会员（不用 Key），要么填自己的 Key（永久免费）。
// 入口：侧栏底部的状态卡、首次引导第 2 步。付款在浏览器里完成，付完这里自动生效。
export function Pricing(props: { onClose: () => void }) {
  const m = useMember()
  const [plan, setPlan] = useState<'month' | 'year'>('year')
  const [code, setCode] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.menu')) props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  const prices = m.st?.prices
  const li = (items: string[]) => (
    <ul>
      {items.map((x) => (
        <li key={x}>
          <Check size={14} />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="price">
      <button className="icon-btn price-x" title={t('关闭 Esc')} onClick={props.onClose}>
        <X size={16} />
      </button>
      <h2>{t('ParaRead · 读懂每一篇英文论文')}</h2>
      <div className="hint" style={{ marginTop: 6, fontSize: 'var(--fs)' }}>
        {t('自带 Key 和本地重排永久免费；会员买的是不用配置的 AI')}
      </div>
      <div className="cols">
        <div className={'pc' + (m.isMember ? '' : ' hero')}>
          <div className="pt">
            <Star size={16} />
            {t('会员')}
            <span className="tag accent">{t('省心')}</span>
            <span className="spacer" />
            {!m.isMember && (
              <Segmented
                className="sm"
                value={m.cur}
                onChange={m.setCur}
                options={[
                  { value: 'cny', label: '¥' },
                  { value: 'usd', label: '$' }
                ]}
              />
            )}
          </div>
          {m.isMember ? (
            <>
              <div className="pp">{t('你是会员')}</div>
              <div className="pd">{m.st?.memberUntil ? t('用到 {0}', new Date(m.st.memberUntil).toLocaleDateString()) : ''}</div>
              <button className="btn" onClick={() => void api.openSettings('member')}>
                {t('在设置里管理')}
              </button>
            </>
          ) : prices ? (
            <>
              <Segmented
                className="block"
                value={plan}
                onChange={setPlan}
                options={[
                  { value: 'month', label: t('月付') },
                  { value: 'year', label: t('年付（省两个月）') }
                ]}
              />
              <div className="pp">
                {money(prices[plan][m.cur], m.cur)} <small>{plan === 'month' ? t('/ 月') : t('/ 年')}</small>
              </div>
              <div className="pd">{t('不用申请任何 Key，装好就能用。自动续费，随时取消。')}</div>
              <button className="btn primary lg" disabled={!!m.busy} onClick={() => void m.buy(plan, 'sub')}>
                {m.busy === plan + 'sub' && <span className="spin spin-12" />}
                {t('开通会员')}
              </button>
              {m.cur === 'cny' && m.st?.passPrices && (
                <div className="hint">
                  {t('用微信付：')}
                  <button className="text-btn" disabled={!!m.busy} onClick={() => void m.buy(plan, 'pass')}>
                    {plan === 'month' ? t('一次买 1 个月') : t('一次买 1 年')} {money(m.st.passPrices[plan].cny, 'cny')}
                  </button>
                  {t('，不自动续费')}
                </div>
              )}
              {m.busy && (
                <div className="hint">
                  {t('在浏览器里付款，付好这里几秒内自动生效。')}
                  <button className="text-btn" onClick={m.cancelWait}>
                    {t('不买了')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="pp">{m.err || !m.st ? '' : t('还没开放')}</div>
              <div className="pd">{m.err ?? (m.st ? t('会员购买还没开放，现在先用自己的 Key。') : t('正在连接会员服务器…'))}</div>
            </>
          )}
          {li([t('翻译、问答、速览、学术 AI、研究 Agent 都包含'), t('授权码激活，不用账号，最多 2 台电脑'), t('每月用量有上限，约 60 篇全文翻译或 400 次问答的量，下月恢复'), t('到期后照样能用自带 Key')])}
        </div>
        <div className="pc">
          <div className="pt">
            <KeyRound size={16} />
            {t('自带 Key')}
            <span className="tag">{t('永久免费')}</span>
          </div>
          <div className="pp">
            {t('免费')} <small>· {t('不限时')}</small>
          </div>
          <div className="pd">{t('用你自己的 AI 服务 Key，费用走你的账户。')}</div>
          <button
            className="btn lg"
            onClick={() => {
              void api.openSettings('ai')
              props.onClose()
            }}
          >
            {t('去填 Key')}
            <ArrowRight size={16} />
          </button>
          {li([t('用多少不限'), t('DeepSeek、智谱、通义、Kimi、豆包等 10 家，也能填自定义接口'), t('本地 MinerU 精细重排，论文不出电脑')])}
        </div>
      </div>
      <div className="price-code">
        <span>{t('已经有授权码？')}</span>
        <input className="input mono" style={{ width: 240 }} placeholder="PR-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={!code.trim() || !!m.busy} onClick={() => void m.activate(code.trim()).then((ok) => ok && props.onClose())}>
          {m.busy === 'code' && <span className="spin spin-12" />}
          {t('激活')}
        </button>
      </div>
      <div className="faq">
        <div>
          <b>{t('能一直免费用吗？')}</b>
          <span>{t('能。自带 Key 和本地重排没有时间和次数限制。')}</span>
        </div>
        <div>
          <b>{t('会员和自带 Key 有什么区别？')}</b>
          <span>{t('会员不用申请 Key，AI 的费用包在会员里；别的功能一样。')}</span>
        </div>
        <div>
          <b>{t('要注册账号吗？')}</b>
          <span>{t('不用。会员靠授权码，在这台电脑上买的自动生效。')}</span>
        </div>
        <div>
          <b>{t('怎么取消？')}</b>
          <span>{t('设置 › 会员 › 管理订阅，随时取消，用到当期结束。')}</span>
        </div>
      </div>
    </div>
  )
}
