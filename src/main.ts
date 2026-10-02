import './styles.css'
import { ChatPanel, type ChatStatus } from './chat'
import { DEFAULT_MODEL, MODELS } from './deepseek'
import {
  defineTheme,
  editorOptions,
  fileIcon,
  folderIcon,
  languageFor,
  languageLabel,
  monaco,
  uriFor,
} from './monaco'
import { Workspace, type SearchHit } from './workspace'

/* ══════════════════════════════════════════════════════════════
   Settings + UI state (localStorage only — nothing leaves the browser)
   ══════════════════════════════════════════════════════════════ */

interface Settings {
  apiKey: string
  model: string
  temperature: number
}

interface UiState {
  chatCollapsed: boolean
  chatWidth: number
  sidebarWidth: number
}

const SETTINGS_KEY = 'codechat.settings.v1'
const UI_KEY = 'codechat.ui.v1'

const ENV_KEY = (import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined) ?? ''

function loadSettings(): Settings {
  const fallback: Settings = { apiKey: ENV_KEY, model: DEFAULT_MODEL, temperature: 0.2 }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) }
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

function loadUi(): UiState {
  const fallback: UiState = { chatCollapsed: false, chatWidth: 400, sidebarWidth: 240 }
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
  btnToggleRight: $('btn-toggle-right'),
  sbPos: $('sb-pos'),
  sbIndent: $('sb-indent'),
  sbLang: $('sb-lang'),
  sbProblems: $('sb-problems'),
  sbAi: $('sb-ai'),
  sbBranchName: $('sb-branch-name'),
  setKey: $<HTMLInputElement>('set-key'),
  setModel: $<HTMLSelectElement>('set-model'),
  setModelCustom: $<HTMLInputElement>('set-model-custom'),
  setTemp: $<HTMLInputElement>('set-temp'),
  tempVal: $('temp-val'),
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

function toast(message: string, kind: 'ok' | 'err' | 'info' = 'info', ms = 3200): void {
  const el = document.createElement('div')
  el.className = `toast${kind === 'err' ? ' is-err' : kind === 'ok' ? ' is-ok' : ''}`
  el.textContent = message
  els.toasts.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity .2s'
    setTimeout(() => el.remove(), 220)
  }, ms)
}

/* ══════════════════════════════════════════════════════════════
   Monaco editor
   ══════════════════════════════════════════════════════════════ */

defineTheme()

const editor = monaco.editor.create(els.editorHost, {
  ...editorOptions(),
  model: null,
  value: '',
})

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
   Tabs
   ══════════════════════════════════════════════════════════════ */

function openFile(path: string, keepFocus = false): void {
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

function openSettings(): void {
  setView('settings')
  els.setKey.focus()
}

chat = new ChatPanel({
  getContext: chatContext,
  getConfig: () => settings,
  insertCode,
  createFileFromCode,
  toast,
  openSettings,
  onStatus: setChatStatus,
})

/* ══════════════════════════════════════════════════════════════
   Layout: view switching, chat toggle, resizer
   ══════════════════════════════════════════════════════════════ */

type ViewName = 'explorer' | 'search' | 'settings'

function setView(view: ViewName | 'chat'): void {
  if (view === 'chat') {
    setChatCollapsed(false)
    chat.focus()
    return
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-view-panel]')) {
    panel.classList.toggle('is-hidden', panel.dataset.viewPanel !== view)
  }
  for (const btn of document.querySelectorAll<HTMLElement>('.act-btn[data-view]')) {
    btn.classList.toggle('is-active', btn.dataset.view === view)
  }
}

function setChatCollapsed(collapsed: boolean): void {
  ui.chatCollapsed = collapsed
  els.body.classList.toggle('chat-collapsed', collapsed)
  els.btnToggleRight.classList.toggle('is-on', !collapsed)
  saveUi(ui)
  if (!collapsed) {
    // Recompute the editor layout after the grid column changes.
    requestAnimationFrame(() => editor.layout())
  } else {
    requestAnimationFrame(() => {
      editor.layout()
      editor.focus()
    })
  }
}

