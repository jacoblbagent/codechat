/**
 * One clipboard write for the whole app.
 *
 * `navigator.clipboard.writeText` is the good path, but it is not always there:
 * it is undefined in an insecure context (an http origin that is not
 * localhost — the dev server opened over the LAN or a tailnet address), and it
 * rejects with NotAllowedError where the browser refuses write permission. Both
 * cases used to leave the copy buttons doing nothing but a "Clipboard
 * unavailable" toast, so every caller falls back to the old
 * textarea + execCommand('copy') route, which needs only the click that is
 * already running.
 *
 * Call it synchronously from the gesture: execCommand consumes the user
 * activation, and an `await` before it would lose the activation in Firefox.
 */
export function copyText(text: string): Promise<boolean> {
  const legacy = (): boolean => {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    // Off-screen but still rendered and selectable — display:none cannot hold a selection.
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, area.value.length)
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }

  const write = navigator.clipboard?.writeText
  if (!write) return Promise.resolve(legacy())
  try {
    return write.call(navigator.clipboard, text).then(
      () => true,
      () => legacy(),
    )
  } catch {
    return Promise.resolve(legacy())
  }
}
