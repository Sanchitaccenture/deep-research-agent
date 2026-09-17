import type { ResearchMode } from '../types'

interface Props {
  mode: ResearchMode
  onChange: (m: ResearchMode) => void
  crewEnabled: boolean
}

export default function ModeSelector({ mode, onChange, crewEnabled }: Props) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-white/5 p-1">
      <ModeButton
        active={mode === 'langgraph'}
        onClick={() => onChange('langgraph')}
        color="accent"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 8v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8M12 15v1" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        LangGraph
      </ModeButton>
      <ModeButton
        active={mode === 'crew'}
        onClick={() => crewEnabled && onChange('crew')}
        color="brand"
        disabled={!crewEnabled}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="17" cy="9" r="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 18c0-2 2-3 4-3s4 1 4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        CrewAI
      </ModeButton>
    </div>
  )
}

function ModeButton({
  children,
  active,
  onClick,
  color,
  disabled,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  color: 'accent' | 'brand'
  disabled?: boolean
}) {
  const activeClass =
    color === 'accent'
      ? 'bg-accent-600/20 text-accent-400 shadow-inner shadow-accent-500/10'
      : 'bg-brand-600/20 text-brand-400 shadow-inner shadow-brand-500/10'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ' +
        (active
          ? activeClass
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200') +
        (disabled ? ' cursor-not-allowed opacity-40' : '')
      }
    >
      {children}
    </button>
  )
}
