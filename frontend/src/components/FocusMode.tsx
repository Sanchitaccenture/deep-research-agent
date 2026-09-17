import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Source } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  report: string
  sources: Source[]
}

export default function FocusMode({ open, onClose, title, report, sources }: Props) {
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('md')

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || (e.key === '=' && e.shiftKey)) bumpFont(1)
      if (e.key === '-') bumpFont(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fontSize])

  const bumpFont = (dir: number) => {
    const order: Array<'sm' | 'md' | 'lg' | 'xl'> = ['sm', 'md', 'lg', 'xl']
    const idx = order.indexOf(fontSize)
    const next = Math.min(order.length - 1, Math.max(0, idx + dir))
    setFontSize(order[next])
  }

  if (!open) return null

  const enriched = enrichCitations(report, sources)
  const sizeCls = {
    sm: 'text-[14px] leading-[1.75]',
    md: 'text-[16px] leading-[1.8]',
    lg: 'text-[18px] leading-[1.85]',
    xl: 'text-[20px] leading-[1.9]',
  }[fontSize]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-950/98 backdrop-blur-xl animate-fade-in">
      <header className="flex items-center justify-between border-b border-white/5 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent-500 to-brand-500">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-white">
              <path
                d="M4 18 L10 8 L14 14 L20 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="20" cy="6" r="1.8" fill="currentColor" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Focus mode
            </div>
            <div className="truncate text-sm font-medium text-white">{title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1 md:flex">
            <FontBtn label="A-" active={false} onClick={() => bumpFont(-1)} />
            <span className="px-1 text-[10px] uppercase text-slate-500">{fontSize}</span>
            <FontBtn label="A+" active={false} onClick={() => bumpFont(1)} />
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
            title="Exit focus mode (Esc)"
          >
            Exit <kbd className="ml-1.5 text-[10px] text-slate-500">Esc</kbd>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <article className={'report-md mx-auto max-w-3xl px-6 py-12 ' + sizeCls}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{enriched}</ReactMarkdown>
        </article>
      </div>

      <footer className="border-t border-white/5 px-6 py-2 text-center text-[10px] text-slate-600">
        ← → to scroll · <kbd className="rounded bg-white/5 px-1">+</kbd>{' '}
        <kbd className="rounded bg-white/5 px-1">-</kbd> to resize ·{' '}
        <kbd className="rounded bg-white/5 px-1">Esc</kbd> to exit
      </footer>
    </div>
  )
}

function FontBtn({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded px-2 py-0.5 text-[10px] font-medium transition ' +
        (active
          ? 'bg-white/10 text-white'
          : 'text-slate-400 hover:bg-white/10 hover:text-white')
      }
    >
      {label}
    </button>
  )
}

function enrichCitations(md: string, sources: Source[]): string {
  if (!md) return md
  return md.replace(/\[(\d+)\]/g, (match, n) => {
    const id = parseInt(n, 10)
    const s = sources.find((x) => x.id === id)
    if (!s) return match
    const label = s.source_type === 'document' ? 'D' : ''
    const url = s.url || '#'
    return `[${label}${n}](${url} "${(s.title || '').replace(/"/g, "'")}")`
  })
}
