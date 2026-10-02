# CodeChat

A VS Code-style IDE that runs entirely in the browser — built on **Monaco** (the editor
that powers VS Code) — with a **toggleable right-side chat panel** wired to
**DeepSeek v4.1 Flash** through OpenRouter.

**🔗 Live:** https://jacoblbagent.github.io/codechat/

## What it does

- **VS Code shell** — title bar, activity bar, explorer, tabs, status bar, command palette
  (`Ctrl+P`), search view, minimap, bracket-pair colouring. The rail buttons are
  toggles: a button shows its view, switches to it, or — if it is the view already
  showing — closes the side bar, leaving the button marked so you can see what
  returns. `Ctrl+B` does the same. The gear toggles the settings page.
- **Settings page** (`Ctrl+,`, or the gear) — opens in the editor area, the way VS Code
  opens settings in a tab. Two sections: **VS Code core settings** (Editor: Font / Cursor /
  Indentation / Display / Minimap / Scrolling / Suggestions / Editing, plus Workbench and
  Files) and **CodeChat**, for the settings this app adds on top. Every control applies
  immediately, sits behind a search box that matches names, ids and descriptions, and shows
  a coloured gutter plus a reset arrow when it differs from the default. **All / VS Code /
  CodeChat** chips above the list narrow it to one half of the catalogue, with a count on
  each, and they stack with the search rather than replacing it. The CodeChat
  section also carries a read-only **Credits** row: your remaining balance, what this key
  has spent, today's and this month's usage, and a Refresh button. It is fetched when the
  page opens (cached for a minute), never at boot, and the request goes to OpenRouter with
  the same key the chat uses — nowhere else.
- **`settings.json`** — the `{ }` button in the settings header opens the same settings as
  text, under VS Code's own ids (`"editor.fontSize"`, `"codechat.model"`). Both directions
  are live: editing the file applies as you type, and changing a setting anywhere else
  rewrites just those lines, leaving your own indentation, key order and blank lines alone.
  A key you delete goes back to its default; broken JSON applies nothing and keeps your
  text; an unknown key, or a value of the wrong type, is skipped and named in the header.
  It holds your OpenRouter key in plain text and is stored in this browser with the rest of
  your settings — the header says so.
- **A real project to open with** — the IDE boots on **Flowboard**, a React + Redux
  Toolkit Kanban board: 38 files across `app/`, `components/`, `features/{board,card,
  filters,labels}`, `hooks/`, `lib/`, `styles/` and `data/`, with a slice, memoized
  selectors, a vitest suite, config files and a CI workflow. It is a real project's
  shape, not five files named after their own contents, so the explorer, the search
  panel, `Ctrl+P`, Source Control and the chat all have something worth pointing at.
  See **The demo project** below for how it is stored.
- **Real files** — *Open Folder* loads a directory from your machine via the File System
  Access API (Chrome/Edge) and `Ctrl+S` writes changes back to disk. Browsers without the
  picker fall back to `<input type="file">` / drag-and-drop, and an in-memory demo
  workspace ships by default.
