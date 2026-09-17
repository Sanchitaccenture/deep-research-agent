import { useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { DocumentInfo, SessionSummary } from '../types'

interface Props {
  sessions: SessionSummary[]
  documents: DocumentInfo[]
  activeSessionId?: string
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onUploaded: () => void
  onDeleteDoc: (id: string) => void
}

type SessionFilter = 'all' | 'bookmarked' | 'notes'

export default function Sidebar({
  sessions,
  documents,
  activeSessionId,
  onNew,
  onSelect,
  onDelete,
  onUploaded,
  onDeleteDoc,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [tab, setTab] = useState<'sessions' | 'docs'>('sessions')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SessionFilter>('all')

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      for (const f of Array.from(files)) {
        await api.uploadDocument(f)
      }
      onUploaded()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions.filter((s) => {
      if (filter === 'bookmarked' && !s.bookmarked) return false
      if (filter === 'notes' && !s.has_notes) return false
      if (!q) return true
      const hay = (s.question + ' ' + (s.tags || []).join(' ')).toLowerCase()
      return hay.includes(q)
    })
  }, [sessions, query, filter])

  return (
    <aside className="flex w-72 flex-col border-r border-white/5 bg-surface-950/60 backdrop-blur">
      <div className="border-b border-white/5 p-4">
        <button
          onClick={onNew}
          className="w-full rounded-xl bg-gradient-to-r from-accent-600 to-brand-600 px-3 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-600/20 transition hover:from-accent-500 hover:to-brand-500"
        >
          + New Research
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 border-b border-white/5 p-2">
        <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
          History
          <span className="ml-1 text-[10px] text-slate-500">({sessions.length})</span>
        </TabButton>
        <TabButton active={tab === 'docs'} onClick={() => setTab('docs')}>
          Documents
          <span className="ml-1 text-[10px] text-slate-500">({documents.length})</span>
        </TabButton>
      </div>

      {tab === 'sessions' && (
        <div className="space-y-2 border-b border-white/5 p-2">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M20 20l-3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history…"
              className="w-full rounded-lg border border-white/5 bg-white/[0.03] py-1.5 pl-7 pr-2 text-xs text-white placeholder-slate-500 focus:border-accent-500/30 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterChip>
            <FilterChip
              active={filter === 'bookmarked'}
              onClick={() => setFilter('bookmarked')}
            >
              ★ Bookmarks
            </FilterChip>
            <FilterChip
              active={filter === 'notes'}
              onClick={() => setFilter('notes')}
            >
              Notes
            </FilterChip>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'sessions' ? (
          <SessionsList
            sessions={filtered}
            activeId={activeSessionId}
            onSelect={onSelect}
            onDelete={onDelete}
            emptyMessage={
              sessions.length === 0
                ? 'No research yet. Ask a question to get started.'
                : 'No sessions match your search / filter.'
            }
          />
        ) : (
          <DocumentsList documents={documents} onDelete={onDeleteDoc} />
        )}
      </div>

      {tab === 'docs' && (
        <div className="border-t border-white/5 p-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,.csv,.json"
            multiple
            hidden
            onChange={(e) => handleUpload(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-2.5 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : 'Upload PDF / TXT / MD'}
          </button>
          {uploadError && (
            <p className="mt-2 text-[11px] text-rose-400">{uploadError}</p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Documents are chunked, embedded locally, and searched alongside
            the web during research.
          </p>
        </div>
      )}
    </aside>
  )
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-lg px-3 py-1.5 text-xs font-medium transition ' +
        (active
          ? 'bg-white/10 text-white'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
      }
    >
      {children}
    </button>
  )
}

function FilterChip({
  children,
  active,
  onClick,
  color,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  color?: 'accent' | 'brand'
}) {
  const activeCls =
    color === 'brand'
      ? 'bg-brand-500/20 text-brand-300'
      : color === 'accent'
        ? 'bg-accent-500/20 text-accent-300'
        : 'bg-white/10 text-white'
  return (
    <button
      onClick={onClick}
      className={
        'rounded-full px-2 py-0.5 text-[10px] transition ' +
        (active ? activeCls : 'bg-white/[0.04] text-slate-400 hover:bg-white/10')
      }
    >
      {children}
    </button>
  )
}

function SessionsList({
  sessions,
  activeId,
  onSelect,
  onDelete,
  emptyMessage,
}: {
  sessions: SessionSummary[]
  activeId?: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  emptyMessage: string
}) {
  if (sessions.length === 0) {
    return <div className="p-4 text-center text-xs text-slate-500">{emptyMessage}</div>
  }

  return (
    <ul className="space-y-1">
      {sessions.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => onSelect(s.id)}
            className={
              'group flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ' +
              (activeId === s.id
                ? 'bg-white/10 text-white'
                : 'text-slate-300 hover:bg-white/5')
            }
          >
            <ModeBadge mode={s.mode} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {s.bookmarked && (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 shrink-0 text-amber-400">
                    <path d="M12 3l2.6 5.6L20 9.4l-4 3.9.9 5.7L12 16.9 7.1 19l.9-5.7-4-3.9 5.4-.8L12 3Z" />
                  </svg>
                )}
                <span className="truncate font-medium">{s.question}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                <span>{new Date(s.created_at).toLocaleString()}</span>
                <span>·</span>
                <span>{s.source_count} sources</span>
                {s.chat_count ? (
                  <span className="text-brand-400/70">· {s.chat_count} chat</span>
                ) : null}
              </div>
              {s.tags && s.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-white/[0.05] px-1.5 text-[9px] text-slate-400"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.id)
              }}
              className="mt-0.5 rounded p-1 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-rose-400 group-hover:opacity-100"
              aria-label="Delete session"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path
                  d="M6 7h12M9 7V4h6v3M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function DocumentsList({
  documents,
  onDelete,
}: {
  documents: DocumentInfo[]
  onDelete: (id: string) => void
}) {
  if (documents.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-slate-500">
        No documents uploaded yet.
      </div>
    )
  }

  return (
    <ul className="space-y-1">
      {documents.map((d) => (
        <li
          key={d.doc_id}
          className="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-300 hover:bg-white/5"
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-600/20 text-brand-400">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
              <path
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{d.filename}</div>
            <div className="text-[10px] text-slate-500">{d.chunks} chunks</div>
          </div>
          <button
            onClick={() => onDelete(d.doc_id)}
            className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-rose-400 group-hover:opacity-100"
            aria-label="Delete document"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
              <path
                d="M6 7h12M9 7V4h6v3M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  const isCrew = mode === 'crew'
  return (
    <span
      className={
        'mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ' +
        (isCrew ? 'bg-brand-500' : 'bg-accent-500')
      }
      title={isCrew ? 'CrewAI mode' : 'LangGraph mode'}
    />
  )
}
