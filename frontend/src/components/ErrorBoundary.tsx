import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error?: Error
}

/**
 * Top-level error boundary. Catches render-time crashes so a bad markdown
 * table or malformed SSE payload can't blank out the entire app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid h-screen w-screen place-items-center bg-surface-950 p-6 text-slate-200">
        <div className="glass w-full max-w-md rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-rose-500/15 text-rose-300">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              <path
                d="M12 3L2 20h20L12 3Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M12 10v5M12 18v.01"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className="mb-1 text-lg font-semibold text-white">
            Something went wrong
          </h1>
          <p className="mb-4 text-xs text-slate-400">
            The UI crashed rendering a component. Your data is safe — reload to
            recover.
          </p>
          <details className="mb-4 overflow-hidden rounded-lg bg-black/30 text-left text-[11px] text-slate-400">
            <summary className="cursor-pointer px-3 py-2 hover:text-slate-200">
              Show error detail
            </summary>
            <pre className="whitespace-pre-wrap break-all px-3 py-2 font-mono">
              {this.state.error.message}
              {this.state.error.stack ? '\n\n' + this.state.error.stack.slice(0, 800) : ''}
            </pre>
          </details>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-gradient-to-r from-accent-600 to-brand-600 px-4 py-2 text-sm font-medium text-white hover:from-accent-500 hover:to-brand-500"
            >
              Reload
            </button>
            <button
              onClick={() => {
                window.location.hash = '#/'
                this.setState({ error: undefined })
              }}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
