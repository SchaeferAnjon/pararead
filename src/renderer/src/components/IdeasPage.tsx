import { ArrowUpRight, Code, Copy, Hash, Lightbulb, PenLine, Search, Send, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { groupIdeas, ideaLatex, ideaPlain, matchIdea, secondaryCites, type IdeaGroupBy } from '@shared/ideas'
import { t } from '@shared/i18n'
import type { IdeaEntry, IdeaHow, SettingsView } from '@shared/types'
import { inText, inTextHtml, numbering, WORD_STYLES, type WordStyle } from '@shared/wordCite'
import { api, errText, type BibStatus } from '../api'
import { showMenu } from '../lib/menu'
import { authorsShort, Segmented, Skeleton, useToast } from '../lib/ui'
import { HOW_NAME } from './IdeaCard'
import { WordOffDialog } from './matrix/WriteDrawer'
import '../styles/writing.css'

const who = (i: IdeaEntry): string => {
  const a = i.paperAuthors
  const last = (x: string): string => (x.includes(',') ? x.split(',')[0] : (x.trim().split(/\s+/).pop() ?? x)).trim()
  const name = a.length === 0 ? i.paperTitle.split(/\s+/).slice(0, 3).join(' ') : a.length === 1 ? last(a[0]) : t('{0} 等', last(a[0]))
  return [name, i.paperYear].filter(Boolean).join(' ')
}

// 灵感库：读到的好句子都在这里，按主题、论文或时间分组，能搜；点一条右边出「用这一条」（直接引原句带页码、AI 转述、复制成 LaTeX、送进 Word），
// 「回到原处」打开论文跳到那一句
export function IdeasPage(props: { sideHidden: boolean; settings: SettingsView; focus?: string; onOpen: (paperId: string, ideaId: string) => void }) {
  const toast = useToast()
  const [all, setAll] = useState<IdeaEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [by, setBy] = useState<IdeaGroupBy>(props.settings.ideaGroup)
  const [sel, setSel] = useState<string | null>(props.focus ?? null)
  const [wordOff, setWordOff] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const load = (): void => void api.ideaAll().then(setAll)
    load()
    const offs = [api.onIdeasChanged(load), api.onLibraryChanged(load)]
    return () => offs.forEach((f) => f())
  }, [])
  // 从阅读页点「在灵感库里看」进来的：那一条滚到眼前
  useEffect(() => {
    if (!all || !props.focus) return
    listRef.current?.querySelector(`[data-idea="${CSS.escape(props.focus)}"]`)?.scrollIntoView({ block: 'center' })
  }, [all, props.focus])

  const hits = useMemo(() => (all ?? []).filter((i) => matchIdea(i, q)), [all, q])
  const groups = useMemo(() => groupIdeas(hits, by), [hits, by])
  const papers = new Set((all ?? []).map((i) => i.paperId)).size
  const cur = all?.find((i) => i.id === sel) ?? null

  const setGroup = (v: IdeaGroupBy): void => {
    setBy(v)
    void api.setSettings({ ideaGroup: v })
  }
  const copyLatex = (i: IdeaEntry, how: IdeaHow = 'quote', para = ''): void => {
    if (!i.bibKey) return toast(t('这篇没有 .bib 的 key'))
    void navigator.clipboard.writeText(ideaLatex(i, i.bibKey, how, para))
    toast(t('已复制 LaTeX，key 是 {0}', i.bibKey))
  }
  const toWord = async (i: IdeaEntry, how: IdeaHow, lang: 'en' | 'zh'): Promise<void> => {
    try {
      const r = await api.ideaToWord(i.id, how, lang)
      toast(r.paneOpen ? t('已送进 Word：插在光标处') : t('已送到 Word：在 Word 里打开 ParaRead 窗格，点「插入」'))
    } catch (e) {
      if (errText(e) === 'word-off') setWordOff(true)
      else toast(errText(e))
    }
  }
  const remove = async (i: IdeaEntry): Promise<void> => {
    await api.ideaDelete(i.id)
    if (sel === i.id) setSel(null)
    toast(t('已从灵感库拿掉'), { label: t('撤销'), run: () => void api.ideaSave(i) })
  }
  const menu = async (e: React.MouseEvent, i: IdeaEntry): Promise<void> => {
    const act = await showMenu(
      [
        { id: 'open', label: t('回到原处'), icon: <ArrowUpRight size={16} /> },
        { id: 'tex', label: t('复制 LaTeX'), icon: <Code size={16} /> },
        { id: 'plain', label: t('复制文字'), icon: <Copy size={16} /> },
        { id: 'word', label: t('送进 Word'), icon: <Send size={16} /> },
        { type: 'separator' },
        { id: 'del', label: t('从灵感库拿掉'), icon: <Trash2 size={16} />, danger: true }
      ],
      e
    )
    if (act === 'open') props.onOpen(i.paperId, i.id)
    if (act === 'tex') copyLatex(i)
    if (act === 'plain') void navigator.clipboard.writeText(ideaPlain(i, 'quote')).then(() => toast(t('已复制')))
    if (act === 'word') void toWord(i, 'quote', 'en')
    if (act === 'del') void remove(i)
  }

  return (
    <div className="notes-page ideas-page">
      <div className={'titlebar drag np-bar' + (props.sideHidden ? ' no-side' : '')}>
        <Lightbulb size={16} className="idea-ic" />
        <span className="bar-title">{t('灵感库')}</span>
        {all && <span className="hint num">{t('{0} 条 · 来自 {1} 篇', all.length, papers)}</span>}
        <span className="spacer" />
        <Segmented className="sm" value={by} onChange={setGroup} options={[{ value: 'topic', label: t('按主题') }, { value: 'paper', label: t('按论文') }, { value: 'time', label: t('按时间') }]} />
        <label className="field-fill np-search">
          <Search size={14} />
          <input value={q} placeholder={t('搜原句、用法、主题、论文')} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="ideas-body">
      <div className="np-list" ref={listRef}>
        {all && !groups.length && (
          <div className="np-empty">
            <Lightbulb size={28} strokeWidth={1.5} />
            <b>{all.length ? t('灵感库里没有「{0}」', q) : t('灵感库还是空的')}</b>
            <span>{all.length ? t('换个词，或者清空搜索') : t('读论文时选中一句，点工具条上的「灵感」，写一句想怎么用、打个主题，写论文时在这里和 Word 里都找得到')}</span>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key || '__none'} className="np-group">
            <div className="ig-head">
              {by === 'topic' && g.key && <Hash size={14} />}
              <span className="tt">{g.title}</span>
              <span className="hint num">{t('{0} 条', g.items.length)}</span>
            </div>
            {by === 'paper' && <div className="hint ig-sub">{[authorsShort(g.items[0].paperAuthors), g.items[0].paperYear].filter(Boolean).join(' · ')}</div>}
            {g.items.map((i) => {
              const sec = secondaryCites(i.text)
              return (
                <div key={g.key + i.id} className={'np-item idea-item' + (sel === i.id ? ' on' : '')} data-idea={i.id} role="button" tabIndex={0} onClick={() => setSel(i.id)} onContextMenu={(e) => void menu(e, i)}>
                  <span className="np-mark">
                    <Lightbulb size={14} className="idea-ic" />
                  </span>
                  <span className="np-body">
                    <span className="np-quote">{i.text}</span>
                    {i.use && <span className="idea-use">{i.use}</span>}
                    {sec.length > 0 && (
                      <span className="idea-warn">
                        <span className="dot sm warn" />
                        {t('这句转引了 {0}，写论文时引原文献更稳', sec.join(' '))}
                      </span>
                    )}
                    <span className="idea-meta">
                      {by !== 'topic' &&
                        i.topics.map((x) => (
                          <span key={x} className="tag sm">
                            {x}
                          </span>
                        ))}
                      <span className="hint num">{[by !== 'paper' ? who(i) : '', i.page ? t('第 {0} 页', i.page) : '', i.section, i.how === 'quote' ? t('直接引') : t('转述'), new Date(i.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
                      <span className="idea-acts" onClick={(e) => e.stopPropagation()}>
                        <button className="btn ghost sm" onClick={() => copyLatex(i, i.how === 'paraphrase' && i.paraphrase?.en ? 'paraphrase' : 'quote', i.paraphrase?.en ?? '')}>
                          <Code size={14} />
                          {t('复制 LaTeX')}
                        </button>
                        <button className="btn ghost sm" onClick={() => void toWord(i, 'quote', 'en')}>
                          <Send size={14} />
                          {t('送进 Word')}
                        </button>
                        <button className="btn ghost sm" onClick={() => props.onOpen(i.paperId, i.id)}>
                          <ArrowUpRight size={14} />
                          {t('回到原处')}
                        </button>
                      </span>
                    </span>
                  </span>
                </div>
              )
            })}
          </section>
        ))}
      </div>
      {cur && <UseDrawer key={cur.id} i={cur} style={props.settings.wordStyle} onClose={() => setSel(null)} onLatex={copyLatex} onWord={toWord} onOpen={() => props.onOpen(cur.paperId, cur.id)} />}
      </div>
      {wordOff && <WordOffDialog onClose={() => setWordOff(false)} />}
    </div>
  )
}

