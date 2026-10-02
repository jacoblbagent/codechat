/**
 * A searchable model picker, used in two places: the chat panel's header badge
 * and the `codechat.model` row in Settings. One component, so the two can never
 * disagree about what is selectable.
 *
 * It is a popover rather than a `<select>` because the catalogue is ~465
 * entries; a native dropdown of that size is a scrollbar with a search box
 * bolted on, which is what this already is.
 */

import {
  cachedModels,
  FALLBACK_MODELS,
  formatContext,
  formatPrice,
  loadModels,
  recentModels,
  rememberModel,
  searchModels,
  shortModelName,
  type OpenRouterModel,
} from './models'

export interface ModelPickerDeps {
  /** The id in force right now. */
  get: () => string
  /** Commit a new id. */
  set: (id: string) => void
  /** Fired after `set`, so sibling surfaces can re-sync. */
  onChange?: () => void
  /** Fired after `set` so the caller can toast / refresh its own label. */
  toasts?: (message: string) => void
}

/** Rendering 465 rows to show the 8 that fit is wasted work. */
const RENDER_CAP = 150

export class ModelPicker {
  private anchor: HTMLElement
  private deps: ModelPickerDeps
  private pop: HTMLElement
  private search: HTMLInputElement
  private freeBox: HTMLInputElement
  private list: HTMLElement
  private foot: HTMLElement

  private models: OpenRouterModel[] | null = null
  private loading = false
  private error = ''
  private open = false
  private query = ''
  private freeOnly = false

