import { useEffect, useState } from 'react'
import { t, uiLang } from '@shared/i18n'
import { api, errText, type MemberStatus } from '../api'
import { useToast } from './ui'

export const money = (cents: number, cur: string): string => (cur === 'cny' ? `¥${(cents / 100).toFixed(cents % 100 ? 1 : 0)}` : `$${(cents / 100).toFixed(2)}`)

// 应用图标：一页纸，两行原文、两行浅一档的译文（设计稿里的图标，强调色换成墨黑）
export function AppLogo(props: { size?: number }) {
  const s = props.size ?? 44
  return (
    <span className="applogo" style={{ width: s, height: s, borderRadius: s / 4 }}>
      <svg viewBox="0 0 30 30" width={s * 0.68} height={s * 0.68}>
        <rect x="6" y="3" width="18" height="24" rx="2.5" fill="#fff" stroke="#1d1d1f" strokeWidth="1.6" />
        <rect x="9.5" y="8" width="11" height="1.8" rx=".9" fill="#1d1d1f" />
        <rect x="9.5" y="11.6" width="9" height="1.8" rx=".9" fill="#1d1d1f" />
        <rect x="9.5" y="16.4" width="11" height="1.8" rx=".9" fill="#9c9ca2" />
        <rect x="9.5" y="20" width="7" height="1.8" rx=".9" fill="#9c9ca2" />
      </svg>
    </span>
  )
}

// 会员状态和买、激活这几个动作：收费页、首次引导、设置窗共用
export function useMember() {
  const toast = useToast()
  const [st, setSt] = useState<MemberStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [cur, setCur] = useState<'cny' | 'usd'>(uiLang().startsWith('zh') ? 'cny' : 'usd')
  useEffect(() => {
    api
      .memberStatus()
      .then(setSt)
      .catch((e) => setErr(errText(e)))
    return api.onMemberStatus(setSt)
  }, [])
  const act = async (name: string, f: () => Promise<unknown>): Promise<boolean> => {
    setBusy(name)
    try {
      await f()
      return true
    } catch (e) {
      toast(errText(e))
      return false
    } finally {
      setBusy(null)
    }
  }
  return {
    st,
    err,
    busy,
    cur,
    setCur,
    isMember: st?.plan === 'member',
    // 开结账：在浏览器里付款，这里等结果
    buy: (plan: 'month' | 'year', mode: 'sub' | 'pass') =>
      act(plan + mode, async () => {
        const r = await api.memberCheckout(plan, cur, mode)
        toast(r === 'paid' ? t('已成为会员，AI 改走会员通道') : r === 'expired' ? t('付款页过期了，没扣钱') : t('已取消'))
      }),
    cancelWait: () => void api.memberCancelWait(),
    activate: (code: string) =>
      act('code', async () => {
        await api.memberActivate(code)
        await api.setSettings({ provider: 'member' })
        toast(t('已激活，AI 改走会员通道'))
      }),
    unbind: () => act('unbind', api.memberUnbind),
    portal: () => act('portal', api.memberPortal)
  }
}
