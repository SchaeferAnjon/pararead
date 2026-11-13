import { ChevronDown, ChevronUp, CodeXml, FolderOpen, RefreshCw, Send, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { splitPunct } from '@shared/draft'
import { t } from '@shared/i18n'
import { isRel, splitCell, type Draft, type Org } from '@shared/matrix'
import { api, errText, type BibStatus, type MatrixView } from '../../api'
import { Segmented, Skeleton, useToast } from '../../lib/ui'

type Busy = 'outline' | 'write' | 'check' | null

// 「写一段」抽屉：用到的素材 → 怎么组织 → 提纲（能挪）→ 语言 → 写成段落 → 查证 → 送进 Word 或复制成 LaTeX
export function WriteDrawer(props: { v: MatrixView; sel: string[]; label: (id: string) => string; num: (paperId: string) => number; onLit: (ids: string[]) => void; onClose: () => void }) {
  const { v } = props
  const sid = v.sessionId
  const toast = useToast()
  const [d, setD] = useState<Draft | null>(v.state.draft)
  const [busy, setBusy] = useState<Busy>(null)
  const [err, setErr] = useState<{ step: Busy; text: string } | null>(null)
  const [showCheck, setShowCheck] = useState(!!v.state.draft?.checks)
  const [latex, setLatex] = useState<Awaited<ReturnType<typeof api.matrixLatex>> | null>(null)
  const [wordOff, setWordOff] = useState(false)

  const run = async (step: Exclude<Busy, null>, fn: () => Promise<Draft>): Promise<Draft | null> => {
    setBusy(step)
    setErr(null)
    try {
      const r = await fn()
      setD(r)
      return r
    } catch (e) {
      setErr({ step, text: errText(e) })
      return null
    } finally {
      setBusy(null)
    }
  }
  const outline = (org: Org, lang: 'zh' | 'en'): Promise<Draft | null> => run('outline', () => api.matrixOutline(sid, org, lang))
  // 打开时还没有提纲就排一个
  useEffect(() => {
    if (!v.state.draft && props.sel.length) void outline('evo', 'zh')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 勾选变了：提纲里用的格子和现在勾的对不上
  const used = new Set(d?.outline.flatMap((x) => x.cells) ?? [])
  const stale = !!d && props.sel.some((x) => !used.has(x)) && busy !== 'outline'

  const setDraft = (next: Draft): void => {
    setD(next)
    void api.matrixSetDraft(sid, next)
  }
  const move = (i: number, by: number): void => {
    if (!d) return
    const o = [...d.outline]
    const j = i + by
    if (j < 0 || j >= o.length) return
    ;[o[i], o[j]] = [o[j], o[i]]
    // 提纲改了，写好的段落作废
    setDraft({ ...d, outline: o, sentences: null, checks: null })
  }
  const write = async (): Promise<void> => {
    const r = await run('write', () => api.matrixWrite(sid))
    if (r) setShowCheck(false)
  }
  const check = async (): Promise<void> => {
    if (showCheck) return setShowCheck(false)
    if (d?.checks) return setShowCheck(true)
    const r = await run('check', () => api.matrixCheck(sid))
    if (r) setShowCheck(true)
  }
  const toWord = async (): Promise<void> => {
    try {
      const r = await api.matrixToWord(sid)
      toast(r.paneOpen ? t('已送进 Word：插在光标处，{0} 处引用交给 Word 插件管', r.cites) : t('已送到 Word：在 Word 里打开 ParaRead 窗格，点「插入」'))
    } catch (e) {
      if (errText(e) === 'word-off') setWordOff(true)
      else toast(errText(e))
    }
  }
  const openLatex = async (): Promise<void> => {
    try {
      setLatex(await api.matrixLatex(sid))
    } catch (e) {
      toast(errText(e))
    }
  }

  const n = v.state.rows.length
  const langs = [
    { value: 'zh' as const, label: /english/i.test(v.lang) ? t('中文') : v.lang },
    { value: 'en' as const, label: 'English' }
  ]
  const checks = d?.checks
  const why = (i: number): React.ReactNode => {
    const c = checks?.[i]
    const s = d!.sentences![i]
    if (!c) return null
    if (c.ok) {
      const where = [...new Set(s.src.map((id) => srcWhere(v, id)))].join('；')
      return where || t('有出处')
    }
    return { nosrc: t('推断：没有一篇原文直接这么说，可以删掉，或者改成你自己的判断'), 'nosrc-cited': t('引了论文，但没有用到表里的格子，找不到出处'), stray: t('引的论文不在它用到的格子里') }[c.why] ?? t('原文撑不住：{0}', c.why)
  }

  return (
    <aside className="mx-drawer" aria-label={t('写一段')}>
      <div className="mx-dh">
        <b>{t('写一段')}</b>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="mx-subh">
        {t('用到的素材')} <span className="num hint">{t('{0} 条', props.sel.length)}</span>
      </div>
      <div className="mx-chips">
        {props.sel.map((id) => (
          <span className="tag" key={id}>
            {props.label(id)}
          </span>
        ))}
      </div>
      <div className="mx-subh">{t('怎么组织')}</div>
      <Segmented
        value={d?.org ?? 'evo'}
        onChange={(org) => void outline(org, d?.lang ?? 'zh')}
        options={[
          { value: 'evo' as Org, label: t('按演进') },
          { value: 'method' as Org, label: t('按方法') },
          { value: 'problem' as Org, label: t('按问题') }
        ]}
      />
      <div className="mx-subh">
        {t('提纲')} <span className="hint">{t('先看提纲，顺序不对就挪')}</span>
        <span className="spacer" />
        {stale && (
          <button className="text-btn" onClick={() => void outline(d!.org, d!.lang)}>
            {t('勾选变了，重新排')}
          </button>
        )}
      </div>
      {busy === 'outline' ? (
        <div className="mx-ol" style={{ padding: 12 }}>
          <Skeleton lines={[90, 70, 80]} />
        </div>
      ) : err?.step === 'outline' ? (
        <ErrLine text={err.text} onRetry={() => void outline(d?.org ?? 'evo', d?.lang ?? 'zh')} />
      ) : (
        d && (
          <div className="mx-ol" data-part="outline">
            {d.outline.map((o, i) => (
              <div className="it" key={o.h + i}>
                <span className="n">{i + 1}</span>
                <div className="b">
                  {o.h}
                  <div className="mx-chips">
                    {o.cells.map((c) => (
                      <span className="tag sm" key={c}>
                        {props.label(c)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mv">
                  <button className="icon-btn" title={t('上移')} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="icon-btn" title={t('下移')} disabled={i === d.outline.length - 1} onClick={() => move(i, 1)}>
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
      <div className="mx-subh">{t('语言')}</div>
      <Segmented value={d?.lang ?? 'zh'} onChange={(lang) => d && setDraft({ ...d, lang, sentences: null, checks: null })} options={langs} />
      <div className="callout" style={{ marginTop: 14 }}>
        <ShieldCheck size={14} />
        <span>{t('只引用这 {0} 篇。格子里没有的说法不会写成有出处；点「查证」逐句对原文，找不到出处的句子标黄。', n)}</span>
      </div>
      {!d?.sentences && (
        <div style={{ marginTop: 14 }}>
          <button className="btn primary lg" disabled={!d || busy !== null} onClick={() => void write()}>
            {busy === 'write' && <span className="spin spin-12" />}
            {busy === 'write' ? t('正在写') : t('写成段落')}
          </button>
          {err?.step === 'write' && <ErrLine text={err.text} onRetry={() => void write()} />}
        </div>
      )}
      {d?.sentences && (
        <div className="mx-pbox" data-part="paragraph">
          <div className={'mx-para' + (showCheck ? ' checked' : '')} lang={d.lang === 'en' ? 'en' : 'zh-Hans'} style={{ opacity: busy === 'write' ? 0.35 : 1 }}>
            {d.sentences.map((s, i) => {
              const [body, punct] = splitPunct(s.t)
              const ok = checks?.[i]?.ok
              return (
                <span key={i} className={'s' + (checks ? (ok ? ' ok' : ' warn') : '')} data-i={i} onMouseEnter={() => props.onLit(s.src)} onMouseLeave={() => props.onLit([])}>
                  {i > 0 && d.lang === 'en' ? ' ' : ''}
                  {body}
                  {s.cites.length > 0 && (
                    <>
                      {d.lang === 'en' ? ' ' : ''}
                      <span className="mx-cite">[{s.cites.map(props.num).sort((a, b) => a - b).join(',')}]</span>
                    </>
                  )}
                  {punct || (d.lang === 'en' ? '.' : '。')}
                </span>
              )
            })}
          </div>
          {showCheck && checks && (
            <div className="mx-checks" data-part="checks">
              {d.sentences.map((_, i) => (
                <div key={i}>
                  <span className={'dot sm ' + (checks[i]?.ok ? 'ok' : 'warn')} />
                  <span>
                    {t('第 {0} 句', i + 1)} · {why(i)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {err?.step === 'check' && <ErrLine text={err.text} onRetry={() => void check()} />}
          <div className="mx-tools">
            <button className={'btn ghost' + (showCheck ? ' on' : '')} disabled={busy !== null} onClick={() => void check()}>
              {busy === 'check' ? <span className="spin spin-12" /> : <ShieldCheck size={16} />}
              {t('查证')}
            </button>
            <button className="btn ghost" disabled={busy !== null} onClick={() => void write()}>
              {busy === 'write' ? <span className="spin spin-12" /> : <RefreshCw size={16} />}
              {t('重写')}
            </button>
            <span className="spacer" />
            <span className="hint">{t('鼠标停在一句上，表里亮出它的出处')}</span>
          </div>
          <div className="mx-out" data-part="send">
            <button className="btn primary" disabled={busy !== null} onClick={() => void toWord()}>
              <Send size={16} />
              {t('送进 Word')}
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void openLatex()}>
              <CodeXml size={16} />
              {t('复制成 LaTeX')}
            </button>
          </div>
        </div>
      )}
      {latex && <LatexDialog data={latex} onClose={() => setLatex(null)} onBib={(bib) => setLatex({ ...latex, bib })} />}
      {wordOff && <WordOffDialog onClose={() => setWordOff(false)} />}
    </aside>
  )
}

function srcWhere(v: MatrixView, id: string): string {
  if (isRel(id)) {
    const r = v.state.relations?.find((x) => `rel:${x.id}` === id)
    const a = v.papers.find((p) => p.id === r?.from)
    return r && a ? `${a.short}${r.a.page ? ' ' + t('第 {0} 页', r.a.page) : ''}` : t('关系')
  }
  const { paperId, col } = splitCell(id)
  const p = v.papers.find((x) => x.id === paperId)
  if (!p) return ''
  if (col === 'n') return t('{0} · 你的批注', p.short)
  const cell = v.state.rows.find((r) => r.paperId === paperId)?.cells[col]
  return cell?.found && cell.page ? `${p.short} ${t('第 {0} 页', cell.page)}` : t('{0}（原文没找到这句）', p.short)
}

function ErrLine(props: { text: string; onRetry: () => void }) {
  return (
    <div className="mx-lead" style={{ marginTop: 8 }}>
      <span className="dot err sm" />
      <span>{props.text}</span>
      <button className="text-btn" onClick={props.onRetry}>
        {t('重试')}
      </button>
    </div>
  )
}

function LatexDialog(props: { data: Awaited<ReturnType<typeof api.matrixLatex>>; onClose: () => void; onBib: (b: BibStatus) => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const { data } = props
  const bib = data.bib
  useEffect(() => {
    const k = (e: KeyboardEvent): void => void (e.key === 'Escape' && props.onClose())
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [props])
  const home = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
  const copy = (): void => {
    void navigator.clipboard.writeText(data.text)
    setCopied(true)
    toast(t('已复制，{0} 篇写成了 \\cite', data.items.length))
  }
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={{ width: 680 }} role="dialog" aria-label={t('复制成 LaTeX')}>
        <div className="m-hd">
          <div>
            <h2>{t('复制成 LaTeX')}</h2>
            <p>
              {t('引用写成')} <code className="mono">\cite{'{key}'}</code>
              {t('，key 和文献库导出的 .bib 一致。')}
            </p>
          </div>
          <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="m-bd">
          <div className="mx-code" data-part="latex">
            {data.text}
          </div>
          <div className="mx-bib">
            {data.items.map((it) => (
              <div className="mx-brow" key={it.paperId}>
                <span className={'dot sm ' + (bib.dir && !bib.error ? 'ok' : '')} />
                <code>{it.key}</code>
                <span>{it.title}</span>
              </div>
            ))}
          </div>
          <div className="hint" style={{ lineHeight: 1.6 }}>
            {bib.dir && !bib.error ? (
              <>
                <b style={{ fontWeight: 500, color: 'var(--text)' }}>{t('.bib 里有这 {0} 篇。', data.items.length)}</b> {t('文献库每次加论文、改文献信息都会更新 {0}。', home(bib.file))}{' '}
                {t('用 Overleaf：把这个 .bib 拖进项目一次；付费账号可以把它放进和 Overleaf 用 Git 同步的文件夹，以后自动跟上。')}
              </>
            ) : bib.error ? (
              t('.bib 没写上：{0}', bib.error)
            ) : (
              t('还没导出 .bib：选一个文件夹，文献库整个导出成 ParaRead.bib，以后每加一篇都自动更新。LaTeX 和 Overleaf 都用这个文件。')
            )}
          </div>
        </div>
        <div className="m-ft">
          {bib.dir && !bib.error ? (
            <button className="btn" onClick={() => void api.bibReveal()}>
              <FolderOpen size={14} />
              {t('在 Finder 中显示')}
            </button>
          ) : (
            <button className="btn" onClick={() => void api.bibChoose().then(props.onBib)}>
              <FolderOpen size={14} />
              {t('导出 .bib…')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={props.onClose}>
            {t('关闭')}
          </button>
          <button className="btn primary" onClick={copy}>
            {copied ? t('已复制') : t('复制')}
          </button>
        </div>
      </div>
    </div>
  )
}

function WordOffDialog(props: { onClose: () => void }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label={t('Word 插件还没开')}>
        <div className="m-hd">
          <div>
            <h2>{t('Word 插件还没开')}</h2>
            <p>{t('送进 Word 要用 ParaRead 的 Word 插件：段落插在光标处，引用变成插件管的引用，参考文献表跟着更新。先在设置里装好它。')}</p>
          </div>
        </div>
        <div className="m-ft">
          <span className="spacer" />
          <button className="btn" onClick={props.onClose}>
            {t('关闭')}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              void api.openSettings('word')
              props.onClose()
            }}
          >
            {t('去设置')}
          </button>
        </div>
      </div>
    </div>
  )
}
