import { useEffect, useState } from 'react'
import type { ReadMode, SettingsView } from '@shared/types'
import { api } from './api'
import { MainWindow, type LibState } from './components/MainWindow'
import { Onboarding } from './components/Onboarding'
import { Pricing } from './components/Pricing'
import { Reader } from './components/Reader'
import type { Route } from './components/Sidebar'
import { MenuHost } from './lib/menu'
import { ToastProvider, useToast } from './lib/ui'

export function App() {
  const [open, setOpen] = useState<{ id: string; mode?: ReadMode } | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [route, setRoute] = useState<Route>({ kind: 'lib' })
  const [libState, setLibState] = useState<LibState>({ top: 0, selected: [] })
  const [pricing, setPricing] = useState(false)
  // 引导最后一步点了「从 Zotero 选文件夹」：进文献库后直接打开那个弹窗
  const [startWith, setStartWith] = useState<'zotero' | null>(null)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    const offs = [api.onSettings(setSettings), api.onOpenPaper((id) => setOpen({ id }))]
    return () => offs.forEach((f) => f())
  }, [])

  useEffect(() => {
    if (!settings) return
    const root = document.documentElement.style
    root.setProperty('--read-size', `${settings.readSize}px`)
    root.setProperty('--chat-size', `${settings.chatSize}px`)
    root.setProperty('--font-src', settings.srcFont === 'sans' ? 'var(--font-sans)' : 'var(--font-serif)')
  }, [settings])

  if (!settings) return null
  return (
    <ToastProvider>
      <Toasts />
      {!settings.onboarded ? (
        <Onboarding settings={settings} onPricing={() => setPricing(true)} onDone={(then) => setStartWith(then ?? null)} />
      ) : open ? (
        <Reader key={open.id} paperId={open.id} initialMode={open.mode} settings={settings} onBack={() => setOpen(null)} onOpenPaper={(id) => setOpen({ id })} />
      ) : (
        <MainWindow
          settings={settings}
          route={route}
          libState={libState}
          onRoute={setRoute}
          onPricing={() => setPricing(true)}
          startWith={startWith}
          onOpen={(id, st, mode) => {
            setLibState(st)
            setOpen({ id, mode })
          }}
        />
      )}
      {pricing && <Pricing onClose={() => setPricing(false)} />}
      <MenuHost />
    </ToastProvider>
  )
}

// 主进程发来的提示（小书签导入、打开方式）
function Toasts() {
  const toast = useToast()
  useEffect(() => api.onToast((t) => toast(t)), [toast])
  return null
}
