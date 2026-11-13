import { NotesPage } from './NotesPage'
import { useCallback, useEffect, useState } from 'react'
import type { Folder, Paper, ReadMode, SettingsView } from '@shared/types'
import { api, errText, type OpenAt, type Project, type ResearchSession, type SyncStatus } from '../api'
import { useToast } from '../lib/ui'
import { AgentPage } from './Agent'
import { Library } from './Library'
import { ResearchPage } from './Research'
import { Sidebar, type Route } from './Sidebar'
import { t } from '@shared/i18n'

export type LibState = { top: number; selected: string[] }

// 主窗口：左边侧栏（文献库、学术 AI 会话、研究项目），右边按路由换内容
export function MainWindow(props: {
  settings: SettingsView
  route: Route
  libState: LibState
  onRoute: (r: Route) => void
  onPricing: () => void
  startWith: 'zotero' | null
  onOpen: (id: string, st: LibState, mode?: ReadMode, ann?: string, at?: OpenAt) => void
}) {
  const toast = useToast()
  const [papers, setPapers] = useState<Paper[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<ResearchSession[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [filter, setFilterState] = useState(props.settings.libFilter)
  const [sideHidden, setSideHidden] = useState(false)
  const [searchSignal, setSearchSignal] = useState(0)
  const route = props.route

  const loadLib = useCallback(() => {
    void api.listPapers().then(setPapers)
    void api.listFolders().then(setFolders)
  }, [])
  const loadSessions = useCallback(() => void api.researchList().then(setSessions), [])
  const loadProjects = useCallback(() => void api.agentProjects().then(setProjects), [])

  useEffect(() => {
    loadLib()
    loadSessions()
    loadProjects()
    void api.syncStatus().then(setSync)
    const offs = [api.onLibraryChanged(loadLib), api.onResearchChanged(loadSessions), api.onSyncStatus(setSync)]
    return () => offs.forEach((f) => f())
  }, [loadLib, loadSessions, loadProjects])

  const setFilter = (f: string): void => {
    setFilterState(f)
    void api.setSettings({ libFilter: f })
    props.onRoute({ kind: 'lib' })
  }

  const newProject = async (): Promise<void> => {
    try {
      const p = await api.agentCreateProject(t('新研究项目'))
      loadProjects()
      props.onRoute({ kind: 'agent', id: p.id })
    } catch (e) {
      toast(t('建不了项目：{0}', errText(e)))
    }
  }
  const makeMatrix = async (ids: string[]): Promise<void> => {
    try {
      const id = await api.matrixCreate(ids)
      loadSessions()
      props.onRoute({ kind: 'ai', id })
    } catch (e) {
      toast(errText(e))
    }
  }
  const askTogether = async (ids: string[]): Promise<void> => {
    const id = await api.researchCreate('ask', ids)
    loadSessions()
    props.onRoute({ kind: 'ai', id })
  }

  useEffect(
    () =>
      api.onCommand((cmd) => {
        if (cmd === 'toggle-left') setSideHidden((v) => !v)
        if (cmd === 'quick-search') {
          props.onRoute({ kind: 'lib' })
          setSearchSignal((n) => n + 1)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return (
    <div className="mw">
      {!sideHidden && (
        <Sidebar
          settings={props.settings}
          papers={papers ?? []}
          folders={folders}
          filter={filter}
          route={route}
          sessions={sessions}
          projects={projects}
          sync={sync}
          onFilter={setFilter}
          onRoute={props.onRoute}
          onSearch={() => {
            props.onRoute({ kind: 'lib' })
            setSearchSignal((n) => n + 1)
          }}
          onHide={() => setSideHidden(true)}
          onNewProject={() => void newProject()}
          onProjectsChanged={loadProjects}
          onPricing={props.onPricing}
        />
      )}
      <main className="mw-main">
        {route.kind === 'lib' && (
          <Library
            settings={props.settings}
            papers={papers}
            folders={folders}
            filter={filter}
            sideHidden={sideHidden}
            searchSignal={searchSignal}
            initial={props.libState}
            startWith={props.startWith}
            onShowSide={() => setSideHidden(false)}
            onFilter={setFilter}
            onOpen={props.onOpen}
            onAskTogether={(ids) => void askTogether(ids)}
            onMakeMatrix={(ids) => void makeMatrix(ids)}
            onAiFind={(q) => void api.researchCreate('find').then((id) => props.onRoute({ kind: 'ai', id, prompt: q }))}
          />
        )}
        {route.kind === 'notes' && <NotesPage sideHidden={sideHidden} onOpen={(id, ann) => props.onOpen(id, props.libState, undefined, ann)} />}
        {route.kind === 'ai' && (
          <ResearchPage
            key={route.id ?? 'new'}
            id={route.id}
            prompt={route.prompt}
            papers={papers ?? []}
            folders={folders}
            settings={props.settings}
            sideHidden={sideHidden}
            onShowSide={() => setSideHidden(false)}
            onCreated={(id, prompt) => {
              loadSessions()
              props.onRoute({ kind: 'ai', id, prompt })
            }}
            onDeleted={() => props.onRoute({ kind: 'ai', id: null })}
            onOpenPaper={(id, at, ann) => props.onOpen(id, props.libState, undefined, ann, at)}
          />
        )}
        {route.kind === 'agent' && (
          <AgentPage
            key={route.id}
            project={projects.find((p) => p.id === route.id) ?? null}
            sideHidden={sideHidden}
            onShowSide={() => setSideHidden(false)}
            onChanged={loadProjects}
            onOpenPaper={(id) => props.onOpen(id, props.libState)}
          />
        )}
      </main>
    </div>
  )
}
