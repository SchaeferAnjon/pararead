import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { translationKey } from '@shared/hash'
import type { Annotation, Paper, ReflowDoc, SettingsView } from '@shared/types'
import { api } from '../api'
import { Markdown } from '../lib/Markdown'
import { findTextRange, rangeAt } from '../lib/selection'
import { authorsShort } from '../lib/ui'

// 导出 PDF 用的排版页（隐藏窗口里打开）：重排后的正文，按设置带译文、高亮、页边笔记，排好后告诉主进程
export function PrintView() {
  const q = new URLSearchParams(location.hash.replace(/^#print\??/, ''))
  const id = q.get('id')!
  const layout = (q.get('layout') ?? 'both') as 'both' | 'src' | 'tr'
  const withHl = q.get('hl') === '1'
  const withNotes = q.get('notes') === '1'
  const [data, setData] = useState<{ paper: Paper; doc: ReflowDoc; tr: Record<string, string>; anns: Annotation[]; s: SettingsView } | null>(null)
  const [notes, setNotes] = useState<{ n: number; text: string; top: number; color: string }[]>([])
  const article = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      const [paper, doc, anns, s] = await Promise.all([api.getPaper(id), api.getReflow(id), api.annList(id), api.getSettings()])
      if (!paper || !doc) return
      const texts = doc.blocks.filter((b) => b.translatable).map((b) => b.md)
      const tr = layout === 'src' ? {} : await api.translate(id, texts, false)
      document.title = paper.title
      setData({ paper, doc, tr, anns, s })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 高亮包成 <mark>（打印时 CSS 自定义高亮不一定画），带笔记的编号并放到页边
  useLayoutEffect(() => {
    const root = article.current
    if (!data || !root) return
    const out: { n: number; text: string; top: number; color: string }[] = []
    if (withHl || withNotes)
      for (const a of data.anns) {
        let r: Range | null = null
        if (a.mode === 'reflow' && a.blockId && a.start !== null && a.end !== null) {
          const isTr = a.blockId.endsWith(':tr')
          const base = a.blockId.replace(/:tr$/, '')
          const el = root.querySelector(`[data-block="${CSS.escape(base)}"] ${isTr ? '.tr-text' : '.src'}`)
          if (el) r = rangeAt(el, a.start, a.end)
        } else r = findTextRange(root, a.text)
        if (!r) continue
        const mark = document.createElement('mark')
        mark.className = `pm-hl ${withHl ? a.color : 'none'}`
        try {
          mark.appendChild(r.extractContents())
          r.insertNode(mark)
        } catch {
          continue
        }
        if (withNotes && a.note) {
          const n = out.length + 1
          const sup = document.createElement('sup')
          sup.className = 'pm-ref'
          sup.textContent = String(n)
          mark.after(sup)
          out.push({ n, text: a.note, top: mark.getBoundingClientRect().top - root.getBoundingClientRect().top, color: a.color })
        }
      }
    // 页边笔记互相不压：往下推
    let last = -Infinity
    for (const o of out) {
      o.top = Math.max(o.top, last + 4)
      last = o.top + 16 * Math.ceil(o.text.length / 22) + 8
    }
    setNotes(out)
    void (async () => {
      await document.fonts.ready
      await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => {})))
      setTimeout(() => api.printReady(), 200)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (!data) return null
  const { paper, doc, tr, s } = data
  const meta = [authorsShort(paper.authors), [paper.venue, paper.year].filter(Boolean).join(', '), paper.doi ? `DOI ${paper.doi}` : ''].filter(Boolean).join(' · ')
  return (
    <div className={'print-page' + (withNotes && notes.length ? ' with-notes' : '')}>
      <div className="print-article" ref={article}>
        <h1 className="print-title">{paper.title}</h1>
        {meta && <div className="print-meta">{meta}</div>}
        {doc.blocks.map((b, i) => {
          if (i === 0 && b.type === 'heading' && b.level === 1) return null
          if (b.type === 'details') return null
          const t = b.translatable ? tr[translationKey(b.md, s.targetLang)] : undefined
          const showSrc = !b.translatable || layout !== 'tr' || !t
          const showTr = b.translatable && layout !== 'src' && t
          const Tag = b.type === 'heading' ? (`h${Math.min(4, (b.level ?? 2) + 1)}` as 'h2') : 'div'
          return (
            <div key={b.id} className={`pblk ${b.type}`} data-block={b.id}>
              {showSrc && (
                <Tag className="src" lang="en">
                  <Markdown text={b.md} inline={b.type === 'heading'} />
                </Tag>
              )}
              {showTr && (
                <div className="tr" lang="zh-Hans">
                  <Markdown text={t} inline={b.type === 'heading'} className="tr-text" />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {withNotes && notes.length > 0 && (
        <aside className="print-notes">
          {notes.map((n) => (
            <div key={n.n} className={`pnote ${n.color}`} style={{ top: n.top }}>
              <b>{n.n}</b> {n.text}
            </div>
          ))}
        </aside>
      )}
    </div>
  )
}
