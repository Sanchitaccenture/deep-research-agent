import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useToast } from './Toast'

interface Props {
  sessionId: string
  bookmarked: boolean
  tags: string[]
  onChange?: (patch: { bookmarked?: boolean; tags?: string[] }) => void
}

export default function SessionMetaBar({
  sessionId,
  bookmarked,
  tags,
  onChange,
}: Props) {
  const [local, setLocal] = useState({ bookmarked, tags })
  const [input, setInput] = useState('')
  const [editing, setEditing] = useState(false)
  const toast = useToast()

  useEffect(() => {
    setLocal({ bookmarked, tags })
  }, [sessionId, bookmarked, tags.join(',')])

  const patch = async (p: { bookmarked?: boolean; tags?: string[] }) => {
    const next = { ...local, ...p }
    setLocal(next)
    try {
      await api.updateSessionMeta(sessionId, p)
      onChange?.(p)
      if (p.bookmarked === true) {
        toast.push({ kind: 'success', message: 'Bookmarked' })
      } else if (p.bookmarked === false) {
        toast.push({ kind: 'info', message: 'Bookmark removed' })
      }
    } catch (err) {
      console.error(err)
      toast.push({
        kind: 'error',
        message: 'Failed to update session',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase()
    if (!t) return
    if (local.tags.includes(t)) return
    const next = [...local.tags, t]
    patch({ tags: next })
    setInput('')
  }

  const removeTag = (t: string) => {
    patch({ tags: local.tags.filter((x) => x !== t) })
  }

  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
      <button
        onClick={() => patch({ bookmarked: !local.bookmarked })}
        title={local.bookmarked ? 'Remove bookmark' : 'Bookmark this run'}
        className={
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition ' +
          (local.bookmarked
            ? 'bg-amber-500/15 text-amber-300'
            : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200')
        }
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M12 3l2.6 5.6L20 9.4l-4 3.9.9 5.7L12 16.9 7.1 19l.9-5.7-4-3.9 5.4-.8L12 3Z" />
        </svg>
        {local.bookmarked ? 'Bookmarked' : 'Bookmark'}
      </button>

      <div className="mx-1 h-4 w-px bg-white/10" />

      {local.tags.length === 0 && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="rounded-md bg-white/5 px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200"
        >
          + Add tag
        </button>
      )}

      {local.tags.map((t) => (
        <span
          key={t}
          className="group flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-300"
        >
          <span className="text-slate-500">#</span>
          {t}
          <button
            onClick={() => removeTag(t)}
            className="ml-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}

      {(editing || local.tags.length > 0) && (
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
              e.preventDefault()
              addTag(input)
            } else if (e.key === 'Backspace' && input === '' && local.tags.length > 0) {
              removeTag(local.tags[local.tags.length - 1])
            } else if (e.key === 'Escape') {
              setEditing(false)
              setInput('')
            }
          }}
          onBlur={() => {
            if (input) addTag(input)
            setEditing(false)
          }}
          autoFocus={editing}
          placeholder={local.tags.length === 0 ? 'type & enter' : '+ tag'}
          className="w-24 rounded-md bg-transparent px-1 py-0.5 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none"
        />
      )}
    </div>
  )
}
