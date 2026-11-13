import { BookOpen, BookOpenCheck, ChevronDown, ChevronRight, CircleDashed, FlaskConical, Folder as FolderIcon, FolderPlus, KeyRound, LibraryBig, MessagesSquare, Network, PanelLeft, Pencil, Plus, ScrollText, Search, Settings, SquarePen, SquareTerminal, Telescope, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Folder, Paper, SettingsView } from '@shared/types'
import { providerOf } from '@shared/providers'
import { api, errText, type Project, type ResearchKind, type ResearchSession, type SyncStatus } from '../api'
import { showMenu } from '../lib/menu'
import { Kbd, useToast } from '../lib/ui'
import { t } from '@shared/i18n'

export type Route = { kind: 'lib' } | { kind: 'ai'; id: string | null; prompt?: string } | { kind: 'agent'; id: string }

export const SMART = [
  { id: 'all', label: t('全部论文'), icon: LibraryBig },
  { id: 'reading', label: t('在读'), icon: BookOpen },
  { id: 'unread', label: t('未读'), icon: CircleDashed },
  { id: 'done', label: t('读完'), icon: BookOpenCheck }
] as const

export const AI_ICON: Record<ResearchKind, typeof MessagesSquare> = { ask: MessagesSquare, find: Telescope, guide: Network, review: ScrollText }

export function smartCount(id: string, p: Paper): boolean {
  if (id === 'reading') return p.progress > 0 && p.progress < 1
  if (id === 'unread') return !p.lastOpened
  if (id === 'done') return p.progress >= 1
  return true
}

