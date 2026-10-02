import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import LabelChip from '../labels/LabelChip'
import { LABEL_LIST } from '../labels/labels'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { cardRemoved, cardSaved } from '../board/boardSlice'
import { selectCard } from '../board/selectors'
import { EMPTY_DRAFT, PRIORITIES, PRIORITY_LABEL } from '../board/types'
import type { CardDraft, CardId, ColumnId, Priority } from '../board/types'

interface CardDialogProps {
  /** null opens an empty dialog for a new card. */
  cardId: CardId | null
  columnId: ColumnId
  onClose: () => void
}

export default function CardDialog({ cardId, columnId, onClose }: CardDialogProps) {
  const dispatch = useAppDispatch()
  const existing = useAppSelector((state) => (cardId ? selectCard(state, cardId) : undefined))
  const columns = useAppSelector((state) => state.board.board.columns)

  const [draft, setDraft] = useState<CardDraft>(() => EMPTY_DRAFT)
  const [assigneeInput, setAssigneeInput] = useState('')

  // Re-seed the form whenever a different card is opened: the dialog is mounted
  // once and reused, so state from the previous card would otherwise linger.
  useEffect(() => {
    if (existing) {
      setDraft({
        id: existing.id,
        title: existing.title,
        notes: existing.notes,
        columnId: existing.columnId,
        labelIds: [...existing.labelIds],
        assignees: [...existing.assignees],
        priority: existing.priority,
        due: existing.due,
      })
    } else {
      setDraft({ ...EMPTY_DRAFT, columnId })
    }
    setAssigneeInput('')
  }, [existing, columnId])

  const title = cardId ? 'Edit card' : 'New card'
  const canSave = draft.title.trim().length > 0 && draft.columnId !== ''

  const labels = useMemo(() => new Set(draft.labelIds), [draft.labelIds])

  const patch = (changes: Partial<CardDraft>): void => {
    setDraft((current) => ({ ...current, ...changes }))
  }

  const addAssignee = (): void => {
    const name = assigneeInput.trim()
    if (!name || draft.assignees.includes(name)) return
    patch({ assignees: [...draft.assignees, name] })
    setAssigneeInput('')
  }

  return (
    <Modal open title={title} onClose={onClose}>
      <form
        className="card-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSave) return
          dispatch(cardSaved({ ...draft, title: draft.title.trim() }))
          onClose()
        }}
      >
        <div className="form-group">
          <label htmlFor="card-title">Title</label>
          <input
            id="card-title"
            value={draft.title}
            autoFocus
            onChange={(event) => patch({ title: event.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="card-notes">Notes</label>
          <textarea
            id="card-notes"
            rows={4}
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value })}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="card-column">Column</label>
            <select
              id="card-column"
              value={draft.columnId}
              onChange={(event) => patch({ columnId: event.target.value })}
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="card-priority">Priority</label>
            <select
              id="card-priority"
              value={draft.priority}
              onChange={(event) => patch({ priority: event.target.value as Priority })}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="card-due">Due</label>
            <input
              id="card-due"
              type="date"
              value={draft.due ?? ''}
              onChange={(event) => patch({ due: event.target.value || undefined })}
            />
          </div>
        </div>

        <fieldset className="form-section">
          <legend>Labels</legend>
          <div className="label-grid">
            {LABEL_LIST.map((label) => (
              <button
                key={label.id}
                type="button"
                aria-pressed={labels.has(label.id)}
                onClick={() =>
                  patch({
                    labelIds: labels.has(label.id)
                      ? draft.labelIds.filter((id) => id !== label.id)
                      : [...draft.labelIds, label.id],
                  })
                }
              >
                <LabelChip labelId={label.id} active={labels.has(label.id)} />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Assignees</legend>
          <div className="assignee-row">
            <input
              value={assigneeInput}
              placeholder="Add a name"
              onChange={(event) => setAssigneeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addAssignee()
                }
              }}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addAssignee}>
              Add
            </button>
          </div>
          {draft.assignees.length > 0 && (
            <ul className="assignee-list">
              {draft.assignees.map((name) => (
                <li key={name}>
                  {name}
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() =>
                      patch({ assignees: draft.assignees.filter((item) => item !== name) })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <footer className="modal-actions">
          {cardId && (
            <button
              type="button"
              className="btn btn-ghost btn-danger"
              onClick={() => {
                dispatch(cardRemoved(cardId))
                onClose()
              }}
            >
              <Icon name="trash" size={14} />
              Delete
            </button>
          )}
          <span className="modal-actions-gap" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSave}>
            Save
          </button>
        </footer>
      </form>
    </Modal>
  )
}
