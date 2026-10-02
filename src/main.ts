import './styles.css'
import { ChatPanel, type ChatStatus } from './chat'
import { DEFAULT_MODEL, type ReasoningEffort } from './deepseek'
import {
  defineTheme,
  editorOptions,
  fileIcon,
  folderIcon,
  languageFor,
  languageLabel,
  monaco,
  setMonacoTheme,
  type ThemeName,
  uriFor,
} from './monaco'
import { CreditsRow } from './credits-ui'
import { diffStat, type DiffStat } from './diff'
import { ModelPicker } from './model-picker'
import { fmtAgo, Repo, type Commit, type CommitFile } from './scm'
import { buildMonacoOptions, defaultCore, settingById, type SettingDef } from './settings'
import { SettingsPage } from './settings-ui'
import { Workspace, type SearchHit, type WsFile } from './workspace'

/* ══════════════════════════════════════════════════════════════
   Settings + UI state (localStorage only — nothing leaves the browser)
   ══════════════════════════════════════════════════════════════ */

interface Settings {
  apiKey: string
  model: string
  reasoning: ReasoningEffort
  /** VS Code core settings, keyed by their dotted id (e.g. 'editor.fontSize'). */
  core: Record<string, unknown>
}

interface UiState {
  chatCollapsed: boolean
  sidebarCollapsed: boolean
  chatWidth: number
  sidebarWidth: number
  theme: ThemeName
}

const SETTINGS_KEY = 'codechat.settings.v1'
const UI_KEY = 'codechat.ui.v1'

const ENV_KEY = (import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined) ?? ''

const REASONING_LEVELS: ReasoningEffort[] = ['off', 'low', 'medium', 'high']

function loadSettings(): Settings {
  const fallback: Settings = { apiKey: ENV_KEY, model: DEFAULT_MODEL, reasoning: 'off', core: {} }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    const merged = { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) }
    if (!REASONING_LEVELS.includes(merged.reasoning)) merged.reasoning = 'off'
    // Anything unknown is dropped, so a stale or hand-edited entry can never
    // reach the editor options; anything missing falls back to the catalogue.
    merged.core = { ...defaultCore(), ...(merged.core ?? {}) }
    return merged
  } catch {
    return fallback
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* private mode — keep it in memory */
  }
}

/* ── Files: save-time rewrites and auto save ──────────────────
   Declared up here because the editor's content-change handler (registered
   when the editor is created) calls scheduleAutoSave on every keystroke. */

let autoSaveTimer: number | null = null
let autoSaveWarned = false

/** Rewrites applied to the buffer on save, in VS Code's order. */
function applySaveTransforms(text: string): string {
  let out = text
  if (coreBool('files.trimTrailingWhitespace')) out = out.replace(/[ \t]+$/gm, '')
  if (coreBool('files.trimFinalNewlines')) out = out.replace(/\n+$/, '')
  if (coreBool('files.insertFinalNewline') && !out.endsWith('\n')) out += '\n'
  return out
}

function scheduleAutoSave(): void {
  if (autoSaveTimer !== null) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (coreValue('files.autoSave') !== 'afterDelay') return
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null
    void runAutoSave()
  }, coreNumber('files.autoSaveDelay', 1000))
}

/**
 * Auto save only means anything against a real directory on disk — the built-in
 * demo workspace has no files to write, so this is a no-op there.
 */
async function runAutoSave(): Promise<void> {
  const path = activePath
  if (!workspace.isRealDirectory || !path) return
  const file = workspace.get(path)
  const model = editor.getModel()
  if (!file?.handle || file.binary || !model) return
  if (!workspace.isDirty(path)) return
  try {
    await savePath(path)
    autoSaveWarned = false
    renderTabs()
    renderTree()
    renderScm()
  } catch (err) {
    // Never spam: one toast until a save succeeds again. Ctrl+S still reports.
    if (!autoSaveWarned) {
      autoSaveWarned = true
      toast(`Auto save failed: ${(err as Error).message}`, 'err')
    }
  }
}

/**
 * The theme the pre-paint script in index.html already resolved. Reading it
 * back avoids a second, possibly different, decision on first load.
 *
 * One Dark Pro (dark) is the default; light is only used once chosen.
 */
function initialTheme(): ThemeName {
  const preset = document.documentElement.dataset.theme
  return preset === 'light' ? 'light' : 'dark'
}

function loadUi(): UiState {
  const fallback: UiState = {
    chatCollapsed: false,
    sidebarCollapsed: false,
    chatWidth: 400,
    sidebarWidth: 240,
    theme: initialTheme(),
  }
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<UiState>) }
  } catch {
    return fallback
  }
}

function saveUi(u: UiState): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(u))
  } catch {
    /* ignore */
  }
}

/* ══════════════════════════════════════════════════════════════
   Element handles
   ══════════════════════════════════════════════════════════════ */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const els = {
  body: document.querySelector('.body') as HTMLElement,
  tree: $('tree'),
  tabs: $('tabs'),
  editorHost: $('editor'),
  welcome: $('welcome'),
  wsName: $('ws-name'),
  searchInput: $<HTMLInputElement>('search-input'),
  searchResults: $('search-results'),
  quickOpen: $('quick-open'),
  quickInput: $<HTMLInputElement>('quick-input'),
  quickList: $('quick-list'),
  toasts: $('toasts'),
  chatResizer: $('chat-resizer'),
  scrim: $('scrim'),
  btnToggleRight: $('btn-toggle-right'),
  btnTheme: $('btn-theme'),
  sbPos: $('sb-pos'),
  sbIndent: $('sb-indent'),
  sbLang: $('sb-lang'),
  sbProblems: $('sb-problems'),
  sbAi: $('sb-ai'),
  sbBranchName: $('sb-branch-name'),
  scmList: $('scm-list'),
  scmEmpty: $('scm-empty'),
  scmMessage: $<HTMLTextAreaElement>('scm-message'),
  scmCommit: $<HTMLButtonElement>('btn-scm-commit'),
  scmCommitNote: $('scm-commit-note'),
  thinkSelect: $<HTMLSelectElement>('think-select'),
  btnSettings: $('btn-open-settings'),
  chatDot: $('chat-dot'),
}

/* ══════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════ */

const workspace = new Workspace()
let settings = loadSettings()
const ui = loadUi()

let openTabs: string[] = []
let activePath: string | null = null
const models = new Map<string, monaco.editor.ITextModel>()

/* ══════════════════════════════════════════════════════════════
   Toasts
   ══════════════════════════════════════════════════════════════ */

/** Fade a toast out and drop it — safe to call twice (auto-dismiss vs the ×). */
function dismissToast(el: HTMLElement): void {
  if (el.dataset.closing) return
  el.dataset.closing = '1'
  el.style.opacity = '0'
  el.style.transition = 'opacity .2s'
  setTimeout(() => el.remove(), 220)
}

function toast(message: string, kind: 'ok' | 'err' | 'info' = 'info', ms = 3200): void {
  const el = document.createElement('div')
  el.className = `toast${kind === 'err' ? ' is-err' : kind === 'ok' ? ' is-ok' : ''}`

  const text = document.createElement('span')
  text.className = 'toast-msg'
  text.textContent = message

  const close = document.createElement('button')
  close.className = 'toast-x'
  close.type = 'button'
  close.title = 'Dismiss'
  close.setAttribute('aria-label', 'Dismiss notification')
  close.textContent = '×'
  close.addEventListener('click', () => dismissToast(el))

  el.append(text, close)
  els.toasts.appendChild(el)
  setTimeout(() => dismissToast(el), ms)
}

