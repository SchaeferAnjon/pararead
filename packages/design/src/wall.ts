/**
 * 窗口背景「主题渐变」那一层（task-aph2j，画布笔记、画布今日一份；样子在 wall.css）。
 * 软件套外观时调 applyWall：放好 .cn-wall、写 <html data-wallmix data-wallmove>；
 * 窗口在后台（别的软件在前面）或看不见（收进程序坞、被盖住、切走的桌面）时 data-wallrun='0'，色块停在原处，回来接着动。
 * <html data-winbg> 由软件自己写（照片、纯色、渐变三种外框不一样）。
 */
export interface WallLook {
  mix: 'soft' | 'mid' | 'rich'
  move: boolean
  speed: 'slow' | 'mid' | 'fast'
}

let watching = false

/** e2e：测试窗口从不激活（不抢用户的焦点），当它一直在前面；测试自己发 blur / focus 看停不停 */
export function applyWall(w: WallLook, opts: { e2e?: boolean } = {}): void {
  const r = document.documentElement
  if (!document.querySelector('body > .cn-wall')) {
    const el = document.createElement('div')
    el.className = 'cn-wall'
    el.setAttribute('aria-hidden', 'true')
    el.appendChild(document.createElement('i'))
    document.body.prepend(el)
  }
  r.dataset.wallmix = w.mix
  if (w.move) r.dataset.wallmove = w.speed
  else delete r.dataset.wallmove
  if (watching) return
  watching = true
  let front = opts.e2e || document.hasFocus()
  const run = () => {
    r.dataset.wallrun = front && document.visibilityState === 'visible' ? '1' : '0'
  }
  window.addEventListener('focus', () => {
    front = true
    run()
  })
  window.addEventListener('blur', () => {
    front = false
    run()
  })
  document.addEventListener('visibilitychange', run)
  run()
}
