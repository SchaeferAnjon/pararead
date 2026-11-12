// 会员：不登录，按这台电脑注册拿设备令牌；买了订阅或一次买就成会员，授权码（PR-）能在别的电脑上激活。
// 服务器是 meetcaption-server 的 pararead 产品（接口见那边 docs/multi-product.md §4）；AI 经它转发，密钥只在服务器上。
// 这里只管和服务器说话、记住令牌；没有免费额度，不是会员就用自己的 Key。
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { uiLang } from '../shared/i18n'
import { MEMBER_API } from '../shared/providers'
import { t } from '../shared/i18n'

export const PRODUCT = 'pararead'
const BASE = `${(process.env.PARAREAD_API ?? MEMBER_API).replace(/\/+$/, '')}/v1/${PRODUCT}`

export interface MemberStatus {
  plan: 'member' | 'none'
  code: string | null
  devices: number
  maxDevices: number
  subscription: { status: string; plan: string; currency: string; amount: number; periodEnd: number; cancelAtPeriodEnd: boolean } | null
  pass: { plan: string; currency: string; amount: number; until: number } | null
  memberUntil: number | null
  autoRenew: boolean
  expiring: boolean
  month: { costCap: number; used: number; resetAt: number } | null
  canUse: boolean
  reason: string | null
  prices: { month: { cny: number; usd: number }; year: { cny: number; usd: number } } | null
  passPrices: { month: { cny: number }; year: { cny: number } } | null
}

export class MemberError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message)
  }
}

// 服务器给的消息是中文；别的界面语言用这里按错误码写的
function codeText(code: string): string | null {
  const m: Record<string, string> = {
    'monthly-limit': t('这个月的会员用量到上限了，下月 1 日恢复；可以先在设置里填自己的 Key 接着用'),
    'daily-limit': t('今天的会员用量到上限了，明天恢复'),
    'sub-ended': t('会员已经到期。续订会员，或在设置里填自己的 Key 接着用'),
    'trial-closed': t('还不是会员。开通会员，或在设置里填自己的 Key'),
    'trial-used-up': t('还不是会员。开通会员，或在设置里填自己的 Key'),
    'payment-failed': t('续费没扣成，到「管理订阅」里换一张卡'),
    'too-many-devices': t('这个授权码已经用在 2 台电脑上，先在另一台移除'),
    'bad-code': t('授权码不对'),
    'already-subscribed': t('已经是会员了'),
    'not-ready': t('会员购买还没开放'),
    busy: t('会员服务器现在很忙，稍后再试'),
    upstream: t('AI 服务暂时不可用，稍后再试'),
    'bad-device': t('这台电脑的会员凭据无效，请重新打开应用')
  }
  return m[code] ?? null
}

const run = (cmd: string, args: string[]): Promise<string> => new Promise((res) => execFile(cmd, args, { timeout: 5000 }, (err, out) => res(err ? '' : String(out))))

export class Member {
  private state: { token: string | null; device: string | null }
  status: MemberStatus | null = null

  constructor(
    private file: string,
    private version: string,
    private onStatus: (s: MemberStatus | null) => void
  ) {
    this.state = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as typeof this.state) : { token: null, device: null }
  }

  token(): string | null {
    return this.state.token
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.state))
  }

  // 设备标识：Mac 硬件 UUID 的哈希；拿不到就用本机存的随机值
  private async device(): Promise<string> {
    if (this.state.device) return this.state.device
    const raw = (await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])).match(/"IOPlatformUUID" = "([^"]+)"/)?.[1]
    this.state.device = createHash('sha256').update(`${PRODUCT}:${raw ?? randomBytes(16).toString('hex')}`).digest('hex')
    this.save()
    return this.state.device
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true, retried = false): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      if (!this.state.token) await this.register()
      headers.Authorization = `Bearer ${this.state.token}`
    }
    let r: Response
    try {
      r = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    } catch (e) {
      throw new MemberError('network', t('连不上会员服务器：{0}', (e as Error).message), 0)
    }
    const j = (await r.json().catch(() => ({}))) as { error?: { code: string; message: string } } & T
    if (r.status === 401 && auth && !retried && j.error?.code === 'bad-device') {
      // 令牌失效（重装、被换）：重新注册一次再试，只试一次
      this.state.token = null
      await this.register()
      return this.call(method, path, body, auth, true)
    }
    if (!r.ok) {
      const code = j.error?.code ?? `http-${r.status}`
      throw new MemberError(code, uiLang() === 'zh' ? (j.error?.message ?? codeText(code) ?? t('会员服务器返回 {0}', r.status)) : (codeText(code) ?? j.error?.message ?? t('会员服务器返回 {0}', r.status)), r.status)
    }
    return j
  }

  async register(): Promise<MemberStatus> {
    const j = await this.call<MemberStatus & { token: string }>('POST', '/device', { device: await this.device(), platform: process.platform, arch: process.arch, version: this.version }, false)
    this.state.token = j.token
    this.save()
    return this.set(j)
  }

  private set(s: MemberStatus): MemberStatus {
    this.status = s
    this.onStatus(s)
    return s
  }

  async refresh(): Promise<MemberStatus> {
    return this.set(await this.call<MemberStatus>('GET', '/status'))
  }

  async activate(code: string): Promise<MemberStatus> {
    return this.set(await this.call<MemberStatus>('POST', '/license/activate', { code }))
  }

  async unbind(): Promise<MemberStatus> {
    return this.set(await this.call<MemberStatus>('POST', '/license/unbind'))
  }

  // 开结账：返回付款页网址；调用方打开浏览器后用 waitPaid 等结果
  async checkout(plan: 'month' | 'year', currency: 'cny' | 'usd', mode: 'sub' | 'pass'): Promise<{ url: string; claim: string }> {
    return this.call('POST', '/checkout', { plan, currency, mode })
  }

  async waitPaid(claim: string, stop: () => boolean): Promise<'paid' | 'expired' | 'stopped'> {
    const until = Date.now() + 30 * 60_000
    while (Date.now() < until) {
      if (stop()) return 'stopped'
      const r = await this.call<{ status: string } & MemberStatus>('GET', `/checkout/${encodeURIComponent(claim)}`)
      if (r.status === 'paid') {
        this.set(r)
        return 'paid'
      }
      if (r.status === 'expired') return 'expired'
      await new Promise((res) => setTimeout(res, 3000))
    }
    return 'expired'
  }

  async portal(): Promise<string> {
    return (await this.call<{ url: string }>('POST', '/portal')).url
  }
}
