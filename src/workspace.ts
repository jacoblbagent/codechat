/**
 * Workspace layer.
 *
 * Two modes:
 *  - demo: a small in-memory starter project (always available)
 *  - real: a local directory opened via the File System Access API
 *          (Chrome/Edge). Files are read on demand and written back with Ctrl+S.
 */

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

const DEMO_FILES: Array<{ path: string; content: string }> = [
  {
    path: 'src/greeting.ts',
    content: `/**
 * Small starter module — ask DeepSeek in the right-hand panel to
 * refactor it, add tests, or fix the TODOs.
 */

export interface GreetingOptions {
  name: string
  excited?: boolean
  locale?: string
}

export function greet(options: GreetingOptions): string {
  const { name, excited = false, locale = 'en-US' } = options

  // TODO: use Intl to localise the salutation instead of hardcoding English.
  const salutation = 'Hello'

  const suffix = excited ? '!' : '.'
  return \`\${salutation}, \${name}\${suffix}\`
}

export function greetAll(names: string[]): string[] {
  return names.map((n) => greet({ name: n }))
}
`,
  },
  {
    path: 'src/app.ts',
    content: `import { greetAll } from './greeting'

const team = ['Ada', 'Grace', 'Alan']

const list = document.createElement('ul')

for (const line of greetAll(team)) {
  const item = document.createElement('li')
  item.textContent = line
  list.appendChild(item)
}

document.body.appendChild(list)
`,
  },
  {
    path: 'src/main.css',
    content: `:root {
  --bg: #101014;
  --fg: #e8e8ea;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, sans-serif;
  display: grid;
  place-items: center;
  min-height: 100vh;
}
`,
  },
  {
    path: 'package.json',
    content: `{
  "name": "demo-workspace",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/app.ts"
  }
}
`,
  },
  {
    path: 'README.md',
    content: `# Demo workspace

This is the in-memory starter project CodeChat ships with, so the editor and
the chat panel have something real to talk about.

- **Open Folder** loads a real directory from your machine (Chrome / Edge).
- Ask the assistant on the right to explain, refactor, or test any file.
- \`Ctrl+Alt+C\` toggles the chat panel; \`Ctrl+P\` is quick open.
`,
  },
]

export class Workspace {
  rootName = 'demo-workspace'
  isRealDirectory = false
  files = new Map<string, WsFile>()
  /** Directories the user has collapsed in the explorer. */
  private collapsed = new Set<string>()
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
    this.rootName = 'demo-workspace'
    this.isRealDirectory = false
    this.collapsed.clear()
    this.files.clear()
    for (const f of DEMO_FILES) this.put(f.path, f.content)
    this.emit()
  }

  /** True when the browser can open a real directory. */
  static canOpenDirectory(): boolean {
    return typeof (window as any).showDirectoryPicker === 'function'
  }

  async openDirectory(): Promise<{ opened: number; skipped: number }> {
    const picker = (window as any).showDirectoryPicker
    if (typeof picker !== 'function') {
      throw new Error('This browser cannot open folders. Use Chrome or Edge, or drag files in.')
    }
    const dir: any = await picker.call(window, { mode: 'readwrite', id: 'codechat' })

    this.files.clear()
    this.collapsed.clear()
    this.rootName = dir.name || 'workspace'
    this.isRealDirectory = true

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
    return { opened, skipped }
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
