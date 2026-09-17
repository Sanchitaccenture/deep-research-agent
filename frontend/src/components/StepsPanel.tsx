interface Props {
  steps: string[]
  running: boolean
}

export default function StepsPanel({ steps, running }: Props) {
  return (
    <div className="glass rounded-2xl p-6">
      <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
        {running ? (
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent-500" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
        )}
        {running ? 'Streaming agent trace' : 'Agent trace'}
      </div>

      <ul className="space-y-1.5 font-mono text-[12.5px] leading-relaxed text-slate-300">
        {steps.map((s, i) => {
          const isHeader = s.startsWith('==') || s.startsWith('Planned')
          const isError = s.includes('failed') || s.includes('!')
          return (
            <li
              key={i}
              className={
                'flex gap-3 rounded-md px-2 py-1 transition ' +
                (isHeader ? 'bg-white/[0.03] font-semibold text-accent-300' : '') +
                (isError ? ' text-rose-300' : '')
              }
            >
              <span className="w-8 shrink-0 text-right text-slate-600">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="whitespace-pre-wrap">{s}</span>
            </li>
          )
        })}
        {running && (
          <li className="flex gap-3 px-2 py-1 text-slate-500">
            <span className="w-8 shrink-0 text-right text-slate-700">
              {String(steps.length + 1).padStart(2, '0')}
            </span>
            <span className="animate-pulse-soft">agent thinking…</span>
          </li>
        )}
      </ul>
    </div>
  )
}
