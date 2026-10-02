/**
 * Settings page.
 *
 * Rendered from the catalogue in `settings.ts`, so adding a setting is a data
 * change. The page replaces the editor area (the way VS Code opens settings in
 * an editor tab) rather than squeezing into the 240px side bar.
 *
 * Every control writes through to the store immediately — there is no Save
 * step, matching VS Code. A setting that differs from its default gets a
 * coloured gutter and a reset arrow.
 */

import { SETTING_GROUPS, type SettingDef } from './settings'

export interface SettingsUiDeps {
  get: (def: SettingDef) => unknown
  isModified: (def: SettingDef) => boolean
  set: (def: SettingDef, value: unknown) => void
  reset: (def: SettingDef) => void
  /**
   * Mount a control for a setting whose options come from a live source (see
   * `SettingDef.optionsSource`). Returns a function that re-reads the value.
   * The host owns this because the catalogue is data and the *control* is not
   * — it is the same model picker the chat panel uses.
   */
  liveSelect?: (def: SettingDef, host: HTMLElement, label: HTMLLabelElement) => () => void
  /**
   * Mount a read-only row (see `SettingDef.infoSource`). Returns a function that
   * redraws it — called on every `refresh()`, so it must not fetch.
   */
  liveInfo?: (def: SettingDef, host: HTMLElement, label: HTMLLabelElement) => () => void
}

const SCOPE_HEAD: Record<string, { title: string; note: string }> = {
  vscode: {
    title: 'VS Code core settings',
    note: 'Editor, workbench and file settings, using the same names VS Code uses.',
  },
  app: {
    title: 'CodeChat',
    note: 'Settings this app adds on top of VS Code.',
  },
}

/** Values that mean "use a value the list does not offer". */
const CUSTOM = '__custom__'

/** Dots are legal in an id but hostile to selectors, so flatten them. */
function domId(def: SettingDef): string {
  return `set-${def.id.replace(/\./g, '-')}`
}

export class SettingsPage {
  private deps: SettingsUiDeps
  private root: HTMLElement
  private list: HTMLElement
  private search: HTMLInputElement
  private empty: HTMLElement
  private rows = new Map<string, { row: HTMLElement; sync: () => void }>()
  private query = ''
  /** 'all', or one of the scopes in the catalogue (`vscode`, `app`). */
  private scope = 'all'
  private chips: HTMLElement[] = []
  private counts = new Map<string, HTMLElement>()

