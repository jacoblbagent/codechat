import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import LabelChip from '../labels/LabelChip'
import { LABEL_LIST } from '../labels/labels'
import { selectAssignees, selectLabelCounts } from '../board/selectors'
import { PRIORITIES, PRIORITY_LABEL } from '../board/types'
import { useState } from 'react'
import Icon from '../../components/Icon'
import {
  assigneeToggled,
  filtersCleared,
  hideDoneToggled,
  labelToggled,
  priorityToggled,
  queryChanged,
  selectFilters,
  selectIsFiltered,
} from './filterSlice'

export default function FilterBar() {
  const dispatch = useAppDispatch()
  const filters = useAppSelector(selectFilters)
  const isFiltered = useAppSelector(selectIsFiltered)
  const counts = useAppSelector(selectLabelCounts)
  const assignees = useAppSelector(selectAssignees)

  // Below the breakpoint the bar collapses to a single row: a phone cannot hold
  // four filter groups and still show a board.
  const compact = useMediaQuery('(max-width: 768px)')
  const [open, setOpen] = useState(false)
  const expanded = !compact || open

  return (
    <section className="filter-bar" aria-label="Filters">
      <label className="filter-search">
        <Icon name="search" size={14} />
        <span className="sr-only">Search cards</span>
        <input
          type="search"
          value={filters.query}
          placeholder="Search cards"
          onChange={(event) => dispatch(queryChanged(event.target.value))}
        />
      </label>

      {compact && (
        <button
          type="button"
          className="btn btn-ghost filter-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="filter" size={14} />
          Filters
        </button>
      )}

      {expanded && (
        <>
          <div className="filter-group" role="group" aria-label="Labels">
            {LABEL_LIST.map((label) => (
              <button
                key={label.id}
                type="button"
                className="filter-chip"
                aria-pressed={filters.labelIds.includes(label.id)}
                onClick={() => dispatch(labelToggled(label.id))}
              >
                <LabelChip labelId={label.id} active={filters.labelIds.includes(label.id)} />
                <span className="filter-chip-count">{counts[label.id] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="filter-group" role="group" aria-label="Priority">
            {PRIORITIES.map((priority) => (
              <button
                key={priority}
                type="button"
                className={`filter-chip priority-${priority}`}
                aria-pressed={filters.priorities.includes(priority)}
                onClick={() => dispatch(priorityToggled(priority))}
              >
                {PRIORITY_LABEL[priority]}
              </button>
            ))}
          </div>

          {assignees.length > 0 && (
            <label className="filter-select">
              <span className="sr-only">Assignee</span>
              <select
                value={filters.assignees.at(0) ?? ''}
                onChange={(event) => {
                  for (const name of filters.assignees) dispatch(assigneeToggled(name))
                  if (event.target.value) dispatch(assigneeToggled(event.target.value))
                }}
              >
                <option value="">Anyone</option>
                {assignees.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="filter-chip"
            aria-pressed={filters.hideDone}
            onClick={() => dispatch(hideDoneToggled())}
          >
            Hide done
          </button>

          {isFiltered && (
            <button
              type="button"
              className="btn btn-ghost btn-sm filter-clear"
              onClick={() => dispatch(filtersCleared())}
            >
              Clear
            </button>
          )}
        </>
      )}
    </section>
  )
}