/* ══════════════════════════════════════════════════════════════
   Monaco editor
   ══════════════════════════════════════════════════════════════ */

defineTheme()

// The catalogue supplies every editor option the settings page can change, and
// it ships this app's own defaults, so it is spread over editorOptions().
const initialOptions = {
  ...editorOptions(),
  ...monacoCoreOptions(),
  model: null,
  value: '',
} as unknown as monaco.editor.IStandaloneEditorConstructionOptions

const editor = monaco.editor.create(els.editorHost, initialOptions)

// Ctrl+L with code highlighted: attach that chunk to the chat as context.
// Bound on the editor so it fires with focus inside Monaco, and so it wins over
// the editor's own Ctrl+L (expandLineSelection) and Ctrl+Shift+L
// (selectHighlights). Ctrl+Shift+L is the fallback for when the browser claims
// Ctrl+L for its address bar — it is the one chord no mainstream browser wants.
for (const chord of [
  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL,
  monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL,
]) {
  editor.addCommand(chord, () => attachSelectionToChat())
}

// A browser IDE has no node_modules or tsconfig, so semantic checks would
// report phantom errors ("cannot find name 'console'"). Syntax validation stays
// on — it still flags real mistakes — and suggestion diagnostics are off so the
// status bar only reports genuine problems.
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true)
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true,
})
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true,
})