  constructor(deps: SettingsUiDeps) {
    this.deps = deps
    const q = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
    this.root = q('settings-page')
    this.list = q('set-list')
    this.search = q<HTMLInputElement>('set-search')
    this.empty = q('set-empty')

    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase()
      this.applyFilter()
    })
    document.getElementById('btn-settings-close')?.addEventListener('click', () => this.close())

    for (const chip of Array.from(q('set-filter').querySelectorAll<HTMLElement>('.sp-chip'))) {
      this.chips.push(chip)
      const n = chip.querySelector<HTMLElement>('.sp-chip-n')
      if (n) this.counts.set(chip.dataset.scope ?? '', n)
      chip.addEventListener('click', () => this.setScope(chip.dataset.scope ?? 'all'))
    }

    this.build()
    this.renderCounts()
  }

  open(): void {
    this.root.classList.remove('is-hidden')
    this.search.focus()
  }

  close(): void {
    this.root.classList.add('is-hidden')
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('is-hidden')
  }

  /** Re-read every control from the store (used when another surface changes a value). */
  refresh(): void {
    for (const { sync } of this.rows.values()) sync()
  }

  /* ── scope filter ─────────────────────────────────────────── */
  private setScope(scope: string): void {
    this.scope = scope
    for (const chip of this.chips) {
      const on = chip.dataset.scope === scope
      chip.classList.toggle('is-on', on)
      chip.setAttribute('aria-selected', String(on))
    }
    this.applyFilter()
  }

  /** How many settings each chip stands for. Counted from the catalogue. */
  private renderCounts(): void {
    const totals = new Map<string, number>([['all', 0]])
    for (const group of SETTING_GROUPS) {
      totals.set(group.scope, (totals.get(group.scope) ?? 0) + group.settings.length)
      totals.set('all', (totals.get('all') ?? 0) + group.settings.length)
    }
    for (const [scope, el] of this.counts) el.textContent = String(totals.get(scope) ?? 0)
  }

  /* ── build ────────────────────────────────────────────────── */
  private build(): void {
    this.list.replaceChildren()
    this.rows.clear()

    let scope: string | null = null
    for (const group of SETTING_GROUPS) {
      if (group.scope !== scope) {
        scope = group.scope
        const head = SCOPE_HEAD[scope]
        const h = document.createElement('div')
        h.className = 'sp-scope'
        const t = document.createElement('h2')
        t.className = 'sp-scope-title'
        t.textContent = head.title
        const n = document.createElement('p')
        n.className = 'sp-scope-note'
        n.textContent = head.note
        h.append(t, n)
        this.list.appendChild(h)
      }

      const section = document.createElement('section')
      section.className = 'sp-group'
      section.dataset.group = group.id

      const title = document.createElement('h3')
      title.className = 'sp-group-title'
      title.textContent = group.label
      section.appendChild(title)

      for (const def of group.settings) {
        const row = this.buildRow(def)
        section.appendChild(row.row)
        this.rows.set(def.id, row)
      }
      this.list.appendChild(section)
    }
  }

  private buildRow(def: SettingDef): { row: HTMLElement; sync: () => void } {
    const info = def.type === 'info'
    const row = document.createElement('div')
    row.className = info ? 'sp-row is-info' : 'sp-row'
    row.dataset.setting = def.id

    const info_ = document.createElement('div')
    info_.className = 'sp-info'

    const label = document.createElement('label')
    label.className = 'sp-label'
    label.textContent = def.label
    label.htmlFor = domId(def)

    const id = document.createElement('div')
    id.className = 'sp-id'
    id.textContent = def.id

    const desc = document.createElement('div')
    desc.className = 'sp-desc'
    desc.textContent = def.description

    info_.append(label, id, desc)

    const control = document.createElement('div')
    control.className = 'sp-control'
    const sync = this.buildControl(def, control, label)

    row.append(info_, control)

    // A read-only row reports a value; there is nothing to reset.
    if (!info) {
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'sp-reset'
      reset.title = `Reset ${def.label} to its default`
      reset.setAttribute('aria-label', `Reset ${def.label}`)
      reset.textContent = '↺'
      reset.addEventListener('click', () => {
        this.deps.reset(def)
        this.refresh()
      })
      row.appendChild(reset)
    }

    sync()
    return { row, sync }
  }

  private buildControl(
    def: SettingDef,
    host: HTMLElement,
    label: HTMLLabelElement,
  ): () => void {
    const markModified = (): void => {
      const row = host.closest<HTMLElement>('.sp-row')
      row?.classList.toggle('is-modified', this.deps.isModified(def))
    }

    if (def.type === 'info' && this.deps.liveInfo) {
      // It reports a value rather than holding one, so the label must not
      // claim a form control that does not exist.
      label.removeAttribute('for')
      const syncLive = this.deps.liveInfo(def, host, label)
      return () => {
        syncLive()
        markModified()
      }
    }

    if (def.type === 'boolean') {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.id = domId(def)
      input.className = 'sp-check'
      input.addEventListener('change', () => {
        this.deps.set(def, input.checked)
        markModified()
      })
      host.appendChild(input)
      label.htmlFor = input.id
      return () => {
        input.checked = this.deps.get(def) === true
        markModified()
      }
    }

    if (def.type === 'number') {
      const input = document.createElement('input')
      input.type = 'number'
      input.id = domId(def)
      input.className = 'sp-num'
      if (def.min !== undefined) input.min = String(def.min)
      if (def.max !== undefined) input.max = String(def.max)
      input.step = String(def.step ?? 1)
      // Commit on change, not input: a half-typed number is not a value.
      input.addEventListener('change', () => {
        let value = Number(input.value)
        if (!Number.isFinite(value)) {
          input.value = String(this.deps.get(def))
          return
        }
        if (def.min !== undefined) value = Math.max(def.min, value)
        if (def.max !== undefined) value = Math.min(def.max, value)
        this.deps.set(def, value)
        input.value = String(value)
        markModified()
      })
      host.appendChild(input)
      label.htmlFor = input.id
      return () => {
        input.value = String(this.deps.get(def))
        markModified()
      }
    }

    if (def.type === 'select' && def.optionsSource && this.deps.liveSelect) {
      const syncLive = this.deps.liveSelect(def, host, label)
      return () => {
        syncLive()
        markModified()
      }
    }

    if (def.type === 'select') {
      const select = document.createElement('select')
      select.id = domId(def)
      select.className = 'sp-select'
      for (const opt of def.options ?? []) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = opt.label
        select.appendChild(o)
      }
      if (def.allowCustom) {
        const o = document.createElement('option')
        o.value = CUSTOM
        o.textContent = 'Custom…'
        select.appendChild(o)
      }

      let custom: HTMLInputElement | null = null
      if (def.allowCustom) {
        custom = document.createElement('input')
        custom.type = 'text'
        custom.className = 'sp-text is-hidden'
        custom.placeholder = def.placeholder ?? ''
        custom.setAttribute('aria-label', `${def.label} (custom value)`)
        custom.addEventListener('change', () => {
          const value = custom!.value.trim()
          if (value) this.deps.set(def, value)
          this.refresh()
        })
      }

      select.addEventListener('change', () => {
        if (select.value === CUSTOM) {
          custom?.classList.remove('is-hidden')
          custom?.focus()
          return
        }
        this.deps.set(def, select.value)
        this.refresh()
      })

      host.append(select)
      if (custom) host.appendChild(custom)
      label.htmlFor = select.id

      return () => {
        const value = String(this.deps.get(def) ?? '')
        const known = (def.options ?? []).some((o) => o.value === value)
        select.value = known ? value : CUSTOM
        if (custom) {
          custom.classList.toggle('is-hidden', known)
          if (!known) custom.value = value
        }
        markModified()
      }
    }

    // text / password
    const input = document.createElement('input')
    input.type = def.type === 'password' ? 'password' : 'text'
    input.id = domId(def)
    input.className = def.wide ? 'sp-text is-wide' : 'sp-text'
    input.placeholder = def.placeholder ?? ''
    input.autocomplete = 'off'
    // Commit on change (blur / Enter) so a half-typed value never lands.
    input.addEventListener('change', () => {
      this.deps.set(def, input.value.trim())
      markModified()
    })
    host.appendChild(input)
    label.htmlFor = input.id

    if (def.clearable) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'btn sp-clear'
      clear.textContent = 'Clear'
      clear.addEventListener('click', () => {
        this.deps.set(def, '')
        this.refresh()
      })
      host.appendChild(clear)
    }

    return () => {
      const value = String(this.deps.get(def) ?? '')
      if (document.activeElement !== input) input.value = value
      markModified()
    }
  }

  /* ── search ───────────────────────────────────────────────── */
  private applyFilter(): void {
    const q = this.query
    let shown = 0
    for (const group of SETTING_GROUPS) {
      const section = this.list.querySelector<HTMLElement>(`[data-group="${group.id}"]`)
      if (!section) continue
      const inScope = this.scope === 'all' || group.scope === this.scope
      let groupShown = 0
      for (const def of group.settings) {
        const entry = this.rows.get(def.id)
        if (!entry) continue
        const hay = `${def.id} ${def.label} ${def.description} ${group.label}`.toLowerCase()
        const hit = inScope && (!q || q.split(/\s+/).every((part) => hay.includes(part)))
        entry.row.classList.toggle('is-hidden', !hit)
        if (hit) groupShown += 1
      }
      // Hide the whole group (and its scope heading, if it has no groups left)
      section.classList.toggle('is-hidden', groupShown === 0)
      shown += groupShown
    }

    // Scope headings follow their groups.
    for (const head of this.list.querySelectorAll<HTMLElement>('.sp-scope')) {
      let node = head.nextElementSibling
      let any = false
      while (node && !node.classList.contains('sp-scope')) {
        if (!node.classList.contains('is-hidden')) any = true
        node = node.nextElementSibling
      }
      head.classList.toggle('is-hidden', !any)
    }

    this.empty.classList.toggle('is-hidden', shown > 0)
  }
}
