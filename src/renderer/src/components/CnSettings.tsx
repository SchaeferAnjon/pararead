import { Check, ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen, Plus, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CONFUSED } from '@cn/format'
import { t, uiLocale } from '@shared/i18n'
import { api, errText, type CnState, type HlKind, type VaultFolder } from '../api'
import { useToast } from '../lib/ui'

// 设置 › 画布笔记（联动设计 20-pararead联动「两个来源」「划线颜色带含义」）：连上的库、每个库勾哪些文件夹、藏起来的单篇、
// 划线颜色的含义（和画布笔记设置 › 读PDF › 划线颜色同一份）、从旧版迁过来（能撤回）
export function CnSettings() {
  const toast = useToast()
  const [st, setSt] = useState<CnState | null>(null)
  const load = (): void => void api.cnState().then(setSt)
  useEffect(() => {
    load()
    return api.onSettings(load)
  }, [])
  if (!st) return null
  const run = (p: Promise<CnState | null | void>): void =>
    void p.then((x) => (x ? setSt(x) : load())).catch((e) => toast(errText(e)))

  return (
    <>
      <section className="fsec">
        <h3>{t('连上的库')}</h3>
        <div className="fd">{t('画布笔记库里的 PDF 不拷贝，直接读库里那份；划线、问答、读到哪写进 PDF 旁边那篇笔记，两边看到的一样。勾上的文件夹里的 PDF 出现在文献库左栏「画布笔记库」下面。')}</div>
        {st.vaults.length === 0 && <div className="cn-empty hint">{t('还没连画布笔记的库')}</div>}
        {st.vaults.map((v) => (
          <div key={v.root} className="frow cn-vault-set" data-vault={v.root}>
            <div className="fl ellipsis" title={v.root}>
              {v.name}
            </div>
            <div className="fc">
            <div className="cn-vault-hd">
              <span className="hint" title={v.root}>
                {v.missing ? t('没连上：找不到这个文件夹') : t('勾了 {0} 个文件夹', v.folders.length)}
              </span>
              <span className="hint cn-path" title={v.root}>{midCut(v.root, 44)}</span>
              <span className="spacer" />
              <button className="btn sm" onClick={() => run(api.cnDisconnect(v.root))}>
                {t('断开')}
              </button>
            </div>
            {!v.missing && <FolderPicker root={v.root} checked={v.folders} onChange={(f) => run(api.cnSetFolders(v.root, f))} />}
            {v.hidden.length > 0 && (
              <div className="cn-hidden">
                <div className="hint">{t('藏起来的 {0} 篇（库里那份还在）', v.hidden.length)}</div>
                {v.hidden.map((h) => (
                  <div key={h} className="cn-hidden-row">
                    <span className="ellipsis">{h}</span>
                    <button className="btn ghost sm" onClick={() => run(api.cnHide(v.root, h, false))}>
                      {t('放回来')}
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        ))}
        <div className="cn-add">
          {st.suggestions.map((s) => (
            <button key={s.root} className="btn sm" title={s.root} onClick={() => run(api.cnConnect(s.root))}>
              <Plus size={14} />
              {t('连上「{0}」', s.name)}
            </button>
          ))}
          <button className="btn sm" onClick={() => run(api.cnChoose())}>
            <FolderOpen size={14} />
            {t('选文件夹…')}
          </button>
        </div>
        {st.suggestions.length > 0 && <div className="hint">{t('上面是画布笔记在这台 Mac 上开过的库')}</div>}
      </section>
      {st.vaults.length > 0 && <Kinds root={st.vaults.find((v) => !v.missing)?.root ?? null} kinds={st.kinds} onSaved={load} />}
      <Migration st={st} onDone={load} />
    </>
  )
}

/** 长路径从中间截（头尾都留着认得出来） */
const midCut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.ceil(n / 2) - 1)}…${s.slice(s.length - Math.floor(n / 2))}`)

/** 库里的目录树，每个文件夹一个勾；父文件夹下面有勾上的时半勾 */
function FolderPicker(props: { root: string; checked: string[]; onChange: (f: string[]) => void }) {
  const [tree, setTree] = useState<VaultFolder[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => {
    void api.cnTree(props.root).then(setTree)
  }, [props.root])
  const on = new Set(props.checked)
  const toggle = (f: string): void => props.onChange(on.has(f) ? props.checked.filter((x) => x !== f) : [...props.checked, f])
  const below = (f: string): boolean => props.checked.some((x) => x.startsWith(f + '/'))
  const row = (path: string, name: string, pdfs: number | null, depth: number, kids: VaultFolder[]): React.ReactNode => (
    <div key={path || '.'}>
      <div className="cn-folder" style={{ paddingLeft: depth * 18 }} data-folder={path}>
        {kids.length ? (
          <button
            className="chev"
            onClick={() =>
              setOpen((s) => {
                const n = new Set(s)
                if (n.has(path)) n.delete(path)
                else n.add(path)
                return n
              })
            }
          >
            {open.has(path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="chev-sp" />
        )}
        <button className="cn-check" onClick={() => toggle(path)}>
          <span className={'checkbox' + (on.has(path) ? ' on' : below(path) ? ' part' : '')}>{on.has(path) && <Check size={12} strokeWidth={3} />}</span>
          <FolderIcon size={16} />
          <span className="ellipsis">{name}</span>
        </button>
        {pdfs !== null && pdfs > 0 && <span className="hint num">{t('{0} 份 PDF', pdfs)}</span>}
      </div>
      {open.has(path) && kids.map((k) => row(k.path, k.name, k.pdfs, depth + 1, k.children))}
    </div>
  )
  if (!tree) return null
  return <div className="cn-tree">{row('', t('最外层'), null, 0, [])}{tree.map((f) => row(f.path, f.name, f.pdfs, 0, f.children))}</div>
}

/** 划线颜色的含义：名字能改（库里写好的问一次要不要一起改）；加、删一种在画布笔记里做 */
function Kinds(props: { root: string | null; kinds: HlKind[]; onSaved: () => void }) {
  const toast = useToast()
  const [names, setNames] = useState<Record<string, string>>({})
  const [ask, setAsk] = useState<{ key: string; name: string; n: number } | null>(null)
  if (!props.root) return null
  const save = async (key: string, name: string, all: boolean): Promise<void> => {
    try {
      const n = await api.cnRenameKind(props.root!, key, name, all)
      toast(all && n ? t('改好了，库里 {0} 处一起改了', n) : t('改好了'))
      setAsk(null)
      props.onSaved()
    } catch (e) {
      toast(errText(e))
    }
  }
  const commit = async (k: HlKind): Promise<void> => {
    const name = (names[k.key] ?? k.name).trim()
    if (!name || name === k.name) return
    const n = k.key === CONFUSED ? 0 : await api.cnCountKind(props.root!, k.key)
    if (n > 0) setAsk({ key: k.key, name, n })
    else void save(k.key, name, false)
  }
  return (
    <section className="fsec">
      <h3>{t('划线颜色')}</h3>
      <div className="fd">{t('每种颜色有个含义，选中文字时小条上照这个顺序排，键 1 到 {0}。和画布笔记设置 › 读PDF › 划线颜色是同一份（存在库里）。', props.kinds.length)}</div>
      {props.kinds.map((k, i) => (
        <div key={k.key} className="cn-kind" data-kind={k.key}>
          {k.key === CONFUSED ? (
            <svg className="lb-mark" data-label="confused" viewBox="0 0 14 6">
              <path d="M0 4Q1.75 1 3.5 4T7 4T10.5 4T14 4" />
            </svg>
          ) : (
            <span className="hl-dot" data-color={k.color} />
          )}
          <label className="field-fill" style={{ width: 160 }}>
            <input value={names[k.key] ?? k.name} maxLength={12} onChange={(e) => setNames((s) => ({ ...s, [k.key]: e.target.value }))} onBlur={() => void commit(k)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          <span className="hint num">{i < 9 ? t('键 {0}', i + 1) : ''}</span>
          {k.key === CONFUSED && <span className="hint">{t('写成问题段，能一键问 AI')}</span>}
        </div>
      ))}
      {ask && (
        <div className="cn-ask">
          <span>{t('库里已经写了 {0} 处，一起改成「{1}」？', ask.n, ask.name)}</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => void save(ask.key, ask.name, false)}>
            {t('只改以后的')}
          </button>
          <button className="btn sm primary" onClick={() => void save(ask.key, ask.name, true)}>
            {t('一起改')}
          </button>
        </div>
      )}
    </section>
  )
}

/** 从旧版迁过来：做了什么、能撤回 */
function Migration(props: { st: CnState; onDone: () => void }) {
  const toast = useToast()
  const m = props.st.migration
  if (!m) return null
  return (
    <section className="fsec" data-migration={m.undone ? 'undone' : 'done'}>
      <h3>{t('从旧版迁过来')}</h3>
      {m.undone ? (
        <div className="fd">{t('撤回了。老的高亮还是原来的颜色，库里的笔记换回了迁之前的样子。')}</div>
      ) : (
        <div className="fd">
          {t('{0}：{1} 处老高亮按颜色换成了含义（红色没标签的算重点），{2} 篇库里也有的论文指到了库里那份，{3} 篇笔记写进了 ParaRead 里的划线、问答。原来的颜色、ParaRead 自己存的 PDF 都留着。', new Date(m.at).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), m.kinds, m.papers, m.notes)}
        </div>
      )}
      <div className="cn-add">
        {m.undone ? (
          <button className="btn sm" onClick={() => void api.cnMigrate().then(props.onDone, (e) => toast(errText(e)))}>
            {t('重新迁')}
          </button>
        ) : (
          <button
            className="btn sm"
            onClick={() =>
              void api.cnUndoMigration().then(
                (r) => {
                  toast(r.kept ? t('撤回了；{0} 篇笔记之后又改过，没动', r.kept) : t('撤回了'))
                  props.onDone()
                },
                (e) => toast(errText(e))
              )
            }
          >
            <Undo2 size={14} />
            {t('撤回')}
          </button>
        )}
      </div>
    </section>
  )
}
