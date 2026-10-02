import {
  ApiError,
  DEFAULT_MODEL,
  streamChat,
  type ChatMessage,
  type ReasoningEffort,
} from './deepseek'
import { shortModelName, vendorOf } from './models'
import { renderMarkdown } from './markdown'

export type ChatStatus = 'idle' | 'ready' | 'busy' | 'error'

export interface ChatContext {
  path: string | null
  language: string
  content: string
  selection: string
  /** 1-based line range of `selection`, when there is one. */
  selectionLines: { start: number; end: number } | null
}

export interface ChatConfig {
  maxContextChars: number
  apiKey: string
  model: string
  reasoning: ReasoningEffort
}

export interface ChatDeps {
  getContext: () => ChatContext
  getConfig: () => ChatConfig
  insertCode: (code: string) => void
  applyToActiveFile: (code: string) => void
  createFileFromCode: (code: string, lang: string) => void
  toast: (message: string, kind?: 'ok' | 'err') => void
  openSettings: () => void
  onStatus: (status: ChatStatus) => void
}

const SYSTEM_PROMPT = [
  'You are DeepSeek, an expert programming assistant embedded in CodeChat —',
  'a VS Code-style browser IDE. You help with the code in the user workspace.',
  '',
  'Rules:',
  '- Be concise and concrete. Prefer working code over prose.',
  '- Always fence code with a language tag (```ts, ```css, ```bash …).',
  '- When you rewrite a whole file, output the complete file in one code block.',
  '- When the user references "the file" or "this", they mean the active file shown in context.',
  '- Do not invent APIs, files, or line numbers you have not been shown.',
  '- If context is missing, say what you need instead of guessing.',
].join('\n')

const COMMANDS: Record<string, string> = {
  '/explain': 'Explain what the active file does, its structure, and any notable risks. Be brief and concrete.',
  '/fix': 'Find the bugs in the active file and return the corrected code in full, with a short list of what you changed.',
  '/tests': 'Write focused tests for the active file. Use the most idiomatic test runner for its language.',
  '/refactor': 'Refactor the active file for clarity. Keep behaviour identical and explain each change in one line.',
  '/docs': 'Add concise doc comments to the active file and return the updated file.',
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
  el?: HTMLElement
  bodyEl?: HTMLElement
  /** Set once the stream has finished, so late rAF renders can't strip the footer. */
  done?: boolean
  /** Reasoning streamed before the answer, when the model emitted any. */
  reasoning?: string
  /** Whether the reasoning panel is expanded; unset follows the streaming state. */
  thinkOpen?: boolean
  /** Bounds of the thinking phase, for the "Thought for 2.1s" label. */
  thinkStart?: number
  thinkEnd?: number
}

/** One source feeding the next request, with its exact size. */
interface CtxSegment {
  kind: 'file' | 'selection' | 'pinned'
  label: string
  chars: number
  truncated?: boolean
}

/**
 * "Thinking…" while it streams, then how long it took — falling back to the
 * reasoning's size when the phase was too short to be worth timing (which also
 * happens when every chunk arrives in the same tick).
 */
function thinkLabel(turn: Turn, chars: number, streaming: boolean): string {
  if (streaming || !turn.thinkEnd) return 'Thinking…'
  const ms = turn.thinkStart ? turn.thinkEnd - turn.thinkStart : 0
  return ms >= 100 ? `Thought for ${(ms / 1000).toFixed(1)}s` : `Thought · ${chars.toLocaleString()} chars`
}

function fmtChars(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
}

export class ChatPanel {
  private deps: ChatDeps
  private turns: Turn[] = []
  private controller: AbortController | null = null
  private streaming = false
  private rafPending = false
  /** A chunk of code attached with Ctrl+L, sent with the next message. */
  private pinned: { code: string; language: string; where: string } | null = null

