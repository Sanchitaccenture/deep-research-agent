import type { KeyboardEvent } from 'react'

// Plain Enter submits on devices with a precise pointer (mouse); on touch
// devices Enter stays a newline. Shift/Ctrl/Meta/Alt and IME composition are excluded.
export function shouldSubmitOnEnter(e: KeyboardEvent): boolean {
  return (
    e.key === 'Enter' &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.nativeEvent.isComposing &&
    window.matchMedia('(pointer: fine)').matches
  )
}
