import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ChatTurn, Source } from '../types'

interface State {
  turns: ChatTurn[]
  streaming: boolean
  liveText: string
  error?: string
}

export interface ChatContext {
  question: string
  report: string
  sources: Source[]
}

const empty: State = { turns: [], streaming: false, liveText: '' }
const HISTORY_TURNS = 6

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const detail = JSON.parse(text).detail
    if (typeof detail === 'string') return detail
  } catch {
    /* not JSON */
  }
  return text || `HTTP ${res.status}`
}

export function useChat(initial: ChatTurn[] = []) {
  const [state, setState] = useState<State>({ ...empty, turns: initial })
  const turnsRef = useRef<ChatTurn[]>(initial)
  const abortRef = useRef<AbortController | null>(null)

  const update = useCallback((fn: (s: State) => State) => {
    setState((s) => {
      const next = fn(s)
      turnsRef.current = next.turns
      return next
    })
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    update((s) => ({ ...s, streaming: false, liveText: '' }))
  }, [update])

  const reset = useCallback(
    (turns: ChatTurn[] = []) => {
      stop()
      update(() => ({ ...empty, turns }))
    },
    [stop, update],
  )

  const send = useCallback(
    async (ctx: ChatContext, message: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const history = turnsRef.current
        .slice(-HISTORY_TURNS)
        .map((t) => ({ role: t.role, content: t.content }))

      update((s) => ({ ...s, streaming: true, liveText: '', error: undefined }))

      const fail = (msg: string) =>
        update((s) => ({ ...s, streaming: false, liveText: '', error: msg }))

      let acc = ''
      const handle = (data: {
        error?: string
        user_turn?: ChatTurn
        delta?: string
        done?: boolean
        assistant_turn?: ChatTurn
      }) => {
        if (data.error) {
          fail(data.error)
          controller.abort()
          return
        }
        if (data.user_turn) {
          const turn = data.user_turn
          update((s) => ({ ...s, turns: [...s.turns, turn] }))
        }
        if (data.delta) {
          acc += data.delta
          update((s) => ({ ...s, liveText: acc }))
        }
        if (data.done) {
          const finalTurn = data.assistant_turn
          update((s) => ({
            ...s,
            streaming: false,
            liveText: '',
            turns: finalTurn ? [...s.turns, finalTurn] : s.turns,
          }))
        }
      }

      try {
        const res = await api.chatStream(
          { ...ctx, history, message },
          controller.signal,
        )
        if (!res.ok || !res.body) {
          fail(await errorMessage(res))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'))
            if (!line) continue
            try {
              handle(JSON.parse(line.slice(5).trim()))
            } catch (err) {
              console.error('bad chat SSE', err)
            }
          }
        }
        // Stream ended without a done/error event: stop the spinner.
        update((s) => (s.streaming ? { ...s, streaming: false, liveText: '' } : s))
      } catch (err) {
        if (controller.signal.aborted) return
        fail(
          err instanceof Error && err.message
            ? `Connection to the server was lost (${err.message})`
            : 'Connection to the server was lost',
        )
      }
    },
    [update],
  )

  // Stateless route: chat turns live in React state, so clearing is local.
  // The session DELETE is best-effort for persistent (Docker) deployments.
  const clear = useCallback(
    async (sessionId?: string) => {
      if (sessionId) await api.clearChat(sessionId).catch(() => undefined)
      reset([])
    },
    [reset],
  )

  return { state, send, stop, reset, clear }
}
