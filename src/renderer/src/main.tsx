import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/library.css'
import './styles/dialogs.css'
import './styles/ai.css'
import './styles/reader.css'
import './styles/settings.css'
import './styles/onboarding.css'
import './styles/print.css'
import { App } from './App'
import { PrintView } from './components/PrintView'
import { SettingsPage } from './components/SettingsPage'
import { uiLang } from '@shared/i18n'

// 界面语言写到 <html lang>：断词、字体回退跟着走，样式里也按它给长词多的语言放宽列（library.css）
document.documentElement.lang = uiLang() === 'zh' ? 'zh-Hans' : uiLang()

// 主题：主进程 nativeTheme.themeSource 决定跟随系统还是固定，这里按 prefers-color-scheme 设 data-theme
const mq = window.matchMedia('(prefers-color-scheme: dark)')
const printing = location.hash.startsWith('#print')
// 导出 PDF 一律浅色
const applyTheme = (): void => document.documentElement.setAttribute('data-theme', mq.matches && !printing ? 'dark' : 'light')
applyTheme()
mq.addEventListener('change', applyTheme)

const root = createRoot(document.getElementById('root')!)
root.render(location.hash.startsWith('#settings') ? <SettingsPage /> : printing ? <PrintView /> : <App />)