editor.onDidChangeCursorPosition((e) => {
  els.sbPos.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`
})

editor.onDidChangeCursorSelection(() => {
  if (chat) chat.refreshContextViz()
})

editor.onDidChangeModelContent(() => {
  const path = currentModelPath()
  if (!path) return
  const model = editor.getModel()
  if (!model) return
  const file = workspace.get(path)
  if (!file || file.binary) return
  file.content = model.getValue()
  renderTabs()
  renderTree()
  renderScm()
  if (chat) chat.refreshContextViz()
  scheduleAutoSave()
})

monaco.editor.onDidChangeMarkers((uris) => {
  let total = 0
  let errors = 0
  for (const uri of monaco.editor.getModels()) {
    if (uri.isDisposed()) continue
    const markers = monaco.editor.getModelMarkers({ resource: uri.uri })
    total += markers.length
    errors += markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length
  }
  void uris
  els.sbProblems.textContent = total
    ? `${errors} error${errors === 1 ? '' : 's'}, ${total} problem${total === 1 ? '' : 's'}`
    : '0 problems'
  els.sbProblems.title = total ? 'Syntax problems in open files (semantic analysis is off)' : 'No problems detected'
})

function currentModelPath(): string | null {
  return activePath
}

function modelFor(path: string, content: string): monaco.editor.ITextModel {
  let model = models.get(path)
  if (model && !model.isDisposed()) return model
  model = monaco.editor.createModel(content, languageFor(path), uriFor(path))
  models.set(path, model)
  return model
}

/* ══════════════════════════════════════════════════════════════
   Source Control — changes, staging, commits, history
   ══════════════════════════════════════════════════════════════

   A static browser IDE has no repository to talk to, so this does not pretend to
   be git — `src/scm.ts` says exactly what a commit is here and what it is not.
   What the panel can honour is the workflow around it: which files have moved
   away from their last saved or committed content, which of those are staged for
   the next commit, the commit itself, and the history of what was committed. */

const repo = new Repo()
/** Commit ids whose file list is open. Kept outside the DOM: the list is
 *  rebuilt on every keystroke in the editor. */
const expandedCommits = new Set<string>()

function scmChangedFiles(): WsFile[] {
  const out: WsFile[] = []
  for (const file of workspace.files.values()) {
    if (!file.binary && workspace.isDirty(file.path)) out.push(file)
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

interface ScmChange {
  file: WsFile
  /** How much the file moved, for VS Code's +12 −3 gutter. */
  stat: DiffStat
}

function scmChanges(): ScmChange[] {
  return scmChangedFiles().map((file) => ({ file, stat: diffStat(file.original, file.content) }))
}

/** Keep the repo pointed at the open workspace, and forget staging that went stale. */
function syncRepo(changed: WsFile[]): void {
  if (repo.root !== workspace.rootName) repo.reset(workspace.rootName)
  repo.pruneStaged(changed.map((f) => f.path))
}

/**
 * Write new content into a file's buffer. Goes through `executeEdits` when the
 * model is open so the change joins the undo stack, the same way discard does.
 */
function scmWriteBuffer(path: string, content: string, label: string): void {
  const model = models.get(path)
  if (model && !model.isDisposed()) {
    editor.pushUndoStop()
    editor.executeEdits(label, [{ range: model.getFullModelRange(), text: content }])
    editor.pushUndoStop()
  }
  const file = workspace.get(path)
  if (file) file.content = content
}

/* ── rows ─────────────────────────────────────────────────── */

function scmSection(title: string, count: number): HTMLElement {
  const head = document.createElement('div')
  head.className = 'scm-section'
  const label = document.createElement('span')
  label.className = 'scm-section-title'
  label.textContent = title
  const badge = document.createElement('span')
  badge.className = 'scm-section-count'
  badge.textContent = String(count)
  head.append(label, badge)
  return head
}

function scmSectionAction(parent: HTMLElement, label: string, title: string, act: string): void {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'mini-btn scm-section-action'
  btn.dataset.scmBulk = act
  btn.title = title
  btn.setAttribute('aria-label', title)
  btn.textContent = label
  parent.appendChild(btn)
}

function scmRow(change: ScmChange, staged: boolean): HTMLElement {
  const { file, stat } = change
  const row = document.createElement('div')
  row.className = 'scm-file'
  row.dataset.path = file.path
  row.title = file.path

  const mark = document.createElement('span')
  mark.className = 'scm-mark'
  mark.textContent = 'M'
  mark.title = 'Modified'

  const icon = document.createElement('span')
  icon.className = 'row-icon'
  icon.innerHTML = fileIcon(file.name)

  const name = document.createElement('span')
  name.className = 'scm-name'
  name.textContent = file.name

  const dir = document.createElement('span')
  dir.className = 'scm-dir'
  const cut = file.path.lastIndexOf('/')
  dir.textContent = cut > 0 ? file.path.slice(0, cut + 1) : ''

  const statEl = document.createElement('span')
  statEl.className = 'scm-stat'
  statEl.title = `${stat.added} line${stat.added === 1 ? '' : 's'} added, ${stat.removed} removed`
  if (stat.added) {
    const add = document.createElement('b')
    add.textContent = `+${stat.added}`
    statEl.appendChild(add)
  }
  if (stat.removed) {
    const del = document.createElement('i')
    del.textContent = `\u2212${stat.removed}`
    statEl.appendChild(del)
  }

  const actions = document.createElement('span')
  actions.className = 'scm-actions'
  const buttons: Array<[string, string, string]> = [
    staged
      ? ['unstage', '\u2212', `Unstage ${file.name}`]
      : ['stage', '+', `Stage ${file.name} for the next commit`],
    ['save', '\u2713', `Save ${file.name}`],
    ['discard', '\u21ba', `Discard changes in ${file.name}`],
  ]
  for (const [act, glyph, title] of buttons) {
    const btn = document.createElement('button')
    btn.className = 'mini-btn'
    btn.dataset.scm = act
    btn.title = title
    btn.setAttribute('aria-label', title)
    btn.textContent = glyph
    actions.appendChild(btn)
  }

  row.append(mark, icon, name, dir, statEl, actions)
  return row
}

function scmCommitRow(commit: Commit): HTMLElement {
  const open = expandedCommits.has(commit.id)
  const row = document.createElement('div')
  row.className = open ? 'scm-commit-entry is-open' : 'scm-commit-entry'
  row.dataset.commit = commit.id

  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'scm-commit-head'
  head.dataset.commitToggle = commit.id
  head.setAttribute('aria-expanded', String(open))

  const chevron = document.createElement('span')
  chevron.className = 'scm-commit-chev'
  chevron.setAttribute('aria-hidden', 'true')
  chevron.innerHTML =
    '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3l5 5-5 5"/></svg>'

  const id = document.createElement('span')
  id.className = 'scm-commit-id'
  id.textContent = commit.id
  id.title = `Revision ${commit.id}`

  const msg = document.createElement('span')
  msg.className = 'scm-commit-msg'
  msg.textContent = commit.message
  msg.title = commit.message

  const meta = document.createElement('span')
  meta.className = 'scm-commit-meta'
  meta.textContent = `${commit.files.length} file${commit.files.length === 1 ? '' : 's'} · ${fmtAgo(commit.at)}`

  head.append(chevron, id, msg, meta)
  row.appendChild(head)

  if (open) {
    const files = document.createElement('div')
    files.className = 'scm-commit-files'
    for (const captured of commit.files) {
      const line = document.createElement('div')
      line.className = 'scm-commit-file'
      line.dataset.commitFile = captured.path

      const path = document.createElement('span')
      path.className = 'scm-commit-path'
      path.textContent = captured.path
      path.title = captured.path

      const restore = document.createElement('button')
      restore.type = 'button'
      restore.className = 'mini-btn'
      restore.dataset.restore = captured.path
      restore.dataset.commitId = commit.id
      restore.textContent = 'Restore'
      restore.title = `Put ${captured.path} back to what ${commit.id} recorded`
      restore.setAttribute('aria-label', restore.title)

      line.append(path, restore)
      files.appendChild(line)
    }
    row.appendChild(files)
  }

  return row
}

/* ── render ───────────────────────────────────────────────── */

function renderScm(): void {
  // One pass: the diff stat is computed once per change and reused for the row.
  const changes = scmChanges()
  syncRepo(changes.map((c) => c.file))

  const list = els.scmList
  const empty = els.scmEmpty
  if (!list || !empty) return

  const staged = changes.filter((c) => repo.isStaged(c.file.path))
  const unstaged = changes.filter((c) => !repo.isStaged(c.file.path))

  empty.classList.toggle('is-hidden', changes.length > 0 || repo.commits.length > 0)
  list.replaceChildren()

  if (staged.length) {
    const section = scmSection('Staged Changes', staged.length)
    scmSectionAction(section, 'Unstage all', 'Unstage every change', 'unstage-all')
    list.appendChild(section)
    for (const change of staged) list.appendChild(scmRow(change, true))
  }

  if (unstaged.length) {
    const section = scmSection('Changes', unstaged.length)
    scmSectionAction(section, 'Stage all', 'Stage every change for the next commit', 'stage-all')
    list.appendChild(section)
    for (const change of unstaged) list.appendChild(scmRow(change, false))
  }

  if (repo.commits.length) {
    const section = scmSection('History', repo.commits.length)
    list.appendChild(section)
    for (const commit of repo.commits) list.appendChild(scmCommitRow(commit))
  }

  syncScmBadge(changes.length)
  syncCommitBox(staged.length, changes.length)
}

function syncScmBadge(count: number): void {
  // VS Code shows the count on the activity-bar icon.
  const btn = document.getElementById('btn-view-scm')
  if (!btn) return
  btn.classList.toggle('has-badge', count > 0)
  btn.dataset.badge = String(count)
  btn.title = count
    ? `Source Control \u2014 ${count} change${count === 1 ? '' : 's'}`
    : 'Source Control'
}

/** The commit button follows the staging area and the message box. */
function syncCommitBox(staged: number, changed: number): void {
  const btn = els.scmCommit
  const note = els.scmCommitNote
  if (!btn) return
  const hasMessage = (els.scmMessage?.value ?? '').trim().length > 0
  btn.disabled = staged === 0 || !hasMessage
  btn.title = staged === 0
    ? 'Stage a change first'
    : hasMessage
      ? `Commit ${staged} staged file${staged === 1 ? '' : 's'}`
      : 'A commit needs a message'
  if (note) {
    note.textContent = staged
      ? `${staged} of ${changed} change${changed === 1 ? '' : 's'} staged`
      : changed
        ? 'Nothing staged yet'
        : 'Nothing to commit'
  }
}

/* ── actions ──────────────────────────────────────────────── */

async function saveScmFile(path: string): Promise<void> {
  try {
    const where = await savePath(path)
    renderTabs()
    renderTree()
    renderScm()
    toast(where === 'disk' ? `Saved ${path} to disk` : `Saved ${path} (in-memory workspace)`, 'ok')
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'err')
  }
}

/** Discard goes through executeEdits, so a mistaken click is one Ctrl+Z away. */
function discardScmFile(path: string): void {
  const file = workspace.get(path)
  if (!file) return
  scmWriteBuffer(path, file.original, 'scm-discard')
  renderTabs()
  renderTree()
  renderScm()
  if (chat) chat.refreshContextViz()
  toast(`Discarded changes in ${path}`, 'ok')
}

/**
 * Commit the staged files. Each is written out first (so what is recorded is
 * what is on disk, and the file leaves the change list), then the repository
 * records the snapshot. A file that cannot be written is left out and reported
 * rather than silently committed as something it is not.
 */
async function commitScm(): Promise<void> {
  const message = els.scmMessage?.value ?? ''
  const staged = scmChangedFiles().filter((f) => repo.isStaged(f.path))

  if (!staged.length) {
    toast('Stage a change before committing', 'err')
    return
  }
  if (!message.trim()) {
    toast('A commit needs a message', 'err')
    els.scmMessage?.focus()
    return
  }

  const applied: CommitFile[] = []
  const failed: string[] = []
  for (const file of staged) {
    try {
      await savePath(file.path)
      const saved = workspace.get(file.path)
      if (saved) applied.push({ path: file.path, content: saved.content })
    } catch {
      failed.push(file.path)
    }
  }

  const commit = repo.commit(message, applied)
  if (!commit) {
    toast('Nothing to commit', 'err')
    return
  }

  if (els.scmMessage) els.scmMessage.value = ''
  renderTabs()
  renderTree()
  renderScm()
  if (chat) chat.refreshContextViz()
  toast(`Committed ${commit.id} \u2014 ${applied.length} file${applied.length === 1 ? '' : 's'}`, 'ok')
  if (failed.length) toast(`Could not commit ${failed.join(', ')}`, 'err')
}

/** Put a file back to what a commit recorded, as an undoable edit. */
function restoreFromCommit(commitId: string, path: string): void {
  const commit = repo.find(commitId)
  const content = commit ? repo.contentIn(commit, path) : undefined
  if (content === undefined) return
  scmWriteBuffer(path, content, 'scm-restore')
  if (!openTabs.includes(path)) openFile(path)
  renderTabs()
  renderTree()
  renderScm()
  if (chat) chat.refreshContextViz()
  toast(`Restored ${path} from ${commitId}`, 'ok')
}

els.scmList?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement

  const bulk = target.closest<HTMLElement>('[data-scm-bulk]')?.dataset.scmBulk
  if (bulk) {
    const changed = scmChangedFiles().map((f) => f.path)
    if (bulk === 'stage-all') repo.stage(changed)
    else repo.unstage(changed)
    renderScm()
    return
  }

  const toggle = target.closest<HTMLElement>('[data-commit-toggle]')?.dataset.commitToggle
  if (toggle) {
    if (expandedCommits.has(toggle)) expandedCommits.delete(toggle)
    else expandedCommits.add(toggle)
    renderScm()
    return
  }

  const restore = target.closest<HTMLElement>('[data-restore]')
  if (restore?.dataset.restore && restore.dataset.commitId) {
    e.stopPropagation()
    restoreFromCommit(restore.dataset.commitId, restore.dataset.restore)
    return
  }

  const row = target.closest<HTMLElement>('.scm-file')
  if (!row) return
  const path = row.dataset.path!
  const act = target.closest<HTMLElement>('[data-scm]')?.dataset.scm
  if (act === 'stage') {
    repo.stage([path])
    renderScm()
  } else if (act === 'unstage') {
    repo.unstage([path])
    renderScm()
  } else if (act === 'save') {
    void saveScmFile(path)
  } else if (act === 'discard') {
    discardScmFile(path)
  } else {
    openFile(path)
  }
})

els.scmMessage?.addEventListener('input', () => syncCommitBox(repoStagedCount(), scmChangedFiles().length))
els.scmMessage?.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+Enter commits, the way VS Code does from the message box.
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void commitScm()
  }
})
els.scmCommit?.addEventListener('click', () => void commitScm())

function repoStagedCount(): number {
  return scmChangedFiles().filter((f) => repo.isStaged(f.path)).length
}

document.getElementById('btn-scm-save-all')?.addEventListener('click', () => {
  const files = scmChangedFiles()
  if (!files.length) {
    toast('Nothing to save', 'ok')
    return
  }
  void (async () => {
    const failed: string[] = []
    for (const file of files) {
      try {
        await savePath(file.path)
      } catch {
        failed.push(file.path)
      }
    }
    renderTabs()
    renderTree()
    renderScm()
    const ok = files.length - failed.length
    if (failed.length) toast(`Saved ${ok}, could not save ${failed.join(', ')}`, 'err')
    else toast(`Saved ${ok} file${ok === 1 ? '' : 's'}`, 'ok')
  })()
})

/* ══════════════════════════════════════════════════════════════
   Tabs
   ══════════════════════════════════════════════════════════════ */

function openFile(path: string, keepFocus = false): void {
  // Opening a file always leaves the settings page.
  closeSettings()
  const file = workspace.get(path)
  if (!file) {
    toast(`No such file: ${path}`, 'err')
    return
  }
  if (file.binary) {
    toast(`${file.name} is a binary file — not shown in the editor`, 'err')
    return
  }

  if (!openTabs.includes(path)) openTabs.push(path)
  activePath = path

  const model = modelFor(path, file.content)
  if (model.getValue() !== file.content) model.setValue(file.content)
  editor.setModel(model)
  els.welcome.classList.add('is-hidden')

  editor.updateOptions({ tabSize: languageFor(path) === 'python' ? 4 : 2 })
  els.sbIndent.textContent = `Spaces: ${languageFor(path) === 'python' ? 4 : 2}`
  els.sbLang.textContent = languageLabel(languageFor(path))

  renderTabs()
  renderTree()
  chat.setActiveFile(path)
  if (!keepFocus) editor.focus()
  // On a narrow screen get the drawer out of the way of the file just opened.
  if (isNarrow()) setSidebarOpen(false)
}

function closeTab(path: string): void {
  const idx = openTabs.indexOf(path)
  if (idx < 0) return
  if (workspace.isDirty(path)) {
    const file = workspace.get(path)
    if (file) file.content = file.original // discard the buffer
  }
  openTabs.splice(idx, 1)
  const model = models.get(path)
  if (model && !model.isDisposed()) model.dispose()
  models.delete(path)

  if (activePath === path) {
    const next = openTabs[idx] ?? openTabs[idx - 1] ?? null
    activePath = null
    if (next) openFile(next, true)
    else {
      editor.setModel(null)
      els.welcome.classList.remove('is-hidden')
      chat.setActiveFile(null)
    }
  }
  renderTabs()
  renderTree()
}

function renderTabs(): void {
  els.tabs.innerHTML = ''
  for (const path of openTabs) {
    const dirty = workspace.isDirty(path)
    const tab = document.createElement('div')
    tab.className = `tab${path === activePath ? ' is-active' : ''}`
    tab.setAttribute('role', 'tab')
    tab.title = path
    tab.innerHTML =
      `<span class="tab-ico">${fileIcon(path)}</span>` +
      `<span class="name">${escapeHtml(path.split('/').pop()!)}${dirty ? ' •' : ''}</span>` +
      `<span class="close" role="button" aria-label="Close ${escapeHtml(path)}">` +
      `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4l8 8M12 4l-8 8"/></svg></span>`

    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.close')) {
        e.stopPropagation()
        closeTab(path)
        return
      }
      openFile(path)
    })
    els.tabs.appendChild(tab)
  }
}

