import { useCallback, useMemo, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import CardDialog from '../card/CardDialog'
import { useDragAndDrop } from '../../hooks/useDragAndDrop'
import { cardMoved, cardSaved } from './boardSlice'
import { selectColumnStats, selectVisibleByColumn } from './selectors'
import BoardColumn from './BoardColumn'
import type { Card, CardId, ColumnId } from './types'

/** Which card the dialog is open on, and which column a new card belongs to. */
interface EditorTarget {
  cardId: CardId | null
  columnId: ColumnId
}

export default function Board() {
  const dispatch = useAppDispatch()
  const columns = useAppSelector((state) => state.board.board.columns)
  const byColumn = useAppSelector(selectVisibleByColumn)
  const stats = useAppSelector(selectColumnStats)
  const filters = useAppSelector((state) => state.filters)
  const [editor, setEditor] = useState<EditorTarget | null>(null)

  const drag = useDragAndDrop(
    useCallback(
      (cardId: CardId, columnId: ColumnId, index: number) => {
        dispatch(cardMoved({ cardId, to: columnId, index }))
      },
      [dispatch],
    ),
  )

  const filtered = useMemo(
    () =>
      filters.query.trim() !== '' ||
      filters.labelIds.length > 0 ||
      filters.assignees.length > 0 ||
      filters.priorities.length > 0 ||
      filters.hideDone,
    [filters],
  )

  const toggleDone = useCallback(
    (card: Card) => {
      dispatch(
        cardSaved({
          id: card.id,
          title: card.title,
          notes: card.notes,
          columnId: card.columnId,
          labelIds: card.labelIds,
          assignees: card.assignees,
          priority: card.priority,
          due: card.due,
        }),
      )
      // A done card belongs in the last column, so send it there rather than
      // leaving a ticked card sitting in the middle of the board.
      if (!card.done) {
        const last = columns.at(-1)
        if (last && last.id !== card.columnId) {
          dispatch(cardMoved({ cardId: card.id, to: last.id, index: 0 }))
        }
      }
    },
    [columns, dispatch],
  )

  return (
    <>
      <div className="board" role="list" aria-label="Board columns">
        {columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={byColumn[column.id] ?? []}
            stats={stats[column.id]}
            filtered={filtered}
            drag={drag}
            onOpenCard={(card) => setEditor({ cardId: card.id, columnId: card.columnId })}
            onToggleDone={toggleDone}
            onAddCard={(columnId) => setEditor({ cardId: null, columnId })}
          />
        ))}
      </div>

      {editor && (
        <CardDialog
          cardId={editor.cardId}
          columnId={editor.columnId}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  )
}
