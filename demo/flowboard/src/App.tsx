import { useRef } from 'react'
import Board from './features/board/Board'
import FilterBar from './features/filters/FilterBar'
import Icon from './components/Icon'
import { useAppDispatch, useAppSelector } from './app/hooks'
import { useHotkeys } from './hooks/useHotkeys'
import { boardCleared, undoLast } from './features/board/boardSlice'
import {
  selectTitle,
  selectTotalCount,
  selectUndoLabel,
  selectVisibleCount,
} from './features/board/selectors'

export default function App() {
  const dispatch = useAppDispatch()
  const title = useAppSelector(selectTitle)
  const total = useAppSelector(selectTotalCount)
  const visible = useAppSelector(selectVisibleCount)
  const undoLabel = useAppSelector(selectUndoLabel)
  const boardRef = useRef<HTMLDivElement>(null)

  useHotkeys({
    // Ctrl+Z is undo, the way every editor means it. The browser's own undo is
    // not useful here because nothing on this page is a text field at rest.
    'ctrl+z': () => dispatch(undoLast()),
    'ctrl+shift+z': () => dispatch(undoLast()),
  })

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-brand">
          <Icon name="board" size={18} />
          <h1 className="app-title">{title}</h1>
        </div>

        <p className="app-count" aria-live="polite">
          {visible === total ? `${total} cards` : `${visible} of ${total} cards`}
        </p>

        <div className="app-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => dispatch(undoLast())}
            disabled={!undoLabel}
            title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
          >
            <Icon name="undo" size={14} />
            Undo
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-danger"
            onClick={() => {
              if (window.confirm('Clear every card from this board?')) dispatch(boardCleared())
            }}
          >
            Clear
          </button>
        </div>
      </header>

      <FilterBar />

      <main className="app-main" ref={boardRef}>
        <Board />
      </main>
    </div>
  )
}
