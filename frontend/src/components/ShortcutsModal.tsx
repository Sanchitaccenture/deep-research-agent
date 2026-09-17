interface Props {
  open: boolean
  onClose: () => void
}

const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Open command palette' },
  { keys: ['⌘', 'N'], desc: 'New research' },
  { keys: ['⌘', 'H'], desc: 'Home dashboard' },
  { keys: ['⌘', ','], desc: 'Settings' },
  { keys: ['⌘', '/'], desc: 'Show this shortcuts panel' },
  { keys: ['⌘', 'Enter'], desc: 'Submit question (inside textarea)' },
  { keys: ['Esc'], desc: 'Close any dialog' },
]

export default function ShortcutsModal({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-md rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path
                d="M6 6l12 12M6 18L18 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
            >
              <span className="text-xs text-slate-300">{s.desc}</span>
              <span className="flex gap-1">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="min-w-[1.6rem] rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-center text-[11px] font-mono text-slate-200"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[10px] text-slate-500">
          On Windows/Linux, use <kbd className="bg-white/5 px-1">Ctrl</kbd> instead of{' '}
          <kbd className="bg-white/5 px-1">⌘</kbd>.
        </p>
      </div>
    </div>
  )
}