  private el: {
    panel: HTMLElement
    scroll: HTMLElement
    messages: HTMLElement
    empty: HTMLElement
    input: HTMLTextAreaElement
    send: HTMLButtonElement
    stop: HTMLButtonElement
    hint: HTMLElement
    ctxFile: HTMLElement
    include: HTMLInputElement
    selection: HTMLInputElement
    model: HTMLElement
    vendor: HTMLElement
    pin: HTMLElement
    pinLabel: HTMLElement
    vizBar: HTMLElement
    vizLegend: HTMLElement
  }

  /** Cap on the whole-file context block — set in the settings page. */
  private get maxContextChars(): number {
    const n = this.deps.getConfig().maxContextChars
    return Number.isFinite(n) && n > 0 ? n : 24000
  }

  constructor(deps: ChatDeps) {
    this.deps = deps
    const q = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
    this.el = {
      panel: q('chat'),
      scroll: q('chat-scroll'),
      messages: q('messages'),
      empty: q('chat-empty'),
      input: q('chat-input') as HTMLTextAreaElement,
      send: q('btn-send') as HTMLButtonElement,
      stop: q('btn-stop') as HTMLButtonElement,
      hint: q('compose-hint'),
      ctxFile: q('ctx-file'),
      include: q('ctx-include') as HTMLInputElement,
      selection: q('ctx-selection') as HTMLInputElement,
      model: q('chat-model'),
      vendor: q('chat-vendor'),
      pin: q('ctx-pin'),
      pinLabel: q('ctx-pin-label'),
      vizBar: q('ctx-viz-bar'),
      vizLegend: q('ctx-viz-legend'),
    }
    this.wire()
    this.refreshModelBadge()
    this.refreshContextViz()
  }

