# CodeChat

A VS Code-style IDE that runs entirely in the browser — built on **Monaco** (the editor
that powers VS Code) — with a **toggleable right-side chat panel** wired to
**DeepSeek v4.1 Flash** through OpenRouter.

**🔗 Live:** https://jacoblbagent.github.io/codechat/

## What it does

- **VS Code shell** — title bar, activity bar, explorer, tabs, status bar, command palette
  (`Ctrl+P`), search view, breadcrumbs, minimap, bracket-pair colouring, Dark+ theme.
- **Real files** — *Open Folder* loads a directory from your machine via the File System
  Access API (Chrome/Edge) and `Ctrl+S` writes changes back to disk. Browsers without the
  picker fall back to `<input type="file">` / drag-and-drop, and an in-memory demo
  workspace ships by default.
- **DeepSeek chat panel** — streaming responses from `deepseek/deepseek-v4.1-flash`,
  toggled with `Ctrl+Alt+C`, resizable by dragging its edge. The panel can:
  - send the **active file** and your **current selection** as context (per-request toggles),
  - **Insert** any code block it returns at the cursor or over a selection,
  - **New file** from a code block,
  - run slash commands: `/explain`, `/fix`, `/tests`, `/refactor`, `/docs`.
- **Syntax diagnostics** in the status bar for open files (semantic analysis is off — a
  browser tab has no `node_modules`).

## Quick start

```bash
npm install
npm run dev      # http://localhost:5176
```

Then open **Settings** (gear in the title bar) and paste an OpenRouter API key.
The key is kept in `localStorage` only — it is never bundled or committed.

Prefer to bake one in for local use? Copy `.env.example` to `.env.local` and set
`VITE_OPENROUTER_API_KEY` — useful for a private deploy, never for a public one.

## Commands

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+C` | Toggle the AI chat panel |
| `Ctrl+P` | Quick open a file |
| `Ctrl+S` | Save the active file (writes to disk for real folders) |
| `Ctrl+B` | Toggle the side bar |
| `Ctrl+Shift+K` | New chat |
| `Enter` / `Shift+Enter` | Send message / newline in the chat box |
| `Esc` | Close the quick-open palette |

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
