/**
 * Labels are data. The palette is fixed and small on purpose: a board with
 * sixteen colours stops communicating anything.
 */

export interface Label {
  id: string
  name: string
  /** CSS custom property from styles/tokens.css. */
  color: string
}

export const LABELS: Record<string, Label> = {
  design: { id: 'design', name: 'Design', color: 'var(--label-violet)' },
  bug: { id: 'bug', name: 'Bug', color: 'var(--label-red)' },
  infra: { id: 'infra', name: 'Infra', color: 'var(--label-blue)' },
  copy: { id: 'copy', name: 'Copy', color: 'var(--label-amber)' },
  a11y: { id: 'a11y', name: 'Accessibility', color: 'var(--label-green)' },
}

export const LABEL_LIST: Label[] = Object.values(LABELS)

export function labelById(id: string): Label | undefined {
  return LABELS[id]
}
