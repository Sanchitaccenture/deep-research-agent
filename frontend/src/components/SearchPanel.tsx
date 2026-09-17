import { useState } from 'react'
import MicButton from './MicButton'
import TemplateSelector from './TemplateSelector'
import type { ReportTemplate } from '../types'

interface Props {
  template: ReportTemplate
  onTemplateChange: (t: ReportTemplate) => void
  onSubmit: (question: string) => void
  featuresRag: boolean
  docCount: number
}

const SAMPLE_QUESTIONS = [
  'What are the biggest risks facing the EV battery industry in 2026?',
  'Compare LangGraph and CrewAI: strengths, weaknesses, and when to use each.',
  'What is retrieval-augmented generation and why does it matter for enterprise AI?',
  'Summarize the state of open-source LLMs in 2026 with market share and licensing.',
]

export default function SearchPanel({
  template,
  onTemplateChange,
  onSubmit,
  featuresRag,
  docCount,
}: Props) {
  const [q, setQ] = useState('')

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = q.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center animate-fade-in">
        <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-wider text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
          Autonomous research · citations · diagrams · follow-up chat
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight text-white md:text-5xl">
          Ask <span className="gradient-text">anything</span>.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
          The agent decomposes your question, searches the web + your
          documents, critiques its own coverage, and delivers a cited report
          with a mind-map, metrics, and suggested next questions.
        </p>
      </div>

      <form onSubmit={submit} className="w-full animate-slide-up">
        <div className="glass rounded-2xl p-3 shadow-2xl shadow-black/40">
          <div className="flex items-start gap-2">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
              rows={3}
              placeholder="What do you want researched?  (Cmd/Ctrl+Enter to run · click 🎙 to speak)"
              className="flex-1 resize-none bg-transparent px-3 py-2 text-base text-white placeholder-slate-500 focus:outline-none"
            />
            <MicButton
              size="md"
              className="mt-1 shrink-0"
              onTranscript={(text, isFinal) => {
                if (isFinal) setQ((prev) => (prev ? prev.trim() + ' ' + text : text))
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
            <div className="flex-1" />
            {featuresRag && (
              <div className="rounded-lg border border-white/5 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
                {docCount > 0 ? (
                  <>Web + <b className="text-brand-400">{docCount}</b> doc{docCount === 1 ? '' : 's'}</>
                ) : (
                  <>Web only · upload docs for RAG</>
                )}
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

      <div className="mt-6 w-full animate-slide-up">
        <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">
          Report style
        </div>
        <TemplateSelector value={template} onChange={onTemplateChange} />
      </div>

      <div className="mt-8 w-full animate-slide-up">
        <p className="mb-3 text-xs uppercase tracking-wider text-slate-500">Try one</p>
        <div className="grid gap-2 md:grid-cols-2">
          {SAMPLE_QUESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSubmit(s)}
              className="group rounded-xl border border-white/5 bg-white/5 p-3 text-left text-sm text-slate-300 transition hover:border-white/10 hover:bg-white/10"
            >
              <span className="mr-2 text-accent-400 transition group-hover:text-brand-400">◆</span>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
