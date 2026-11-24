import { ChevronDown, ChevronRight, FileText, Folder as FolderIcon, NotebookText, Search as SearchIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import type { Paper } from '@shared/types'
import { api, errText, type PlaceInfo, type PlacePreview, type VaultFolder } from '../api'
import { showMenu } from '../lib/menu'
import { useToast } from '../lib/ui'
import { Modal, ModalHead } from './PaperInfo'

const fmtSize = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// 文献库右键「放到画布笔记…」（联动设计 20-pararead联动「两个来源」）：选库、选文件夹，PDF 和配对笔记一起放进去，
// ParaRead 里的划线、问答、读到哪写进那篇笔记；文献库里留着这一条，指到库里那份
export function PlaceDialog(props: { paper: Paper; onClose: () => void; onPlaced: () => void }) {
  const toast = useToast()
  const [info, setInfo] = useState<PlaceInfo | null>(null)
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<VaultFolder[] | null>(null)
  const [folder, setFolder] = useState<string>('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [pre, setPre] = useState<PlacePreview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.cnPlaceInfo(props.paper.id).then((x) => {
      setInfo(x)
      const r = x.last?.root ?? x.vaults[0]?.root ?? null
      setRoot(r)
      if (x.last && x.last.root === r) {
        setFolder(x.last.folder)
        // 默认停在最近一次放进去的文件夹：把它的上几层展开
        const parts = x.last.folder.split('/')
        setOpen(new Set(parts.map((_, i) => parts.slice(0, i + 1).join('/')).slice(0, -1)))
      }
    }, (e) => toast(errText(e)))
  }, [props.paper.id, toast])
  useEffect(() => {
    if (root) void api.cnTree(root).then(setTree)
  }, [root])
  useEffect(() => {
    if (!root) return
    void api.cnPlacePreview(props.paper.id, root, folder).then(setPre, () => setPre(null))
  }, [root, folder, props.paper.id])

  // 打字找：列出名字里有这几个字的文件夹（平铺，写全路径）
  const flat = useMemo(() => {
    const out: VaultFolder[] = []
    const walk = (l: VaultFolder[]): void => l.forEach((f) => (out.push(f), walk(f.children)))
    walk(tree ?? [])
    return out
  }, [tree])
  const hits = q.trim() ? flat.filter((f) => f.path.toLowerCase().includes(q.trim().toLowerCase())) : null

  const vault = info?.vaults.find((v) => v.root === root)
  const folderName = folder ? folder.split('/').pop()! : (vault?.name ?? '')

  const place = async (): Promise<void> => {
    if (!root) return
    setBusy(true)
    try {
      const r = await api.cnPlace(props.paper.id, root, folder)
      toast(t('放进了「{0}」：{1}', folderName, r.pdf.split('/').pop() ?? r.pdf))
      props.onPlaced()
      props.onClose()
    } catch (e) {
      toast(errText(e))
      setBusy(false)
    }
  }

  const row = (f: VaultFolder, depth: number, flatRow = false): React.ReactNode => (
    <div key={f.path}>
      <div className={'z-row cn-place-row' + (folder === f.path ? ' on' : '')} style={{ paddingLeft: 10 + depth * 18 }} data-folder={f.path} onClick={() => setFolder(f.path)} onDoubleClick={() => void place()}>
        {!flatRow && f.children.length ? (
          <span
            className="chev"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((s) => {
                const n = new Set(s)
                if (n.has(f.path)) n.delete(f.path)
                else n.add(f.path)
                return n
              })
            }}
          >
            {open.has(f.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="chev" />
        )}
        <FolderIcon size={16} />
        <span className="ellipsis" style={{ flex: 1 }}>
          {flatRow ? f.path : f.name}
        </span>
        {f.pdfs > 0 && <span className="hint num">{t('{0} 份 PDF', f.pdfs)}</span>}
      </div>
      {!flatRow && open.has(f.path) && f.children.map((k) => row(k, depth + 1))}
    </div>
  )

  return (
    <Modal width={560} label={t('放到画布笔记')} onClose={props.onClose} className="cn-place">
      <ModalHead title={t('放到画布笔记')} sub={t('PDF 和它的笔记一起放进画布笔记库里的一个文件夹，划线、问答、读到哪写进那篇笔记。')} onClose={props.onClose} />
      <div className="m-bd">
        <div className="cn-place-paper">
          <div className="ellipsis">{props.paper.title}</div>
          {info && (
            <div className="hint">
              {[info.size ? fmtSize(info.size) : '', t('划线 {0} 处', info.marks), info.asks ? t('问过 {0} 问', info.asks) : '', info.readAt ? t('读到 {0}', info.readAt) : ''].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {info && info.vaults.length === 0 ? (
          <div className="hint">{t('还没连画布笔记的库：在设置 › 画布笔记里连一个。')}</div>
        ) : (
          <>
            <div className="cn-place-top">
              {info && info.vaults.length > 1 && (
                <button
                  className="btn"
                  onClick={async (e) => {
                    const act = await showMenu(info.vaults.map((v) => ({ id: v.root, label: v.name, checked: v.root === root })), { el: e.currentTarget })
                    if (act) {
                      setRoot(act)
                      setFolder('')
                    }
                  }}
                >
                  {vault?.name}
                  <ChevronDown size={14} />
                </button>
              )}
              <label className="field-fill" style={{ flex: 1 }}>
                <SearchIcon size={16} />
                <input autoFocus placeholder={t('找文件夹')} value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
            <div className="z-tree cn-place-tree">
              {!hits && (
                <div className={'z-row cn-place-row' + (folder === '' ? ' on' : '')} style={{ paddingLeft: 10 }} data-folder="" onClick={() => setFolder('')}>
                  <span className="chev" />
                  <FolderIcon size={16} />
                  <span className="ellipsis" style={{ flex: 1 }}>
                    {t('{0}（最外层）', vault?.name ?? '')}
                  </span>
                </div>
              )}
              {(hits ?? tree ?? []).map((f) => row(f, hits ? 0 : 1, !!hits))}
              {hits && hits.length === 0 && <div className="hint" style={{ padding: '6px 12px' }}>{t('没有叫这个的文件夹')}</div>}
            </div>
            {pre && (
              <div className="cn-place-names">
                <div className="cn-place-sub">{t('放进去以后')}</div>
                <div className="cn-place-name">
                  <FileText size={14} />
                  <span className="ellipsis">{pre.pdf.split('/').join(' › ')}</span>
                  {pre.reuse && <span className="hint">{t('库里已有一模一样的一份，直接用它')}</span>}
                  {pre.renamed && <span className="hint">{t('已有同名的一份，换个名字')}</span>}
                </div>
                <div className="cn-place-name">
                  <NotebookText size={14} />
                  <span className="ellipsis">{pre.note.split('/').join(' › ')}</span>
                  {pre.noteExists && <span className="hint">{t('库里已有这篇的笔记，会并进去')}</span>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="m-ft">
        <span className="hint">{t('文献库里留着这一条，指到库里那份')}</span>
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>
          {t('取消')}
        </button>
        <button className="btn primary" disabled={!root || busy || !pre} onClick={() => void place()}>
          {busy ? <span className="spin spin-12" /> : null}
          {t('放进「{0}」', folderName)}
        </button>
      </div>
    </Modal>
  )
}
