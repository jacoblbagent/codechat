/**
 * Persistence for the directory the IDE last had open.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable, which is exactly what
 * IndexedDB stores — and exactly what `localStorage` cannot (it is string-only).
 * Keeping the handle there means a folder the user opened is still known to the
 * next page load: a reload, a Vite HMR reload while this app is being built, or
 * a fresh `dist` build served from the same origin.
 *
 * The handle coming back is not the same thing as the browser letting us *read*
 * it again. Permission is owned by the browser and checked separately with
 * `queryPermission` / `requestPermission` (see `Workspace.permission` and
 * `Workspace.requestPermission`): a granted handle reopens silently, one that
 * has slipped back to `prompt` needs a click, and a refused one is forgotten.
 *
 * Nothing here is required for the app to work — every failure is swallowed and
 * reported as "no remembered folder", because the demo workspace is always a
 * valid fallback and a private-mode browser merely means no memory.
 */

const DB_NAME = 'codechat.fs'
const DB_VERSION = 1
const STORE = 'handles'
const DIR_KEY = 'lastDirectory'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is unavailable'))
    req.onblocked = () => reject(new Error('IndexedDB is blocked'))
  })
}

/** One request against the store, with the connection closed behind it. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
    })
  } finally {
    db.close()
  }
}

/** Remember the directory, so the next load can offer it back. */
export async function saveLastDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(handle, DIR_KEY))
  } catch {
    /* private mode, quota, or a browser that will not clone the handle */
  }
}

/** The remembered directory, or null when there is none (or it cannot be read). */
export async function loadLastDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const value = await withStore<unknown>('readonly', (store) => store.get(DIR_KEY))
    return isDirectoryHandle(value) ? value : null
  } catch {
    return null
  }
}

/** Forget it — used when the folder is gone, or permission was refused. */
export async function clearLastDirectory(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(DIR_KEY))
  } catch {
    /* nothing to do: the entry was already unreachable */
  }
}

/**
 * A stored value is only a directory handle if it survived the structured clone
 * with its kind intact. An older or hand-written entry that did not is ignored.
 */
function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'directory' &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}
