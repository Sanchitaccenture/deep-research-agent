import { useEffect, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import MicButton from './MicButton'
import NotesPanel from './NotesPanel'
import RelatedSessions from './RelatedSessions'
import ReportView from './ReportView'
import SessionMetaBar from './SessionMetaBar'
import SourcesPanel from './SourcesPanel'
import StepsPanel from './StepsPanel'
import SuggestedTags from './SuggestedTags'
import TemplateSelector from './TemplateSelector'
import { useToast } from './Toast'
import type { ReportTemplate, StreamState } from '../types'

interface Props {
  question: string
  template: ReportTemplate
  onTemplateChange: (t: ReportTemplate) => void
  onSubmit: (q: string) => void
  onStop: () => void
  onReset: () => void
  onOpenSession: (id: string) => void
  onMetaChange?: () => void
  state: StreamState
}

type TabKey = 'report' | 'sources' | 'chat' | 'notes' | 'steps'

export default function ResearchStage({
  question,
  template,
  onTemplateChange,
  onSubmit,
  onStop,
  onReset,
  onOpenSession,
  onMetaChange,
  state,
}: Props) {
  const [q, setQ] = useState(question)
  const [tab, setTab] = useState<TabKey>('report')
  const toast = useToast()

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const t = q.trim()
    if (t) onSubmit(t)
  }

  const exportReport = () => {
    if (!state.report) return
    const parts = [state.report]
    if (state.diagram) {
      parts.push('\n\n## Mind map\n\n```mermaid\n' + state.diagram + '\n```')
    }
    if (state.metrics && Object.keys(state.metrics).length > 0) {
      parts.push(
        '\n\n---\n_Generated in ' +
          (state.metrics.duration_seconds ?? '?') +
          's · ' +
          (state.metrics.source_count ?? 0) +
          ' sources · template: ' +
          state.template +
          '_',
      )
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `research-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.push({ kind: 'success', message: 'Report downloaded' })
  }

  const copyReport = async () => {
    if (!state.report) return
    await navigator.clipboard.writeText(state.report)
    toast.push({ kind: 'success', message: 'Report copied to clipboard' })
  }

  const copyLink = async () => {
    if (!state.sessionId) return
    const url =
      window.location.origin + window.location.pathname + `#/session/${state.sessionId}`
    await navigator.clipboard.writeText(url)
    toast.push({
      kind: 'success',
      message: 'Shareable link copied',
      detail: url,
    })
  }

  const bookmarked = state.bookmarked
  const tags: string[] = state.tags
  const notes: string = state.notes

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-3 py-4 sm:px-6 sm:py-6">
      {/* Query bar */}
      <form onSubmit={submit} className="glass mb-3 rounded-2xl p-3">
        <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            rows={2}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-base text-white placeholder-slate-500 focus:outline-none max-sm:basis-full lg:text-sm"
            placeholder="Refine or ask a new question…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }}
          />
          <MicButton
            onTranscript={(text, isFinal) => {
              if (isFinal) setQ((prev) => (prev ? prev.trim() + ' ' + text : text))
            }}
          />
          <div className="flex flex-col items-end gap-2 max-sm:ml-auto max-sm:flex-row max-sm:items-center">
            <div className="flex items-center gap-1.5">
              <TemplateSelector value={template} onChange={onTemplateChange} compact />
            </div>
            {state.running ? (
              <button
                type="button"
                onClick={onStop}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/20 max-lg:min-h-10"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!q.trim()}
                className="rounded-lg bg-gradient-to-r from-accent-600 to-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:from-accent-500 hover:to-brand-500 disabled:opacity-40 max-lg:min-h-10"
              >
                Run again →
              </button>
            )}
          </div>
        </div>
      </form>

      {state.sessionId && (
        <div className="mb-3">
          <SessionMetaBar
            sessionId={state.sessionId}
            bookmarked={bookmarked}
            tags={tags}
            onChange={() => onMetaChange?.()}
          />
        </div>
      )}

      {state.sessionId && state.suggestedTags.length > 0 && (
        <SuggestedTags
          sessionId={state.sessionId}
          suggested={state.suggestedTags}
          applied={tags}
          onApplied={() => onMetaChange?.()}
        />
      )}

      {state.error && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-5 w-5 shrink-0 text-rose-400">
            <path d="M12 3L2 20h20L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M12 10v5M12 18v.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-rose-100">Research paused</div>
            <div className="mt-0.5 text-[13px]">{state.error}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <button
                onClick={() => onSubmit(q || question)}
                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-rose-200 hover:bg-rose-500/20 max-lg:min-h-10 max-lg:px-3"
              >
                Retry
              </button>
              <a
                href="https://console.groq.com/settings/billing"
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10 max-lg:inline-flex max-lg:min-h-10 max-lg:items-center max-lg:px-3"
              >
                Groq usage & billing →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-3 flex flex-col gap-2 border-b border-white/5 pb-2 lg:flex-row lg:items-center lg:gap-1">
        <div className="flex min-w-0 items-center gap-1 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden">
        <Tab active={tab === 'report'} onClick={() => setTab('report')}>
          Report
          {state.running && !state.report && <Spinner />}
        </Tab>
        <Tab active={tab === 'sources'} onClick={() => setTab('sources')}>
          Sources
          <span className="ml-1.5 rounded-full bg-white/10 px-1.5 text-[10px] text-slate-400">
            {state.sources.length}
          </span>
        </Tab>
        <Tab
          active={tab === 'chat'}
          onClick={() => setTab('chat')}
          disabled={!state.sessionId}
        >
          Chat
          {state.chat.length > 0 && (
            <span className="ml-1.5 rounded-full bg-brand-500/20 px-1.5 text-[10px] text-brand-300">
              {state.chat.length}
            </span>
          )}
        </Tab>
        <Tab
          active={tab === 'notes'}
          onClick={() => setTab('notes')}
          disabled={!state.sessionId}
        >
          Notes
          {notes.trim() && (
            <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
              ●
            </span>
          )}
        </Tab>
        <Tab active={tab === 'steps'} onClick={() => setTab('steps')}>
          Progress
          <span className="ml-1.5 rounded-full bg-white/10 px-1.5 text-[10px] text-slate-400">
            {state.steps.length}
          </span>
        </Tab>
        </div>
        <div className="flex gap-2 max-lg:overflow-x-auto lg:ml-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden">
          {state.sessionId && (
            <button
              onClick={copyLink}
              className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 max-lg:min-h-10 max-lg:px-3"
              title="Copy shareable link"
            >
              Share
            </button>
          )}
          {state.report && (
            <>
              <button
                onClick={copyReport}
                className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 max-lg:min-h-10 max-lg:px-3"
              >
                Copy
              </button>
              <button
                onClick={exportReport}
                className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 max-lg:min-h-10 max-lg:px-3"
              >
                Download .md
              </button>
            </>
          )}
          <button
            onClick={onReset}
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 max-lg:min-h-10 max-lg:px-3"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'report' && (
          <>
            <ReportView
              question={question}
              report={state.report}
              reportStreaming={state.reportStreaming}
              diagram={state.diagram}
              followups={state.followups}
              metrics={state.metrics}
              running={state.running}
              sources={state.sources}
              steps={state.steps}
              onPickFollowup={(q) => {
                setQ(q)
                onSubmit(q)
              }}
            />
            {!state.running && state.report && (
              <RelatedSessions
                sessionId={state.sessionId}
                onOpen={onOpenSession}
              />
            )}
          </>
        )}
        {tab === 'sources' && <SourcesPanel sources={state.sources} />}
        {tab === 'chat' && (
          <ChatPanel
            sessionId={state.sessionId}
            question={question}
            report={state.report}
            initialTurns={state.chat}
            sources={state.sources}
          />
        )}
        {tab === 'notes' && state.sessionId && (
          <NotesPanel
            sessionId={state.sessionId}
            initialNotes={notes}
            onSaved={() => onMetaChange?.()}
          />
        )}
        {tab === 'steps' && <StepsPanel steps={state.steps} running={state.running} />}
      </div>
    </div>
  )
}

function Tab({
  children,
  active,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [active])
  return (
    <button
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      className={
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition max-lg:min-h-10 ' +
        (active
          ? 'bg-white/10 text-white'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200') +
        (disabled ? ' cursor-not-allowed opacity-40' : '')
      }
    >
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
  )
}
