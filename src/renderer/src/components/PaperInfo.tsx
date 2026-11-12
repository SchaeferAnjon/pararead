import { Copy, Download, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CITE_STYLES, citationText, formatCitation, bibKey, type CiteStyle } from '@shared/cite'
import type { Folder, Paper } from '@shared/types'
import { api, errText, type PaperPatch } from '../api'
import { useToast } from '../lib/ui'
import { fmtDuration } from './Inspector'
import { t } from '@shared/i18n'

export function folderPath(all: Folder[], f: Folder): string {
  const parts = [f.name]
  let cur = f.parentId ? all.find((x) => x.id === f.parentId) : undefined
  while (cur) {
    parts.unshift(cur.name)
    cur = cur.parentId ? all.find((x) => x.id === cur!.parentId) : undefined
  }
  return parts.join(' / ')
}

// 弹窗外壳：Esc 关、点遮罩关
export function Modal(props: { width?: number; height?: number; onClose: () => void; children: React.ReactNode; label: string; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.menu')) props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="backdrop" onMouseDown={props.onClose}>
      <div className={'modal ' + (props.className ?? '')} style={{ width: props.width, height: props.height }} role="dialog" aria-label={props.label} onMouseDown={(e) => e.stopPropagation()}>
        {props.children}
      </div>
    </div>
  )
}

export function ModalHead(props: { title: string; sub?: React.ReactNode; onClose: () => void; inline?: boolean }) {
  return (
    <div className="m-hd" style={props.inline ? { alignItems: 'center' } : undefined}>
      {props.inline ? (
        <>
          <h2>{props.title}</h2>
          {props.sub && <span className="hint">{props.sub}</span>}
        </>
      ) : (
        <div>
          <h2>{props.title}</h2>
          {props.sub && <p>{props.sub}</p>}
        </div>
      )}
      <button className="icon-btn" title={t('关闭 Esc')} onClick={props.onClose}>
        <X size={16} />
      </button>
    </div>
  )
}

type Field = { key: keyof PaperPatch | 'abstract'; label: string }
const ROWS: (Field | [Field, Field])[] = [
  { key: 'title', label: t('标题') },
  { key: 'authors', label: t('作者') },
  { key: 'venue', label: t('期刊') },
  [
    { key: 'year', label: t('年份') },
    { key: 'published', label: t('发表日期') }
  ],
  [
    { key: 'volume', label: t('卷') },
    { key: 'issue', label: t('期') }
  ],
  [
    { key: 'pages', label: t('页码') },
    { key: 'publisher', label: t('出版商') }
  ],
  [
    { key: 'doi', label: 'DOI' },
    { key: 'arxiv', label: 'arXiv' }
  ],
  { key: 'url', label: t('网址') }
]

const SHOWN: CiteStyle[] = ['gbt', 'apa', 'bibtex']

