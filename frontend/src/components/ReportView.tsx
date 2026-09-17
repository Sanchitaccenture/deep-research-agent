import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import FocusMode from './FocusMode'
import Mermaid from './Mermaid'
import MetricsBar from './MetricsBar'
import SuggestedQuestions from './SuggestedQuestions'
import TableOfContents from './TableOfContents'
import { useToast } from './Toast'
import type { Metrics, Source } from '../types'

interface Props {
  question: string
  report: string
  reportStreaming: boolean
  diagram: string
  followups: string[]
  metrics: Metrics
  running: boolean
  sources: Source[]
  steps: string[]
  onPickFollowup: (q: string) => void
}

export default function ReportView({
  question,
  report,
  reportStreaming,
  diagram,
  followups,
  metrics,
  running,
  sources,
  steps,
  onPickFollowup,
}: Props) {
  const [focus, setFocus] = useState(false)
  const toast = useToast()

  if (!report) {
    return <RunningState steps={steps} running={running} sources={sources} />
  }

  const enriched = enrichCitations(report, sources)

  const copySection = async () => {
    await navigator.clipboard.writeText(report)
    toast.push({ kind: 'success', message: 'Report copied to clipboard' })
  }

  return (
    <div className="flex gap-6 animate-fade-in">
      <div className="min-w-0 flex-1 space-y-4">
        {Object.keys(metrics).length > 0 && (
          <MetricsBar metrics={metrics} running={running} />
        )}

        {reportStreaming && (
          <div className="flex items-center gap-2 text-[11px] text-brand-300">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand-400" />
            Streaming synthesis · {report.length} chars so far
          </div>
        )}

        <article className="glass relative rounded-2xl p-8">
          <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition group-hover:opacity-100">
            <IconBtn onClick={copySection} title="Copy report">
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
            </IconBtn>
            <IconBtn onClick={() => setFocus(true)} title="Focus mode (distraction-free)">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path
                  d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </IconBtn>
          </div>

          <div className="report-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{enriched}</ReactMarkdown>
            {reportStreaming && (
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse-soft rounded-sm bg-brand-400 align-middle" />
            )}
          </div>

          {!reportStreaming && (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-3 text-[11px]">
              <button
                onClick={copySection}
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                Copy report
              </button>
              <button
                onClick={() => setFocus(true)}
                className="rounded-md border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-brand-200 hover:bg-brand-500/20"
              >
                Focus mode
              </button>
            </div>
          )}
        </article>

        {diagram && (
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="4" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="20" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="4" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="20" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M6 6 L10 10 M18 6 L14 10 M6 18 L10 14 M18 18 L14 14"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
              Auto-generated mind map
            </div>
            <Mermaid chart={diagram} />
          </section>
        )}

        <SuggestedQuestions followups={followups} onPick={onPickFollowup} />
      </div>

      <TableOfContents markdown={report} />

      <FocusMode
        open={focus}
        onClose={() => setFocus(false)}
        title={question || 'Research report'}
        report={report}
        sources={sources}
      />
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  )
}

function enrichCitations(md: string, sources: Source[]): string {
  if (!md) return md
  return md.replace(/\[(\d+)\]/g, (match, n) => {
    const id = parseInt(n, 10)
    const s = sources.find((x) => x.id === id)
    if (!s) return match
    const label = s.source_type === 'document' ? 'D' : ''
    const url = s.url || '#'
    return `[${label}${n}](${url} "${(s.title || '').replace(/"/g, "'")}")`
  })
}

function RunningState({
  steps,
  running,
  sources,
}: {
  steps: string[]
  running: boolean
  sources: Source[]
}) {
  return (
    <div className="glass rounded-2xl p-8">
      <div className="mb-4 flex items-center gap-3">
        {running ? (
          <>
            <span className="h-2.5 w-2.5 animate-pulse-soft rounded-full bg-accent-500" />
            <span className="text-sm text-slate-300">
              Researching…{' '}
              <span className="text-slate-500">
                {sources.length > 0 && `${sources.length} sources collected`}
              </span>
            </span>
          </>
        ) : (
          <span className="text-sm text-slate-400">Waiting for report…</span>
        )}
      </div>

      <ul className="space-y-1.5 font-mono text-[12px] leading-relaxed text-slate-400">
        {steps.slice(-14).map((s, i) => (
          <li key={i} className="animate-slide-up">
            <span className="mr-2 text-slate-600">›</span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}
