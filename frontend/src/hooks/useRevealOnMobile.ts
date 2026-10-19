import { useEffect, type RefObject } from 'react'

// On phones the chat/notes panel starts below the query bar and tabs, so its
// input would sit below the fold. Scroll the panel's bottom into view on open.
export function useRevealOnMobile(ref: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active) return
    if (!window.matchMedia('(max-width: 1023.98px)').matches) return
    ref.current?.scrollIntoView({ block: 'end' })
  }, [ref, active])
}
