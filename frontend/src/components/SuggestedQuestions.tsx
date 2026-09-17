interface Props {
  followups: string[]
  onPick: (q: string) => void
}

export default function SuggestedQuestions({ followups, onPick }: Props) {
  if (!followups?.length) return null

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <path
            d="M12 3v18M3 12h18"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        Suggested next questions
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {followups.map((q, i) => (
          <button
            key={i}
            onClick={() => onPick(q)}
            className="group flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left text-sm text-slate-300 transition hover:border-brand-500/30 hover:bg-brand-500/5"
          >
            <span className="mt-0.5 text-brand-400 transition group-hover:translate-x-0.5">
              →
            </span>
            <span className="flex-1">{q}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
