import type { Source } from '../types'

export function sanitizeTitle(title: string | undefined | null): string {
  return (title || '')
    .replace(/\|/g, '-')
    .replace(/"/g, "'")
    .replace(/[\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Turn [n] into links to the numbered sources. Adjacent citations like [1][4]
// are first separated into "[1], [4]" so they render as "1, 4" (also in tables).
export function enrichCitations(
  md: string,
  sources: Source[],
  docLabels = true,
): string {
  if (!md) return md
  const spaced = md.replace(/(\[\d+\])(?=\[\d+\])/g, '$1, ')
  return spaced.replace(/\[(\d+)\]/g, (match, n) => {
    const id = parseInt(n, 10)
    const s = sources.find((x) => x.id === id)
    if (!s) return match
    const label = docLabels && s.source_type === 'document' ? 'D' : ''
    const url = s.url || '#'
    return `[${label}${n}](${url} "${sanitizeTitle(s.title)}")`
  })
}
