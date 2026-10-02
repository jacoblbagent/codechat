import { useEffect, useRef } from 'react'

export type Binding = string

/** "ctrl+shift+z" -> a comparable shape. Order does not matter. */
function describe(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(event.key.toLowerCase())
  return parts.join('+')
}

/**
 * Document-level shortcuts. Bindings are held in a ref so a re-render does not
 * tear down and rebuild the listener on every keystroke.
 */
export function useHotkeys(bindings: Record<Binding, (event: KeyboardEvent) => void>): void {
  const latest = useRef(bindings)
  latest.current = bindings

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (typing) return

      const handler = latest.current[describe(event)]
      if (!handler) return
      event.preventDefault()
      handler(event)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
