import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SessionSummary } from '../types'

interface Props {
  value: string
  sessions: SessionSummary[]
  onPick: (q: string) => void
  children: (props: {
    onFocus: () => void
    onBlur: () => void
    onKeyDown: (e: React.KeyboardEvent) => void
  }) => ReactNode
}

const SUGGESTIONS = [
  'Latest advances in retrieval-augmented generation for enterprise search',
  'How do sovereign AI compute clouds compare in 2026?',
  'What are the top security risks of MCP servers in production?',
  'Which open-source LLMs are winning enterprise adoption right now?',
  'Compare LangGraph vs CrewAI vs AutoGen for multi-agent workflows',
  'What regulations govern AI agents making financial decisions?',
]

export default function QueryAutocomplete({ value, sessions, onPick, children }: Props) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const q = value.trim().toLowerCase()
    const recent = sessions.slice(0, 20).map((s) => ({
      kind: 'recent' as const,
      text: s.question,
      hint: `${s.mode} · ${s.source_count} sources`,
      id: s.id,
    }))
    const suggestionItems = SUGGESTIONS.map((text) => ({
      kind: 'suggestion' as const,
      text,
      hint: 'try this',
      id: 'sug-' + text,
    }))

    const all = [...recent, ...suggestionItems]
    if (!q) return all.slice(0, 8)

    return all
      .map((it) => {
        const hay = it.text.toLowerCase()
        if (hay === q) return { it, score: 100 }
        if (hay.startsWith(q)) return { it, score: 50 }
        if (hay.includes(q)) return { it, score: 20 }
        const tokens = q.split(/\s+/).filter((t) => t.length >= 2)
        if (tokens.length > 0 && tokens.every((t) => hay.includes(t))) {
          return { it, score: 10 }
        }
        return null
      })
      .filter((x): x is { it: (typeof all)[number]; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.it)
  }, [value, sessions])

  useEffect(() => {
    setCursor(0)
  }, [value, items.length])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const move = (delta: number) => {
    setCursor((c) => {
      const next = c + delta
      if (next < 0) return items.length - 1
      if (next >= items.length) return 0
      return next
    })
  }

  const handlers = {
    onFocus: () => setOpen(true),
    onBlur: () => {},
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
      } else if (e.key === 'Tab' && items[cursor]) {
        e.preventDefault()
        onPick(items[cursor].text)
        setOpen(false)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    },
  }

  return (
    <div ref={wrapRef} className="relative">
      {children(handlers)}

      {open && items.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-surface-900/95 shadow-2xl shadow-black/50 backdrop-blur animate-slide-up">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(it.text)
                setOpen(false)
              }}
              onMouseEnter={() => setCursor(i)}
              className={
                'flex w-full items-center gap-2 border-b border-white/[0.03] px-3 py-2 text-left text-xs transition last:border-b-0 ' +
                (i === cursor ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5')
              }
            >
              <span
                className={
                  'grid h-5 w-5 shrink-0 place-items-center rounded ' +
                  (it.kind === 'recent'
                    ? 'bg-accent-500/15 text-accent-400'
                    : 'bg-brand-500/15 text-brand-400')
                }
              >
                {it.kind === 'recent' ? <IconClock /> : <IconSpark />}
              </span>
              <span className="min-w-0 flex-1 truncate">{it.text}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{it.hint}</span>
              {i === cursor && (
                <kbd className="ml-1 rounded bg-white/10 px-1 text-[9px] text-slate-400">
                  Tab
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.5V12l3 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
function IconSpark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
      <path
        d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M6 18l3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
