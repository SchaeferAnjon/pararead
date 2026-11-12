// Word 引用插件（Office 加载项）的应用这一头：
//   1. 一个只听本机的 HTTPS 服务，给 Word 里的任务窗格发页面（out/renderer/word.html）和查文献库的接口。
//      Mac 版 Word 的加载项只认 HTTPS，所以要一张系统信任的 localhost 证书：用系统自带的 openssl 生成一张
//      只能给 localhost 用的自签证书（CA:FALSE，签不了别的证书），装的时候让系统把它记成受信任（会问一次本机密码）。
//   2. 把清单文件放进 Word 的侧载目录（~/Library/Containers/com.microsoft.Word/Data/Documents/wef），
//      Word 重开后「加载项」里就有 ParaRead 这一栏。
// 文档里的引用怎么编号、怎么排在 src/shared/wordCite.ts；任务窗格在 src/renderer/src/word/。
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { X509Certificate } from 'node:crypto'
import { homedir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { t, uiLang } from '../shared/i18n'
import type { Paper, WordStatus } from '../shared/types'
import type { CiteItem } from '../shared/wordCite'

export const WORD_PORT = 27484
const ORIGIN = `https://localhost:${WORD_PORT}`
const WORD_APP = '/Applications/Microsoft Word.app'
const WPS_APPS = ['/Applications/wpsoffice.app', '/Applications/WPS Office.app']
const WEF = join(homedir(), 'Library/Containers/com.microsoft.Word/Data/Documents/wef')
const MANIFEST = join(WEF, 'pararead.xml')
const CERT_CN = 'ParaRead Word add-in (localhost)'
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }

const run = (cmd: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; out: string }> =>
  new Promise((res) => execFile(cmd, args, { timeout }, (err, stdout, stderr) => res({ ok: !err, out: String(stdout) + String(stderr) })))

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Word 的加载项清单：一个「ParaRead」选项卡，三个按钮各开任务窗格的一页 */
export function manifestXml(lang: string): string {
  const s = (id: string, v: string): string => `<bt:String id="${id}" DefaultValue="${xml(v)}"/>`
  const icons = [16, 32, 80].map((n) => `<bt:Image size="${n}" resid="PR.Icon${n}"/>`).join('')
  const button = (id: string): string => `
              <Control xsi:type="Button" id="PR.${id}">
                <Label resid="PR.${id}.Label"/>
                <Supertip><Title resid="PR.${id}.Label"/><Description resid="PR.${id}.Tip"/></Supertip>
                <Icon>${icons}</Icon>
                <Action xsi:type="ShowTaskpane"><TaskpaneId>PR.Pane</TaskpaneId><SourceLocation resid="PR.${id}.Url"/></Action>
              </Control>`
  const url = (tab: string): string => `${ORIGIN}/word.html?tab=${tab}&amp;lang=${lang}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>6b1f3f0e-3c5a-4f0e-9a51-5c0d2e8a7b41</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>ParaRead</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="ParaRead"/>
  <Description DefaultValue="${xml(t('从 ParaRead 的文献库插入引用，生成参考文献表，检查格式'))}"/>
  <IconUrl DefaultValue="${ORIGIN}/word-icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${ORIGIN}/word-icon-64.png"/>
  <SupportUrl DefaultValue="https://pararead.us-cloud.uk"/>
  <AppDomains><AppDomain>${ORIGIN}</AppDomain></AppDomains>
  <Hosts><Host Name="Document"/></Hosts>
  <Requirements><Sets DefaultMinVersion="1.1"><Set Name="WordApi" MinVersion="1.1"/></Sets></Requirements>
  <DefaultSettings><SourceLocation DefaultValue="${url('cite')}"/></DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <CustomTab id="PR.Tab">
              <Group id="PR.Group">
                <Label resid="PR.Group.Label"/>
                <Icon>${icons}</Icon>${button('Cite')}${button('Bib')}${button('Check')}
              </Group>
              <Label resid="PR.Tab.Label"/>
            </CustomTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>${[16, 32, 80].map((n) => `<bt:Image id="PR.Icon${n}" DefaultValue="${ORIGIN}/word-icon-${n}.png"/>`).join('')}</bt:Images>
      <bt:Urls>
        <bt:Url id="PR.Cite.Url" DefaultValue="${url('cite')}"/>
        <bt:Url id="PR.Bib.Url" DefaultValue="${url('bib')}"/>
        <bt:Url id="PR.Check.Url" DefaultValue="${url('check')}"/>
      </bt:Urls>
      <bt:ShortStrings>
        ${s('PR.Tab.Label', 'ParaRead')}
        ${s('PR.Group.Label', t('引用'))}
        ${s('PR.Cite.Label', t('插入引用'))}
        ${s('PR.Bib.Label', t('参考文献表'))}
        ${s('PR.Check.Label', t('格式检查'))}
      </bt:ShortStrings>
      <bt:LongStrings>
        ${s('PR.Cite.Tip', t('从文献库里搜论文，在光标处插入引用'))}
        ${s('PR.Bib.Tip', t('在光标处生成参考文献表，换格式时全文跟着变'))}
        ${s('PR.Check.Tip', t('检查参考文献缺项、编号被改、正文引了但表里没有'))}
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`
}

