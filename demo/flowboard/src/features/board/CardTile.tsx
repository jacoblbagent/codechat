import { useState } from 'react'
import Avatar from '../../components/Avatar'
import Icon from '../../components/Icon'
import LabelChip from '../labels/LabelChip'
import { formatDue, truncate } from '../../lib/format'
import { PRIORITY_LABEL } from './types'
import type { Card } from './types'
import type { UseDragAndDrop } from '../../hooks/useDragAndDrop'

interface CardTileProps {
  card: Card
  dragging: boolean
  drag: UseDragAndDrop
  onOpen: (card: Card) => void
  onToggleDone: (card: Card) => void
}

export default function CardTile({ card, dragging, drag, onOpen, onToggleDone }: CardTileProps) {
  const [cursor, setCursor] = useState(false)
  const due = card.due ? formatDue(card.due) : ''
  const late = due.endsWith('late')

  return (
    <article
      className={`card-tile${dragging ? ' is-dragging' : ''}${card.done ? ' is-done' : ''}`}
      data-card={card.id}
      data-priority={card.priority}
      tabIndex={0}
      role="button"
      aria-label={`${card.title}. ${PRIORITY_LABEL[card.priority]} priority.`}
      {...drag.cardProps(card)}
      onClick={() => onOpen(card)}
      onMouseEnter={() => setCursor(true)}
      onMouseLeave={() => setCursor(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(card)
        if (event.key === ' ') {
          event.preventDefault()
          onToggleDone(card)
        }
      }}
    >
      <header className="card-tile-head">
        <button
          type="button"
          className="card-check"
          aria-pressed={card.done}
          aria-label={card.done ? 'Mark as not done' : 'Mark as done'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleDone(card)
          }}
        >
          <Icon name={card.done ? 'check-square' : 'square'} size={14} />
        </button>
        <h3 className="card-title">{card.title}</h3>
      </header>

      {card.notes && <p className="card-notes">{truncate(card.notes, 110)}</p>}

      {card.labelIds.length > 0 && (
        <div className="card-labels">
          {card.labelIds.map((id) => (
            <LabelChip key={id} labelId={id} />
          ))}
        </div>
      )}

      <footer className="card-foot">
        <span className={`card-priority priority-${card.priority}`}>
          {PRIORITY_LABEL[card.priority]}
        </span>
        {due && (
          <span className={`card-due${late ? ' is-late' : ''}`}>
            <Icon name="clock" size={12} />
            {due}
          </span>
        )}
        <span className="card-avatars">
          {card.assignees.slice(0, 3).map((name) => (
            <Avatar key={name} name={name} size={20} />
          ))}
          {card.assignees.length > 3 && (
            <span className="card-avatars-more">+{card.assignees.length - 3}</span>
          )}
        </span>
        {cursor && (
          <button
            type="button"
            className="card-drag-handle"
            aria-label={`Drag ${card.title}`}
            title="Drag to move"
          >
            <Icon name="grip" size={14} />
          </button>
        )}
      </footer>
    </article>
  )
}
