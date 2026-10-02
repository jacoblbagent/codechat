import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { SEED_BOARD, SEED_CARDS } from '../../data/seed'
import { newId } from '../../lib/id'
import { BOARD_KEY, readJson } from '../../lib/storage'
import type {
  Board,
  BoardState,
  Card,
  CardDraft,
  CardId,
  ColumnId,
  UndoEntry,
} from './types'

/** What actually goes into localStorage. */
export interface SavedBoard {
  board: Board
  cards: Record<CardId, Card>
}

const INITIAL_STATE: BoardState = {
  board: SEED_BOARD,
  cards: SEED_CARDS,
  status: 'idle',
  undo: null,
}

function copyOrder(order: Record<ColumnId, CardId[]>): Record<ColumnId, CardId[]> {
  const next: Record<ColumnId, CardId[]> = {}
  for (const [columnId, ids] of Object.entries(order)) next[columnId] = [...ids]
  return next
}

function snapshot(state: BoardState, label: string): UndoEntry {
  return { label, cards: { ...state.cards }, order: copyOrder(state.board.order) }
}

/** The list for a column, created on demand so a new column is never undefined. */
function bucket(state: BoardState, columnId: ColumnId): CardId[] {
  const existing = state.board.order[columnId]
  if (existing) return existing
  const created: CardId[] = []
  state.board.order[columnId] = created
  return created
}

/** The last column is Done by convention, rather than by a hard-coded id. */
function doneColumnId(board: Board): ColumnId | undefined {
  return board.columns.at(-1)?.id
}

/** Fill in anything a board saved by an older version did not have. */
function hydrate(saved: SavedBoard): { board: Board; cards: Record<CardId, Card> } {
  const board: Board = {
    ...SEED_BOARD,
    ...saved.board,
    columns: saved.board.columns?.length ? saved.board.columns : SEED_BOARD.columns,
    order: { ...SEED_BOARD.order, ...(saved.board.order ?? {}) },
  }
  const cards: Record<CardId, Card> = {}
  for (const [id, card] of Object.entries(saved.cards ?? {})) {
    cards[id] = { notes: '', labelIds: [], assignees: [], done: false, ...card }
  }
  return { board, cards }
}

export const loadBoard = createAsyncThunk('board/load', async () => {
  const saved = readJson<SavedBoard | null>(BOARD_KEY, null)
  if (!saved?.board) return { board: SEED_BOARD, cards: SEED_CARDS }
  return hydrate(saved)
})

