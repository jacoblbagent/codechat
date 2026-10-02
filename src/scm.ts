/**
 * Staging area and commit history for the Source Control panel.
 *
 * This is **not** git. A static site in a browser tab has no repository to talk
 * to, and writing real git objects needs an index, packfiles and refs — a
 * project of its own. What a browser IDE can honestly offer is the *workflow*:
 * a change list, a staging area that decides what goes into a commit, commit
 * records with a message and a snapshot of the files they captured, and the
 * ability to look one up and put a file back. That is what this is.
 *
 * Committing a file also makes the committed content its new baseline (and, for
 * a real folder, writes it out first — see `commitScm` in main.ts), so a commit
 * leaves the files it covered clean and its snapshot is what was written.
 */

export interface CommitFile {
  path: string
  /** The file's full content at the moment of the commit. */
  content: string
}

export interface Commit {
  /** Short revision id derived from the message, time and files. Not a git SHA. */
  id: string
  message: string
  at: number
  files: CommitFile[]
}

const KEY = 'codechat.scm.v1'
/** Newest commits kept per workspace. */
const MAX_COMMITS = 30
/** Workspaces kept in storage, most recently used first. */
const MAX_ROOTS = 3

interface RootState {
  commits: Commit[]
  staged: string[]
}

interface Stored {
  order: string[]
  roots: Record<string, RootState>
}

/** FNV-1a over the message, time and contents — short, stable, not crypto. */
export function revisionId(message: string, at: number, files: CommitFile[]): string {
  let hash = 0x811c9dc5
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  feed(message)
  feed(String(at))
  for (const file of files) {
    feed(file.path)
    feed(file.content)
  }
  return hash.toString(16).padStart(8, '0')
}

export class Repo {
  /** The workspace root these commits belong to. */
  root = ''
  commits: Commit[] = []
  /** Paths marked for the next commit. */
  private staged = new Set<string>()
  private store: Stored = { order: [], roots: {} }
  private loaded = false

  /* ── storage ──────────────────────────────────────────────── */

  private load(): void {
    this.loaded = true
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Stored
      if (!parsed || typeof parsed !== 'object' || !parsed.roots) return
      this.store = {
        order: Array.isArray(parsed.order) ? parsed.order.filter((r) => typeof r === 'string') : [],
        roots: parsed.roots,
      }
    } catch {
      /* a corrupt entry is not worth a crash — start clean */
    }
  }

  /** Point the repo at a workspace, restoring its history and staging. */
  reset(root: string): void {
    if (!this.loaded) this.load()
    this.root = root
    const state = this.store.roots[root]
    this.commits = Array.isArray(state?.commits) ? state.commits.filter(isCommit) : []
    this.staged = new Set(Array.isArray(state?.staged) ? state.staged.filter((p) => typeof p === 'string') : [])
  }

  private persist(): void {
    if (!this.root) return
    this.store.roots[this.root] = { commits: this.commits, staged: [...this.staged] }
    this.store.order = [this.root, ...this.store.order.filter((r) => r !== this.root)].slice(0, MAX_ROOTS)
    for (const drop of Object.keys(this.store.roots)) {
      if (!this.store.order.includes(drop)) delete this.store.roots[drop]
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.store))
    } catch {
      // Over quota: keep the history's head rather than none of it.
      try {
        this.store.roots[this.root] = { commits: this.commits.slice(0, 5), staged: [...this.staged] }
        this.store.order = [this.root]
        this.store.roots = { [this.root]: this.store.roots[this.root] }
        localStorage.setItem(KEY, JSON.stringify(this.store))
      } catch {
        /* private mode — the history lives for this tab only */
      }
    }
  }

  /* ── staging ──────────────────────────────────────────────── */

  isStaged(path: string): boolean {
    return this.staged.has(path)
  }

  /** Drop staged paths that are no longer changed (after a save or discard). */
  pruneStaged(changed: string[]): void {
    const live = new Set(changed)
    let dropped = false
    for (const path of [...this.staged]) {
      if (!live.has(path)) {
        this.staged.delete(path)
        dropped = true
      }
    }
    if (dropped) this.persist()
  }

  stage(paths: string[]): void {
    for (const path of paths) this.staged.add(path)
    this.persist()
  }

  unstage(paths: string[]): void {
    for (const path of paths) this.staged.delete(path)
    this.persist()
  }

  /* ── commits ──────────────────────────────────────────────── */

  /**
   * Record a commit. Returns null when it would be empty — a commit with no
   * message or no files is not a commit.
   */
  commit(message: string, files: CommitFile[]): Commit | null {
    const text = message.trim()
    if (!text || !files.length) return null

    const at = Date.now()
    const commit: Commit = { id: revisionId(text, at, files), message: text, at, files }
    this.commits.unshift(commit)
    if (this.commits.length > MAX_COMMITS) this.commits.length = MAX_COMMITS
    for (const file of files) this.staged.delete(file.path)
    this.persist()
    return commit
  }

  /** The content a commit captured for a path, if it captured one. */
  contentIn(commit: Commit, path: string): string | undefined {
    return commit.files.find((f) => f.path === path)?.content
  }

  find(id: string): Commit | undefined {
    return this.commits.find((c) => c.id === id)
  }
}

function isCommit(value: unknown): value is Commit {
  if (!value || typeof value !== 'object') return false
  const c = value as Commit
  return (
    typeof c.id === 'string' &&
    typeof c.message === 'string' &&
    typeof c.at === 'number' &&
    Array.isArray(c.files) &&
    c.files.every((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
  )
}

/** `4 min ago` — enough precision for a commit list. */
export function fmtAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
