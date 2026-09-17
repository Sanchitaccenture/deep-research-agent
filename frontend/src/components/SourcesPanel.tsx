import { useMemo, useState } from 'react'
import type { Source } from '../types'

interface Props {
  sources: Source[]
}

type FilterKey = 'all' | 'web' | 'document'

export default function SourcesPanel({ sources }: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return sources.filter((s) => {
      if (filter === 'web' && s.source_type === 'document') return false
      if (filter === 'document' && s.source_type !== 'document') return false
      if (!query) return true
      const hay = (
        (s.title || '') +
        ' ' +
        (s.url || '') +
        ' ' +
        (s.content || '') +
        ' ' +
        (s.query || '')
      ).toLowerCase()
      return hay.includes(query)
    })
  }, [sources, q, filter])

  const domains = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of sources) {
      const d = safeHost(s.url)
      if (!d) continue
      counts[d] = (counts[d] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [sources])

  const webCount = sources.filter((s) => s.source_type !== 'document').length
  const docCount = sources.filter((s) => s.source_type === 'document').length

  if (sources.length === 0) {
    return (
      <div className="glass rounded-2xl p-10 text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-slate-500">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path
              d="M4 6h16M4 12h16M4 18h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="text-sm text-slate-400">No sources collected yet.</div>
        <div className="mt-1 text-xs text-slate-500">
          Sources will appear here as the agent searches the web and your documents.
        </div>
      </div>
    )
  }

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
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
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles, content, URLs, queries…"
              className="w-full rounded-lg border border-white/5 bg-white/[0.03] py-1.5 pl-8 pr-2 text-xs text-white placeholder-slate-500 focus:border-accent-500/30 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-white/[0.03] p-0.5">
            <FilterBtn
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              count={sources.length}
            >
              All
            </FilterBtn>
            <FilterBtn
              active={filter === 'web'}
              onClick={() => setFilter('web')}
              count={webCount}
              color="accent"
            >
              Web
            </FilterBtn>
            <FilterBtn
              active={filter === 'document'}
              onClick={() => setFilter('document')}
              count={docCount}
              color="brand"
            >
              Docs
            </FilterBtn>
          </div>

          {expanded.size > 0 && (
            <button
              onClick={() => setExpanded(new Set())}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              Collapse all
            </button>
          )}
          {expanded.size === 0 && filtered.length > 0 && (
            <button
              onClick={() => setExpanded(new Set(filtered.map((s) => s.id)))}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              Expand all
            </button>
          )}
        </div>

        {domains.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              Domains
            </span>
            {domains.map(([d, c]) => (
              <button
                key={d}
                onClick={() => setQ(d)}
                className={
                  'flex items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-400 transition hover:border-white/10 hover:text-slate-200 ' +
                  (q === d ? '!border-accent-500/30 !text-accent-300' : '')
                }
              >
                <FaviconImg host={d} />
                {d}
                <span className="text-slate-600">·</span>
                <span className="text-slate-500">{c}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-sm text-slate-500">
          No sources match your filter.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((s) => (
            <SourceCard
              key={`${s.id}-${s.url}`}
              source={s}
              expanded={expanded.has(s.id)}
              onToggle={() => toggle(s.id)}
              query={q}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterBtn({
  children,
  active,
  onClick,
  count,
  color,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  count: number
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
        'rounded-md px-2 py-1 text-[11px] font-medium transition ' +
        (active ? activeCls : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
      }
    >
      {children}
      <span className="ml-1 text-[9px] opacity-60">{count}</span>
    </button>
  )
}

function SourceCard({
  source,
  expanded,
  onToggle,
  query,
}: {
  source: Source
  expanded: boolean
  onToggle: () => void
  query: string
}) {
  const isDoc = source.source_type === 'document'
  const host = safeHost(source.url)

  const highlighted = useMemo(
    () => highlight(source.content || '', query),
    [source.content, query],
  )

  const openExternal = (e: React.MouseEvent) => {
    if (!isDoc && source.url) {
      e.stopPropagation()
      window.open(source.url, '_blank', 'noreferrer')
    }
  }

  const copyCite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(`[${source.id}] ${source.title} — ${source.url}`)
  }

  return (
    <div
      onClick={onToggle}
      className="group glass cursor-pointer rounded-xl p-4 transition hover:border-white/20 hover:bg-white/[0.06]"
    >
      <div className="mb-2 flex items-start gap-2.5">
        <span
          className={
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[12px] font-bold shadow-inner ' +
            (isDoc
              ? 'bg-brand-600/25 text-brand-300 ring-1 ring-brand-500/30'
              : 'bg-accent-600/25 text-accent-300 ring-1 ring-accent-500/30')
          }
        >
          {source.id}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold text-white transition group-hover:text-accent-300">
            {source.title || 'Untitled'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {isDoc ? (
              <span className="inline-flex items-center gap-1 rounded bg-brand-500/10 px-1.5 py-0.5 text-brand-300">
                <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5">
                  <path
                    d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
                Doc
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-accent-500/10 px-1.5 py-0.5 text-accent-300">
                <FaviconImg host={host} size={10} />
                {host || 'web'}
              </span>
            )}
            {typeof source.score === 'number' && (
              <span className="text-slate-600">
                · match {Math.round(source.score * 100)}%
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100">
          {!isDoc && source.url && (
            <button
              onClick={openExternal}
              title="Open source in new tab"
              className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path
                  d="M14 4h6v6M20 4l-8 8M11 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <button
            onClick={copyCite}
            title="Copy citation"
            className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
              <rect
                x="8"
                y="8"
                width="12"
                height="12"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </div>
      </div>

      <p
        className={
          (expanded ? '' : 'line-clamp-4 ') +
          'whitespace-pre-wrap text-xs leading-relaxed text-slate-400'
        }
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />

      <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-600">
        {source.query ? (
          <span className="truncate">
            <span className="uppercase tracking-wider">query</span> ·{' '}
            <span className="normal-case text-slate-500">{source.query}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="shrink-0 text-slate-500">
          {expanded ? '↑ collapse' : '↓ expand'}
        </span>
      </div>
    </div>
  )
}

function FaviconImg({ host, size = 12 }: { host: string; size?: number }) {
  if (!host || host === 'local document') {
    return (
      <span
        className="inline-block rounded-sm bg-white/10"
        style={{ width: size, height: size }}
      />
    )
  }
  const src = `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}`
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="inline-block rounded-sm"
      onError={(e) => {
        ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
      }}
    />
  )
}

function safeHost(url: string): string {
  try {
    if (!url) return ''
    if (url.startsWith('doc://')) return 'local document'
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function highlight(text: string, query: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
  if (!query.trim()) return escape(text)
  const parts = query.trim().split(/\s+/).filter((p) => p.length >= 2)
  if (parts.length === 0) return escape(text)
  const re = new RegExp(
    '(' + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'gi',
  )
  return escape(text).replace(re, '<mark class="bg-accent-500/25 text-accent-100 rounded px-0.5">$1</mark>')
}