// 文献信息与引用格式：改了立即保存；右边是引用格式，点卡片复制
export function PaperInfo(props: { id: string; onClose: () => void }) {
  const toast = useToast()
  const [p, setP] = useState<Paper | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<number>(0)
  const [picked, setPicked] = useState<CiteStyle>('gbt')

  useEffect(() => {
    void api.getPaper(props.id).then((x) => {
      if (!x) return
      setP(x)
      setForm(toForm(x))
    })
    void api.readStats(props.id).then((s) => setStats(s.total))
  }, [props.id])

  if (!p) return null

  const save = async (key: string): Promise<void> => {
    const v = (form[key] ?? '').trim()
    let patch: PaperPatch
    if (key === 'authors') patch = { authors: v.split(/[;；\n]/).map((a) => a.trim()).filter(Boolean) }
    else if (key === 'year') patch = { year: /^\d{4}$/.test(v) ? Number(v) : null }
    else if (key === 'title') patch = { title: v || p.title }
    else patch = { [key]: v || null } as PaperPatch
    const next = { ...p, ...patch } as Paper
    if (JSON.stringify(toForm(next)) === JSON.stringify(toForm(p))) return
    await api.updatePaper(p.id, patch)
    setP(next)
  }

  const enrich = async (): Promise<void> => {
    setBusy(true)
    try {
      const n = await api.enrichPaper(p.id)
      if (n) {
        setP(n)
        setForm(toForm(n))
        toast(t('已从网上补全'))
      }
    } catch (e) {
      toast(t('补全失败：{0}', errText(e)))
    } finally {
      setBusy(false)
    }
  }

  const exportFile = (kind: 'bib' | 'ris'): void => {
    const text = citationText(p, kind === 'bib' ? 'bibtex' : 'ris')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `${bibKey(p)}.${kind}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const input = (f: Field) => (
    <div className="info-row" key={f.key}>
      <label htmlFor={'f-' + f.key}>{f.label}</label>
      <input
        id={'f-' + f.key}
        className="input"
        value={form[f.key] ?? ''}
        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
        onBlur={() => void save(f.key)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )

  const added = new Date(p.createdAt)
  return (
    <Modal width={960} label={t('文献信息')} onClose={props.onClose}>
      <ModalHead
        inline
        title={t('文献信息')}
        sub={[t('添加于 {0}月{1}日', added.getMonth() + 1, added.getDate()), stats ? t('读了 {0}', fmtDuration(stats)) : '', p.progress > 0 ? t('进度 {0}%', Math.round(p.progress * 100)) : ''].filter(Boolean).join(' · ')}
        onClose={props.onClose}
      />
      <div className="m-bd" style={{ flexDirection: 'row', gap: 24 }}>
        <div className="info-form">
          {ROWS.map((r, i) =>
            Array.isArray(r) ? (
              <div className="info-pair" key={i}>
                {input(r[0])}
                {input(r[1])}
              </div>
            ) : (
              input(r)
            )
          )}
          <div className="info-row" style={{ alignItems: 'flex-start' }}>
            <label htmlFor="f-abstract" style={{ paddingTop: 5 }}>
              {t('摘要')}
            </label>
            <textarea id="f-abstract" className="input area" rows={5} value={form.abstract ?? ''} onChange={(e) => setForm({ ...form, abstract: e.target.value })} onBlur={() => void save('abstract')} />
          </div>
          <div className="info-row">
            <span />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn sm" disabled={busy} onClick={() => void enrich()}>
                {busy ? <span className="spin spin-12" /> : <RefreshCw size={14} />}
                {t('从网上补全')}
              </button>
              <span className="hint">{t('按 DOI、arXiv 或标题去 Crossref、OpenAlex 查；改了立即保存')}</span>
            </div>
          </div>
        </div>
        <div className="cites">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="lbl" style={{ margin: 0 }}>
              {t('引用')}
            </span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => exportFile('bib')}>
              <Download size={14} />
              .bib
            </button>
            <button className="btn sm" onClick={() => exportFile('ris')}>
              <Download size={14} />
              .ris
            </button>
          </div>
          {SHOWN.map((st) => (
            <button
              key={st}
              className={'cite-card' + (picked === st ? ' on' : '')}
              title={t('点一下复制')}
              onClick={() => {
                setPicked(st)
                void navigator.clipboard.writeText(citationText(p, st))
                toast(t('已复制 {0} 引用', CITE_STYLES.find((c) => c.id === st)?.name))
              }}
            >
              <span className="cite-h">
                {CITE_STYLES.find((c) => c.id === st)?.name}
                <span className="spacer" />
                <Copy size={14} />
              </span>
              <span className={'cite-t' + (st === 'bibtex' ? ' mono' : '')}>
                <CiteText text={formatCitation(p, st)} />
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="m-ft">
        <span className="hint">{t('MLA、IEEE、RIS 在列表右键「复制引用」里')}</span>
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>
          {t('完成')}
        </button>
      </div>
    </Modal>
  )
}

// 引用里的 *期刊名* 显示成斜体
function CiteText(props: { text: string }) {
  return (
    <>
      {props.text.split(/(\*[^*]+\*)/).map((s, i) =>
        s.startsWith('*') && s.endsWith('*') && s.length > 2 ? <i key={i}>{s.slice(1, -1)}</i> : <span key={i}>{s}</span>
      )}
    </>
  )
}

function toForm(p: Paper): Record<string, string> {
  return {
    title: p.title,
    authors: p.authors.join('; '),
    venue: p.venue ?? '',
    year: p.year ? String(p.year) : '',
    published: p.published ?? '',
    volume: p.volume ?? '',
    issue: p.issue ?? '',
    pages: p.pages ?? '',
    publisher: p.publisher ?? '',
    doi: p.doi ?? '',
    arxiv: p.arxiv ?? '',
    url: p.url ?? '',
    abstract: p.abstract ?? ''
  }
}
