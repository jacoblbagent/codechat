import { describe, expect, it } from 'vitest'
import reducer, { cardMoved, cardRemoved, cardSaved, undoLast } from './boardSlice'
import { SEED_BOARD, SEED_CARDS } from '../../data/seed'
import type { BoardState } from './types'

const initial = (): BoardState => ({
  board: structuredClone(SEED_BOARD),
  cards: structuredClone(SEED_CARDS),
  status: 'ready',
  undo: null,
})

const orderOf = (state: BoardState, columnId: string): string[] =>
  state.board.order[columnId] ?? []

describe('boardSlice', () => {
  it('appends a new card to the end of its column', () => {
    const state = reducer(
      initial(),
      cardSaved({
        title: 'Write the release notes',
        notes: '',
        columnId: 'col_todo',
        labelIds: ['copy'],
        assignees: [],
        priority: 'low',
      }),
    )

    const added = orderOf(state, 'col_todo').at(-1)
    expect(added).toBeDefined()
    expect(state.cards[added!]?.title).toBe('Write the release notes')
    expect(Object.keys(state.cards)).toHaveLength(Object.keys(SEED_CARDS).length + 1)
  })

  it('moves a card without duplicating it', () => {
    const before = initial()
    expect(orderOf(before, 'col_doing')).toContain('card_undo')

    const state = reducer(before, cardMoved({ cardId: 'card_undo', to: 'col_done', index: 0 }))

    expect(orderOf(state, 'col_doing')).not.toContain('card_undo')
    expect(orderOf(state, 'col_done')[0]).toBe('card_undo')
    expect(state.cards['card_undo']?.columnId).toBe('col_done')
  })

  it('marks a card done when it lands in the last column', () => {
    const state = reducer(initial(), cardMoved({ cardId: 'card_export', to: 'col_done', index: 0 }))
    expect(state.cards['card_export']?.done).toBe(true)
  })

  it('records an undo point when a card is deleted, and restores it', () => {
    const removed = reducer(initial(), cardRemoved('card_export'))
    expect(removed.cards['card_export']).toBeUndefined()
    expect(removed.undo?.label).toContain('Export the board')

    const restored = reducer(removed, undoLast())
    expect(restored.cards['card_export']?.title).toBe('Export the board as JSON')
    expect(orderOf(restored, 'col_backlog')).toContain('card_export')
  })

  it('inserts at the requested index rather than always at the end', () => {
    const state = reducer(initial(), cardMoved({ cardId: 'card_export', to: 'col_review', index: 0 }))
    expect(orderOf(state, 'col_review')[0]).toBe('card_export')
    expect(orderOf(state, 'col_review')).toHaveLength(2)
  })
})
