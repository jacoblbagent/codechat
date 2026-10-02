/**
 * `settings.json` — the settings catalogue as text, with both directions live.
 *
 * The document is flat and uses each setting's real id (`"editor.fontSize"`),
 * which is the same id the settings page and `localStorage` use, so there is
 * exactly one name for every setting.
 *
 * Two behaviours are worth stating because they are easy to get wrong:
 *
 *  - A key that is *absent* from an applied document goes back to its default,
 *    the way deleting a line in VS Code's settings.json does. That only happens
 *    once the text parses — a syntax error applies nothing at all.
 *  - When a setting changes elsewhere, the file is **patched key by key** rather
 *    than re-serialised, so a user's own ordering, indentation and blank lines
 *    survive. It falls back to a full rewrite if a key cannot be patched.
 */

import { editorOptions, monaco } from './monaco'
import { ALL_SETTINGS, type SettingDef } from './settings'

/** Every setting the document carries. A read-only `info` row is not a setting. */
export const JSON_SETTINGS: SettingDef[] = ALL_SETTINGS.filter((d) => d.type !== 'info')

export interface ParseResult {
  values: Record<string, unknown>
  /** Keys that are not settings at all. */
  unknown: string[]
  /** Keys whose value does not fit the setting's type. */
  invalid: { id: string; reason: string }[]
  /** Set when the document is not JSON; nothing is applied in that case. */
  error?: string
}

/** Every value is a primitive, so a value's JSON text is one line. */
export function serializeSettings(get: (def: SettingDef) => unknown): string {
  const out: Record<string, unknown> = {}
  for (const def of JSON_SETTINGS) out[def.id] = get(def)
  return `${JSON.stringify(out, null, 2)}\n`
}

/** `{ 'editor.fontSize': '13' }` — cheap comparison between two states. */
function snapshot(get: (def: SettingDef) => unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const def of JSON_SETTINGS) out[def.id] = JSON.stringify(get(def))
  return out
}

function describe(def: SettingDef, value: unknown): string | null {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'needs true or false'
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'needs a number'
      if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`
      if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`
      return null
    }
    case 'select': {
      if (typeof value !== 'string') return 'needs a string'
      const options = def.options ?? []
      // A select with no fixed options takes whatever the live source offers.
      if (!options.length || def.allowCustom) return null
      return options.some((o) => o.value === value)
        ? null
        : `must be one of ${options.map((o) => o.value).join(', ')}`
    }
    default:
      return typeof value === 'string' ? null : 'needs a string'
  }
}

export function parseSettings(text: string): ParseResult {
  const result: ParseResult = { values: {}, unknown: [], invalid: [] }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    result.error = (err as Error).message
    return result
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    result.error = 'the document must be an object of settings'
    return result
  }

  const known = new Map(JSON_SETTINGS.map((def) => [def.id, def]))
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const def = known.get(id)
    if (!def) {
      result.unknown.push(id)
      continue
    }
    const reason = describe(def, value)
    if (reason) result.invalid.push({ id, reason })
    else result.values[id] = value
  }
  return result
}

/**
 * Replace one key's value in place, leaving the rest of the document — its
 * order, indentation and blank lines — exactly as the user typed it. Returns
 * null when the key is not there in a shape we can patch.
 */
