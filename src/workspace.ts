/**
 * Workspace layer.
 *
 * Two modes:
 *  - demo: an in-memory starter project — see `demo.ts`, which carries a React
 *          Kanban board as text (always available)
 *  - real: a local directory opened via the File System Access API
 *          (Chrome/Edge). Files are read on demand and written back with Ctrl+S.
 */

import { DEMO_FILES, DEMO_ROOT_NAME } from './demo'

export interface WsFile {
  path: string
  name: string
  content: string
  /** Content as last read from / written to disk — the dirty-diff baseline. */
  original: string
  /** FileSystemFileHandle when this came from a real directory. */
  handle?: FileSystemFileHandle
  binary?: boolean
}

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children: TreeNode[]
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'mov', 'webm', 'mkv', 'avi',
  'zip', 'gz', 'tar', 'rar', '7z', 'bz2', 'xz',
  'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class', 'jar',
  'db', 'sqlite', 'sqlite3', 'lock', 'pyc',
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv',
  'venv', '__pycache__', '.cache', 'coverage', '.turbo', '.gradle',
])

const MAX_BYTES = 512 * 1024

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

function isBinaryName(name: string): boolean {
  return BINARY_EXT.has(ext(name))
}

export class Workspace {
  rootName = DEMO_ROOT_NAME
  isRealDirectory = false
  files = new Map<string, WsFile>()
  /** The open directory, when there is one, so folders can be created on disk. */
  rootHandle: FileSystemDirectoryHandle | null = null
  /** Directories the user has collapsed in the explorer. */
  private collapsed = new Set<string>()
  /**
   * Directories that contain no files. The tree is derived from file paths, so
   * without this a folder the user just made would vanish from it.
   */
  private emptyDirs = new Set<string>()
  private listeners: Array<() => void> = []

  /* ── events ───────────────────────────────────────────────── */
  onChange(fn: () => void): void {
    this.listeners.push(fn)
  }
  emit(): void {
    for (const fn of this.listeners) fn()
  }

  /* ── loading ──────────────────────────────────────────────── */
  loadDemo(): void {
    this.rootName = DEMO_ROOT_NAME
    this.isRealDirectory = false
    this.rootHandle = null
    this.collapsed.clear()
    this.emptyDirs.clear()
    this.files.clear()
    for (const f of DEMO_FILES) this.put(f.path, f.content)
    this.emit()
  }

  /** True when the browser can open a real directory. */
  static canOpenDirectory(): boolean {
    return typeof (window as any).showDirectoryPicker === 'function'
  }

