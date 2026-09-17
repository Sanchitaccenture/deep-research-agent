import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MicButton from './MicButton'
import { useToast } from './Toast'
import { useChat } from '../hooks/useChat'
import type { ChatTurn, Source } from '../types'

interface Props {
  sessionId?: string
  initialTurns: ChatTurn[]
  sources: Source[]
}

export default function ChatPanel({ sessionId, initialTurns, sources }: Props) {
  const chat = useChat(initialTurns)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const toast = useToast()

  useEffect(() => {
    chat.reset(initialTurns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.state.turns.length, chat.state.liveText])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const t = input.trim()
    if (!t || !sessionId || chat.state.streaming) return
    setInput('')
    chat.send(sessionId, t)
  }

  if (!sessionId) {
    return (
      <div className="glass rounded-2xl p-10 text-center text-sm text-slate-500">
        Complete a research run to unlock follow-up chat.
      </div>
    )
  }

  return (
    <div className="glass flex h-[calc(100vh-260px)] flex-col rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse-soft" />
          Chat with this research
          <span className="text-slate-600">·</span>
          <span className="text-slate-500">
            {sources.length} sources grounded
          </span>
        </div>
        {chat.state.turns.length > 0 && (
          <button
            onClick={() => {
              chat.clear(sessionId)
              toast.push({ kind: 'info', message: 'Chat thread cleared' })
            }}
            className="text-[11px] text-slate-500 hover:text-rose-400"
          >
            Clear thread
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {chat.state.turns.length === 0 && !chat.state.streaming && (
          <EmptyState
            examples={[
              'Summarize the key findings in three bullets.',
              'Which sources disagree with each other?',
              'What is missing from this report?',
            ]}
            onPick={(q) => {
              setInput(q)
            }}
          />
        )}

        {chat.state.turns.map((t) => (
          <MessageBubble key={t.id} turn={t} sources={sources} />
        ))}

        {chat.state.streaming && (
          <MessageBubble
            turn={{
              id: 'live',
              role: 'assistant',
              content: chat.state.liveText || '…',
              created_at: '',
            }}
            sources={sources}
            live
          />
        )}

        {chat.state.error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {chat.state.error}
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-white/5 p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="Ask a follow-up about this research…"
          disabled={chat.state.streaming}
          className="flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500/40 focus:outline-none disabled:opacity-60"
        />
        <MicButton
          onTranscript={(text, isFinal) => {
            if (isFinal) setInput((prev) => (prev ? prev.trim() + ' ' + text : text))
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || chat.state.streaming}
          className="rounded-lg bg-gradient-to-r from-brand-600 to-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:from-brand-500 hover:to-accent-500 disabled:opacity-40"
        >
          {chat.state.streaming ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

function MessageBubble({
  turn,
  sources,
  live,
}: {
  turn: ChatTurn
  sources: Source[]
  live?: boolean
}) {
  const isUser = turn.role === 'user'
  const enriched = isUser ? turn.content : enrichCitations(turn.content, sources)

  return (
    <div
      className={
        'flex ' + (isUser ? 'justify-end' : 'justify-start') + ' animate-slide-up'
      }
    >
      <div
        className={
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ' +
          (isUser
            ? 'bg-gradient-to-br from-accent-600/30 to-brand-600/20 text-white'
            : 'border border-white/5 bg-surface-900/60 text-slate-200')
        }
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{enriched}</div>
        ) : (
          <div className="report-md text-[13.5px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{enriched}</ReactMarkdown>
            {live && (
              <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse-soft bg-brand-400 align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function enrichCitations(md: string, sources: Source[]): string {
  if (!md) return md
  return md.replace(/\[(\d+)\]/g, (match, n) => {
    const id = parseInt(n, 10)
    const s = sources.find((x) => x.id === id)
    if (!s) return match
    const url = s.url || '#'
    return `[${n}](${url} "${(s.title || '').replace(/"/g, "'")}")`
  })
}

function EmptyState({
  examples,
  onPick,
}: {
  examples: string[]
  onPick: (q: string) => void
}) {
  return (
    <div className="mt-4 text-center">
      <p className="mb-3 text-xs uppercase tracking-wider text-slate-500">
        Ask anything about this research
      </p>
      <div className="mx-auto flex max-w-md flex-col gap-2">
        {examples.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e)}
            className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-left text-xs text-slate-400 transition hover:border-white/10 hover:text-slate-200"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
