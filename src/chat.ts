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
  /** The conversation this turn belongs to. */
  session: ChatSession
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

/** One session as it is stored. Transient state (streaming, scroll) is not kept. */
interface StoredTurn {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
}

interface StoredSession {
  id: string
  title: string
  draft: string
  include: boolean
  selection: boolean
  pinned: ChatSession['pinned']
  turns: StoredTurn[]
}

interface StoredState {
  activeId: string
  seq: number
  sessions: StoredSession[]
}

/**
 * One conversation, and everything that must not leak into another one.
 *
 * Sessions are isolated by construction rather than by remembering to reset
 * things: the transcript, the in-flight request and its abort handle, the
 * Ctrl+L attachment, the composer draft, the two context switches and the DOM
 * subtree all live here. `send()` captures its session before its first
 * `await`, so switching tabs mid-stream cannot route a chunk, an error, a
 * toast or a scroll into whichever conversation happens to be on screen.
 */
interface ChatSession {
  id: string
  title: string
  turns: Turn[]
  /** This session's own scroll container — exactly one is visible at a time. */
  root: HTMLElement
  /** Transcript DOM is built on first activation, so restoring 20 sessions does
   *  not render 20 transcripts at boot. */
  rendered: boolean
  pinned: { code: string; language: string; where: string } | null
  draft: string
  include: boolean
  selection: boolean
  streaming: boolean
  controller: AbortController | null
  rafPending: boolean
  status: ChatStatus
}

/** One source feeding the next request, with its exact size. */
interface CtxSegment {
  kind: 'file' | 'selection' | 'pinned'
  label: string
  chars: number
  truncated?: boolean
}

const SESSIONS_KEY = 'codechat.sessions.v1'
/** Beyond this the oldest conversations are dropped when saving. */
const SESSION_LIMIT = 20
/** Stored transcripts are bounded — localStorage is ~5 MB for the whole origin. */
const TURNS_KEPT = 60

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

/** A tab label taken from the message that opened the conversation. */
function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return 'New chat'
  return flat.length > 34 ? `${flat.slice(0, 33)}…` : flat
}

export class ChatPanel {
  private deps: ChatDeps
  private sessions: ChatSession[] = []
  private activeId = ''
  /** Monotonic, so a session keeps its "New chat N" label for its whole life. */
  private seq = 0
  private saveTimer: number | null = null

  private el: {
    panel: HTMLElement
    scroll: HTMLElement
    tabs: HTMLElement
    empty: HTMLElement
    input: HTMLTextAreaElement
    send: HTMLButtonElement
    stop: HTMLButtonElement
    hint: HTMLElement
    include: HTMLButtonElement
    includeNote: HTMLElement
    selection: HTMLButtonElement
    selectionNote: HTMLElement
    model: HTMLElement
    vendor: HTMLElement
    pin: HTMLElement
    pinLabel: HTMLElement
    vizBar: HTMLElement
    vizLegend: HTMLElement
  }

  /** The conversation on screen. */
  private get session(): ChatSession {
    return this.sessions.find((s) => s.id === this.activeId) ?? this.sessions[0]
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
      tabs: q('chat-tabs'),
      empty: q('chat-empty'),
      input: q('chat-input') as HTMLTextAreaElement,
      send: q('btn-send') as HTMLButtonElement,
      stop: q('btn-stop') as HTMLButtonElement,
      hint: q('compose-hint'),
      include: q('ctx-include') as HTMLButtonElement,
      includeNote: q('ctx-include-note'),
      selection: q('ctx-selection') as HTMLButtonElement,
      selectionNote: q('ctx-selection-note'),
      model: q('chat-model'),
      vendor: q('chat-vendor'),
      pin: q('ctx-pin'),
      pinLabel: q('ctx-pin-label'),
      vizBar: q('ctx-viz-bar'),
      vizLegend: q('ctx-viz-legend'),
    }