/* ══════════════════════════════════════════════════════════════
   Explorer tree
   ══════════════════════════════════════════════════════════════ */

function renderTree(): void {
  els.tree.innerHTML = ''
  const nodes = workspace.tree()
  if (!nodes.length) {
    els.tree.innerHTML = '<div class="row" style="color:var(--fg-dim)">No files — open a folder.</div>'
    return
  }

  const build = (list: typeof nodes, depth: number, container: HTMLElement): void => {
    for (const node of list) {
      const row = document.createElement('div')
      row.className = 'row'
      row.style.paddingLeft = `${6 + depth * 12}px`
      row.setAttribute('role', 'treeitem')
      row.tabIndex = 0
      row.title = node.path

      if (node.kind === 'dir') {
        const collapsed = workspace.isCollapsed(node.path)
        row.classList.toggle('is-open', !collapsed)
        row.innerHTML =
          `<span class="twisty"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 4l4 4-4 4"/></svg></span>` +
          `<span class="ico">${folderIcon(!collapsed)}</span>` +
          `<span class="name">${escapeHtml(node.name)}</span>`
        row.addEventListener('click', () => workspace.toggleDir(node.path))
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            workspace.toggleDir(node.path)
          }
        })
        container.appendChild(row)
        if (!collapsed) build(node.children, depth + 1, container)
      } else {
        const file = workspace.get(node.path)
        if (node.path === activePath) row.classList.add('is-active')
        row.innerHTML =
          `<span class="twisty"></span>` +
          `<span class="ico">${fileIcon(node.name)}</span>` +
          `<span class="name">${escapeHtml(node.name)}</span>` +
          (workspace.isDirty(node.path) ? '<span class="dirty"></span>' : '')
        if (file?.binary) row.style.opacity = '0.55'
        row.addEventListener('click', () => openFile(node.path))
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            openFile(node.path)
          }
        })
        container.appendChild(row)
      }
    }
  }

  build(nodes, 0, els.tree)
  els.wsName.textContent = workspace.rootName
  els.sbBranchName.textContent = workspace.isRealDirectory ? workspace.rootName : 'browser'
}

