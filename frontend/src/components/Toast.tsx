import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  detail?: string
  ttl?: number
}

interface ToastCtx {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, number>>({})

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
    if (timers.current[id]) {
      window.clearTimeout(timers.current[id])
      delete timers.current[id]
    }
  }, [])

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Math.random().toString(36).slice(2, 10)
      const toast: Toast = { id, ttl: 3200, ...t }
      setToasts((prev) => [...prev.slice(-4), toast])
      if (toast.ttl && toast.ttl > 0) {
        timers.current[id] = window.setTimeout(() => dismiss(id), toast.ttl)
      }
    },
    [dismiss],
  )

  useEffect(() => {
    const t = timers.current
    return () => {
      Object.values(t).forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport />
    </Ctx.Provider>
  )
}

function ToastViewport() {
  const { toasts, dismiss } = useToast()
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const styles = KIND[toast.kind]
  return (
    <div
      className={
        'pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border p-3 shadow-2xl shadow-black/40 backdrop-blur ' +
        styles.wrap
      }
      role="status"
    >
      <span className={'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ' + styles.icon}>
        {styles.symbol}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{toast.message}</div>
        {toast.detail && (
          <div className="mt-0.5 truncate text-[11px] text-slate-400">{toast.detail}</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
        aria-label="Dismiss"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

const KIND: Record<
  ToastKind,
  { wrap: string; icon: string; symbol: ReactNode }
> = {
  success: {
    wrap: 'border-emerald-500/30 bg-emerald-500/10',
    icon: 'bg-emerald-500/20 text-emerald-300',
    symbol: (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
        <path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  info: {
    wrap: 'border-brand-500/30 bg-brand-500/10',
    icon: 'bg-brand-500/20 text-brand-300',
    symbol: (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 8v.01M12 11v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  warning: {
    wrap: 'border-amber-500/30 bg-amber-500/10',
    icon: 'bg-amber-500/20 text-amber-300',
    symbol: (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
        <path d="M12 3L2 20h20L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M12 10v4M12 17v.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  error: {
    wrap: 'border-rose-500/30 bg-rose-500/10',
    icon: 'bg-rose-500/20 text-rose-300',
    symbol: (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
}