  constructor(anchor: HTMLElement, deps: ModelPickerDeps) {
    this.anchor = anchor
    this.deps = deps
    this.models = cachedModels()

    this.pop = document.createElement('div')
    this.pop.className = 'mp-pop is-hidden'
    this.pop.setAttribute('role', 'dialog')
    this.pop.setAttribute('aria-label', 'Select a model')

    const head = document.createElement('div')
    head.className = 'mp-head'

    this.search = document.createElement('input')
    this.search.type = 'text'
    this.search.className = 'mp-search'
    this.search.placeholder = 'Search models…'
    this.search.setAttribute('aria-label', 'Search models')
    this.search.autocomplete = 'off'
    this.search.addEventListener('input', () => {
      this.query = this.search.value
      this.renderList()
    })
    this.search.addEventListener('keydown', (e) => this.onKey(e))

    const free = document.createElement('label')
    free.className = 'mp-free'
    this.freeBox = document.createElement('input')
    this.freeBox.type = 'checkbox'
    this.freeBox.addEventListener('change', () => {
      this.freeOnly = this.freeBox.checked
      this.renderList()
    })
    free.append(this.freeBox, document.createTextNode('Free'))

    head.append(this.search, free)

    this.list = document.createElement('div')
    this.list.className = 'mp-list'
    this.list.setAttribute('role', 'listbox')

    this.foot = document.createElement('div')
    this.foot.className = 'mp-foot'

    this.pop.append(head, this.list, this.foot)
    document.body.appendChild(this.pop)

    this.anchor.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.toggle()
    })
    // The trigger is a toggle, so it reports its own state.
    this.anchor.setAttribute('aria-haspopup', 'dialog')
    this.anchor.setAttribute('aria-expanded', 'false')

    // A click anywhere else closes. Registered on the document so it also
    // catches clicks on surfaces behind the popover.
    document.addEventListener('click', (e) => {
      if (!this.open) return
      const t = e.target as Node
      if (this.pop.contains(t) || this.anchor.contains(t)) return
      this.close()
    })
    document.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') {
        e.stopPropagation()
        this.close()
        this.anchor.focus()
      }
    })
    window.addEventListener('resize', () => this.open && this.position())
    document.getElementById('chat-scroll')?.addEventListener('scroll', () => this.open && this.position())
  }

  get isOpen(): boolean {
    return this.open
  }

  /** Re-read the committed value, e.g. after the settings page changed it. */
  sync(): void {
    if (this.open) this.renderList()
  }

  toggle(): void {
    if (this.open) this.close()
    else this.show()
  }

  show(): void {
    this.open = true
    // Always open on the full list: a filter left over from last time would
    // silently hide the pinned current model.
    this.query = ''
    this.search.value = ''
    this.pop.classList.remove('is-hidden')
    this.anchor.setAttribute('aria-expanded', 'true')
    this.position()
    this.search.focus()
    this.renderList()
    if (!this.models) void this.fetch()
  }

  close(): void {
    this.open = false
    this.pop.classList.add('is-hidden')
    this.anchor.setAttribute('aria-expanded', 'false')
  }

  private async fetch(): Promise<void> {
    if (this.loading || this.models) return
    this.loading = true
    this.error = ''
    this.renderList()
    try {
      this.models = await loadModels()
    } catch (err) {
      this.error = (err as Error).message || 'Could not load models'
      // Keep the three known-good ids so the picker is still usable offline.
      this.models = null
    }
    this.loading = false
    if (this.open) this.renderList()
  }

  private retry(): void {
    this.models = null
    this.error = ''
    void this.fetch()
  }

  private position(): void {
    const r = this.anchor.getBoundingClientRect()
    const width = Math.min(420, Math.max(280, window.innerWidth - 24))
    this.pop.style.width = `${width}px`

    // Prefer below the trigger; flip above when there is no room.
    const spaceBelow = window.innerHeight - r.bottom - 12
    const spaceAbove = r.top - 12
    const height = Math.min(360, Math.max(spaceBelow, 200))
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      this.pop.style.top = 'auto'
      this.pop.style.bottom = `${window.innerHeight - r.top + 6}px`
      this.pop.style.maxHeight = `${Math.min(360, spaceAbove)}px`
    } else {
      this.pop.style.bottom = 'auto'
      this.pop.style.top = `${r.bottom + 6}px`
      this.pop.style.maxHeight = `${height}px`
    }

    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    this.pop.style.left = `${left}px`
  }

  private onKey(e: KeyboardEvent): void {
    const rows = [...this.list.querySelectorAll<HTMLElement>('.mp-row')]
    if (!rows.length) return
    const active = this.list.querySelector<HTMLElement>('.mp-row.is-active')
    let i = active ? rows.indexOf(active) : -1

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      i = Math.min(rows.length - 1, i + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      i = Math.max(0, i - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = active ?? rows[0]
      const id = pick?.dataset.modelId
      if (id) this.commit(id, pick!.dataset.custom === '1')
      return
    } else if (e.key === 'Home') {
      i = 0
    } else if (e.key === 'End') {
      i = rows.length - 1
    } else {
      return
    }

    rows.forEach((r) => r.classList.remove('is-active'))
    const next = rows[i]
    if (!next) return
    next.classList.add('is-active')
    next.setAttribute('aria-selected', 'true')
    next.scrollIntoView({ block: 'nearest' })
  }

  private commit(id: string, custom = false): void {
    if (!custom && id === this.deps.get()) {
      this.close()
      return
    }
    this.deps.set(id)
    rememberModel(id)
    this.close()
    this.deps.toasts?.(custom ? `Model set to ${id}` : `Model: ${shortModelName(id)}`)
    this.deps.onChange?.()
  }

  /* ── render ───────────────────────────────────────────────── */

  private renderList(): void {
    this.list.replaceChildren()

    if (this.loading) {
      this.foot.textContent = 'Loading OpenRouter models…'
      return
    }

    const all = this.models
    if (!all) {
      const note = document.createElement('div')
      note.className = 'mp-note'
      note.textContent = this.error
        ? `${this.error}. Showing the built-in list.`
        : 'No models loaded yet.'
      this.list.appendChild(note)
      this.appendFallbackAndCustom()
      this.renderFoot(FALLBACK_MODELS.length)
      return
    }

    const matches = searchModels(all, { query: this.query, freeOnly: this.freeOnly })

    if (!matches.length && !this.customCandidate()) {
      const note = document.createElement('div')
      note.className = 'mp-note'
      note.textContent = this.freeOnly
        ? 'No free models match that search.'
        : 'No models match that search.'
      this.list.appendChild(note)
      this.renderFoot(0)
      return
    }

    const current = this.deps.get()
    // The catalogue is newest-first, so the model in force can be 300 rows
    // down. Pin it — a picker that will not show you what is selected is
    // asking you to trust it.
    const pinned = this.query ? undefined : all.find((m) => m.id === current)
    const recents = this.query
      ? []
      : recentModels()
          .map((id) => all.find((m) => m.id === id))
          .filter((m): m is OpenRouterModel => !!m && m.id !== current)

    // A free-text id the catalogue does not contain is still selectable —
    // OpenRouter keeps adding models and the cache is a day old at worst.
    const custom = this.customCandidate()
    if (custom) this.list.appendChild(this.rowFor({ model: custom, custom: true }))

    let rendered = 0
    const shown = new Set<string>()
    const push = (m: OpenRouterModel): void => {
      if (rendered >= RENDER_CAP) return
      this.list.appendChild(this.rowFor({ model: m, current }))
      shown.add(m.id)
      rendered += 1
    }
    const group = (label: string): void => {
      const h = document.createElement('div')
      h.className = 'mp-group'
      h.textContent = label
      this.list.appendChild(h)
    }

    if (pinned) {
      group('Current')
      push(pinned)
    }
    if (recents.length) {
      group('Recent')
      for (const m of recents) push(m)
    }
    for (const m of matches) {
      if (shown.has(m.id)) continue
      push(m)
    }

    this.renderFoot(matches.length, rendered)
  }

  private appendFallbackAndCustom(): void {
    const custom = this.customCandidate()
    if (custom) this.list.appendChild(this.rowFor({ model: custom, custom: true }))
    const current = this.deps.get()
    for (const m of this.models ?? FALLBACK_MODELS) {
      this.list.appendChild(this.rowFor({ model: m, current }))
    }
  }

  /** The typed text, when it looks like a model id we do not have. */
  private customCandidate(): OpenRouterModel | null {
    const q = this.query.trim()
    if (!q || !q.includes('/') || /\s/.test(q)) return null
    const known =
      this.models?.some((m) => m.id === q) ?? FALLBACK_MODELS.some((m) => m.id === q)
    // Shaped like a real entry so the row renderer needs no special case
    // beyond the `custom` flag; the prices and context are simply unknown.
    return known ? null : { id: q, name: q, context: 0, promptPrice: 0, completionPrice: 0, created: 0 }
  }

  private renderFoot(total: number, rendered = total): void {
    if (this.error) {
      this.foot.replaceChildren()
      const msg = document.createElement('span')
      msg.className = 'mp-foot-msg'
      msg.textContent = `${this.error} —`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'mp-retry'
      btn.textContent = 'Retry'
      btn.addEventListener('click', () => this.retry())
      this.foot.append(msg, btn)
      return
    }
    const n = this.models?.length ?? 0
    this.foot.textContent =
      rendered < total
        ? `Showing ${rendered} of ${total} matches — keep typing to narrow.`
        : `${total} ${total === 1 ? 'model' : 'models'}${n && total !== n ? ` of ${n}` : ''}`
  }

  private rowFor(opts: {
    model: OpenRouterModel
    current?: string
    custom?: boolean
  }): HTMLElement {
    const { model } = opts
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'mp-row'
    row.dataset.modelId = model.id
    if (opts.custom) row.dataset.custom = '1'
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', model.id === opts.current ? 'true' : 'false')
    if (model.id === opts.current) row.classList.add('is-current')

    const left = document.createElement('span')
    left.className = 'mp-left'

    const name = document.createElement('span')
    name.className = 'mp-name'
    name.textContent = opts.custom ? `Use “${model.id}”` : model.name
    left.appendChild(name)

    if (!opts.custom && model.name !== model.id) {
      const id = document.createElement('span')
      id.className = 'mp-id'
      id.textContent = model.id
      left.appendChild(id)
    }

    const right = document.createElement('span')
    right.className = 'mp-right'
    if (!opts.custom) {
      if (model.context) {
        const ctx = document.createElement('span')
        ctx.className = 'mp-ctx'
        ctx.textContent = formatContext(model.context)
        ctx.title = `${model.context.toLocaleString()} token context window`
        right.appendChild(ctx)
      }
      const price = document.createElement('span')
      const free = model.promptPrice === 0 && model.completionPrice === 0
      price.className = free ? 'mp-price is-free' : 'mp-price'
      price.textContent = formatPrice(model)
      price.title = free ? 'No charge per token' : `${formatPrice(model)} per 1M tokens (prompt/completion)`
      right.appendChild(price)
    }

    if (model.id === opts.current) {
      const tick = document.createElement('span')
      tick.className = 'mp-tick'
      tick.textContent = '✓'
      tick.setAttribute('aria-hidden', 'true')
      right.appendChild(tick)
    }

    row.append(left, right)
    row.addEventListener('click', () => this.commit(model.id, opts.custom === true))
    return row
  }
}
