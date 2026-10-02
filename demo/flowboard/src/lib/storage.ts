/**
 * localStorage, namespaced and JSON-encoded, with an in-memory fallback so the
 * board still works in a private window.
 */

const PREFIX = 'flowboard'

const memory = new Map<string, string>()

export const BOARD_KEY: string =
  import.meta.env.VITE_BOARD_STORAGE_KEY ?? `${PREFIX}.board.v1`

function backend(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const probe = `${PREFIX}.probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    }
  }
}

export function available(): boolean {
  return backend() === window.localStorage
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = backend().getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    // A corrupt board should not take the app down with it.
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    backend().setItem(key, JSON.stringify(value))
  } catch {
    // Quota, or a private window. Losing the save is better than losing the tab.
  }
}

export function remove(key: string): void {
  backend().removeItem(key)
}
