import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/* ── Monaco web workers (Vite `?worker` imports) ─────────────── */
;(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}

/* ── Language detection ──────────────────────────────────────── */
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  svg: 'xml',
  dockerfile: 'dockerfile',
}

const LANG_LABEL: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  json: 'JSON',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  markdown: 'Markdown',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  shell: 'Shell Script',
  yaml: 'YAML',
  sql: 'SQL',
  plaintext: 'Plain Text',
}

export function languageFor(name: string): string {
  const base = name.toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  if (base.startsWith('.env')) return 'ini'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return LANG_BY_EXT[ext] ?? 'plaintext'
}

export function languageLabel(id: string): string {
  if (LANG_LABEL[id]) return LANG_LABEL[id]
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/* ── File-type icons (16px grid) ─────────────────────────────── */
export function fileIcon(name: string): string {
  const lang = languageFor(name)
  const c: Record<string, string> = {
    typescript: '#3178c6',
    javascript: '#f1dd35',
    json: '#f1dd35',
    css: '#42a5f5',
    scss: '#e91e63',
    html: '#e44d26',
    markdown: '#7cb7ff',
    python: '#3572a5',
    rust: '#dea584',
    go: '#00add8',
    shell: '#4eaa25',
  }
  const color = c[lang] ?? '#9aa0a6'
  const isMd = lang === 'markdown'
  const isFolder = false
  void isFolder

  if (isMd) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="${color}" stroke-width="1.2"/><path d="M3.6 10.6V6.2l1.8 2 1.8-2v4.4M10 6.2v4.4m0 0L8.6 9.1M10 10.6l1.4-1.5" stroke="${color}" stroke-width="1.1" stroke-linecap="round"/></svg>`
  }
  if (lang === 'json') {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2.5C4.5 2.5 4.2 3.4 4.2 4.6c0 1.4-.4 2-1.7 2.4 1.3.4 1.7 1 1.7 2.4 0 1.2.3 2.1 1.8 2.1M10 2.5c1.5 0 1.8.9 1.8 2.1 0 1.4.4 2 1.7 2.4-1.3.4-1.7 1-1.7 2.4 0 1.2-.3 2.1-1.8 2.1" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/></svg>`
  }
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.2 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.4l-3.6-3.6Z" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.2 1.8v3.6h3.6" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`
}

export function folderIcon(open: boolean): string {
  const color = '#c09553'
  return open
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.8 12.6V4a1 1 0 0 1 1-1h3.1l1.3 1.5h6a1 1 0 0 1 1 1v1.1" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.8 12.6 3.4 7.2h11.1l-1.7 5.4H1.8Z" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.8 12.4V4a1 1 0 0 1 1-1h3.1l1.3 1.5h6a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`
}

/* ── Theme: VS Code Dark+ approximation ──────────────────────── */
let defined = false
export function defineTheme(): void {
  if (defined) return
  defined = true
  monaco.editor.defineTheme('codechat-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: '569CD6' },
      { token: 'keyword.control', foreground: 'C586C0' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'identifier', foreground: '9CDCFE' },
      { token: 'delimiter', foreground: 'D4D4D4' },
      { token: 'tag', foreground: '569CD6' },
      { token: 'attribute.name', foreground: '9CDCFE' },
      { token: 'attribute.value', foreground: 'CE9178' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'function', foreground: 'DCDCAA' },
    ],
    colors: {
      'editor.background': '#1E1E1E',
      'editor.foreground': '#D4D4D4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#C6C6C6',
      'editor.selectionBackground': '#264F78',
      'editor.inactiveSelectionBackground': '#3A3D41',
      'editor.lineHighlightBackground': '#282828',
      'editorCursor.foreground': '#AEAFAD',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#707070',
      'editorWhitespace.foreground': '#3B3B3B',
      'editorBracketMatch.background': '#0064001A',
      'editorBracketMatch.border': '#888888',
      'editorGutter.background': '#1E1E1E',
      'editorWidget.background': '#252526',
      'editorWidget.border': '#454545',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.selectedBackground': '#04395E',
      'editorHoverWidget.background': '#252526',
      'scrollbarSlider.background': '#79797966',
      'scrollbarSlider.hoverBackground': '#646464B3',
      'minimap.background': '#1E1E1E',
    },
  })
}

export function editorOptions(): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    theme: 'codechat-dark',
    automaticLayout: true,
    fontFamily: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.55,
    fontLigatures: true,
    minimap: { enabled: true, renderCharacters: false, maxColumn: 90 },
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    padding: { top: 8 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    stickyScroll: { enabled: false },
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on',
  }
}

/** A stable monaco Uri for a virtual workspace path. */
export function uriFor(path: string): monaco.Uri {
  const clean = path.replace(/^\/+/, '')
  return monaco.Uri.parse(`inmemory://codechat/${clean}`)
}

export { monaco }
