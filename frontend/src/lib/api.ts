import type {
  ChatTurn,
  DocumentInfo,
  FullSession,
  ReportTemplate,
  ResearchMode,
  SessionSummary,
  SessionsStats,
  StatusResponse,
} from '../types'

const API = '/api'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  status: () => fetch(`${API}/status`).then((r) => json<StatusResponse>(r)),

  listSessions: () =>
    fetch(`${API}/sessions`)
      .then((r) => json<{ sessions: SessionSummary[] }>(r))
      .then((r) => r.sessions),

  searchSessions: (q: string) =>
    fetch(`${API}/sessions/search?q=${encodeURIComponent(q)}`)
      .then((r) => json<{ sessions: SessionSummary[] }>(r))
      .then((r) => r.sessions),

  sessionsStats: () => fetch(`${API}/sessions/stats`).then((r) => json<SessionsStats>(r)),

  getSession: (id: string) => fetch(`${API}/sessions/${id}`).then((r) => json<FullSession>(r)),

  relatedSessions: (id: string) =>
    fetch(`${API}/sessions/${id}/related`)
      .then((r) => json<{ related: SessionSummary[] }>(r))
      .then((r) => r.related),

  updateSessionMeta: (
    id: string,
    patch: { bookmarked?: boolean; tags?: string[]; notes?: string },
  ) =>
    fetch(`${API}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<SessionSummary>(r)),

  deleteSession: (id: string) =>
    fetch(`${API}/sessions/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  listDocuments: () =>
    fetch(`${API}/documents`)
      .then((r) => json<{ documents: DocumentInfo[] }>(r))
      .then((r) => r.documents),

  uploadDocument: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${API}/documents/upload`, { method: 'POST', body: form }).then((r) =>
      json<{ ok: boolean; document: DocumentInfo }>(r),
    )
  },

  deleteDocument: (docId: string) =>
    fetch(`${API}/documents/${docId}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  clearDocuments: () =>
    fetch(`${API}/documents`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  clearChat: (sessionId: string) =>
    fetch(`${API}/sessions/${sessionId}/chat`, { method: 'DELETE' }).then((r) =>
      json<{ ok: boolean }>(r),
    ),

  streamUrl: (question: string, mode: ResearchMode, template: ReportTemplate) => {
    if (mode === 'crew') {
      return `${API}/crew/stream?question=${encodeURIComponent(question)}&save=true`
    }
    return `${API}/research/stream?question=${encodeURIComponent(question)}&template=${encodeURIComponent(template)}&save=true`
  },

  chatStreamUrl: (sessionId: string, message: string) =>
    `${API}/sessions/${sessionId}/chat/stream?message=${encodeURIComponent(message)}`,
}

export type { ChatTurn }
