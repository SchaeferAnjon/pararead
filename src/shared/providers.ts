// 可选的 AI 服务，都走 OpenAI 兼容的 chat/completions。照会议字幕的清单（2026-10 各家 /models 核对过），
// 加上智谱 Coding Plan（路径不同，只接受 reasoning_effort low，账号会把请求串行化）。
// text：翻译、问答、速览；vision：框选截图、图表解释。member 是会员通道（经我们的服务器转到 DeepSeek），设置里不列出来。
// claude-code 不走 HTTP：跑用户这台电脑上装好、登录了的 claude 命令行（main/claudeCode.ts），用它自己的订阅，不用 Key。

import { t } from './i18n'

export interface Provider {
  id: string
  name: string
  blurb: string
  icon?: string
  mono?: boolean
  baseUrl?: string
  keyPage?: string
  text?: string
  vision?: string
  env?: string // 设置里没填 Key 时读的环境变量
  hidden?: boolean
  serial?: boolean // 账号会把请求串行化：发起间隔至少 1.1 秒，翻译并发 2
  ctx?: number // 给 AI 的论文全文最多多少字（按上下文窗口留余量），默认 6 万
  local?: boolean // 本机的命令行，不用 Key、没有接口地址
  models?: string[] // 能选的模型是固定的这几个，不用去服务商那里查
}

export const MEMBER_API = 'https://api.us-cloud.uk'

export const PROVIDERS: Provider[] = [
  { id: 'deepseek', name: 'DeepSeek', blurb: t('便宜，中文好，能看图'), icon: 'deepseek.svg', baseUrl: 'https://api.deepseek.com', keyPage: 'https://platform.deepseek.com/api_keys', text: 'deepseek-flash', vision: 'deepseek-flash', env: 'DEEPSEEK_API_KEY', ctx: 400000 },
  { id: 'zhipu-coding', name: t('智谱 Coding Plan'), blurb: t('包月套餐'), icon: 'zhipu.svg', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', keyPage: 'https://open.bigmodel.cn/usercenter/apikeys', text: 'glm-5.3-flash', vision: 'glm-4.6v', env: 'ZHIPU_API_KEY', serial: true, ctx: 150000 },
  { id: 'zhipu', name: t('智谱 GLM'), blurb: t('按量付费'), icon: 'zhipu.svg', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyPage: 'https://open.bigmodel.cn/usercenter/apikeys', text: 'glm-5.3-flash', vision: 'glm-4.6v', env: 'ZHIPU_API_KEY', ctx: 150000 },
  { id: 'qwen', name: t('通义千问'), blurb: t('阿里云百炼'), icon: 'qwen.svg', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyPage: 'https://bailian.console.aliyun.com/?tab=model#/api-key', text: 'qwen3.8-flash', vision: 'qwen3.8-flash', env: 'DASHSCOPE_API_KEY', ctx: 200000 },
  { id: 'kimi', name: 'Kimi', blurb: t('月之暗面'), icon: 'kimi.svg', mono: true, baseUrl: 'https://api.moonshot.cn/v1', keyPage: 'https://platform.moonshot.cn/console/api-keys', text: 'kimi-k3', vision: 'kimi-k3', env: 'MOONSHOT_API_KEY', ctx: 200000 },
  { id: 'doubao', name: t('豆包'), blurb: t('火山方舟'), icon: 'doubao.svg', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', keyPage: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', text: 'doubao-seed-1-6-251015', vision: 'doubao-seed-1-6-251015', env: 'ARK_API_KEY', ctx: 150000 },
  { id: 'openai', name: 'OpenAI API', blurb: t('按用量付费'), icon: 'openai.svg', mono: true, baseUrl: 'https://api.openai.com/v1', keyPage: 'https://platform.openai.com/api-keys', text: 'gpt-5.6-luna', vision: 'gpt-5.6-luna', env: 'OPENAI_API_KEY', ctx: 300000 },
  { id: 'gemini', name: 'Gemini', blurb: t('需要海外网络'), icon: 'gemini.png', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyPage: 'https://aistudio.google.com/apikey', text: 'gemini-3.8-flash', vision: 'gemini-3.8-flash', env: 'GEMINI_API_KEY', ctx: 400000 },
  { id: 'claude', name: 'Claude', blurb: t('需要海外网络'), icon: 'claude.svg', baseUrl: 'https://api.anthropic.com/v1', keyPage: 'https://platform.claude.com/settings/keys', text: 'claude-haiku-5-5', vision: 'claude-haiku-5-5', env: 'ANTHROPIC_API_KEY', ctx: 300000 },
  { id: 'claude-code', name: t('本机 Claude Code'), blurb: t('用它的订阅，不用 Key'), local: true, text: 'haiku', vision: 'haiku', models: ['haiku', 'sonnet', 'opus'], ctx: 300000 },
  { id: 'openrouter', name: 'OpenRouter', blurb: t('一个 Key 用多家模型'), icon: 'openrouter.svg', mono: true, baseUrl: 'https://openrouter.ai/api/v1', keyPage: 'https://openrouter.ai/settings/keys', text: 'openai/gpt-5.6-luna', vision: 'openai/gpt-5.6-luna', env: 'OPENROUTER_API_KEY', ctx: 200000 },
  { id: 'custom', name: t('自定义'), blurb: t('任何 OpenAI 兼容接口') },
  { id: 'member', name: t('ParaRead 会员'), blurb: t('不用 Key'), hidden: true, baseUrl: `${MEMBER_API}/v1/pararead`, text: 'deepseek-flash', vision: 'deepseek-flash', ctx: 300000 }
]

export function providerOf(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}