/* ══════════════════════════════════════════════════════════════
   Search view
   ══════════════════════════════════════════════════════════════ */

let searchTimer: number | undefined
els.searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(runSearch, 160)
})

function runSearch(): void {
  const q = els.searchInput.value
  els.searchResults.innerHTML = ''
  if (!q.trim()) return

  const hits = workspace.search(q)
  if (!hits.length) {
    els.searchResults.innerHTML = '<div class="hint">No matches.</div>'
    return
  }

  const pattern = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const grouped = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const list = grouped.get(hit.path) ?? []
    list.push(hit)
    grouped.set(hit.path, list)
  }

  for (const [path, list] of grouped) {
    const head = document.createElement('div')
    head.className = 'search-hit'
    head.innerHTML = `<div class="file">${escapeHtml(path)} <span class="muted">(${list.length})</span></div>`
    els.searchResults.appendChild(head)
    for (const hit of list.slice(0, 20)) {
      const row = document.createElement('div')
      row.className = 'search-hit'
      row.innerHTML = `<div class="line">${hit.line}: ${escapeHtml(hit.text).replace(pattern, '<mark>$1</mark>')}</div>`
      row.addEventListener('click', () => {
        openFile(hit.path)
        setTimeout(() => {
          editor.revealLineInCenter(hit.line)
          editor.setPosition({ lineNumber: hit.line, column: 1 })
          editor.focus()
        }, 30)
      })
      els.searchResults.appendChild(row)
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   Quick open (Ctrl+P)
   ══════════════════════════════════════════════════════════════ */

interface QuickItem {
  path: string
  label: string
  dir: string
}

let quickItems: QuickItem[] = []
let quickSel = 0
let quickFiltered: QuickItem[] = []

function openQuickOpen(): void {
  quickItems = workspace.paths().map((path) => {
    const parts = path.split('/')
    const label = parts.pop()!
    return { path, label, dir: parts.join('/') }
  })
  els.quickOpen.classList.remove('is-hidden')
  els.quickInput.value = ''
  filterQuick('')
  els.quickInput.focus()
}

function closeQuickOpen(): void {
  els.quickOpen.classList.add('is-hidden')
}

/** Subsequence match, VS Code style. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      streak++
      score += streak * 2 + (ti === 0 || t[ti - 1] === '/' ? 6 : 0)
    } else {
      streak = 0
    }
  }
  return qi === q.length ? score - t.length * 0.05 : -1
}

function filterQuick(query: string): void {
  const scored = quickItems
    .map((item) => ({ item, score: fuzzyScore(query, item.path) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60)
  quickFiltered = scored.map((s) => s.item)
  quickSel = 0
  renderQuickList()
}

function renderQuickList(): void {
  els.quickList.innerHTML = ''
  if (!quickFiltered.length) {
    els.quickList.innerHTML = '<div class="palette-item muted">No matching files</div>'
    return
  }
  quickFiltered.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = `palette-item${i === quickSel ? ' is-sel' : ''}`
    row.setAttribute('role', 'option')
    row.innerHTML = `${fileIcon(item.label)}<span>${escapeHtml(item.label)}</span><span class="p-dir">${escapeHtml(item.dir)}</span>`
    row.addEventListener('click', () => {
      closeQuickOpen()
      openFile(item.path)
    })
    els.quickList.appendChild(row)
  })
}

els.quickInput.addEventListener('input', () => filterQuick(els.quickInput.value))
els.quickInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    quickSel = Math.min(quickSel + 1, quickFiltered.length - 1)
    renderQuickList()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    quickSel = Math.max(quickSel - 1, 0)
    renderQuickList()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = quickFiltered[quickSel]
    if (item) {
      closeQuickOpen()
      openFile(item.path)
    }
  }
})

els.quickOpen.addEventListener('click', (e) => {
  if (e.target === els.quickOpen) closeQuickOpen()
})

/* ══════════════════════════════════════════════════════════════
   Chat panel wiring
   ══════════════════════════════════════════════════════════════ */

let chat: ChatPanel

function setChatStatus(status: ChatStatus): void {
  els.chatDot.className = `dot${status === 'ready' ? ' is-ready' : status === 'busy' ? ' is-busy' : status === 'error' ? ' is-error' : ''}`
  els.chatDot.title =
    status === 'ready'
      ? 'Key configured — ready'
      : status === 'busy'
        ? 'Generating…'
        : status === 'error'
          ? 'Last request failed'
          : 'No API key set'
}

function chatContext() {
  const path = activePath
  const file = path ? workspace.get(path) : undefined
  const model = editor.getModel()
  const sel = editor.getSelection()
  return {
    path,
    language: path ? languageFor(path) : 'plaintext',
    content: file?.content ?? model?.getValue() ?? '',
    selection: model && sel && !sel.isEmpty() ? model.getValueInRange(sel) : '',
    selectionLines:
      model && sel && !sel.isEmpty()
        ? { start: sel.startLineNumber, end: sel.endLineNumber }
        : null,
  }
}

function insertCode(code: string): void {
  const model = editor.getModel()
  if (!model) {
    toast('Open a file before inserting code', 'err')
    return
  }
  const selection = editor.getSelection()
  const range =
    selection && !selection.isEmpty()
      ? selection
      : new monaco.Range(
          editor.getPosition()?.lineNumber ?? 1,
          editor.getPosition()?.column ?? 1,
          editor.getPosition()?.lineNumber ?? 1,
          editor.getPosition()?.column ?? 1,
        )
  editor.executeEdits('chat', [{ range, text: code, forceMoveMarkers: true }])
  editor.pushUndoStop()
  editor.focus()
  toast(selection && !selection.isEmpty() ? 'Inserted over selection' : 'Inserted at cursor', 'ok')
}

/**
 * Replace the whole contents of the file the user has open with `code` — this is
 * how the assistant's answer gets written into the active buffer. The edit joins
 * the undo stack (Ctrl+Z restores what was there), and nothing reaches disk
 * until Ctrl+S.
 */
function applyToActiveFile(code: string): void {
  const path = activePath
  const model = editor.getModel()
  if (!path || !model) {
    toast('Open a file before applying changes', 'err')
    return
  }
  if (workspace.get(path)?.binary) {
    toast(`${path} is a binary file`, 'err')
    return
  }
  if (model.getValue().trim() === code.trim()) {
    toast(`${path} already matches this block`, 'ok')
    return
  }

  const wasDirty = workspace.isDirty(path)
  editor.pushUndoStop()
  editor.executeEdits('chat-apply', [{ range: model.getFullModelRange(), text: code }])
  editor.pushUndoStop()
  editor.setPosition({ lineNumber: 1, column: 1 })
  editor.revealLine(1)
  editor.focus()
  toast(
    wasDirty
      ? `Replaced ${path} — it had unsaved edits, Ctrl+Z to undo`
      : `Replaced ${path} — Ctrl+S to save`,
    'ok',
  )
}

const EXT_FOR_LANG: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'py',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  markdown: 'md',
  shell: 'sh',
  bash: 'sh',
  yaml: 'yml',
  sql: 'sql',
  rust: 'rs',
  go: 'go',
  java: 'java',
  ruby: 'rb',
  php: 'php',
  text: 'txt',
}

function createFileFromCode(code: string, lang: string): void {
  const ext = EXT_FOR_LANG[lang.toLowerCase()] ?? 'txt'
  const dir = activePath?.includes('/') ? `${activePath.slice(0, activePath.lastIndexOf('/'))}/` : ''
  const suggestion = `${dir}snippet.${ext}`
  const name = window.prompt('New file path', suggestion)
  if (!name) return
  try {
    workspace.create(name.trim(), code)
    openFile(name.trim())
    toast(`Created ${name.trim()}`, 'ok')
  } catch (err) {
    toast((err as Error).message, 'err')
  }
}

/* The credits row is built with the settings page (via its `liveInfo` hook) and
   loaded when the page opens, so nothing is asked of OpenRouter at boot. */
let creditsRow: CreditsRow | null = null

/** The gear opens the settings page in the editor area, like VS Code. */
function openSettings(): void {
  settingsPage.open()
  settingsPage.refresh()
  syncSettingsButton()
  // The balance is the one thing on the page that has to be asked for; it is
  // loaded when the page opens rather than at boot, and cached for a minute.
  void creditsRow?.load()
}

function closeSettings(): void {
  settingsPage.close()
  syncSettingsButton()
}

/** The gear is a toggle too, so it has to show whether the page is up. */
function syncSettingsButton(): void {
  els.btnSettings.classList.toggle('is-active', settingsPage.isOpen)
  els.btnSettings.setAttribute('aria-pressed', String(settingsPage.isOpen))
  els.btnSettings.title = settingsPage.isOpen
    ? 'Close settings (Esc)'
    : 'Settings (Ctrl+,)'
}

/* ── Model selection ─────────────────────────────────────────
   Two triggers, one picker: the chat header badge and the `codechat.model`
   row in Settings. Both commit through `setSetting`, so the header, the
   settings row and the outgoing request can never disagree about the model. */

let chatPicker: ModelPicker | null = null
let settingsModelPicker: ModelPicker | null = null

/**
 * One model, two triggers: after any change the header badge, the settings
 * row label and both open pickers re-read the store. `applySetting` calls
 * this, so it covers every route in — a picker, the reset arrow, storage.
 */
function syncModelSurfaces(): void {
  settingsPage.refresh()
  chatPicker?.sync()
  settingsModelPicker?.sync()
}

/** The picker talks to the settings store, never to `settings` directly. */
function modelPickerDeps(): ConstructorParameters<typeof ModelPicker>[1] {
  return {
    get: () => settings.model,
    set: (id: string) => {
      const def = settingById('codechat.model')
      if (def) setSetting(def, id)
    },
    toasts: (message: string) => toast(message, 'ok'),
  }
}

chat = new ChatPanel({
  getContext: chatContext,
  getConfig: () => ({
    apiKey: settings.apiKey,
    model: settings.model,
    reasoning: settings.reasoning,
    maxContextChars: coreNumber('codechat.maxContextChars', 24000),
  }),
  insertCode,
  applyToActiveFile,
  createFileFromCode,
  toast,
  openSettings,
  onStatus: setChatStatus,
})

const modelBtn = document.getElementById('btn-model')
if (modelBtn) {
  chatPicker = new ModelPicker(modelBtn, modelPickerDeps())
}

/* ══════════════════════════════════════════════════════════════
   Layout: view switching, chat toggle, resizer
   ══════════════════════════════════════════════════════════════ */

type ViewName = 'explorer' | 'search' | 'scm'

function setView(view: ViewName): void {
  for (const panel of document.querySelectorAll<HTMLElement>('[data-view-panel]')) {
    panel.classList.toggle('is-hidden', panel.dataset.viewPanel !== view)
  }
  for (const btn of document.querySelectorAll<HTMLElement>('.act-btn[data-view]')) {
    btn.classList.toggle('is-active', btn.dataset.view === view)
  }
}

/* ══════════════════════════════════════════════════════════════
   Layout — fixed columns on desktop, overlay drawers on narrow screens
   ══════════════════════════════════════════════════════════════ */

const narrow = window.matchMedia('(max-width: 900px)')
const isNarrow = (): boolean => narrow.matches

function relayout(): void {
  requestAnimationFrame(() => editor.layout())
}

function syncScrim(): void {
  const open =
    els.body.classList.contains('sidebar-open') || els.body.classList.contains('chat-open')
  els.scrim.hidden = !open
}

function syncChatButton(): void {
  const on = isNarrow() ? els.body.classList.contains('chat-open') : !ui.chatCollapsed
  els.btnToggleRight.classList.toggle('is-on', on)
}

/** Slide the sidebar in over the editor. No-op on desktop. */
function setSidebarOpen(open: boolean): void {
  if (!isNarrow()) return
  els.body.classList.toggle('sidebar-open', open)
  if (open) els.body.classList.remove('chat-open')
  syncScrim()
  syncChatButton()
  relayout()
}

/** Slide the chat panel in over the editor. No-op on desktop. */
function setChatOpen(open: boolean): void {
  if (!isNarrow()) return
  els.body.classList.toggle('chat-open', open)
  if (open) els.body.classList.remove('sidebar-open')
  syncScrim()
  syncChatButton()
  relayout()
}

function closeDrawers(): void {
  if (!els.body.classList.contains('sidebar-open') && !els.body.classList.contains('chat-open')) {
    return
  }
  els.body.classList.remove('sidebar-open', 'chat-open')
  syncScrim()
  syncChatButton()
  relayout()
}

function setChatCollapsed(collapsed: boolean): void {
  ui.chatCollapsed = collapsed
  els.body.classList.toggle('chat-collapsed', collapsed)
  saveUi(ui)
  syncChatButton()
  relayout()
}

/**
 * Collapse the side bar to nothing. On narrow screens the side bar is a drawer
 * instead, so the flag is remembered but not applied — and the CSS keeps its
 * own override there, because a `.body.sidebar-collapsed` rule would otherwise
 * out-specify the media query's two-column grid.
 */
function setSidebarCollapsed(collapsed: boolean): void {
  ui.sidebarCollapsed = collapsed
  els.body.classList.toggle('sidebar-collapsed', collapsed && !isNarrow())
  saveUi(ui)
  relayout()
}

const isSidebarCollapsed = (): boolean =>
  !isNarrow() && els.body.classList.contains('sidebar-collapsed')

/** The one way to toggle the AI panel, whatever the screen size. */
function toggleChatPanel(): void {
  if (isNarrow()) {
    const open = !els.body.classList.contains('chat-open')
    setChatOpen(open)
    if (open) chat.focus()
    return
  }
  setChatCollapsed(!ui.chatCollapsed)
}

const THEME_TITLE: Record<ThemeName, string> = {
  dark: 'Switch to light theme (Ctrl+Alt+T)',
  light: 'Switch to dark theme (Ctrl+Alt+T)',
}

function syncThemeButton(): void {
  els.btnTheme.title = THEME_TITLE[ui.theme]
  els.btnTheme.setAttribute('aria-label', THEME_TITLE[ui.theme])
}

/** Swap between One Dark Pro and One Dark Pro Light. */
function toggleTheme(): void {
  ui.theme = ui.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = ui.theme
  setMonacoTheme(ui.theme)
  syncThemeButton()
  saveUi(ui)
}

function applyUi(): void {
  document.documentElement.style.setProperty('--chat-w', `${ui.chatWidth}px`)
  document.documentElement.style.setProperty('--sidebar-w', `${ui.sidebarWidth}px`)
  document.documentElement.dataset.theme = ui.theme
  setMonacoTheme(ui.theme)
  syncThemeButton()
  setChatCollapsed(ui.chatCollapsed)
  setSidebarCollapsed(ui.sidebarCollapsed)
  syncScrim()
}

/* Activity bar. Clicking a view's button shows that view, switches to it, or —
   if it is already the one showing — closes the side bar, the way VS Code does.
   The active button stays marked while collapsed, so you can see what will come
   back, and pressing it again re-opens the side bar. */
for (const btn of document.querySelectorAll<HTMLElement>('.act-btn[data-view]')) {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view as ViewName
    if (isNarrow()) {
      // Tapping the view that is already showing closes the drawer again.
      if (els.body.classList.contains('sidebar-open') && btn.classList.contains('is-active')) {
        closeDrawers()
        return
      }
      setView(view)
      setSidebarOpen(true)
      return
    }
    if (btn.classList.contains('is-active') && !isSidebarCollapsed()) {
      setSidebarCollapsed(true)
      return
    }
    setView(view)
    setSidebarCollapsed(false)
  })
}