const brief = (p: Paper): CiteItem => ({ id: p.id, title: p.title, authors: p.authors, year: p.year, venue: p.venue, volume: p.volume, issue: p.issue, pages: p.pages, doi: p.doi, url: p.url, publisher: p.publisher, arxiv: p.arxiv })

export class WordAddin {
  private servers: Server[] = []
  private error = ''
  private keyFile: string
  private certFile: string

  constructor(
    private o: {
      dir: string // 放证书的目录（数据目录下的 word/）
      staticDir: string // out/renderer
      papers: () => Paper[]
      prefs: () => { style: string; check: boolean }
    }
  ) {
    this.keyFile = join(o.dir, 'localhost.key')
    this.certFile = join(o.dir, 'localhost.crt')
  }

  private installed(): boolean {
    return existsSync(MANIFEST)
  }

  /** 证书在、没过期（留 30 天）、系统信任 */
  private async trusted(): Promise<boolean> {
    if (!existsSync(this.certFile) || !existsSync(this.keyFile)) return false
    const cert = new X509Certificate(readFileSync(this.certFile))
    if (Date.parse(cert.validTo) - Date.now() < 30 * 86400_000) return false
    return (await run('/usr/bin/security', ['verify-cert', '-c', this.certFile, '-p', 'ssl', '-s', 'localhost'])).ok
  }

  async status(): Promise<WordStatus> {
    const word = existsSync(WORD_APP)
    const version = word ? (await run('/usr/bin/defaults', ['read', join(WORD_APP, 'Contents/Info'), 'CFBundleShortVersionString'])).out.trim() : ''
    return { word, wordVersion: /^[\d.]+$/.test(version) ? version : '', wps: WPS_APPS.some((p) => existsSync(p)), installed: this.installed(), trusted: await this.trusted(), running: this.servers.length > 0, error: this.error }
  }

  /** 用系统自带的 openssl 生成一张只给 localhost 用的自签证书：CA:FALSE（签不了别的证书），800 天（系统对自己加的证书最多认 825 天） */
  private async makeCert(): Promise<boolean> {
    mkdirSync(this.o.dir, { recursive: true })
    const made = await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', this.keyFile, '-out', this.certFile, '-days', '800', '-subj', `/CN=${CERT_CN}`, '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1', '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment', '-addext', 'extendedKeyUsage=serverAuth'], 60_000)
    if (made.ok && existsSync(this.certFile)) return true
    this.error = t('证书没生成：{0}', made.out.trim().split('\n').pop() ?? '')
    return false
  }

  /** 测试用（PARAREAD_WORD_SERVE=1）：不装进 Word、不动钥匙串，只把本机服务起来；证书没被系统信任，测试里忽略证书错误 */
  async serveForTest(): Promise<void> {
    if (existsSync(this.certFile) || (await this.makeCert())) await this.start()
  }

  /** 装：生成证书（没有或快过期才生成）→ 让系统信任它（系统会弹窗要本机密码）→ 起服务 → 放清单 */
  async install(): Promise<WordStatus> {
    this.error = ''
    if (!existsSync(WORD_APP)) {
      this.error = t('没找到 Microsoft Word（/Applications/Microsoft Word.app）')
      return this.status()
    }
    if (!(await this.trusted())) {
      if (!(await this.makeCert())) return this.status()
      // 换过证书：旧的同名证书先从钥匙串拿掉（没有就算了），服务用新证书重起
      await run('/usr/bin/security', ['delete-certificate', '-c', CERT_CN])
      this.stop()
      const add = await run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', join(homedir(), 'Library/Keychains/login.keychain-db'), this.certFile], 180_000)
      if (!add.ok || !(await this.trusted())) {
        this.error = t('系统没有信任这张证书（弹出的密码框被取消了？）。再点一次「安装」')
        return this.status()
      }
    }
    await this.start()
    if (this.error) return this.status()
    mkdirSync(WEF, { recursive: true })
    writeFileSync(MANIFEST, manifestXml(uiLang()))
    return this.status()
  }

