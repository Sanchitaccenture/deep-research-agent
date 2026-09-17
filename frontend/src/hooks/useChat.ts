import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ChatTurn } from '../types'

interface State {
  turns: ChatTurn[]
  streaming: boolean
  liveText: string
  error?: string
}

const empty: State = { turns: [], streaming: false, liveText: '' }

export function useChat(initial: ChatTurn[] = []) {
  const [state, setState] = useState<State>({ ...empty, turns: initial })
  const esRef = useRef<EventSource | null>(null)

  const stop = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setState((s) => ({ ...s, streaming: false, liveText: '' }))
  }, [])

  const reset = useCallback((turns: ChatTurn[] = []) => {
    stop()
    setState({ ...empty, turns })
  }, [stop])

  const send = useCallback(
    (sessionId: string, message: string) => {
      stop()
      setState((s) => ({
        ...s,
        streaming: true,
        liveText: '',
        error: undefined,
      }))

      const url = api.chatStreamUrl(sessionId, message)
      const es = new EventSource(url)
      esRef.current = es

      let acc = ''

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (data.error) {
            setState((s) => ({ ...s, streaming: false, error: data.error }))
            es.close()
            return
          }
          if (data.user_turn) {
            setState((s) => ({
              ...s,
              turns: [...s.turns, data.user_turn as ChatTurn],
            }))
          }
          if (data.delta) {
            acc += data.delta
            setState((s) => ({ ...s, liveText: acc }))
          }
          if (data.done) {
            const finalTurn: ChatTurn | undefined = data.assistant_turn
            setState((s) => ({
              ...s,
              streaming: false,
              liveText: '',
              turns: finalTurn ? [...s.turns, finalTurn] : s.turns,
            }))
            es.close()
          }
        } catch (err) {
          console.error('bad chat SSE', err)
        }
      }

      es.onerror = () => {
        setState((s) => ({ ...s, streaming: false }))
        es.close()
      }
    },
    [stop],
  )

  const clear = useCallback(
    async (sessionId: string) => {
      await api.clearChat(sessionId).catch(() => undefined)
      reset([])
    },
    [reset],
  )

  return { state, send, stop, reset, clear }
}
