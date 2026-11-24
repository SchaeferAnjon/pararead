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
