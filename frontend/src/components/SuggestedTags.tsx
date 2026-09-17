import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Props {
  sessionId?: string
  suggested: string[]
  applied: string[]
  onApplied?: () => void
}

/**
 * Shows tag suggestions produced by the LLM after synthesis. If the user has
 * no tags yet, the suggestions are already applied server-side; this component
 * lets them dismiss individual ones or all of them.
 */
export default function SuggestedTags({ sessionId, suggested, applied, onApplied }: Props) {
  const [visible, setVisible] = useState<string[]>([])

  useEffect(() => {
    // Only surface suggestions the user hasn't manually removed already.
    const appliedSet = new Set(applied.map((t) => t.toLowerCase()))
    setVisible(suggested.filter((t) => appliedSet.has(t.toLowerCase())))
  }, [suggested.join(','), applied.join(',')])

  if (!sessionId || visible.length === 0) return null

  const dismissOne = async (tag: string) => {
    const nextApplied = applied.filter((t) => t.toLowerCase() !== tag.toLowerCase())
    setVisible((v) => v.filter((t) => t.toLowerCase() !== tag.toLowerCase()))
    try {
      await api.updateSessionMeta(sessionId, { tags: nextApplied })
      onApplied?.()
    } catch (err) {
      console.error(err)
    }
  }

  const dismissAll = async () => {
    const suggestedSet = new Set(suggested.map((t) => t.toLowerCase()))
    const nextApplied = applied.filter((t) => !suggestedSet.has(t.toLowerCase()))
    setVisible([])
    try {
      await api.updateSessionMeta(sessionId, { tags: nextApplied })
      onApplied?.()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-3 py-2 text-[11px]">
      <span className="flex items-center gap-1.5 text-brand-300">
        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
          <path
            d="M12 3l2.6 5.6L20 9.4l-4 3.9.9 5.7L12 16.9 7.1 19l.9-5.7-4-3.9 5.4-.8L12 3Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        Auto-tagged
      </span>
      {visible.map((t) => (
        <span
          key={t}
          className="group flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-slate-200"
        >
          #{t}
          <button
            onClick={() => dismissOne(t)}
            className="ml-1 text-slate-500 opacity-60 transition hover:text-rose-400 hover:opacity-100"
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <button
        onClick={dismissAll}
        className="ml-auto text-[10px] text-slate-500 hover:text-rose-400"
      >
        Dismiss all
      </button>
    </div>
  )
}