  /** 移除：清单删掉、服务停掉、证书不再信任并从钥匙串删掉 */
  async remove(): Promise<WordStatus> {
    this.error = ''
    rmSync(MANIFEST, { force: true })
    this.stop()
    if (existsSync(this.certFile)) {
      await run('/usr/bin/security', ['remove-trusted-cert', this.certFile], 180_000)
      await run('/usr/bin/security', ['delete-certificate', '-c', CERT_CN])
    }
    rmSync(this.keyFile, { force: true })
    rmSync(this.certFile, { force: true })
    return this.status()
  }

  /** 应用启动时：装过就把服务起来；界面语言换了清单里的字也跟着换 */
  async startIfInstalled(): Promise<void> {
    if (!this.installed() || !existsSync(this.certFile)) return
    await this.start()
    if (!this.error && readFileSync(MANIFEST, 'utf8') !== manifestXml(uiLang())) writeFileSync(MANIFEST, manifestXml(uiLang()))
  }

  stop(): void {
    for (const s of this.servers) s.close()
    this.servers = []
  }

  /** 起服务：localhost 可能解析成 127.0.0.1 也可能是 ::1，两个都听（只听本机） */
  async start(tls = { key: readFileSync(this.keyFile), cert: readFileSync(this.certFile) }): Promise<void> {
    if (this.servers.length) return
    this.error = ''
    const listen = (host: string): Promise<Server | null> =>
      new Promise((res) => {
        const srv = createServer(tls, (req, rsp) => this.handle(req, rsp))
        srv.once('error', (e: NodeJS.ErrnoException) => {
          // 这台电脑没开 IPv6 的 ::1 不算错
          if (host === '127.0.0.1') this.error = e.code === 'EADDRINUSE' ? t('端口 {0} 被别的程序占着，Word 插件用不了', WORD_PORT) : String(e.message)
          res(null)
        })
        srv.listen(WORD_PORT, host, () => res(srv))
      })
    this.servers = (await Promise.all([listen('127.0.0.1'), listen('::1')])).filter((s): s is Server => !!s)
    if (this.error) this.stop()
  }

  private handle(req: IncomingMessage, rsp: ServerResponse): void {
    const send = (code: number, body: string | Buffer, type = 'application/json'): void => {
      rsp.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      rsp.end(body)
    }
    // 只认本机地址来的、Host 是 localhost 的请求（挡 DNS 重绑定）；不发 CORS 头，别的网站的页面读不到回应
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(403, '{"error":"host"}')
    const u = new URL(req.url ?? '/', ORIGIN)
    if (req.method !== 'GET') return send(405, '{"error":"method"}')
    if (u.pathname === '/api/state') return send(200, JSON.stringify({ ...this.o.prefs(), lang: uiLang() }))
    if (u.pathname === '/api/search') {
      const words = (u.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const all = this.o.papers()
      const hit = words.length ? all.filter((p) => words.every((w) => `${p.title} ${p.authors.join(' ')} ${p.year ?? ''} ${p.venue ?? ''} ${p.doi ?? ''}`.toLowerCase().includes(w))) : [...all].sort((a, b) => (b.lastOpened ?? b.createdAt) - (a.lastOpened ?? a.createdAt))
      return send(200, JSON.stringify({ total: hit.length, items: hit.slice(0, 50).map(brief) }))
    }
    if (u.pathname === '/api/items') {
      const ids = new Set((u.searchParams.get('ids') ?? '').split(',').filter(Boolean))
      return send(200, JSON.stringify(this.o.papers().filter((p) => ids.has(p.id)).map(brief)))
    }
    // 静态文件：任务窗格的页面和它引用的 assets，别的不给
    const rel = normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, '')
    if (!/^(word\.html|word-icon-\d+\.png|assets\/[\w.@-]+)$/.test(rel)) return send(404, '{"error":"not found"}')
    const file = join(this.o.staticDir, rel)
    if (!existsSync(file) || !statSync(file).isFile()) return send(404, '{"error":"not found"}')
    send(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream')
  }
}
