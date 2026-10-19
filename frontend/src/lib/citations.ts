export function sanitizeTitle(title: string | undefined | null): string {
  return (title || '')
    .replace(/\|/g, '-')
    .replace(/"/g, "'")
    .replace(/[\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