els.btnToggleRight.addEventListener('click', toggleChatPanel)
document.getElementById('btn-chat-close')?.addEventListener('click', () => {
  if (isNarrow()) closeDrawers()
  else setChatCollapsed(true)
})
els.sbAi.addEventListener('click', () => {
  if (isNarrow()) {
    const open = !els.body.classList.contains('chat-open')
    setChatOpen(open)
    if (open) chat.focus()
    return
  }
  if (ui.chatCollapsed) setChatCollapsed(false)
  else chat.focus()
})

els.scrim.addEventListener('click', closeDrawers)

// Crossing the breakpoint must never leave a drawer stuck open, and the side
// bar's collapsed flag only applies on desktop.
narrow.addEventListener('change', () => {
  closeDrawers()
  setSidebarCollapsed(ui.sidebarCollapsed)
  relayout()
})

/* Resizer */
let dragging = false
els.chatResizer.addEventListener('pointerdown', (e) => {
  dragging = true
  els.chatResizer.classList.add('is-dragging')
  els.chatResizer.setPointerCapture(e.pointerId)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
})
els.chatResizer.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const rect = els.body.getBoundingClientRect()
  const width = Math.min(Math.max(rect.right - e.clientX, 280), Math.min(760, rect.width - 320))
  document.documentElement.style.setProperty('--chat-w', `${width}px`)
  ui.chatWidth = width
  editor.layout()
})
const endDrag = (e: PointerEvent) => {
  if (!dragging) return
  dragging = false
  els.chatResizer.classList.remove('is-dragging')
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  try {
    els.chatResizer.releasePointerCapture(e.pointerId)
  } catch {
    /* already released */
  }
  saveUi(ui)
}
els.chatResizer.addEventListener('pointerup', endDrag)
els.chatResizer.addEventListener('pointercancel', endDrag)

