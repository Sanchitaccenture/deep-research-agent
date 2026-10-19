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
    securityLevel: 'strict',
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

    const run = async () => {
      try {
        const valid = await mermaid.parse(chart, { suppressErrors: true })
        if (!valid) throw new Error('invalid diagram syntax')
        const result = await mermaid.render(id, chart)
        if (!cancelled) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (err) {
        // Mermaid can leave its own error markup in the page; remove it.
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
        if (!cancelled) {
          console.warn('mermaid render failed', err)
          setError(err instanceof Error ? err.message : 'diagram render failed')
          setSvg('')
        }
      }
    }
    void run()

    return () => {
      cancelled = true
    }
  }, [chart])

  if (error) {
    return <p className="text-xs text-slate-500">Mind map unavailable.</p>
  }

  return (
    <div
      ref={ref}
      className={
        'flex max-w-full overflow-x-auto rounded-xl border border-white/5 bg-surface-950/40 p-4 [&>svg]:m-auto max-lg:[&>svg]:min-w-[560px] ' +
        (className || '')
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
