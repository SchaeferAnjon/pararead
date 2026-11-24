/**
 * 各家命令行的新版本和「更新」（task-m55m7）。只在用户点了才升，不静默升级用户的命令行。
 * 新版本从官方发布的地方读（不跑它的更新命令）：
 * - Claude Code 原生安装（~/.local/share/claude/versions 下）：downloads.claude.ai/claude-code-releases/latest（它的安装脚本用的同一处）；
 *   npm 装的：registry.npmjs.org/@anthropic-ai/claude-code/latest
 * - Codex：registry.npmjs.org/@openai/codex/latest；Gemini CLI：@google/gemini-cli；OpenCode：opencode-ai（1.x 这一线，`opencode upgrade` 不跨到 2）
 * 「更新」跑它官方的更新方式：`claude update`、`codex update`（它自己按装法挑命令）、`opencode upgrade`、
 * Gemini CLI 没有自己的更新命令：npm 装的 `npm install -g @google/gemini-cli@latest`，Homebrew 装的 `brew upgrade gemini-cli`。
 * 测试实例（CN_E2E=1）不连网：给了 CN_NPM_REGISTRY / CN_CLAUDE_DIST（本机的假服务）才查
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { t } from './shared/i18n'
import type { CliId as EngineId } from './shared'
import { parseVersion } from './shared'
import { lastLine, runProc } from './engine-proc'

export const NPM_PACKAGE: Record<EngineId, string> = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex', gemini: '@google/gemini-cli', opencode: 'opencode-ai' }

const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Claude Code 是不是原生安装的（不是 npm、Homebrew 装的） */
const claudeNative = (path: string) => /\/\.local\/share\/claude\/versions\/|\/\.claude\/local\//.test(real(path))

/** 测试实例不连网（只连给了的本机假服务） */
const offline = () => process.env.CN_E2E === '1' && !process.env.CN_NPM_REGISTRY && !process.env.CN_CLAUDE_DIST

/** 去哪读新版本 */
export function latestUrl(id: EngineId, path: string): { url: string; text: boolean } {
  if (id === 'claude' && claudeNative(path)) return { url: `${process.env.CN_CLAUDE_DIST ?? 'https://downloads.claude.ai/claude-code-releases'}/latest`, text: true }
  const reg = process.env.CN_NPM_REGISTRY ?? 'https://registry.npmjs.org'
  return { url: `${reg}/${NPM_PACKAGE[id]}/latest`, text: false }
}

/** 读最新的版本号（10 秒）；读不到报一句中文 */
export async function latestVersion(id: EngineId, path: string): Promise<string> {
  if (offline()) throw new Error(t('测试里不连网'))
  const { url, text } = latestUrl(id, path)
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: text ? 'text/plain' : 'application/json' } })
  } catch (e) {
    throw new Error(/abort|timeout/i.test(String((e as Error).name) + String((e as Error).message)) ? t('10 秒没连上') : t('连不上'))
  }
  if (!res.ok) throw new Error(t('发布的地方回了 {status}', { status: res.status }))
  const body = await res.text()
  const v = text ? parseVersion(body.trim()) : parseVersion(String((JSON.parse(body) as { version?: unknown }).version ?? ''))
  if (!v) throw new Error(t('读不出版本号'))
  return v
}

export type UpdatePlan = { cmd: string; args: string[]; text: string } | { none: string }

/** npm 全局装的（<前缀>/lib/node_modules/<包>）：用同一个前缀里的 npm；找不到就用 PATH 上的 */
function npmOf(path: string): string {
  const m = /^(.*)\/lib\/node_modules\//.exec(real(path))
  const npm = m ? join(m[1]!, 'bin', 'npm') : ''
  return npm && existsSync(npm) ? npm : 'npm'
}

/** 这一家怎么更新（照它装在哪认装法） */
export function updatePlan(id: EngineId, path: string): UpdatePlan {
  const app = /\/([^/]+\.app)\/Contents\//.exec(path)?.[1]
  if (app) return { none: t('跟着 {app} 一起更新', { app }) }
  if (id === 'claude') return { cmd: path, args: ['update'], text: 'claude update' }
  if (id === 'codex') return { cmd: path, args: ['update'], text: 'codex update' }
  if (id === 'opencode') return { cmd: path, args: ['upgrade'], text: 'opencode upgrade' }
  const where = real(path)
  if (/\/Cellar\/gemini-cli\//.test(where)) {
    const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((b) => existsSync(b)) ?? 'brew'
    return { cmd: brew, args: ['upgrade', 'gemini-cli'], text: 'brew upgrade gemini-cli' }
  }
  if (/\/node_modules\/@google\/gemini-cli\//.test(where)) return { cmd: npmOf(path), args: ['install', '-g', '@google/gemini-cli@latest'], text: 'npm install -g @google/gemini-cli@latest' }
  return { none: t('认不出 {dir} 里的 gemini 是怎么装的：在终端里照它装的办法更新', { dir: dirname(path) }) }
}

/** 跑更新（最多 10 分钟）；成没成看退出码，没成带它最后一句原话 */
export async function runUpdate(plan: { cmd: string; args: string[]; text: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const r = await runProc(plan.cmd, plan.args, { timeoutMs: 10 * 60_000 })
  if (r.error) return { ok: false, why: t('{cmd} 跑不起来：{error}', { cmd: plan.text, error: r.error }) }
  if (r.timedOut) return { ok: false, why: t('{cmd} 10 分钟没跑完', { cmd: plan.text }) }
  if (r.code !== 0) return { ok: false, why: lastLine(r.stderr) || lastLine(r.stdout) || t('{cmd} 退出码 {code}', { cmd: plan.text, code: r.code }) }
  return { ok: true }
}
