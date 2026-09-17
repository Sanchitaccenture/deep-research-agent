import { useEffect, useState } from 'react'
import MicButton from './MicButton'
import QueryAutocomplete from './QueryAutocomplete'
import TemplateSelector from './TemplateSelector'
import { api } from '../lib/api'
import { TEMPLATE_META, type ReportTemplate, type SessionSummary, type SessionsStats } from '../types'

interface Props {
  template: ReportTemplate
  onTemplateChange: (t: ReportTemplate) => void
  onSubmit: (q: string) => void
  onOpenSession: (id: string) => void
  featuresRag: boolean
  docCount: number
  sessions: SessionSummary[]
}

const SAMPLE_QUESTIONS = [
  'What are the biggest risks facing the EV battery industry in 2026?',
  'Compare LangGraph and CrewAI: strengths, weaknesses, and when to use each.',
  'What is retrieval-augmented generation and why does it matter for enterprise AI?',
  'Summarize the state of open-source LLMs in 2026 with market share and licensing.',
]

export default function Dashboard({
  template,
  onTemplateChange,
  onSubmit,
  onOpenSession,
  featuresRag,
  docCount,
  sessions,
}: Props) {
  const [q, setQ] = useState('')
  const [stats, setStats] = useState<SessionsStats | null>(null)

  useEffect(() => {
    api.sessionsStats().then(setStats).catch(() => setStats(null))
  }, [sessions.length])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const t = q.trim()
    if (t) onSubmit(t)
  }

  const recent = sessions.slice(0, 6)
  const bookmarked = sessions.filter((s) => s.bookmarked).slice(0, 4)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-6 py-8">
      {/* Ask row */}
      <section className="animate-fade-in">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
          Ready to research · press <kbd className="rounded bg-white/10 px-1 py-0.5 text-slate-300">⌘K</kbd> for the command palette
        </div>
        <h1 className="mb-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
          Ask <span className="gradient-text">anything</span>.
        </h1>
        <form onSubmit={submit}>
          <div className="glass rounded-2xl p-3 shadow-2xl shadow-black/40">
            <QueryAutocomplete
              value={q}
              sessions={sessions}
              onPick={(t) => setQ(t)}
            >
              {({ onFocus, onBlur, onKeyDown }) => (
                <div className="flex items-start gap-2">
                  <textarea
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                      else onKeyDown(e)
                    }}
                    rows={2}
                    placeholder="What do you want researched?  (Cmd/Ctrl+Enter · Tab to autocomplete · 🎙 to speak)"
                    className="flex-1 resize-none bg-transparent px-3 py-2 text-base text-white placeholder-slate-500 focus:outline-none"
                  />
                  <MicButton
                    size="md"
                    className="mt-1 shrink-0"
                    onTranscript={(text, isFinal) => {
                      if (isFinal)
                        setQ((prev) => (prev ? prev.trim() + ' ' + text : text))
                    }}
                  />
                </div>
              )}
            </QueryAutocomplete>
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
              <TemplateSelector value={template} onChange={onTemplateChange} compact />
              <div className="flex-1" />
              {featuresRag && (
                <div className="rounded-lg border border-white/5 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
                  {docCount > 0
                    ? <>Web + <b className="text-brand-400">{docCount}</b> doc{docCount === 1 ? '' : 's'}</>
                    : 'Web only · upload docs for RAG'}
                </div>
              )}
              <button
                type="submit"
                disabled={!q.trim()}
                className="rounded-lg bg-gradient-to-r from-accent-600 to-brand-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-brand-600/20 transition hover:from-accent-500 hover:to-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Research →
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Stats row */}
      {stats && stats.total_sessions > 0 && (
        <section className="grid animate-slide-up gap-3 md:grid-cols-4">
          <StatTile
            label="Total runs"
            value={String(stats.total_sessions)}
            hint="research sessions"
          />
          <StatTile
            label="Sources gathered"
            value={String(stats.total_sources)}
            hint="across all runs"
          />
          <StatTile
            label="Chat turns"
            value={String(stats.total_chats)}
            hint="follow-up messages"
          />
          <StatTile
            label="Bookmarked"
            value={String(stats.bookmarked)}
            hint="starred runs"
          />
        </section>
      )}

      {/* Two-column: activity + top tags / modes */}
      {stats && stats.activity.length > 0 && (
        <section className="grid animate-slide-up gap-3 lg:grid-cols-3">
          <div className="glass rounded-2xl p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-wider text-slate-500">
                Activity (last {stats.activity.length} days)
              </h3>
              <span className="text-[11px] text-slate-500">
                {stats.activity.reduce((s, a) => s + a.count, 0)} runs
              </span>
            </div>
            <ActivityChart data={stats.activity} />
          </div>

          <div className="glass rounded-2xl p-5">
            <h3 className="mb-3 text-xs uppercase tracking-wider text-slate-500">
              Modes & templates
            </h3>
            <BarSection
              title="By mode"
              data={Object.entries(stats.by_mode).map(([k, v]) => ({ key: k, value: v }))}
              color="accent"
            />
            <div className="mt-3">
              <BarSection
                title="By template"
                data={Object.entries(stats.by_template).map(([k, v]) => ({
                  key: TEMPLATE_META[k as ReportTemplate]?.label || k,
                  value: v,
                }))}
                color="brand"
              />
            </div>
          </div>
        </section>
      )}

      {/* Top tags */}
      {stats && stats.top_tags.length > 0 && (
        <section className="glass animate-slide-up rounded-2xl p-5">
          <h3 className="mb-3 text-xs uppercase tracking-wider text-slate-500">
            Popular tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.top_tags.map((t) => (
              <span
                key={t.tag}
                className="rounded-full border border-white/5 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
              >
                #{t.tag}
                <span className="ml-1.5 text-[10px] text-slate-500">{t.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Bookmarked + Recent */}
      <section className="grid animate-slide-up gap-3 lg:grid-cols-2">
        {bookmarked.length > 0 && (
          <div className="glass rounded-2xl p-5">
            <h3 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <IconStar />
              Bookmarked
            </h3>
            <SessionList sessions={bookmarked} onOpen={onOpenSession} />
          </div>
        )}
        <div
          className={
            'glass rounded-2xl p-5 ' +
            (bookmarked.length === 0 ? 'lg:col-span-2' : '')
          }
        >
          <h3 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
            <IconClock />
            Recent
          </h3>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">
              No sessions yet — ask a question above to get started.
            </p>
          ) : (
            <SessionList sessions={recent} onOpen={onOpenSession} />
          )}
        </div>
      </section>

      {/* Try one */}
      <section className="animate-slide-up">
        <p className="mb-3 text-xs uppercase tracking-wider text-slate-500">Try one</p>
        <div className="grid gap-2 md:grid-cols-2">
          {SAMPLE_QUESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSubmit(s)}
              className="group rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left text-sm text-slate-300 transition hover:border-white/10 hover:bg-white/[0.07]"
            >
              <span className="mr-2 text-accent-400 transition group-hover:text-brand-400">◆</span>
              {s}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

function ActivityChart({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((d) => {
        const h = Math.max(4, Math.round((d.count / max) * 100))
        const dayLabel = d.day.slice(5).replace('-', '/')
        return (
          <div
            key={d.day}
            className="group relative flex flex-1 flex-col items-center justify-end"
            title={`${d.day}: ${d.count} run(s)`}
          >
            <div
              style={{ height: `${h}%` }}
              className="w-full rounded-t bg-gradient-to-t from-accent-600/40 to-brand-500/60 transition-all group-hover:from-accent-500/60 group-hover:to-brand-400/80"
            />
            <div className="mt-1 text-[9px] text-slate-500">{dayLabel}</div>
          </div>
        )
      })}
    </div>
  )
}

function BarSection({
  title,
  data,
  color,
}: {
  title: string
  data: { key: string; value: number }[]
  color: 'accent' | 'brand'
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const fromCls = color === 'accent' ? 'from-accent-600/50' : 'from-brand-600/50'
  const toCls = color === 'accent' ? 'to-accent-400/70' : 'to-brand-400/70'
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate text-slate-400">{d.key}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/5">
              <div
                style={{ width: `${(d.value / max) * 100}%` }}
                className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${fromCls} ${toCls}`}
              />
            </div>
            <span className="w-6 shrink-0 text-right text-slate-500">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionList({
  sessions,
  onOpen,
}: {
  sessions: SessionSummary[]
  onOpen: (id: string) => void
}) {
  return (
    <ul className="space-y-1.5">
      {sessions.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => onOpen(s.id)}
            className="group flex w-full items-start gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-300 transition hover:border-white/5 hover:bg-white/[0.04]"
          >
            <span
              className={
                'mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ' +
                (s.mode === 'crew' ? 'bg-brand-500' : 'bg-accent-500')
              }
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-200 group-hover:text-white">
                {s.question}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                <span>{new Date(s.created_at).toLocaleDateString()}</span>
                <span>·</span>
                <span>{s.source_count} sources</span>
                {s.chat_count ? (
                  <>
                    <span>·</span>
                    <span className="text-brand-400/70">{s.chat_count} chat</span>
                  </>
                ) : null}
                {s.tags && s.tags.length > 0 && (
                  <>
                    <span>·</span>
                    <span className="truncate">#{s.tags[0]}</span>
                  </>
                )}
              </div>
            </div>
            {s.bookmarked && <IconStar className="mt-1 h-3 w-3 text-amber-400" />}
          </button>
        </li>
      ))}
    </ul>
  )
}

function IconStar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className || 'h-3.5 w-3.5 text-amber-400'}
    >
      <path d="M12 3l2.6 5.6L20 9.4l-4 3.9.9 5.7L12 16.9 7.1 19l.9-5.7-4-3.9 5.4-.8L12 3Z" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-slate-400">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
