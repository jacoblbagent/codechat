/**
 * DeepSeek client — talks to DeepSeek v4.1 Flash through the OpenRouter
 * chat-completions endpoint with server-sent-event streaming.
 */

export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'
export const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  apiKey: string
  model?: string
  temperature?: number
  signal?: AbortSignal
  onDelta: (chunk: string) => void
  onReasoning?: (chunk: string) => void
}

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(`OpenRouter ${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function describe(status: number, body: string): string {
  let msg = body
  try {
    const parsed = JSON.parse(body)
    msg = parsed?.error?.message ?? parsed?.message ?? body
  } catch {
    /* body wasn't JSON */
  }
  switch (status) {
    case 401:
      return `Invalid API key — set your OpenRouter key in the Settings view. (${msg})`
    case 402:
      return `Out of OpenRouter credits for this key. (${msg})`
    case 403:
      return `This key is not permitted to use the requested model. (${msg})`
    case 404:
      return `Model not found on OpenRouter — check the model id. (${msg})`
    case 429:
      return `Rate limited by OpenRouter. Wait a moment and retry. (${msg})`
    default:
      return msg || `Request failed with status ${status}`
  }
}

/** Stream a completion, invoking onDelta for each text fragment. */
export async function streamChat(messages: ChatMessage[], opts: StreamOptions): Promise<void> {
  // 0.2 is the app's fixed sampling temperature: the Settings view deliberately
  // exposes no control for it, so this default is the single source of truth.
  const { apiKey, model = DEFAULT_MODEL, temperature = 0.2, signal, onDelta, onReasoning } = opts

  if (!apiKey) {
    throw new ApiError(401, 'No API key configured.')
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'CodeChat',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: true,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, describe(res.status, body))
  }
  if (!res.body) throw new ApiError(500, 'The response had no body stream.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleLine = (raw: string): boolean => {
    const line = raw.trim()
    if (!line || line.startsWith(':')) return false
    if (!line.startsWith('data:')) return false
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') return true
    try {
      const json = JSON.parse(payload)
      if (json.error) {
        throw new ApiError(json.error?.code ?? 500, json.error?.message ?? 'Stream error')
      }
      const delta = json.choices?.[0]?.delta
      if (!delta) return false
      if (typeof delta.content === 'string' && delta.content) onDelta(delta.content)
      if (typeof delta.reasoning === 'string' && delta.reasoning && onReasoning) {
        onReasoning(delta.reasoning)
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      /* partial JSON across chunk boundaries — ignore, next chunk completes it */
    }
    return false
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (handleLine(line)) return
    }
  }
  if (buffer) handleLine(buffer)
}

/* ── Model catalogue ───────────────────────────────────────── */
export interface ModelOption {
  id: string
  label: string
}

export const MODELS: ModelOption[] = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'deepseek/deepseek-v4.1-flash' },
  { id: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat' },
  { id: 'deepseek/deepseek-r1', label: 'deepseek/deepseek-r1' },
]

/** Short badge text for the panel header, e.g. "v4.1-flash". */
export function shortModelName(id: string): string {
  const tail = id.split('/').pop() ?? id
  return tail.replace(/^deepseek-/, '')
}
