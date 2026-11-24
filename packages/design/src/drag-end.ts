/**
 * 一次按住拖从按下到收尾（task-0nz63）。以前每处拖动都只等 window 上的 mouseup / pointerup 才收；松手没送到页面
 * （透明窗口外松手、拖到一半窗口失焦、拖成了系统拖放）时这一下永远收不了：框、拖影留在屏上跟着鼠标走，一直改选、改落点。
 * 这里认四样「已经松手了」：
 * - 收到松手（mouseup / pointerup）：end('up', e)
 * - 鼠标又动了、按下的那个键却已经不按着（松手发生在窗口外）、pointercancel：end('lost', e)
 * - 窗口失焦、开始了系统拖放、又按下了一次（那一次肯定早就松了手）：end('lost', null)
 * 收到 lost 时各处自己定：挪内容、写文件的（拖卡、拖块、换顺序、落到哪一列）当没拖过取消，像按了 Esc；
 * 只改看法的（框选、平移、拉宽、挪浮窗）停在最后按着时的样子。
 * 同时可以有几次（白板收件箱自己跟着滚、白板跟着拖卡）。只用 DOM，画布笔记的界面、网页预加载、共用的日历都用这一份。
 */
export type DragEnd = 'up' | 'lost'

export interface DragHandlers<E extends MouseEvent> {
  /** 按着移动（按着的键已经松开的那一下不进这里，算 lost） */
  move?(e: E): void
  /** 收尾，只调一次；之后监听都已经拿掉 */
  end?(how: DragEnd, e: E | null): void
}

/** 按下的是哪个键 → MouseEvent.buttons 里那一位 */
const BIT: Record<number, number> = { 0: 1, 1: 4, 2: 2, 3: 8, 4: 16 }

/**
 * 从按下的那一下（原生事件或 React 的事件都行）开始跟：mousedown 跟 mousemove / mouseup，pointerdown 跟 pointermove / pointerup。
 * 返回 stop：自己收掉（Esc 取消、组件卸掉），不调 end
 */
export function trackDrag<E extends MouseEvent = MouseEvent>(down: { type: string; button: number }, h: DragHandlers<E>): () => void {
  const pointer = down.type.startsWith('pointer')
  const MOVE = pointer ? 'pointermove' : 'mousemove'
  const UP = pointer ? 'pointerup' : 'mouseup'
  const DOWN = pointer ? 'pointerdown' : 'mousedown'
  const bit = BIT[down.button] ?? 1
  let done = false
  const finish = (how: DragEnd, e: E | null) => {
    if (done) return
    stop()
    h.end?.(how, e)
  }
  const onMove = (e: Event) => {
    const ev = e as E
    if (!(ev.buttons & bit)) return finish('lost', ev)
    h.move?.(ev)
  }
  const onUp = (e: Event) => {
    // 按着左键时点了右键（松开的不是按下的那个键）：还在拖
    if ((e as MouseEvent).button !== down.button) return
    finish('up', e as E)
  }
  const onCancel = (e: Event) => finish('lost', e as E)
  const onGone = () => finish('lost', null)
  function stop() {
    if (done) return
    done = true
    window.removeEventListener(MOVE, onMove, true)
    window.removeEventListener(UP, onUp, true)
    window.removeEventListener(DOWN, onGone, true)
    window.removeEventListener('blur', onGone)
    window.removeEventListener('dragstart', onGone, true)
    if (pointer) window.removeEventListener('pointercancel', onCancel, true)
  }
  window.addEventListener(MOVE, onMove, true)
  window.addEventListener(UP, onUp, true)
  window.addEventListener(DOWN, onGone, true)
  window.addEventListener('blur', onGone)
  window.addEventListener('dragstart', onGone, true)
  if (pointer) window.addEventListener('pointercancel', onCancel, true)
  return stop
}
