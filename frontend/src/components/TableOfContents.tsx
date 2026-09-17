import { useEffect, useMemo, useState } from 'react'

interface Props {
  markdown: string
  containerSelector?: string
}

interface Heading {
  id: string
  text: string
  level: number
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

export function useHeadings(markdown: string): Heading[] {
  return useMemo(() => {
    const lines = (markdown || '').split('\n')
    const seen: Record<string, number> = {}
    const out: Heading[] = []
    for (const line of lines) {
      const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
      if (!m) continue
      const level = m[1].length
      const text = m[2].replace(/[*_`]/g, '').trim()
      if (!text) continue
      let id = slugify(text) || 'section'
      if (seen[id] != null) {
        seen[id] += 1
        id = `${id}-${seen[id]}`
      } else {
        seen[id] = 0
      }
      out.push({ id, text, level })
    }
    return out
  }, [markdown])
}

export default function TableOfContents({
  markdown,
  containerSelector = '.report-md',
}: Props) {
  const headings = useHeadings(markdown)
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (headings.length === 0) return
    const container = document.querySelector<HTMLElement>(containerSelector)
    if (!container) return

    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>('h2, h3'),
    )
    nodes.forEach((n, i) => {
      const h = headings[i]
      if (h && !n.id) n.id = h.id
    })

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [headings, containerSelector])

  if (headings.length < 2) return null

  return (
    <nav
      aria-label="Table of contents"
      className="glass sticky top-4 hidden max-h-[calc(100vh-8rem)] w-56 shrink-0 overflow-y-auto rounded-xl p-3 text-xs xl:block"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
          <path
            d="M4 6h16M4 12h10M4 18h16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        On this page
      </div>
      <ul className="space-y-0.5">
        {headings.map((h) => {
          const isActive = active === h.id
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document
                    .getElementById(h.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setActive(h.id)
                }}
                className={
                  'block truncate rounded px-2 py-1 transition ' +
                  (h.level === 3 ? 'pl-5 text-[11px] ' : '') +
                  (isActive
                    ? 'bg-accent-500/15 font-medium text-accent-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
                }
              >
                {h.text}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
