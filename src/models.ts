/**
 * The OpenRouter model catalogue.
 *
 * `GET /api/v1/models` is public — it needs no key — and returns every model
 * the router will accept. We fetch it once, keep a small projection of it in
 * `localStorage`, and serve the picker from that. The wire response is ~750 KB;
 * the projection we keep is a fraction of that, and it is only ever read from
 * this device.
 *
 * Nothing here throws. A picker that renders an error row is better than a
 * picker that breaks the page, and there is no console to explain a rejection.
 */

export interface OpenRouterModel {
  /** The value actually sent as `model`, e.g. `deepseek/deepseek-v4.1-flash`. */
  id: string
  /** OpenRouter's display name, e.g. `DeepSeek: DeepSeek V4.1 Flash`. */
  name: string
  /** Context window in tokens, or 0 when the provider does not publish one. */
  context: number
  /** USD per 1M prompt tokens. 0 means free. */
  promptPrice: number
  /** USD per 1M completion tokens. */
  completionPrice: number
  /** Unix seconds, used to sort newest-first. */
  created: number
}

const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models'
const CACHE_KEY = 'codechat.models.v2'
const RECENT_KEY = 'codechat.models.recent.v1'
const RECENT_MAX = 6
/** A day. The list grows slowly and a stale list is harmless. */
const TTL_MS = 24 * 60 * 60 * 1000

/**
 * The three DeepSeek models this app shipped with, used only when the network
 * is unavailable *and* nothing is cached. They are real ids, so the picker is
 * still usable offline — it just cannot show the other 460-odd.
 */
export const FALLBACK_MODELS: OpenRouterModel[] = [
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', context: 0, promptPrice: 0, completionPrice: 0, created: 0 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek: Chat', context: 0, promptPrice: 0, completionPrice: 0, created: 0 },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek: R1', context: 0, promptPrice: 0, completionPrice: 0, created: 0 },
]

/** Short badge text for the panel header, e.g. `v4.1-flash`. */
export function shortModelName(id: string): string {
  const tail = id.split('/').pop() ?? id
  return tail.replace(/^deepseek-/, '')
}

/* ── cache ──────────────────────────────────────────────────── */

interface Cache {
  ts: number
  models: OpenRouterModel[]
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cache
    if (!Array.isArray(parsed?.models) || !parsed.models.length) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(models: OpenRouterModel[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), models }))
  } catch {
    /* private mode / quota — the in-memory copy still serves this session */
  }
}

/** Whatever we can serve right now without touching the network. */
export function cachedModels(): OpenRouterModel[] | null {
  return readCache()?.models ?? null
}

/* ── fetch ──────────────────────────────────────────────────── */

interface WireModel {
  id?: unknown
  name?: unknown
  created?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

/** Dollars per token as a string -> dollars per million as a number. */
function perMillion(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n * 1_000_000 : 0
}

function project(raw: WireModel[]): OpenRouterModel[] {
  const out: OpenRouterModel[] = []
  for (const m of raw) {
    if (typeof m?.id !== 'string' || !m.id) continue
    const ctx = Number(m.context_length)
    out.push({
      id: m.id,
      name: typeof m.name === 'string' && m.name ? m.name : m.id,
      context: Number.isFinite(ctx) && ctx > 0 ? ctx : 0,
      promptPrice: perMillion(m.pricing?.prompt),
      completionPrice: perMillion(m.pricing?.completion),
      created: Number(m.created) || 0,
    })
  }
  // Newest first — the same order OpenRouter's own catalogue opens with.
  out.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
  return out
}

export class ModelsError extends Error {}

/**
 * Load the catalogue. Resolves from cache when it is fresh, otherwise fetches.
 * A failed fetch with a stale cache resolves with the stale list rather than
 * throwing — showing yesterday's models beats showing none.
 */
export async function loadModels(force = false): Promise<OpenRouterModel[]> {
  const cache = readCache()
  if (!force && cache && Date.now() - cache.ts < TTL_MS) return cache.models

  try {
    const res = await fetch(MODELS_ENDPOINT, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new ModelsError(`OpenRouter returned ${res.status}`)
    const body = (await res.json()) as { data?: WireModel[] }
    const models = project(Array.isArray(body?.data) ? body.data : [])
    if (!models.length) throw new ModelsError('OpenRouter returned no models')
    writeCache(models)
    return models
  } catch (err) {
    if (cache) return cache.models
    if (err instanceof ModelsError) throw err
    throw new ModelsError('Could not reach OpenRouter')
  }
}

/* ── recents ────────────────────────────────────────────────── */

export function recentModels(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function rememberModel(id: string): void {
  const next = [id, ...recentModels().filter((v) => v !== id)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}

/* ── search ─────────────────────────────────────────────────── */

export interface ModelFilter {
  query?: string
  freeOnly?: boolean
}

/**
 * Rank matches: exact id, then id-starts-with, then name-starts-with, then
 * anything else that matches — so typing `deepseek` puts the DeepSeek models
 * above a model whose *description* happens to mention them.
 */
export function searchModels(
  models: OpenRouterModel[],
  { query = '', freeOnly = false }: ModelFilter = {},
): OpenRouterModel[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits: { model: OpenRouterModel; rank: number }[] = []

  for (const model of models) {
    if (freeOnly && model.promptPrice > 0) continue
    const id = model.id.toLowerCase()
    const name = model.name.toLowerCase()
    const hay = `${id} ${name}`

    let rank = 3
    if (terms.every((t) => hay.includes(t))) {
      const q = terms.join(' ')
      if (id === q) rank = 0
      else if (terms.every((t) => id.includes(t))) rank = 1
      else if (terms.every((t) => name.includes(t))) rank = 2
      hits.push({ model, rank })
    }
  }

  // Preserve the catalogue's newest-first order inside each rank.
  hits.sort((a, b) => a.rank - b.rank)
  return hits.map((h) => h.model)
}

/* ── display helpers ────────────────────────────────────────── */

/** `262144` -> `262k`, `1_000_000` -> `1M`. */
export function formatContext(tokens: number): string {
  if (!tokens) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

/** `0` -> `free`; otherwise `$0.27/M in · $1.10/M out`. */
export function formatPrice(model: OpenRouterModel): string {
  if (model.promptPrice === 0 && model.completionPrice === 0) return 'free'
  const money = (n: number): string => (n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n * 100) / 100}`)
  return `${money(model.promptPrice)}/${money(model.completionPrice)}`
}

/** The vendor half of an id, title-cased for a group heading. */
export function vendorOf(id: string): string {
  const head = id.split('/')[0] ?? ''
  return head || 'other'
}
