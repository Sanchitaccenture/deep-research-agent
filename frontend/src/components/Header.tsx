import type { StatusResponse } from '../types'

interface Props {
  status: StatusResponse | null
  onOpenSettings: () => void
  onNew: () => void
  onOpenPalette: () => void
  onOpenShortcuts: () => void
}

export default function Header({
  status,
  onOpenSettings,
  onNew,
  onOpenPalette,
  onOpenShortcuts,
}: Props) {
  return (
    <header className="flex items-center justify-between border-b border-white/5 bg-surface-900/60 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-brand-500 shadow-lg shadow-brand-600/20">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white">
            <path
              d="M4 18 L10 8 L14 14 L20 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="20" cy="6" r="1.8" fill="currentColor" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-white">
            Deep <span className="gradient-text">Research</span> Agent
          </h1>
          <p className="text-[11px] text-slate-400">
            LangGraph · CrewAI · RAG · Groq · Tavily
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenPalette}
          className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/10 md:flex"
          title="Command palette (⌘K)"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          Search everything
          <kbd className="ml-2 rounded-md border border-white/10 bg-white/5 px-1 text-[10px]">
            ⌘K
          </kbd>
        </button>

        {status && (
          <div className="hidden items-center gap-3 rounded-lg border border-white/5 bg-surface-800/60 px-3 py-1.5 text-[11px] text-slate-400 lg:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
              API live
            </span>
            <span>·</span>
            <span>{status.documents} docs</span>
            <span>·</span>
            <span>{status.sessions} sessions</span>
          </div>
        )}
        <button
          onClick={onNew}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/10"
          title="New research (⌘N)"
        >
          + New
        </button>
        <button
          onClick={onOpenShortcuts}
          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (⌘/)"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M7 11h0M11 11h0M15 11h0M19 11h0M7 14h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          onClick={onOpenSettings}
          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10"
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
