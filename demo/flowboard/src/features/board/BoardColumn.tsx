import type { CSSProperties } from 'react'
import CardTile from './CardTile'
import Icon from '../../components/Icon'
import type { Card, Column, ColumnId } from './types'
import type { UseDragAndDrop } from '../../hooks/useDragAndDrop'

interface ColumnStats {
  shown: number
  total: number
  wipLimit?: number
  over: boolean
}

interface BoardColumnProps {
  column: Column
  cards: Card[]
  stats?: ColumnStats
  filtered: boolean
  drag: UseDragAndDrop
  onOpenCard: (card: Card) => void
  onToggleDone: (card: Card) => void
  onAddCard: (columnId: ColumnId) => void
}

export default function BoardColumn({
  column,
  cards,
  stats,
  filtered,
  drag,
  onOpenCard,
  onToggleDone,
  onAddCard,
}: BoardColumnProps) {
  const total = stats?.total ?? cards.length
  const over = stats?.over ?? false

  return (
    <section
      className={`board-column${over ? ' is-over' : ''}`}
      style={{ '--column': column.accent } as CSSProperties}
      aria-labelledby={`col-head-${column.id}`}
      {...drag.listProps(column.id)}
    >
      <header className="column-head">
        <h2 id={`col-head-${column.id}`} className="column-title">
          {column.title}
        </h2>
        <span className="column-count">
          {filtered ? `${cards.length} of ${total}` : total}
        </span>
        {column.wipLimit !== undefined && (
          <span className={`column-wip${over ? ' is-over' : ''}`} title="Work in progress limit">
            {total}/{column.wipLimit}
          </span>
        )}
        <button
          type="button"
          className="column-add"
          aria-label={`Add a card to ${column.title}`}
          onClick={() => onAddCard(column.id)}
        >
          <Icon name="plus" size={14} />
        </button>
      </header>

      <div className="column-list">
        {cards.length === 0 ? (
          <p className="column-empty">{filtered ? 'Nothing matches the filters.' : 'No cards yet.'}</p>
        ) : (
          cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              dragging={drag.cardId === card.id}
              drag={drag}
              onOpen={onOpenCard}
              onToggleDone={onToggleDone}
            />
          ))
        )}
      </div>

      {over && (
        <p className="column-warning" role="status">
          Over the limit by {total - (column.wipLimit ?? 0)}.
        </p>
      )}
    </section>
  )
}
