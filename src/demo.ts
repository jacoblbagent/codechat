/**
 * The starter project the IDE opens with: **Flowboard**, a React + Redux Toolkit
 * Kanban board.
 *
 * The files are not strings escaped into this module — they live as real files
 * under `demo/flowboard/` in this repository, with their real extensions, so
 * they can be read, diffed and linted like any other source. They are pulled in
 * as text with Vite's `?raw`, which is why none of them is executed or
 * type-checked as part of the IDE itself: `tsconfig.json` only includes `src`.
 *
 * Ask the assistant about any of them — the board is small enough to hold in
 * your head and structured enough to be worth reading.
 */

import envExample from '../demo/flowboard/.env.example?raw'
import ciWorkflow from '../demo/flowboard/.github/workflows/ci.yml?raw'
import gitignore from '../demo/flowboard/.gitignore?raw'
import readme from '../demo/flowboard/README.md?raw'
import indexHtml from '../demo/flowboard/index.html?raw'
import pkgJson from '../demo/flowboard/package.json?raw'
import app from '../demo/flowboard/src/App.tsx?raw'
import hooks from '../demo/flowboard/src/app/hooks.ts?raw'
import persist from '../demo/flowboard/src/app/persist.ts?raw'
import store from '../demo/flowboard/src/app/store.ts?raw'
import avatar from '../demo/flowboard/src/components/Avatar.tsx?raw'
import icon from '../demo/flowboard/src/components/Icon.tsx?raw'
import modal from '../demo/flowboard/src/components/Modal.tsx?raw'
import seed from '../demo/flowboard/src/data/seed.ts?raw'
import boardView from '../demo/flowboard/src/features/board/Board.tsx?raw'
import boardcolumn from '../demo/flowboard/src/features/board/BoardColumn.tsx?raw'
import cardtile from '../demo/flowboard/src/features/board/CardTile.tsx?raw'
import boardsliceTest from '../demo/flowboard/src/features/board/boardSlice.test.ts?raw'
import boardslice from '../demo/flowboard/src/features/board/boardSlice.ts?raw'
import selectors from '../demo/flowboard/src/features/board/selectors.ts?raw'
import types from '../demo/flowboard/src/features/board/types.ts?raw'
import carddialog from '../demo/flowboard/src/features/card/CardDialog.tsx?raw'
import filterbar from '../demo/flowboard/src/features/filters/FilterBar.tsx?raw'
import filterslice from '../demo/flowboard/src/features/filters/filterSlice.ts?raw'
import labelchip from '../demo/flowboard/src/features/labels/LabelChip.tsx?raw'
import labels from '../demo/flowboard/src/features/labels/labels.ts?raw'
import usedraganddrop from '../demo/flowboard/src/hooks/useDragAndDrop.ts?raw'
import usehotkeys from '../demo/flowboard/src/hooks/useHotkeys.ts?raw'
import usemediaquery from '../demo/flowboard/src/hooks/useMediaQuery.ts?raw'
import format from '../demo/flowboard/src/lib/format.ts?raw'
import id from '../demo/flowboard/src/lib/id.ts?raw'
import storage from '../demo/flowboard/src/lib/storage.ts?raw'
import mainEntry from '../demo/flowboard/src/main.tsx?raw'
import globalFile from '../demo/flowboard/src/styles/global.css?raw'
import tokens from '../demo/flowboard/src/styles/tokens.css?raw'
import viteEnvD from '../demo/flowboard/src/vite-env.d.ts?raw'
import tsconfig from '../demo/flowboard/tsconfig.json?raw'
import viteConfig from '../demo/flowboard/vite.config.ts?raw'

export interface DemoFile {
  path: string
  content: string
}

/** Shown in the title bar as the workspace name. */
export const DEMO_ROOT_NAME = 'flowboard'

const RAW: DemoFile[] = [
  { path: '.env.example', content: envExample },
  { path: '.github/workflows/ci.yml', content: ciWorkflow },
  { path: '.gitignore', content: gitignore },
  { path: 'README.md', content: readme },
  { path: 'index.html', content: indexHtml },
  { path: 'package.json', content: pkgJson },
  { path: 'src/App.tsx', content: app },
  { path: 'src/app/hooks.ts', content: hooks },
  { path: 'src/app/persist.ts', content: persist },
  { path: 'src/app/store.ts', content: store },
  { path: 'src/components/Avatar.tsx', content: avatar },
  { path: 'src/components/Icon.tsx', content: icon },
  { path: 'src/components/Modal.tsx', content: modal },
  { path: 'src/data/seed.ts', content: seed },
  { path: 'src/features/board/Board.tsx', content: boardView },
  { path: 'src/features/board/BoardColumn.tsx', content: boardcolumn },
  { path: 'src/features/board/CardTile.tsx', content: cardtile },
  { path: 'src/features/board/boardSlice.test.ts', content: boardsliceTest },
  { path: 'src/features/board/boardSlice.ts', content: boardslice },
  { path: 'src/features/board/selectors.ts', content: selectors },
  { path: 'src/features/board/types.ts', content: types },
  { path: 'src/features/card/CardDialog.tsx', content: carddialog },
  { path: 'src/features/filters/FilterBar.tsx', content: filterbar },
  { path: 'src/features/filters/filterSlice.ts', content: filterslice },
  { path: 'src/features/labels/LabelChip.tsx', content: labelchip },
  { path: 'src/features/labels/labels.ts', content: labels },
  { path: 'src/hooks/useDragAndDrop.ts', content: usedraganddrop },
  { path: 'src/hooks/useHotkeys.ts', content: usehotkeys },
  { path: 'src/hooks/useMediaQuery.ts', content: usemediaquery },
  { path: 'src/lib/format.ts', content: format },
  { path: 'src/lib/id.ts', content: id },
  { path: 'src/lib/storage.ts', content: storage },
  { path: 'src/main.tsx', content: mainEntry },
  { path: 'src/styles/global.css', content: globalFile },
  { path: 'src/styles/tokens.css', content: tokens },
  { path: 'src/vite-env.d.ts', content: viteEnvD },
  { path: 'tsconfig.json', content: tsconfig },
  { path: 'vite.config.ts', content: viteConfig },
]

export const DEMO_FILES: DemoFile[] = RAW