export const boardSlice = createSlice({
  name: 'board',
  initialState: INITIAL_STATE,
  reducers: {
    /** Create a card from a draft, or save the changes to an existing one. */
    cardSaved: (state, action: PayloadAction<CardDraft & { id?: CardId }>) => {
      const draft = action.payload
      const existing = draft.id ? state.cards[draft.id] : undefined

      if (existing) {
        Object.assign(existing, {
          title: draft.title,
          notes: draft.notes,
          labelIds: [...draft.labelIds],
          assignees: [...draft.assignees],
          priority: draft.priority,
          due: draft.due,
          updatedAt: new Date().toISOString(),
        })
        if (existing.columnId !== draft.columnId) {
          const source = bucket(state, existing.columnId)
          const at = source.indexOf(existing.id)
          if (at >= 0) source.splice(at, 1)
          bucket(state, draft.columnId).push(existing.id)
          existing.columnId = draft.columnId
        }
        return
      }

      const now = new Date().toISOString()
      const created: Card = {
        id: newId(),
        title: draft.title,
        notes: draft.notes,
        columnId: draft.columnId,
        labelIds: [...draft.labelIds],
        assignees: [...draft.assignees],
        priority: draft.priority,
        due: draft.due,
        done: draft.columnId === doneColumnId(state.board),
        createdAt: now,
        updatedAt: now,
      }
      state.cards[created.id] = created
      bucket(state, created.columnId).push(created.id)
    },

    cardMoved: (
      state,
      action: PayloadAction<{ cardId: CardId; to: ColumnId; index: number }>,
    ) => {
      const { cardId, to, index } = action.payload
      const card = state.cards[cardId]
      if (!card) return

      const source = bucket(state, card.columnId)
      const at = source.indexOf(cardId)
      if (at >= 0) source.splice(at, 1)

      const target = bucket(state, to)
      target.splice(Math.max(0, Math.min(index, target.length)), 0, cardId)

      card.columnId = to
      card.done = to === doneColumnId(state.board)
      card.updatedAt = new Date().toISOString()
    },

    /** Replace a whole column's order, e.g. after sorting it. */
    cardsReordered: (
      state,
      action: PayloadAction<{ columnId: ColumnId; ids: CardId[] }>,
    ) => {
      const known = new Set(Object.keys(state.cards))
      state.board.order[action.payload.columnId] = action.payload.ids.filter((id) => known.has(id))
    },

    cardRemoved: (state, action: PayloadAction<CardId>) => {
      const card = state.cards[action.payload]
      if (!card) return
      state.undo = snapshot(state, `Delete “${card.title}”`)
      delete state.cards[action.payload]
      const list = bucket(state, card.columnId)
      const at = list.indexOf(card.id)
      if (at >= 0) list.splice(at, 1)
    },

    columnAdded: (state, action: PayloadAction<{ title: string; accent?: string }>) => {
      const column = {
        id: newId('col'),
        title: action.payload.title,
        accent: action.payload.accent ?? 'var(--accent-1)',
      }
      state.board.columns.push(column)
      state.board.order[column.id] = []
    },

    columnRenamed: (
      state,
      action: PayloadAction<{ columnId: ColumnId; title: string }>,
    ) => {
      const column = state.board.columns.find((c) => c.id === action.payload.columnId)
      if (column) column.title = action.payload.title
    },

    /** Removing a column keeps its cards: they move into the column before it. */
    columnRemoved: (state, action: PayloadAction<ColumnId>) => {
      const at = state.board.columns.findIndex((c) => c.id === action.payload)
      if (at < 0) return
      const [removed] = state.board.columns.splice(at, 1)
      if (!removed) return
      const orphans = state.board.order[removed.id] ?? []
      delete state.board.order[removed.id]

      const fallback = state.board.columns[Math.max(0, at - 1)]
      for (const id of orphans) {
        const card = state.cards[id]
        if (!card) continue
        if (fallback) {
          card.columnId = fallback.id
          bucket(state, fallback.id).push(id)
        } else {
          delete state.cards[id]
        }
      }
    },

    boardReplaced: (state, action: PayloadAction<SavedBoard>) => {
      state.undo = snapshot(state, 'Import a board')
      const next = hydrate(action.payload)
      state.board = next.board
      state.cards = next.cards
      state.status = 'ready'
      state.error = undefined
    },

    boardCleared: (state) => {
      state.undo = snapshot(state, 'Clear the board')
      state.cards = {}
      const [first] = state.board.columns
      state.board.columns = first ? [{ ...first, wipLimit: undefined }] : []
      state.board.order = {}
      for (const column of state.board.columns) state.board.order[column.id] = []
    },

    /** One level of undo, for the actions that destroy something. */
    undoLast: (state) => {
      const entry = state.undo
      if (!entry) return
      state.cards = entry.cards
      state.board.order = entry.order
      state.undo = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadBoard.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(loadBoard.fulfilled, (state, action) => {
        state.board = action.payload.board
        state.cards = action.payload.cards
        state.status = 'ready'
      })
      .addCase(loadBoard.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.error.message ?? 'Could not read the saved board.'
      })
  },
})

export const {
  boardCleared,
  boardReplaced,
  cardMoved,
  cardRemoved,
  cardSaved,
  cardsReordered,
  columnAdded,
  columnRemoved,
  columnRenamed,
  undoLast,
} = boardSlice.actions

export default boardSlice.reducer
