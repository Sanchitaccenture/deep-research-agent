import type { StatusResponse } from '../types'

interface Props {
  status: StatusResponse
  onClose: () => void
}

export default function SettingsModal({ status, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-lg rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Runtime settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M6 6l12 12M6 18L18 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-xs text-slate-500">
          Values are loaded from the backend's <code className="rounded bg-white/5 px-1 py-0.5">.env</code>.
          Change them in the file and restart FastAPI to apply.
        </p>

        <Section title="Features">
          <Flag label="RAG (document search)" on={status.features.rag} />
          <Flag label="CrewAI multi-agent mode" on={status.features.crew} />
        </Section>

        <Section title="Models">
          <Row k="LangGraph LLM" v={status.models.langgraph} />
          <Row k="Crew LLM" v={status.models.crew} />
          <Row k="Embeddings" v={status.models.embeddings} />
        </Section>

        <Section title="Research budgets">
          <Row k="Sub-questions" v={String(status.budgets.max_subquestions)} />
          <Row k="Results per search" v={String(status.budgets.results_per_search)} />
          <Row k="Max rounds" v={String(status.budgets.max_rounds)} />
          <Row k="RAG top-K" v={String(status.budgets.rag_top_k)} />
        </Section>

        <Section title="Storage">
          <Row k="Documents" v={String(status.documents)} />
          <Row k="Saved sessions" v={String(status.sessions)} />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">{title}</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        {children}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-slate-400">{k}</span>
      <span className="font-mono text-slate-200">{v}</span>
    </div>
  )
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <span
        className={
          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ' +
          (on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-600/20 text-slate-500')
        }
      >
        {on ? 'On' : 'Off'}
      </span>
    </div>
  )
}