/* ══════════════════════════════════════════════════════════════
   File loading
   ══════════════════════════════════════════════════════════════ */

async function openFolder(): Promise<void> {
  if (Workspace.canOpenDirectory()) {
    try {
      const { opened, skipped } = await workspace.openDirectory()
      openTabs = []
      activePath = null
      editor.setModel(null)
      els.welcome.classList.remove('is-hidden')
      chat.setActiveFile(null)
      renderTabs()
      renderTree()
      toast(`Opened ${workspace.rootName} — ${opened} files${skipped ? `, ${skipped} skipped` : ''}`, 'ok')
      const first = workspace.paths()[0]
      if (first) openFile(first, true)
      return
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      toast((err as Error).message, 'err')
      return
    }
  }
  pickFilesFallback(true)
}

function pickFilesFallback(directory: boolean): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  if (directory) {
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
  }
  input.addEventListener('change', async () => {
    if (!input.files?.length) return
    const n = await workspace.addFiles(input.files)
    renderTree()
    toast(`Added ${n} file${n === 1 ? '' : 's'} to the workspace`, 'ok')
    const first = workspace.paths()[0]
    if (first) openFile(first, true)
  })
  input.click()
}

document.getElementById('btn-open-folder')?.addEventListener('click', () => void openFolder())
document.getElementById('btn-new-file')?.addEventListener('click', () => {
  const name = window.prompt('New file path', 'untitled.ts')
  if (!name) return
  try {
    workspace.create(name.trim(), '')
    openFile(name.trim())
  } catch (err) {
    toast((err as Error).message, 'err')
  }
})
document.getElementById('btn-collapse')?.addEventListener('click', () => {
  for (const path of workspace.paths()) {
    const parts = path.split('/')
    parts.pop()
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p
      if (!workspace.isCollapsed(acc)) workspace.toggleDir(acc)
    }
  }
})

window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  if (!e.dataTransfer?.files?.length) return
  const n = await workspace.addFiles(e.dataTransfer.files)
  renderTree()
  toast(`Added ${n} file${n === 1 ? '' : 's'}`, 'ok')
})

/* ══════════════════════════════════════════════════════════════
   Commands + keyboard
   ══════════════════════════════════════════════════════════════ */

/** Write one workspace file, applying the files.* rewrites to its buffer first. */
async function savePath(path: string): Promise<'disk' | 'memory'> {
  const file = workspace.get(path)
  if (!file) throw new Error(`No such file: ${path}`)
  const model = models.get(path)
  if (!model) return workspace.save(path, applySaveTransforms(file.content))
  // files.* rewrites run before the write and join the undo stack, so one
  // Ctrl+Z puts the raw text back.
  const before = model.getValue()
  const after = applySaveTransforms(before)
  if (after !== before) {
    editor.pushUndoStop()
    editor.executeEdits('save-transforms', [{ range: model.getFullModelRange(), text: after }])
    editor.pushUndoStop()
  }
  return workspace.save(path, model.getValue())
}

async function saveActive(): Promise<void> {
  if (!activePath) return
  if (!editor.getModel()) return
  try {
    const where = await savePath(activePath)
    renderTabs()
    renderTree()
    renderScm()
    toast(where === 'disk' ? `Saved ${activePath} to disk` : `Saved ${activePath} (in-memory workspace)`, 'ok')
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'err')
  }
}

const commands: Record<string, () => void> = {
  'open-folder': () => void openFolder(),
  'quick-open': () => openQuickOpen(),
  'toggle-chat': () => toggleChatPanel(),
  'toggle-theme': () => toggleTheme(),
  settings: () => openSettings(),
}

for (const btn of document.querySelectorAll<HTMLElement>('[data-command]')) {
  btn.addEventListener('click', () => commands[btn.dataset.command!]?.())
}

