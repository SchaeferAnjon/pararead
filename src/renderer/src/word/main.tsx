import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import '../styles/base.css'
import './word.css'
import { t, uiLang } from '@shared/i18n'
import { Pane } from './Pane'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Office: any

document.documentElement.lang = uiLang() === 'zh' ? 'zh-Hans' : uiLang()
const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
applyTheme()
mq.addEventListener('change', applyTheme)

const root = createRoot(document.getElementById('root')!)
const notWord = (): void => root.render(<div className="wp-empty" style={{ paddingTop: 80 }}>{t('这个页面要在 Word 里打开：开始 › 加载项 › ParaRead')}</div>)
// 不在 Office 里（比如用浏览器直接打开）时 onReady 给的 host 是 null
if (typeof Office === 'undefined') notWord()
else void Office.onReady((info: { host: string | null }) => (info.host === 'Word' ? root.render(<Pane />) : notWord()))
