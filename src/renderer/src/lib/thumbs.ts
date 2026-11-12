import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { loadPdf } from './pdf'

// 封面缩略图：主进程有缓存就直接用；没有就在界面里用 pdf.js 画第一页（480 宽 JPEG），存回主进程。一次只画一篇。
const cache = new Map<string, string | null>()
let chain: Promise<unknown> = Promise.resolve()

async function render(id: string): Promise<string | null> {
  const doc = await loadPdf(id)
  try {
    const page = await doc.getPage(1)
    const vp1 = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: 480 / vp1.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const g = canvas.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, viewport: vp }).promise
    const url = canvas.toDataURL('image/jpeg', 0.8)
    await api.saveThumb(id, url)
    return url
  } finally {
    await doc.loadingTask.destroy()
  }
}

export function useThumb(id: string, kind: 'pdf' | 'epub' | 'link'): { ref: React.RefObject<HTMLDivElement | null>; url: string | null } {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(cache.get(id) ?? null)
  useEffect(() => {
    if (kind === 'link' || cache.get(id)) return
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      void api.thumb(id).then((hit) => {
        if (hit) {
          cache.set(id, hit)
          if (alive) setUrl(hit)
          return
        }
        // EPUB 的封面导入时就存好了，没有就不画
        if (kind !== 'pdf') return
        chain = chain.then(() =>
          render(id)
            .then((u) => {
              cache.set(id, u)
              if (alive) setUrl(u)
            })
            .catch(() => cache.set(id, null))
        )
      })
    })
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [id, kind])
  return { ref, url }
}