  /* ── wiring ───────────────────────────────────────────────── */
  private wire(): void {
    this.el.send.addEventListener('click', () => void this.send())
    this.el.stop.addEventListener('click', () => this.stop())

    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void this.send()
      }
    })
    this.el.input.addEventListener('input', () => {
      this.autoGrow()
      this.el.hint.textContent = this.el.input.value.trimStart().startsWith('/')
        ? 'Slash command — Enter to run'
        : 'Enter to send · Shift+Enter newline'
    })

    document.getElementById('btn-new-chat')?.addEventListener('click', () => this.newChat())
    document.getElementById('btn-add-selection')?.addEventListener('click', () => this.addSelectionToChat())
    document.getElementById('ctx-pin-clear')?.addEventListener('click', () => this.clearPin())

    this.el.messages.addEventListener('click', (e) => this.onMessageClick(e))

    for (const box of [this.el.include, this.el.selection]) {
      box.addEventListener('change', () => this.refreshContextViz())
    }

    for (const chip of document.querySelectorAll<HTMLElement>('.chip[data-prompt]')) {
      chip.addEventListener('click', () => {
        this.el.input.value = chip.dataset.prompt ?? ''
        void this.send()
      })
    }
  }

  private onMessageClick(e: Event): void {
    // Reasoning panel: flip it and re-render. The open state is read back off
    // the DOM, so there is only ever one source of truth for what is expanded.
    const thinkBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-think]')
    if (thinkBtn) {
      const turn = this.turns[Number(thinkBtn.dataset.think)]
      if (turn) {
        turn.thinkOpen = !thinkBtn.closest('.think')?.classList.contains('is-open')
        this.renderTurn(turn)
      }
      return
    }

    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!target) {
      const retry = (e.target as HTMLElement).closest<HTMLElement>('[data-retry]')
      if (retry) void this.regenerate()
      const copyMsg = (e.target as HTMLElement).closest<HTMLElement>('[data-copy-msg]')
      if (copyMsg) {
        const idx = Number(copyMsg.dataset.copyMsg)
        void navigator.clipboard.writeText(this.turns[idx]?.content ?? '').then(
          () => this.deps.toast('Message copied', 'ok'),
          () => this.deps.toast('Clipboard unavailable', 'err'),
        )
      }
      return
    }

    const act = target.dataset.act!
    const wrapper = target.closest<HTMLElement>('.codeblock')
    if (!wrapper) return
    const codeEl = wrapper.querySelector('code')
    const code = codeEl?.textContent ?? ''
    const lang = wrapper.querySelector('.codeblock-lang')?.textContent ?? 'ts'

    if (act === 'copy') {
      void navigator.clipboard.writeText(code).then(
        () => this.deps.toast('Code copied', 'ok'),
        () => this.deps.toast('Clipboard unavailable', 'err'),
      )
    } else if (act === 'insert') {
      this.deps.insertCode(code)
    } else if (act === 'apply') {
      this.deps.applyToActiveFile(code)
    } else if (act === 'file') {
      this.deps.createFileFromCode(code, lang)
    }
  }

  /* ── public api ───────────────────────────────────────────── */
  focus(): void {
    this.el.input.focus()
  }

  refreshModelBadge(): void {
    const { model } = this.deps.getConfig()
    const id = model || DEFAULT_MODEL
    this.el.model.textContent = shortModelName(id)
    this.el.model.title = id
    // The header used to read "DeepSeek" unconditionally; now that any model
    // is selectable, the label has to follow the picker or it lies.
    this.el.vendor.textContent = vendorOf(id)
    this.el.vendor.title = id
  }

  setActiveFile(path: string | null): void {
    this.el.ctxFile.textContent = path ? path.split('/').pop()! : 'no file'
    this.el.ctxFile.title = path ?? ''
    this.syncApplyButtons()
    this.refreshContextViz()
  }

  /**
   * Point every "Replace …" code-block button at whichever file is open *now*,
   * so it is always obvious which file a click would overwrite.
   */
  private syncApplyButtons(): void {
    const path = this.deps.getContext().path
    const name = path ? path.split('/').pop()! : ''
    for (const btn of this.el.messages.querySelectorAll<HTMLButtonElement>('[data-act="apply"]')) {
      btn.textContent = name ? `Replace ${name}` : 'Replace file'
      btn.title = path
        ? `Replace the whole contents of ${path} with this block`
        : 'Open a file first'
      btn.disabled = !path
    }
  }

  /**
   * Attach the editor's current selection to the next message (Ctrl+L).
   * Returns false when nothing is selected, so callers can skip revealing the
   * panel for a no-op.
   */
  addSelectionToChat(): boolean {
    const ctx = this.deps.getContext()
    const code = ctx.selection.trim()
    if (!code) {
      this.deps.toast('Select some code in the editor first', 'err')
      return false
    }
    const lines = ctx.selectionLines
    const where = `${ctx.path ?? 'editor'}${
      lines ? `:${lines.start}${lines.end !== lines.start ? `-${lines.end}` : ''}` : ''
    }`
    this.pinned = { code, language: ctx.language || 'plaintext', where }
    this.renderPin()
    this.el.input.focus()
    return true
  }

  private renderPin(): void {
    const p = this.pinned
    this.el.pin.classList.toggle('is-hidden', !p)
    if (p) {
      const lineCount = p.code.split('\n').length
      this.el.pinLabel.textContent = `${p.where} · ${lineCount} line${lineCount === 1 ? '' : 's'}`
      this.el.pinLabel.title = p.code
    }
    this.refreshContextViz()
  }

  private clearPin(): void {
    this.pinned = null
    this.renderPin()
  }

  newChat(): void {
    if (this.streaming) this.stop()
    this.clearPin()
    this.turns = []
    this.el.messages.innerHTML = ''
    this.el.empty.classList.remove('is-hidden')
    this.deps.onStatus('idle')
  }

  /* ── sending ──────────────────────────────────────────────── */
  private buildUserContent(raw: string): string {
    const text = raw.trim()
    const expanded = Object.entries(COMMANDS).find(([cmd]) => text === cmd || text.startsWith(`${cmd} `))
    const instruction = expanded
      ? text.length > expanded[0].length
        ? `${expanded[1]}\n\nAdditional request: ${text.slice(expanded[0].length).trim()}`
        : expanded[1]
      : text

    return [instruction, ...this.contextPayload().blocks].join('\n')
  }

  /**
   * The context blocks that ride along with the next message, plus a description
   * of each. Built in ONE place, so the meter under the chat can never disagree
   * with what actually goes over the wire.
   */
  private contextPayload(): { blocks: string[]; segs: CtxSegment[]; truncated: boolean } {
    const ctx = this.deps.getContext()
    const lang = ctx.language || 'plaintext'
    const blocks: string[] = []
    const segs: CtxSegment[] = []

    if (this.el.include.checked && ctx.path) {
      const full = ctx.content
      const truncated = full.length > this.maxContextChars
      const content = truncated ? full.slice(0, this.maxContextChars) : full
      blocks.push('', '---', `Active file: \`${ctx.path}\` (${lang})`, '```' + lang, content, '```')
      if (truncated) blocks.push(`\n(Note: the file was truncated to ${this.maxContextChars} characters.)`)
      segs.push({ kind: 'file', label: ctx.path.split('/').pop()!, chars: content.length, truncated })
    }

    // A chunk pinned with Ctrl+L, or the live selection when its box is ticked.
    // Either can be sent on its own, with the whole-file block turned off.
    const pinned = this.pinned
    const code = pinned ? pinned.code : this.el.selection.checked ? ctx.selection.trim() : ''
    if (code) {
      const label = pinned ? `Selected code from \`${pinned.where}\`` : 'Selected text'
      blocks.push('', `${label}:`, '```' + (pinned?.language || lang), code, '```')
      segs.push({
        kind: pinned ? 'pinned' : 'selection',
        label: pinned ? pinned.where : `${code.split('\n').length} lines`,
        chars: code.length,
      })
    }

    return { blocks, segs, truncated: segs.some((s) => s.truncated) }
  }

  /** Redraw the meter showing what the next message will carry. */
  refreshContextViz(): void {
    const { segs, truncated } = this.contextPayload()
    const total = segs.reduce((n, s) => n + s.chars, 0)

    // Composition bar: segments are proportional to the total, so a small
    // selection stays visible next to a whole file.
    this.el.vizBar.replaceChildren()
    if (total > 0) {
      for (const s of segs) {
        const span = document.createElement('span')
        span.className = `ctx-seg kind-${s.kind}`
        span.style.width = `${(s.chars / total) * 100}%`
        this.el.vizBar.appendChild(span)
      }
    }

    this.el.vizLegend.replaceChildren()
    if (!segs.length) {
      const empty = document.createElement('span')
      empty.textContent = 'No context attached — tick include, or select code'
      this.el.vizLegend.appendChild(empty)
      return
    }

    for (const s of segs) {
      const chip = document.createElement('span')
      chip.className = `ctx-chip kind-${s.kind}`
      const name = document.createElement('b')
      name.textContent = s.label
      chip.append(name, document.createTextNode(` ${fmtChars(s.chars)}`))
      chip.title = `${s.label} — ${s.chars.toLocaleString()} characters`
      this.el.vizLegend.appendChild(chip)
    }

    if (truncated) {
      const warn = document.createElement('span')
      warn.className = 'ctx-chip is-warn'
      warn.textContent = `file cut at ${fmtChars(this.maxContextChars)}`
      warn.title = `The whole-file block is capped at ${this.maxContextChars.toLocaleString()} characters`
      this.el.vizLegend.appendChild(warn)
    }

    const totalEl = document.createElement('span')
    totalEl.className = 'ctx-viz-total'
    totalEl.textContent = `${fmtChars(total)} chars`
    this.el.vizLegend.appendChild(totalEl)
  }

  async send(preset?: string): Promise<void> {
    if (this.streaming) return
    const text = (preset ?? this.el.input.value).trim()
    if (!text) return

    const { apiKey } = this.deps.getConfig()
    if (!apiKey) {
      this.pushSystem('No OpenRouter API key is set, so the request was not sent.')
      this.pushAction('Set API key', () => this.deps.openSettings())
      return
    }

    const wireContent = this.buildUserContent(text)
    this.clearPin() // the attachment is consumed by the message it rode along with
    this.el.input.value = ''
    this.autoGrow()
    this.el.empty.classList.add('is-hidden')

    this.addTurn('user', text)
    const assistant = this.addTurn('assistant', '')
    this.el.stop.hidden = false
    this.el.send.disabled = true
    this.streaming = true
    this.deps.onStatus('busy')

    const history: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.turns
        .slice(0, -1)
        .filter((t) => t.content.trim())
        .slice(-14)
        .map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    ]
    // The newest user turn carries the injected context, so swap it in.
    const lastUser = history.map((m, i) => ({ m, i })).filter((x) => x.m.role === 'user').pop()
    if (lastUser) history[lastUser.i] = { role: 'user', content: wireContent }
    else history.push({ role: 'user', content: wireContent })

    this.controller = new AbortController()
    let buffer = ''

    try {
      await streamChat(history, {
        apiKey,
        model: this.deps.getConfig().model,
        reasoning: this.deps.getConfig().reasoning,
        signal: this.controller.signal,
        onDelta: (chunk) => {
          // The first answer token closes out the thinking phase.
          if (assistant.thinkStart && !assistant.thinkEnd) assistant.thinkEnd = Date.now()
          buffer += chunk
          assistant.content = buffer
          this.scheduleRender(assistant)
          this.scrollIfNearBottom()
        },
        onReasoning: (chunk) => {
          if (!assistant.thinkStart) assistant.thinkStart = Date.now()
          assistant.reasoning = (assistant.reasoning ?? '') + chunk
          this.scheduleRender(assistant)
          this.scrollIfNearBottom()
        },
      })
      assistant.content = buffer || '(The model returned an empty response.)'
      this.finalize(assistant)
      this.deps.onStatus('ready')
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        assistant.content = buffer || '(stopped)'
        this.finalize(assistant)
        this.deps.toast('Generation stopped', 'ok')
        this.deps.onStatus(buffer ? 'ready' : 'idle')
      } else {
        const message = err instanceof ApiError ? err.message : (err as Error).message
        assistant.done = true
        if (assistant.content.trim()) this.renderTurn(assistant)
        else {
          assistant.el?.remove()
          this.turns.pop()
        }
        this.pushSystem(message)
        if (err instanceof ApiError && (err.status === 401 || err.status === 402 || err.status === 403)) {
          this.pushAction('Open settings', () => this.deps.openSettings())
        }
        this.deps.onStatus('error')
      }
    } finally {
      this.streaming = false
      this.el.stop.hidden = true
      this.el.send.disabled = false
      this.controller = null
      this.el.input.focus()
      this.refreshModelBadge()
    }
  }

  private async regenerate(): Promise<void> {
    // Drop the trailing assistant turn, re-send the last user turn.
    const lastUserIdx = [...this.turns].reverse().findIndex((t) => t.role === 'user')
    if (lastUserIdx < 0) return
    const idx = this.turns.length - 1 - lastUserIdx
    const text = this.turns[idx].content
    this.turns = this.turns.slice(0, idx)
    this.el.messages.innerHTML = ''
    for (const t of this.turns) {
      t.done = true
      this.renderTurn(t)
    }
    await this.send(text)
  }

  stop(): void {
    this.controller?.abort()
  }

  /* ── rendering ────────────────────────────────────────────── */
  private addTurn(role: 'user' | 'assistant', content: string): Turn {
    const turn: Turn = { role, content }

    const el = document.createElement('div')
    el.className = `msg msg-${role}`

    const roleEl = document.createElement('div')
    roleEl.className = 'msg-role'
    roleEl.innerHTML =
      role === 'user'
        ? '<span class="who-user">You</span>'
        : '<span class="who-ai">✦ DeepSeek</span>'

    const actions = document.createElement('span')
    actions.className = 'msg-actions'
    actions.innerHTML = `<button class="cb-btn" data-copy-msg="${this.turns.length}">Copy</button>`
    roleEl.appendChild(actions)

    const body = document.createElement('div')
    body.className = 'msg-body'

    el.append(roleEl, body)
    this.el.messages.appendChild(el)

    turn.el = el
    turn.bodyEl = body
    this.turns.push(turn)

    if (role === 'user') {
      turn.done = true
      this.renderTurn(turn)
    } else body.classList.add('cursor-blink')

    return turn
  }

  private renderTurn(turn: Turn): void {
    if (!turn.bodyEl) return
    if (turn.role === 'user') {
      turn.bodyEl.textContent = turn.content
      return
    }
    const assistantStreaming = !turn.done
    turn.bodyEl.classList.toggle('cursor-blink', assistantStreaming && !turn.content)
    const { html } = renderMarkdown(turn.content)
    turn.bodyEl.innerHTML = html

    // Reasoning comes first when the model emitted any: expanded while it is the
    // only thing to read, collapsed once the answer takes over.
    const reasoning = (turn.reasoning ?? '').trim()
    if (reasoning) {
      const open = turn.thinkOpen ?? (assistantStreaming && !turn.content.trim())
      turn.bodyEl.prepend(this.buildThinkBlock(turn, reasoning, open))
    }

    if (!assistantStreaming && turn.content.trim()) {
      const footer = document.createElement('div')
      footer.className = 'msg-actions'
      footer.innerHTML = '<button class="cb-btn" data-retry="1">Regenerate</button>'
      turn.bodyEl.appendChild(footer)
    }
  }

  /** The collapsible "Thinking…" panel. The text arrives via textContent — it is model output. */
  private buildThinkBlock(turn: Turn, reasoning: string, open: boolean): HTMLElement {
    const box = document.createElement('div')
    box.className = `think${open ? ' is-open' : ''}`

    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'think-head'
    head.dataset.think = String(this.turns.indexOf(turn))
    head.setAttribute('aria-expanded', String(open))
    head.innerHTML =
      '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'
    const label = document.createElement('span')
    label.textContent = thinkLabel(turn, reasoning.length, !turn.done)
    head.appendChild(label)

    const body = document.createElement('div')
    body.className = 'think-body'
    body.textContent = reasoning

    box.append(head, body)
    return box
  }

  private scheduleRender(turn: Turn): void {
    if (this.rafPending || turn.done) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      if (!turn.done) this.renderTurn(turn)
    })
  }

  /** Mark a turn finished and render its final state exactly once. */
  private finalize(turn: Turn): void {
    turn.done = true
    this.renderTurn(turn)
    this.syncApplyButtons()
  }

  private pushSystem(text: string): void {
    const el = document.createElement('div')
    el.className = 'msg'
    el.innerHTML = `<div class="msg-err">${escapeText(text)}</div>`
    this.el.messages.appendChild(el)
    this.scrollIfNearBottom(true)
  }

  private pushAction(label: string, onClick: () => void): void {
    const el = document.createElement('div')
    el.className = 'msg'
    const btn = document.createElement('button')
    btn.className = 'btn btn-primary'
    btn.textContent = label
    btn.style.width = 'fit-content'
    btn.addEventListener('click', onClick)
    el.appendChild(btn)
    this.el.messages.appendChild(el)
    this.scrollIfNearBottom(true)
  }

  private scrollIfNearBottom(force = false): void {
    const s = this.el.scroll
    const near = s.scrollHeight - s.scrollTop - s.clientHeight < 140
    if (force || near) s.scrollTop = s.scrollHeight
  }

  private autoGrow(): void {
    const t = this.el.input
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`
  }
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