function applyUi(): void {
  document.documentElement.style.setProperty('--chat-w', `${ui.chatWidth}px`)
  document.documentElement.style.setProperty('--sidebar-w', `${ui.sidebarWidth}px`)
  setChatCollapsed(ui.chatCollapsed)
  els.btnToggleRight.classList.toggle('is-on', !ui.chatCollapsed)
}

for (const btn of document.querySelectorAll<HTMLElement>('.act-btn[data-view]')) {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view as ViewName | 'chat'
    if (view === 'chat') {
      // Clicking the AI icon when the panel is already open focuses it.
      if (!ui.chatCollapsed) chat.focus()
      else setChatCollapsed(false)
      return
    }
    setView(view)
  })
}

els.btnToggleRight.addEventListener('click', () => setChatCollapsed(!ui.chatCollapsed))
document.getElementById('btn-chat-close')?.addEventListener('click', () => setChatCollapsed(true))
els.sbAi.addEventListener('click', () => {
  if (ui.chatCollapsed) setChatCollapsed(false)
  else chat.focus()
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

async function saveActive(): Promise<void> {
  if (!activePath) return
  const model = editor.getModel()
  if (!model) return
  try {
    const where = await workspace.save(activePath, model.getValue())
    renderTabs()
    renderTree()
    toast(where === 'disk' ? `Saved ${activePath} to disk` : `Saved ${activePath} (in-memory workspace)`, 'ok')
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'err')
  }
}

const commands: Record<string, () => void> = {
  'open-folder': () => void openFolder(),
  'quick-open': () => openQuickOpen(),
  'toggle-chat': () => setChatCollapsed(!ui.chatCollapsed),
  settings: () => openSettings(),
}

for (const btn of document.querySelectorAll<HTMLElement>('[data-command]')) {
  btn.addEventListener('click', () => commands[btn.dataset.command!]?.())
}

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey

  if (mod && e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    setChatCollapsed(!ui.chatCollapsed)
    return
  }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    openQuickOpen()
    return
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void saveActive()
    return
  }
  if (mod && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    document.querySelector('.sidebar')?.classList.toggle('is-hidden')
    editor.layout()
    return
  }
  if (e.key === 'Escape') {
    if (!els.quickOpen.classList.contains('is-hidden')) closeQuickOpen()
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

function syncSettingsForm(): void {
  els.setKey.value = settings.apiKey
  els.setModel.value = MODELS.some((m) => m.id === settings.model) ? settings.model : '__custom__'
  els.setModelCustom.value = els.setModel.value === '__custom__' ? settings.model : ''
  els.setModelCustom.classList.toggle('is-hidden', els.setModel.value !== '__custom__')
  els.setTemp.value = String(settings.temperature)
  els.tempVal.textContent = settings.temperature.toFixed(2)
}

els.setModel.addEventListener('change', () => {
  els.setModelCustom.classList.toggle('is-hidden', els.setModel.value !== '__custom__')
})
els.setTemp.addEventListener('input', () => {
  els.tempVal.textContent = Number(els.setTemp.value).toFixed(2)
})
document.getElementById('btn-save-settings')?.addEventListener('click', () => {
  const model = els.setModel.value === '__custom__' ? els.setModelCustom.value.trim() : els.setModel.value
  settings = {
    apiKey: els.setKey.value.trim(),
    model: model || DEFAULT_MODEL,
    temperature: Number(els.setTemp.value),
  }
  saveSettings(settings)
  chat.refreshModelBadge()
  setChatStatus(settings.apiKey ? 'ready' : 'idle')
  toast('Settings saved to this browser', 'ok')
})
document.getElementById('btn-clear-key')?.addEventListener('click', () => {
  settings = { ...settings, apiKey: '' }
  saveSettings(settings)
  els.setKey.value = ''
  setChatStatus('idle')
  toast('API key cleared', 'ok')
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
})

applyUi()
syncSettingsForm()
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
;(window as any).codechat = { workspace, editor, chat, monaco, get settings() { return settings } }
