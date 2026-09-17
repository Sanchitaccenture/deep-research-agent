import type { Metrics } from '../types'

interface Props {
  metrics: Metrics
  running: boolean
}

export default function MetricsBar({ metrics, running }: Props) {
  const cells: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: 'Duration',
      value:
        metrics.duration_seconds !== undefined
          ? `${metrics.duration_seconds}s`
          : running
            ? '…'
            : '—',
    },
    {
      label: 'Rounds',
      value: String(metrics.search_rounds ?? '—'),
      hint:
        metrics.sub_questions !== undefined
          ? `${metrics.sub_questions} sub-questions`
          : undefined,
    },
    {
      label: 'Sources',
      value:
        metrics.source_count !== undefined
          ? `${metrics.source_count}`
          : '—',
      hint:
        metrics.web_sources !== undefined && metrics.doc_sources !== undefined
          ? `${metrics.web_sources} web · ${metrics.doc_sources} docs`
          : undefined,
    },
    {
      label: 'Report',
      value:
        metrics.report_words !== undefined
          ? `${metrics.report_words} words`
          : metrics.report_chars !== undefined
            ? `${formatK(metrics.report_chars)} chars`
            : '—',
      hint:
        metrics.report_chars !== undefined
          ? `${formatK(metrics.report_chars)} chars`
          : undefined,
    },
    {
      label: 'Read time',
      value:
        metrics.reading_time_seconds !== undefined
          ? formatReadTime(metrics.reading_time_seconds)
          : '—',
    },
    {
      label: 'Tokens',
      value:
        metrics.token_estimate !== undefined
          ? formatK(metrics.token_estimate)
          : '—',
      hint:
        metrics.input_tokens !== undefined && metrics.output_tokens !== undefined
          ? `${formatK(metrics.input_tokens)} in · ${formatK(metrics.output_tokens)} out`
          : 'estimate',
    },
    {
      label: 'Cost',
      value:
        metrics.cost_usd !== undefined && metrics.cost_usd > 0
          ? formatCost(metrics.cost_usd)
          : '—',
      hint:
        metrics.llm_calls !== undefined
          ? `${metrics.llm_calls} LLM call${metrics.llm_calls === 1 ? '' : 's'}`
          : undefined,
    },
  ]

  return (
    <div className="glass grid grid-cols-2 gap-px overflow-hidden rounded-xl md:grid-cols-7">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface-900/40 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            {c.label}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-white">{c.value}</div>
          {c.hint && <div className="text-[10px] text-slate-500">{c.hint}</div>}
        </div>
      ))}
    </div>
  )
}

function formatK(n: number): string {
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(1) + 'k'
}

function formatReadTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001'
  if (usd < 1) return '$' + usd.toFixed(3)
  return '$' + usd.toFixed(2)
}
