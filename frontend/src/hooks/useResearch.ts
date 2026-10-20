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

const DUPLICATE_WINDOW_MS = 90_000

export function useResearch() {
  const [state, setState] = useState<StreamState>(empty)
  const sourceRef = useRef<EventSource | null>(null)
  const doneRef = useRef(false)
  const runningRef = useRef(false)
  const lastStartRef = useRef<{ key: string; at: number } | null>(null)

  const closeSource = () => {
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
  }

  const stop = useCallback(() => {
    closeSource()
    runningRef.current = false
    lastStartRef.current = null
    setState((s) => ({ ...s, running: false, reportStreaming: false }))
  }, [])

  const reset = useCallback(() => {
    stop()
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
          runningRef.current = false
          lastStartRef.current = null
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
        if (data.report) {
          doneRef.current = true
          setState((s) => ({ ...s, report: data.report, reportStreaming: false }))
        }
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
          runningRef.current = false
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
      // Never reconnect: the server has no resume cursor, so a reconnect would
      // start a second full research run. Close the stream and stop here.
      closeSource()
      runningRef.current = false
      if (doneRef.current) {
        // The report already arrived (or the run finished); ignore the error.
        setState((s) => ({ ...s, running: false, reportStreaming: false }))
        return
      }
      lastStartRef.current = null
      setState((s) => ({
        ...s,
        error:
          'Connection to the server was lost. Please run the research again.',
        running: false,
        reportStreaming: false,
      }))
    }
  }

  const start = useCallback(
    (
      question: string,
      mode: ResearchMode,
      template: ReportTemplate,
      opts?: { force?: boolean },
    ) => {
      console.debug(
        '[research] start() called',
        { question, mode, template, force: !!opts?.force },
        new Error('start() call site').stack,
      )
      const key = `${mode}|${template}|${question}`
      const now = Date.now()
      if (!opts?.force) {
        if (runningRef.current) {
          console.debug('[research] start() ignored: a run is already running')
          return
        }
        const last = lastStartRef.current
        if (last && last.key === key && now - last.at < DUPLICATE_WINDOW_MS) {
          console.debug('[research] start() ignored: same run started <90s ago')
          return
        }
      }
      stop()
      runningRef.current = true
      lastStartRef.current = { key, at: now }
      doneRef.current = false
      setState({
        ...empty,
        steps: [`Starting research (${mode}, template: ${template}) …`],
        running: true,
        reportStreaming: false,
        template,
        mode,
      })

      const rid = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
      const url = api.streamUrl(question, mode, template, rid)
      openStream(url)
    },
    [stop],
  )

  return { state, start, stop, reset, loadSession, reloadCurrent }
}
