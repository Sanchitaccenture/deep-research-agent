import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { SessionSummary } from '../types'

interface Props {
  sessionId?: string
  onOpen: (id: string) => void
}

export default function RelatedSessions({ sessionId, onOpen }: Props) {
  const [items, setItems] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sessionId) {
      setItems([])
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .relatedSessions(sessionId)
      .then((res) => {
        if (!cancelled) setItems(res)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (!sessionId) return null
  if (!loading && items.length === 0) return null

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <path
            d="M4 12h4l2-4 4 8 2-4h4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Related past research
      </div>
      {loading ? (
        <div className="text-xs text-slate-500">Looking for related sessions…</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpen(s.id)}
              className="group rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left text-xs transition hover:border-accent-500/30 hover:bg-accent-500/5"
            >
              <div className="flex items-start gap-2">
                <span
                  className={
                    'mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ' +
                    (s.mode === 'crew' ? 'bg-brand-500' : 'bg-accent-500')
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-slate-200 group-hover:text-white">
                    {s.question}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{new Date(s.created_at).toLocaleDateString()}</span>
                    <span>·</span>
                    <span>{s.source_count} sources</span>
                    {s.tags && s.tags.length > 0 && (
                      <>
                        <span>·</span>
                        <span>#{s.tags[0]}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
