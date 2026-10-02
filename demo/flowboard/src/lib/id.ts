const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Ids only have to be unique inside one board, so a timestamp plus five random
 * characters is enough — and it sorts roughly by creation time, which is handy
 * when debugging a saved board.
 */
export function newId(prefix = 'card'): string {
  const stamp = Date.now().toString(36)
  let suffix = ''
  for (let i = 0; i < 5; i += 1) {
    suffix += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length))
  }
  return `${prefix}_${stamp}${suffix}`
}

/** "In review!" -> "in-review". Used for future deep links to a column. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
