/**
 * The board's vocabulary. Kept in one file so the slice, the selectors and the
 * components all agree on the same shape.
 */

export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type CardId = string
export type ColumnId = string

export interface Card {
  id: CardId
  title: string
  notes: string
  columnId: ColumnId
  labelIds: string[]
  /** Display names, not user ids: this board has no accounts. */
  assignees: string[]
  priority: Priority
  /** ISO day (`2025-03-14`) the card is due, if it has a deadline. */
  due?: string
  done: boolean
  createdAt: string
  updatedAt: string
}

export interface Column {
  id: ColumnId
  title: string
  /** A design token, e.g. `var(--accent-2)`. */
  accent: string
  /** Optional ceiling. Exceeding it is reported, never blocked. */
  wipLimit?: number
}

export interface Board {
  id: string
  title: string
  columns: Column[]
  /** columnId -> card ids, in display order. */
  order: Record<ColumnId, CardId[]>
}

export type BoardStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What is needed to put back something that was removed. */
export interface UndoEntry {
  label: string
  cards: Record<CardId, Card>
  order: Record<ColumnId, CardId[]>
}

export interface BoardState {
  board: Board
  /** Normalised: cards by id, so a move is two array edits. */
  cards: Record<CardId, Card>
  status: BoardStatus
  error?: string
  undo: UndoEntry | null
}

/** The shape the editor dialog works with, new card or existing. */
export interface CardDraft {
  id?: CardId
  title: string
  notes: string
  columnId: ColumnId
  labelIds: string[]
  assignees: string[]
  priority: Priority
  due?: string
}

export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

/** Higher wins when two cards are sorted by priority. */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
}

export const EMPTY_DRAFT: CardDraft = {
  title: '',
  notes: '',
  columnId: '',
  labelIds: [],
  assignees: [],
  priority: 'medium',
}
