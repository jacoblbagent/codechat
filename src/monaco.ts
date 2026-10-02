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
  if (base === '.gitignore' || base.endsWith('.gitignore')) return 'ignore'
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

/* ── Themes: One Dark Pro (dark) and One Dark Pro Light ───────
   Both are registered up front so switching themes is instant and the
   editor never lags behind the shell chrome. */
export type ThemeName = 'dark' | 'light'

export const MONACO_THEME: Record<ThemeName, string> = {
  dark: 'codechat-one-dark',
  light: 'codechat-one-light',
}

const DARK_RULES = [
  { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'c678dd' },
  { token: 'keyword.control', foreground: 'c678dd' },
  { token: 'string', foreground: '98c379' },
  { token: 'number', foreground: 'd19a66' },
  { token: 'type', foreground: 'e5c07b' },
  { token: 'type.identifier', foreground: 'e5c07b' },
  { token: 'identifier', foreground: 'e06c75' },
  { token: 'variable', foreground: 'e06c75' },
  { token: 'function', foreground: '61afef' },
  { token: 'delimiter', foreground: 'abb2bf' },
  { token: 'operator', foreground: '56b6c2' },
  { token: 'tag', foreground: 'e06c75' },
  { token: 'attribute.name', foreground: 'd19a66' },
  { token: 'attribute.value', foreground: '98c379' },
]

const LIGHT_RULES = [
  { token: 'comment', foreground: 'a0a1a7', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'a626a4' },
  { token: 'keyword.control', foreground: 'a626a4' },
  { token: 'string', foreground: '50a14f' },
  { token: 'number', foreground: '986801' },
  { token: 'type', foreground: 'c18401' },
  { token: 'type.identifier', foreground: 'c18401' },
  { token: 'identifier', foreground: 'e45649' },
  { token: 'variable', foreground: 'e45649' },
  { token: 'function', foreground: '4078f2' },
  { token: 'delimiter', foreground: '383a42' },
  { token: 'operator', foreground: '0184bc' },
  { token: 'tag', foreground: 'e45649' },
  { token: 'attribute.name', foreground: '986801' },
  { token: 'attribute.value', foreground: '50a14f' },
]

let defined = false
export function defineTheme(): void {
  if (defined) return
  defined = true

  monaco.editor.defineTheme(MONACO_THEME.dark, {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_RULES,
    colors: {
      'editor.background': '#282c34',
      'editor.foreground': '#abb2bf',
      'editorLineNumber.foreground': '#495162',
      'editorLineNumber.activeForeground': '#abb2bf',
      'editor.selectionBackground': '#3e4451',
      'editor.inactiveSelectionBackground': '#3a3f4b',
      'editor.lineHighlightBackground': '#2c313a',
      'editorCursor.foreground': '#528bff',
      'editorIndentGuide.background1': '#3b4048',
      'editorIndentGuide.activeBackground1': '#525a66',
      'editorWhitespace.foreground': '#3b4048',
      'editorBracketMatch.background': '#61afef22',
      'editorBracketMatch.border': '#61afef',
      'editorGutter.background': '#282c34',
      'editorWidget.background': '#21252b',
      'editorWidget.border': '#181a1f',
      'editorSuggestWidget.background': '#21252b',
      'editorSuggestWidget.selectedBackground': '#2c313a',
      'editorHoverWidget.background': '#21252b',
      'scrollbarSlider.background': '#4e566680',
      'scrollbarSlider.hoverBackground': '#5c6370b3',
      'minimap.background': '#282c34',
    },
  })

  monaco.editor.defineTheme(MONACO_THEME.light, {
    base: 'vs',
    inherit: true,
    rules: LIGHT_RULES,
    colors: {
      'editor.background': '#fafafa',
      'editor.foreground': '#383a42',
      'editorLineNumber.foreground': '#9d9d9f',
      'editorLineNumber.activeForeground': '#383a42',
      'editor.selectionBackground': '#e5e5e6',
      'editor.inactiveSelectionBackground': '#f0f0f1',
      'editor.lineHighlightBackground': '#f2f2f2',
      'editorCursor.foreground': '#526fff',
      'editorIndentGuide.background1': '#d3d3d3',
      'editorIndentGuide.activeBackground1': '#939393',
      'editorWhitespace.foreground': '#d3d3d3',
      'editorBracketMatch.background': '#4078f233',
      'editorBracketMatch.border': '#4078f2',
      'editorGutter.background': '#fafafa',
      'editorWidget.background': '#f0f0f1',
      'editorWidget.border': '#d4d4d5',
      'editorSuggestWidget.background': '#f0f0f1',
      'editorSuggestWidget.selectedBackground': '#e5e5e6',
      'editorHoverWidget.background': '#f0f0f1',
      'scrollbarSlider.background': '#00000026',
      'scrollbarSlider.hoverBackground': '#00000040',
      'minimap.background': '#fafafa',
    },
  })
}

/** Paint the editor with a palette. Safe to call before or after creation. */
export function setMonacoTheme(theme: ThemeName): void {
  defineTheme()
  monaco.editor.setTheme(MONACO_THEME[theme])
}

export function editorOptions(
  theme: ThemeName = 'dark',
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    theme: MONACO_THEME[theme],
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