/** Attach the editor selection to the chat, revealing the panel if needed. */
function attachSelectionToChat(): void {
  if (!chat.addSelectionToChat()) return
  if (isNarrow()) setChatOpen(true)
  else if (ui.chatCollapsed) setChatCollapsed(false)
}

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey

  // Ctrl+L attaches the highlighted chunk. Ctrl+Shift+L works too (browsers
  // don't reserve it) for when Ctrl+L is taken by the address bar. Monaco
  // handles the editor case, so skip if it already did.
  if (mod && !e.altKey && e.key.toLowerCase() === 'l') {
    if (e.defaultPrevented) return
    e.preventDefault()
    attachSelectionToChat()
    return
  }

  if (mod && e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    toggleChatPanel()
    return
  }
  if (mod && e.altKey && e.key.toLowerCase() === 't') {
    e.preventDefault()
    toggleTheme()
    return
  }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    openQuickOpen()
    return
  }
  if (mod && !e.shiftKey && e.key === ',') {
    e.preventDefault()
    openSettings()
    return
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void saveActive()
    return
  }
  if (mod && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    if (isNarrow()) setSidebarOpen(!els.body.classList.contains('sidebar-open'))
    else setSidebarCollapsed(!ui.sidebarCollapsed)
    return
  }
  if (e.key === 'Escape') {
    if (!els.quickOpen.classList.contains('is-hidden')) {
      closeQuickOpen()
      return
    }
    if (settingsPage.isOpen) {
      closeSettings()
      return
    }
    closeDrawers()
    return
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    chat.newChat()
  }
})

/* ══════════════════════════════════════════════════════════════
   Settings view
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   Settings
   ══════════════════════════════════════════════════════════════ */

/* One accessor layer over three backing stores: the app settings key, the
   workbench UiState, and `settings.core` for the VS Code core settings. The
   page in settings-ui.ts only ever talks to these. */

function getSetting(def: SettingDef): unknown {
  switch (def.id) {
    case 'codechat.apiKey':
      return settings.apiKey
    case 'codechat.model':
      return settings.model
    case 'codechat.reasoning':
      return settings.reasoning
    case 'workbench.colorTheme':
      return ui.theme
    case 'workbench.sideBarWidth':
      return ui.sidebarWidth
    case 'workbench.chatPanelWidth':
      return ui.chatWidth
    default:
      return settings.core[def.id] ?? def.default
  }
}

function isSettingModified(def: SettingDef): boolean {
  // A read-only row has no value to differ from a default.
  if (def.type === 'info') return false
  const value = getSetting(def)
  if (typeof def.default === 'number') return Number(value) !== def.default
  return value !== def.default
}

/* Typed reads of a core setting, for the places that need a plain value. */
function coreValue(id: string): unknown {
  const def = settingById(id)
  return def ? getSetting(def) : undefined
}
function coreNumber(id: string, fallback: number): number {
  const value = Number(coreValue(id))
  return Number.isFinite(value) ? value : fallback
}
function coreBool(id: string): boolean {
  return coreValue(id) === true
}

/** The whole catalogue as nested Monaco options, so one updateOptions call covers it. */
function monacoCoreOptions(): monaco.editor.IEditorOptions {
  return buildMonacoOptions(getSetting) as unknown as monaco.editor.IEditorOptions
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Push one setting's new value to whatever it drives. */
function applySetting(def: SettingDef): void {
  if (def.monaco) {
    editor.updateOptions(monacoCoreOptions())
    return
  }
  switch (def.id) {
    case 'codechat.apiKey':
      setChatStatus(settings.apiKey ? 'ready' : 'idle')
      // New key, new account — the cached balance is no longer ours.
      void creditsRow?.keyChanged()
      break
    case 'codechat.model':
      chat.refreshModelBadge()
      syncModelSurfaces()
      break
    case 'codechat.reasoning':
      els.thinkSelect.value = settings.reasoning
      break
    case 'codechat.maxContextChars':
      chat.refreshContextViz()
      break
    case 'workbench.colorTheme':
    case 'workbench.sideBarWidth':
    case 'workbench.chatPanelWidth':
      applyUi()
      editor.layout()
      break
    case 'files.autoSave':
    case 'files.autoSaveDelay':
      scheduleAutoSave()
      break
  }
}

/** Every settings write goes through here: store, persist, then apply. */
function setSetting(def: SettingDef, value: unknown): void {
  switch (def.id) {
    case 'codechat.apiKey':
      settings = { ...settings, apiKey: String(value) }
      break
    case 'codechat.model':
      settings = { ...settings, model: String(value) || DEFAULT_MODEL }
      break
    case 'codechat.reasoning':
      settings = { ...settings, reasoning: value as ReasoningEffort }
      break
    case 'workbench.colorTheme':
      ui.theme = value === 'light' ? 'light' : 'dark'
      break
    case 'workbench.sideBarWidth':
      ui.sidebarWidth = clamp(Number(value), 160, 500)
      break
    case 'workbench.chatPanelWidth':
      ui.chatWidth = clamp(Number(value), 280, 760)
      break
    default:
      settings = { ...settings, core: { ...settings.core, [def.id]: value } }
  }
  saveSettings(settings)
  saveUi(ui)
  applySetting(def)
}

function resetSetting(def: SettingDef): void {
  setSetting(def, def.default)
}

const settingsPage = new SettingsPage({
  get: getSetting,
  isModified: isSettingModified,
  set: setSetting,
  reset: resetSetting,
  // A live-options setting gets the same picker the chat header uses.
  liveSelect: (_def, host, label) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sp-model-btn'
    const text = document.createElement('span')
    const chev = document.createElement('span')
    chev.className = 'sp-model-btn-chev'
    chev.textContent = '⌄'
    chev.setAttribute('aria-hidden', 'true')
    btn.append(text, chev)
    host.appendChild(btn)
    // It is a button, not a form field, so the label must not claim it.
    label.removeAttribute('for')

    settingsModelPicker = new ModelPicker(btn, modelPickerDeps())
    return () => {
      text.textContent = settings.model
      btn.title = settings.model
    }
  },
  // A read-only row: the page hands over a slot and we mount the credits block.
  liveInfo: (_def, host) => {
    creditsRow = new CreditsRow({ getKey: () => settings.apiKey })
    host.appendChild(creditsRow.element)
    // Redraw only — `load()` is what fetches, and the page calls it on open.
    return () => creditsRow?.sync()
  },
})

document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  // Same toggle rule as the view buttons: a second click closes it again.
  if (settingsPage.isOpen) closeSettings()
  else openSettings()
})

// The chat's thinking selector and the settings page are two views of one value,
// so each writes through the same setter and re-syncs the other.
els.thinkSelect.addEventListener('change', () => {
  const def = settingById('codechat.reasoning')
  if (!def) return
  setSetting(def, els.thinkSelect.value)
  settingsPage.refresh()
  toast(settings.reasoning === 'off' ? 'Thinking off' : `Thinking: ${settings.reasoning}`, 'ok')
})

/* ══════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════ */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

workspace.onChange(() => {
  renderTree()
  renderTabs()
  renderScm()
})

applyUi()
syncSettingsButton()
els.thinkSelect.value = settings.reasoning
workspace.loadDemo()
renderTree()
renderTabs()
setChatStatus(settings.apiKey ? 'ready' : 'idle')
setView('explorer')

// Open the first demo file so the editor and chat context are live on load.
openFile('src/greeting.ts', true)

if (!settings.apiKey) {
  toast('Add your OpenRouter API key in Settings to start chatting', 'info', 6000)
}

window.addEventListener('resize', () => editor.layout())

// Expose a tiny handle for manual poking from the console.
;(window as any).codechat = {
  workspace,
  editor,
  chat,
  monaco,
  get settings() {
    return settings
  },
  get theme() {
    return ui.theme
  },
  toggleTheme,
}