- **Source Control** — the rail icon (VS Code's own codicon) opens the change list, with
  the count on the icon: every file whose buffer has moved away from what was last saved
  or committed, each with a `+12 −3` line stat, per-file **Stage** / **Save** / **Discard**
  and a **Save all**.
  - **Staging** — stage a file or **Stage all**; staged changes sit in their own section
    above the rest and are the only thing the next commit takes. **Unstage all** puts them
    back.
  - **Committing** — write a message and press **Commit** (or `Ctrl+Enter`); it stays
    disabled until something is staged *and* there is a message. Committing writes the
    staged files out (so what is recorded is what is on disk) and clears them from the
    list. Files you did not stage stay changed.
  - **History** — every commit with its revision id, message, file count and age. Expand
    one to see the files it captured and **Restore** any of them, as an undoable edit.
  - **Discard** goes through the undo stack, so a mistaken click is one `Ctrl+Z` away, and
    it reverts to the last commit rather than to some earlier state.
  - It is **not git**. A static site in a browser tab has no repository to talk to, and
    writing real git objects needs an index, packfiles and refs. What you get is the
    workflow a browser can honour — staging, commits with a snapshot, history and restore —
    recorded in `localStorage` per workspace. No `.git` directory is written, nothing is
    pushed, and there are no branches or diffs.
- **Chat panel** — streaming responses from any OpenRouter model (default
  `deepseek/deepseek-v4.1-flash`), toggled with `Ctrl+Alt+C`, resizable by dragging
  its edge.
  - **Sessions.** The panel holds several conversations at once, one tab each,
    under the header. `+` (or `Ctrl+Shift+K`) opens a new one and `×` closes it;
    a tab is named after the first thing you ask it. Each session owns its own
    transcript, request, `Ctrl+L` attachment, draft, context switches and scroll
    position, so nothing bleeds between them — and a request that is still
    streaming keeps running when you switch away, marked with a dot on its tab,
    and lands in its own conversation when it finishes. Sessions are saved to
    `localStorage` and come back on reload (the last 20, transcripts capped).
  - The panel can:
  - send the **active file** and your **current selection** as context (per-request toggles),
  - **Insert** any code block it returns at the cursor or over a selection,
  - **Replace file** — write a block straight into the file you have open (the
    button names the target, e.g. `Replace greeting.ts`; undo with `Ctrl+Z`,
    save with `Ctrl+S`),
  - **New file** from a code block,
  - highlight code and press `Ctrl+L` (or **+ Selection**) to attach that exact
    chunk as pinned context for your next message,
  - watch the **context meter** under the messages: a segmented bar and legend
    showing every source going into the next request (file, selection, pinned
    chunk) with its exact size and the running total, so you can see what the
    model is actually being told before you hit send,
  - pick a **thinking level** (Off / Low / Medium / High) next to the composer,
    sent to OpenRouter as a reasoning effort; the reasoning it produces streams
    into a collapsible panel above the answer. Left at **Off**, no reasoning
    fields are sent at all,
  - **choose the model** from the live OpenRouter catalogue. Click the model
    badge in the panel header (or the *Model* row in Settings) and you get a
    searchable list of every model OpenRouter currently offers — 465 of them at
    the time of writing — with each one's context window and price per million
    tokens, a **Free** filter, your recently used models, and the model in force
    pinned to the top so the list always shows what is selected. The catalogue
    comes from `GET https://openrouter.ai/api/v1/models` (public — it needs no
    key), is cached for a day, and falls back to a short built-in list with a
    **Retry** if the network is down. An id OpenRouter adds after your cache was
    written can still be typed in directly,
  - run slash commands: `/explain`, `/fix`, `/tests`, `/refactor`, `/docs`.
- **Syntax diagnostics** in the status bar for open files (semantic analysis is off — a
  browser tab has no `node_modules`).
- **Light and dark themes** — the title-bar toggle (`Ctrl+Alt+T`) switches the whole IDE
  between **One Dark Pro** and **One Dark Pro Light**, Monaco editor palette included.
  Your choice is remembered; the default is One Dark Pro dark.
- **Responsive layout** — below 900px the side bar and chat panel become off-canvas
  drawers over the editor with a tap-to-dismiss scrim, so the IDE works on a phone.
  Opening a file, or the settings page, dismisses the drawer it was tapped from, and below
  640px form fields are raised to 16px so iOS does not zoom into them on focus.
- **Touch** — every control sets `touch-action: manipulation`, so a double tap on a button
  is a double tap rather than a zoom gesture. Panning and pinching the page still work,
  which a `user-scalable=no` viewport tag would have taken away.

## The demo project

The starter board lives in the repository as **real files** under
[`demo/flowboard/`](demo/flowboard) — with their real extensions, so they can be
read, diffed and linted like any other source. `src/demo.ts` pulls each one in as
text with Vite's `?raw`, which is why nothing in there is ever executed or
type-checked as part of the IDE: `tsconfig.json` only includes `src`, so the
fixture's own `tsconfig.json`, `package.json` and React imports stay its own
business.

That choice matters for two reasons. Escaping a whole project into TypeScript
string literals is unreadable and easy to corrupt, and a fake project made of
stubbed files is obvious the moment anyone opens one. This way the file you open
in the IDE is byte for byte the file in the repository — the `demo` suite asserts
exactly that.

Ask the assistant about any of it. `src/features/board/boardSlice.ts` is the
interesting one: a normalised card map, a column that keeps its own order, and an
undo snapshot for the destructive actions.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5176
```

Then open **Settings** (`Ctrl+,`, or the gear in the title bar) and paste an OpenRouter
API key into the **CodeChat** section. The key is kept in `localStorage` only — it is
never bundled or committed.

Prefer to bake one in for local use? Copy `.env.example` to `.env.local` and set
`VITE_OPENROUTER_API_KEY` — useful for a private deploy, never for a public one.

## Commands

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+C` | Toggle the AI chat panel |
| `Ctrl+Alt+T` | Toggle One Dark Pro light / dark |
| `Ctrl+L` | Attach the selected code to the chat (`Ctrl+Shift+L` also works) |
| `Ctrl+P` | Quick open a file |
| `Ctrl+S` | Save the active file (writes to disk for real folders) |
| `Ctrl+B` | Toggle the side bar (same as clicking the active rail button) |
| `Ctrl+Shift+K` | New chat session (a new tab) |
| `Ctrl+,` | Open the settings page |
| `Enter` / `Shift+Enter` | Send message / newline in the chat box |
| `Esc` | Close the quick-open palette or the settings page |

## Build & deploy

```bash
npm run build            # → dist/  (base path /codechat/)
npm run deploy           # publish dist/ to the gh-pages branch
```

`vite.config.ts` sets `base` to `/codechat/` for the GitHub Pages project URL.
Override with `VITE_BASE=/ npm run build` when serving from a domain root.

The included workflow (`.github/workflows/deploy.yml`) builds and publishes to GitHub
Pages on every push to `main`.

## Stack

- Vite + TypeScript (no UI framework)
- `monaco-editor` with Vite `?worker` bundles for the JSON/CSS/HTML/TS language services
- OpenRouter chat-completions API, SSE streaming via `fetch` + `ReadableStream`
- Ports: **dev 5176**, **preview 4176**

## Project layout

```
index.html          full IDE shell (title bar → status bar)
src/main.ts         app wiring: tabs, tree, commands, settings, layout
src/chat.ts         chat panel: sessions, streaming, markdown rendering, code actions
src/deepseek.ts     OpenRouter client (SSE) + the request shape
src/credits.ts      OpenRouter balance: /api/v1/key + /api/v1/credits, cached
src/scm.ts          staging area, commit records and their storage
src/diff.ts         line-diff counts for the +12 −3 gutter
src/credits-ui.ts   the read-only Credits row in Settings
src/models.ts       the OpenRouter catalogue: fetch, cache, search, formatting
src/model-picker.ts the searchable model picker (chat header + Settings)
src/demo.ts         the starter project (Flowboard) as text, via ?raw imports
src/settings.ts     settings catalogue (VS Code core + CodeChat)
src/settings-ui.ts  settings page renderer, scope filter
src/settings-json.ts settings.json: serialise, parse, patch by key, Monaco view
src/workspace.ts    in-memory + File System Access workspace, search, tree
src/monaco.ts       editor factory, workers, One Dark themes, file icons
src/markdown.ts     dependency-free markdown renderer
src/styles.css      One Dark Pro inspired styling
demo/flowboard/     the starter project, as real files (React + RTK Kanban board)
```

## Notes & limitations

- **Not** a fork of the `microsoft/vscode` source tree. It is a VS Code-style shell built
  directly on the Monaco editor — the same editor core VS Code uses — so it ships as a
  static site with no build toolchain beyond Vite.
- The File System Access API is Chromium-only; Firefox/Safari users get the drag-and-drop
  and file-picker fallbacks.
- No terminal and no extension host. Syntax highlighting covers ~30 languages; only
  JSON/CSS/HTML/TS/JS get language-service features (completion, hover, syntax errors).
- **Commits are this app's own records, not git.** They live in `localStorage` under
  `codechat.scm.v1`, keyed by workspace name (the 3 most recent workspaces, 30 commits
  each, with the file snapshots they captured). Clearing site data clears them, and they
  never leave the browser. A commit holds full file contents rather than diffs, which is
  what makes Restore a one-liner; if storage runs out the oldest commits are dropped first.
- **The Credits row shows what the key is allowed to see.** `GET /api/v1/key` works with any
  key and reports that key's own limit, remaining and usage. The *account* balance comes from
  `GET /api/v1/credits`, which OpenRouter restricts to provisioning keys — with an ordinary
  key the row says so and falls back to the key's own numbers. It deliberately does not ask
  for the account balance unless the key is allowed to, because a rejected response would sit
  in the browser console.
- Chat sessions live in `localStorage`, so they are per-browser and cleared with site
  data. The last 20 are kept and each transcript is capped at its 60 most recent
  turns; if the origin is over quota the app falls back to saving only the session
  you are using rather than dropping all of them.
- The model list is a **snapshot**: it is fetched once and cached for a day, so a model
  released in the last few hours may be missing. Type its id in the picker and it will be
  used anyway. Prices and context windows come from OpenRouter and are shown, not enforced
  — nothing here checks that the model you pick supports the thinking level you set.

## License

MIT
