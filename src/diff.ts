/**
 * Line-diff statistics.
 *
 * The Source Control panel shows a change like VS Code does — `+12 −3` — so it
 * has to know how many lines a file gained and lost. This counts them; it does
 * not build hunks, because nothing here renders a diff view.
 */

export interface DiffStat {
  added: number
  removed: number
}

/** Above this many cells the LCS table is not worth building per keystroke. */
const LCS_CELL_CAP = 1_000_000

/** `''` is zero lines, not one empty line. */
function lines(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

/**
 * Length of the longest common subsequence of two line arrays, using the
 * classic two-row table: O(n·m) time, O(min) memory.
 */
function lcsLength(a: string[], b: string[]): number {
  let prev = new Uint32Array(b.length + 1)
  let cur = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    const swap = prev
    prev = cur
    cur = swap
  }
  return prev[b.length]
}

/**
 * The cheap fallback for files too big to align: how many lines in `after` are
 * not accounted for by the lines in `before`, and how many are left over. Line
 * order is ignored, so a block that merely moved reads as unchanged — which is
 * the right trade at this size.
 */
function multisetStat(before: string[], after: string[]): DiffStat {
  const counts = new Map<string, number>()
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1)

  let added = 0
  for (const line of after) {
    const left = counts.get(line) ?? 0
    if (left > 0) counts.set(line, left - 1)
    else added += 1
  }

  let removed = 0
  for (const left of counts.values()) removed += left
  return { added, removed }
}

export function diffStat(before: string, after: string): DiffStat {
  if (before === after) return { added: 0, removed: 0 }
  const a = lines(before)
  const b = lines(after)
  if (!a.length) return { added: b.length, removed: 0 }
  if (!b.length) return { added: 0, removed: a.length }

  if (a.length * b.length > LCS_CELL_CAP) return multisetStat(a, b)

  const common = lcsLength(a, b)
  return { added: b.length - common, removed: a.length - common }
}
