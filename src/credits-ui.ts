/**
 * The Credits row in Settings.
 *
 * Rendered as a read-only block under the API-key row. It never fetches on its
 * own: `sync()` only redraws from the cached snapshot, and `load()` (called when
 * the settings page opens, when the key changes, or from Refresh) is what talks
 * to OpenRouter. The page re-syncs on every settings write, so a fetch in
 * `sync()` would mean a request per keystroke.
 */

import {
  cachedCredits,
  fmtMoney,
  fmtWhen,
  invalidateCredits,
  loadCredits,
  type CreditsSnapshot,
} from './credits'

export interface CreditsDeps {
  getKey: () => string
}

export class CreditsRow {
  private deps: CreditsDeps
  private root: HTMLElement
  private body: HTMLElement
  private pending = false

  constructor(deps: CreditsDeps) {
    this.deps = deps
    this.root = document.createElement('div')
    this.root.className = 'credits'
    this.body = document.createElement('div')
    this.body.className = 'credits-body'
    this.root.appendChild(this.body)
    this.sync()
  }

  get element(): HTMLElement {
    return this.root
  }

  /** Redraw from the cache. Never fetches — the settings page calls this a lot. */
  sync(): void {
    const snapshot = cachedCredits()
    if (this.pending) {
      this.renderMessage('Checking your OpenRouter balance…')
      return
    }
    if (!snapshot) {
      this.renderMessage(
        this.deps.getKey() ? 'Press Refresh to check your balance.' : 'Add an API key above to see your balance.',
      )
      return
    }
    this.render(snapshot)
  }

  /** Fetch (unless cached) and redraw. */
  async load(force = false): Promise<void> {
    if (!this.deps.getKey()) {
      invalidateCredits()
      this.pending = false
      this.sync()
      return
    }
    const cached = cachedCredits()
    if (!force && cached) {
      this.sync()
      return
    }
    this.pending = true
    this.sync()
    const snapshot = await loadCredits(this.deps.getKey(), force)
    this.pending = false
    if (!this.root.isConnected) return
    this.render(snapshot)
  }

  /** The API key changed, so the cached numbers belong to another account. */
  async keyChanged(): Promise<void> {
    invalidateCredits()
    await this.load(true)
  }

  private renderMessage(text: string): void {
    this.body.replaceChildren()
    const p = document.createElement('div')
    p.className = 'credits-note'
    p.textContent = text
    this.body.appendChild(p)
  }

  private render(snapshot: CreditsSnapshot): void {
    this.body.replaceChildren()

    if (snapshot.keyError) {
      const wrap = document.createElement('div')
      wrap.className = 'credits-error'
      const label = document.createElement('span')
      label.textContent = snapshot.keyError
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'credits-refresh'
      retry.textContent = 'Retry'
      retry.addEventListener('click', () => void this.load(true))
      wrap.append(label, retry)
      this.body.appendChild(wrap)
      return
    }

    const key = snapshot.key
    if (!key) {
      this.renderMessage('Press Refresh to check your balance.')
      return
    }

    // The account balance is the headline when the key may read it; otherwise
    // the key's own remaining limit, and failing that nothing but its usage.
    const account = snapshot.account
    let amount: number | null = null
    let suffix = ''
    if (account) {
      amount = account.remaining
      suffix = 'remaining'
    } else if (key.limitRemaining !== null) {
      amount = key.limitRemaining
      suffix = 'left on this key'
    }

    this.root.title = key.label ? `OpenRouter key ${key.label}` : 'OpenRouter'

    const top = document.createElement('div')
    top.className = 'credits-top'

    if (amount !== null) {
      const figure = document.createElement('span')
      figure.className = amount < 0 ? 'credits-amount is-negative' : 'credits-amount'
      figure.textContent = fmtMoney(amount)
      const word = document.createElement('span')
      word.className = 'credits-suffix'
      word.textContent = suffix
      top.append(figure, word)
    } else {
      const figure = document.createElement('span')
      figure.className = 'credits-amount'
      figure.textContent = fmtMoney(key.usage)
      const word = document.createElement('span')
      word.className = 'credits-suffix'
      word.textContent = 'used on this key'
      top.append(figure, word)
    }

    if (key.isFreeTier) top.appendChild(this.chip('Free tier'))

    const refresh = document.createElement('button')
    refresh.type = 'button'
    refresh.className = 'credits-refresh'
    refresh.title = 'Refresh credits'
    refresh.setAttribute('aria-label', 'Refresh credits')
    refresh.textContent = '⟳'
    refresh.addEventListener('click', () => void this.load(true))
    top.appendChild(refresh)
    this.body.appendChild(top)

    const meta = document.createElement('div')
    meta.className = 'credits-meta'
    if (account) {
      meta.textContent = `Used ${fmtMoney(key.usage)} on this key`
    } else if (key.limit !== null) {
      const reset = key.limitReset ? `, resets ${key.limitReset}` : ''
      meta.textContent = `Used ${fmtMoney(key.usage)} on this key · limit ${fmtMoney(key.limit)}${reset}`
    } else {
      meta.textContent = `Used ${fmtMoney(key.usage)} on this key · no spend limit set`
    }
    this.body.appendChild(meta)

    if (account) {
      const line = document.createElement('div')
      line.className = 'credits-meta'
      line.textContent = `Account: ${fmtMoney(account.totalCredits)} purchased · ${fmtMoney(
        account.totalUsage,
      )} used`
      this.body.appendChild(line)
    }

    if (snapshot.accountNeedsManagementKey) {
      const note = document.createElement('div')
      note.className = 'credits-note'
      note.textContent =
        'Account balance needs a provisioning key — this is this key’s own limit and usage.'
      this.body.appendChild(note)
    }

    if (snapshot.accountError) {
      const note = document.createElement('div')
      note.className = 'credits-note is-warn'
      note.textContent = `Account balance unavailable: ${snapshot.accountError}`
      this.body.appendChild(note)
    }

    const foot = document.createElement('div')
    foot.className = 'credits-foot'
    const spend = document.createElement('span')
    const parts: string[] = []
    if (key.usageDaily !== null) parts.push(`today ${fmtMoney(key.usageDaily)}`)
    if (key.usageMonthly !== null) parts.push(`this month ${fmtMoney(key.usageMonthly)}`)
    if (key.expiresAt) parts.push(`key expires ${key.expiresAt.slice(0, 10)}`)
    spend.textContent = parts.join(' · ')
    const when = document.createElement('span')
    when.className = 'credits-when'
    when.textContent = fmtWhen(snapshot.fetchedAt)
    foot.append(spend, when)
    this.body.appendChild(foot)
  }

  private chip(text: string): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'credits-chip'
    chip.textContent = text
    return chip
  }
}