export function Sidebar(props: {
  settings: SettingsView
  papers: Paper[]
  folders: Folder[]
  filter: string
  route: Route
  sessions: ResearchSession[]
  projects: Project[]
  sync: SyncStatus | null
  onFilter: (f: string) => void
  onRoute: (r: Route) => void
  onSearch: () => void
  onHide: () => void
  onNewProject: () => void
  onProjectsChanged: () => void
  onPricing: () => void
}) {
  const s = props.settings
  const toast = useToast()
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const libOn = props.route.kind === 'lib'

  const newFolder = async (parent: string | null): Promise<void> => {
    const id = await api.createFolder(t('新文件夹'), parent)
    setFoldersOpen(true)
    if (parent) setOpenFolders((x) => new Set(x).add(parent))
    setRenaming(id)
  }

  const onFolderMenu = async (e: React.MouseEvent, f: Folder): Promise<void> => {
    e.stopPropagation()
    const act = await showMenu(
      [
        { id: 'sub', label: t('新建子文件夹'), icon: <FolderPlus size={16} /> },
        { id: 'rename', label: t('重命名'), icon: <Pencil size={16} /> },
        ...(f.parentId ? [{ id: 'top', label: t('移到最外层'), icon: <FolderIcon size={16} /> }] : []),
        { type: 'separator' },
        { id: 'delete', label: t('删除文件夹'), icon: <Trash2 size={16} />, danger: true }
      ],
      e
    )
    if (act === 'sub') void newFolder(f.id)
    if (act === 'rename') setRenaming(f.id)
    if (act === 'top') void api.moveFolder(f.id, null)
    if (act === 'delete') {
      await api.deleteFolder(f.id)
      toast(t('已删除文件夹「{0}」，里面的论文还在', f.name))
    }
  }

  // 拖论文进文件夹是加进去；拖文件夹到文件夹是挪进去，拖到「文件夹」标题上是挪到最外层
  const onDrop = async (e: React.DragEvent, fid: string | null): Promise<void> => {
    e.preventDefault()
    setDropOn(null)
    const papersJson = e.dataTransfer.getData('application/x-papers')
    const folderId = e.dataTransfer.getData('application/x-folder')
    if (papersJson && fid) {
      const ids = JSON.parse(papersJson) as string[]
      await api.setFolders(ids, [fid], [])
      toast(t('已把 {0} 篇放进「{1}」', ids.length, props.folders.find((x) => x.id === fid)?.name ?? ''))
    } else if (folderId && folderId !== fid) await api.moveFolder(folderId, fid).catch((er) => toast(errText(er)))
  }

  const folderTree = (parent: string | null, depth: number): React.ReactNode =>
    props.folders
      .filter((f) => f.parentId === parent)
      .map((f) => {
        const kids = props.folders.some((x) => x.parentId === f.id)
        const isOpen = openFolders.has(f.id)
        const on = libOn && props.filter === `folder:${f.id}`
        return (
          <div key={f.id}>
            <div
              className={'nav-item' + (on ? ' on' : '') + (dropOn === f.id ? ' drop' : '')}
              style={{ paddingLeft: 8 + depth * 20 }}
              role="button"
              draggable={renaming !== f.id}
              onDragStart={(e) => e.dataTransfer.setData('application/x-folder', f.id)}
              onDragOver={(e) => {
                e.preventDefault()
                setDropOn(f.id)
              }}
              onDragLeave={() => setDropOn((x) => (x === f.id ? null : x))}
              onDrop={(e) => void onDrop(e, f.id)}
              onClick={() => props.onFilter(`folder:${f.id}`)}
              onDoubleClick={() => setRenaming(f.id)}
              onContextMenu={(e) => void onFolderMenu(e, f)}
            >
              {kids ? (
                <span
                  className="chev"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenFolders((x) => {
                      const n = new Set(x)
                      if (n.has(f.id)) n.delete(f.id)
                      else n.add(f.id)
                      return n
                    })
                  }}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
              ) : (
                <span className="chev-sp" />
              )}
              <FolderIcon size={16} />
              {renaming === f.id ? (
                <Rename
                  value={f.name}
                  onDone={(v) => {
                    if (v && v !== f.name) void api.renameFolder(f.id, v)
                    setRenaming(null)
                  }}
                />
              ) : (
                <span className="l">{f.name}</span>
              )}
              <span className="count">{f.count || ''}</span>
            </div>
            {kids && isOpen && folderTree(f.id, depth + 1)}
          </div>
        )
      })

  const onSessionMenu = async (e: React.MouseEvent, x: ResearchSession): Promise<void> => {
    const act = await showMenu(
      [
        { id: 'rename', label: t('重命名'), icon: <Pencil size={16} /> },
        { type: 'separator' },
        { id: 'delete', label: t('删除会话'), icon: <Trash2 size={16} />, danger: true }
      ],
      e
    )
    if (act === 'rename') setRenamingSession(x.id)
    if (act === 'delete') {
      await api.researchDelete(x.id)
      if (props.route.kind === 'ai' && props.route.id === x.id) props.onRoute({ kind: 'ai', id: null })
    }
  }

  const onProjectMenu = async (e: React.MouseEvent, x: Project): Promise<void> => {
    const act = await showMenu(
      [
        { id: 'rename', label: t('重命名'), icon: <Pencil size={16} /> },
        { id: 'reveal', label: t('在 Finder 中显示'), icon: <FolderIcon size={16} /> },
        { type: 'separator' },
        { id: 'delete', label: t('删除项目…'), icon: <Trash2 size={16} />, danger: true }
      ],
      e
    )
    if (act === 'rename') setRenamingProject(x.id)
    if (act === 'reveal') void api.agentReveal(x.id)
    if (act === 'delete') {
      const sure = await showMenu(
        [
          { type: 'section', label: t('删除「{0}」？项目文件夹会移到废纸篓', x.name) },
          { id: 'yes', label: t('删除'), icon: <Trash2 size={16} />, danger: true },
          { id: 'no', label: t('取消') }
        ],
        e
      )
      if (sure !== 'yes') return
      await api.agentDeleteProject(x.id)
      props.onProjectsChanged()
      if (props.route.kind === 'agent' && props.route.id === x.id) props.onRoute({ kind: 'lib' })
    }
  }

  const prov = providerOf(s.provider)
  const hasKey = s.apiKeySource !== 'none' || s.provider === 'member' || !!prov.local
  const syncDot = !props.sync?.enabled ? '' : props.sync.error ? 'err' : props.sync.waiting ? 'warn' : 'ok'

  return (
    <aside className="sb" style={{ width: 'var(--sidebar-w)' }}>
      <div className="sb-top drag">
        <button className="icon-btn" title={t('收起侧栏 ⌃⌘S')} onClick={props.onHide}>
          <PanelLeft size={16} />
        </button>
      </div>
      <div className="sb-scroll">
        <button className="search-trigger" onClick={props.onSearch}>
          <Search size={16} />
          <span className="ph">{t('搜索')}</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </button>
        <div className="nav">
          {SMART.map((x) => (
            <button key={x.id} className={'nav-item' + (libOn && props.filter === x.id ? ' on' : '')} onClick={() => props.onFilter(x.id)}>
              <x.icon size={16} />
              <span className="l">{x.label}</span>
              <span className="count">{props.papers.filter((p) => smartCount(x.id, p)).length}</span>
            </button>
          ))}
        </div>

        <div
          className={'nav-sec' + (dropOn === '__top' ? ' drop' : '')}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-folder')) {
              e.preventDefault()
              setDropOn('__top')
            }
          }}
          onDragLeave={() => setDropOn(null)}
          onDrop={(e) => void onDrop(e, null)}
        >
          <span onClick={() => setFoldersOpen((v) => !v)}>{t('文件夹')}</span>
          <span className="spacer" />
          <button className="icon-btn" title={t('新建文件夹')} onClick={() => void newFolder(null)}>
            <FolderPlus size={14} />
          </button>
        </div>
        {foldersOpen && (
          <div className="nav">
            {props.folders.length ? (
              folderTree(null, 0)
            ) : (
              <button className="nav-item muted" onClick={() => void newFolder(null)}>
                <Plus size={16} />
                <span className="l">{t('新建文件夹')}</span>
              </button>
            )}
          </div>
        )}

        <div className="nav-sec">
          <span>{t('学术 AI')}</span>
          <span className="spacer" />
          <button className="icon-btn" title={t('新会话')} onClick={() => props.onRoute({ kind: 'ai', id: null })}>
            <SquarePen size={14} />
          </button>
        </div>
        <div className="nav">
          {props.sessions.slice(0, 8).map((x) => {
            const Icon = AI_ICON[x.kind]
            return (
              <button
                key={x.id}
                className={'nav-item' + (props.route.kind === 'ai' && props.route.id === x.id ? ' on' : '')}
                onClick={() => props.onRoute({ kind: 'ai', id: x.id })}
                onContextMenu={(e) => void onSessionMenu(e, x)}
              >
                <Icon size={16} />
                {renamingSession === x.id ? (
                  <Rename
                    value={x.title}
                    onDone={(v) => {
                      if (v && v !== x.title) void api.researchRename(x.id, v)
                      setRenamingSession(null)
                    }}
                  />
                ) : (
                  <span className="l">{x.title}</span>
                )}
              </button>
            )
          })}
          <button className={'nav-item muted' + (props.route.kind === 'ai' && !props.route.id ? ' on' : '')} onClick={() => props.onRoute({ kind: 'ai', id: null })}>
            <MessagesSquare size={16} />
            <span className="l">{t('新会话')}</span>
          </button>
        </div>

        <div className="nav-sec">
          <span>{t('研究项目')}</span>
          <span className="spacer" />
          <button className="icon-btn" title={t('新建研究项目')} onClick={props.onNewProject}>
            <Plus size={14} />
          </button>
        </div>
        <div className="nav">
          {props.projects.map((x) => (
            <button
              key={x.id}
              className={'nav-item' + (props.route.kind === 'agent' && props.route.id === x.id ? ' on' : '')}
              onClick={() => props.onRoute({ kind: 'agent', id: x.id })}
              onContextMenu={(e) => void onProjectMenu(e, x)}
            >
              <FlaskConical size={16} />
              {renamingProject === x.id ? (
                <Rename
                  value={x.name}
                  onDone={(v) => {
                    if (v && v !== x.name) void api.agentRenameProject(x.id, v).then(props.onProjectsChanged)
                    setRenamingProject(null)
                  }}
                />
              ) : (
                <span className="l">{x.name}</span>
              )}
            </button>
          ))}
          {!props.projects.length && (
            <button className="nav-item muted" onClick={props.onNewProject}>
              <Plus size={16} />
              <span className="l">{t('新建研究项目')}</span>
            </button>
          )}
        </div>
      </div>

      <div className="sb-foot">
        <button className="plan" onClick={() => (s.provider === 'member' ? void api.openSettings('member') : props.onPricing())}>
          {s.provider === 'member' ? (
            <>
              <span className="t">
                <KeyRound size={14} />
                {t('会员')}
              </span>
              <span className="d">{t('AI 走会员通道，不用 Key')}</span>
            </>
          ) : prov.local ? (
            <>
              <span className="t">
                <SquareTerminal size={14} />
                {prov.name}
              </span>
              <span className="d">{prov.blurb}</span>
            </>
          ) : hasKey ? (
            <>
              <span className="t">
                <KeyRound size={14} />
                {t('自带 Key')}
                <span className="spacer" />
                <span className="count">{prov.name}</span>
              </span>
              <span className="d">{t('用你自己的 Key，永久免费')}</span>
            </>
          ) : (
            <>
              <span className="t">
                <KeyRound size={14} />
                {t('还没设 AI 服务')}
              </span>
              <span className="d">{t('选一家服务，填上 Key 就能用翻译和问答')}</span>
            </>
          )}
        </button>
        <div className="strip">
          <span title={hasKey ? `AI：${prov.name}` : t('AI 还没设 Key')}>
            <i className={'dot ' + (hasKey ? 'ok' : 'warn')} />
            AI
          </span>
          <span title={s.mineruPath || t('没装重排引擎')}>
            <i className={'dot ' + (s.mineruPath ? 'ok' : 'warn')} />
            {t('重排 本地')}
          </span>
          <span title={props.sync?.error ?? (props.sync?.enabled ? t('同步已开') : t('同步没开'))}>
            <i className={'dot ' + syncDot} />
            {t('同步')}
          </span>
        </div>
        <button className="nav-item" onClick={() => void api.openSettings()}>
          <Settings size={16} />
          <span className="l">{t('设置')}</span>
          <Kbd>⌘</Kbd>
          <Kbd>,</Kbd>
        </button>
      </div>
    </aside>
  )
}

function Rename(props: { value: string; onDone: (v: string | null) => void }) {
  return (
    <input
      autoFocus
      defaultValue={props.value}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => props.onDone(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') props.onDone(null)
        e.stopPropagation()
      }}
    />
  )
}
