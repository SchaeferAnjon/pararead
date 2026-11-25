/**
 * AI 输入框里 ⌘V 粘图、从访达拖图进来、底行「+」加图（CN-24、第 2b 段）：图交给宿主存（ChatHost.aiPaste，画布笔记存进软件设置目录 pasted/，不进库、不进 Git），
 * 在输入框里是顶上那一排的一块材料（composer.tsx），发给引擎时作为图片一起附上；一次最多 4 张。存好的图在界面上的网址也由宿主给（ChatHost.pastedUrl）。
 */
export const MAX_PASTED = 4

/** 剪贴板、拖进来的文件里的图 */
export const imageFiles = (items: Iterable<File | null>) => [...items].filter((f): f is File => !!f && /^image\/(png|jpeg|gif|webp|heic|bmp|tiff)$/.test(f.type))

/** 别的格式（gif、webp、heic……）先画成 PNG：引擎只收 PNG、JPEG */
export async function toBytes(f: File): Promise<{ bytes: Uint8Array; mime: string }> {
  if (f.type === 'image/png' || f.type === 'image/jpeg') return { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }
  const bmp = await createImageBitmap(f)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }
}

/**
 * 粘贴时剪贴板里的字（粘贴优先文字）：微信多条聊天记录、Excel / Numbers 的单元格在字之外另附一张渲染好的图，有字就贴字。
 * 返回 '' 是没有要贴的字，有图就照旧贴图：没有字（截图、「拷贝图像」），或字只是那几张图的文件名（访达里拷的图）、只是一个网址（浏览器「拷贝图像」带的）。
 * 换行统一成 \n（输入框、编辑器里的写法）
 */
export function clipText(dt: DataTransfer): string {
  const text = dt.getData('text/plain').replace(/\r\n?/g, '\n')
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return ''
  const names = new Set([...dt.files].map((f) => f.name))
  if (names.size && lines.every((l) => names.has(l) || names.has(l.slice(l.lastIndexOf('/') + 1)))) return ''
  if (lines.length === 1 && /^(https?|file|data|blob):\S+$/i.test(lines[0]!)) return ''
  return text
}
