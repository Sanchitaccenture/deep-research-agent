import { useEffect } from 'react'

export interface Hotkey {
  /** e.g. "meta+k", "ctrl+k", "meta+/", "esc" */
  combo: string
  handler: (e: KeyboardEvent) => void
  /** don't fire when the user is typing in an input/textarea (default true) */
  ignoreInInputs?: boolean
}

function parseCombo(combo: string) {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim())
  const key = parts[parts.length - 1]
  return {
    key,
    meta: parts.includes('meta') || parts.includes('cmd'),
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  return false
}

export function useHotkeys(hotkeys: Hotkey[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const h of hotkeys) {
        const { key, meta, ctrl, shift, alt } = parseCombo(h.combo)
        const matches =
          e.key.toLowerCase() === key &&
          (!meta || e.metaKey) &&
          (!ctrl || e.ctrlKey) &&
          (!shift || e.shiftKey) &&
          (!alt || e.altKey)
        // For "meta+k" style, allow either meta OR ctrl (cross-platform)
        const crossPlatform =
          (meta || ctrl) &&
          e.key.toLowerCase() === key &&
          (e.metaKey || e.ctrlKey) &&
          (!shift || e.shiftKey) &&
          (!alt || e.altKey)
        if (matches || crossPlatform) {
          const ignore = h.ignoreInInputs !== false && isTypingTarget(e.target)
          const isEscape = key === 'escape' || key === 'esc'
          if (ignore && !isEscape) continue
          h.handler(e)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hotkeys])
}
