import { TEMPLATE_META, type ReportTemplate } from '../types'

interface Props {
  value: ReportTemplate
  onChange: (t: ReportTemplate) => void
  compact?: boolean
}

const ORDER: ReportTemplate[] = [
  'default',
  'executive',
  'deep_dive',
  'pros_cons',
  'timeline',
]

export default function TemplateSelector({ value, onChange, compact }: Props) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ReportTemplate)}
        className="rounded-md border border-white/10 bg-surface-800 px-2 py-1 text-xs text-slate-200 focus:border-accent-500 focus:outline-none"
      >
        {ORDER.map((k) => (
          <option key={k} value={k}>
            {TEMPLATE_META[k].icon} {TEMPLATE_META[k].label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="grid gap-2 md:grid-cols-5">
      {ORDER.map((k) => {
        const meta = TEMPLATE_META[k]
        const active = value === k
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={
              'rounded-xl border p-2.5 text-left transition ' +
              (active
                ? 'border-accent-500/40 bg-accent-500/10 shadow-lg shadow-accent-500/10'
                : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/5')
            }
          >
            <div className="flex items-center gap-1.5">
              <span
                className={
                  'text-sm ' + (active ? 'text-accent-400' : 'text-slate-500')
                }
              >
                {meta.icon}
              </span>
              <span
                className={
                  'text-xs font-semibold ' +
                  (active ? 'text-white' : 'text-slate-300')
                }
              >
                {meta.label}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {meta.description}
            </p>
          </button>
        )
      })}
    </div>
  )
}
