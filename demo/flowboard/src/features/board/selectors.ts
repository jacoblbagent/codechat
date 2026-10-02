import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'
import { selectFilters, type Filters } from '../filters/filterSlice'
import { PRIORITY_WEIGHT } from './types'
import type { Card, CardId, ColumnId } from './types'

export const selectBoard = (state: RootState) => state.board.board
export const selectTitle = (state: RootState) => state.board.board.title
export const selectUndoLabel = (state: RootState) => state.board.undo?.label ?? null
export const selectStatus = (state: RootState) => state.board.status

export const selectCard = (state: RootState, id: CardId) => state.board.cards[id]

/** Free text hits the title and the notes; everything else is a hard filter. */
function matchesCard(card: Card, filters: Filters): boolean {
  if (filters.hideDone && card.done) return false
  if (filters.priorities.length && !filters.priorities.includes(card.priority)) return false
  if (filters.labelIds.length && !filters.labelIds.every((id) => card.labelIds.includes(id))) {
    return false
  }
  if (filters.assignees.length && !filters.assignees.some((n) => card.assignees.includes(n))) {
    return false
  }
  const query = filters.query.trim().toLowerCase()
  if (!query) return true
  return (
    card.title.toLowerCase().includes(query) || card.notes.toLowerCase().includes(query)
  )
}

/**
 * One pass over the board, memoized on the card map and the filters. Sorting
 * happens here too, so a column renders in priority order without the
 * component owning any of that.
 */
export const selectVisibleByColumn = createSelector(
  [
    (state: RootState) => state.board.cards,
    (state: RootState) => state.board.board,
    selectFilters,
  ],
  (cards, board, filters) => {
    const result: Record<ColumnId, Card[]> = {}
    for (const column of board.columns) {
      const ids = board.order[column.id] ?? []
      result[column.id] = ids
        .map((id) => cards[id])
        .filter((card): card is Card => Boolean(card) && matchesCard(card, filters))
        .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority])
    }
    return result
  },
)

export const selectVisibleCount = createSelector([selectVisibleByColumn], (byColumn) =>
  Object.values(byColumn).reduce((total, list) => total + list.length, 0),
)

export const selectTotalCount = (state: RootState) => Object.keys(state.board.cards).length

/** Per-column counts, and whether the column is over its WIP limit. */
export const selectColumnStats = createSelector(
  [selectVisibleByColumn, selectBoard],
  (byColumn, board) => {
    const stats: Record<ColumnId, { shown: number; total: number; wipLimit?: number; over: boolean }> = {}
    for (const column of board.columns) {
      const total = (board.order[column.id] ?? []).length
      stats[column.id] = {
        shown: byColumn[column.id]?.length ?? 0,
        total,
        wipLimit: column.wipLimit,
        over: column.wipLimit !== undefined && total > column.wipLimit,
      }
    }
    return stats
  },
)

/** How many visible cards carry each label, for the filter bar's counts. */
export const selectLabelCounts = createSelector([selectVisibleByColumn], (byColumn) => {
  const counts: Record<string, number> = {}
  for (const list of Object.values(byColumn)) {
    for (const card of list) {
      for (const id of card.labelIds) counts[id] = (counts[id] ?? 0) + 1
    }
  }
  return counts
})

/** Every assignee on the board, sorted, for the filter bar. */
export const selectAssignees = createSelector(
  [(state: RootState) => state.board.cards],
  (cards) => {
    const names = new Set<string>()
    for (const card of Object.values(cards)) {
      for (const name of card.assignees) names.add(name)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  },
)
