import { useEffect, useMemo, useRef, useState } from 'react'
import { TEMPLATE_META, type ReportTemplate, type SessionSummary } from '../types'

export interface CommandAction {
  id: string
  label: string
  hint?: string
  section: 'Action' | 'Research' | 'Sessions' | 'Templates'
  keywords?: string
  icon?: React.ReactNode
  onRun: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  sessions: SessionSummary[]
  onNew: () => void
  onOpenDashboard: () => void
  onOpenSettings: () => void
  onOpenSession: (id: string) => void
  onNewWithTemplate: (t: ReportTemplate) => void
}

export default function CommandPalette({
  open,
  onClose,
  sessions,
  onNew,
  onOpenDashboard,
  onOpenSettings,
  onOpenSession,
  onNewWithTemplate,
}: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const actions: CommandAction[] = useMemo(() => {
    const templateActions: CommandAction[] = (Object.keys(TEMPLATE_META) as ReportTemplate[])
      .map((k) => ({
        id: `tpl-${k}`,
        label: `New research · ${TEMPLATE_META[k].label}`,
        hint: TEMPLATE_META[k].description,
        section: 'Templates',
        keywords: k + ' template ' + TEMPLATE_META[k].label,
        icon: <span className="text-brand-400">{TEMPLATE_META[k].icon}</span>,
        onRun: () => {
          onClose()
          onNewWithTemplate(k)
        },
      }))

    const core: CommandAction[] = [
      {
        id: 'new',
        label: 'New research',
        hint: 'Start a fresh question',
        section: 'Action',
        keywords: 'new research start question fresh',
        icon: <IconPlus />,
        onRun: () => {
          onClose()
          onNew()
        },
      },
      {
        id: 'dashboard',
        label: 'Open dashboard',
        hint: 'Stats, activity, recent runs',
        section: 'Action',
        keywords: 'dashboard home stats activity',
        icon: <IconGrid />,
        onRun: () => {
          onClose()
          onOpenDashboard()
        },
      },
      {
        id: 'settings',
        label: 'Open settings',
        hint: 'Runtime config, feature flags',
        section: 'Action',
        keywords: 'settings config runtime env preferences',
        icon: <IconGear />,
        onRun: () => {
          onClose()
          onOpenSettings()
        },
      },
    ]

    const sessionActions: CommandAction[] = sessions.slice(0, 30).map((s) => ({
      id: `sess-${s.id}`,
      label: s.question,
      hint: `${s.mode} · ${s.source_count} sources · ${timeAgo(s.created_at)}`,
      section: 'Sessions',
      keywords: (s.question + ' ' + (s.tags || []).join(' ')).toLowerCase(),
      icon: s.bookmarked ? <IconStarFilled /> : <IconDoc />,
      onRun: () => {
        onClose()
        onOpenSession(s.id)
      },
    }))

    return [...core, ...templateActions, ...sessionActions]
  }, [sessions, onClose, onNew, onOpenDashboard, onOpenSettings, onOpenSession, onNewWithTemplate])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    const tokens = q.split(/\s+/)
    return actions
      .map((a) => {
        const hay = (a.label + ' ' + (a.keywords || '') + ' ' + (a.hint || '')).toLowerCase()
        let score = 0
        for (const t of tokens) {
          if (!hay.includes(t)) return { a, score: -1 }
          if (a.label.toLowerCase().startsWith(t)) score += 5
          if (a.label.toLowerCase().includes(t)) score += 2
          score += 1
        }
        return { a, score }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.a)
  }, [actions, query])

  useEffect(() => {
    setCursor(0)
  }, [query])

  const grouped = useMemo(() => {
    const groups: Record<string, CommandAction[]> = {}
    filtered.forEach((a) => {
      groups[a.section] = groups[a.section] || []
      groups[a.section].push(a)
    })
    return groups
  }, [filtered])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const move = (delta: number) => {
    setCursor((c) => {
      const next = c + delta
      if (next < 0) return filtered.length - 1
      if (next >= filtered.length) return 0
      return next
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[cursor]?.onRun()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let flatIdx = -1

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start bg-black/60 px-4 pt-[10vh] backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass mx-auto w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <IconSearch />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search sessions…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <kbd className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">No matches.</div>
          )}
          {Object.entries(grouped).map(([section, items]) => (
            <div key={section} className="mb-2">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                {section}
              </div>
              {items.map((a) => {
                flatIdx += 1
                const idx = flatIdx
                const active = idx === cursor
                return (
                  <button
                    key={a.id}
                    data-idx={idx}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => a.onRun()}
                    className={
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ' +
                      (active
                        ? 'bg-white/10 text-white'
                        : 'text-slate-300 hover:bg-white/5')
                    }
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 text-[13px]">
                      {a.icon || '•'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.hint && (
                      <span className="ml-2 shrink-0 truncate text-[11px] text-slate-500">
                        {a.hint}
                      </span>
                    )}
                    {active && <IconEnter />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[10px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded bg-white/5 px-1">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded bg-white/5 px-1">⏎</kbd> select
            </span>
            <span>
              <kbd className="rounded bg-white/5 px-1">esc</kbd> close
            </span>
          </div>
          <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

// ------- Icons -------
const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  className: 'h-3.5 w-3.5',
}
function IconSearch() {
  return (
    <svg {...svgProps} className="h-4 w-4 text-slate-500">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
function IconPlus() {
  return (
    <svg {...svgProps}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
function IconGrid() {
  return (
    <svg {...svgProps}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
function IconGear() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M3 12h2M19 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconDoc() {
  return (
    <svg {...svgProps}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
function IconStarFilled() {
  return (
    <svg {...svgProps} className="h-3.5 w-3.5 text-amber-400">
      <path d="M12 3l2.6 5.6L20 9.4l-4 3.9.9 5.7L12 16.9 7.1 19l.9-5.7-4-3.9 5.4-.8L12 3Z" fill="currentColor" />
    </svg>
  )
}
function IconEnter() {
  return (
    <svg {...svgProps} className="h-3 w-3 text-slate-500">
      <path d="M4 10h10a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-4M7 7l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