  /**
   * The permission the browser is currently holding for a directory handle —
   * 'granted', 'prompt' (a click can ask again) or 'denied'. A browser without
   * the permission methods (the fallback `<input type=file>` path) is treated
   * as granted, because there is nothing to ask.
   */
  static async permission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    const h = handle as any
    if (typeof h.queryPermission !== 'function') return 'granted'
    try {
      return (await h.queryPermission({ mode: 'readwrite' })) as PermissionState
    } catch {
      return 'denied'
    }
  }

  /**
   * Ask for it. Only ever valid from inside a user gesture — the browser throws
   * or silently resolves to 'prompt' otherwise — which is why a restored folder
   * that is no longer granted is offered as a toast button rather than reopened
   * by itself.
   */
  static async requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    const h = handle as any
    if (typeof h.requestPermission !== 'function') return 'granted'
    try {
      return (await h.requestPermission({ mode: 'readwrite' })) as PermissionState
    } catch {
      return 'denied'
    }
  }

  /**
   * Open a directory. With no argument the picker is shown; with a remembered
   * handle (a previous session's folder) the picker is skipped and that folder
   * is walked again — so restoring and opening share one code path, and a
   * restored folder is read exactly as freshly as a chosen one.
   */
  async openDirectory(
    existing?: FileSystemDirectoryHandle,
  ): Promise<{ handle: FileSystemDirectoryHandle; opened: number; skipped: number }> {
    let dir: FileSystemDirectoryHandle
    if (existing) {
      dir = existing
    } else {
      const picker = (window as any).showDirectoryPicker
      if (typeof picker !== 'function') {
        throw new Error('This browser cannot open folders. Use Chrome or Edge, or drag files in.')
      }
      dir = (await picker.call(window, { mode: 'readwrite', id: 'codechat' })) as FileSystemDirectoryHandle
    }

    this.files.clear()
    this.collapsed.clear()
    this.emptyDirs.clear()
    this.rootName = dir.name || 'workspace'
    this.isRealDirectory = true
    this.rootHandle = dir

    let opened = 0
    let skipped = 0
    const walk = async (handle: any, prefix: string): Promise<void> => {
      for await (const entry of handle.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.kind === 'directory') {
          if (SKIP_DIRS.has(entry.name)) {
            skipped++
            continue
          }
          await walk(entry, path)
        } else {
          if (isBinaryName(entry.name)) {
            this.putBinary(path, entry)
            skipped++
            continue
          }
          try {
            const file = await entry.getFile()
            if (file.size > MAX_BYTES) {
              this.putBinary(path, entry, file.size)
              skipped++
              continue
            }
            const content = await file.text()
            this.put(path, content, entry)
            opened++
          } catch {
            skipped++
          }
        }
      }
    }
    await walk(dir, '')
    this.emit()
    return { handle: dir, opened, skipped }
  }

  /** Fallback for browsers without the picker: <input type=file> / drag-drop. */
  async addFiles(list: FileList | File[]): Promise<number> {
    const arr = Array.from(list)
    if (arr.length && !this.isRealDirectory && this.files.size <= DEMO_FILES.length) {
      // First real files replace the demo set.
      this.files.clear()
      this.collapsed.clear()
      this.rootName = (arr[0] as any).webkitRelativePath?.split('/')[0] || 'workspace'
    }
    let n = 0
    for (const file of arr) {
      const rel = (file as any).webkitRelativePath || file.name
      if (isBinaryName(file.name) || file.size > MAX_BYTES) {
        this.putBinary(rel, undefined, file.size)
        continue
      }
      this.put(rel, await file.text())
      n++
    }
    this.emit()
    return n
  }

  private put(path: string, content: string, handle?: FileSystemFileHandle): void {
    this.files.set(path, {
      path,
      name: path.split('/').pop()!,
      content,
      original: content,
      handle,
    })
  }

  private putBinary(path: string, handle?: FileSystemFileHandle, size?: number): void {
    this.files.set(path, {
      path,
      name: path.split('/').pop()!,
      content: '',
      original: '',
      handle,
      binary: true,
    })
    void size
  }

  /* ── accessors ────────────────────────────────────────────── */
  get(path: string): WsFile | undefined {
    return this.files.get(path)
  }

  paths(): string[] {
    return [...this.files.keys()].sort((a, b) => a.localeCompare(b))
  }

  isDirty(path: string): boolean {
    const f = this.files.get(path)
    return !!f && f.content !== f.original
  }

  /** Persist a file back to disk when it has a handle. */
  async save(path: string, content: string): Promise<'disk' | 'memory'> {
    const f = this.files.get(path)
    if (!f) return 'memory'
    f.content = content
    if (f.handle) {
      const w = await (f.handle as any).createWritable()
      await w.write(content)
      await w.close()
      f.original = content
      this.emit()
      return 'disk'
    }
    // In-memory workspace: treat save as committing the buffer.
    f.original = content
    this.emit()
    return 'memory'
  }

  create(path: string, content = ''): void {
    const normalised = path.replace(/^\/+/, '').trim()
    if (!normalised) throw new Error('A file name is required.')
    this.put(normalised, content)
    // Reveal every ancestor directory.
    const parts = normalised.split('/')
    parts.pop()
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p
      this.collapsed.delete(acc)
    }
    this.emit()
  }

  /**
   * Make a directory.
   *
   * Two things make this more than a `mkdir` call. The tree is built from file
   * paths, so an empty folder has to be remembered separately or it disappears
   * the instant it is created; and when a real directory is open the folder is
   * made on disk as well, so the next walk of the handle finds it.
   */
  async createFolder(path: string): Promise<'disk' | 'memory'> {
    const normalised = path.replace(/^\/+|\/+$/g, '').trim()
    if (!normalised) throw new Error('A folder name is required.')
    if (this.files.has(normalised)) throw new Error(`${normalised} is already a file.`)
    const prefix = `${normalised}/`
    for (const existing of this.files.keys()) {
      if (existing.startsWith(prefix)) throw new Error(`${normalised} already exists.`)
    }

    this.emptyDirs.add(normalised)
    // Reveal the folder and every ancestor of it.
    const parts = normalised.split('/')
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      this.collapsed.delete(acc)
    }

    if (this.rootHandle) {
      try {
        let dir: any = this.rootHandle
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
        this.emit()
        return 'disk'
      } catch (err) {
        this.emptyDirs.delete(normalised)
        throw new Error(`Could not create the folder on disk: ${(err as Error).message}`)
      }
    }

    this.emit()
    return 'memory'
  }

  toggleDir(path: string): void {
    if (this.collapsed.has(path)) this.collapsed.delete(path)
    else this.collapsed.add(path)
    this.emit()
  }

  isCollapsed(path: string): boolean {
    return this.collapsed.has(path)
  }

  /* ── tree ─────────────────────────────────────────────────── */
  tree(): TreeNode[] {
    const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] }
    const dirIndex = new Map<string, TreeNode>([['', root]])

    for (const path of this.paths()) {
      const parts = path.split('/')
      let parent = root
      let acc = ''
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i]
        acc = acc ? `${acc}/${name}` : name
        const isLast = i === parts.length - 1
        if (isLast) {
          parent.children.push({ name, path: acc, kind: 'file', children: [] })
        } else {
          let dir = dirIndex.get(acc)
          if (!dir) {
            dir = { name, path: acc, kind: 'dir', children: [] }
            dirIndex.set(acc, dir)
            parent.children.push(dir)
          }
          parent = dir
        }
      }
    }

    // Folders with nothing in them yet — they have no file path to be derived
    // from, so they are added by hand.
    for (const dir of this.emptyDirs) {
      const parts = dir.split('/')
      let parent = root
      let acc = ''
      for (const name of parts) {
        acc = acc ? `${acc}/${name}` : name
        let node = dirIndex.get(acc)
        if (!node) {
          node = { name, path: acc, kind: 'dir', children: [] }
          dirIndex.set(acc, node)
          parent.children.push(node)
        }
        parent = node
      }
    }

    const sort = (nodes: TreeNode[]): void => {
      nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true })
      })
      for (const n of nodes) sort(n.children)
    }
    sort(root.children)
    return root.children
  }

  /* ── search ───────────────────────────────────────────────── */
  search(query: string, limit = 200): SearchHit[] {
    const needle = query.trim()
    if (!needle) return []
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const hits: SearchHit[] = []
    for (const f of this.files.values()) {
      if (f.binary || !f.content) continue
      const lines = f.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        if (re.test(lines[i])) {
          hits.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 200) })
          if (hits.length >= limit) return hits
        }
      }
    }
    return hits
  }
}
