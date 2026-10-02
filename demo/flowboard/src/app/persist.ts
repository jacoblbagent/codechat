import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import {
  boardCleared,
  boardReplaced,
  cardAdded,
  cardMoved,
  cardRemoved,
  cardUpdated,
  cardsReordered,
  columnAdded,
  columnRemoved,
  columnRenamed,
  undoLast,
} from '../features/board/boardSlice'
import { BOARD_KEY, writeJson } from '../lib/storage'
import type { SavedBoard } from '../features/board/boardSlice'
import type { RootState } from './store'

/**
 * Persistence is a listener rather than a middleware written by hand: the
 * reducers stay pure, and only the actions that actually change the board
 * schedule a write.
 */
export const persistBoard = createListenerMiddleware()

let timer: ReturnType<typeof setTimeout> | undefined

/** Dragging a card fires a burst of actions; save once the burst ends. */
function scheduleWrite(state: RootState): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const saved: SavedBoard = { board: state.board, cards: state.cards }
    writeJson(BOARD_KEY, saved)
  }, 250)
}

persistBoard.startListening({
  matcher: isAnyOf(
    cardAdded,
    cardUpdated,
    cardRemoved,
    cardMoved,
    cardsReordered,
    columnAdded,
    columnRenamed,
    columnRemoved,
    boardReplaced,
    boardCleared,
    undoLast,
  ),
  effect: (_action, api) => scheduleWrite(api.getState() as RootState),
})
