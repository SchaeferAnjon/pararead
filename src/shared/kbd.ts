// 快捷键的写法：界面文案按 Mac 写（⌘、⇧、⌥），在 Windows 上显示成 Ctrl+、Shift+、Alt+。
// 主进程看 process.platform，窗口里看 userAgent（界面进程里没有 process）。
declare const navigator: { userAgent: string } | undefined

export const ON_WIN = typeof process !== 'undefined' && typeof process.platform === 'string' ? process.platform === 'win32' : typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

export function winKbd(s: string): string {
  return s
    .replace(/⌃⌘/g, 'Ctrl+Alt+')
    .replace(/⇧⌘/g, 'Ctrl+Shift+')
    .replace(/⌥⌘/g, 'Ctrl+Alt+')
    .replace(/⌘⇧/g, 'Ctrl+Shift+')
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/↩/g, 'Enter')
}

export const kbd = (s: string): string => (ON_WIN ? winKbd(s) : s)

/** 「主修饰键」按着没有：Mac 是 ⌘，Windows 是 Ctrl */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (ON_WIN ? e.ctrlKey : e.metaKey)
