export type ResearchMode = 'langgraph' | 'crew'

export type ReportTemplate =
  | 'default'
  | 'executive'
  | 'deep_dive'
  | 'pros_cons'
  | 'timeline'

export const TEMPLATE_META: Record<
  ReportTemplate,
  { label: string; description: string; icon: string }
> = {
  default: {
    label: 'Standard',
    description: 'Balanced overview, themed sections, key findings',
    icon: '◆',
  },
  executive: {
    label: 'Executive',
    description: 'One-page TL;DR, risks & recommendation',
    icon: '★',
  },
  deep_dive: {
    label: 'Deep dive',
    description: 'Comprehensive, tables, open questions',
    icon: '≣',
  },
  pros_cons: {
    label: 'Pros / Cons',
    description: 'Balanced arguments and a verdict',
    icon: '⚖',
  },
  timeline: {
    label: 'Timeline',
    description: 'Chronological table of events + outlook',
    icon: '⏱',
  },
}

export interface Source {
  id: number
  title: string
  url: string
  content: string
  query?: string
  source_type?: 'web' | 'document'
  score?: number
}

export interface Metrics {
  duration_seconds?: number
  sub_questions?: number
  search_rounds?: number
  source_count?: number
  web_sources?: number
  doc_sources?: number
  report_chars?: number
  report_words?: number
  reading_time_seconds?: number
  token_estimate?: number
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  llm_calls?: number
  has_diagram?: boolean
  followups_count?: number
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface SessionSummary {
  id: string
  question: string
  mode: ResearchMode
  template: ReportTemplate
  created_at: string
  source_count: number
  chat_count: number
  bookmarked?: boolean
  tags?: string[]
  has_notes?: boolean
}

export interface FullSession {
  id: string
  question: string
  report: string
  sources: Source[]
  steps: string[]
  mode: ResearchMode
  template: ReportTemplate
  diagram: string
  followups: string[]
  metrics: Metrics
  chat: ChatTurn[]
  created_at: string
  bookmarked?: boolean
  tags?: string[]
  notes?: string
}

export interface SessionsStats {
  total_sessions: number
  bookmarked: number
  total_sources: number
  total_chats: number
  by_mode: Record<string, number>
  by_template: Record<string, number>
  top_tags: { tag: string; count: number }[]
  activity: { day: string; count: number }[]
}

export interface DocumentInfo {
  doc_id: string
  filename: string
  chunks: number
}

export interface StatusResponse {
  features: { rag: boolean; crew: boolean }
  models: { langgraph: string; crew: string; embeddings: string }
  budgets: {
    max_subquestions: number
    results_per_search: number
    max_rounds: number
    rag_top_k: number
  }
  templates: string[]
  documents: number
  sessions: number
}

export interface StreamState {
  steps: string[]
  sources: Source[]
  report: string
  reportStreaming: boolean
  diagram: string
  followups: string[]
  suggestedTags: string[]
  metrics: Metrics
  chat: ChatTurn[]
  running: boolean
  error?: string
  sessionId?: string
  template: ReportTemplate
  mode: ResearchMode
  bookmarked: boolean
  tags: string[]
  notes: string
}