    this.restore()
    if (!this.sessions.length) this.createSession()
    if (!this.sessions.some((s) => s.id === this.activeId)) this.activeId = this.sessions[0].id

    this.wire()
    this.wireTabs()
    this.refreshModelBadge()
    this.showSession()
  }

  /* ── sessions ─────────────────────────────────────────────── */

  private makeSession(init: { id: string; title: string } & Partial<ChatSession>): ChatSession {
    const root = document.createElement('div')
    root.className = 'chat-session is-hidden'
    root.dataset.session = init.id
    this.el.scroll.appendChild(root)

    const session: ChatSession = {
      turns: [],
      rendered: true,
      pinned: null,
      draft: '',
      include: true,
      selection: true,
      streaming: false,
      controller: null,
      rafPending: false,
      status: 'idle',
      ...init,
      root,
    }
    this.sessions.push(session)
    return session
  }

  /** The + button and Ctrl+Shift+K: a new conversation, the current one intact. */
  newChat(): ChatSession {
    const session = this.createSession()
    this.activate(session.id)
    this.el.input.focus()
    return session
  }

  private createSession(): ChatSession {
    this.seq += 1
    return this.makeSession({
      id: `s${this.seq}-${Math.random().toString(36).slice(2, 7)}`,
      title: `New chat ${this.seq}`,
    })
  }

  private activate(id: string): void {
    const next = this.sessions.find((s) => s.id === id)
    if (!next || next.id === this.activeId) return
    this.stashDraft()
    this.activeId = next.id
    this.showSession()
  }

  /** Remember what is typed before the composer is pointed at another session. */
  private stashDraft(): void {
    const current = this.sessions.find((s) => s.id === this.activeId)
    if (current) current.draft = this.el.input.value
  }

  /** Put the active session on screen: its DOM, its controls, its status. */
  private showSession(): void {
    const session = this.session
    for (const other of this.sessions) {
      other.root.classList.toggle('is-hidden', other.id !== session.id)
    }
    this.renderSession(session)

    this.el.empty.classList.toggle('is-hidden', session.turns.length > 0)
    this.el.input.value = session.draft
    this.autoGrow()
    this.renderPin()
    this.syncComposer()
    this.refreshContextViz()
    this.renderTabs()
    this.revealTab(session.id)
    this.deps.onStatus(session.status)
    this.persist()
  }

  private closeSession(id: string): void {
    const index = this.sessions.findIndex((s) => s.id === id)
    if (index < 0) return
    this.stashDraft()

    const [session] = this.sessions.splice(index, 1)
    // A stream must not outlive its tab: it would hold the request open and
    // keep writing into a detached node.
    session.controller?.abort()
    session.root.remove()

    if (session.id === this.activeId) {
      if (!this.sessions.length) this.createSession()
      this.activeId = this.sessions[Math.min(index, this.sessions.length - 1)].id
      this.showSession()
      this.el.input.focus()
    } else {
      this.renderTabs()
    }
    this.persist()
  }

  /* ── persistence ──────────────────────────────────────────── */

  private restore(): void {
    let parsed: StoredState | null = null
    try {
      const raw = localStorage.getItem(SESSIONS_KEY)
      if (raw) parsed = JSON.parse(raw) as StoredState
    } catch {
      parsed = null
    }
    if (!parsed || !Array.isArray(parsed.sessions)) return

    for (const stored of parsed.sessions.slice(0, SESSION_LIMIT)) {
      if (!stored || typeof stored.id !== 'string' || !stored.id) continue
      const session = this.makeSession({
        id: stored.id,
        title: typeof stored.title === 'string' && stored.title ? stored.title : 'New chat',
        draft: typeof stored.draft === 'string' ? stored.draft : '',
        include: stored.include !== false,
        selection: stored.selection !== false,
        pinned: stored.pinned && typeof stored.pinned.code === 'string' ? stored.pinned : null,
      })
      session.turns = (Array.isArray(stored.turns) ? stored.turns : [])
        .filter((t) => t && (t.role === 'user' || t.role === 'assistant'))
        .map((t) => ({
          role: t.role,
          content: typeof t.content === 'string' ? t.content : '',
          reasoning: typeof t.reasoning === 'string' ? t.reasoning : undefined,
          done: true,
          session,
        }))
      session.rendered = false
    }

    if (!this.sessions.length) return
    const seq = Number(parsed.seq)
    this.seq = Number.isFinite(seq) ? seq : this.sessions.length
    this.activeId = typeof parsed.activeId === 'string' ? parsed.activeId : ''
  }

  /** Debounced — sending a message and switching tabs both land here. */
  private persist(): void {
    if (this.saveTimer !== null) return
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      this.writeSessions()
    }, 400)
  }

  private writeSessions(): void {
    const state: StoredState = {
      activeId: this.activeId,
      seq: this.seq,
      sessions: this.sessions.slice(-SESSION_LIMIT).map((s) => ({
        id: s.id,
        title: s.title,
        draft: s.draft,
        include: s.include,
        selection: s.selection,
        pinned: s.pinned,
        turns: s.turns
          .filter((t) => t.content.trim())
          .slice(-TURNS_KEPT)
          .map((t) => ({ role: t.role, content: t.content, reasoning: t.reasoning })),
      })),
    }
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(state))
    } catch {
      // Over quota: keep the conversation in use rather than none of them.
      try {
        state.sessions = state.sessions.filter((s) => s.id === this.activeId)
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(state))
      } catch {
        /* private mode — sessions live for this tab only */
      }
    }
  }

  /* ── tabs ─────────────────────────────────────────────────── */

  private renderTabs(): void {
    this.el.tabs.replaceChildren()
    for (const session of this.sessions) {
      const active = session.id === this.activeId

      const tab = document.createElement('div')
      tab.className = 'chat-tab'
      if (active) tab.classList.add('is-active')
      if (session.streaming) tab.classList.add('is-busy')
      tab.dataset.session = session.id
      tab.title = session.title
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(active))
      // Roving tabindex, the usual tablist pattern.
      tab.tabIndex = active ? 0 : -1

      const name = document.createElement('span')
      name.className = 'chat-tab-name'
      name.textContent = session.title

      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'chat-tab-x'
      close.dataset.close = session.id
      close.title = `Close ${session.title}`
      close.setAttribute('aria-label', `Close ${session.title}`)
      close.textContent = '×'

      tab.append(name, close)
      this.el.tabs.appendChild(tab)
    }
  }

  private wireTabs(): void {
    this.el.tabs.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      const close = target.closest<HTMLElement>('[data-close]')
      if (close?.dataset.close) {
        e.stopPropagation()
        this.closeSession(close.dataset.close)
        return
      }
      const tab = target.closest<HTMLElement>('[data-session]')
      if (tab?.dataset.session) this.activate(tab.dataset.session)
    })

    this.el.tabs.addEventListener('keydown', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-session]')
      if (!tab) return
      const index = this.sessions.findIndex((s) => s.id === tab.dataset.session)
      if (index < 0) return

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const next = this.sessions[index + (e.key === 'ArrowRight' ? 1 : -1)]
        if (!next) return
        this.activate(next.id)
        this.focusTab(next.id)
        return
      } else {
        return
      }
      this.activate(this.sessions[index].id)
      this.focusTab(this.sessions[index].id)
    })
  }

  private focusTab(id: string): void {
    this.el.tabs.querySelector<HTMLElement>(`[data-session="${id}"]`)?.focus()
  }

  /** Bring a tab into view when the strip is wider than the panel. */
  private revealTab(id: string): void {
    const tab = this.el.tabs.querySelector<HTMLElement>(`[data-session="${id}"]`)
    if (!tab) return
    // Rects, not offsetLeft: the strip is not a positioned ancestor, so
    // offsetLeft would be measured against whatever else is.
    const strip = this.el.tabs.getBoundingClientRect()
    const box = tab.getBoundingClientRect()
    if (box.left < strip.left) this.el.tabs.scrollLeft -= strip.left - box.left
    else if (box.right > strip.right) this.el.tabs.scrollLeft += box.right - strip.right
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

    // Delegated from the scroll host, so it covers every session's subtree
    // including ones rebuilt from storage.
    this.el.scroll.addEventListener('click', (e) => this.onMessageClick(e))

    // The two context switches belong to the session, not the panel. They are
    // buttons rather than checkboxes so the state, the cost of turning one on,
    // and the reason it is unavailable can all live on the same control.
    this.el.include.addEventListener('click', () => {
      this.session.include = !this.session.include
      this.refreshContextViz()
      this.persist()
    })
    this.el.selection.addEventListener('click', () => {
      this.session.selection = !this.session.selection
      this.refreshContextViz()
      this.persist()
    })

    for (const chip of document.querySelectorAll<HTMLElement>('.chip[data-prompt]')) {
      chip.addEventListener('click', () => {
        this.el.input.value = chip.dataset.prompt ?? ''
        void this.send()
      })
    }
  }

  private onMessageClick(e: Event): void {
    const origin = e.target as HTMLElement
    const session = this.sessionOf(origin) ?? this.session

    // Reasoning panel: flip it and re-render. The open state is read back off
    // the DOM, so there is only ever one source of truth for what is expanded.
    const thinkBtn = origin.closest<HTMLElement>('[data-think]')
    if (thinkBtn) {
      const turn = session.turns[Number(thinkBtn.dataset.think)]
      if (turn) {
        turn.thinkOpen = !thinkBtn.closest('.think')?.classList.contains('is-open')
        this.renderTurn(turn)
      }
      return
    }

    const target = origin.closest<HTMLElement>('[data-act]')
    if (!target) {
      const retry = origin.closest<HTMLElement>('[data-retry]')
      if (retry) void this.regenerate()
      const copyMsg = origin.closest<HTMLElement>('[data-copy-msg]')
      if (copyMsg) {
        const idx = Number(copyMsg.dataset.copyMsg)
        void navigator.clipboard.writeText(session.turns[idx]?.content ?? '').then(
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

  /** Which conversation a node in the transcript belongs to. */
  private sessionOf(node: Element): ChatSession | undefined {
    const root = node.closest<HTMLElement>('.chat-session')
    return this.sessions.find((s) => s.id === root?.dataset.session)
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

  setActiveFile(): void {
    this.syncApplyButtons()
    this.refreshContextViz()
  }

  /**
   * Point every "Replace …" code-block button at whichever file is open *now*,
   * so it is always obvious which file a click would overwrite. Every session
   * is walked, not just the visible one: the target is the editor's file, not
   * the conversation's.
   */
  private syncApplyButtons(): void {
    const path = this.deps.getContext().path
    const name = path ? path.split('/').pop()! : ''
    for (const session of this.sessions) {
      for (const btn of session.root.querySelectorAll<HTMLButtonElement>('[data-act="apply"]')) {
        btn.textContent = name ? `Replace ${name}` : 'Replace file'
        btn.title = path
          ? `Replace the whole contents of ${path} with this block`
          : 'Open a file first'
        btn.disabled = !path
      }
    }
  }

  /**
   * Attach the editor's current selection to the next message (Ctrl+L).
   * Returns false when nothing is selected, so callers can skip revealing the
   * panel for a no-op. The attachment belongs to one session only.
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
    this.session.pinned = { code, language: ctx.language || 'plaintext', where }
    this.renderPin()
    this.el.input.focus()
    return true
  }

  private renderPin(): void {
    const p = this.session.pinned
    this.el.pin.classList.toggle('is-hidden', !p)
    if (p) {
      const lineCount = p.code.split('\n').length
      this.el.pinLabel.textContent = `${p.where} · ${lineCount} line${lineCount === 1 ? '' : 's'}`
      this.el.pinLabel.title = p.code
    }
    this.refreshContextViz()
  }

  private clearPin(): void {
    this.session.pinned = null
    this.renderPin()
    this.persist()
  }

  /* ── sending ──────────────────────────────────────────────── */
  private buildUserContent(session: ChatSession, raw: string): string {
    const text = raw.trim()
    const expanded = Object.entries(COMMANDS).find(([cmd]) => text === cmd || text.startsWith(`${cmd} `))
    const instruction = expanded
      ? text.length > expanded[0].length
        ? `${expanded[1]}\n\nAdditional request: ${text.slice(expanded[0].length).trim()}`
        : expanded[1]
      : text

    return [instruction, ...this.contextPayload(session).blocks].join('\n')
  }

  /**
   * The context blocks that ride along with the next message, plus a description
   * of each. Built in ONE place, so the meter under the chat can never disagree
   * with what actually goes over the wire.
   */
  private contextPayload(session: ChatSession): { blocks: string[]; segs: CtxSegment[]; truncated: boolean } {
    const ctx = this.deps.getContext()
    const lang = ctx.language || 'plaintext'
    const blocks: string[] = []
    const segs: CtxSegment[] = []

    if (session.include && ctx.path) {
      const full = ctx.content
      const truncated = full.length > this.maxContextChars
      const content = truncated ? full.slice(0, this.maxContextChars) : full
      blocks.push('', '---', `Active file: \`${ctx.path}\` (${lang})`, '```' + lang, content, '```')
      if (truncated) blocks.push(`\n(Note: the file was truncated to ${this.maxContextChars} characters.)`)
      segs.push({ kind: 'file', label: ctx.path.split('/').pop()!, chars: content.length, truncated })
    }

    // A chunk pinned with Ctrl+L, or the live selection when its box is ticked.
    // Either can be sent on its own, with the whole-file block turned off.
    const pinned = session.pinned
    const code = pinned ? pinned.code : session.selection ? ctx.selection.trim() : ''
    if (code) {
      const label = pinned ? `Selected code from \`${pinned.where}\`` : 'Selected text'
      blocks.push('', `${label}:`, '```' + (pinned?.language || lang), code, '```')
      // Count from the *range* when we have one, so this label agrees with the
      // line count shown on the switch next to it. Trimming the text to send
      // eats a trailing newline and would make the two read differently.
      const selLines = ctx.selectionLines
        ? ctx.selectionLines.end - ctx.selectionLines.start + 1
        : code.split('\n').length
      segs.push({
        kind: pinned ? 'pinned' : 'selection',
        label: pinned ? pinned.where : `${selLines} line${selLines === 1 ? '' : 's'}`,
        chars: code.length,
      })
    }

    return { blocks, segs, truncated: segs.some((s) => s.truncated) }
  }

  /**
   * Redraw everything that describes the next message: the two switches and the
   * meter under them. Both come from `contextPayload`, the same function that
   * builds the request, so the readout cannot disagree with what is sent.
   */
  refreshContextViz(): void {
    const ctx = this.deps.getContext()
    const { segs, truncated } = this.contextPayload(this.session)
    const total = segs.reduce((n, s) => n + s.chars, 0)
    const budget = this.maxContextChars

    this.syncContextToggles(ctx)

    // Composition bar: segments are proportional to the total, so a small
    // selection stays visible next to a whole file.
    this.el.vizBar.replaceChildren()
    if (total > 0) {
      for (const s of segs) {
        const span = document.createElement('span')
        span.className = `ctx-seg kind-${s.kind}`
        span.style.width = `${(s.chars / total) * 100}%`
        span.title = `${s.label} — ${s.chars.toLocaleString()} characters`
        this.el.vizBar.appendChild(span)
      }
    }

    this.el.vizLegend.replaceChildren()
    if (!segs.length) {
      const empty = document.createElement('span')
      empty.className = 'ctx-note'
      empty.textContent = ctx.path
        ? 'No context attached — the message goes on its own'
        : 'No context attached — open a file to send one'
      this.el.vizLegend.appendChild(empty)
      return
    }

    for (const s of segs) {
      const chip = document.createElement('span')
      chip.className = `ctx-chip kind-${s.kind}`
      const name = document.createElement('b')
      name.textContent = s.label
      chip.append(name, document.createTextNode(` ${fmtChars(s.chars)}`))
      chip.title = `${s.label} — ${s.chars.toLocaleString()} characters${
        s.truncated ? `, stopped at the ${budget.toLocaleString()} character cap` : ''
      }`
      this.el.vizLegend.appendChild(chip)
    }

    if (truncated) {
      const warn = document.createElement('span')
      warn.className = 'ctx-chip is-warn'
      warn.textContent = `file cut at ${fmtChars(budget)}`
      warn.title = `The whole-file block stops at ${budget.toLocaleString()} characters. Raise it with codechat.maxContextChars in Settings.`
      this.el.vizLegend.appendChild(warn)
    }

    // The total is only half a fact without the cap it is measured against.
    const totalEl = document.createElement('span')
    totalEl.className = truncated ? 'ctx-viz-total is-warn' : 'ctx-viz-total'
    totalEl.textContent = `${fmtChars(total)} / ${fmtChars(budget)} chars`
    totalEl.title = `${total.toLocaleString()} characters attached, against the ${budget.toLocaleString()} character cap on the whole-file block`
    this.el.vizLegend.appendChild(totalEl)
  }

  /**
   * Write the state, the cost and the reason onto the two switches. A tick means
   * on, the note says what it is worth right now, a dashed border means on with
   * nothing to send, and dimming means a pinned chunk is standing in for it —
   * all of which the bare checkboxes left you to infer.
   */
  private syncContextToggles(ctx: ChatContext): void {
    const include = this.el.include
    include.setAttribute('aria-pressed', String(this.session.include))
    include.disabled = !ctx.path
    include.classList.toggle('is-empty', this.session.include && !ctx.path)
    this.el.includeNote.textContent = ctx.path ? ctx.path.split('/').pop()! : 'no file'
    include.title = ctx.path
      ? `${this.session.include ? 'Sending' : 'Not sending'} the whole file — ${ctx.path}`
      : 'No file is open in the editor'

    const selection = this.el.selection
    // Count the line *range*, not the trimmed text: trimming eats a trailing
    // newline and made this disagree with the line count on a pinned chunk.
    const lines = ctx.selectionLines
      ? ctx.selectionLines.end - ctx.selectionLines.start + 1
      : ctx.selection.trim()
        ? ctx.selection.trim().split('\n').length
        : 0
    const pinned = Boolean(this.session.pinned)
    selection.setAttribute('aria-pressed', String(this.session.selection))
    selection.classList.toggle('is-empty', this.session.selection && !lines && !pinned)
    selection.classList.toggle('is-muted', pinned)
    this.el.selectionNote.textContent = pinned
      ? 'pinned instead'
      : lines
        ? `${lines} line${lines === 1 ? '' : 's'}`
        : 'nothing selected'
    selection.title = pinned
      ? 'A chunk pinned with Ctrl+L is sent instead of the live selection'
      : lines
        ? `${this.session.selection ? 'Sending' : 'Not sending'} the ${lines} selected line${lines === 1 ? '' : 's'}`
        : 'Select code in the editor to send a chunk alongside the message'
  }

  async send(preset?: string): Promise<void> {
    // Everything below uses this local, never `this.session`: the request can
    // outlive the tab it started in, and its deltas must land in its own DOM.
    const session = this.session
    if (session.streaming) return
    const text = (preset ?? this.el.input.value).trim()
    if (!text) return

    const { apiKey } = this.deps.getConfig()
    if (!apiKey) {
      this.pushSystem(session, 'No OpenRouter API key is set, so the request was not sent.')
      this.pushAction(session, 'Set API key', () => this.deps.openSettings())
      return
    }

    const wireContent = this.buildUserContent(session, text)
    session.pinned = null // the attachment is consumed by the message it rode along with
    this.renderPin()
    this.el.input.value = ''
    session.draft = ''
    this.autoGrow()
    this.el.empty.classList.add('is-hidden')

    this.addTurn(session, 'user', text)
    const assistant = this.addTurn(session, 'assistant', '')
    session.streaming = true
    this.setStatus(session, 'busy')
    this.syncComposer()
    this.persist()

    const history: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...session.turns
        .slice(0, -1)
        .filter((t) => t.content.trim())
        .slice(-14)
        .map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    ]
    // The newest user turn carries the injected context, so swap it in.
    const lastUser = history.map((m, i) => ({ m, i })).filter((x) => x.m.role === 'user').pop()
    if (lastUser) history[lastUser.i] = { role: 'user', content: wireContent }
    else history.push({ role: 'user', content: wireContent })

    session.controller = new AbortController()
    let buffer = ''

    try {
      await streamChat(history, {
        apiKey,
        model: this.deps.getConfig().model,
        reasoning: this.deps.getConfig().reasoning,
        signal: session.controller.signal,
        onDelta: (chunk) => {
          // The first answer token closes out the thinking phase.
          if (assistant.thinkStart && !assistant.thinkEnd) assistant.thinkEnd = Date.now()
          buffer += chunk
          assistant.content = buffer
          this.scheduleRender(session, assistant)
          this.scrollIfNearBottom(session)
        },
        onReasoning: (chunk) => {
          if (!assistant.thinkStart) assistant.thinkStart = Date.now()
          assistant.reasoning = (assistant.reasoning ?? '') + chunk
          this.scheduleRender(session, assistant)
          this.scrollIfNearBottom(session)
        },
      })
      assistant.content = buffer || '(The model returned an empty response.)'
      this.finalize(session, assistant)
      this.setStatus(session, 'ready')
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        assistant.content = buffer || '(stopped)'
        this.finalize(session, assistant)
        this.deps.toast('Generation stopped', 'ok')
        this.setStatus(session, buffer ? 'ready' : 'idle')
      } else {
        const message = err instanceof ApiError ? err.message : (err as Error).message
        assistant.done = true
        if (assistant.content.trim()) this.renderTurn(assistant)
        else {
          assistant.el?.remove()
          session.turns.pop()
        }
        this.pushSystem(session, message)
        if (err instanceof ApiError && (err.status === 401 || err.status === 402 || err.status === 403)) {
          this.pushAction(session, 'Open settings', () => this.deps.openSettings())
        }
        this.setStatus(session, 'error')
      }
    } finally {
      session.streaming = false
      session.controller = null
      // Only the active session owns the composer, so this is a no-op for a
      // request that finished while the user was reading another tab.
      this.syncComposer()
      this.refreshModelBadge()
      this.persist()
      if (session === this.session) {
        this.el.input.focus()
        this.syncApplyButtons()
      } else {
        this.renderTabs()
      }
    }
  }

  /** Status lives on the session; the dot only ever shows the active one. */
  private setStatus(session: ChatSession, status: ChatStatus): void {
    session.status = status
    this.renderTabs()
    if (session === this.session) this.deps.onStatus(status)
  }

  private async regenerate(): Promise<void> {
    // Drop the trailing assistant turn, re-send the last user turn.
    const session = this.session
    const lastUserIdx = [...session.turns].reverse().findIndex((t) => t.role === 'user')
    if (lastUserIdx < 0) return
    const idx = session.turns.length - 1 - lastUserIdx
    const text = session.turns[idx].content
    session.turns = session.turns.slice(0, idx)
    session.root.replaceChildren()
    session.rendered = true
    for (const t of session.turns) {
      t.done = true
      this.attachTurn(session, t)
      this.renderTurn(t)
    }
    await this.send(text)
  }

  stop(): void {
    this.session.controller?.abort()
  }

  /** The composer reflects the active session, so a background stream cannot hijack it. */
  private syncComposer(): void {
    const session = this.session
    if (!session) return
    this.el.stop.hidden = !session.streaming
    this.el.send.disabled = session.streaming
    this.el.hint.textContent = this.el.input.value.trimStart().startsWith('/')
      ? 'Slash command — Enter to run'
      : 'Enter to send · Shift+Enter newline'
  }

  /* ── rendering ────────────────────────────────────────────── */
  /** Build a restored session's transcript, once, on first activation. */
  private renderSession(session: ChatSession): void {
    if (session.rendered) return
    session.root.replaceChildren()
    for (const turn of session.turns) {
      this.attachTurn(session, turn)
      this.renderTurn(turn)
    }
    session.rendered = true
  }

  /** Create the DOM for a turn that already exists on the session. */
  private attachTurn(session: ChatSession, turn: Turn): void {
    const el = document.createElement('div')
    el.className = `msg msg-${turn.role}`

    const roleEl = document.createElement('div')
    roleEl.className = 'msg-role'
    roleEl.innerHTML =
      turn.role === 'user'
        ? '<span class="who-user">You</span>'
        : '<span class="who-ai">✦ DeepSeek</span>'

    const actions = document.createElement('span')
    actions.className = 'msg-actions'
    actions.innerHTML = `<button class="cb-btn" data-copy-msg="${session.turns.indexOf(turn)}">Copy</button>`
    roleEl.appendChild(actions)

    const body = document.createElement('div')
    body.className = 'msg-body'

    el.append(roleEl, body)
    session.root.appendChild(el)

    turn.session = session
    turn.el = el
    turn.bodyEl = body
  }

  private addTurn(session: ChatSession, role: 'user' | 'assistant', content: string): Turn {
    const turn: Turn = { role, content, session }
    session.turns.push(turn)
    this.attachTurn(session, turn)

    if (role === 'user') {
      turn.done = true
      this.renderTurn(turn)
      // The first thing asked names the tab.
      if (session.turns.filter((t) => t.role === 'user').length === 1) {
        session.title = titleFrom(content)
        this.renderTabs()
      }
    } else {
      turn.bodyEl!.classList.add('cursor-blink')
    }

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
    head.dataset.think = String(turn.session.turns.indexOf(turn))
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

  private scheduleRender(session: ChatSession, turn: Turn): void {
    if (session.rafPending || turn.done) return
    session.rafPending = true
    requestAnimationFrame(() => {
      session.rafPending = false
      if (!turn.done) this.renderTurn(turn)
    })
  }

  /** Mark a turn finished and render its final state exactly once. */
  private finalize(session: ChatSession, turn: Turn): void {
    turn.done = true
    this.renderTurn(turn)
    this.syncApplyButtons()
  }

  private pushSystem(session: ChatSession, text: string): void {
    const el = document.createElement('div')
    el.className = 'msg'
    el.innerHTML = `<div class="msg-err">${escapeText(text)}</div>`
    session.root.appendChild(el)
    this.scrollIfNearBottom(session, true)
  }

  private pushAction(session: ChatSession, label: string, onClick: () => void): void {
    const el = document.createElement('div')
    el.className = 'msg'
    const btn = document.createElement('button')
    btn.className = 'btn btn-primary'
    btn.textContent = label
    btn.style.width = 'fit-content'
    btn.addEventListener('click', onClick)
    el.appendChild(btn)
    session.root.appendChild(el)
    this.scrollIfNearBottom(session, true)
  }

  private scrollIfNearBottom(session: ChatSession, force = false): void {
    // A hidden container has no meaningful scroll position, and scrolling it
    // would steal the position the visible conversation is holding.
    if (session !== this.session) return
    const s = session.root
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
