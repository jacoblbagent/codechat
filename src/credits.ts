/**
 * OpenRouter credits.
 *
 * Two endpoints, and the difference between them matters:
 *
 *  - `GET /api/v1/key` identifies the key in use. It works with any key, and
 *    returns that key's own spend limit (`limit`, `limit_remaining`,
 *    `limit_reset`) and usage, plus whether the key is a management key.
 *  - `GET /api/v1/credits` returns the *account* balance (credits purchased and
 *    used). OpenRouter requires a provisioning/management key for it, so an
 *    ordinary inference key gets a 403 — and a browser logs failed responses to
 *    the console, which this app keeps clean. So it is requested only when
 *    `/key` has already said the key is allowed to.
 *
 * Nothing here throws at the caller: a snapshot carries whatever arrived plus
 * the reason for whatever did not.
 */

export interface KeyInfo {
  /** OpenRouter's own masked form, e.g. `sk-or-v1-au7...890`. */
  label: string
  /** USD cap on this key, or null when it has none. */
  limit: number | null
  limitRemaining: number | null
  /** `daily` | `weekly` | `monthly` | null. */
  limitReset: string | null
  /** USD spent through this key. */
  usage: number
  usageDaily: number | null
  usageMonthly: number | null
  isFreeTier: boolean
  isManagementKey: boolean
  expiresAt: string | null
}

export interface AccountInfo {
  totalCredits: number
  totalUsage: number
  remaining: number
}

export interface CreditsSnapshot {
  key: KeyInfo | null
  account: AccountInfo | null
  /** Why the key lookup failed, when it did. */
  keyError: string | null
  /** Why the account balance is missing, when it is. */
  accountError: string | null
  /** True when the key simply is not allowed to read the account balance. */
  accountNeedsManagementKey: boolean
  fetchedAt: number
}

const KEY_URL = 'https://openrouter.ai/api/v1/key'
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
const TTL_MS = 60_000

let cache: CreditsSnapshot | null = null

export function cachedCredits(): CreditsSnapshot | null {
  return cache
}

/** The API key changed, so every number in the cache belongs to someone else. */
export function invalidateCredits(): void {
  cache = null
}

class CreditsError extends Error {}

function num(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function getJson(url: string, apiKey: string): Promise<Record<string, unknown> | null> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
  } catch {
    throw new CreditsError('Could not reach OpenRouter')
  }
  if (!res.ok) {
    // OpenRouter puts a human message in the body; use it when it is there.
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: unknown } }
      if (typeof body?.error?.message === 'string') detail = body.error.message
    } catch {
      /* not JSON — the status is enough */
    }
    if (res.status === 401) throw new CreditsError('OpenRouter rejected the API key')
    throw new CreditsError(detail || `OpenRouter returned ${res.status}`)
  }
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    throw new CreditsError('OpenRouter returned a response we could not read')
  }
}

function projectKey(raw: unknown): KeyInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  return {
    label: typeof d.label === 'string' ? d.label : '',
    limit: num(d.limit),
    limitRemaining: num(d.limit_remaining),
    limitReset: typeof d.limit_reset === 'string' ? d.limit_reset : null,
    usage: num(d.usage) ?? 0,
    usageDaily: num(d.usage_daily),
    usageMonthly: num(d.usage_monthly),
    isFreeTier: d.is_free_tier === true,
    isManagementKey: d.is_management_key === true || d.is_provisioning_key === true,
    expiresAt: typeof d.expires_at === 'string' ? d.expires_at : null,
  }
}

function projectAccount(raw: unknown): AccountInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const totalCredits = num(d.total_credits)
  const totalUsage = num(d.total_usage)
  if (totalCredits === null || totalUsage === null) return null
  return { totalCredits, totalUsage, remaining: totalCredits - totalUsage }
}

/**
 * The cached snapshot, or a fresh one. `force` skips the cache (the Refresh
 * button); the key changing invalidates it outright.
 */
export async function loadCredits(apiKey: string, force = false): Promise<CreditsSnapshot> {
  const empty: CreditsSnapshot = {
    key: null,
    account: null,
    keyError: null,
    accountError: null,
    accountNeedsManagementKey: false,
    fetchedAt: Date.now(),
  }
  if (!apiKey) return { ...empty, keyError: 'No API key set' }
  if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache

  const snapshot: CreditsSnapshot = { ...empty }
  try {
    snapshot.key = projectKey((await getJson(KEY_URL, apiKey))?.data)
  } catch (err) {
    snapshot.keyError = (err as Error).message
  }

  if (snapshot.key) {
    if (snapshot.key.isManagementKey) {
      try {
        snapshot.account = projectAccount((await getJson(CREDITS_URL, apiKey))?.data)
        if (!snapshot.account) snapshot.accountError = 'OpenRouter returned no totals'
      } catch (err) {
        snapshot.accountError = (err as Error).message
      }
    } else {
      // Asking anyway is a guaranteed 403, and the failed response would show
      // up in the browser console.
      snapshot.accountNeedsManagementKey = true
    }
  }

  snapshot.fetchedAt = Date.now()
  // Only remember a snapshot that actually learned something, so a blip does
  // not pin an error in place for the next minute.
  if (snapshot.key || !cache) cache = snapshot
  return snapshot
}

export function fmtMoney(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function fmtWhen(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `Updated ${time}`
}
