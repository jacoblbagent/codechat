# CodeChat

A VS Code-style IDE that runs entirely in the browser — built on **Monaco** (the editor
that powers VS Code) — with a **toggleable right-side chat panel** wired to
**DeepSeek v4.1 Flash** through OpenRouter.

**🔗 Live:** https://jacoblbagent.github.io/codechat/

## What it does

- **VS Code shell** — title bar, activity bar, explorer, tabs, status bar, command palette
  (`Ctrl+P`), search view, minimap, bracket-pair colouring.
- **Settings page** (`Ctrl+,`, or the gear) — opens in the editor area, the way VS Code
  opens settings in a tab. Two sections: **VS Code core settings** (Editor: Font / Cursor /
  Indentation / Display / Minimap / Scrolling / Suggestions / Editing, plus Workbench and
  Files) and **CodeChat**, for the settings this app adds on top. Every control applies
  immediately, sits behind a search box that matches names, ids and descriptions, and shows
  a coloured gutter plus a reset arrow when it differs from the default.
- **Real files** — *Open Folder* loads a directory from your machine via the File System
  Access API (Chrome/Edge) and `Ctrl+S` writes changes back to disk. Browsers without the
  picker fall back to `<input type="file">` / drag-and-drop, and an in-memory demo
  workspace ships by default.
- **DeepSeek chat panel** — streaming responses from `deepseek/deepseek-v4.1-flash`,
  toggled with `Ctrl+Alt+C`, resizable by dragging its edge. The panel can:
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
  - run slash commands: `/explain`, `/fix`, `/tests`, `/refactor`, `/docs`.
- **Syntax diagnostics** in the status bar for open files (semantic analysis is off — a
  browser tab has no `node_modules`).
- **Light and dark themes** — the title-bar toggle (`Ctrl+Alt+T`) switches the whole IDE
  between **One Dark Pro** and **One Dark Pro Light**, Monaco editor palette included.
  Your choice is remembered; the default is One Dark Pro dark.
- **Responsive layout** — below 900px the side bar and chat panel become off-canvas
  drawers over the editor with a tap-to-dismiss scrim, so the IDE works on a phone.

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
| `Ctrl+B` | Toggle the side bar |
| `Ctrl+Shift+K` | New chat |
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
src/chat.ts         chat panel: streaming, markdown rendering, code actions
src/deepseek.ts     OpenRouter client (SSE) + model catalogue
src/workspace.ts    in-memory + File System Access workspace, search, tree
src/monaco.ts       editor factory, workers, Dark+ theme, file icons
src/markdown.ts     dependency-free markdown renderer
src/styles.css      VS Code Dark+ inspired styling
```

## Notes & limitations

- **Not** a fork of the `microsoft/vscode` source tree. It is a VS Code-style shell built
  directly on the Monaco editor — the same editor core VS Code uses — so it ships as a
  static site with no build toolchain beyond Vite.
- The File System Access API is Chromium-only; Firefox/Safari users get the drag-and-drop
  and file-picker fallbacks.
- No terminal and no extension host. Syntax highlighting covers ~30 languages; only
  JSON/CSS/HTML/TS/JS get language-service features (completion, hover, syntax errors).

## License

MIT
