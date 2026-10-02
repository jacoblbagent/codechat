import { ApiError, DEFAULT_MODEL, shortModelName, streamChat, type ChatMessage } from './deepseek'
import { renderMarkdown } from './markdown'

export type ChatStatus = 'idle' | 'ready' | 'busy' | 'error'

export interface ChatContext {
  path: string | null
  language: string
  content: string
  selection: string
}

export interface ChatConfig {
  apiKey: string
  model: string
  temperature: number
}

export interface ChatDeps {
  getContext: () => ChatContext
  getConfig: () => ChatConfig
  insertCode: (code: string) => void
  createFileFromCode: (code: string, lang: string) => void
  toast: (message: string, kind?: 'ok' | 'err') => void
  openSettings: () => void
  onStatus: (status: ChatStatus) => void
}

const MAX_CONTEXT_CHARS = 24000

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
}

export class ChatPanel {
  private deps: ChatDeps
  private turns: Turn[] = []
  private controller: AbortController | null = null
  private streaming = false
  private rafPending = false

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
    }
    this.wire()
    this.refreshModelBadge()
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

    this.el.messages.addEventListener('click', (e) => this.onMessageClick(e))

    for (const chip of document.querySelectorAll<HTMLElement>('.chip[data-prompt]')) {
      chip.addEventListener('click', () => {
        this.el.input.value = chip.dataset.prompt ?? ''
        void this.send()
      })
    }
  }

  private onMessageClick(e: Event): void {
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
    this.el.model.textContent = shortModelName(model || DEFAULT_MODEL)
    this.el.model.title = model || DEFAULT_MODEL
  }

  setActiveFile(path: string | null): void {
    this.el.ctxFile.textContent = path ? path.split('/').pop()! : 'no file'
    this.el.ctxFile.title = path ?? ''
  }

  newChat(): void {
    if (this.streaming) this.stop()
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

    const ctx = this.deps.getContext()
    const includeFile = this.el.include.checked
    const includeSel = this.el.selection.checked

    if (!includeFile || !ctx.path) return instruction

    let content = ctx.content
    let truncated = false
    if (content.length > MAX_CONTEXT_CHARS) {
      content = content.slice(0, MAX_CONTEXT_CHARS)
      truncated = true
    }

    const parts = [
      instruction,
      '',
      '---',
      `Active file: \`${ctx.path}\` (${ctx.language})`,
      '```' + ctx.language,
      content,
      '```',
    ]
    if (truncated) parts.push(`\n(Note: the file was truncated to ${MAX_CONTEXT_CHARS} characters.)`)
    if (includeSel && ctx.selection.trim()) {
      parts.push('', 'Selected text:', '```' + ctx.language, ctx.selection.trim(), '```')
    }
    return parts.join('\n')
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
        temperature: this.deps.getConfig().temperature,
        signal: this.controller.signal,
        onDelta: (chunk) => {
          buffer += chunk
          assistant.content = buffer
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
    if (!assistantStreaming && turn.content.trim()) {
      const footer = document.createElement('div')
      footer.className = 'msg-actions'
      footer.innerHTML = '<button class="cb-btn" data-retry="1">Regenerate</button>'
      turn.bodyEl.appendChild(footer)
    }
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
