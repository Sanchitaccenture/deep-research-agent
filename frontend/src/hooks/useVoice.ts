import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionEventLike {
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      [i: number]: { transcript: string }
    }
    item(i: number): { isFinal: boolean; [i: number]: { transcript: string } }
  }
  resultIndex: number
}

/**
 * Wraps webkitSpeechRecognition / SpeechRecognition. Reports interim + final
 * transcripts. Not supported in Firefox / Safari (as of 2026-09); we expose
 * `supported: false` in that case and the caller should hide the button.
 */
export function useVoice(onTranscript: (text: string, isFinal: boolean) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  const cbRef = useRef(onTranscript)

  useEffect(() => {
    cbRef.current = onTranscript
  }, [onTranscript])

  const supported =
    typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const stop = useCallback(() => {
    recognitionRef.current?.stop?.()
    recognitionRef.current = null
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (!supported) {
      setError('Voice input is not supported in this browser.')
      return
    }
    stop()
    setError(null)

    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new Ctor()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'

    rec.onstart = () => setListening(true)
    rec.onend = () => setListening(false)
    rec.onerror = (evt: any) => {
      setError(evt?.error || 'voice error')
      setListening(false)
    }
    rec.onresult = (evt: SpeechRecognitionEventLike) => {
      let interim = ''
      let final = ''
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const r = evt.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      if (final) cbRef.current(final.trim(), true)
      else if (interim) cbRef.current(interim.trim(), false)
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setListening(false)
    }
  }, [supported, stop])

  useEffect(() => {
    return () => stop()
  }, [stop])

  return { supported: !!supported, listening, error, start, stop }
}