// 「用这一条」：直接引原句（带页码）还是转述（点了才让 AI 写，存下来）；格式跟 Word 插件的默认格式；LaTeX 的 key 和 .bib 一致
function UseDrawer(props: { i: IdeaEntry; style: WordStyle; onClose: () => void; onLatex: (i: IdeaEntry, how: IdeaHow, para: string) => void; onWord: (i: IdeaEntry, how: IdeaHow, lang: 'en' | 'zh') => Promise<void>; onOpen: () => void }) {
  const { i } = props
  const toast = useToast()
  const [how, setHow] = useState<IdeaHow>(i.how)
  const [style, setStyle] = useState<WordStyle>(props.style)
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [bib, setBib] = useState<BibStatus | null>(null)
  useEffect(() => void api.bibStatus().then(setBib), [])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => void (e.key === 'Escape' && props.onClose())
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [props])
  const para = i.paraphrase?.[lang] ?? ''
  const paraphrase = async (again = false): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      await api.ideaParaphrase(i.id, lang, again)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const changeHow = (v: IdeaHow): void => {
    setHow(v)
    if (v !== i.how) void api.ideaSave({ ...i, how: v, updatedAt: Date.now() })
  }
  // 预览：这篇在文档里当第 1 篇
  const item = { id: i.paperId, title: i.paperTitle, authors: i.paperAuthors, year: i.paperYear, venue: null, volume: null, issue: null, pages: null, doi: null, url: null, publisher: null, arxiv: null }
  const num = numbering([[i.paperId]])
  const cite = (page: number | null): React.ReactNode => {
    const html = inTextHtml([i.paperId], style, num, { [i.paperId]: item }, page)
    return html ? (
      <span className="c">
        [1]<sup>{page}</sup>
      </span>
    ) : (
      <span className="c">{inText([i.paperId], style, num, { [i.paperId]: item }, page)}</span>
    )
  }
  const zh = /[一-鿿]/.test(para)
  const latex = how === 'quote' ? ideaLatex(i, i.bibKey, 'quote') : para ? ideaLatex(i, i.bibKey, 'paraphrase', para) : ''
  const home = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
  const ready = how === 'quote' || !!para
  return (
    <aside className="mx-drawer idea-drawer" aria-label={t('用这一条')}>
      <div className="mx-dh">
        <b>{t('用这一条')}</b>
        <button className="icon-btn" title={t('关闭')} onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="idea-db">
        <div className="idea-src">
          <div className="q">{i.text}</div>
          <div className="hint">
            {[who(i), i.page ? t('第 {0} 页', i.page) : '', i.section].filter(Boolean).join(' · ')}
            <button className="text-btn" onClick={props.onOpen}>
              {t('回到原处')}
            </button>
          </div>
        </div>
        {i.use && <div className="idea-use">{i.use}</div>}
        {i.topics.length > 0 && (
          <div className="idea-meta">
            {i.topics.map((x) => (
              <span key={x} className="tag sm">
                {x}
              </span>
            ))}
          </div>
        )}
        <div className="idea-row">
          <Segmented className="sm" value={how} onChange={changeHow} options={[{ value: 'quote', label: HOW_NAME.quote }, { value: 'paraphrase', label: t('转述') }]} />
          <span className="spacer" />
          <span className="hint">{t('格式')}</span>
          <Segmented className="sm" value={style} onChange={setStyle} options={WORD_STYLES.map((s) => ({ value: s.id, label: s.id === 'gbt' ? 'GB/T 7714' : s.id === 'apa' ? 'APA' : s.id === 'mla' ? 'MLA' : 'IEEE' }))} />
        </div>
        {how === 'quote' ? (
          <>
            <div className="idea-out" data-part="quote">
              “{i.text}” {cite(i.page)}
            </div>
            <div className="hint">{i.page ? t('直接引用带页码：第 {0} 页是 PDF 的页序，论文自己印的页码不一样时改成印的那个。', i.page) : t('这句没找到页码，引用里不带页码。')}</div>
          </>
        ) : busy ? (
          <div className="idea-out">
            <Skeleton lines={[100, 70]} />
          </div>
        ) : para ? (
          <>
            <div className="idea-out" data-part="paraphrase">
              {para.replace(/[。．.！!？?]$/, '')} {cite(null)}
              {zh ? '。' : '.'}
            </div>
            <div className="idea-row">
              <Segmented className="sm" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'zh', label: t('中文') }]} />
              <button className="btn ghost sm" onClick={() => void paraphrase(true)}>
                {t('换个说法')}
              </button>
            </div>
            <div className="hint">{t('转述是 AI 写的，对过原句再用；转述不带页码。')}</div>
          </>
        ) : (
          <div className="idea-out idea-empty">
            <div className="hint">{t('用 AI 把这句换成你的话，花一次额度，转好的存下来')}</div>
            <div className="idea-row">
              <Segmented className="sm" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'zh', label: t('中文') }]} />
              <button className="btn" onClick={() => void paraphrase()}>
                <PenLine size={14} />
                {t('转述这一句')}
              </button>
            </div>
            {err && (
              <div className="inline-err">
                <span className="dot sm err" />
                {err}
              </div>
            )}
          </div>
        )}
        {latex && (
          <>
            <div className="mx-subh">LaTeX</div>
            <div className="mx-code" data-part="latex">
              {latex}
            </div>
            <div className="hint">
              {bib?.dir && !bib.error ? t('key {0} 和自动导出的 {1} 里的一致', i.bibKey, home(bib.file)) : t('key {0} 和文献库导出的 .bib 一致；还没开自动导出：设置 › 存储 › 自动导出 .bib', i.bibKey)}
            </div>
          </>
        )}
      </div>
      <div className="idea-df">
        <button className="btn" disabled={!ready} onClick={() => props.onLatex(i, how, para)}>
          <Code size={14} />
          {t('复制 LaTeX')}
        </button>
        <button className="btn" disabled={!ready} onClick={() => void navigator.clipboard.writeText(ideaPlain(i, how, para)).then(() => toast(t('已复制')))}>
          <Copy size={14} />
          {t('复制文字')}
        </button>
        <span className="spacer" />
        <button className="btn primary" disabled={!ready} onClick={() => void props.onWord(i, how, lang)}>
          <Send size={14} />
          {t('送进 Word')}
        </button>
      </div>
    </aside>
  )
}
