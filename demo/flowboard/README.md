# Flowboard

A keyboard-first Kanban board for small teams. Local-first: the board is stored in
your browser (with an export/import escape hatch), so there is no account and no
server to run.

## Features

- **Columns with WIP limits.** A column can declare a `wipLimit`; cards beyond it
  are called out rather than silently allowed.
- **Drag and drop** between columns and within one, with a keyboard fallback
  (`Ctrl+Arrow`) because pointer-only boards are unusable for some people.
- **Filters** by free text, label, assignee and priority, applied through a
  memoized selector so the board is not re-sorted on every render.
- **Labels** are data, not markup: see `src/features/labels/labels.ts`.
- **Undo** for the last destructive action, and a JSON export of the whole board.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # type-check, then bundle
```

## Architecture

```
src/
  app/           store, typed hooks, persistence middleware
  components/    Modal, Avatar, Icon — no feature knowledge
  features/
    board/       the board itself: types, slice, selectors, three components
    card/        the card editor dialog
    filters/     the filter slice and its bar
    labels/      the label catalogue and its chip
  hooks/         drag and drop, hotkeys, media queries
  lib/           pure helpers: ids, formatting, storage
  data/          the seed board
  styles/        design tokens and global rules
```

State lives in one Redux slice (`features/board/boardSlice.ts`) holding a
normalised shape: `cards` is a map keyed by id, and each column keeps an `order`
array of ids. Moving a card is therefore two array edits rather than a search
through nested arrays.

## Persistence

`src/app/persist.ts` installs a listener middleware that writes the board to
`localStorage` after any action that touches it, debounced to one write per
frame. `loadBoard` rehydrates on boot, applying defaults for any field added
since the board was last saved.

## Licence

MIT
