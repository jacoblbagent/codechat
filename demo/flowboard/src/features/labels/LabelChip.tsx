import type { CSSProperties } from 'react'
import { labelById } from './labels'

interface LabelChipProps {
  labelId: string
  /** Renders a remove affordance. Omit for a read-only chip. */
  onRemove?: (labelId: string) => void
  /** Selected state, used by the toggle grid in the card dialog. */
  active?: boolean
}

export default function LabelChip({ labelId, onRemove, active }: LabelChipProps) {
  const label = labelById(labelId)
  if (!label) return null

  return (
    <span
      className={`label-chip${active ? ' is-active' : ''}`}
      style={{ '--chip': label.color } as CSSProperties}
      title={label.name}
    >
      <span className="label-chip-dot" aria-hidden="true" />
      {label.name}
      {onRemove && (
        <button
          type="button"
          className="label-chip-remove"
          aria-label={`Remove the ${label.name} label`}
          onClick={() => onRemove(labelId)}
        >
          ×
        </button>
      )}
    </span>
  )
}
