import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import type {
  Metrics,
  ReportTemplate,
  ResearchMode,
  Source,
  StreamState,
} from '../types'

const empty: StreamState = {
  steps: [],
  sources: [],
  report: '',
  reportStreaming: false,
  diagram: '',
  followups: [],
  suggestedTags: [],
  metrics: {},
  chat: [],
  running: false,
  template: 'default',
  mode: 'langgraph',
  bookmarked: false,
  tags: [],
  notes: '',
}

const MAX_RECONNECT_ATTEMPTS = 3

export function useResearch() {
  const [state, setState] = useState<StreamState>(empty)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectAttempts = useRef(0)
  const doneRef = useRef(false)
  const reconnectTimer = useRef<number | null>(null)

  const closeSource = () => {
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
    if (reconnectTimer.current) {
      window.clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
  }

  const stop = useCallback(() => {
    closeSource()
    setState((s) => ({ ...s, running: false, reportStreaming: false }))
  }, [])

  const reset = useCallback(() => {
    stop()
    reconnectAttempts.current = 0
    doneRef.current = false
    setState(empty)
  }, [stop])

  const reloadCurrent = useCallback(async () => {
    setState((s) => {
      const id = s.sessionId
      if (!id) return s
      api
        .getSession(id)
        .then((full) => {
          setState((prev) => ({
            ...prev,
            bookmarked: !!full.bookmarked,
            tags: full.tags || [],
            notes: full.notes || '',
            chat: full.chat || prev.chat,
          }))
        })
        .catch(() => undefined)
      return s
    })
  }, [])

  const loadSession = useCallback(
    async (id: string) => {
      stop()
      const s = await api.getSession(id)
      setState({
        steps: s.steps,
        sources: s.sources,
        report: s.report,
        reportStreaming: false,
        diagram: s.diagram || '',
        followups: s.followups || [],
        suggestedTags: [],
        metrics: s.metrics || {},
        chat: s.chat || [],
        running: false,
        sessionId: s.id,
        template: (s.template as ReportTemplate) || 'default',
        mode: s.mode || 'langgraph',
        bookmarked: !!s.bookmarked,
        tags: s.tags || [],
        notes: s.notes || '',
      })
    },
    [stop],
  )

  const openStream = (url: string) => {
    closeSource()
    const es = new EventSource(url)
    sourceRef.current = es

    es.onopen = () => {
      // Only celebrate reconnect if we'd tried before.
      if (reconnectAttempts.current > 0) {
        setState((s) => ({ ...s, error: undefined }))
      }
      reconnectAttempts.current = 0
    }

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.error) {
          const friendly = data.detail
            ? `${data.error} — ${data.detail}`
            : data.error
          setState((s) => ({
            ...s,
            error: friendly,
            running: false,
            reportStreaming: false,
          }))
          doneRef.current = true
          closeSource()
          return
        }
        if (data.step) setState((s) => ({ ...s, steps: [...s.steps, data.step] }))
        if (data.sources) setState((s) => ({ ...s, sources: data.sources as Source[] }))
        if (data.report_delta) {
          setState((s) => ({
            ...s,
            report: s.report + (data.report_delta as string),
            reportStreaming: true,
          }))
        }
        if (data.report) setState((s) => ({ ...s, report: data.report, reportStreaming: false }))
        if (data.diagram) setState((s) => ({ ...s, diagram: data.diagram }))
        if (data.followups) setState((s) => ({ ...s, followups: data.followups }))
        if (data.suggested_tags) {
          setState((s) => ({
            ...s,
            suggestedTags: data.suggested_tags as string[],
            tags: s.tags.length > 0 ? s.tags : (data.suggested_tags as string[]),
          }))
        }
        if (data.metrics) setState((s) => ({ ...s, metrics: data.metrics as Metrics }))
        if (data.done) {
          doneRef.current = true
          setState((s) => ({
            ...s,
            running: false,
            reportStreaming: false,
            sessionId: data.session_id ?? s.sessionId,
          }))
          closeSource()
        }
      } catch (err) {
        console.error('bad SSE payload', err)
      }
    }

    es.onerror = () => {
      // If the run has finished cleanly, ignore any lingering error events.
      if (doneRef.current) {
        closeSource()
        return
      }
      // Otherwise attempt reconnection with exponential backoff — but note
      // that the server has no resume-from-cursor, so a reconnect restarts
      // the full research. We only auto-retry if we haven't received any
      // data yet (early transient failure); mid-run drops surface as errors
      // for the user to decide.
      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        setState((s) => ({
          ...s,
          error:
            'Connection to the server was lost. Please retry when your connection stabilises.',
          running: false,
          reportStreaming: false,
        }))
        closeSource()
        return
      }
      reconnectAttempts.current += 1
      const delay = Math.min(4000, 500 * 2 ** (reconnectAttempts.current - 1))
      setState((s) => ({
        ...s,
        error: `Reconnecting to research stream (attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})…`,
      }))
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current)
      reconnectTimer.current = window.setTimeout(() => openStream(url), delay)
    }
  }

  const start = useCallback(
    (question: string, mode: ResearchMode, template: ReportTemplate) => {
      stop()
      reconnectAttempts.current = 0
      doneRef.current = false
      setState({
        ...empty,
        steps: [`Starting research (${mode}, template: ${template}) …`],
        running: true,
        reportStreaming: false,
        template,
        mode,
      })

      const url = api.streamUrl(question, mode, template)
      openStream(url)
    },
    [stop],
  )

  return { state, start, stop, reset, loadSession, reloadCurrent }
}
