/**
 * Client side of the host filesystem bridge (see `host-fs-server.ts`).
 *
 * When CodeChat is served by its dev server, `/api/host/*` answers for the
 * machine running that server, so a folder there can be opened by path instead
 * of through the browser's picker. Handles below mimic the parts of
 * `FileSystemDirectoryHandle` / `FileSystemFileHandle` the workspace actually
 * uses, which is what lets `Workspace` save through them with no extra code.
 *
 * The bridge only exists while the dev server runs it. `BRIDGE` is folded to
 * `false` by a build, so the bundler drops the fetch, the route string and every
 * caller: a static deploy carries no filesystem code at all, not merely a
 * switched-off button. See scripts/assert-static-clean.mjs, which fails the
 * build if any of it survives.
 */

export interface HostEntry {
  name: string
  path: string
}

export interface HostInfo {
  root: string
  name: string
  home: string
}

export interface HostTree {
  root: string
  name: string
  files: Array<{ path: string; content: string }>
  skipped: number
}

const BASE = ((import.meta.env.BASE_URL as string) ?? '/').replace(/\/+$/, '')
/** Build-time flag: true on the dev server, false in anything built for static hosting. */
const BRIDGE = import.meta.env.DEV
const LAST_KEY = 'codechat.host.v1'

async function request<T>(route: string, init?: RequestInit): Promise<T> {
  if (!BRIDGE) throw new Error('Host folders are only available from the dev server')
  const res = await fetch(`${BASE}/api/host/${route}`, init)
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* not JSON — keep the status text */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

function post<T>(route: string, body: unknown): Promise<T> {
  return request<T>(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Join a host path and a workspace-relative path with single separators. */
export function joinPath(dir: string, rel: string): string {
  const base = dir.replace(/\/+$/, '')
  const tail = rel.replace(/^\/+/, '')
  return tail ? `${base}/${tail}` : base
}

let infoPromise: Promise<HostInfo | null> | null = null

/** The host root, or null when this build has no bridge (static deploy). */
export function hostInfo(): Promise<HostInfo | null> {
  if (!BRIDGE) return Promise.resolve(null)
  if (!infoPromise) {
    infoPromise = request<HostInfo>('info').catch(() => {
      infoPromise = null
      return null
    })
  }
  return infoPromise
}

export async function hostAvailable(): Promise<boolean> {
  return (await hostInfo()) !== null
}

export async function hostList(dir: string): Promise<{ path: string; parent: string | null; entries: HostEntry[] }> {
  return request(`list?path=${encodeURIComponent(dir)}`)
}

/** One request for the whole folder — far quicker than a fetch per file. */
export async function hostTree(dir: string): Promise<HostTree> {
  return request(`tree?path=${encodeURIComponent(dir)}`)
}

export function lastHostPath(): string {
  try {
    return localStorage.getItem(LAST_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberHostPath(path: string): void {
  try {
    if (path) localStorage.setItem(LAST_KEY, path)
  } catch {
    /* private mode — the folder just is not remembered */
  }
}

export function forgetHostPath(): void {
  try {
    localStorage.removeItem(LAST_KEY)
  } catch {
    /* nothing stored */
  }
}

/* ── handles ─────────────────────────────────────────────────── */

class HostFileHandle {
  readonly kind = 'file' as const
  constructor(readonly path: string) {}

  get name(): string {
    return this.path.split('/').pop() || this.path
  }

  async getFile(): Promise<File> {
    if (!BRIDGE) throw new Error('Host folders are only available from the dev server')
    const res = await fetch(`${BASE}/api/host/read?path=${encodeURIComponent(this.path)}`)
    if (!res.ok) throw new Error(`Could not read ${this.name}`)
    return new File([await res.text()], this.name, { type: 'text/plain' })
  }

  /**
   * The editor writes the whole buffer on save, so buffering the chunks and
   * posting them on close is enough — and it keeps a save atomic, one request.
   */
  async createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> {
    let buffer = ''
    return {
      write: async (data: string) => {
        buffer += data
      },
      close: async () => {
        await post('write', { path: this.path, content: buffer })
      },
      abort: async () => {
        buffer = ''
      },
    }
  }
}

class HostDirectoryHandle {
  readonly kind = 'directory' as const
  constructor(readonly path: string) {}

  get name(): string {
    return this.path.split('/').pop() || this.path
  }

  async *values(): AsyncGenerator<HostFileHandle | HostDirectoryHandle> {
    const { entries } = await hostList(this.path)
    for (const entry of entries) yield new HostDirectoryHandle(entry.path)
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<HostDirectoryHandle> {
    const child = joinPath(this.path, name)
    if (options?.create) await post('mkdir', { path: child })
    return new HostDirectoryHandle(child)
  }

  async getFileHandle(name: string): Promise<HostFileHandle> {
    return new HostFileHandle(joinPath(this.path, name))
  }

  async removeEntry(name: string): Promise<void> {
    throw new Error(`Deleting ${name} is not supported by the host bridge`)
  }
}

/** A directory handle for a folder on the host. */
export function hostDirectoryHandle(path: string): FileSystemDirectoryHandle {
  return new HostDirectoryHandle(path) as unknown as FileSystemDirectoryHandle
}

/**
 * The host path a directory handle stands for, or '' when it did not come from
 * the bridge (a picked folder, or a static build where none of this exists).
 * A refresh has to tell the two apart: the bridge re-reads over HTTP, a picked
 * folder is walked through its own handle.
 */
export function hostRootOf(handle: FileSystemDirectoryHandle | null): string {
  return handle instanceof HostDirectoryHandle ? handle.path : ''
}

/** A file handle for a file on the host — saving through it writes to disk. */
export function hostFileHandle(path: string): FileSystemFileHandle {
  return new HostFileHandle(path) as unknown as FileSystemFileHandle
}