export function patchValue(text: string, id: string, valueText: string): string | null {
  const key = JSON.stringify(id)
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^(\\s*)(${escaped})(\\s*:\\s*)([^\\n]*?)(,?)(\\s*)$`, 'm')
  const match = re.exec(text)
  if (!match) return null
  const line = `${match[1]}${match[2]}${match[3]}${valueText}${match[5]}${match[6]}`
  return text.slice(0, match.index) + line + text.slice(match.index + match[0].length)
}

export interface SettingsJsonDeps {
  get: (def: SettingDef) => unknown
  /** Apply a whole document: present keys are set, absent keys revert. */
  apply: (values: Record<string, unknown>) => void
}

/** Debounce between a keystroke and applying the document. */
const APPLY_DELAY = 350
const MODEL_URI = 'inmemory://codechat/settings.json'

export class SettingsJsonView {
  private deps: SettingsJsonDeps
  private root: HTMLElement
  private host: HTMLElement
  private status: HTMLElement
  private editor: monaco.editor.IStandaloneCodeEditor | null = null
  private model: monaco.editor.ITextModel | null = null
  /** True while the app is the one writing, so the change handler stays quiet. */
  private writing = false
  /** The text as last applied — the reference for "does the user have edits?". */
  private appliedText = ''
  private appliedValues: Record<string, string> = {}
  private timer: number | null = null

  constructor(deps: SettingsJsonDeps) {
    this.deps = deps
    this.root = document.getElementById('settings-json') as HTMLElement
    this.host = document.getElementById('sj-host') as HTMLElement
    this.status = document.getElementById('sj-status') as HTMLElement
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('is-hidden')
  }

  open(): void {
    this.mount()
    this.root.classList.remove('is-hidden')
    // Always reopen on what is actually stored: other surfaces may have moved on
    // while this was hidden, and there is nothing worth preserving in stale text.
    this.write(serializeSettings(this.deps.get))
    this.appliedText = this.model?.getValue() ?? ''
    this.appliedValues = snapshot(this.deps.get)
    this.setStatus('')
    this.editor?.layout()
    this.editor?.focus()
  }

  close(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
      this.applyNow()
    }
    this.root.classList.add('is-hidden')
  }

  /** A setting changed somewhere else — patch this file to match. */
  externalChange(): void {
    if (!this.model) return
    const now = snapshot(this.deps.get)
    const changed = JSON_SETTINGS
      .map((def) => def.id)
      .filter((id) => now[id] !== this.appliedValues[id])
    if (!changed.length) return

    if ((this.model.getValue() ?? '') !== this.appliedText) {
      // The user's text does not match what was last applied, so they are
      // mid-edit (or fixing an error). Do not overwrite their work.
      this.setStatus('This file has edits that have not been applied', 'warn')
      return
    }

    let text = this.appliedText
    let patched = true
    for (const id of changed) {
      const next = patchValue(text, id, now[id])
      if (next === null) {
        patched = false
        break
      }
      text = next
    }
    if (!patched) text = serializeSettings(this.deps.get)

    this.write(text)
    this.appliedText = this.model?.getValue() ?? ''
    this.appliedValues = now
    this.setStatus(`Updated ${changed.length} setting${changed.length === 1 ? '' : 's'}`, 'ok')
  }

  /* ── internals ────────────────────────────────────────────── */

  private mount(): void {
    if (this.editor) return
    this.model = monaco.editor.createModel('', 'json', monaco.Uri.parse(MODEL_URI))
    this.editor = monaco.editor.create(this.host, {
      ...editorOptions(),
      model: this.model,
      minimap: { enabled: false },
      wordWrap: 'on',
      renderWhitespace: 'none',
      stickyScroll: { enabled: false },
      tabSize: 2,
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      fixedOverflowWidgets: true,
    })
    this.model.onDidChangeContent(() => {
      if (this.writing) return
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = null
        this.applyNow()
      }, APPLY_DELAY)
    })
  }

  private applyNow(): void {
    const model = this.model
    if (!model) return
    const text = model.getValue()
    const parsed = parseSettings(text)

    if (parsed.error) {
      this.setStatus(`Not applied — ${parsed.error}`, 'err')
      return
    }

    this.deps.apply(parsed.values)
    this.appliedText = text
    this.appliedValues = snapshot(this.deps.get)

    const notes: string[] = []
    if (parsed.invalid.length) {
      notes.push(
        `${parsed.invalid.length} value${parsed.invalid.length === 1 ? '' : 's'} ignored (${parsed.invalid
          .slice(0, 2)
          .map((i) => `${i.id} ${i.reason}`)
          .join('; ')}${parsed.invalid.length > 2 ? '; …' : ''})`,
      )
    }
    if (parsed.unknown.length) {
      notes.push(
        `${parsed.unknown.length} unknown key${parsed.unknown.length === 1 ? '' : 's'} (${parsed.unknown
          .slice(0, 2)
          .join(', ')}${parsed.unknown.length > 2 ? ', …' : ''})`,
      )
    }
    this.setStatus(notes.length ? `Applied — ${notes.join(' · ')}` : 'Applied', notes.length ? 'warn' : 'ok')
  }

  /** Write text in without treating it as a user edit, and keep undo usable. */
  private write(text: string): void {
    const model = this.model
    if (!model || model.getValue() === text) return
    this.writing = true
    model.pushEditOperations(null, [{ range: model.getFullModelRange(), text }], () => null)
    this.writing = false
  }

  private setStatus(message: string, kind: 'ok' | 'warn' | 'err' | 'none' = 'none'): void {
    this.status.textContent = message
    this.status.classList.toggle('is-ok', kind === 'ok')
    this.status.classList.toggle('is-warn', kind === 'warn')
    this.status.classList.toggle('is-err', kind === 'err')
  }
}
