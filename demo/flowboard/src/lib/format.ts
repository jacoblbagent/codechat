/**
 * Display helpers. Pure functions only — no store, no React, no side effects.
 */

// TODO: thread a locale through instead of assuming en-US everywhere.
const LOCALE = 'en-US'

const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight, so two dates on the same day compare equal. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Whole days from `a` to `b`. Negative when `b` is in the past. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

/** "Ada Lovelace" -> "AL". Falls back to the first two characters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts.at(0)
  if (!first) return '?'
  const last = parts.at(-1) ?? first
  if (last === first) return first.slice(0, 2).toUpperCase()
  return (first.charAt(0) + last.charAt(0)).toUpperCase()
}

/** "3 cards" / "1 card" — avoids the usual "1 cards". */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * A short due date. The wording changes with the distance, because "Fri" is
 * more useful next week and "2 days late" is more useful after the fact.
 */
export function formatDue(due: string, now = new Date()): string {
  const date = new Date(`${due}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  const days = daysBetween(now, date)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${pluralise(Math.abs(days), 'day')} late`
  if (days < 7) return date.toLocaleDateString(LOCALE, { weekday: 'short' })
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}

/** "4 minutes ago", "3 days ago". */
export function relativeTime(iso: string, now = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${pluralise(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${pluralise(hours, 'hour')} ago`
  return `${pluralise(Math.round(hours / 24), 'day')} ago`
}

/** Cut to `max` characters on a word boundary where possible. */
export function truncate(text: string, max = 80): string {
  const clean = text.trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
