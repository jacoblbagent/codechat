import type { Board, Card, CardId } from '../features/board/types'

/**
 * The board a first-time visitor sees. Ids are stable so that a re-seed can
 * recognise and replace its own cards without touching the ones you added.
 */

const day = (offset: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

const stamp = (offsetDays: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString()
}

export const SEED_BOARD: Board = {
  id: 'board_seed',
  title: 'Flowboard',
  columns: [
    { id: 'col_backlog', title: 'Backlog', accent: 'var(--accent-1)' },
    { id: 'col_todo', title: 'Ready', accent: 'var(--accent-2)', wipLimit: 6 },
    { id: 'col_doing', title: 'In progress', accent: 'var(--accent-3)', wipLimit: 3 },
    { id: 'col_review', title: 'Review', accent: 'var(--accent-4)', wipLimit: 3 },
    { id: 'col_done', title: 'Done', accent: 'var(--accent-5)' },
  ],
  order: {
    col_backlog: ['card_drag_backlog', 'card_export', 'card_i18n'],
    col_todo: ['card_wip_limits', 'card_labels_crud'],
    col_doing: ['card_undo', 'card_seed_dates'],
    col_review: ['card_a11y_pass'],
    col_done: ['card_scaffold'],
  },
}

const card = (input: Partial<Card> & Pick<Card, 'id' | 'title' | 'columnId'>): Card => ({
  notes: '',
  labelIds: [],
  assignees: [],
  priority: 'medium',
  done: false,
  createdAt: stamp(-14),
  updatedAt: stamp(-1),
  ...input,
})

export const SEED_CARDS: Record<CardId, Card> = {
  card_scaffold: card({
    id: 'card_scaffold',
    title: 'Scaffold the board and the store',
    columnId: 'col_done',
    notes: 'Vite + React + RTK, normalised card map, one column per list.',
    labelIds: ['infra'],
    assignees: ['Ada Lovelace'],
    priority: 'high',
    done: true,
  }),
  card_a11y_pass: card({
    id: 'card_a11y_pass',
    title: 'Keyboard pass over the board',
    columnId: 'col_review',
    notes: 'Move a card with Ctrl+Arrow, open the editor with Enter, escape closes.',
    labelIds: ['a11y', 'design'],
    assignees: ['Grace Hopper'],
    priority: 'high',
    due: day(2),
  }),
  card_undo: card({
    id: 'card_undo',
    title: 'Undo the last destructive action',
    columnId: 'col_doing',
    notes: 'Snapshot the cards and the order before a delete, offer one level of undo.',
    labelIds: ['infra'],
    assignees: ['Ada Lovelace', 'Alan Turing'],
    priority: 'medium',
    due: day(1),
  }),
  card_seed_dates: card({
    id: 'card_seed_dates',
    title: 'Seed dates must stay relative',
    columnId: 'col_doing',
    notes: 'Seeded cards use day offsets so the board never looks stale on a fresh clone.',
    labelIds: ['bug'],
    assignees: ['Alan Turing'],
    priority: 'low',
    due: day(-2),
  }),
  card_wip_limits: card({
    id: 'card_wip_limits',
    title: 'Report columns over their WIP limit',
    columnId: 'col_todo',
    notes: 'A count above the limit turns the column header amber. Never block the drop.',
    labelIds: ['design'],
    assignees: ['Katherine Johnson'],
    priority: 'medium',
    due: day(5),
  }),
  card_labels_crud: card({
    id: 'card_labels_crud',
    title: 'Edit labels from the card dialog',
    columnId: 'col_todo',
    notes: 'Toggle chips rather than a multi-select: fewer clicks, and it reads better.',
    labelIds: ['design', 'copy'],
    assignees: ['Katherine Johnson'],
    priority: 'low',
  }),
  card_drag_backlog: card({
    id: 'card_drag_backlog',
    title: 'Pointer drag between columns',
    columnId: 'col_backlog',
    notes: 'HTML5 drag events, with a placeholder so the drop target does not jump.',
    labelIds: ['design'],
    priority: 'high',
  }),
  card_export: card({
    id: 'card_export',
    title: 'Export the board as JSON',
    columnId: 'col_backlog',
    notes: 'Local-first means the data has to be portable. Import should tolerate an old shape.',
    labelIds: ['infra', 'copy'],
    priority: 'low',
  }),
  card_i18n: card({
    id: 'card_i18n',
    title: 'Localise the date helpers',
    columnId: 'col_backlog',
    notes: 'format.ts hard-codes en-US; thread a locale through from the app.',
    labelIds: ['copy'],
    priority: 'low',
  }),
}
