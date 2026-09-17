import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useToast } from './Toast'

interface Props {
  sessionId: string
  initialNotes: string
  onSaved?: (notes: string) => void
}

export default function NotesPanel({ sessionId, initialNotes, onSaved }: Props) {
  const [notes, setNotes] = useState(initialNotes || '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timerRef = useRef<number | null>(null)
  const lastSaved = useRef<string>(initialNotes || '')
  const toast = useToast()

  useEffect(() => {
    setNotes(initialNotes || '')
    lastSaved.current = initialNotes || ''
    setStatus('idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (notes === lastSaved.current) {
      setStatus('idle')
      return
    }
    setStatus('saving')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(async () => {
      try {
        await api.updateSessionMeta(sessionId, { notes })
        lastSaved.current = notes
        setStatus('saved')
        onSaved?.(notes)
        window.setTimeout(() => setStatus('idle'), 1200)
      } catch (err) {
        console.error(err)
        setStatus('error')
        toast.push({
          kind: 'error',
          message: 'Failed to save notes',
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }, 700)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, sessionId])

  return (
    <div className="glass flex h-[calc(100vh-260px)] flex-col rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <IconPencil />
          Personal notes on this research
        </div>
        <StatusPill status={status} />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add your own commentary, decisions, quotes, or TODOs. Markdown-friendly. Autosaves as you type."
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-200 placeholder-slate-500 focus:outline-none"
      />
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[10px] text-slate-500">
        <span>{notes.length} chars</span>
        <span>Autosaves 700ms after you stop typing</span>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return <span className="text-slate-600">•</span>
  const map = {
    saving: { text: 'saving…', cls: 'text-slate-400' },
    saved: { text: 'saved ✓', cls: 'text-emerald-400' },
    error: { text: 'save failed', cls: 'text-rose-400' },
  } as const
  const { text, cls } = map[status]
  return <span className={'text-[11px] ' + cls}>{text}</span>
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
      <path
        d="M4 20l3.5-1 11-11-2.5-2.5-11 11L4 20Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 6.5l3.5 3.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
