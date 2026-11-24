/** 十个软件的真图标（偏好「不用首字母图标」）：软件 id → 打包后的地址。界面那边用（Vite 把 png 打进包里）；总站上同名的图在 apps.us-cloud.uk */
import canvasNotes from '../icons/canvas-notes.png'
import canvasToday from '../icons/canvas-today.png'
import pararead from '../icons/pararead.png'
import meetcaption from '../icons/meetcaption.png'
import bookmarkkeeper from '../icons/bookmarkkeeper.png'
import chatcards from '../icons/chatcards.png'
import askfree from '../icons/askfree.png'
import getnewword from '../icons/getnewword.png'
import typeright from '../icons/typeright.png'
import dispatch from '../icons/dispatch.png'

export const FAMILY_ICONS: Record<string, string> = {
  'canvas-notes': canvasNotes,
  'canvas-today': canvasToday,
  'pararead': pararead,
  'meetcaption': meetcaption,
  'bookmarkkeeper': bookmarkkeeper,
  'chatcards': chatcards,
  'askfree': askfree,
  'getnewword': getnewword,
  'typeright': typeright,
  'dispatch': dispatch,
}
