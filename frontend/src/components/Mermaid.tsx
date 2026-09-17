import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

let initialized = false

function initMermaid() {
  if (initialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      background: '#0b0f16',
      primaryColor: '#1a2436',
      primaryTextColor: '#e5e7eb',
      primaryBorderColor: '#334158',
      lineColor: '#7dd3fc',
      secondaryColor: '#243046',
      tertiaryColor: '#111826',
      fontFamily: 'Inter, system-ui, sans-serif',
    },
    securityLevel: 'loose',
  })
  initialized = true
}

interface Props {
  chart: string
  className?: string
}

export default function Mermaid({ chart, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    if (!chart?.trim()) return
    initMermaid()

    let cancelled = false
    const id = `mmd-${Math.random().toString(36).slice(2, 10)}`

    mermaid
      .render(id, chart)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('mermaid render failed', err)
          setError(err?.message || 'diagram render failed')
          setSvg('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [chart])

  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300">
        Diagram failed to render: {error}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={
        'flex justify-center overflow-x-auto rounded-xl border border-white/5 bg-surface-950/40 p-4 ' +
        (className || '')
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
