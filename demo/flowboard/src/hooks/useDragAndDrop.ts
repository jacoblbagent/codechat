import { useCallback, useState } from 'react'
import type { DragEvent, HTMLAttributes } from 'react'
import type { Card, CardId, ColumnId } from '../features/board/types'

export interface DropTarget {
  columnId: ColumnId
  index: number
}

export type DropHandler = (cardId: CardId, columnId: ColumnId, index: number) => void

export interface UseDragAndDrop {
  /** The card being dragged, or null. */
  cardId: CardId | null
  /** Where it would land if dropped right now. */
  target: DropTarget | null
  /** Props for a card element. */
  cardProps: (card: Card) => HTMLAttributes<HTMLElement>
  /** Props for a column's list element. */
  listProps: (columnId: ColumnId) => HTMLAttributes<HTMLElement>
}

/**
 * Drag and drop without a library. The data transfer carries the card id only;
 * everything else comes from the store, which keeps the drag honest if the
 * board changes underneath it.
 */
export function useDragAndDrop(onDrop: DropHandler): UseDragAndDrop {
  const [cardId, setCardId] = useState<CardId | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)

  const finish = useCallback(() => {
    setCardId(null)
    setTarget(null)
  }, [])

  const cardProps = useCallback(
    (card: Card): HTMLAttributes<HTMLElement> => ({
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', card.id)
        setCardId(card.id)
      },
      onDragEnd: finish,
    }),
    [finish],
  )

  const listProps = useCallback(
    (columnId: ColumnId): HTMLAttributes<HTMLElement> => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!cardId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setTarget({ columnId, index: Number.MAX_SAFE_INTEGER })
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault()
        const dragged = cardId ?? event.dataTransfer.getData('text/plain')
        const index = target?.index ?? Number.MAX_SAFE_INTEGER
        finish()
        if (dragged) onDrop(dragged, columnId, index)
      },
    }),
    [cardId, target, onDrop, finish],
  )

  return { cardId, target, cardProps, listProps }
}
