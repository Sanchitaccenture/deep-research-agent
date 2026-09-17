import { useCallback, useEffect, useState } from 'react'
import CommandPalette from './components/CommandPalette'
import Dashboard from './components/Dashboard'
import ErrorBoundary from './components/ErrorBoundary'
import Header from './components/Header'
import ResearchStage from './components/ResearchStage'
import SearchPanel from './components/SearchPanel'
import SettingsModal from './components/SettingsModal'
import ShortcutsModal from './components/ShortcutsModal'
import Sidebar from './components/Sidebar'
import { ToastProvider } from './components/Toast'
import { useHotkeys } from './hooks/useHotkeys'
import { useResearch } from './hooks/useResearch'
import { api } from './lib/api'
import type {
  DocumentInfo,
  ReportTemplate,
  SessionSummary,
  StatusResponse,
} from './types'

type View = 'dashboard' | 'search' | 'stage'

export default function App() {
  const research = useResearch()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [template, setTemplate] = useState<ReportTemplate>('default')
  const [question, setQuestion] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [view, setView] = useState<View>('dashboard')

  const refreshMeta = useCallback(async () => {
    try {
      const [s, d, st] = await Promise.all([
        api.listSessions(),
        api.listDocuments().catch(() => [] as DocumentInfo[]),
        api.status().catch(() => null),
      ])
      setSessions(s)
      setDocuments(d)
      setStatus(st)
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    refreshMeta()
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleHash = () => {
    const m = /^#\/session\/([\w-]+)/.exec(window.location.hash || '')
    if (m) {
      research.loadSession(m[1]).catch(() => undefined)
      setView('stage')
    }
  }

  useEffect(() => {
    if (research.state.running || research.state.report) {
      setView('stage')
    }
  }, [research.state.running, research.state.report])

  useEffect(() => {
    if (!research.state.running && research.state.report) {
      refreshMeta()
      if (research.state.sessionId) {
        window.history.replaceState(null, '', `#/session/${research.state.sessionId}`)
      }
    }
  }, [research.state.running, research.state.report, research.state.sessionId, refreshMeta])

  const onSubmit = (q: string) => {
    setQuestion(q)
    research.start(q, 'langgraph', template)
    setView('stage')
  }

  const onSelectSession = async (id: string) => {
    await research.loadSession(id)
    const s = sessions.find((x) => x.id === id)
    if (s) {
      setQuestion(s.question)
      setTemplate(s.template)
    }
    window.history.replaceState(null, '', `#/session/${id}`)
    setView('stage')
  }

  const onDeleteSession = async (id: string) => {
    await api.deleteSession(id)
    if (research.state.sessionId === id) {
      research.reset()
      window.history.replaceState(null, '', '#/')
      setView('dashboard')
    }
    refreshMeta()
  }

  const onNewChat = () => {
    research.reset()
    setQuestion('')
    window.history.replaceState(null, '', '#/')
    setView('dashboard')
  }

  const openSearch = (opts?: { template?: ReportTemplate }) => {
    research.reset()
    setQuestion('')
    if (opts?.template) setTemplate(opts.template)
    window.history.replaceState(null, '', '#/')
    setView('search')
  }

  const openDashboard = () => {
    research.reset()
    window.history.replaceState(null, '', '#/')
    setView('dashboard')
  }

  const onUploaded = () => refreshMeta()

  const onMetaChange = () => {
    research.reloadCurrent()
    refreshMeta()
  }

  useHotkeys([
    {
      combo: 'meta+k',
      handler: (e) => {
        e.preventDefault()
        setShowPalette((v) => !v)
      },
      ignoreInInputs: false,
    },
    {
      combo: 'meta+n',
      handler: (e) => {
        e.preventDefault()
        openSearch()
      },
    },
    {
      combo: 'meta+h',
      handler: (e) => {
        e.preventDefault()
        openDashboard()
      },
    },
    {
      combo: 'meta+,',
      handler: (e) => {
        e.preventDefault()
        setShowSettings(true)
      },
    },
    {
      combo: 'meta+/',
      handler: (e) => {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      },
    },
    {
      combo: 'escape',
      handler: () => {
        setShowPalette(false)
        setShowSettings(false)
        setShowShortcuts(false)
      },
      ignoreInInputs: false,
    },
  ])

  return (
    <ErrorBoundary>
    <ToastProvider>
    <div className="flex h-screen w-screen text-slate-200">
      <Sidebar
        sessions={sessions}
        documents={documents}
        activeSessionId={research.state.sessionId}
        onNew={onNewChat}
        onSelect={onSelectSession}
        onDelete={onDeleteSession}
        onUploaded={onUploaded}
        onDeleteDoc={async (id) => {
          await api.deleteDocument(id)
          refreshMeta()
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          status={status}
          onOpenSettings={() => setShowSettings(true)}
          onNew={onNewChat}
          onOpenPalette={() => setShowPalette(true)}
          onOpenShortcuts={() => setShowShortcuts(true)}
        />

        <main className="min-h-0 flex-1 overflow-y-auto">
          {view === 'dashboard' && (
            <Dashboard
              template={template}
              onTemplateChange={setTemplate}
              onSubmit={onSubmit}
              onOpenSession={onSelectSession}
              featuresRag={status?.features.rag ?? true}
              docCount={status?.documents ?? 0}
              sessions={sessions}
            />
          )}
          {view === 'search' && (
            <SearchPanel
              template={template}
              onTemplateChange={setTemplate}
              onSubmit={onSubmit}
              featuresRag={status?.features.rag ?? true}
              docCount={status?.documents ?? 0}
            />
          )}
          {view === 'stage' && (
            <ResearchStage
              question={question}
              template={template}
              onTemplateChange={setTemplate}
              onSubmit={onSubmit}
              onStop={research.stop}
              onReset={onNewChat}
              onOpenSession={onSelectSession}
              onMetaChange={onMetaChange}
              state={research.state}
            />
          )}
        </main>
      </div>

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        sessions={sessions}
        onNew={() => openSearch()}
        onOpenDashboard={openDashboard}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSession={onSelectSession}
        onNewWithTemplate={(t) => openSearch({ template: t })}
      />

      {showSettings && status && (
        <SettingsModal status={status} onClose={() => setShowSettings(false)} />
      )}

      <ShortcutsModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
    </ToastProvider>
    </ErrorBoundary>
  )
}
